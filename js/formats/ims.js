/* EasyMeta - Imaris IMS (HDF5).  Metadata lives in attributes of /DataSetInfo/*
 * groups; the 256×256 RGBA preview in /Thumbnail/Data.  A file converted from another
 * format usually also keeps the source's own metadata in extra groups (ZeissAttrs,
 * ND2_Description, Olympus ...), which name the instrument and its settings best.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const s = (v) => (Array.isArray(v) ? v.join('') : v === undefined || v === null ? null : String(v));
  const n = (v) => M.num(s(v));
  // what Imaris writes when it has no value
  const UNSET = /^(generic\b.*|not known|unknown|n\/a|none|\(.*not specified\))$/i;
  const given = (v) => { const t = (s(v) || '').trim(); return t && !UNSET.test(t) ? t : null; };

  const MAKERS = { zeiss: 'Zeiss', nikon: 'Nikon', leica: 'Leica', olympus: 'Olympus', evident: 'Evident', biorad: 'Bio-Rad', perkinelmer: 'PerkinElmer', andor: 'Andor', bruker: 'Bruker', yokogawa: 'Yokogawa', keyence: 'Keyence' };
  const MAKER_RE = new RegExp(Object.keys(MAKERS).join('|'));
  const makerIn = (t) => { const m = String(t || '').toLowerCase().replace(/[\s-]/g, '').match(MAKER_RE); return m ? MAKERS[m[0]] : null; };
  const onlyMaker = (t) => !!makerIn(t) && /^(carl\s+)?\S+(\s+(microsystems|microscopy|instruments?|corp\w*|gmbh|ag|inc\.?|ltd\.?))*$/i.test(t);
  // the Manufactor fields can also hold the source's file format or software
  const NOT_A_MODEL = /^(nd2|lif|czi|oib|oif|zvi|ics|tiff?)$|axiovision|\bzen\b|nis-elements|las\s*(af|x)\b/i;
  const SOURCE_MAKER = { lif: 'Leica', lof: 'Leica', xlif: 'Leica', czi: 'Zeiss', lsm: 'Zeiss', zvi: 'Zeiss', nd2: 'Nikon', oib: 'Olympus', oif: 'Olympus', oir: 'Olympus' };

  const modeLabel = (m) => (/spinning/i.test(m) ? 'Spinning-disk confocal' : /spim|light.?sheet/i.test(m) ? 'Light sheet (SPIM)' : /confocal|laser.?scan/i.test(m) ? 'Confocal (laser scanning)' : /wide.?field/i.test(m) ? 'Widefield' : /tirf/i.test(m) ? 'TIRF' : m);

  /** Where a converted file came from: {maker, format}, from OriginalFormat ("Zeiss: CZI") or the source file's name. */
  function originOf(img) {
    const orig = given(img.OriginalFormat);
    if (makerIn(orig)) return { maker: makerIn(orig), format: orig };
    for (const name of [img.FileName, img.Filename, img.Name]) {
      const ext = ((given(name) || '').match(/\.(\w+)$/) || [])[1];
      const maker = ext && SOURCE_MAKER[ext.toLowerCase()];
      if (maker) return { maker, format: `${maker}: ${ext.toUpperCase()}` };
    }
    return {};
  }

  /** Maker, model and mode from the "Manufactor" fields (Imaris's spelling), which sit in different groups and hold maker and model in either order. */
  function microscope(ds, info, img, origin) {
    const inst = ds.instrument;
    const manu = info['/DataSetInfo/Manufactor Information'] || {};
    const groups = [img, manu, info['/DataSetInfo/Imaris'] || {}];
    const field = (name) => { for (const g of groups) { const v = given(g['Manufactor' + name]) || given(g['Manufactor ' + name]); if (v) return v; } return null; };
    const string = field('String'), model = field('Model'), type = field('Type');
    const maker = makerIn(string) || makerIn(type) || makerIn(model) || origin.maker;
    const name = [string, model].find((t) => t && !NOT_A_MODEL.test(t) && !onlyMaker(t));
    if (maker) inst.manufacturer = maker;
    if (name) inst.model = name.replace(/^LSM\s*(?=\d)/i, 'LSM ');
    else if (maker && /^LSM$/i.test(type || '')) inst.model = 'LSM';
    const mode = given(img.MicroscopeModality) || given(img.MicroscopeMode) || given(manu['Microscope Mode']);
    if (mode) ds.lm.mode = modeLabel(mode);
    else if (/\bLSM|\bFV\d|FLUOVIEW/i.test(inst.model || '') || info['/DataSetInfo/ScannerSetting']) ds.lm.mode = 'Confocal (laser scanning)';
  }

  /**
   * Zeiss: the converter keeps ZEN's metadata in ZeissAttrs, one attribute per XML path.  Repeated
   * elements carry an index (Channel0, Detector1); single ones may or may not (Instrument, Instrument0).
   */
  function fromZeiss(ds, za) {
    const lm = ds.lm, inst = ds.instrument;
    const keys = Object.keys(za);
    const at = (re) => { const k = keys.find((x) => re.test(x)); return k ? given(za[k]) : null; };
    const detNames = keys.filter((k) => /\/Instrument\d*\/Detectors\/Detector\d*\/Name$/.test(k)).map((k) => s(za[k])).join(' ');
    M.zeiss.setInstrument(ds, lm, {
      stand: at(/\/Instrument\d*\/Microscopes\/Microscope\d*\/Name$/),
      type: at(/\/Instrument\d*\/Microscopes\/Microscope\d*\/Type$/),
      system: at(/\/Instrument\d*\/Microscopes\/Microscope\d*\/System$/),
      heads: [at(/Metadata\/Scaling\/AutoScaling\/CameraName$/), detNames],
    });
    const app = at(/\/Application\d*\/Name$/);
    if (app) {
      inst.convertedWith = inst.software;
      inst.software = app === 'AIMApplication' ? 'ZEN (black edition)' : app;
      inst.softwareVersion = at(/\/Application\d*\/Version$/);
      inst.softwareIsConverter = false;
    }

    // objective: the one the image refers to
    const ref = at(/ObjectiveSettings\/ObjectiveRef\d*\/Id$/);
    const isObj = (k) => /\/Objectives\/Objective\d*\/Id$/.test(k);
    const objKey = keys.find((k) => isObj(k) && s(za[k]) === ref) || keys.find(isObj);
    if (objKey) {
      const f = (t) => given(za[objKey.replace(/Id$/, t)]);
      const o = lm.objective;
      o.name = (f('Name') || f('Manufacturer/Model') || at(/Metadata\/Scaling\/AutoScaling\/ObjectiveName$/) || '').replace(/\s*\(.*\)$/, '') || null;
      o.mag = n(f('NominalMagnification'));
      o.na = n(f('LensNA'));
      o.immersion = f('Immersion');
      const wd = n(f('WorkingDistance'));
      o.workingDistance = wd ? wd * 1e-6 : null; // ZEN writes µm
    }
    lm.objective.medium = at(/ObjectiveSettings\/Medium$/);
    lm.objective.refractiveIndex = n(at(/ObjectiveSettings\/RefractiveIndex$/));

    // channels: the ZEN channel with the same name, else at the same position
    const bases = keys.filter((k) => /Information\/Image\/Dimensions\/Channels\/Channel\d*\/Name$/.test(k)).map((k) => k.replace(/Name$/, ''));
    lm.channels.forEach((ch, i) => {
      const b = bases.find((x) => s(za[x + 'Name']) === ch.name) || bases[i];
      if (!b) return;
      const f = (t) => given(za[b + t]);
      const tm = ch.name.match(/-T(\d+)$/);
      if (tm) ch.track = +tm[1];
      ch.mode = f('AcquisitionMode');
      ch.contrast = f('ContrastMethod');
      ch.illumination = f('IlluminationType');
      ch.pinholeAU = n(f('PinholeSizeAiry'));
      if (n(f('PinholeSize'))) ch.pinholeUm = n(f('PinholeSize'));
      const exp = n(f('ExposureTime'));
      if (exp) ch.exposure = exp > 1e3 ? exp * 1e-9 : exp; // ZEN writes ns
      // the lasers themselves (the channel's excitation field holds the dye's peak)
      const powers = [];
      ch.exLines = [];
      for (const k of keys.filter((x) => x.startsWith(b + 'LightSourcesSettings/') && /\/Wavelength$/.test(x))) {
        const wl = n(za[k]);
        if (!wl) continue;
        ch.exLines.push(Math.round(wl));
        const power = M.zeiss.laserPower(wl, n(za[k.replace(/Wavelength$/, 'Intensity')]), n(za[k.replace(/Wavelength$/, 'Attenuation')]));
        if (power) powers.push(power);
      }
      ch.exLines = M.unique(ch.exLines);
      if (powers.length) ch.power = M.unique(powers).join(', ');
      const rg = M.zeiss.ranges(f('DetectionWavelength/Ranges'));
      if (rg.length) ch.emBand = [Math.min(...rg.map((r) => r[0])), Math.max(...rg.map((r) => r[1]))];
      // light-sheet channels store only a peak: the emission filter is in the experiment's track ("Cam1-T1")
      const short = ch.name.replace(/-T\d+$/, '');
      const dk = keys.find((k) => /TrackSetup\d+\/Detectors\/Detector\d*\/ImageChannelName$/.test(k) && s(za[k]) === short && (!tm || k.includes(`TrackSetup${+tm[1] - 1}/`)));
      const filter = dk ? given(za[dk.replace(/ImageChannelName$/, 'Filtersets/Filterset')]) : null;
      if (filter) {
        ch.filterSet = filter;
        if (!ch.emBand && M.filterBand(filter)) ch.emBand = M.filterBand(filter);
      }
      // detector
      const detId = s(za[keys.find((k) => k.startsWith(b + 'DetectorSettings/') && /Detector\d*\/Id$/.test(k))]);
      const det = keys.find((k) => /\/Detectors\/Detector\d*\/Id$/.test(k) && s(za[k]) === detId);
      const dv = (t) => (det ? given(za[det.replace(/Id$/, t)]) : null);
      ch.detector = { name: dv('Name') || dv('Manufacturer/Model') || dv('Type'), type: dv('Type'), gain: n(f('DetectorSettings/Gain')) || n(f('DetectorSettings/Voltage')), binning: f('DetectorSettings/Binning') };
      // Airyscan, as in czi.js
      const ayMode = f('AiryscanSettings/Mode');
      const ayOn = ayMode && !/^(off|none)$/i.test(ayMode);
      if (ayOn || /airyscan/i.test(detId || '')) ch.airyscan = M.zeiss.airyscanMode(ayOn ? ayMode : null) || true;
      if (/airyscansum/i.test(f('ChannelType') || '')) { ch.airyscanSum = true; ch.derived = true; ch.mode = 'Airyscan sum (pseudo-confocal)'; }
      const scan = (t) => f('LaserScanInfo/' + t);
      lm.scan.zoom = lm.scan.zoom || n(scan('ZoomX'));
      lm.scan.pixelTime = lm.scan.pixelTime || n(scan('PixelTime'));
      lm.scan.frameTime = lm.scan.frameTime || n(scan('FrameTime'));
      lm.scan.averaging = lm.scan.averaging || n(scan('Averaging'));
      lm.scan.direction = lm.scan.direction || scan('ScanDirection');
    });
    const proc = keys.filter((k) => /\/Processing\/Airyscan\/Channels\/Channel\d*\/SuperResolutionParameter$/.test(k)).map((k) => {
      const f = (t) => given(za[k.replace(/SuperResolutionParameter$/, t)]);
      return { id: f('Id'), strength: n(za[k]), auto: /auto/i.test(f('ParameterEstimationType') || ''), dims: f('DeconvolutionType') };
    });
    M.zeiss.setAiryscan(ds, lm, proc, /airyscan/i.test(detNames));
    const before = lm.mode;
    M.zeiss.setMode(lm);
    if (!lm.airyscan) lm.mode = lm.mode ? modeLabel(lm.mode) : before;
    lm.pinholeAU = M.mostCommon(lm.channels.map((c) => c.pinholeAU && Math.round(c.pinholeAU * 100) / 100));
  }

  /** Nikon: the converter keeps NIS's description text, one numbered attribute per line. */
  function fromNd2(ds, lines) {
    const lm = ds.lm;
    const big = Object.keys(lines).sort((a, b) => +a - +b).map((k) => s(lines[k])).join('\n');
    M.nd2Text.applyInstrumentText(ds, lm, big);
    const planes = M.nd2Text.planeTexts(big);
    lm.channels.forEach((ch, i) => {
      // the plane with the same name, else at the same position; channels made in Imaris have none
      const named = Object.values(planes).find((t) => ((t.match(/Name:\s*([^\r\n]+)/) || [])[1] || '').trim() === ch.name);
      const pt = named || planes[i];
      if (!pt) return;
      M.nd2Text.applyPlaneText(ch, pt, lm);
      if (!ch.detector && lm.camera) ch.detector = { name: lm.camera };
    });
    M.nd2Text.applyModeText(ds, lm, big);
  }

  async function parse(src) {
    const ds = M.newDataset(src, this);
    ds.modality = 'LM';
    const h5 = await new M.H5(src).open();
    const root = await h5.attrs(h5.rootAddr);
    const info = await h5.tree('/DataSetInfo', 1, 200);
    const img = info['/DataSetInfo/Image'] || {};
    const origin = originOf(img);
    ds.format.detail = `Imaris ${s(root.ImarisVersion) || ''} · HDF5`.replace('  ', ' ') + (origin.format ? ` · from ${origin.format}` : '');
    ds.dims = { x: n(img.X), y: n(img.Y), z: n(img.Z) || 1, c: 0, t: 1 };
    const unit = s(img.Unit) || 'um';
    const ext = (i) => (n(img['ExtMax' + i]) !== null && n(img['ExtMin' + i]) !== null ? Math.abs(n(img['ExtMax' + i]) - n(img['ExtMin' + i])) : null);
    const px = (i, size) => (ext(i) && size ? M.toMeters(ext(i) / size, unit) : null);
    ds.pixel = { x: px(0, ds.dims.x), y: px(1, ds.dims.y), z: ds.dims.z > 1 ? px(2, ds.dims.z) : null, source: 'Imaris extents' };
    if (given(img.Name)) ds.title = M.basename(given(img.Name));
    ds.description = given(img.Description);
    const rec = s(img.RecordingDate);
    if (rec) ds.acquired = M.parseDate(rec) || rec;
    const lm = M.ensureLM(ds);
    microscope(ds, info, img, origin);
    const za = info['/DataSetInfo/ZeissAttrs'], nd2 = info['/DataSetInfo/ND2_Description'];
    // the excitation field is a laser line only on a laser-scanning system without vendor metadata;
    // widefield readers and ZEN store the dye's peak there
    const laserField = !za && !nd2 && /confocal/i.test(lm.mode || '');
    const chanKeys = Object.keys(info).filter((k) => /\/Channel \d+$/.test(k)).sort((a, b) => +a.match(/\d+$/)[0] - +b.match(/\d+$/)[0]);
    for (const k of chanKeys) {
      const c = info[k];
      const ch = { name: given(c.Name) || k.split('/').pop() };
      ch.color = M.parseColor(s(c.Color));
      const dye = given(c.Fluor) || given(c.DyeName);
      if (dye) ch.dye = dye.replace(/#$/, '');
      const ex = n(c.LSMExcitationWavelength);
      if (ex) {
        if (laserField) ch.exLines = [Math.round(ex * 10) / 10];
        else ch.exPeak = Math.round(ex * 10) / 10;
      }
      // a peak ("515.000"), a window ("429.7 - 513.9") or a filter ("BP 560-615", "LP 575")
      const emText = given(c.LSMEmissionWavelength);
      const win = (emText || '').match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
      const band = win ? [+win[1], +win[2]] : M.filterBand(emText);
      if (band) ch.emBand = band;
      else if (n(emText)) ch.emPeak = Math.round(n(emText) * 10) / 10;
      const ph = n(c.LSMPinhole) || n(c.Pinhole);
      const phUm = ph && ph < 0.01 ? ph * 1e6 : ph; // Leica conversions store metres
      if (phUm >= 5) ch.pinholeUm = phUm; // smaller is a default, not a real pinhole
      const gain = n(c.LSMPhotomultiplierGain) || n(c.Gain);
      if (gain !== null) ch.detector = { name: s(c.DetectorName) || null, gain };
      if (given(c.Description)) ch.description = given(c.Description);
      lm.channels.push(ch);
    }
    ds.dims.c = lm.channels.length || n(img.Noc) || 1;
    const ti = info['/DataSetInfo/TimeInfo'] || {};
    ds.dims.t = n(ti.DatasetTimePoints) || n(ti.FileTimePoints) || 1;
    if (ds.dims.t > 1) {
      const t1 = M.parseDate(s(ti.TimePoint1)), t2 = M.parseDate(s(ti.TimePoint2));
      if (t1 && t2) ds.timeInterval = (t2 - t1) / 1000;
    }
    const imaris = info['/DataSetInfo/Imaris'] || {};
    const ids = info['/DataSetInfo/ImarisDataSet'] || {};
    // the software that wrote this file, which is not the one that acquired the image
    ds.instrument.software = (s(ids.Creator) || 'Imaris') + (s(imaris.Version) ? ' ' + s(imaris.Version) : '');
    ds.instrument.softwareIsConverter = true;
    if (za) fromZeiss(ds, za);
    if (nd2) fromNd2(ds, nd2);
    // objective / microscope where converters stored them
    let lensPower = null;
    for (const [k, v] of Object.entries(info)) {
      const objName = given(v.ObjectiveName) || given(v.Objective) || given(v.LensName) || given(v.RecordingEntryObjective);
      if (objName && !lm.objective.name) lm.objective.name = objName;
      const na = n(v.NumericalAperture || v.LensNA || v.NA);
      if (na && !lm.objective.na) lm.objective.na = na;
      const mag = n(v.ObjectiveMagnification || v.Magnification);
      if (mag && !lm.objective.mag) lm.objective.mag = mag;
      lensPower = lensPower || given(v.LensPower) || given(v.Lenspower);
      const scope = given(v.MicroscopeModel) || given(v.Microscope) || given(v.SystemName);
      if (scope && !ds.instrument.model) ds.instrument.model = scope;
      if (/Log/.test(k)) ds.history = Object.entries(v).filter(([kk]) => /^Entry\d+/.test(kk)).map(([, e]) => ({ program: '', text: s(e), date: '' }));
    }
    if (lm.objective.name && !lm.objective.mag) { const m = lm.objective.name.match(/(\d+)\s*x/i); if (m) lm.objective.mag = +m[1]; }
    if (lensPower && !lm.objective.mag) { const m = lensPower.match(/^(\d+(?:\.\d+)?)\s*x?\b/i); if (m && +m[1] >= 2) lm.objective.mag = +m[1]; }
    // data type: the header of the first channel's data, not the data itself
    try {
      const a = await h5.resolve('/DataSet/ResolutionLevel 0/TimePoint 0/Channel 0/Data');
      const t = a === null ? null : await h5.datatype(a);
      if (t && (t.cls === 0 || t.cls === 1)) {
        ds.bits = t.size * 8;
        ds.pixelType = `${ds.bits}-bit ${t.cls === 1 ? 'float' : t.signed ? 'signed' : 'unsigned'}`;
      }
    } catch (e) { /* keep the rest of the metadata */ }
    M.setStackKind(ds);
    ds.raw['Imaris file attributes'] = root;
    ds.raw['DataSetInfo'] = info;
    M.addSource(ds, 'Imaris DataSetInfo');
    ds.thumbnail = async () => {
      const a = await h5.resolve('/Thumbnail/Data');
      if (a === null) return null;
      const d = await h5.dataset(a, 4 * 1024 * 1024);
      if (!d) return null;
      const rows = d.dims[0], cols = d.dims[1] / 4;
      return { canvas: M.img.rgbCanvas(d.bytes, cols, rows, 4), note: 'thumbnail stored by Imaris' };
    };
    return ds;
  }

  M.registerFormat({
    id: 'ims', name: 'Imaris IMS', modality: 'LM', extensions: ['ims'],
    sniff: (h, ext) => (h[0] === 0x89 && h[1] === 0x48 && h[2] === 0x44 && h[3] === 0x46 ? (ext === 'ims' ? 0.8 : 0.35) : 0),
    parse,
  });
})();
