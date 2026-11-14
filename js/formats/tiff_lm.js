/* EasyMeta - light-microscopy TIFF flavours:
 *   Zeiss LSM (CZ_LSMINFO tag with ScanInformation tracks/lasers/detectors)
 *   OME-TIFF (OME-XML in ImageDescription)
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const T = () => M.TIFF;
  const X = () => M.xml;

  // ------------------------------------------------------------------ LSM
  const SCAN_ARRAYS = { 0x20000000: 'Tracks', 0x30000000: 'Lasers', 0x60000000: 'DetectionChannels', 0x80000000: 'IlluminationChannels', 0xa0000000: 'BeamSplitters', 0xc0000000: 'DataChannels', 0x11000000: 'Timers', 0x13000000: 'Markers' };
  const SCAN_STRUCTS = { 0x40000000: 'Track', 0x50000000: 'Laser', 0x70000000: 'DetectionChannel', 0x90000000: 'IlluminationChannel', 0xb0000000: 'BeamSplitter', 0xd0000000: 'DataChannel', 0x12000000: 'Timer', 0x14000000: 'Marker' };
  const SCAN_ATTR = {
    0x10000001: 'Name', 0x10000002: 'Description', 0x10000003: 'Notes', 0x10000004: 'Objective', 0x10000005: 'ProcessingSummary',
    0x10000006: 'SpecialScanMode', 0x10000007: 'ScanType', 0x10000008: 'ScanMode', 0x10000009: 'NumberOfStacks',
    0x1000000a: 'LinesPerPlane', 0x1000000b: 'SamplesPerLine', 0x1000000c: 'PlanesPerVolume', 0x10000013: 'ScanDirection',
    0x10000014: 'TimeSeries', 0x10000016: 'ZoomX', 0x10000017: 'ZoomY', 0x10000018: 'ZoomZ', 0x1000001c: 'SampleSpacing',
    0x1000001d: 'LineSpacing', 0x1000001e: 'PlaneSpacing', 0x10000034: 'Rotation', 0x10000036: 'Sample0time', 0x10000047: 'User',
    0x10000052: 'CameraBinning', 0x10000060: 'RtZoom',
    0x40000001: 'MultiplexType', 0x40000002: 'MultiplexOrder', 0x40000003: 'SamplingMode', 0x40000004: 'SamplingMethod',
    0x40000005: 'SamplingNumber', 0x40000006: 'Acquire', 0x40000007: 'SampleObservationTime', 0x4000000b: 'TimeBetweenStacks',
    0x4000000c: 'Name', 0x40000019: 'PixelTime', 0x40000037: 'IdTubelens',
    0x50000001: 'Name', 0x50000002: 'Acquire', 0x50000003: 'Power',
    0x70000001: 'IntegrationMode', 0x70000002: 'SpecialMode', 0x70000003: 'DetectorGainFirst', 0x70000004: 'DetectorGainLast',
    0x70000005: 'AmplifierGainFirst', 0x70000006: 'AmplifierGainLast', 0x70000007: 'AmplifierOffsFirst', 0x70000008: 'AmplifierOffsLast',
    0x70000009: 'PinholeDiameter', 0x7000000a: 'CountingTrigger', 0x7000000b: 'Acquire', 0x7000000c: 'PointDetectorName',
    0x7000000d: 'AmplifierName', 0x7000000e: 'PinholeName', 0x7000000f: 'FilterSetName', 0x70000010: 'FilterName',
    0x70000013: 'IntegratorName', 0x70000014: 'ChannelName', 0x70000021: 'SpectralScanChannels', 0x70000022: 'SpiWavelengthStart',
    0x70000023: 'SpiWavelengthStop', 0x70000026: 'DyeName', 0x70000027: 'DyeFolder',
    0x90000001: 'Name', 0x90000002: 'Power', 0x90000003: 'Wavelength', 0x90000004: 'Aquire', 0x90000005: 'DetchannelName',
    0xb0000001: 'FilterSet', 0xb0000002: 'Filter', 0xb0000003: 'Name',
    0xd0000001: 'Name', 0xd0000003: 'Acquire', 0xd0000004: 'Color', 0xd0000005: 'SampleType', 0xd0000006: 'BitsPerSample',
    0xd0000014: 'DyeName', 0xd0000015: 'DyeFolder',
    0x12000001: 'Name', 0x12000002: 'Description', 0x12000003: 'Interval', 0x14000001: 'Name', 0x14000002: 'Description',
  };

  async function scanInfo(src, offset) {
    const head = await src.bin(offset, 12, true);
    if (head.U32(0) !== 0x10000000) return null;
    // read generously; the block is small
    const b = await src.bin(offset + 12, 512 * 1024, true);
    let block = {};
    const stack = [block];
    const root = block;
    let guard = 0;
    while (b.left >= 12 && guard++ < 100000) {
      const entry = b.u32(), type = b.u32(), size = b.u32();
      let value = null;
      if (type === 2) value = M.cstr(b.bytes(size));
      else if (type === 4) { value = b.i32(); if (size > 4) b.skip(size - 4); }
      else if (type === 5) { value = b.f64(); if (size > 8) b.skip(size - 8); }
      else b.skip(size);
      if (SCAN_ARRAYS[entry]) {
        stack.push(block);
        const list = [];
        block[SCAN_ARRAYS[entry]] = list;
        block = list;
      } else if (SCAN_STRUCTS[entry]) {
        stack.push(block);
        const o = {};
        block.push(o);
        block = o;
      } else if (entry === 0xffffffff) {
        block = stack.pop();
        if (!stack.length) break;
      } else if (!Array.isArray(block)) {
        block[SCAN_ATTR[entry] || 'Entry0x' + entry.toString(16)] = value;
      }
    }
    return root;
  }

  function parseLsmInfo(b) {
    const size = b.I32(4);
    const g = (o, f) => (o + 8 <= size ? f(o) : null);
    return {
      MagicNumber: b.U32(0), StructureSize: size,
      DimensionX: b.I32(8), DimensionY: b.I32(12), DimensionZ: b.I32(16), DimensionChannels: b.I32(20), DimensionTime: b.I32(24),
      DataType: b.I32(28), ThumbnailX: b.I32(32), ThumbnailY: b.I32(36),
      VoxelSizeX: b.F64(40), VoxelSizeY: b.F64(48), VoxelSizeZ: b.F64(56),
      OriginX: b.F64(64), OriginY: b.F64(72), OriginZ: b.F64(80),
      ScanType: b.U16(88), SpectralScan: b.U16(90), TypeOfData: b.U32(92),
      OffsetChannelColors: b.U32(108), TimeIntervall: b.F64(112), OffsetScanInformation: b.U32(124),
      OffsetTimeStamps: b.U32(132), OffsetEventList: b.U32(136),
      OffsetChannelWavelength: g(204, (o) => b.U32(o)), ObjectiveSphereCorrection: g(212, (o) => b.F64(o)),
      DimensionP: g(272, (o) => b.I32(o)), DimensionM: g(276, (o) => b.I32(o)),
    };
  }

  async function channelColors(src, off) {
    const b = await src.bin(off, 24, true);
    const size = b.U32(0), nc = b.U32(4), nn = b.U32(8), coff = b.U32(12), noff = b.U32(16);
    if (nc !== nn || nc > 64) return null;
    const all = await src.bin(off, size, true);
    const colors = [];
    for (let i = 0; i < nc; i++) colors.push(M.hex([all.U8(coff + i * 4), all.U8(coff + i * 4 + 1), all.U8(coff + i * 4 + 2)]));
    const names = [];
    let p = noff;
    while (p + 4 < size && names.length < nn) {
      const ns = all.U32(p);
      names.push(M.cstr(all.u.subarray(p + 4, p + 4 + ns)));
      p += 4 + ns;
    }
    return { colors, names };
  }

  const filterBand = (s) => {
    const m = String(s || '').match(/(BP|LP|SP)\s*(\d{3})(?:\s*-\s*(\d{3}))?/i);
    if (!m) return null;
    if (/BP/i.test(m[1]) && m[3]) return [+m[2], +m[3]];
    if (/LP/i.test(m[1])) return [+m[2], Math.max(+m[2] + 150, 750)];
    if (/SP/i.test(m[1])) return [Math.min(400, +m[2] - 100), +m[2]];
    return null;
  };
  M.filterBand = filterBand;

  M.registerTiffFlavor({
    id: 'lsm', name: 'Zeiss LSM', modality: 'LM',
    match: (t) => (t.ifd0.tags.has(34412) ? 1 : 0),
    async parse(tiff, ds) {
      const src = tiff.src;
      ds.modality = 'LM';
      ds.format.detail = 'Zeiss LSM (TIFF)';
      const e = tiff.ifd0.tags.get(34412);
      const off = e.offset !== undefined ? e.offset : 0;
      const head = await src.bin(off, 8, true);
      const info = parseLsmInfo(await src.bin(off, Math.max(head.I32(4), 224), true));
      ds.dims = { x: info.DimensionX, y: info.DimensionY, z: info.DimensionZ || 1, c: info.DimensionChannels || 1, t: info.DimensionTime || 1, s: info.DimensionP || 1, m: info.DimensionM || 1 };
      ds.pixel = { x: info.VoxelSizeX || null, y: info.VoxelSizeY || null, z: ds.dims.z > 1 ? info.VoxelSizeZ : null, source: 'LSM info' };
      if (ds.dims.t > 1 && info.TimeIntervall) ds.timeInterval = info.TimeIntervall;
      ds.pixelType = { 1: '8-bit', 2: '12-bit', 5: '32-bit float' }[info.DataType] || ds.pixelType;
      const lm = M.ensureLM(ds);
      lm.mode = info.ScanType === 0 || info.ScanType === 3 || info.ScanType === 6 ? 'Confocal (laser scanning)' : 'Laser scanning';
      ds.instrument.manufacturer = 'Carl Zeiss';
      ds.instrument.model = 'LSM';
      const cc = info.OffsetChannelColors ? await channelColors(src, info.OffsetChannelColors) : null;
      let si = null;
      if (info.OffsetScanInformation) si = await scanInfo(src, info.OffsetScanInformation);
      let ranges = null;
      if (info.OffsetChannelWavelength) {
        const wb = await src.bin(info.OffsetChannelWavelength, 4, true);
        const n = wb.I32(0);
        if (n > 0 && n < 64) {
          const r = await src.bin(info.OffsetChannelWavelength + 4, n * 16, true);
          ranges = M.range(n).map((i) => [r.F64(i * 16), r.F64(i * 16 + 8)].map((v) => (v < 1e-3 ? v * 1e9 : v)));
        }
      }
      if (si) {
        ds.raw['LSM scan information'] = si;
        const obj = si.Objective || '';
        lm.objective.name = obj || null;
        const om = obj.match(/(\d+(?:\.\d+)?)x\s*\/\s*(\d\.\d+)/i);
        if (om) { lm.objective.mag = +om[1]; lm.objective.na = +om[2]; }
        const imm = obj.match(/\b(Oil|Water|W|Glyc|Imm|Air)\b/i);
        if (imm) lm.objective.immersion = { W: 'Water', Glyc: 'Glycerol', Imm: 'Multi-immersion' }[imm[1]] || M.cap(imm[1].toLowerCase());
        lm.objective.correction = (obj.match(/(Plan-Apochromat|C-Apochromat|LCI Plan-Neofluar|EC Plan-Neofluar|Plan-Neofluar|Fluar|Achroplan)/i) || [])[0] || null;
        lm.scan.zoom = si.ZoomX || null;
        ds.operator = si.User || null;
        ds.title = si.Name || ds.title;
        if (si.Sample0time) ds.acquired = M.oleDate(si.Sample0time);
        for (const [ti, tr] of (si.Tracks || []).entries()) {
          if (tr.Acquire === 0) continue;
          // the per-laser "Aquire" flag is often 0 even for lasers in use; then take every laser with power
          const ills = (tr.IlluminationChannels || []).filter((l) => M.num(l.Wavelength));
          let lasers = ills.filter((l) => l.Aquire !== 0);
          if (!lasers.length) lasers = ills.filter((l) => !M.isNum(l.Power) || l.Power > 0);
          if (tr.PixelTime && !lm.scan.pixelTime) lm.scan.pixelTime = tr.PixelTime * 1e-6;
          for (const dc of tr.DetectionChannels || []) {
            if (dc.Acquire === 0) continue;
            const ch = { name: dc.ChannelName || dc.PointDetectorName || `Ch${lm.channels.length + 1}`, track: ti + 1 };
            ch.exLines = M.unique(lasers.map((l) => Math.round(M.num(l.Wavelength))));
            const pw = lasers.map((l) => (M.isNum(l.Power) ? `${M.fmt.num(l.Power, 1)} %` : null)).filter(Boolean);
            if (pw.length) ch.power = pw.join(', ');
            ch.detector = { name: dc.PointDetectorName || dc.ChannelName, gain: dc.DetectorGainFirst, offset: dc.AmplifierOffsFirst };
            if (M.isNum(dc.PinholeDiameter)) ch.pinholeUm = dc.PinholeDiameter;
            const sStart = M.num(dc.SpiWavelengthStart), sStop = M.num(dc.SpiWavelengthStop);
            if (sStart && sStop && sStop > sStart) ch.emBand = [sStart < 1e-3 ? sStart * 1e9 : sStart, sStop < 1e-3 ? sStop * 1e9 : sStop];
            if (!ch.emBand) ch.emBand = filterBand(dc.FilterName);
            ch.filterSet = dc.FilterName || dc.FilterSetName || null;
            if (dc.DyeName) ch.dye = dc.DyeName;
            lm.channels.push(ch);
          }
        }
        // data channels, in track order (their Acquire flag is unreliable, so keep one per acquired track)
        const datach = [];
        for (const tr of si.Tracks || []) if (tr.Acquire !== 0) for (const d of tr.DataChannels || []) datach.push(d);
        datach.slice(0, lm.channels.length || datach.length).forEach((d, i) => {
          if (!lm.channels[i]) lm.channels[i] = { name: d.Name };
          if (d.DyeName && !lm.channels[i].dye) lm.channels[i].dye = d.DyeName;
          if (M.isNum(d.Color) && !lm.channels[i].color) lm.channels[i].color = M.hex([d.Color & 255, (d.Color >> 8) & 255, (d.Color >> 16) & 255]);
        });
      }
      // keep exactly the stored channel count
      lm.channels = lm.channels.slice(0, ds.dims.c);
      while (lm.channels.length < ds.dims.c) lm.channels.push({ name: `Ch${lm.channels.length + 1}` });
      // ChannelColors is stored per saved channel, so it wins over the track data
      if (cc) cc.colors.forEach((c, i) => { if (lm.channels[i]) { lm.channels[i].color = c; if (cc.names[i]) lm.channels[i].name = cc.names[i]; } });
      if (ranges) ranges.forEach((r, i) => { if (lm.channels[i] && !lm.channels[i].emBand && r[1] > r[0]) lm.channels[i].emBand = r; });
      // pinhole in Airy units from the pinhole diameter (LSM 5xx/7xx pinhole plane magnification is not stored)
      const z = ds.dims.z, t = ds.dims.t;
      ds.kind = z > 1 && t > 1 ? 'hyperstack' : z > 1 ? 'zstack' : t > 1 ? 'timelapse' : 'image';
      ds.raw['CZ_LSMINFO'] = info;
      if (cc) ds.raw['LSM channel colours'] = cc;
      M.addSource(ds, 'LSM info + scan information');
      ds.thumbnail = async () => {
        // LSM files store a small RGB thumbnail as the second page
        if (tiff.ifd0.next) {
          const ifd1 = await T().readIFD(tiff, tiff.ifd0.next);
          const st = await T().value(tiff, ifd1, 254);
          if (st === 1) {
            const c = await M.img.tiffPlane(tiff, ifd1, { rgb: true });
            if (c) return { canvas: M.img.scaleCanvas(c, 512), note: 'thumbnail stored by ZEN' };
          }
        }
        const c = await M.img.tiffPlane(tiff, tiff.ifd0);
        return c ? { canvas: c, note: 'first plane, first channel' } : null;
      };
    },
  });

  // ------------------------------------------------------------------ OME-TIFF
  const OME_UNITS = { 'µm': 1e-6, um: 1e-6, nm: 1e-9, mm: 1e-3, m: 1, Å: 1e-10, pm: 1e-12, cm: 1e-2 };
  const omeLen = (v, u) => { const n = M.num(v); return n === null ? null : n * (OME_UNITS[u || 'µm'] || 1e-6); };
  const omeColor = (v) => { const n = M.num(v); if (n === null) return null; const c = n >>> 0; return M.hex([(c >>> 24) & 255, (c >>> 16) & 255, (c >>> 8) & 255]); };

  /** Fill a dataset from an OME-XML document (image `idx`).  Exported for other readers. */
  function applyOME(ds, doc, idx) {
    const images = X().all(doc, 'Image');
    const img = images[Math.min(idx || 0, images.length - 1)];
    if (!img) return;
    if (images.length > 1) { ds.series = images.map((im, i) => ({ index: i, name: im.getAttribute('Name') || `Image ${i + 1}` })); ds.seriesIndex = idx || 0; }
    ds.title = img.getAttribute('Name') || ds.title;
    const px = X().kid(img, 'Pixels');
    const a = (k) => px.getAttribute(k);
    ds.dims = { x: M.num(a('SizeX')), y: M.num(a('SizeY')), z: M.num(a('SizeZ')) || 1, c: M.num(a('SizeC')) || 1, t: M.num(a('SizeT')) || 1 };
    ds.pixelType = a('Type') || '';
    ds.bits = M.num(a('SignificantBits'));
    ds.pixel = { x: omeLen(a('PhysicalSizeX'), a('PhysicalSizeXUnit')), y: omeLen(a('PhysicalSizeY'), a('PhysicalSizeYUnit')), z: omeLen(a('PhysicalSizeZ'), a('PhysicalSizeZUnit')), source: 'OME-XML' };
    if (M.num(a('TimeIncrement'))) ds.timeInterval = M.num(a('TimeIncrement')) * ({ ms: 1e-3, s: 1, min: 60 }[a('TimeIncrementUnit') || 's'] || 1);
    const date = X().text(X().kid(img, 'AcquisitionDate'));
    if (date) ds.acquired = M.parseDate(date);
    const lm = M.ensureLM(ds);
    const instRef = X().kid(img, 'InstrumentRef');
    const instruments = X().all(doc, 'Instrument');
    const inst = (instRef && instruments.find((i) => i.getAttribute('ID') === instRef.getAttribute('ID'))) || instruments[0];
    if (inst) {
      const mic = X().kid(inst, 'Microscope');
      if (mic) { ds.instrument.manufacturer = mic.getAttribute('Manufacturer'); ds.instrument.model = mic.getAttribute('Model'); lm.stand = mic.getAttribute('Type'); }
      const objSet = X().kid(img, 'ObjectiveSettings');
      const objs = X().kids(inst, 'Objective');
      const obj = (objSet && objs.find((o) => o.getAttribute('ID') === objSet.getAttribute('ID'))) || objs[0];
      if (obj) {
        const g = (k) => obj.getAttribute(k);
        lm.objective = { name: g('Model') || null, manufacturer: g('Manufacturer'), mag: M.num(g('NominalMagnification')), na: M.num(g('LensNA')), immersion: g('Immersion'), correction: g('Correction'), workingDistance: omeLen(g('WorkingDistance'), g('WorkingDistanceUnit')) };
        if (objSet) { lm.objective.refractiveIndex = M.num(objSet.getAttribute('RefractiveIndex')); lm.objective.medium = objSet.getAttribute('Medium'); }
      }
      var lasers = {};
      for (const ls of X().kids(inst, 'Laser').concat(X().kids(inst, 'LightEmittingDiode'), X().kids(inst, 'GenericExcitationSource'), X().kids(inst, 'Arc'), X().kids(inst, 'Filament'))) lasers[ls.getAttribute('ID')] = M.num(ls.getAttribute('Wavelength'));
      var dets = {};
      for (const d of X().kids(inst, 'Detector')) dets[d.getAttribute('ID')] = { name: d.getAttribute('Model') || d.getAttribute('ID'), type: d.getAttribute('Type') };
      var filters = {};
      for (const f of X().kids(inst, 'Filter')) {
        const tr = X().kid(f, 'TransmittanceRange');
        filters[f.getAttribute('ID')] = { name: f.getAttribute('Model') || f.getAttribute('ID'), band: tr ? [M.num(tr.getAttribute('CutIn')), M.num(tr.getAttribute('CutOut'))] : null };
      }
    }
    for (const c of X().kids(px, 'Channel')) {
      const g = (k) => c.getAttribute(k);
      const ch = { name: g('Name') || g('ID'), dye: g('Fluor'), color: omeColor(g('Color')), exPeak: M.num(g('ExcitationWavelength')), emPeak: M.num(g('EmissionWavelength')), mode: g('AcquisitionMode'), contrast: g('ContrastMethod'), illumination: g('IlluminationType') };
      const ph = M.num(g('PinholeSize'));
      if (ph) ch.pinholeUm = ph;
      const lss = X().kid(c, 'LightSourceSettings');
      if (lss) {
        const wl = M.num(lss.getAttribute('Wavelength')) || (lasers && lasers[lss.getAttribute('ID')]);
        if (wl) ch.exLines = [Math.round(wl)];
        const att = M.num(lss.getAttribute('Attenuation'));
        if (att !== null && att >= 0 && att <= 1) ch.power = `${M.fmt.num((1 - att) * 100, 1)} %`; // fraction blocked
      }
      const dset = X().kid(c, 'DetectorSettings');
      if (dset) ch.detector = Object.assign({}, dets && dets[dset.getAttribute('ID')], { gain: M.num(dset.getAttribute('Gain')), offset: M.num(dset.getAttribute('Offset')) });
      const lp = X().kid(c, 'LightPath');
      if (lp && filters) {
        const ex = X().kids(lp, 'ExcitationFilterRef').map((r) => filters[r.getAttribute('ID')]).find((f) => f && f.band && f.band[0]);
        const em = X().kids(lp, 'EmissionFilterRef').map((r) => filters[r.getAttribute('ID')]).find((f) => f && f.band && f.band[0]);
        if (ex) ch.exBand = ex.band;
        if (em) ch.emBand = em.band;
      }
      lm.channels.push(ch);
    }
    const plane0 = X().kid(px, 'Plane');
    if (plane0) {
      const et = M.num(plane0.getAttribute('ExposureTime'));
      if (et) lm.channels.forEach((c) => { c.exposure = c.exposure || et * ({ ms: 1e-3, s: 1, 'µs': 1e-6 }[plane0.getAttribute('ExposureTimeUnit') || 's'] || 1); });
    }
    const modes = lm.channels.map((c) => c.mode).filter(Boolean);
    if (modes.length) lm.mode = M.mostCommon(modes);
    M.setStackKind(ds);
  }

  M.registerTiffFlavor({
    id: 'ome-tiff', name: 'OME-TIFF', modality: 'LM',
    match: (t) => (/<OME[\s>]/.test(t.description || '') ? 0.95 : 0),
    async parse(tiff, ds, ctx) {
      ds.modality = 'LM';
      const doc = X().parse(tiff.description);
      ds.rawText['OME-XML.xml'] = tiff.description;
      applyOME(ds, doc, ctx.seriesIndex || 0);
      const creator = doc.documentElement.getAttribute('Creator');
      if (creator) ds.instrument.software = creator;
      ds.raw['OME-XML'] = doc.documentElement;
      M.addSource(ds, 'OME-XML');
    },
  });
  M.applyOME = applyOME;
})();
