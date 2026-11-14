/* EasyMeta - Gatan DigitalMicrograph DM3 / DM4.
 *
 * The whole file is one tag tree with the pixel arrays inline.  The tree is
 * walked with a buffered stream that steps over large arrays without reading
 * them, so only the tags (usually tens of KB) are fetched.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const SIZES = { 2: 2, 3: 4, 4: 2, 5: 4, 6: 4, 7: 8, 8: 1, 9: 1, 10: 1, 11: 8, 12: 8 };
  const DM_IMAGE_TYPES = { 1: 'i16', 2: 'f32', 6: 'u8', 7: 'i32', 9: 'i8', 10: 'u16', 11: 'u32', 12: 'f64' };

  /** Sequential reader with a read-ahead window; skip() costs nothing. */
  class Stream {
    constructor(src, pos) { this.src = src; this.pos = pos || 0; this.buf = null; this.bufStart = 0; }
    async need(n) {
      if (this.buf && this.pos >= this.bufStart && this.pos + n <= this.bufStart + this.buf.length) return;
      const len = Math.max(n, 256 * 1024);
      this.buf = await this.src.read(this.pos, len);
      this.bufStart = this.pos;
      if (this.buf.length < n) throw new Error('Unexpected end of DM file');
    }
    async dv(n) {
      await this.need(n);
      const o = this.pos - this.bufStart;
      this.pos += n;
      return new DataView(this.buf.buffer, this.buf.byteOffset + o, n);
    }
    async bytes(n) {
      await this.need(n);
      const o = this.pos - this.bufStart;
      this.pos += n;
      return this.buf.subarray(o, o + n);
    }
    skip(n) { this.pos += n; }
  }

  function readScalar(dv, off, type, le) {
    switch (type) {
      case 2: return dv.getInt16(off, le);
      case 3: return dv.getInt32(off, le);
      case 4: return dv.getUint16(off, le);
      case 5: return dv.getUint32(off, le);
      case 6: return dv.getFloat32(off, le);
      case 7: return dv.getFloat64(off, le);
      case 8: return dv.getUint8(off) !== 0;
      case 9: return String.fromCharCode(dv.getUint8(off));
      case 10: return dv.getInt8(off);
      case 11: return Number(dv.getBigInt64(off, le));
      case 12: return Number(dv.getBigUint64(off, le));
      default: return null;
    }
  }

  async function parseTree(src) {
    const hd = new DataView((await src.read(0, 24)).buffer);
    const version = hd.getInt32(0, false);
    if (version !== 3 && version !== 4) throw new Error('Not a DM3/DM4 file');
    const v4 = version === 4;
    const le = (v4 ? hd.getInt32(12, false) : hd.getInt32(8, false)) === 1;
    const s = new Stream(src, v4 ? 16 : 12);
    const arrays = []; // large arrays found (image data)
    const readInt = async () => (v4 ? Number((await s.dv(8)).getBigInt64(0, false)) : (await s.dv(4)).getInt32(0, false));

    async function group(path) {
      await s.dv(2); // sorted, open
      const n = await readInt();
      const entries = [];
      for (let i = 0; i < n; i++) {
        const t = (await s.dv(1)).getUint8(0);
        if (t === 0) break;
        const ll = (await s.dv(2)).getUint16(0, false);
        const label = ll ? M.decodeText(await s.bytes(ll), 'latin1') : '';
        if (v4) await s.dv(8); // total size of this tag
        const p = path.concat(label || String(entries.length));
        if (t === 20) entries.push([label, await group(p)]);
        else if (t === 21) entries.push([label, await data(p)]);
        else throw new Error('Corrupt DM tag tree');
      }
      // unlabeled entries form a list
      if (entries.length && entries.every(([l]) => l === '')) return entries.map(([, v]) => v);
      const o = {};
      for (const [l, v] of entries) o[l || '#' + Object.keys(o).length] = v;
      return o;
    }

    async function data(path) {
      const pct = M.decodeText(await s.bytes(4), 'latin1');
      if (pct !== '%%%%') throw new Error('Corrupt DM data tag');
      const ninfo = await readInt();
      const info = [];
      for (let i = 0; i < ninfo; i++) info.push(await readInt());
      const type = info[0];
      if (SIZES[type]) {
        const dv = await s.dv(SIZES[type]);
        return readScalar(dv, 0, type, le);
      }
      if (type === 18) { // string
        const len = info[1];
        return M.decodeText(await s.bytes(len * 2), le ? 'utf-16le' : 'utf-16be');
      }
      if (type === 15) { // struct
        const nf = info[2];
        const types = [];
        for (let i = 0; i < nf; i++) types.push(info[4 + i * 2]);
        const size = types.reduce((a, t) => a + (SIZES[t] || 0), 0);
        const dv = await s.dv(size);
        let o = 0;
        const out = [];
        for (const ft of types) { out.push(readScalar(dv, o, ft, le)); o += SIZES[ft] || 0; }
        return out;
      }
      if (type === 20) { // array
        const et = info[1];
        if (et === 15) { // array of structs
          const nf = info[3];
          const types = [];
          for (let i = 0; i < nf; i++) types.push(info[5 + i * 2]);
          const len = info[info.length - 1];
          const size = types.reduce((a, t) => a + (SIZES[t] || 0), 0) * len;
          if (size > 64 * 1024) { s.skip(size); return `(array of ${len} structs)`; }
          const dv = await s.dv(size);
          const out = [];
          let o = 0;
          for (let k = 0; k < len; k++) { const rec = []; for (const ft of types) { rec.push(readScalar(dv, o, ft, le)); o += SIZES[ft] || 0; } out.push(rec); }
          return out;
        }
        const len = info[2];
        const esz = SIZES[et] || 1;
        const size = len * esz;
        const offset = s.pos;
        if (size > 4096) {
          s.skip(size);
          arrays.push({ path: path.join('.'), offset, length: len, elemType: et, bytes: size });
          return { array: true, offset, length: len, elemType: et, bytes: size };
        }
        const dv = await s.dv(size);
        if (et === 4 && len > 0) { // uint16 arrays are usually UTF-16 text
          let str = '';
          for (let k = 0; k < len; k++) str += String.fromCharCode(dv.getUint16(k * 2, le));
          if (/^[\x09\x0a\x0d\x20-\x7e -ɏͰ-Ͽ]*$/.test(str)) return str;
        }
        if (et === 9 || (et === 10 && len > 1)) {
          let str = '';
          for (let k = 0; k < len; k++) str += String.fromCharCode(dv.getUint8(k));
          return str.replace(/\0+$/, '');
        }
        const out = [];
        for (let k = 0; k < len; k++) out.push(readScalar(dv, k * esz, et, le));
        return out;
      }
      throw new Error('Unknown DM data type ' + type);
    }

    const root = await group([]);
    return { version, le, root, arrays };
  }

  /** Find a key anywhere below `o` (depth-first), case-insensitive. */
  function find(o, key, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 8) return undefined;
    const k = Object.keys(o).find((x) => x.toLowerCase() === key.toLowerCase());
    if (k !== undefined) return o[k];
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object' && !v.array) {
        const r = find(v, key, (depth || 0) + 1);
        if (r !== undefined) return r;
      }
    }
    return undefined;
  }

  async function parse(src) {
    const ds = M.newDataset(src, this);
    ds.modality = 'EM';
    const tree = await parseTree(src);
    ds.format.detail = `DM${tree.version}` + (tree.le ? '' : ' · big-endian data');
    const list = Array.isArray(tree.root.ImageList) ? tree.root.ImageList : [];
    // the main image is the last one with real data; a small first one is the thumbnail
    let main = null, thumb = null;
    list.forEach((im, i) => {
      const d = im && im.ImageData;
      if (!d || !d.Data || !d.Data.array) return;
      const dims = [].concat(d.Dimensions || []);
      if (i === 0 && list.length > 1 && Math.max(...dims) <= 512) thumb = im;
      else main = im;
    });
    main = main || list[list.length - 1] || {};
    const D = main.ImageData || {};
    const dims = [].concat(D.Dimensions || []);
    ds.dims = { x: dims[0], y: dims[1], z: dims[2] || 1 };
    ds.pixelType = { 1: '16-bit signed', 2: '32-bit float', 6: '8-bit unsigned', 7: '32-bit signed', 9: '8-bit signed', 10: '16-bit unsigned', 11: '32-bit unsigned', 12: '64-bit float', 23: 'RGBA 8-bit' }[D.DataType] || `DM type ${D.DataType}`;
    const tags = main.ImageTags || {};
    ds.title = main.Name || ds.title;

    // calibration
    const cal = D.Calibrations && D.Calibrations.Dimension;
    if (Array.isArray(cal) && cal[0] && M.isNum(cal[0].Scale)) {
      const u = String(cal[0].Units || '').trim();
      if (/^1\//.test(u)) ds.diffraction = { scale: cal[0].Scale, unit: u };
      else {
        const px = M.toMeters(cal[0].Scale, u);
        const pz = cal[2] ? M.toMeters(cal[2].Scale, cal[2].Units) : null;
        if (px && cal[0].Scale !== 1) ds.pixel = { x: px, y: cal[1] ? M.toMeters(cal[1].Scale, cal[1].Units) || px : px, z: pz, source: 'DM calibration' };
      }
    }

    // microscope
    const mi = tags['Microscope Info'] || {};
    const em = M.ensureEM(ds);
    M.set(em, 'ht', M.num(mi.Voltage));
    M.set(em, 'mag', M.num(mi['Indicated Magnification']));
    M.set(em, 'actualMag', M.num(mi['Actual Magnification']));
    M.set(em, 'illuminationMode', mi['Illumination Mode']);
    M.set(em, 'projection', mi['Imaging Mode'] || mi['Operation Mode']);
    M.set(em, 'spot', M.num(mi['Spot size'] !== undefined ? mi['Spot size'] : mi['Spot Size']));
    if (M.isNum(mi['Cs(mm)'])) em.cs = mi['Cs(mm)'] * 1e-3;
    if (M.isNum(mi['Probe Current (nA)'])) em.beamCurrent = mi['Probe Current (nA)'] * 1e-9;
    if (M.isNum(mi['STEM Camera Length'])) em.cameraLength = mi['STEM Camera Length'] * 1e-3;
    if (mi['Illumination Mode'] && /STEM/i.test(mi['Illumination Mode'])) em.mode = 'STEM';
    else if (mi.Voltage) em.mode = em.mode || 'TEM';
    const sp = mi['Stage Position'] || {};
    if (M.isNum(sp['Stage Alpha'])) em.stage.alpha = sp['Stage Alpha'];
    if (M.isNum(sp['Stage Beta'])) em.stage.beta = sp['Stage Beta'];
    if (M.isNum(sp['Stage X'])) em.stage.x = sp['Stage X'] * 1e-6;
    if (M.isNum(sp['Stage Y'])) em.stage.y = sp['Stage Y'] * 1e-6;
    if (M.isNum(sp['Stage Z'])) em.stage.z = sp['Stage Z'] * 1e-6;
    // "Microscope" is often the DM plugin name ("JEOL COM", "FEI Tecnai Remote TCPIP")
    const scope = mi.Microscope || mi.Name || (tags['Session Info'] || {}).Microscope;
    if (scope) {
      if (/^JEOL\b.*\bCOM\b/i.test(scope)) ds.instrument.manufacturer = 'JEOL';
      else if (/^(FEI|Thermo).*(Remote|TCPIP|TEM ?Server)/i.test(scope)) ds.instrument.manufacturer = 'Thermo Fisher Scientific';
      else M.set(ds.instrument, 'model', scope);
      ds.instrument.name = scope;
    }
    if (mi.Operator || (tags['Session Info'] || {}).Operator) ds.operator = mi.Operator || tags['Session Info'].Operator;
    if (mi.Specimen || (tags['Session Info'] || {}).Specimen) ds.specimen = mi.Specimen || tags['Session Info'].Specimen;

    // camera
    const acq = tags.Acquisition || {};
    const dev = acq.Device || {};
    const hl = (acq.Parameters || {})['High Level'] || {};
    const det = (acq.Parameters || {}).Detector || {};
    M.set(em.camera, 'name', dev.Name || (tags.DataBar || {})['Device Name']);
    const ccdPx = find(dev, 'Pixel Size (um)');
    if (ccdPx) em.camera.sensorPixel = [].concat(ccdPx)[0] * 1e-6;
    const exp = M.num(hl['Exposure (s)']) || M.num(det['exposure (s)']) || M.num((tags.DataBar || {})['Exposure Time (s)']);
    if (exp) em.exposure = exp;
    const bin = hl.Binning || [det.hbin, det.vbin];
    if (Array.isArray(bin) && M.isNum(bin[0])) em.binning = bin[0];
    if (hl.Processing) em.camera.processing = hl.Processing;
    const modeName = [find(acq, 'Mode Name'), hl['Acquisition Mode'], find(tags, 'Read Mode')].find((v) => /count|linear|super|dose|integrat|correlated/i.test(String(v || '')));
    if (modeName) em.camera.mode = modeName;
    if (/count|super/i.test(String(modeName || ''))) em.camera.counting = true;
    const frames = find(tags, 'Number of Frames') || find(acq, 'Number Of Frames');
    if (M.isNum(frames) && frames > 1) em.frames = frames;
    // energy filter
    const ef = tags['Energy Filter'] || tags.GIF || find(tags, 'Filter') || {};
    if (typeof ef === 'object') {
      const sw = find(ef, 'Slit Width'), si = find(ef, 'Slit Inserted');
      if (M.isNum(sw)) em.filter.slitWidth = sw;
      if (si !== undefined) em.filter.slitInserted = !!si;
    }
    // date
    const db = tags.DataBar || {};
    if (db['Acquisition Date']) ds.acquired = M.parseDate(`${db['Acquisition Date']} ${db['Acquisition Time'] || ''}`.trim()) || `${db['Acquisition Date']} ${db['Acquisition Time'] || ''}`;
    const gms = tags['GMS Version'] || {};
    M.set(ds.instrument, 'software', 'DigitalMicrograph' + (gms.Created ? ` (GMS ${gms.Created})` : ''));

    // what is it
    const name = src.name.toLowerCase();
    if (/gain ref|gainref|\bgain\b|\.m\d\.kv|countref|superref/.test(name) || /gain/i.test(main.Name || '')) ds.kind = 'gain';
    else if (ds.diffraction) ds.kind = 'diffraction';
    else if (ds.dims.z > 1) ds.kind = 'imagestack';
    else ds.kind = 'image';

    ds.raw['DM tags'] = tree.root;
    M.addSource(ds, `DM${tree.version} tags`);
    ds.dm = { tree, main, thumb };
    ds.thumbnail = () => thumbnail(src, ds, tree.le);
    return ds;
  }

  async function thumbnail(src, ds, le) {
    const { main, thumb } = ds.dm;
    const pick = (im) => (im && im.ImageData && im.ImageData.Data && im.ImageData.Data.array ? im.ImageData : null);
    const T = pick(thumb);
    if (T && T.DataType === 23) {
      const d = T.Data, dims = [].concat(T.Dimensions);
      const bytes = await src.read(d.offset, d.bytes);
      return { canvas: M.img.rgbCanvas(bytes, dims[0], dims[1], 4, { bgra: true }), note: 'embedded thumbnail' };
    }
    const D = pick(main);
    if (!D) return null;
    const type = DM_IMAGE_TYPES[D.DataType];
    if (!type) return null;
    const dims = [].concat(D.Dimensions);
    const img = await M.img.readPlane(src, { offset: D.Data.offset, width: dims[0], height: dims[1], type, le }, 512);
    return { canvas: M.img.grayCanvas(img), note: dims[2] > 1 ? 'first image' : 'image' };
  }

  M.registerFormat({
    id: 'dm', name: 'Gatan DM', modality: 'EM', extensions: ['dm3', 'dm4'],
    sniff(h) {
      if (h.length < 16) return 0;
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      const v = dv.getInt32(0, false);
      if (v === 3) { const bo = dv.getInt32(8, false); return bo === 0 || bo === 1 ? 0.7 : 0; }
      if (v === 4) { const bo = dv.getInt32(12, false); return bo === 0 || bo === 1 ? 0.7 : 0; }
      return 0;
    },
    parse,
  });
})();
