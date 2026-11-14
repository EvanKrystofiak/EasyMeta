/* EasyMeta - TIFF / BigTIFF reader.
 *
 * Reads IFDs and tag values on demand.  Many microscopy formats are TIFF inside
 * (EER, LSM, OME-TIFF, ImageJ, Zeiss/Thermo SEM, AMT, Fibics); their parsers are
 * registered as "TIFF flavours" in registry.js and receive a parsed TIFF.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };

  const TAG_NAMES = {
    254: 'NewSubfileType', 255: 'SubfileType', 256: 'ImageWidth', 257: 'ImageLength', 258: 'BitsPerSample',
    259: 'Compression', 262: 'Photometric', 266: 'FillOrder', 269: 'DocumentName', 270: 'ImageDescription',
    271: 'Make', 272: 'Model', 273: 'StripOffsets', 274: 'Orientation', 277: 'SamplesPerPixel',
    278: 'RowsPerStrip', 279: 'StripByteCounts', 280: 'MinSampleValue', 281: 'MaxSampleValue',
    282: 'XResolution', 283: 'YResolution', 284: 'PlanarConfiguration', 285: 'PageName', 296: 'ResolutionUnit',
    297: 'PageNumber', 305: 'Software', 306: 'DateTime', 315: 'Artist', 316: 'HostComputer', 317: 'Predictor',
    320: 'ColorMap', 322: 'TileWidth', 323: 'TileLength', 324: 'TileOffsets', 325: 'TileByteCounts',
    330: 'SubIFDs', 338: 'ExtraSamples', 339: 'SampleFormat', 340: 'SMinSampleValue', 341: 'SMaxSampleValue',
    347: 'JPEGTables', 532: 'ReferenceBlackWhite', 33432: 'Copyright', 33628: 'UIC1tag', 33629: 'UIC2tag',
    33630: 'UIC3tag', 33631: 'UIC4tag', 34118: 'CZ_SEM', 34361: 'MM_Header', 34362: 'MM_Stamp',
    34386: 'MM_UserBlock', 34412: 'CZ_LSMINFO', 34665: 'ExifIFD', 34680: 'FEI_SFEG', 34682: 'FEI_HELIOS',
    37706: 'TVIPS', 40001: 'MC_IpWinScal', 50838: 'IJMetadataByteCounts', 50839: 'IJMetadata',
    51023: 'FibicsXML', 51123: 'MicroManagerMetadata', 65000: 'OlympusSIS', 65001: 'EER_Metadata',
    65002: 'EER_FrameMetadata', 65007: 'EER_SkipBits', 65008: 'EER_HorzSubBits', 65009: 'EER_VertSubBits',
  };
  const COMPRESSION = {
    1: 'none', 2: 'CCITT', 5: 'LZW', 6: 'old JPEG', 7: 'JPEG', 8: 'Deflate', 32773: 'PackBits', 32946: 'Deflate',
    34712: 'JPEG 2000', 34887: 'LERC', 50000: 'Zstd', 50001: 'WebP', 65000: 'EER (8-bit RLE)',
    65001: 'EER (7-bit RLE)', 65002: 'EER (variable RLE)',
  };

  async function open(src) {
    const head = await src.read(0, 16);
    const b0 = head[0], b1 = head[1];
    let le;
    if (b0 === 0x49 && b1 === 0x49) le = true;
    else if (b0 === 0x4d && b1 === 0x4d) le = false;
    else throw new Error('Not a TIFF file');
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    const magic = dv.getUint16(2, le);
    let big, first;
    if (magic === 42) { big = false; first = dv.getUint32(4, le); }
    else if (magic === 43) { big = true; first = Number(dv.getBigUint64(8, le)); }
    else throw new Error('Not a TIFF file');
    const tiff = { src, le, big, firstOffset: first, ifds: [] };
    tiff.ifd0 = await readIFD(tiff, first);
    tiff.ifds.push(tiff.ifd0);
    return tiff;
  }

  /** Parse one IFD (entries only; large values are read later on demand). */
  async function readIFD(tiff, offset, opts) {
    const src = tiff.src, le = tiff.le, big = tiff.big;
    const esz = big ? 20 : 12, csz = big ? 8 : 2, nsz = big ? 8 : 4;
    const cacheOpt = opts && opts.cache === false ? { cache: false } : undefined;
    let u = await src.read(offset, csz + esz * 40 + nsz, cacheOpt);
    let dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const n = big ? Number(dv.getBigUint64(0, le)) : dv.getUint16(0, le);
    if (n > 5000) throw new Error('Corrupt TIFF directory');
    const need = csz + esz * n + nsz;
    if (u.length < need) {
      u = await src.read(offset, need, cacheOpt);
      dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
    }
    const tags = new Map();
    for (let i = 0; i < n; i++) {
      const p = csz + i * esz;
      if (p + esz > u.length) break;
      const code = dv.getUint16(p, le), type = dv.getUint16(p + 2, le);
      const count = big ? Number(dv.getBigUint64(p + 4, le)) : dv.getUint32(p + 4, le);
      const size = (TYPE_SIZE[type] || 1) * count;
      const inlineMax = big ? 8 : 4;
      const vpos = p + (big ? 12 : 8);
      const entry = { code, type, count, name: TAG_NAMES[code] || String(code) };
      if (size <= inlineMax) entry.value = decode(u.subarray(vpos, vpos + size), type, count, le);
      else entry.offset = big ? Number(dv.getBigUint64(vpos, le)) : dv.getUint32(vpos, le);
      entry.size = size;
      tags.set(code, entry);
    }
    const np = csz + esz * n;
    let next = 0;
    if (np + nsz <= u.length) next = big ? Number(dv.getBigUint64(np, le)) : dv.getUint32(np, le);
    return { offset, next, tags };
  }

  function decode(bytes, type, count, le) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const out = [];
    switch (type) {
      case 2: { // ASCII: one or more NUL-separated strings
        let s = M.decodeText(bytes, 'utf-8');
        s = s.replace(/\0+$/, '');
        return s.includes('\0') ? s.split('\0') : s;
      }
      case 1: case 7: return bytes.slice();
      case 6: for (let i = 0; i < count; i++) out.push(dv.getInt8(i)); break;
      case 3: for (let i = 0; i < count; i++) out.push(dv.getUint16(i * 2, le)); break;
      case 8: for (let i = 0; i < count; i++) out.push(dv.getInt16(i * 2, le)); break;
      case 4: case 13: for (let i = 0; i < count; i++) out.push(dv.getUint32(i * 4, le)); break;
      case 9: for (let i = 0; i < count; i++) out.push(dv.getInt32(i * 4, le)); break;
      case 5: for (let i = 0; i < count; i++) { const d = dv.getUint32(i * 8 + 4, le); out.push(d ? dv.getUint32(i * 8, le) / d : 0); } break;
      case 10: for (let i = 0; i < count; i++) { const d = dv.getInt32(i * 8 + 4, le); out.push(d ? dv.getInt32(i * 8, le) / d : 0); } break;
      case 11: for (let i = 0; i < count; i++) out.push(dv.getFloat32(i * 4, le)); break;
      case 12: for (let i = 0; i < count; i++) out.push(dv.getFloat64(i * 8, le)); break;
      case 16: case 18: for (let i = 0; i < count; i++) out.push(Number(dv.getBigUint64(i * 8, le))); break;
      case 17: for (let i = 0; i < count; i++) out.push(Number(dv.getBigInt64(i * 8, le))); break;
      default: return bytes.slice();
    }
    return count === 1 ? out[0] : out;
  }

  /** Value of a tag (reading it from the file if it is not inline); undefined if absent. */
  async function value(tiff, ifd, code, maxBytes) {
    const e = ifd.tags.get(code);
    if (!e) return undefined;
    if (e.value !== undefined) return e.value;
    if (maxBytes && e.size > maxBytes) return undefined;
    const bytes = await tiff.src.read(e.offset, e.size);
    e.value = decode(bytes, e.type, e.count, tiff.le);
    return e.value;
  }
  /** Raw bytes of a tag value (for binary structures such as CZ_LSMINFO). */
  async function bytesOf(tiff, ifd, code) {
    const e = ifd.tags.get(code);
    if (!e) return null;
    if (e.offset === undefined) return e.value instanceof Uint8Array ? e.value : null;
    return tiff.src.read(e.offset, e.size);
  }

  /** Count pages by walking the IFD chain (stops at `limit`). */
  async function countIFDs(tiff, limit) {
    limit = limit || 5000;
    let n = 0, off = tiff.firstOffset;
    const seen = new Set();
    while (off && n < limit && !seen.has(off) && off < tiff.src.size) {
      seen.add(off);
      const ifd = n === 0 ? tiff.ifd0 : await readIFD(tiff, off, { cache: false });
      if (n > 0 && n < 64) tiff.ifds.push(ifd);
      n++;
      off = ifd.next;
    }
    return { count: n, complete: !off || off >= tiff.src.size || seen.has(off) };
  }

  /** Summary of an IFD's basic image layout. */
  async function layout(tiff, ifd) {
    const g = async (c, d) => { const v = await value(tiff, ifd, c, 4096); return v === undefined ? d : v; };
    const bps = await g(258, 1);
    const L = {
      width: await g(256, 0), height: await g(257, 0),
      bits: Array.isArray(bps) ? bps[0] : bps,
      samples: await g(277, 1), compression: await g(259, 1), photometric: await g(262, 1),
      planar: await g(284, 1), predictor: await g(317, 1), sampleFormat: await g(339, 1),
      rowsPerStrip: await g(278, 0), tileWidth: await g(322, 0), tileLength: await g(323, 0),
    };
    if (Array.isArray(L.sampleFormat)) L.sampleFormat = L.sampleFormat[0];
    L.compressionName = COMPRESSION[L.compression] || String(L.compression);
    return L;
  }

  /** Physical pixel size (m) from X/YResolution + ResolutionUnit, if meaningful. */
  async function resolution(tiff, ifd) {
    const xr = await value(tiff, ifd, 282), unit = await value(tiff, ifd, 296);
    if (!M.isNum(xr) || xr <= 0) return null;
    const per = unit === 3 ? 0.01 : unit === 2 ? 0.0254 : null;
    if (!per) return null;
    return per / xr;
  }

  M.TIFF = { open, readIFD, value, bytesOf, countIFDs, layout, resolution, TAG_NAMES, COMPRESSION, decode };
})();
