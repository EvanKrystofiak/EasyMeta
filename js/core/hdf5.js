/* EasyMeta - minimal lazy HDF5 reader (enough for Imaris .ims metadata).
 *
 * Supports superblocks v0-v3, object headers v1/v2 (with continuation blocks),
 * old-style groups (B-tree v1 + local heap), new-style groups and attribute lists,
 * compact (messages in the header) or dense (fractal heap + B-tree v2), attributes
 * (numbers, fixed and variable-length strings) and contiguous / compact / small
 * chunked datasets.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const SIG = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
  const UNDEF = Number.MAX_SAFE_INTEGER;
  /** Bytes that can hold the value x (HDF5's limit encoding). */
  const encSize = (x) => Math.floor(Math.log2(x) / 8) + 1;
  const uintLE = (u, p, n) => { let v = 0; for (let i = n - 1; i >= 0; i--) v = v * 256 + u[p + i]; return v; };
  // dense storage is in hash order: sort names, with numbers in order (Channel 2 before Channel 10)
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true });

  class H5 {
    constructor(src) { this.src = src; this.headers = new Map(); }

    async open() {
      let base = 0, h = null;
      for (const off of [0, 512, 1024, 2048, 4096, 8192]) {
        if (off + 64 > this.src.size) break;
        const b = await this.src.bin(off, 128, true);
        if (SIG.every((x, i) => b.U8(i) === x)) { base = off; h = b; break; }
      }
      if (!h) throw new Error('Not an HDF5 file');
      this.version = h.U8(8);
      if (this.version <= 1) {
        this.O = h.U8(13); this.L = h.U8(14);
        let p = 24 + (this.version === 1 ? 4 : 0);
        this.base = this._addr(h, p) || base; p += this.O * 4; // base, freespace, eof, driver
        p += this.O; // link name offset of root entry
        this.rootAddr = this._addr(h, p); p += this.O;
        const cache = h.U32(p); p += 8;
        if (cache === 1) this.rootSym = { btree: this._addr(h, p), heap: this._addr(h, p + this.O) };
      } else {
        this.O = h.U8(9); this.L = h.U8(10);
        let p = 12;
        this.base = this._addr(h, p) || base; p += this.O * 3; // base, ext, eof
        this.rootAddr = this._addr(h, p);
      }
      return this;
    }

    _addr(b, p) { return this.O === 8 ? b.U64(p) : this.O === 4 ? b.U32(p) : b.U16(p); }
    _len(b, p) { return this.L === 8 ? b.U64(p) : this.L === 4 ? b.U32(p) : b.U16(p); }
    _undef(a) { return a === UNDEF || a >= 0xffffffffffff || a === 0xffffffff && this.O === 4; }

    /** Messages of the object header at `addr`: [{type, data: Bin}] */
    async header(addr) {
      if (this.headers.has(addr)) return this.headers.get(addr);
      const msgs = [];
      const b0 = await this.src.bin(addr, 16, true);
      if (M.startsWith(b0.u, 'OHDR')) {
        const flags = b0.U8(5);
        let p = 6;
        if (flags & 0x20) p += 16;
        if (flags & 0x10) p += 4;
        const szBytes = 1 << (flags & 3);
        const hb = await this.src.bin(addr, p + szBytes, true);
        const chunk0 = szBytes === 1 ? hb.U8(p) : szBytes === 2 ? hb.U16(p) : szBytes === 4 ? hb.U32(p) : hb.U64(p);
        p += szBytes;
        // chunk #0 size excludes its checksum; continuation blocks ("OCHK") include one
        const blocks = [[addr + p, chunk0, flags, true]];
        while (blocks.length) {
          const [start, len, fl, first] = blocks.shift();
          const b = await this.src.bin(start, len, true);
          let q = 0;
          const end = first ? len : len - 4;
          while (q + 4 <= end) {
            const type = b.U8(q), size = b.U16(q + 1), mflags = b.U8(q + 3);
            q += 4 + (fl & 0x04 ? 2 : 0);
            if (q + size > b.length) break;
            const data = new M.Bin(b.u.subarray(q, q + size), true);
            if (type === 0x10) {
              const ca = this._addr(data, 0), cl = this._len(data, this.O);
              blocks.push([ca + 4, cl - 4, fl, false]); // skip "OCHK" signature
            } else if (type !== 0) msgs.push({ type, flags: mflags, data });
            q += size;
          }
        }
      } else {
        const n = b0.U16(2), hsize = b0.U32(8);
        const blocks = [[addr + 16, hsize]];
        let count = 0;
        while (blocks.length && count < n) {
          const [start, len] = blocks.shift();
          const b = await this.src.bin(start, len, true);
          let q = 0;
          while (q + 8 <= len && count < n) {
            const type = b.U16(q), size = b.U16(q + 2), mflags = b.U8(q + 4);
            q += 8;
            const data = new M.Bin(b.u.subarray(q, q + size), true);
            count++;
            if (type === 0x10) blocks.push([this._addr(data, 0), this._len(data, this.O)]);
            else if (type !== 0) msgs.push({ type, flags: mflags, data });
            q += size;
          }
        }
      }
      this.headers.set(addr, msgs);
      return msgs;
    }

    /** Children of a group: [{name, addr}] */
    async list(addr) {
      const msgs = await this.header(addr);
      const out = [];
      const sym = msgs.find((m) => m.type === 0x11);
      if (sym || (addr === this.rootAddr && this.rootSym)) {
        const btree = sym ? this._addr(sym.data, 0) : this.rootSym.btree;
        const heap = sym ? this._addr(sym.data, this.O) : this.rootSym.heap;
        const hb = await this.src.bin(heap, 8 + this.L * 2 + this.O, true);
        if (!M.startsWith(hb.u, 'HEAP')) return out;
        const heapData = this._addr(hb, 8 + this.L * 2);
        const heapSize = this._len(hb, 8);
        const names = await this.src.read(heapData, heapSize);
        const nameAt = (o) => { let e = o; while (e < names.length && names[e]) e++; return M.decodeText(names.subarray(o, e), 'utf-8'); };
        const walk = async (node, depth) => {
          if (depth > 20) return;
          const nb = await this.src.bin(node, 24 + 64 * (this.O + this.L) * 2, true);
          if (M.startsWith(nb.u, 'TREE')) {
            const level = nb.U8(5), used = nb.U16(6);
            let p = 8 + this.O * 2;
            const need = p + (used * 2 + 1) * Math.max(this.O, this.L) + 64;
            const full = nb.length >= need ? nb : await this.src.bin(node, need, true);
            for (let i = 0; i < used; i++) {
              p += this.L; // key
              const child = this._addr(full, p); p += this.O;
              await walk(child, level > 0 ? depth + 1 : depth + 1);
            }
          } else if (M.startsWith(nb.u, 'SNOD')) {
            const n = nb.U16(6);
            const esz = this.O * 2 + 24;
            const sb = await this.src.bin(node + 8, n * esz, true);
            for (let i = 0; i < n; i++) {
              const nameOff = this._addr(sb, i * esz), oh = this._addr(sb, i * esz + this.O);
              out.push({ name: nameAt(nameOff), addr: oh });
            }
          }
        };
        await walk(btree, 0);
      }
      for (const m of msgs.filter((x) => x.type === 0x06)) {
        const link = this._link(m.data);
        if (link) out.push(link);
      }
      const dense = this._denseInfo(msgs, 0x02, 8);
      if (dense) {
        const hp = await this._fractalHeap(dense.heap);
        const links = [];
        // name index record: name hash (4), heap id (7)
        for (const rec of await this._btree2(dense.index)) {
          const obj = await this._heapObject(hp, rec.subarray(4));
          const link = obj && this._link(new M.Bin(obj, true));
          if (link) links.push(link);
        }
        out.push(...links.sort((a, b) => byName(a.name, b.name)));
      }
      return out;
    }

    /** A Link message: {name, addr} for a hard link, else null. */
    _link(d) {
      const flags = d.U8(1);
      let p = 2;
      let ltype = 0;
      if (flags & 0x08) { ltype = d.U8(p); p += 1; }
      if (flags & 0x04) p += 8;
      if (flags & 0x10) p += 1;
      const lsz = 1 << (flags & 3);
      const nl = lsz === 1 ? d.U8(p) : lsz === 2 ? d.U16(p) : lsz === 4 ? d.U32(p) : d.U64(p);
      p += lsz;
      const name = M.decodeText(d.u.subarray(p, p + nl), 'utf-8');
      p += nl;
      return ltype === 0 ? { name, addr: this._addr(d, p) } : null;
    }

    /** Link Info / Attribute Info message: where dense storage is, or null when it is not used. */
    _denseInfo(msgs, type, orderSize) {
      const m = msgs.find((x) => x.type === type);
      if (!m) return null;
      const p = 2 + (m.data.U8(1) & 1 ? orderSize : 0); // version, flags, [max creation index]
      const heap = this._addr(m.data, p), index = this._addr(m.data, p + this.O);
      return this._undef(heap) || this._undef(index) ? null : { heap, index };
    }

    /** Fractal heap header (FRHP). */
    async _fractalHeap(addr) {
      this._heaps = this._heaps || new Map();
      if (this._heaps.has(addr)) return this._heaps.get(addr);
      const O = this.O, L = this.L;
      const b = await this.src.bin(addr, 14 + 12 * L + 3 * O + 8, true);
      if (!M.startsWith(b.u, 'FRHP')) throw new Error('HDF5 fractal heap not found');
      const maxManaged = b.U32(10);
      let p = 14 + 10 * L + 2 * O; // past the free space and object statistics
      const width = b.U16(p); p += 2;
      const start = this._len(b, p); p += L;
      const maxDirect = this._len(b, p); p += L;
      const maxBits = b.U16(p); p += 4; // and the starting number of rows
      const root = this._addr(b, p); p += O;
      const rows = b.U16(p);
      const offSize = Math.ceil(maxBits / 8);
      const hp = {
        filtered: b.U16(7) > 0, width, start, root, rows, offSize,
        lenSize: Math.min(Math.ceil(Math.log2(maxDirect) / 8), encSize(maxManaged)),
        directRows: Math.round(Math.log2(maxDirect) - Math.log2(start)) + 2,
        indirectPrefix: 5 + O + offSize, // signature, version, heap address, block offset
      };
      this._heaps.set(addr, hp);
      return hp;
    }

    /** Bytes of the heap object with this id; null for the kinds this metadata never uses. */
    async _heapObject(hp, id) {
      const kind = (id[0] >> 4) & 3;
      if (kind === 2) return id.subarray(1, 2 + (id[0] & 15)); // tiny: held in the id itself
      if (kind !== 0 || hp.filtered) return null; // huge objects, compressed heaps
      const off = uintLE(id, 1, hp.offSize), len = uintLE(id, 1 + hp.offSize, hp.lenSize);
      return this.src.read(await this._heapLocate(hp, off), len);
    }

    /** File address of a heap offset.  Offsets count from the start of a block, header included. */
    async _heapLocate(hp, off) {
      if (!hp.rows) return hp.root + off; // the root is one direct block
      let block = hp.root, base = 0;
      for (let level = 0; level < 16; level++) {
        // doubling table: rows 0 and 1 hold blocks of the starting size, then each row doubles
        const rel = off - base;
        let row = 0, first = 0, size = hp.start;
        while (rel >= first + size * hp.width) { first += size * hp.width; row++; if (row >= 2) size *= 2; }
        const col = Math.floor((rel - first) / size);
        const entry = await this.src.bin(block + hp.indirectPrefix + (row * hp.width + col) * this.O, this.O, true);
        const child = this._addr(entry, 0);
        if (row < hp.directRows) return child + (rel - first - col * size);
        block = child; base += first + col * size;
      }
      throw new Error('HDF5 fractal heap too deep');
    }

    /** Records of a version 2 B-tree (BTHD), in key order: [Uint8Array]. */
    async _btree2(addr) {
      const O = this.O;
      const h = await this.src.bin(addr, 18 + O + this.L, true);
      if (!M.startsWith(h.u, 'BTHD')) throw new Error('HDF5 B-tree v2 not found');
      const nodeSize = h.U32(6), recSize = h.U16(10), depth = h.U16(12);
      const root = this._addr(h, 16), rootCount = h.U16(16 + O);
      if (this._undef(root)) return [];
      // child pointers store record counts in as few bytes as can hold the largest possible count
      const PREFIX = 10; // signature, version, type, checksum
      const leafMax = Math.floor((nodeSize - PREFIX) / recSize);
      const countSize = encSize(leafMax);
      const totalSizes = [0];
      let total = leafMax;
      for (let d = 1; d <= depth; d++) {
        const ptr = O + countSize + totalSizes[d - 1];
        const max = Math.floor((nodeSize - PREFIX - ptr) / (recSize + ptr));
        total = (max + 1) * total + max;
        totalSizes.push(encSize(total));
      }
      const out = [];
      const visit = async (node, n, d) => {
        const b = new M.Bin(await this.src.read(node, nodeSize), true);
        let p = 6 + n * recSize;
        for (let i = 0; i <= n; i++) {
          if (d > 0) {
            const child = this._addr(b, p);
            const count = uintLE(b.u, p + O, countSize);
            p += O + countSize + (d > 1 ? totalSizes[d - 1] : 0);
            await visit(child, count, d - 1);
          }
          if (i < n) out.push(b.u.subarray(6 + i * recSize, 6 + (i + 1) * recSize));
        }
      };
      await visit(root, rootCount, depth);
      return out;
    }

    async resolve(path) {
      let addr = this.rootAddr;
      for (const part of path.split('/').filter(Boolean)) {
        const kids = await this.list(addr);
        const k = kids.find((x) => x.name === part);
        if (!k) return null;
        addr = k.addr;
      }
      return addr;
    }

    _datatype(d, p) {
      const cv = d.U8(p), cls = cv & 15;
      const bits = d.U8(p + 1) | (d.U8(p + 2) << 8) | (d.U8(p + 3) << 16);
      const size = d.U32(p + 4);
      const t = { cls, size, le: !(bits & 1), signed: !!(bits & 8) };
      if (cls === 9) { t.vlenString = (bits & 15) === 1; t.base = this._datatype(d, p + 8); }
      return t;
    }
    _dataspace(d, p) {
      const v = d.U8(p), rank = d.U8(p + 1), flags = d.U8(p + 2);
      let q = v === 1 ? p + 8 : p + 4;
      const dims = [];
      for (let i = 0; i < rank; i++) { dims.push(this._len(d, q)); q += this.L; }
      if (v >= 2 && d.U8(p + 3) === 0) return { dims: [], scalar: true };
      return { dims, n: dims.reduce((a, b) => a * b, 1), flags };
    }

    async _decode(t, sp, bytes) {
      const n = sp.scalar || !sp.dims.length ? 1 : sp.n;
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (t.cls === 3) {
        if (t.size === 1) return M.decodeText(bytes.subarray(0, n), 'utf-8').replace(/\0+$/, '');
        const strs = [];
        for (let i = 0; i < n; i++) strs.push(M.decodeText(bytes.subarray(i * t.size, (i + 1) * t.size), 'utf-8').replace(/\0+$/, ''));
        return n === 1 ? strs[0] : strs;
      }
      if (t.cls === 9 && t.vlenString) {
        const out = [];
        const esz = 4 + this.O + 4;
        for (let i = 0; i < n; i++) {
          const b = new M.Bin(bytes.subarray(i * esz, (i + 1) * esz), true);
          out.push(await this._globalHeap(this._addr(b, 4), b.U32(4 + this.O)));
        }
        return n === 1 ? out[0] : out;
      }
      if (t.cls === 0 || t.cls === 1) {
        const out = [];
        for (let i = 0; i < n; i++) {
          const o = i * t.size;
          if (o + t.size > bytes.length) break;
          let v;
          if (t.cls === 1) v = t.size === 4 ? dv.getFloat32(o, t.le) : dv.getFloat64(o, t.le);
          else if (t.size === 1) v = t.signed ? dv.getInt8(o) : dv.getUint8(o);
          else if (t.size === 2) v = t.signed ? dv.getInt16(o, t.le) : dv.getUint16(o, t.le);
          else if (t.size === 4) v = t.signed ? dv.getInt32(o, t.le) : dv.getUint32(o, t.le);
          else v = Number(t.signed ? dv.getBigInt64(o, t.le) : dv.getBigUint64(o, t.le));
          out.push(v);
        }
        return out.length === 1 ? out[0] : out;
      }
      return `(${M.fmt.bytes(bytes.length)} of HDF5 class ${t.cls})`;
    }

    async _globalHeap(coll, index) {
      this._gh = this._gh || new Map();
      if (!this._gh.has(coll)) {
        const hb = await this.src.bin(coll, 8 + this.L, true);
        const size = this._len(hb, 8);
        const b = await this.src.bin(coll, size, true);
        const objs = new Map();
        let p = 8 + this.L;
        while (p + 8 + this.L <= size) {
          const idx = b.U16(p), osz = this._len(b, p + 8);
          if (idx === 0) break;
          objs.set(idx, M.decodeText(b.u.subarray(p + 8 + this.L, p + 8 + this.L + osz), 'utf-8'));
          p += 8 + this.L + Math.ceil(osz / 8) * 8;
        }
        this._gh.set(coll, objs);
      }
      return this._gh.get(coll).get(index) || '';
    }

    /** An Attribute message: [name, value]. */
    async _attr(d) {
      const v = d.U8(0);
      const nameSize = d.U16(2), dtSize = d.U16(4), dsSize = d.U16(6);
      let p = v === 3 ? 9 : 8;
      const pad = (x) => (v === 1 ? Math.ceil(x / 8) * 8 : x);
      const name = M.decodeText(d.u.subarray(p, p + nameSize), 'utf-8').replace(/\0+$/, '');
      p += pad(nameSize);
      const t = this._datatype(d, p); p += pad(dtSize);
      const sp = this._dataspace(d, p); p += pad(dsSize);
      return [name, await this._decode(t, sp, d.u.subarray(p))];
    }

    /** Attributes of an object: {name: value}. */
    async attrs(addr) {
      const msgs = await this.header(addr);
      const list = [];
      for (const m of msgs.filter((x) => x.type === 0x0c)) {
        try { list.push(await this._attr(m.data)); } catch (e) { /* skip unreadable attribute */ }
      }
      const dense = this._denseInfo(msgs, 0x15, 2);
      if (dense) {
        try {
          const hp = await this._fractalHeap(dense.heap);
          // name index record: heap id (8), message flags (1), creation order (4), name hash (4)
          for (const rec of await this._btree2(dense.index)) {
            if (rec[8] & 2) continue; // a shared message lives in another heap
            try {
              const obj = await this._heapObject(hp, rec.subarray(0, 8));
              if (obj) list.push(await this._attr(new M.Bin(obj, true)));
            } catch (e) { /* skip unreadable attribute */ }
          }
        } catch (e) { list.push(['(dense attributes)', `not read: ${e.message}`]); }
        list.sort((a, b) => byName(a[0], b[0]));
      }
      return Object.fromEntries(list);
    }

    /** Element type of a dataset, without reading its data: {cls, size, signed, le}. */
    async datatype(addr) {
      const m = (await this.header(addr)).find((x) => x.type === 0x03);
      return m ? this._datatype(m.data, 0) : null;
    }

    /** Small dataset contents: {dims, type, bytes} (contiguous, compact or deflated chunks). */
    async dataset(addr, maxBytes) {
      const msgs = await this.header(addr);
      const ds = msgs.find((m) => m.type === 0x01), dt = msgs.find((m) => m.type === 0x03), ly = msgs.find((m) => m.type === 0x08);
      if (!ds || !dt || !ly) return null;
      const sp = this._dataspace(ds.data, 0), t = this._datatype(dt.data, 0);
      const total = sp.n * t.size;
      if (maxBytes && total > maxBytes) return null;
      const d = ly.data, v = d.U8(0);
      let bytes = null;
      if (v >= 3) {
        const cls = d.U8(1);
        if (cls === 0) bytes = d.u.subarray(4, 4 + d.U16(2));
        else if (cls === 1) { const a = this._addr(d, 2); if (!this._undef(a)) bytes = await this.src.read(a, total); }
        else if (cls === 2 && v === 3) bytes = await this._chunked(d, sp, t, msgs, total);
      } else {
        const rank = d.U8(1), cls = d.U8(2);
        if (cls === 1) bytes = await this.src.read(this._addr(d, 8), total);
        else if (cls === 0) { const p = 8 + rank * 4; bytes = d.u.subarray(p + 4, p + 4 + d.U32(p)); }
      }
      return bytes ? { dims: sp.dims, type: t, bytes } : null;
    }

    async _chunked(d, sp, t, msgs, total) {
      const rank = d.U8(2);
      const btree = this._addr(d, 3);
      const cdims = [];
      for (let i = 0; i < rank - 1; i++) cdims.push(d.U32(3 + this.O + i * 4));
      const filters = [];
      const fm = msgs.find((m) => m.type === 0x0b);
      if (fm) {
        const f = fm.data, fv = f.U8(0), nf = f.U8(1);
        let q = fv === 1 ? 8 : 2;
        for (let i = 0; i < nf && q + 6 <= f.length; i++) {
          const id = f.U16(q);
          const nameLen = fv === 1 || id >= 256 ? f.U16(q + 2) : 0;
          const nvals = fv === 1 ? f.U16(q + 6) : f.U16(q + (id >= 256 ? 6 : 4));
          q += fv === 1 ? 8 + Math.ceil(nameLen / 8) * 8 + nvals * 4 + (nvals % 2 ? 4 : 0) : (id >= 256 ? 8 + nameLen : 6) + nvals * 4;
          filters.push(id);
        }
      }
      if (filters.some((id) => id !== 1 && id !== 2)) return null; // only deflate / shuffle
      const deflate = filters.includes(1), shuffle = filters.includes(2);
      const out = new Uint8Array(total);
      const strides = sp.dims.map((_, i) => sp.dims.slice(i + 1).reduce((a, b) => a * b, 1));
      const visit = async (node, depth) => {
        if (depth > 10) return;
        const keySize = 8 + 8 * rank;
        const hb = await this.src.bin(node, 8 + this.O * 2, true);
        if (!M.startsWith(hb.u, 'TREE')) return;
        const level = hb.U8(5), used = hb.U16(6);
        const b = await this.src.bin(node + 8 + this.O * 2, (used + 1) * keySize + used * this.O, true);
        for (let i = 0; i < used; i++) {
          const kp = i * (keySize + this.O);
          const csize = b.U32(kp);
          const offs = [];
          for (let r = 0; r < rank - 1; r++) offs.push(b.U64(kp + 8 + r * 8));
          const child = this._addr(b, kp + keySize);
          if (level > 0) { await visit(child, depth + 1); continue; }
          let raw = await this.src.read(child, csize);
          if (deflate) raw = await M.inflate(raw, 'deflate');
          if (shuffle && t.size > 1) {
            const n = raw.length / t.size, un = new Uint8Array(raw.length);
            for (let bIdx = 0; bIdx < t.size; bIdx++) for (let e2 = 0; e2 < n; e2++) un[e2 * t.size + bIdx] = raw[bIdx * n + e2];
            raw = un;
          }
          // copy the chunk into place (row-major)
          const cn = cdims.reduce((a, c) => a * c, 1);
          for (let e = 0; e < cn; e++) {
            let rem = e, dst = 0, ok = true;
            for (let r = 0; r < cdims.length; r++) {
              const cs = cdims.slice(r + 1).reduce((a, c) => a * c, 1);
              const idx = Math.floor(rem / cs); rem %= cs;
              const g = offs[r] + idx;
              if (g >= sp.dims[r]) { ok = false; break; }
              dst += g * strides[r];
            }
            if (ok) out.set(raw.subarray(e * t.size, (e + 1) * t.size), dst * t.size);
          }
        }
      };
      await visit(btree, 0);
      return out;
    }

    /** Attributes of every group below `path` (depth-limited): {"/a/b": {...}} */
    async tree(path, depth, maxGroups) {
      const out = {};
      let count = 0;
      const rec = async (addr, p, dpt) => {
        if (count++ > (maxGroups || 400)) return;
        const at = await this.attrs(addr);
        if (Object.keys(at).length) out[p || '/'] = at;
        if (dpt <= 0) return;
        let kids = [];
        try { kids = await this.list(addr); } catch (e) { kids = []; }
        for (const k of kids) await rec(k.addr, (p || '') + '/' + k.name, dpt - 1);
      };
      const start = path ? await this.resolve(path) : this.rootAddr;
      if (start !== null) await rec(start, path || '', depth === undefined ? 3 : depth);
      return out;
    }
  }

  M.H5 = H5;
})();
