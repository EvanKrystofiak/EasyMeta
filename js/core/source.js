/* EasyMeta - random access to a file without loading it.
 *
 * FileSource wraps a browser File (or an http URL that supports Range requests)
 * and reads only the byte ranges a parser asks for, through a small block cache.
 * It counts the bytes it actually fetched so the status bar can show how little
 * of a multi-GB file was touched.  Bin is a cursor over a DataView.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const BLOCK = 64 * 1024;          // cache granularity
  const MAX_BLOCKS = 256;           // 16 MB of cache per file
  const BYPASS = 2 * 1024 * 1024;   // larger reads skip the cache

  class FileSource {
    constructor() {
      this.name = '';
      this.path = '';
      this.size = 0;
      this.lastModified = null;
      this.bytesRead = 0;
      this.reads = 0;
      this._file = null;
      this._url = null;
      this._blocks = new Map();
    }

    static fromFile(file, path) {
      const s = new FileSource();
      s._file = file;
      s.name = file.name;
      s.size = file.size;
      s.lastModified = file.lastModified ? new Date(file.lastModified) : null;
      s.path = path || file.webkitRelativePath || file.name;
      return s;
    }

    /** Remote file over http(s); the server must answer Range requests. */
    static async fromUrl(url, name) {
      const s = new FileSource();
      s._url = url;
      const r = await fetch(url, { method: 'HEAD' });
      if (!r.ok) throw new Error(`Cannot open ${url} (HTTP ${r.status})`);
      s.size = Number(r.headers.get('content-length')) || 0;
      const lm = r.headers.get('last-modified');
      s.lastModified = lm ? new Date(lm) : null;
      const p = decodeURIComponent(new URL(url, location.href).pathname).replace(/^\/fs\//, '');
      s.name = name || M.basename(p);
      s.path = p;
      return s;
    }

    async _fetch(start, end) {
      this.reads++;
      this.bytesRead += end - start;
      if (this._file) return new Uint8Array(await this._file.slice(start, end).arrayBuffer());
      const r = await fetch(this._url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (r.status === 200 && (start > 0 || end < this.size)) throw new Error('The server does not support partial reads (HTTP Range).');
      if (!r.ok) throw new Error(`Read failed (HTTP ${r.status})`);
      const buf = new Uint8Array(await r.arrayBuffer());
      return r.status === 200 ? buf.subarray(start, end) : buf;
    }

    /**
     * Bytes [offset, offset+length), clipped to the file.  opts.cache=false reads
     * exactly the range (use for many scattered small reads, e.g. walking TIFF IFDs).
     */
    async read(offset, length, opts) {
      offset = Math.max(0, Math.floor(offset));
      const end = Math.min(this.size, offset + Math.max(0, Math.floor(length)));
      if (end <= offset) return new Uint8Array(0);
      if ((opts && opts.cache === false) || end - offset > BYPASS) return this._fetch(offset, end);
      const b0 = Math.floor(offset / BLOCK), b1 = Math.floor((end - 1) / BLOCK);
      // touch cached blocks first so inserting the missing ones cannot evict them
      for (let b = b0; b <= b1; b++) if (this._blocks.has(b)) this._get(b);
      // fetch missing blocks, coalescing runs into one read
      let run = -1;
      for (let b = b0; b <= b1 + 1; b++) {
        const missing = b <= b1 && !this._blocks.has(b);
        if (missing && run < 0) run = b;
        if (!missing && run >= 0) {
          const s = run * BLOCK, e = Math.min(this.size, b * BLOCK);
          const data = await this._fetch(s, e);
          for (let k = run; k < b; k++) this._put(k, data.subarray((k - run) * BLOCK, Math.min(data.length, (k - run + 1) * BLOCK)));
          run = -1;
        }
      }
      if (b0 === b1) {
        const blk = this._get(b0);
        return blk.subarray(offset - b0 * BLOCK, end - b0 * BLOCK);
      }
      const out = new Uint8Array(end - offset);
      for (let b = b0; b <= b1; b++) {
        const blk = this._get(b);
        const s = Math.max(offset, b * BLOCK), e = Math.min(end, (b + 1) * BLOCK);
        out.set(blk.subarray(s - b * BLOCK, e - b * BLOCK), s - offset);
      }
      return out;
    }

    _put(b, data) {
      // copy so the cache never pins a large buffer
      this._blocks.set(b, data.length === data.buffer.byteLength ? data : data.slice());
      if (this._blocks.size > MAX_BLOCKS) this._blocks.delete(this._blocks.keys().next().value);
    }
    _get(b) {
      const v = this._blocks.get(b);
      this._blocks.delete(b);
      this._blocks.set(b, v); // LRU touch
      return v;
    }

    async view(offset, length, opts) {
      const u = await this.read(offset, length, opts);
      return new DataView(u.buffer, u.byteOffset, u.byteLength);
    }
    async bin(offset, length, little, opts) {
      return new Bin(await this.read(offset, length, opts), little !== false, 0, offset);
    }
    async text(offset, length, enc) {
      return M.decodeText(await this.read(offset, length), enc || 'utf-8');
    }
  }

  /** Cursor over bytes.  `base` is the file offset of byte 0 (for reporting). */
  class Bin {
    constructor(bytes, little, pos, base) {
      this.u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
      this.dv = new DataView(this.u.buffer, this.u.byteOffset, this.u.byteLength);
      this.le = little !== false;
      this.pos = pos || 0;
      this.base = base || 0;
    }
    get length() { return this.u.length; }
    get left() { return this.u.length - this.pos; }
    eof(n) { return this.pos + (n || 1) > this.u.length; }
    seek(p) { this.pos = p; return this; }
    skip(n) { this.pos += n; return this; }
    u8() { return this.dv.getUint8(this.pos++); }
    i8() { return this.dv.getInt8(this.pos++); }
    u16() { const v = this.dv.getUint16(this.pos, this.le); this.pos += 2; return v; }
    i16() { const v = this.dv.getInt16(this.pos, this.le); this.pos += 2; return v; }
    u32() { const v = this.dv.getUint32(this.pos, this.le); this.pos += 4; return v; }
    i32() { const v = this.dv.getInt32(this.pos, this.le); this.pos += 4; return v; }
    u64() { const v = this.dv.getBigUint64(this.pos, this.le); this.pos += 8; return Number(v); }
    i64() { const v = this.dv.getBigInt64(this.pos, this.le); this.pos += 8; return Number(v); }
    f32() { const v = this.dv.getFloat32(this.pos, this.le); this.pos += 4; return v; }
    f64() { const v = this.dv.getFloat64(this.pos, this.le); this.pos += 8; return v; }
    bytes(n) { const v = this.u.subarray(this.pos, this.pos + n); this.pos += n; return v; }
    /** Fixed-width Latin-1 field, cut at NUL. */
    ascii(n) { return M.cstr(this.bytes(n)); }
    utf16(nChars) { return M.decodeText(this.bytes(nChars * 2), 'utf-16le'); }
    /** NUL-terminated Latin-1 string. */
    cstr() {
      let e = this.pos;
      while (e < this.u.length && this.u[e] !== 0) e++;
      const s = M.decodeText(this.u.subarray(this.pos, e), 'latin1');
      this.pos = Math.min(this.u.length, e + 1);
      return s;
    }
    /** NUL-terminated UTF-16LE string. */
    wstr() {
      let e = this.pos;
      while (e + 1 < this.u.length && (this.u[e] | this.u[e + 1])) e += 2;
      const s = M.decodeText(this.u.subarray(this.pos, e), 'utf-16le');
      this.pos = Math.min(this.u.length, e + 2);
      return s;
    }
    // random-access getters (do not move the cursor)
    U8(o) { return this.dv.getUint8(o); }
    U16(o) { return this.dv.getUint16(o, this.le); }
    I16(o) { return this.dv.getInt16(o, this.le); }
    U32(o) { return this.dv.getUint32(o, this.le); }
    I32(o) { return this.dv.getInt32(o, this.le); }
    U64(o) { return Number(this.dv.getBigUint64(o, this.le)); }
    I64(o) { return Number(this.dv.getBigInt64(o, this.le)); }
    F32(o) { return this.dv.getFloat32(o, this.le); }
    F64(o) { return this.dv.getFloat64(o, this.le); }
    STR(o, n) { return M.cstr(this.u.subarray(o, o + n)); }
  }

  /** Does `bytes` start with the ASCII string `s` (at offset `at`)? */
  M.startsWith = function (bytes, s, at) {
    at = at || 0;
    if (bytes.length < at + s.length) return false;
    for (let i = 0; i < s.length; i++) if (bytes[at + i] !== s.charCodeAt(i)) return false;
    return true;
  };

  M.FileSource = FileSource;
  M.Bin = Bin;
})();
