/* EasyMeta - OLE2 / Compound File Binary reader (Olympus OIB, Zeiss ZVI).
 * The FAT is loaded one sector at a time as chains are followed, so opening a
 * multi-GB file reads only a few KB.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const END = 0xfffffffe, FREE = 0xffffffff;

  class OLE {
    constructor(src) { this.src = src; this.fatCache = new Map(); this.difat = null; }

    async open() {
      const h = await this.src.bin(0, 512, true);
      const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
      if (!sig.every((b, i) => h.U8(i) === b)) throw new Error('Not an OLE2 compound file');
      this.sectorSize = 1 << h.U16(30);
      this.miniSize = 1 << h.U16(32);
      this.numFAT = h.U32(44);
      this.firstDir = h.U32(48);
      this.cutoff = h.U32(56);
      this.firstMiniFAT = h.U32(60);
      this.numMiniFAT = h.U32(64);
      this.firstDIFAT = h.U32(68);
      this.numDIFAT = h.U32(72);
      this.difat = [];
      for (let i = 0; i < 109; i++) this.difat.push(h.U32(76 + i * 4));
      this.perSector = this.sectorSize / 4;
      this.entries = await this._directory();
      this.root = this.entries[0];
      return this;
    }

    off(sector) { return (sector + 1) * this.sectorSize; }

    async _fatSectorNumber(i) {
      while (i >= this.difat.length) {
        // follow the DIFAT chain lazily
        if (this._difatNext === undefined) this._difatNext = this.firstDIFAT;
        if (this._difatNext === END || this._difatNext === FREE || this._difatNext === undefined) return FREE;
        const b = await this.src.bin(this.off(this._difatNext), this.sectorSize, true);
        for (let k = 0; k < this.perSector - 1; k++) this.difat.push(b.U32(k * 4));
        this._difatNext = b.U32((this.perSector - 1) * 4);
      }
      return this.difat[i];
    }

    async next(sector) {
      const fi = Math.floor(sector / this.perSector);
      let fat = this.fatCache.get(fi);
      if (!fat) {
        const fs = await this._fatSectorNumber(fi);
        if (fs === FREE) return END;
        const b = await this.src.bin(this.off(fs), this.sectorSize, true);
        fat = new Uint32Array(this.perSector);
        for (let k = 0; k < this.perSector; k++) fat[k] = b.U32(k * 4);
        this.fatCache.set(fi, fat);
      }
      return fat[sector % this.perSector];
    }

    async chain(start, maxSectors) {
      const out = [];
      let s = start;
      const seen = new Set();
      while (s !== END && s !== FREE && !seen.has(s) && out.length < (maxSectors || 1e7)) {
        seen.add(s);
        out.push(s);
        s = await this.next(s);
      }
      return out;
    }

    /** Read a chain of regular sectors, coalescing consecutive runs. */
    async readChain(start, size) {
      const need = Math.ceil(size / this.sectorSize);
      const secs = await this.chain(start, need);
      const out = new Uint8Array(secs.length * this.sectorSize);
      let i = 0;
      while (i < secs.length) {
        let j = i;
        while (j + 1 < secs.length && secs[j + 1] === secs[j] + 1) j++;
        const bytes = await this.src.read(this.off(secs[i]), (j - i + 1) * this.sectorSize);
        out.set(bytes, i * this.sectorSize);
        i = j + 1;
      }
      return out.subarray(0, Math.min(size, out.length));
    }

    async _directory() {
      const secs = await this.chain(this.firstDir, 100000);
      const entries = [];
      for (const s of secs) {
        const b = await this.src.bin(this.off(s), this.sectorSize, true);
        for (let o = 0; o + 128 <= this.sectorSize; o += 128) {
          const nl = b.U16(o + 64);
          entries.push({
            id: entries.length,
            name: M.decodeText(b.u.subarray(o, o + Math.max(0, nl - 2)), 'utf-16le'),
            type: b.U8(o + 66), left: b.U32(o + 68), right: b.U32(o + 72), child: b.U32(o + 76),
            start: b.U32(o + 116), size: this.sectorSize === 512 ? b.U32(o + 120) : b.U64(o + 120),
          });
        }
      }
      return entries;
    }

    /** Children of a storage entry, in-order through the sibling tree. */
    children(entry) {
      const out = [];
      const visit = (id, depth) => {
        if (id === FREE || id >= this.entries.length || depth > 10000) return;
        const e = this.entries[id];
        visit(e.left, depth + 1);
        out.push(e);
        visit(e.right, depth + 1);
      };
      visit(entry.child, 0);
      return out;
    }

    /** Find an entry by name anywhere (case-insensitive). */
    find(name) {
      const n = name.toLowerCase();
      return this.entries.find((e) => e.type === 2 && e.name.toLowerCase() === n) || null;
    }

    async read(entry, maxBytes) {
      const size = Math.min(entry.size, maxBytes || entry.size);
      if (entry.size >= this.cutoff || entry.type === 5) return this.readChain(entry.start, size);
      // mini stream
      if (!this._mini) {
        this._mini = await this.readChain(this.root.start, this.root.size);
        this._miniFat = [];
        const mf = await this.readChain(this.firstMiniFAT, this.numMiniFAT * this.sectorSize);
        const dv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
        for (let k = 0; k + 4 <= mf.length; k += 4) this._miniFat.push(dv.getUint32(k, true));
      }
      const out = new Uint8Array(size);
      let s = entry.start, p = 0;
      const seen = new Set();
      while (s !== END && s !== FREE && p < size && !seen.has(s)) {
        seen.add(s);
        const n = Math.min(this.miniSize, size - p);
        out.set(this._mini.subarray(s * this.miniSize, s * this.miniSize + n), p);
        p += n;
        s = this._miniFat[s];
      }
      return out;
    }
  }

  M.OLE = OLE;
})();
