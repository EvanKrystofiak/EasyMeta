/* EasyMeta - Olympus/Evident FluoView OIB (OLE2 container) and OIF (INI file).
 * Both carry the same UTF-16 INI metadata; OIB also packs one TIFF per plane.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const unq = (s) => (s === undefined || s === null ? null : String(s).replace(/^"(.*)"$/, '$1').trim());
  const textOf = (bytes) => {
    const utf16 = bytes.length > 1 && (bytes[1] === 0 || (bytes[0] === 0xff && bytes[1] === 0xfe));
    return M.decodeText(bytes, utf16 ? 'utf-16le' : 'utf-8').replace(/^﻿/, '');
  };

  /** Fill the dataset from the FluoView INI. */
  function applyFluoView(ds, ini) {
    ds.modality = 'LM';
    const lm = M.ensureLM(ds);
    ds.instrument.manufacturer = 'Olympus';
    const ver = ini['Version Info'] || {};
    ds.instrument.model = unq(ver.SystemName) || 'FluoView';
    ds.instrument.software = 'FluoView' + (unq(ver.SystemVersion) ? ' ' + unq(ver.SystemVersion) : '');
    const acq = ini['Acquisition Parameters Common'] || {};
    const gen = ini.General || {};
    const date = unq(acq.ImageCaputreDate || acq.ImageCaptureDate || gen.ImageCaputreDate);
    if (date) ds.acquired = M.parseDate(date.replace(/'/g, '')) || date;
    // axes
    const axes = {};
    for (const [sec, kv] of Object.entries(ini)) {
      if (!/^Axis \d+ Parameters Common$/.test(sec)) continue;
      const code = unq(kv.AxisCode);
      if (!code) continue;
      axes[code] = { n: M.num(kv.MaxSize), start: M.num(unq(kv.StartPosition)), end: M.num(unq(kv.EndPosition)), unit: unq(kv.PixUnit) || unq(kv.UnitName) || 'um', interval: M.num(unq(kv.Interval)) };
    }
    const n = (a) => (axes[a] && axes[a].n > 0 ? axes[a].n : 1);
    ds.dims = { x: n('X'), y: n('Y'), z: n('Z'), c: n('C'), t: n('T') };
    const ref = ini['Reference Image Parameter'] || {};
    const wconv = M.num(ref.WidthConvertValue), hconv = M.num(ref.HeightConvertValue);
    const unit = unq(ref.WidthUnit) || 'um';
    if (wconv) ds.pixel = { x: M.toMeters(wconv, unit), y: M.toMeters(hconv || wconv, unit), source: 'FluoView reference image' };
    else if (axes.X && axes.X.n && M.isNum(axes.X.end)) ds.pixel = { x: M.toMeters(Math.abs(axes.X.end - axes.X.start) / axes.X.n, axes.X.unit), y: null, source: 'FluoView axis' };
    if (axes.Z && axes.Z.n > 1) {
      const step = M.isNum(axes.Z.interval) && axes.Z.interval ? axes.Z.interval : Math.abs(axes.Z.end - axes.Z.start) / (axes.Z.n - 1);
      // Z interval is written in nm on most systems
      const u = axes.Z.unit === 'nm' || step > 50 ? 'nm' : axes.Z.unit;
      ds.pixel.z = M.toMeters(Math.abs(step), u);
    }
    if (axes.T && axes.T.n > 1 && M.isNum(axes.T.interval)) ds.timeInterval = axes.T.interval / 1000;
    ds.bits = M.num(ref.ValidBitCounts) || null;
    // objective
    const o = lm.objective;
    o.name = unq(acq['ObjectiveLens Name'] || acq.ObjectiveLensName || (ini['Acquisition Parameters Common'] || {})['Objective Lens']);
    o.mag = M.num(unq(acq.Magnification));
    o.na = M.num(unq(acq['ObjectiveLens NAValue']));
    o.workingDistance = M.num(unq(acq['ObjectiveLens WDValue'])) ? M.num(unq(acq['ObjectiveLens WDValue'])) * 1e-3 : null;
    o.refractiveIndex = M.num(unq(acq['ObjectiveLens Refractive Index'] || acq.RefractiveIndex));
    if (o.name) {
      const imm = o.name.match(/(Oil|W|Water|Sil|Glyc|Air)\b/i);
      if (imm) o.immersion = { W: 'Water', Sil: 'Silicone', Glyc: 'Glycerol' }[imm[1]] || M.cap(imm[1].toLowerCase());
      if (!o.mag) { const m = o.name.match(/(\d+)\s*X/i); if (m) o.mag = +m[1]; }
    }
    lm.scan.zoom = M.num(unq(acq.ZoomValue));
    lm.scan.pixelTime = M.num(unq(acq.PixelRate)) ? M.num(unq(acq.PixelRate)) * 1e-6 : null;
    lm.mode = 'Confocal (laser scanning)';
    // lasers
    const lasers = [];
    for (const [sec, kv] of Object.entries(ini)) {
      if (!/^Laser \d+ Parameters$/.test(sec)) continue;
      const wl = M.num(unq(kv.LaserWavelength)), on = unq(kv['Laser Enable']);
      if (wl && on !== '0') lasers.push(wl);
    }
    // channels
    for (let i = 1; i <= ds.dims.c; i++) {
      const kv = ini[`Channel ${i} Parameters`] || {};
      const ch = { name: unq(kv['CH Name']) || unq(kv.DyeName) || `CH${i}` };
      ch.dye = unq(kv.DyeName) || null;
      const ex = M.num(unq(kv.ExcitationWavelength)), em = M.num(unq(kv.EmissionWavelength));
      if (ex) ch.exLines = [ex];
      else if (lasers.length) ch.exLines = lasers.slice();
      if (em) ch.emPeak = em;
      const lo = M.num(unq(kv['Em Start'] || kv.EmissionStart)), hi = M.num(unq(kv['Em End'] || kv.EmissionEnd));
      if (lo && hi) ch.emBand = [lo, hi];
      ch.detector = { name: unq(kv.DetectorName) || 'PMT', gain: M.num(unq(kv.AnalogPMTGain)), voltage: M.num(unq(kv.AnalogPMTVoltage)), offset: M.num(unq(kv.AnalogPMTOffset)) };
      const ph = M.num(unq(acq['PinholeDiameter'] || kv.PinholeDiameter));
      if (ph) ch.pinholeUm = ph > 1000 ? ph / 1000 : ph;
      lm.channels.push(ch);
    }
    M.setStackKind(ds);
  }

  async function parseOIB(src, ctx) {
    const ds = M.newDataset(src, this);
    const ole = await new M.OLE(src).open();
    ds.format.detail = `OIB (OLE2, ${ole.sectorSize}-byte sectors)`;
    const infoE = ole.find('OibInfo.txt');
    if (!infoE) throw new Error('OibInfo.txt not found in this OIB');
    const oibInfo = M.parseIni(textOf(await ole.read(infoE)));
    // "StreamNNNNN=<original file name>" lines; FluoView versions put them in different sections
    const streams = {};
    for (const sec of Object.values(oibInfo)) for (const [k, v] of Object.entries(sec)) if (/^Stream\d+$/i.test(k)) streams[k] = v;
    const mainName = unq((oibInfo.OibSaveInfo || {}).MainFileName) || 'Stream00000';
    const mainE = ole.find(mainName);
    if (!mainE) throw new Error('Main OIF stream not found');
    const text = textOf(await ole.read(mainE));
    const ini = M.parseIni(text);
    applyFluoView(ds, ini);
    ds.raw['FluoView metadata'] = ini;
    ds.raw['OIB contents'] = streams;
    ds.rawText['main.oif'] = text;
    M.addSource(ds, 'FluoView INI (in OIB)');
    ds.thumbnail = async () => {
      // FluoView stores a small BMP thumbnail; use it when present
      const thumbKey = Object.keys(streams).find((k) => /_Thumb\.bmp$/i.test(unq(streams[k])));
      const te = thumbKey && ole.find(thumbKey);
      if (te) {
        const c = await M.img.encodedCanvas(await ole.read(te), 'image/bmp');
        if (c) return { canvas: c, note: 'thumbnail stored by FluoView' };
      }
      // otherwise one TIFF per plane, e.g. ..._C001Z012.tif or s_C001.tif
      const zMid = Math.floor((ds.dims.z || 1) / 2) + 1;
      const chs = [];
      for (let c = 1; c <= Math.min(ds.dims.c || 1, 4); c++) {
        const want = new RegExp(`_C0*${c}(Z0*${zMid})?(T0*1)?\\.tif$`, 'i');
        const key = Object.keys(streams).find((k) => want.test(unq(streams[k])));
        const e = key && ole.find(key);
        if (!e) continue;
        const bytes = await ole.read(e);
        const fs = M.FileSource.fromFile(new File([bytes], 'plane.tif'));
        const tiff = await M.TIFF.open(fs);
        const L = await M.TIFF.layout(tiff, tiff.ifd0);
        const off = [].concat(await M.TIFF.value(tiff, tiff.ifd0, 273))[0];
        if (L.compression !== 1) continue;
        const img = await M.img.readPlane(fs, { offset: off, width: L.width, height: L.height, type: L.bits > 8 ? 'u16' : 'u8', le: tiff.le }, 512);
        chs.push(Object.assign(img, { color: ds.lm.channels[c - 1].color || (ds.dims.c === 1 ? '#ffffff' : ['#40ff40', '#ff4040', '#4080ff', '#ffffff'][c - 1]) }));
      }
      if (!chs.length) return null;
      return { canvas: chs.length === 1 ? M.img.grayCanvas(chs[0]) : M.img.compositeCanvas(chs), note: ds.dims.z > 1 ? `Z ${zMid} of ${ds.dims.z}` : 'image' };
    };
    return ds;
  }

  M.registerFormat({
    id: 'oib', name: 'Olympus OIB', modality: 'LM', extensions: ['oib'],
    sniff: (h, ext) => (h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0 ? (ext === 'oib' ? 0.8 : 0.3) : 0),
    parse: parseOIB,
  });
  M.registerFormat({
    id: 'oif', name: 'Olympus OIF', modality: 'LM', extensions: ['oif'],
    sniff(h, ext) {
      if (ext !== 'oif') return 0;
      return /FileInformation|Acquisition Parameters|Version Info/.test(textOf(h)) ? 0.8 : 0.3;
    },
    async parse(src) {
      const ds = M.newDataset(src, this);
      const text = textOf(await src.read(0, src.size));
      const ini = M.parseIni(text);
      applyFluoView(ds, ini);
      ds.format.detail = 'OIF metadata file (images are in the .oif.files folder)';
      ds.raw['FluoView metadata'] = ini;
      ds.rawText['metadata.oif'] = text;
      M.addSource(ds, 'FluoView INI');
      return ds;
    },
  });
})();
