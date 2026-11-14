/* EasyMeta - Zeiss CZI (ZEN).  Reads the file header segment, the metadata XML
 * segment and, for the preview, the embedded "Thumbnail" JPEG attachment.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const X = () => M.xml;

  async function readSegments(src) {
    const b = await src.bin(0, 32 + 80, true);
    if (!M.startsWith(b.u, 'ZISRAWFILE')) throw new Error('Not a CZI file');
    const hdr = {
      major: b.I32(32), minor: b.I32(36), filePart: b.I32(80),
      directoryPosition: b.I64(84), metadataPosition: b.I64(92), attachmentDirectoryPosition: b.I64(104),
    };
    const mh = await src.bin(hdr.metadataPosition, 40, true);
    if (!M.startsWith(mh.u, 'ZISRAWMETADATA')) throw new Error('CZI metadata segment not found');
    const xmlSize = mh.I32(32);
    const xml = await src.text(hdr.metadataPosition + 32 + 256, xmlSize, 'utf-8');
    return { hdr, xml };
  }

  async function attachments(src, pos) {
    if (!pos) return [];
    const h = await src.bin(pos, 32 + 256, true);
    if (!M.startsWith(h.u, 'ZISRAWATTDIR')) return [];
    const n = h.I32(32);
    const b = await src.bin(pos + 32 + 256, n * 128, true);
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = i * 128;
      out.push({ position: b.I64(o + 12), type: b.STR(o + 40, 8), name: b.STR(o + 48, 80) });
    }
    return out;
  }

  const ranges = (s) => String(s || '').split(/[,;]/).map((r) => r.split('-').map(Number)).filter((r) => r.length === 2 && r.every((v) => isFinite(v) && v > 0));
  const nm = (v) => { const n = M.num(v); if (n === null) return null; return n < 1e-3 ? n * 1e9 : n; }; // some files store metres
  /** ZEN's AiryscanSettings/Mode as the ZEN user interface names it ("SuperResolution" -> "SR"). */
  function airyscanMode(m) {
    if (!m) return null;
    let k;
    if (/^super\s*resolution$|^sr$/i.test(m)) return 'SR';
    if ((k = String(m).match(/(sr|co|hs)[\s_-]*(\d+)\s*y/i))) return `Multiplex ${k[1].toUpperCase()}-${k[2]}Y`;
    if (/virtual\s*pinhole|confocal/i.test(m)) return 'confocal (virtual pinhole)';
    return M.words ? M.words(m) : m;
  }
  const lsmName = (s) => { const m = String(s || '').match(/\bLSM\s*(\d{3,4})\b/i); return m ? 'LSM ' + m[1] : null; };

  /**
   * The microscope.  The stand (Axio Imager, Axio Observer, Examiner) carries the LSM scan head.
   * ZEN blue names the scan head in its hardware configuration (device MTBLSMImagingDevice) and in
   * the scaling (CameraName), ZEN black in the detector names.  Microscope/System is not reliable:
   * ZEN 3.x writes "LSM 800" there on LSM 980 systems too.
   * heads: the names that may hold the scan head, most reliable first.
   */
  function setInstrument(ds, lm, { stand, type, system, systemName, heads }) {
    const head = heads.map(lsmName).find(Boolean) || lsmName(system);
    lm.stand = stand || null;
    lm.standType = type || null; // Upright / Inverted
    ds.instrument.manufacturer = 'Carl Zeiss';
    ds.instrument.model = head || systemName || stand || system || null;
    if (head && lsmName(system) && lsmName(system) !== head) {
      M.note(ds, 'info', `The file's Microscope “System” field says ${lsmName(system)}, but its hardware configuration and scaling name the scan head ${head}; EasyMeta shows ${head}.`);
    }
  }

  /**
   * Airyscan summary for a Zeiss LSM: used or not, its mode, and whether this file holds the raw
   * detector data or the processed image.  proc: Information/Processing/Airyscan, one per channel
   * in channel order, with the raw file's ids (Channel:0, Channel:2 once the sum channels are gone).
   */
  function setAiryscan(ds, lm, proc, installed) {
    const ayCh = lm.channels.filter((c) => c.airyscan);
    lm.airyscan = ayCh.length > 0;
    if (!lm.airyscan && !installed && !/^LSM/.test(ds.instrument.model || '')) return;
    lm.airyscanInfo = {
      used: lm.airyscan,
      installed: installed || lm.airyscan,
      mode: M.mostCommon(ayCh.map((c) => c.airyscan).filter((v) => typeof v === 'string')) || null,
      channels: ayCh.map((c) => c.dye || c.name),
      processed: lm.airyscan ? proc.length > 0 : null,
      processing: proc.map((p, i) => ({ channel: ayCh[i] ? ayCh[i].dye || ayCh[i].name : p.id, strength: p.strength, auto: p.auto, dims: p.dims })),
      otherDetectors: M.unique(lm.channels.filter((c) => !c.airyscan && !c.airyscanSum).map((c) => c.detector && c.detector.name).filter(Boolean)),
    };
    if (proc.length) {
      ds.processed = 'Airyscan processing';
      M.note(ds, 'info', 'This image was made by Airyscan processing in ZEN; its pixels are not the raw detector data.');
    }
  }

  /** The acquisition mode of the whole image, from its channels. */
  function setMode(lm) {
    const modes = lm.channels.filter((c) => !c.airyscanSum).map((c) => c.mode).filter(Boolean);
    lm.mode = lm.airyscan ? `Airyscan${lm.airyscanInfo.mode ? ' ' + lm.airyscanInfo.mode : ''} (laser scanning)` : M.mostCommon(modes) || null;
    if (lm.mode) lm.mode = lm.mode.replace('LaserScanningConfocalMicroscopy', 'Confocal (laser scanning)').replace(/^WideField$/i, 'Widefield').replace('SpinningDiskConfocal', 'Spinning-disk confocal');
  }

  /** ZEN stores laser power as "Attenuation", the fraction blocked (0.988 -> 1.2 %). */
  function laserPower(wl, intensity, attenuation) {
    const pct = intensity !== null ? intensity : attenuation !== null && attenuation >= 0 && attenuation <= 1 ? (1 - attenuation) * 100 : null;
    return pct === null ? null : (wl ? `${Math.round(Number(wl))} nm: ` : '') + `${M.fmt.num(pct, pct < 10 ? 1 : 0)} %`;
  }

  async function parse(src) {
    const ds = M.newDataset(src, this);
    ds.modality = 'LM';
    const { hdr, xml } = await readSegments(src);
    ds.format.detail = `CZI ${hdr.major}.${hdr.minor}` + (hdr.filePart ? ` · part ${hdr.filePart}` : '');
    ds.rawText['CZI metadata.xml'] = xml;
    const doc = X().parse(xml);
    const root = doc.documentElement;
    const meta = X().kid(root, 'Metadata') || root;
    const info = X().kid(meta, 'Information');
    const image = X().kid(info, 'Image');
    const instr = X().kid(info, 'Instrument');
    const lm = M.ensureLM(ds);

    // software / document
    const app = X().kid(info, 'Application');
    if (app) {
      const name = X().text(app, 'Name');
      ds.instrument.software = name === 'AIMApplication' ? 'ZEN (black edition)' : name;
      ds.instrument.softwareVersion = X().text(app, 'Version');
    }
    const docu = X().kid(info, 'Document');
    if (docu) {
      ds.title = X().text(X().kid(docu, 'Name')) || ds.title;
      ds.operator = X().text(X().kid(docu, 'UserName'));
      ds.description = X().text(X().kid(docu, 'Description'));
    }

    // dimensions
    const sz = (k) => M.num(X().text(X().kid(image, 'Size' + k)));
    ds.dims = { x: sz('X'), y: sz('Y'), z: sz('Z') || 1, c: sz('C') || 1, t: sz('T') || 1, s: sz('S') || 1, m: sz('M') || 1, h: sz('H') || 1 };
    ds.pixelType = X().text(X().kid(image, 'PixelType')) || '';
    ds.bits = M.num(X().text(X().kid(image, 'ComponentBitCount')));
    ds.acquired = M.parseDate(X().text(X().kid(image, 'AcquisitionDateAndTime'))) || (docu && M.parseDate(X().text(X().kid(docu, 'CreationDate'))));

    // scaling (metres)
    const scal = X().path(meta, 'Scaling', 'Items');
    for (const d of X().kids(scal, 'Distance')) {
      const id = (d.getAttribute('Id') || '').toLowerCase();
      const v = M.num(X().text(X().kid(d, 'Value')));
      if (v && ['x', 'y', 'z'].includes(id)) ds.pixel[id] = v;
    }
    if (ds.pixel.x) ds.pixel.source = 'CZI scaling';

    // microscope
    const scope = X().one(instr, 'Microscope');
    const devices = X().all(meta, 'Device');
    const imaging = devices.find((d) => d.getAttribute('Id') === 'MTBLSMImagingDevice');
    const detNames = X().all(instr, 'Detector').map((d) => d.getAttribute('Name') || d.getAttribute('Id') || '').join(' ');
    setInstrument(ds, lm, {
      stand: scope && scope.getAttribute('Name'),
      type: scope ? X().text(X().kid(scope, 'Type')) : null,
      system: scope ? X().text(X().kid(scope, 'System')) : null,
      systemName: X().text(X().one(meta, 'SystemName')),
      heads: [imaging && imaging.getAttribute('Name'), X().text(X().path(meta, 'Scaling', 'AutoScaling', 'CameraName')), detNames, ...devices.map((d) => d.getAttribute('Name'))],
    });
    // an Airyscan detector in the hardware configuration (whether or not this image used it)
    const ayInstalled = devices.some((d) => /^airyscan$/i.test(d.getAttribute('Name') || '')) || /airyscan/i.test(detNames);

    // objective
    const objRef = X().path(image, 'ObjectiveSettings', 'ObjectiveRef');
    const objSet = X().kid(image, 'ObjectiveSettings');
    let obj = null;
    const objs = X().kids(X().kid(instr, 'Objectives'), 'Objective');
    if (objRef) obj = objs.find((o) => o.getAttribute('Id') === objRef.getAttribute('Id'));
    obj = obj || objs[0];
    if (obj) {
      const o = lm.objective;
      o.name = obj.getAttribute('Name') || X().text(obj, 'Model');
      o.mag = M.num(X().text(X().kid(obj, 'NominalMagnification')));
      o.na = M.num(X().text(X().kid(obj, 'LensNA')));
      o.immersion = X().text(X().kid(obj, 'Immersion'));
      const wd = M.num(X().text(X().kid(obj, 'WorkingDistance')));
      o.workingDistance = wd ? wd * 1e-6 : null; // ZEN writes µm
      o.manufacturer = X().text(X().path(obj, 'Manufacturer', 'Manufacturer'));
      o.model = X().text(X().path(obj, 'Manufacturer', 'Model'));
      o.correction = (o.name || '').match(/(Plan-Apochromat|C-Apochromat|LCI Plan-Neofluar|EC Plan-Neofluar|Plan-Neofluar|Fluar|LD|EC Epiplan|Alpha Plan-Apochromat|W Plan-Apochromat)/i)?.[0] || null;
    }
    if (objSet) {
      lm.objective.medium = X().text(X().kid(objSet, 'Medium'));
      lm.objective.refractiveIndex = M.num(X().text(X().kid(objSet, 'RefractiveIndex')));
    }
    const tube = X().one(instr, 'TubeLens');
    if (tube) lm.tubeLens = { name: tube.getAttribute('Name'), mag: M.num(X().text(tube, 'Magnification')) };

    // light sources and detectors by id
    const sources = {};
    for (const ls of X().kids(X().kid(instr, 'LightSources'), 'LightSource')) {
      sources[ls.getAttribute('Id')] = { name: ls.getAttribute('Name'), wavelength: M.num(X().text(ls, 'Wavelength')), type: X().text(ls, 'LightSourceType') ? null : null, power: M.num(X().text(ls, 'Power')) };
    }
    const detectors = {};
    for (const d of X().kids(X().kid(instr, 'Detectors'), 'Detector')) {
      const type = X().text(X().kid(d, 'Type'));
      detectors[d.getAttribute('Id')] = { name: d.getAttribute('Name') || X().text(X().path(d, 'Manufacturer', 'Model')) || type || d.getAttribute('Id'), type, model: X().text(X().path(d, 'Manufacturer', 'Model')) };
    }
    const filters = {};
    for (const f of X().all(X().kid(instr, 'Filters'), 'Filter')) {
      const tr = X().kid(f, 'TransmittanceRange');
      filters[f.getAttribute('Id')] = { name: f.getAttribute('Name'), cutIn: tr ? nm(X().text(tr, 'CutIn')) : null, cutOut: tr ? nm(X().text(tr, 'CutOut')) : null };
    }
    const filterSets = {};
    for (const fs of X().all(X().kid(instr, 'FilterSets'), 'FilterSet')) {
      const refs = (k) => X().all(X().kid(fs, k), 'FilterRef').map((r) => filters[r.getAttribute('Id')]).filter(Boolean);
      filterSets[fs.getAttribute('Id')] = { name: fs.getAttribute('Name'), ex: refs('ExcitationFilters'), em: refs('EmissionFilters'), dichroic: X().text(fs, 'DichroicRef') };
    }

    // display colours / dyes
    const disp = {};
    for (const c of X().kids(X().path(meta, 'DisplaySetting', 'Channels'), 'Channel')) {
      disp[c.getAttribute('Id')] = { color: M.parseColor(X().text(X().kid(c, 'Color'))), dye: X().text(X().kid(c, 'DyeName')), name: c.getAttribute('Name') };
    }

    // channels
    const chans = X().kids(X().path(image, 'Dimensions', 'Channels'), 'Channel');
    for (const c of chans) {
      const id = c.getAttribute('Id');
      const ch = { name: c.getAttribute('Name') || id };
      const tm = ch.name.match(/-T(\d+)$/); // ZEN names channels "<name>-T<track>"
      if (tm) ch.track = +tm[1];
      const d = disp[id] || {};
      ch.dye = (X().text(X().kid(c, 'Fluor')) || d.dye || '').replace(/#$/, '') || null;
      ch.color = M.parseColor(X().text(X().kid(c, 'Color'))) || d.color || null;
      ch.exPeak = nm(X().text(X().kid(c, 'ExcitationWavelength')));
      ch.emPeak = nm(X().text(X().kid(c, 'EmissionWavelength')));
      ch.mode = X().text(X().kid(c, 'AcquisitionMode'));
      ch.contrast = X().text(X().kid(c, 'ContrastMethod'));
      ch.illumination = X().text(X().kid(c, 'IlluminationType'));
      ch.pinholeAU = M.num(X().text(X().kid(c, 'PinholeSizeAiry')));
      ch.pinholeUm = M.num(X().text(X().kid(c, 'PinholeSize')));
      const exp = M.num(X().text(X().kid(c, 'ExposureTime')));
      if (exp) ch.exposure = exp > 1e3 ? exp * 1e-9 : exp; // ZEN writes ns
      const rg = ranges(X().text(X().path(c, 'DetectionWavelength', 'Ranges')));
      if (rg.length) ch.emBand = [Math.min(...rg.map((r) => r[0])), Math.max(...rg.map((r) => r[1]))];
      ch.exLines = [];
      const powers = [];
      for (const lss of X().all(X().kid(c, 'LightSourcesSettings'), 'LightSourceSettings')) {
        const ref = X().kid(lss, 'LightSource');
        const src0 = ref ? sources[ref.getAttribute('Id')] : null;
        const wl = nm(X().text(X().kid(lss, 'Wavelength'))) || (src0 && src0.wavelength) || ((ref && ref.getAttribute('Id') || '').match(/(\d{3})\s*$/) || [])[1];
        if (wl) ch.exLines.push(Math.round(Number(wl)));
        const power = laserPower(wl, M.num(X().text(X().kid(lss, 'Intensity'))), M.num(X().text(X().kid(lss, 'Attenuation'))));
        if (power) powers.push(power);
      }
      ch.exLines = M.unique(ch.exLines);
      if (powers.length) ch.power = M.unique(powers).join(', ');
      const ds0 = X().kid(c, 'DetectorSettings');
      if (ds0) {
        const ref = X().kid(ds0, 'Detector');
        const det = ref ? detectors[ref.getAttribute('Id')] : null;
        ch.detector = { name: det ? det.name : ref ? ref.getAttribute('Id') : null, type: det ? det.type : null, gain: M.num(X().text(X().kid(ds0, 'Gain'))) || M.num(X().text(X().kid(ds0, 'Voltage'))), binning: X().text(X().kid(ds0, 'Binning')) };
      }
      // Airyscan: the channel was recorded with the Airyscan detector (AiryscanSettings/Mode
      // "Off" or "None" means it was not).  Raw Airyscan files add an "AiryScanSum" channel
      // per track: the sum of all detector elements, a pseudo-confocal image (5 AU).
      const ayMode = X().text(X().one(c, 'AiryscanSettings'), 'Mode');
      const ayOn = ayMode && !/^(off|none)$/i.test(ayMode);
      if (ayOn || /airyscan/i.test((ch.detector && ch.detector.name) || '')) ch.airyscan = airyscanMode(ayOn ? ayMode : null) || true;
      if (/airyscansum/i.test(X().text(X().kid(c, 'ChannelType')) || '')) { ch.airyscanSum = true; ch.derived = true; ch.mode = 'Airyscan sum (pseudo-confocal)'; }
      const fsRef = X().kid(c, 'FilterSetRef');
      if (fsRef && filterSets[fsRef.getAttribute('Id')]) {
        const fs = filterSets[fsRef.getAttribute('Id')];
        ch.filterSet = fs.name;
        const exf = fs.ex.find((f) => f.cutIn), emf = fs.em.find((f) => f.cutIn);
        if (exf && !ch.exLines.length) ch.exBand = [exf.cutIn, exf.cutOut];
        if (emf && !ch.emBand) ch.emBand = [emf.cutIn, emf.cutOut];
      }
      const ref2 = X().text(X().kid(c, 'Reflector'));
      if (ref2) ch.filterSet = ch.filterSet || ref2;
      const lsi = X().kid(c, 'LaserScanInfo');
      if (lsi) {
        lm.scan.zoom = lm.scan.zoom || M.num(X().text(X().kid(lsi, 'ZoomX')));
        lm.scan.pixelTime = lm.scan.pixelTime || M.num(X().text(X().kid(lsi, 'PixelTime')));
        lm.scan.frameTime = lm.scan.frameTime || M.num(X().text(X().kid(lsi, 'FrameTime')));
        lm.scan.averaging = lm.scan.averaging || M.num(X().text(X().kid(lsi, 'Averaging')));
        lm.scan.direction = lm.scan.direction || X().text(X().kid(lsi, 'ScanDirection'));
        lm.scan.mode = lm.scan.mode || X().text(X().kid(lsi, 'ScanningMode'));
      }
      lm.channels.push(ch);
    }
    const proc = X().kids(X().path(info, 'Processing', 'Airyscan', 'Channels'), 'Channel').map((p) => ({
      id: p.getAttribute('Id'),
      strength: M.num(X().text(p, 'SuperResolutionParameter')),
      auto: /auto/i.test(X().text(p, 'ParameterEstimationType') || ''),
      dims: X().text(p, 'DeconvolutionType'),
    }));
    setAiryscan(ds, lm, proc, ayInstalled);
    setMode(lm);
    lm.pinholeAU = M.mostCommon(lm.channels.map((c) => c.pinholeAU && Math.round(c.pinholeAU * 100) / 100));

    // time / scenes / tiles
    const tInc = X().path(image, 'Dimensions', 'T', 'Positions', 'Interval', 'Increment');
    if (tInc) ds.timeInterval = M.num(X().text(tInc));
    const scenes = X().all(X().path(image, 'Dimensions', 'S'), 'Scene');
    if (scenes.length) lm.scenes = scenes.map((s) => s.getAttribute('Name') || ('Scene ' + s.getAttribute('Index')));

    // EM data written as CZI (ZEN Connect / Crossbeam)
    const mtype = scope ? (scope.getAttribute('Type') || X().text(X().kid(scope, 'Type')) || '') : '';
    if (/electron|SEM|FIB/i.test(mtype) || X().one(meta, 'AcceleratingVoltage')) {
      ds.modality = 'EM';
      const em = M.ensureEM(ds);
      em.mode = 'SEM';
      em.ht = M.num(X().text(X().one(meta, 'AcceleratingVoltage')));
    }

    const z = ds.dims.z, t = ds.dims.t;
    ds.kind = z > 1 && t > 1 ? 'hyperstack' : z > 1 ? 'zstack' : t > 1 ? 'timelapse' : 'image';
    ds.raw['CZI metadata'] = root;
    M.addSource(ds, 'CZI metadata XML');
    ds.thumbnail = async () => {
      const att = await attachments(src, hdr.attachmentDirectoryPosition);
      const th = att.find((a) => /thumbnail/i.test(a.name) && /JPG|PNG|BMP/i.test(a.type));
      if (!th) return null;
      const h = await src.bin(th.position, 48, true);
      if (!M.startsWith(h.u, 'ZISRAWATTACH')) return null;
      const size = h.I32(32);
      const bytes = await src.read(th.position + 32 + 256, size);
      const c = await M.img.encodedCanvas(bytes, /PNG/i.test(th.type) ? 'image/png' : 'image/jpeg');
      return c ? { canvas: c, note: 'thumbnail stored by ZEN' } : null;
    };
    return ds;
  }

  // also used for Zeiss files converted to Imaris, which keep ZEN's metadata
  M.zeiss = { airyscanMode, ranges, setInstrument, setAiryscan, setMode, laserPower };

  M.registerFormat({
    id: 'czi', name: 'Zeiss CZI', modality: 'LM', extensions: ['czi'],
    sniff: (h) => (M.startsWith(h, 'ZISRAWFILE') ? 1 : 0),
    parse,
  });
})();
