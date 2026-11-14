/* EasyMeta - MRC / MRC2014 (.mrc .mrcs .st .ali .preali .rec .map) with
 * Thermo Fisher FEI1/FEI2, SerialEM (SERI) and Agard extended headers.
 * Reads the 1024-byte header plus the extended header only.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const MODES = {
    0: ['u8', '8-bit integer'], 1: ['i16', '16-bit signed integer'], 2: ['f32', '32-bit float'],
    3: [null, 'complex 16-bit'], 4: [null, 'complex 32-bit float'], 6: ['u16', '16-bit unsigned integer'],
    12: ['f16', '16-bit float'], 16: ['rgb8', 'RGB 8-bit'], 101: ['u4', '4-bit packed'],
  };
  const MODE_BYTES = { 0: 1, 1: 2, 2: 4, 3: 4, 4: 8, 6: 2, 12: 2, 16: 3, 101: 0.5 };
  const IMOD_STAMP = 1146047817;

  // Thermo Fisher extended header (FEI1 = 768 bytes, FEI2 = 888 bytes per section).
  // [offset, type, name, bitmask word, bit]
  const FEI = [
    [12, 'f8', 'Timestamp', 1, 0], [20, 's16', 'Microscope type', 1, 1], [36, 's16', 'D-Number', 1, 2],
    [52, 's16', 'Application', 1, 3], [68, 's16', 'Application version', 1, 4], [84, 'f8', 'HT', 1, 5],
    [92, 'f8', 'Dose', 1, 6], [100, 'f8', 'Alpha tilt', 1, 7], [108, 'f8', 'Beta tilt', 1, 8],
    [116, 'f8', 'X-Stage', 1, 9], [124, 'f8', 'Y-Stage', 1, 10], [132, 'f8', 'Z-Stage', 1, 11],
    [140, 'f8', 'Tilt axis angle', 1, 12], [148, 'f8', 'Dual axis rotation', 1, 13],
    [156, 'f8', 'Pixel size X', 1, 14], [164, 'f8', 'Pixel size Y', 1, 15],
    [220, 'f8', 'Defocus', 1, 22], [228, 'f8', 'STEM Defocus', 1, 23], [236, 'f8', 'Applied defocus', 1, 24],
    [244, 'i4', 'Instrument mode', 1, 25], [248, 'i4', 'Projection mode', 1, 26],
    [252, 's16', 'Objective lens mode', 1, 27], [268, 's16', 'High magnification mode', 1, 28],
    [284, 'i4', 'Probe mode', 1, 29], [288, 'b1', 'EFTEM On', 1, 30], [289, 'f8', 'Magnification', 1, 31],
    [301, 'f8', 'Camera length', 2, 0], [309, 'i4', 'Spot index', 2, 1], [313, 'f8', 'Illuminated area', 2, 2],
    [321, 'f8', 'Intensity', 2, 3], [329, 'f8', 'Convergence angle', 2, 4], [337, 's16', 'Illumination mode', 2, 5],
    [353, 'b1', 'Wide convergence angle range', 2, 6], [354, 'b1', 'Slit inserted', 2, 7], [355, 'f8', 'Slit width', 2, 8],
    [363, 'f8', 'Acceleration voltage offset', 2, 9], [371, 'f8', 'Drift tube voltage', 2, 10], [379, 'f8', 'Energy shift', 2, 11],
    [387, 'f8', 'Shift offset X', 2, 12], [395, 'f8', 'Shift offset Y', 2, 13], [403, 'f8', 'Shift X', 2, 14], [411, 'f8', 'Shift Y', 2, 15],
    [419, 'f8', 'Integration time', 2, 16], [427, 'i4', 'Binning width', 2, 17], [431, 'i4', 'Binning height', 2, 18],
    [435, 's16', 'Camera name', 2, 19], [451, 'i4', 'Readout area left', 2, 20], [455, 'i4', 'Readout area top', 2, 21],
    [459, 'i4', 'Readout area right', 2, 22], [463, 'i4', 'Readout area bottom', 2, 23],
    [467, 'b1', 'Ceta noise reduction', 2, 24], [468, 'i4', 'Ceta frames summed', 2, 25],
    [472, 'b1', 'Direct detector electron counting', 2, 26], [473, 'b1', 'Direct detector align frames', 2, 27],
    [518, 'b1', 'Phase plate', 3, 6], [519, 's16', 'STEM detector name', 3, 7], [535, 'f8', 'Gain', 3, 8], [543, 'f8', 'Offset', 3, 9],
    [571, 'f8', 'Dwell time', 3, 15], [579, 'f8', 'Frame time', 3, 16],
    [603, 'f8', 'Full scan FOV X', 3, 21], [611, 'f8', 'Full scan FOV Y', 3, 22], [619, 's16', 'Element', 3, 23],
    [635, 'f8', 'Energy interval lower', 3, 24], [643, 'f8', 'Energy interval higher', 3, 25], [651, 'i4', 'Method', 3, 26],
    [655, 'b1', 'Is dose fraction', 3, 27], [656, 'i4', 'Fraction number', 3, 28], [660, 'i4', 'Start frame', 3, 29],
    [664, 'i4', 'End frame', 3, 30], [668, 's80', 'Input stack filename', 3, 31],
    [752, 'f8', 'Alpha tilt min', 4, 0], [760, 'f8', 'Alpha tilt max', 4, 1],
    // FEI2 only
    [768, 'f8', 'Scan rotation', 4, 2], [776, 'f8', 'Diffraction pattern rotation', 4, 3], [784, 'f8', 'Image rotation', 4, 4],
    [792, 'i4', 'Scan mode enumeration', 4, 5], [796, 'i8', 'Acquisition time stamp', 4, 6],
    [804, 's16', 'Detector commercial name', 4, 7], [820, 'f8', 'Start tilt angle', 4, 8], [828, 'f8', 'End tilt angle', 4, 9],
    [836, 'f8', 'Tilt per image', 4, 10], [844, 'f8', 'Tilt speed', 4, 11], [852, 'i4', 'Beam center X pixel', 4, 12],
    [856, 'i4', 'Beam center Y pixel', 4, 13], [860, 'i8', 'CFEG flash timestamp', 4, 14],
    [868, 'i4', 'Phase plate position index', 4, 15], [872, 's16', 'Objective aperture name', 4, 16],
  ];
  const MASK_AT = { 1: 8, 2: 297, 3: 490, 4: 748 };
  const FIELD_BYTES = { f8: 8, i4: 4, i8: 8, b1: 1, s16: 16, s80: 80 };

  function readFEISection(b, base, msize) {
    const masks = {};
    for (const k of [1, 2, 3, 4]) masks[k] = MASK_AT[k] + 4 <= msize ? b.U32(base + MASK_AT[k]) : 0;
    const anyMask = masks[1] || masks[2] || masks[3] || masks[4];
    const rec = {};
    for (const [off, type, name, word, bit] of FEI) {
      if (off + FIELD_BYTES[type] > msize) continue;
      if (anyMask && !((masks[word] >>> bit) & 1)) continue;
      const o = base + off;
      let v;
      if (type === 'f8') v = b.F64(o);
      else if (type === 'i4') v = b.I32(o);
      else if (type === 'i8') v = b.I64(o);
      else if (type === 'b1') v = b.U8(o) !== 0;
      else v = b.STR(o, FIELD_BYTES[type]);
      if (typeof v === 'number' && !isFinite(v)) continue;
      rec[name] = v;
    }
    return rec;
  }

  /** SerialEM "SERI" short-integer sections (IMOD mrc_format). */
  const SERI_ITEMS = [[1, 2], [2, 6], [4, 4], [8, 2], [16, 2], [32, 4], [64, 2], [128, 4], [256, 2], [512, 4], [1024, 2]];
  function seriBytes(flags) {
    let n = 0;
    for (const [f, b] of SERI_ITEMS) if (flags & f) n += b;
    return n;
  }
  function seriFloat(s1, s2) {
    const sign1 = s1 < 0 ? -1 : 1, sign2 = s2 < 0 ? -1 : 1;
    return sign1 * (Math.abs(s1) * 256 + (Math.abs(s2) % 256)) * Math.pow(2, sign2 * Math.floor(Math.abs(s2) / 256));
  }
  function readSERISection(b, base, flags) {
    const rec = {};
    let p = base;
    if (flags & 1) { rec['Tilt angle'] = b.I16(p) / 100; p += 2; }
    if (flags & 2) { rec['Piece X'] = b.U16(p); rec['Piece Y'] = b.U16(p + 2); rec['Piece Z'] = b.U16(p + 4); p += 6; }
    if (flags & 4) { rec['Stage X (µm)'] = b.I16(p) / 25; rec['Stage Y (µm)'] = b.I16(p + 2) / 25; p += 4; }
    if (flags & 8) { rec.Magnification = b.I16(p) * 100; p += 2; }
    if (flags & 16) { rec.Intensity = b.I16(p) / 25000; p += 2; }
    if (flags & 32) { rec['Exposure dose (e/A2)'] = seriFloat(b.I16(p), b.I16(p + 2)); p += 4; }
    return rec;
  }

  function sniff(h, ext) {
    if (h.length < 224) return 0;
    for (const le of [true, false]) {
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      const nx = dv.getInt32(0, le), ny = dv.getInt32(4, le), nz = dv.getInt32(8, le), mode = dv.getInt32(12, le);
      if (!(nx > 0 && ny > 0 && nz > 0 && nx < 1e6 && ny < 1e6 && nz < 1e7)) continue;
      if (!(mode in MODE_BYTES)) continue;
      const mapc = dv.getInt32(64, le), mapr = dv.getInt32(68, le), maps = dv.getInt32(72, le);
      const mapsOk = (mapc === 0 && mapr === 0 && maps === 0) || ([1, 2, 3].includes(mapc) && [1, 2, 3].includes(Math.abs(mapr)) && [1, 2, 3].includes(maps));
      const hasMAP = M.startsWith(h, 'MAP', 208);
      const isMrcExt = ['mrc', 'mrcs', 'st', 'ali', 'preali', 'rec', 'map', 'mrc~', 'ccp4', 'sub', 'mrcz'].includes(ext);
      if (hasMAP) return 0.9;
      if (mapsOk && isMrcExt) return 0.7;
      if (mapsOk) return 0.3;
    }
    return 0;
  }

  async function parse(src, ctx) {
    const fmt = this;
    const ds = M.newDataset(src, fmt);
    ds.modality = 'EM';
    const hb = await src.read(0, 1024);
    let le = true;
    {
      const dv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
      const nx = dv.getInt32(0, true), mode = dv.getInt32(12, true);
      if (!(nx > 0 && nx < 1e6 && mode in MODE_BYTES)) le = false;
      if (hb[212] === 0x11 && hb[213] === 0x11) le = false;
      if (hb[212] === 0x44 && (hb[213] === 0x44 || hb[213] === 0x41)) le = true;
    }
    const b = new M.Bin(hb, le);
    const H = {
      nx: b.I32(0), ny: b.I32(4), nz: b.I32(8), mode: b.I32(12),
      nxstart: b.I32(16), nystart: b.I32(20), nzstart: b.I32(24),
      mx: b.I32(28), my: b.I32(32), mz: b.I32(36),
      xlen: b.F32(40), ylen: b.F32(44), zlen: b.F32(48),
      alpha: b.F32(52), beta: b.F32(56), gamma: b.F32(60),
      mapc: b.I32(64), mapr: b.I32(68), maps: b.I32(72),
      dmin: b.F32(76), dmax: b.F32(80), dmean: b.F32(84),
      ispg: b.I32(88), next: b.I32(92), creatid: b.I16(96),
      exttyp: b.STR(104, 4), nversion: b.I32(108), nint: b.I16(128), nreal: b.I16(130),
      imodStamp: b.I32(152), imodFlags: b.I32(156),
      idtype: b.I16(160), lens: b.I16(162), nd1: b.I16(164), nd2: b.I16(166), vd1: b.I16(168), vd2: b.I16(170),
      tiltangles: [0, 1, 2, 3, 4, 5].map((i) => b.F32(172 + i * 4)),
      xorg: b.F32(196), yorg: b.F32(200), zorg: b.F32(204),
      cmap: b.STR(208, 4), stamp: Array.from(hb.subarray(212, 216)).map((x) => x.toString(16).padStart(2, '0')).join(' '),
      rms: b.F32(216), nlabl: b.I32(220),
    };
    const labels = [];
    for (let i = 0; i < Math.min(10, Math.max(0, H.nlabl)); i++) {
      const t = M.decodeText(hb.subarray(224 + i * 80, 304 + i * 80), 'latin1').replace(/\0/g, ' ').trimEnd();
      if (t.trim()) labels.push(t.trim());
    }
    const isIMOD = H.imodStamp === IMOD_STAMP;
    const modeInfo = MODES[H.mode] || [null, 'mode ' + H.mode];
    ds.format.detail = (H.nversion >= 20140 ? 'MRC2014' : 'MRC') + (H.exttyp.trim() ? ' · ' + H.exttyp.trim() + ' extended header' : '') + (le ? '' : ' · big-endian');
    ds.dims = { x: H.nx, y: H.ny, z: H.nz };
    ds.pixelType = modeInfo[1];
    ds.bits = { 0: 8, 1: 16, 2: 32, 6: 16, 12: 16, 16: 24, 101: 4 }[H.mode] || null;
    M.addSource(ds, 'MRC header');

    // pixel size (Å in the header)
    const em = M.ensureEM(ds);
    if (H.mx > 0 && H.xlen > 0) {
      const px = H.xlen / H.mx, py = H.my > 0 && H.ylen > 0 ? H.ylen / H.my : px, pz = H.mz > 0 && H.zlen > 0 ? H.zlen / H.mz : null;
      ds.pixel = { x: px * 1e-10, y: py * 1e-10, z: pz ? pz * 1e-10 : null, source: 'MRC header' };
      if (Math.abs(px - 1) < 1e-6) {
        ds.pixel.suspect = true;
        M.note(ds, 'warn', 'The header pixel size is exactly 1.000 Å, which usually means it was never set.');
      }
    }

    // ---- extended header
    const ext = { type: H.exttyp.trim() };
    let feiRecs = null, seriRecs = null;
    if (H.next > 0 && 1024 + H.next <= src.size) {
      const eb = new M.Bin(await src.read(1024, H.next), le);
      if (/^FEI[12]$/.test(ext.type)) {
        const msize = eb.I32(0);
        if (msize > 0 && msize <= H.next) {
          const n = Math.min(H.nz, Math.floor(H.next / msize));
          feiRecs = [];
          for (let i = 0; i < n; i++) feiRecs.push(readFEISection(eb, i * msize, msize));
          ext.metadataSize = msize;
          ext.version = eb.I32(4);
          ext.sections = n;
        }
      } else if (H.nint > 0 && seriBytes(H.nreal) === H.nint && (ext.type === 'SERI' || ext.type === '' || ext.type === 'MRCO')) {
        const n = Math.min(H.nz, Math.floor(H.next / H.nint));
        seriRecs = [];
        for (let i = 0; i < n; i++) seriRecs.push(readSERISection(eb, i * H.nint, H.nreal));
        ext.type = ext.type || 'SERI';
        ext.sections = n;
      } else if (ext.type === 'AGAR' && H.nint >= 0 && H.nreal > 0) {
        const per = (H.nint + H.nreal) * 4;
        const n = Math.min(H.nz, Math.floor(H.next / per));
        seriRecs = [];
        for (let i = 0; i < n; i++) seriRecs.push({ 'Tilt angle': eb.F32(i * per + H.nint * 4) });
        ext.sections = n;
      }
    }

    // ---- what kind of MRC is this?
    const name = src.name.toLowerCase();
    const fext = M.ext(src.name);
    const recs = feiRecs || seriRecs || [];
    const angles = feiRecs ? feiRecs.map((r) => r['Alpha tilt']) : seriRecs ? seriRecs.map((r) => r['Tilt angle']) : [];
    const angVals = angles.filter(M.isNum);
    const angSpan = angVals.length ? Math.max(...angVals) - Math.min(...angVals) : 0;
    const pieces = seriRecs && seriRecs[0] && 'Piece X' in seriRecs[0] ? seriRecs : null;
    const recLabels = labels.join(' ');
    let kind;
    const thin = Math.min(H.nx, H.ny, H.nz);
    const cubic = H.nx === H.ny && H.ny === H.nz;
    const isFractions = feiRecs && feiRecs[0] && feiRecs[0]['Is dose fraction'];
    // A reconstruction says so in its extension, in its labels or in a separate word of its name
    // (TS_01_rec.mrc, TS_01_10.00Apx.mrc from Warp, TS_01_Vol.mrc from AreTomo).  That outranks
    // "ts" / "tilt" in the name, which a tomogram usually inherits from its tilt series.
    const volume = cubic && H.nx <= 1024 ? 'map' : 'tomogram';
    const recSaid = fext === 'rec' || /tilt:|tomographic|reconstruct|aretomo|warp|isonet|cryocare|denoise|trimvol|clip: rotx/i.test(recLabels) ||
      /(^|[_.-])(rec|recon|reconstruction|tomogram|sirt|wbp|vol)([_.-]|$)|[_.-]\d+(\.\d+)?apx([_.-]|$)/.test(name);
    if (H.nz > 1 && angVals.length > 1 && angSpan > 1) kind = 'tiltseries';
    else if (pieces && H.nz > 1 && new Set(pieces.map((r) => r['Piece X'] + ',' + r['Piece Y'])).size > 1) kind = 'montage';
    else if (H.nz === 1) kind = /gain|countref|superref|norm/.test(name) ? 'gain' : 'image';
    else if (isFractions || /fraction|frames|movie|_fr\b/.test(name)) kind = 'movie';
    else if (['st', 'ali', 'preali'].includes(fext)) kind = 'tiltseries';
    else if (recSaid) kind = volume;
    else if (/(_|\b)(ts|tilt|tiltseries)(_|\b)/.test(name)) kind = 'tiltseries';
    else if (/(^|_)(rec|tomo|tomogram|full_rec|sirt|wbp)|rec\./.test(name)) kind = volume;
    else if (fext === 'map' || (H.ispg === 1 && cubic)) kind = 'map';
    else if (fext === 'mrcs' || (H.nx === H.ny && H.nx <= 1024 && H.nz > 20)) kind = 'particles';
    else if (H.ispg === 1 || H.ispg === 401) kind = thin < Math.max(H.nx, H.ny, H.nz) / 3 ? 'tomogram' : 'map';
    else if (H.nz <= 200 && Math.max(H.nx, H.ny) >= 2048) kind = 'movie';
    else kind = 'imagestack';
    ds.kind = kind;

    // ---- Thermo Fisher metadata -> dataset
    if (feiRecs && feiRecs.length) {
      M.addSource(ds, `${ext.type} extended header`);
      let ref = feiRecs[0];
      if (angVals.length) {
        let best = 0;
        feiRecs.forEach((r, i) => { if (M.isNum(r['Alpha tilt']) && Math.abs(r['Alpha tilt']) < Math.abs(feiRecs[best]['Alpha tilt'] || 1e9)) best = i; });
        ref = feiRecs[best];
      }
      applyFEI(ds, ref);
      if (!ds.pixel.x && M.isNum(ref['Pixel size X']) && ref['Pixel size X'] > 0) {
        ds.pixel = { x: ref['Pixel size X'], y: ref['Pixel size Y'] || ref['Pixel size X'], source: `${ext.type} extended header` };
      }
      if (kind === 'tiltseries' || angVals.length > 1) {
        ds.tilt = {
          source: `${ext.type} extended header`,
          tilts: feiRecs.map((r, i) => ({
            section: i, angle: r['Alpha tilt'], time: M.oleDate(r.Timestamp),
            dose: M.isNum(r.Dose) && r.Dose > 0 ? r.Dose / 1e20 : null,
            defocus: r['Applied defocus'], defocusReadout: r.Defocus, mag: r.Magnification,
            exposure: r['Integration time'], stageX: r['X-Stage'], stageY: r['Y-Stage'], stageZ: r['Z-Stage'],
          })),
        };
      }
      if (kind === 'movie') ds.movie = { frames: H.nz, source: `${ext.type} extended header` };
    }
    if (seriRecs && seriRecs.length) {
      M.addSource(ds, ext.type === 'AGAR' ? 'Agard extended header' : 'SerialEM extended header');
      if (kind === 'tiltseries' && 'Tilt angle' in seriRecs[0]) {
        ds.tilt = {
          source: 'SerialEM extended header',
          tilts: seriRecs.map((r, i) => ({ section: i, angle: r['Tilt angle'], dose: r['Exposure dose (e/A2)'] || null, mag: r.Magnification || null, intensity: r.Intensity })),
        };
      }
      const s0 = seriRecs[0];
      if (M.isNum(s0.Magnification) && s0.Magnification > 0) M.set(em, 'mag', s0.Magnification);
      if (M.isNum(s0.Intensity)) M.set(em, 'intensity', s0.Intensity);
      if (kind === 'montage') {
        ds.montage = { pieces: seriRecs.map((r, i) => ({ section: i, x: r['Piece X'], y: r['Piece Y'], z: r['Piece Z'] })), width: H.nx, height: H.ny };
      }
    }

    if (kind === 'movie') ds.movie = Object.assign(ds.movie || {}, { frames: H.nz });
    if (kind === 'tomogram' || kind === 'map') {
      ds.volume = { thicknessAxis: H.ny < H.nz && H.ny < H.nx ? 'y' : 'z' };
      if (ds.volume.thicknessAxis === 'y' && kind === 'tomogram') M.note(ds, 'info', 'Thickness runs along Y (IMOD output before rotation); "clip rotx" or "trimvol -rx" puts it along Z.');
    }

    // ---- processing history from the labels
    for (const l of labels) {
      const m = l.match(/^(.*?)(\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})\s+(\d{1,2}:\d{2}:\d{2}))?\s*$/);
      const text = (m ? m[1] : l).trim();
      const prog = (text.match(/^([A-Za-z0-9_.\-]+)\s*:/) || [])[1] || '';
      ds.history.push({ program: prog, text, date: m && m[3] ? `${m[3]} ${m[4]}` : '' });
    }
    if (isIMOD && (H.imodFlags & 32)) M.note(ds, 'info', 'IMOD flag: CTF correction has been applied to this stack.');

    // ---- file size check
    const dataBytes = Math.ceil(H.nx * (MODE_BYTES[H.mode] || 0)) * H.ny * H.nz;
    const expected = 1024 + Math.max(0, H.next) + (H.mode === 101 ? Math.ceil(H.nx / 2) * H.ny * H.nz : dataBytes);
    ds.integrity = { expected, actual: src.size };
    if (src.size < expected) {
      const missing = expected - src.size;
      const planes = Math.ceil(missing / Math.max(1, dataBytes / H.nz));
      M.note(ds, 'error', `File is truncated: ${M.fmt.bytes(missing)} short of the size the header describes (about ${planes} section${planes === 1 ? '' : 's'} missing).`);
    } else if (src.size > expected) {
      M.note(ds, 'warn', `File is ${M.fmt.bytes(src.size - expected)} larger than the header describes.`);
    }

    // ---- raw
    const hdr = Object.assign({}, H, { labels: undefined });
    ds.raw['MRC header'] = hdr;
    if (labels.length) ds.raw.Labels = labels;
    if (feiRecs) ds.raw[`Extended header (${ext.type}, ${feiRecs.length} sections)`] = feiRecs;
    if (seriRecs) ds.raw[`Extended header (${ext.type}, ${seriRecs.length} sections)`] = seriRecs;
    ds.mrc = { header: H, le, isIMOD, ext, dataOffset: 1024 + Math.max(0, H.next) };

    ds.thumbnail = () => thumbnail(src, ds);
    return ds;
  }

  /** Copy one Thermo Fisher section record into the dataset. */
  function applyFEI(ds, r) {
    const em = M.ensureEM(ds);
    const inst = ds.instrument;
    const mt = r['Microscope type'];
    if (mt) {
      const m = mt.match(/^([A-Za-z\- ]+?)\s*(\d+)?$/);
      M.set(inst, 'manufacturer', 'Thermo Fisher Scientific');
      M.set(inst, 'model', m ? m[1] : mt);
      M.set(inst, 'systemId', mt);
    }
    if (r['D-Number']) M.set(inst, 'serial', 'D' + String(r['D-Number']).replace(/^D/i, ''));
    if (r.Application) {
      M.set(inst, 'software', r.Application);
      M.set(inst, 'softwareVersion', r['Application version']);
    }
    M.set(em, 'ht', r.HT);
    M.set(em, 'mag', r.Magnification);
    M.set(em, 'spot', r['Spot index']);
    if (M.isNum(r['Illuminated area']) && r['Illuminated area'] > 0) M.set(em, 'illuminatedArea', r['Illuminated area']);
    if (M.isNum(r.Intensity) && r.Intensity !== 0) M.set(em, 'intensity', r.Intensity);
    if (M.isNum(r['Convergence angle']) && r['Convergence angle'] > 0) M.set(em, 'convergenceAngle', r['Convergence angle']);
    M.set(em, 'illuminationMode', r['Illumination mode']);
    if (r['Probe mode'] === 1) em.probeMode = 'Nanoprobe';
    else if (r['Probe mode'] === 2) em.probeMode = 'Microprobe';
    if (r['Instrument mode'] === 1) em.mode = 'TEM';
    else if (r['Instrument mode'] === 2) em.mode = 'STEM';
    if (r['Projection mode'] === 1) em.projection = 'Diffraction';
    else if (r['Projection mode'] === 2) em.projection = 'Imaging';
    M.set(em, 'lensMode', r['Objective lens mode']);
    M.set(em, 'magMode', r['High magnification mode']);
    if (M.isNum(r['Camera length']) && r['Camera length'] > 0) M.set(em, 'cameraLength', r['Camera length']);
    if ('EFTEM On' in r) em.filter.eftem = !!r['EFTEM On'];
    if ('Slit inserted' in r) em.filter.slitInserted = !!r['Slit inserted'];
    if (M.isNum(r['Slit width']) && r['Slit width'] > 0) em.filter.slitWidth = r['Slit width'];
    if (M.isNum(r['Energy shift']) && r['Energy shift'] !== 0) em.filter.energyShift = r['Energy shift'];
    if (M.isNum(r['Applied defocus'])) M.set(em, 'defocusTarget', r['Applied defocus']);
    if (M.isNum(r.Defocus)) M.set(em, 'defocusReadout', r.Defocus);
    if (M.isNum(r['Integration time']) && r['Integration time'] > 0) M.set(em, 'exposure', r['Integration time']);
    if (M.isNum(r.Dose) && r.Dose > 0) M.set(em, 'dosePerImage', r.Dose / 1e20);
    if (M.isNum(r['Binning width'])) M.set(em, 'binning', r['Binning width']);
    if (M.isNum(r['Tilt axis angle'])) M.set(em, 'tiltAxis', r['Tilt axis angle']);
    const cam = em.camera;
    M.set(cam, 'name', r['Camera name']);
    M.set(cam, 'commercialName', r['Detector commercial name']);
    if ('Direct detector electron counting' in r) cam.counting = !!r['Direct detector electron counting'];
    if ('Direct detector align frames' in r) cam.alignFrames = !!r['Direct detector align frames'];
    if (M.isNum(r['Readout area right']) && r['Readout area right'] > 0) cam.readout = [r['Readout area left'], r['Readout area top'], r['Readout area right'], r['Readout area bottom']];
    if (r['Phase plate']) em.phasePlate = true;
    M.set(em, 'objAperture', r['Objective aperture name']);
    M.set(em.stage, 'x', r['X-Stage']); M.set(em.stage, 'y', r['Y-Stage']); M.set(em.stage, 'z', r['Z-Stage']);
    M.set(em.stage, 'alpha', r['Alpha tilt']); M.set(em.stage, 'beta', r['Beta tilt']);
    if (M.isNum(r['Dwell time']) && r['Dwell time'] > 0 && em.mode === 'STEM') M.set(em, 'dwellTime', r['Dwell time']);
    M.set(em, 'stemDetector', r['STEM detector name']);
    if (r.Timestamp) ds.acquired = ds.acquired || M.oleDate(r.Timestamp);
  }

  /** Preview of one section, picked to be representative. */
  async function thumbnail(src, ds) {
    const H = ds.mrc.header;
    const type = (MODES[H.mode] || [])[0];
    if (!type || type === 'rgb8') return null;
    let t = type;
    if (t === 'u8' && (H.dmin < 0 || (ds.mrc.isIMOD && (H.imodFlags & 1)))) t = 'i8';
    const bpp = MODE_BYTES[H.mode];
    const plane = H.mode === 101 ? Math.ceil(H.nx / 2) * H.ny : H.nx * H.ny * bpp;
    const flipY = !(/^FEI/.test(ds.mrc.ext.type) && !ds.mrc.isIMOD);
    let z = 0, note = 'section 1';
    if (ds.kind === 'tiltseries' && ds.tilt) {
      let best = 0;
      ds.tilt.tilts.forEach((tt, i) => { if (M.isNum(tt.angle) && Math.abs(tt.angle) < Math.abs(ds.tilt.tilts[best].angle)) best = i; });
      z = ds.tilt.tilts[best].section; note = `section ${z + 1} (${M.fmt.deg(ds.tilt.tilts[best].angle)})`;
    } else if (ds.kind === 'tiltseries' || ds.kind === 'imagestack') { z = Math.floor(H.nz / 2); note = `section ${z + 1} of ${H.nz}`; }
    else if (ds.kind === 'tomogram' || ds.kind === 'map') {
      if (ds.volume && ds.volume.thicknessAxis === 'y' && H.ny > 1) {
        // XY view of an un-rotated IMOD volume: the middle row of every section
        const y = Math.floor(H.ny / 2);
        const rowBytes = H.nx * bpp;
        const step = Math.max(1, Math.ceil(H.nz / 512));
        const rows = Math.floor(H.nz / step);
        const data = new Float32Array(H.nx * rows);
        await M.img.parallel(rows, 8, async (r) => {
          const bytes = await src.read(ds.mrc.dataOffset + r * step * plane + y * rowBytes, rowBytes, { cache: false });
          data.set(M.img.toFloat(bytes, t, H.nx, ds.mrc.le), r * H.nx);
        });
        const img = M.img.shrinkX(data, H.nx, rows, Math.min(H.nx, 512));
        return { canvas: M.img.grayCanvas(M.img.shrink(img.data, img.w, img.h, 512), { flipY }), note: `central slice (Y = ${y})` };
      }
      z = Math.floor(H.nz / 2); note = `central slice (Z = ${z + 1} of ${H.nz})`;
    } else if (ds.kind === 'movie') note = `frame 1 of ${H.nz}`;
    const img = await M.img.readPlane(src, { offset: ds.mrc.dataOffset + z * plane, width: H.nx, height: H.ny, type: t, le: ds.mrc.le }, 512);
    return { canvas: M.img.grayCanvas(img, { flipY }), note };
  }

  M.registerFormat({
    id: 'mrc', name: 'MRC', modality: 'EM',
    extensions: ['mrc', 'mrcs', 'st', 'ali', 'preali', 'rec', 'map', 'ccp4', 'sub'],
    sniff, parse,
  });
  M.mrc = { FEI, readFEISection, seriFloat };
})();
