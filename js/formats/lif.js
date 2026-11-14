/* EasyMeta - Leica LIF (LAS X / LAS AF projects).  The XML header lists every
 * image ("series") with its dimensions, channels and hardware settings; a LIF
 * usually holds many series, so EasyMeta offers a series picker.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const X = () => M.xml;
  const DIM_NAMES = { 1: 'x', 2: 'y', 3: 'z', 4: 't', 5: 'λ', 6: 'rotation', 7: 'xt', 8: 'tslice', 9: 'tslice', 10: 'm' };
  const LUT_COLORS = { red: '#ff3b30', green: '#34c759', blue: '#3d7dff', cyan: '#00e5ff', magenta: '#ff2bd6', yellow: '#ffd60a', gray: '#dddddd', grey: '#dddddd' };

  async function header(src) {
    const b = await src.bin(0, 13, true);
    if (b.U32(0) !== 0x70 || b.U8(8) !== 0x2a) throw new Error('Not a LIF file');
    const nChars = b.U32(9);
    const xml = await src.text(13, nChars * 2, 'utf-16le');
    return { xml, end: 13 + nChars * 2 };
  }

  /** Map MemoryBlockID -> data offset by walking the block headers. */
  async function memoryBlocks(src, start, version) {
    const out = new Map();
    let p = start, guard = 0;
    while (p + 9 < src.size && guard++ < 20000) {
      const b = await src.bin(p, 32, true, { cache: false });
      if (b.U32(0) !== 0x70) break;
      let q = 8;
      if (b.U8(q) !== 0x2a) break;
      q += 1;
      const size = version >= 2 ? b.U64(q) : b.U32(q);
      q += version >= 2 ? 8 : 4;
      if (b.U8(q) !== 0x2a) break;
      q += 1;
      const nd = b.U32(q);
      q += 4;
      const id = M.decodeText(await src.read(p + q, nd * 2, { cache: false }), 'utf-16le');
      const data = p + q + nd * 2;
      out.set(id, { offset: data, size });
      p = data + size;
    }
    return out;
  }

  function seriesList(doc) {
    const out = [];
    const walk = (el, path) => {
      for (const child of X().kids(X().kid(el, 'Children'), 'Element')) {
        const name = child.getAttribute('Name') || '';
        const p = path ? path + ' / ' + name : name;
        const img = X().path(child, 'Data', 'Image');
        if (img) out.push({ name: p, el: child, image: img });
        walk(child, p);
      }
    };
    const root = X().one(doc, 'Element');
    if (root) walk(root, '');
    return out;
  }

  async function parse(src, ctx) {
    const ds = M.newDataset(src, this);
    ds.modality = 'LM';
    const { xml, end } = await header(src);
    const doc = X().parse(xml);
    const version = M.num(doc.documentElement.getAttribute('Version')) || 1;
    ds.format.detail = `LIF version ${version}`;
    ds.rawText['LIF header.xml'] = xml;
    const series = seriesList(doc);
    if (!series.length) throw new Error('No images in this LIF file');
    const si = Math.min(ctx.seriesIndex || 0, series.length - 1);
    ds.series = series.map((s, i) => ({ index: i, name: s.name }));
    ds.seriesIndex = si;
    const S = series[si];
    ds.title = S.name;
    const lm = M.ensureLM(ds);
    ds.instrument.manufacturer = 'Leica Microsystems';

    // dimensions
    const desc = X().kid(S.image, 'ImageDescription');
    const dims = {};
    const dimEls = X().kids(X().kid(desc, 'Dimensions'), 'DimensionDescription');
    for (const d of dimEls) {
      const id = M.num(d.getAttribute('DimID'));
      const n = M.num(d.getAttribute('NumberOfElements'));
      const len = M.num(d.getAttribute('Length'));
      const unit = d.getAttribute('Unit') || 'm';
      const key = DIM_NAMES[id] || 'd' + id;
      dims[key] = { n, len, unit, bytesInc: M.num(d.getAttribute('BytesInc')) };
    }
    const chEls = X().kids(X().kid(desc, 'Channels'), 'ChannelDescription');
    ds.dims = { x: dims.x ? dims.x.n : null, y: dims.y ? dims.y.n : 1, z: dims.z ? dims.z.n : 1, c: chEls.length || 1, t: dims.t ? dims.t.n : 1, m: dims.m ? dims.m.n : 1 };
    if (dims['λ']) ds.dims.lambda = dims['λ'].n;
    const size = (d) => (d && d.n > 1 && M.isNum(d.len) ? M.toMeters(Math.abs(d.len) / (d.n - 1), d.unit) : null);
    ds.pixel = { x: size(dims.x), y: size(dims.y) || size(dims.x), z: size(dims.z), source: 'LIF dimensions' };
    if (dims.t && dims.t.n > 1 && dims.t.len) ds.timeInterval = dims.t.len / (dims.t.n - 1);
    const res = chEls.map((c) => M.num(c.getAttribute('Resolution'))).filter(Boolean);
    ds.bits = res[0] || null;
    ds.pixelType = res[0] ? `${res[0] <= 8 ? 8 : 16}-bit container (${res[0]}-bit data)` : '';

    // hardware settings
    const atts = X().kids(S.image, 'Attachment');
    const hw = atts.find((a) => a.getAttribute('Name') === 'HardwareSetting') || X().one(S.image, 'ATLConfocalSettingDefinition') || X().one(S.image, 'ATLCameraSettingDefinition');
    const conf = hw && (hw.localName === 'ATLConfocalSettingDefinition' ? hw : X().one(hw, 'ATLConfocalSettingDefinition'));
    const camS = hw && (hw.localName === 'ATLCameraSettingDefinition' ? hw : X().one(hw, 'ATLCameraSettingDefinition'));
    const set = conf || camS;
    if (set) {
      const a = (k) => set.getAttribute(k);
      const o = lm.objective;
      o.name = (a('ObjectiveName') || '').replace(/\s+/g, ' ').trim() || null;
      // Leica's "Magnification" attribute is a system value (63x objective -> 66.15); take the objective's from its name
      const nameMag = (o.name || '').match(/(\d+(?:\.\d+)?)\s*x/i);
      o.mag = nameMag ? +nameMag[1] : M.num(a('Magnification'));
      if (M.num(a('Magnification')) && nameMag) lm.systemMag = M.num(a('Magnification'));
      o.na = M.num(a('NumericalAperture'));
      o.immersion = a('Immersion') ? M.cap(a('Immersion').toLowerCase()) : null;
      o.refractiveIndex = M.num(a('RefractionIndex'));
      ds.instrument.model = a('SystemTypeName') || a('MicroscopeModel') || null;
      lm.stand = a('MicroscopeModel') || null;
      if (conf) {
        lm.mode = 'Confocal (laser scanning)';
        lm.scan.zoom = M.num(a('Zoom'));
        lm.scan.speed = M.num(a('ScanSpeed'));
        lm.scan.lineAverage = M.num(a('LineAverage'));
        lm.scan.frameAverage = M.num(a('FrameAverage'));
        lm.scan.lineAccumulation = M.num(a('Line_Accumulation'));
        lm.scan.direction = a('ScanDirectionXName') || null;
        if (M.num(a('PixelDwellTime'))) lm.scan.pixelTime = M.num(a('PixelDwellTime'));
        lm.pinholeAU = M.num(a('PinholeAiry'));
        lm.pinholeUm = M.num(a('Pinhole')) ? M.num(a('Pinhole')) * 1e6 : null;
      } else {
        lm.mode = 'Widefield (camera)';
        lm.camera = a('CameraName') || null;
      }
      ds.instrument.serial = a('SystemSerialNumber') || null;
    }
    // system name (e.g. "STELLARIS 5", "TCS SP8") is an attribute of another settings element
    const sysEl = Array.from(S.image.getElementsByTagName('*')).find((e) => e.hasAttribute && e.hasAttribute('SystemTypeName'));
    const sysName = sysEl ? sysEl.getAttribute('SystemTypeName') : X().text(X().one(S.image, 'SystemTypeName'));
    if (sysName) ds.instrument.model = sysName.replace(/\b(STELLARIS)\b/, 'Stellaris');
    if (lm.stand && ds.instrument.model === lm.stand && sysName) ds.instrument.model = sysName;

    // channels.  Sequential acquisitions keep one ATLConfocalSettingDefinition per
    // sequence in LDM_Block_Sequential_List; newer LAS X also writes ChannelProperty
    // key/values per channel (DetectorName, DyeName, SequentialSettingIndex, ChannelType).
    const seqList = conf ? X().all(X().one(S.image, 'LDM_Block_Sequential_List'), 'ATLConfocalSettingDefinition') : [];
    const settingFor = (idx) => (seqList.length ? seqList[Math.min(Math.max(0, idx || 0), seqList.length - 1)] : conf);
    const lasersOf = (cf) => (cf ? X().all(cf, 'LaserLineSetting')
      .map((ll) => ({ wl: M.num(ll.getAttribute('LaserLine')), p: M.num(ll.getAttribute('IntensityDev')) }))
      .filter((l) => l.wl && l.p > 0) : []);
    const activeIn = (cf) => (cf ? X().all(cf, 'Detector').filter((d) => d.getAttribute('IsActive') === '1') : []);
    const wfInfo = camS ? X().all(camS, 'WideFieldChannelInfo') : [];
    let simultaneous = false;
    chEls.forEach((c, i) => {
      const lut = (c.getAttribute('LUTName') || '').toLowerCase();
      const ch = { name: `Channel ${i + 1}`, color: LUT_COLORS[lut] || null };
      const props = {};
      for (const p of X().kids(c, 'ChannelProperty')) props[X().text(X().kid(p, 'Key')) || ''] = X().text(X().kid(p, 'Value')) || '';
      const seqIdx = M.num(props.SequentialSettingIndex);
      if (seqIdx !== null) ch.track = seqIdx + 1;
      if (props.DyeName) ch.dye = props.DyeName.replace(/^Leica\//i, '').trim();
      const cf = conf ? settingFor(seqIdx) : null;
      let det = null;
      if (cf) {
        const active = activeIn(cf);
        det = props.DetectorName ? active.find((d) => d.getAttribute('Name') === props.DetectorName) || X().all(cf, 'Detector').find((d) => d.getAttribute('Name') === props.DetectorName) : activeIn(conf)[i];
        const ls = lasersOf(cf);
        if (ls.length) {
          ch.exLines = M.unique(ls.map((l) => Math.round(l.wl)));
          ch.power = ls.map((l) => `${Math.round(l.wl)} nm: ${M.fmt.auto(l.p)} %`).join(', ');
          if (ls.length > 1 && active.length > 1) simultaneous = true;
        }
      }
      if (det) {
        ch.detector = { name: det.getAttribute('Name'), type: det.getAttribute('Type'), gain: M.num(det.getAttribute('Gain')), offset: M.num(det.getAttribute('Offset')) };
        // sequence entries hold lasers/detectors only; the detection bands (Spectro) are in the main settings
        const withBands = [cf, conf].find((s) => s && X().all(s, 'MultiBand').length);
        const band = withBands ? X().all(withBands, 'MultiBand').find((b) => b.getAttribute('Channel') === det.getAttribute('Channel')) : null;
        if (band) {
          const lo = M.num(band.getAttribute('LeftWorld')), hi = M.num(band.getAttribute('RightWorld'));
          if (lo && hi) ch.emBand = [lo, hi];
          if (!ch.dye && band.getAttribute('DyeName')) ch.dye = band.getAttribute('DyeName');
        }
        ch.name = det.getAttribute('Name') + (ch.emBand ? ` ${Math.round(ch.emBand[0])}–${Math.round(ch.emBand[1])}` : '');
      } else if (props.DetectorName) ch.name = props.DetectorName;
      // FLIM-derived channels (Stellaris TauSense): same photons, shown as lifetime contrast or arrival time
      if (/MeanArrivalTime/i.test(props.ChannelType || '')) { ch.name += ' · lifetime (mean arrival time)'; ch.derived = true; }
      else if (/Lifetime/i.test(props.DigitalGatingMode || '')) { ch.name += ' · TauContrast'; ch.derived = true; }
      else if (/Gates/i.test(props.DigitalGatingMode || '')) ch.name += ' · TauGating';
      if (props.ChannelType && !ch.derived) ch.mode = M.words(props.ChannelType);
      const wf = wfInfo[i];
      if (wf) {
        const g = (k) => wf.getAttribute(k);
        ch.name = g('UserDefName') || g('ContrastingMethodName') || ch.name;
        ch.filterSet = g('FluoCubeName') || null;
        const em = M.num(g('EmissionWavelength')), ex = M.num(g('ExcitationWavelength'));
        if (em) ch.emPeak = em;
        if (ex) ch.exPeak = ex;
        const et = M.num(g('ExposureTime'));
        if (et) ch.exposure = et > 50 ? et / 1000 : et; // ms in newer files
        ch.mode = g('ContrastingMethodName') || null;
      }
      lm.channels.push(ch);
    });
    if (simultaneous && lm.channels.some((c) => !c.dye)) {
      M.note(ds, 'info', 'Several laser lines were on together; each channel lists all of them because the file names no dye to pick the exciting line.');
    }

    // dates: newer files list hex FILETIMEs in <TimeStampList>, older ones <TimeStamp HighInteger LowInteger>
    const tsl = X().one(S.image, 'TimeStampList');
    const firstHex = tsl ? (tsl.textContent.trim().split(/\s+/)[0] || '') : '';
    if (/^[0-9a-f]{8,16}$/i.test(firstHex)) {
      const ft = BigInt('0x' + firstHex);
      ds.acquired = M.fileTime(Number(ft >> 32n), Number(ft & 0xffffffffn));
    } else {
      const ts = X().one(S.image, 'TimeStamp');
      if (ts) ds.acquired = M.fileTime(M.num(ts.getAttribute('HighInteger')), M.num(ts.getAttribute('LowInteger')));
    }
    // processing done in LAS X (e.g. Lightning / deconvolution) on this image
    for (const ph of X().all(S.image, 'ProcessingHistory')) {
      const type = ph.getAttribute('ProcessingType') || 'processing';
      const when = M.parseDate(ph.getAttribute('CreationTime'));
      ds.history.push({ program: 'LAS X', text: type.replace(/_/g, ' '), date: when ? M.fmt.date(when) : '' });
      if (/deconvolution|lightning/i.test(type)) {
        ds.processed = /_Lng$/i.test(S.name) ? 'Lightning (deconvolved)' : 'Deconvolved';
        M.note(ds, 'info', `This image was processed in LAS X (${ds.processed}); its pixels are not the raw detector data.`);
      }
    }
    if (ds.processed) ds.kindLabelSuffix = ds.processed;
    const sw = X().one(doc, 'Experiment');
    ds.instrument.software = 'LAS X';
    if (sw && sw.getAttribute('Path')) ds.raw['Experiment'] = sw.getAttribute('Path');

    ds.kind = ds.dims.z > 1 && ds.dims.t > 1 ? 'hyperstack' : ds.dims.z > 1 ? 'zstack' : ds.dims.t > 1 ? 'timelapse' : 'image';
    ds.raw['LIF image XML'] = S.el;
    M.addSource(ds, 'LIF XML header');

    ds.thumbnail = async () => {
      const mem = X().kid(S.el, 'Memory');
      const id = mem && mem.getAttribute('MemoryBlockID');
      if (!id) return null;
      const blocks = await memoryBlocks(src, end, version);
      const blk = blocks.get(id);
      if (!blk || !dims.x) return null;
      const bpc = ds.bits && ds.bits > 8 ? 2 : 1;
      const zMid = dims.z ? Math.floor(dims.z.n / 2) : 0;
      const zOff = zMid * (dims.z ? dims.z.bytesInc || 0 : 0);
      const chs = [];
      for (let i = 0; i < chEls.length && chs.length < 4; i++) {
        if (lm.channels[i] && lm.channels[i].derived) continue; // lifetime channels are not intensities
        const cOff = M.num(chEls[i].getAttribute('BytesInc')) || 0;
        const img = await M.img.readPlane(src, { offset: blk.offset + cOff + zOff, width: dims.x.n, height: dims.y ? dims.y.n : 1, type: bpc === 2 ? 'u16' : 'u8', le: true, rowBytes: dims.y ? dims.y.bytesInc : undefined }, 512);
        chs.push(Object.assign(img, { color: lm.channels[i].color || (chEls.length === 1 ? '#ffffff' : ['#ff4040', '#40ff40', '#4080ff', '#ffffff'][i]) }));
      }
      if (!chs.length) return null;
      return { canvas: chs.length === 1 ? M.img.grayCanvas(chs[0]) : M.img.compositeCanvas(chs), note: dims.z ? `Z ${zMid + 1} of ${dims.z.n}` : 'image' };
    };
    return ds;
  }

  M.registerFormat({
    id: 'lif', name: 'Leica LIF', modality: 'LM', extensions: ['lif'],
    sniff(h) {
      if (h.length < 13) return 0;
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      return dv.getUint32(0, true) === 0x70 && h[8] === 0x2a ? 0.9 : 0;
    },
    parse,
  });
})();
