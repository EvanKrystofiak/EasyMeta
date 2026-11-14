/* EasyMeta - TIFF container and its EM flavours.
 *
 * The TIFF format reads page 1 and hands it to the best-matching flavour:
 *   EER (Thermo Falcon), Zeiss SmartSEM (CZ_SEM tag), Thermo/FEI SEM & FIB,
 *   Fibics Atlas, AMT camera, ImageJ, plain TIFF.
 * Light-microscopy flavours (LSM, OME-TIFF) live in their own files.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const T = () => M.TIFF;

  function tagsToRaw(ifd) {
    const out = {};
    for (const e of ifd.tags.values()) {
      let v = e.value;
      if (v === undefined) v = `(${M.fmt.bytes(e.size)} at offset ${e.offset})`;
      else if (v instanceof Uint8Array) v = v.length > 64 ? `(${v.length} bytes)` : Array.from(v).join(' ');
      else if (Array.isArray(v) && v.length > 32) v = v.slice(0, 32).join(', ') + ` … (${v.length} values)`;
      out[`${e.name} (${e.code})`] = v;
    }
    return out;
  }
  const bytesToText = (v) => (v instanceof Uint8Array ? M.decodeText(v, 'utf-8').replace(/\0+$/, '') : Array.isArray(v) ? v.join('\n') : String(v || ''));

  /** ImageJ's binary IJMetadata tag -> {Info, Labels, Properties, ...}. */
  function parseIJMetadata(bytes, counts) {
    if (!bytes || !counts) return {};
    counts = [].concat(counts);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = dv.getUint32(0, false);
    const le = magic === 0x4a494a49; // 'JIJI'
    if (magic !== 0x494a494a && !le) return {};
    const types = [];
    for (let p = 4; p + 8 <= counts[0]; p += 8) types.push([dv.getUint32(p, le), dv.getUint32(p + 4, le)]);
    const names = { 0x696e666f: 'Info', 0x6c61626c: 'Labels', 0x72616e67: 'Ranges', 0x6c757473: 'LUTs', 0x706c6f74: 'Plot', 0x726f6920: 'ROI', 0x6f766572: 'Overlays', 0x70726f70: 'Properties' };
    const out = {};
    let pos = counts[0], ci = 1;
    for (const [type, n] of types) {
      const name = names[type] || 'Other';
      const vals = [];
      for (let k = 0; k < n && ci < counts.length; k++, ci++) {
        const len = counts[ci];
        if (['Info', 'Labels', 'Properties'].includes(name)) vals.push(M.decodeText(bytes.subarray(pos, pos + len), le ? 'utf-16le' : 'utf-16be'));
        pos += len;
      }
      if (name === 'Info') out.Info = vals.join('\n');
      else if (name === 'Labels') out.Labels = vals;
      else if (name === 'Properties') { out.Properties = {}; for (let k = 0; k + 1 < vals.length; k += 2) out.Properties[vals[k]] = vals[k + 1]; }
      else if (vals.length) out[name] = `(${vals.length} entries)`;
    }
    return out;
  }

  // ------------------------------------------------------------------ container
  M.registerFormat({
    id: 'tiff', name: 'TIFF', modality: 'unknown',
    extensions: ['tif', 'tiff', 'eer', 'lsm', 'btf', 'tf8', 'gain'],
    sniff(h) {
      if (h.length < 8) return 0;
      if ((h[0] === 0x49 && h[1] === 0x49 && (h[2] === 42 || h[2] === 43) && h[3] === 0) ||
        (h[0] === 0x4d && h[1] === 0x4d && h[2] === 0 && (h[3] === 42 || h[3] === 43))) return 0.6;
      return 0;
    },
    async parse(src, ctx) {
      const tiff = await T().open(src);
      const v = (code, max) => T().value(tiff, tiff.ifd0, code, max || 8 * 1024 * 1024);
      tiff.description = bytesToText(await v(270));
      tiff.software = bytesToText(await v(305));
      tiff.make = bytesToText(await v(271));
      tiff.model = bytesToText(await v(272));
      tiff.datetime = bytesToText(await v(306));
      tiff.layout = await T().layout(tiff, tiff.ifd0);
      if (tiff.ifd0.tags.has(50839)) {
        try { tiff.ij = parseIJMetadata(await T().bytesOf(tiff, tiff.ifd0, 50839), await v(50838)); } catch (e) { tiff.ij = {}; }
      }
      let best = null, bs = 0;
      for (const f of M.tiffFlavors) {
        let s = 0;
        try { s = await f.match(tiff, src); } catch (e) { s = 0; }
        if (s > bs) { best = f; bs = s; }
      }
      const ds = M.newDataset(src, { id: best.id, name: best.name, modality: best.modality });
      ds.format.detail = (tiff.big ? 'BigTIFF' : 'TIFF') + (tiff.layout.compression !== 1 ? ' · ' + tiff.layout.compressionName + ' compressed' : '');
      ds.dims = { x: tiff.layout.width, y: tiff.layout.height };
      ds.bits = tiff.layout.bits;
      ds.pixelType = `${tiff.layout.bits}-bit${tiff.layout.sampleFormat === 3 ? ' float' : tiff.layout.sampleFormat === 2 ? ' signed' : ''}` + (tiff.layout.samples > 1 ? ` × ${tiff.layout.samples} samples` : '');
      ds.tiff = tiff;
      await best.parse(tiff, ds, ctx);
      if (!ds.instrument.software && tiff.software) ds.instrument.software = tiff.software;
      if (!ds.acquired && tiff.datetime) ds.acquired = M.parseDate(tiff.datetime.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'));
      ds.raw['TIFF tags (page 1)'] = tagsToRaw(tiff.ifd0);
      if (tiff.ij && Object.keys(tiff.ij).length) ds.raw['ImageJ metadata'] = tiff.ij;
      if (ds.thumbnail === null && !ds.noThumbnail) ds.thumbnail = async () => {
        const c = await M.img.tiffPlane(tiff, tiff.ifd0);
        return c ? { canvas: c, note: 'page 1' } : null;
      };
      M.addSource(ds, 'TIFF tags');
      return ds;
    },
  });

  // ------------------------------------------------------------------ EER
  function eerItems(xml) {
    const out = {};
    try {
      const doc = M.xml.parse(xml);
      for (const it of M.xml.all(doc, 'item')) out[it.getAttribute('name')] = { value: it.textContent.trim(), unit: it.getAttribute('unit') || '' };
    } catch (e) { /* not XML */ }
    return out;
  }
  M.registerTiffFlavor({
    id: 'eer', name: 'EER (Falcon)', modality: 'EM',
    match: (t) => ((t.layout.compression >= 65000 && t.layout.compression <= 65002) || t.ifd0.tags.has(65001) ? 1 : 0),
    async parse(tiff, ds) {
      ds.modality = 'EM';
      ds.kind = 'movie';
      ds.format.detail = `EER · ${T().COMPRESSION[tiff.layout.compression] || 'RLE'}` + (tiff.big ? ' · BigTIFF' : '');
      const xml = bytesToText(await T().value(tiff, tiff.ifd0, 65001, 1 << 20));
      const fxml = bytesToText(await T().value(tiff, tiff.ifd0, 65002, 1 << 20));
      const it = eerItems(xml), fr = eerItems(fxml);
      const get = (k) => (it[k] ? it[k].value : null);
      let frames = M.num(get('numberOfFrames'));
      if (!frames) frames = (await T().countIFDs(tiff, 20000)).count;
      ds.dims.z = frames;
      ds.pixelType = '1-bit electron events';
      const em = M.ensureEM(ds);
      const px = M.num(get('sensorPixelSize.width'));
      if (px) ds.pixel = { x: px, y: M.num(get('sensorPixelSize.height')) || px, source: 'EER metadata' };
      em.camera.name = get('cameraName');
      em.camera.commercialName = get('commercialName');
      em.camera.serial = get('serialNumber');
      em.camera.mode = 'EER (electron event representation)';
      em.camera.counting = true;
      em.exposure = M.num(get('exposureTime'));
      em.frames = frames;
      const rate = M.num(get('meanDoseRate')), total = M.num(get('totalDose'));
      if (rate) em.doseRatePx = rate;
      if (total && px) em.dosePerImage = total / Math.pow(px * 1e10, 2);
      if (get('timestamp')) ds.acquired = M.parseDate(get('timestamp'));
      const fd = fr.dose ? M.num(fr.dose.value) : null;
      ds.movie = {
        frames, frameDose: fd && px ? fd / Math.pow(px * 1e10, 2) : null,
        subPixel: fr.nrOfSubPixelPerDirection ? M.num(fr.nrOfSubPixelPerDirection.value) : null,
        rleBits: fr.rleCodeLength ? M.num(fr.rleCodeLength.value) : null,
        gainReference: get('eerGainReference'),
      };
      ds.rawText['EER metadata.xml'] = xml;
      ds.raw['EER metadata'] = Object.fromEntries(Object.entries(it).map(([k, x]) => [k, x.value + (x.unit ? ' ' + x.unit : '')]));
      if (fxml) ds.raw['EER frame 1 metadata'] = Object.fromEntries(Object.entries(fr).map(([k, x]) => [k, x.value + (x.unit ? ' ' + x.unit : '')]));
      M.addSource(ds, 'EER metadata');
      ds.noThumbnail = true; // EER frames are 1-bit event lists; no cheap preview
      ds.thumbnailNote = 'EER frames hold individual electron events, so EasyMeta does not decode a preview.';
    },
  });

  // ------------------------------------------------------------------ Zeiss SmartSEM
  function parseCzSem(text) {
    const out = {};
    let key = null;
    for (const line of text.split(/\r?\n|\r/)) {
      if (/^[A-Z][A-Z0-9_]+$/.test(line.trim())) { key = line.trim(); continue; }
      if (!key) continue;
      const m = line.match(/^\s*(.+?)\s*[=:]\s*(.*)$/);
      if (m) out[key] = { label: m[1].trim(), value: m[2].trim() };
      key = null;
    }
    return out;
  }
  /** "10.00 K X" -> 10000; "5.00 kV" -> 5000; "2.791 nm" -> metres; returns {num, unit}. */
  function zeissValue(s) {
    const m = String(s || '').match(/([+-]?[\d.]+(?:e[+-]?\d+)?)\s*([KkMm]?)\s*(.*)$/);
    if (!m) return { num: null, unit: '' };
    let v = parseFloat(m[1]);
    const unit = m[3].trim();
    if (/^X$/i.test(unit) || /^x$/.test(unit)) { if (m[2] === 'K' || m[2] === 'k') v *= 1e3; if (m[2] === 'M') v *= 1e6; return { num: v, unit: 'x' }; }
    return { num: v, unit: (m[2] || '') + unit };
  }
  M.registerTiffFlavor({
    id: 'zeiss-sem', name: 'Zeiss SEM TIFF', modality: 'EM',
    match: (t) => (t.ifd0.tags.has(34118) ? 0.9 : 0),
    async parse(tiff, ds) {
      ds.modality = 'EM';
      ds.kind = 'image';
      const raw = await T().value(tiff, tiff.ifd0, 34118, 4 << 20);
      const text = bytesToText(raw);
      const z = parseCzSem(text);
      ds.raw['Zeiss SEM parameters'] = Object.fromEntries(Object.entries(z).map(([k, x]) => [`${x.label} (${k})`, x.value]));
      ds.rawText['CZ_SEM.txt'] = text;
      const val = (k) => (z[k] ? z[k].value : null);
      const em = M.ensureEM(ds);
      em.mode = 'SEM';
      M.set(ds.instrument, 'manufacturer', 'Carl Zeiss');
      M.set(ds.instrument, 'model', val('SV_INSTRUMENT_ID') || val('DP_COLUMN_TYPE') || 'SEM');
      M.set(ds.instrument, 'serial', val('SV_SERIAL_NUMBER'));
      M.set(ds.instrument, 'software', 'SmartSEM' + (val('SV_VERSION') ? ' ' + val('SV_VERSION') : ''));
      const px = zeissValue(val('AP_PIXEL_SIZE') || val('AP_IMAGE_PIXEL_SIZE'));
      if (px.num) ds.pixel = { x: M.toMeters(px.num, px.unit), y: M.toMeters(px.num, px.unit), source: 'Zeiss SEM tag' };
      const kv = zeissValue(val('AP_ACTUALKV') || val('AP_MANUALKV') || val('AP_EHT'));
      if (kv.num) em.ht = /k/i.test(kv.unit) ? kv.num * 1000 : kv.num;
      const mag = zeissValue(val('AP_MAG'));
      if (mag.num) em.mag = mag.num;
      const wd = zeissValue(val('AP_WD'));
      if (wd.num) em.workingDistance = M.toMeters(wd.num, wd.unit);
      const ip = zeissValue(val('AP_IPROBE') || val('AP_BEAM_CURRENT'));
      if (ip.num) em.beamCurrent = ip.num * ({ pA: 1e-12, nA: 1e-9, uA: 1e-6, 'µA': 1e-6, mA: 1e-3, A: 1 }[ip.unit] || 1e-12);
      em.detector = val('DP_DETECTOR_CHANNEL') || val('DP_DETECTOR_TYPE') || val('DP_OPENING') || null;
      em.aperture = val('AP_APERTURESIZE') || null;
      em.scanInfo = [val('DP_NOISE_REDUCTION'), val('AP_FRAME_TIME') && `frame ${val('AP_FRAME_TIME')}`, val('DP_SCANRATE') && `scan speed ${val('DP_SCANRATE')}`].filter(Boolean).join(' · ') || null;
      const tilt = zeissValue(val('AP_STAGE_AT_T'));
      if (tilt.num !== null) em.stage.alpha = tilt.num;
      const d = val('AP_DATE'), tm = val('AP_TIME');
      if (d) ds.acquired = M.parseDate(`${d} ${tm || ''}`.trim()) || `${d} ${tm || ''}`;
      M.addSource(ds, 'Zeiss SEM tag');
    },
  });

  // ------------------------------------------------------------------ Thermo / FEI SEM & FIB
  M.registerTiffFlavor({
    id: 'thermo-sem', name: 'Thermo Fisher SEM/FIB TIFF', modality: 'EM',
    match: (t) => (t.ifd0.tags.has(34682) || t.ifd0.tags.has(34680) ? 0.9 : 0),
    async parse(tiff, ds) {
      ds.modality = 'EM';
      ds.kind = 'image';
      const code = tiff.ifd0.tags.has(34682) ? 34682 : 34680;
      const text = bytesToText(await T().value(tiff, tiff.ifd0, code, 4 << 20));
      const ini = M.parseIni(text);
      ds.raw['Thermo Fisher metadata'] = ini;
      ds.rawText['FEI metadata.ini'] = text;
      const g = (sec, key) => (ini[sec] ? ini[sec][key] : undefined);
      const em = M.ensureEM(ds);
      const beam = g('Beam', 'Beam') || 'EBeam';
      const B = ini[beam] || {};
      em.mode = /ibeam/i.test(beam) ? 'FIB (ion beam)' : 'SEM';
      M.set(ds.instrument, 'manufacturer', 'Thermo Fisher Scientific');
      M.set(ds.instrument, 'model', g('System', 'SystemType') || g('System', 'Type'));
      M.set(ds.instrument, 'serial', g('System', 'Dnumber') ? 'D' + String(g('System', 'Dnumber')).replace(/^D/i, '') : null);
      M.set(ds.instrument, 'software', g('System', 'Software'));
      const px = M.num(g('Scan', 'PixelWidth'));
      if (px) ds.pixel = { x: px, y: M.num(g('Scan', 'PixelHeight')) || px, source: 'Thermo metadata' };
      em.ht = M.num(B.HV) || M.num(g('Beam', 'HV'));
      em.beamCurrent = M.num(B.BeamCurrent);
      em.workingDistance = M.num(B.WD) || M.num(g('Stage', 'WorkingDistance'));
      em.hfw = M.num(B.HFW) || M.num(g('Scan', 'HorFieldsize'));
      const canvas = M.num(g('Image', 'MagCanvasRealWidth'));
      if (canvas && em.hfw) em.mag = canvas / em.hfw;
      em.dwellTime = M.num(g('Scan', 'Dwelltime'));
      em.spot = M.num(g('Beam', 'Spot')) || M.num(B.Spot);
      const det = g('Detectors', 'Name');
      em.detector = det ? det + (g('Detectors', 'Mode') ? ' (' + g('Detectors', 'Mode') + ')' : '') : null;
      em.aperture = B.ApertureDiameter ? M.fmt.len(M.num(B.ApertureDiameter)) : B.Aperture || null;
      const integ = [g('Scan', 'Integrate') && `integrate ${g('Scan', 'Integrate')}`, g('Scan', 'Average') && `average ${g('Scan', 'Average')}`].filter(Boolean);
      em.scanInfo = integ.join(' · ') || null;
      const t = M.num(g('Stage', 'StageT'));
      if (t !== null) em.stage.alpha = t * 180 / Math.PI;
      const date = g('User', 'Date'), time = g('User', 'Time');
      if (date) ds.acquired = M.parseDate(`${date} ${time || ''}`.trim()) || `${date} ${time || ''}`;
      M.addSource(ds, 'Thermo metadata tag');
    },
  });

  // ------------------------------------------------------------------ Fibics Atlas
  M.registerTiffFlavor({
    id: 'fibics', name: 'Fibics Atlas TIFF', modality: 'EM',
    match: (t) => (t.ifd0.tags.has(51023) ? 0.85 : /Fibics/i.test((t.ij && t.ij.Info) || t.description || '') ? 0.55 : 0),
    async parse(tiff, ds) {
      ds.modality = 'EM';
      ds.kind = 'image';
      M.ensureEM(ds).mode = 'SEM';
      M.set(ds.instrument, 'software', 'Fibics Atlas');
      const xml = bytesToText(await T().value(tiff, tiff.ifd0, 51023, 8 << 20));
      if (xml) {
        ds.rawText['FibicsXML.xml'] = xml;
        try {
          const doc = M.xml.parse(xml);
          ds.raw['Fibics XML'] = doc.documentElement;
          const ux = M.xml.num(doc, 'Ux'), vy = M.xml.num(doc, 'Vy');
          if (ux) ds.pixel = { x: Math.abs(ux) * 1e-6, y: Math.abs(vy || ux) * 1e-6, source: 'Fibics XML (µm per pixel)' };
          const em = ds.em;
          em.ht = (M.xml.num(doc, 'KV') || 0) * 1000 || null;
          em.detector = M.xml.text(doc, 'Detector');
          em.dwellTime = M.xml.num(doc, 'Dwell') ? M.xml.num(doc, 'Dwell') * 1e-6 : null;
        } catch (e) { /* keep text */ }
      } else {
        M.note(ds, 'info', 'This Atlas export was re-saved (e.g. by ImageJ) and lost the Fibics metadata tag.');
      }
      await M.tiffImageJBasics(tiff, ds);
    },
  });

  // ------------------------------------------------------------------ AMT camera
  function amtText(t) {
    if (/XpixCal=/.test(t.description)) return t.description;
    const info = t.ij && t.ij.Info;
    if (info && /XpixCal=/.test(info)) return info.replace(/^ImageDescription:\s*/, '');
    return null;
  }
  M.registerTiffFlavor({
    id: 'amt', name: 'AMT camera TIFF', modality: 'EM',
    match: (t) => (amtText(t) ? 0.8 : 0),
    async parse(tiff, ds) {
      ds.modality = 'EM';
      ds.kind = 'image';
      const text = amtText(tiff);
      const lines = text.split(/\r\n|\r|\n/);
      const em = M.ensureEM(ds);
      em.mode = 'TEM';
      const kv = {};
      for (const l of lines) { const m = l.match(/^(\w+)=(.*)$/); if (m) kv[m[1]] = m[2]; }
      const unit = kv.Unit || 'um';
      const cal = M.num(kv.XpixCal);
      if (cal) ds.pixel = { x: M.toMeters(1 / cal, unit), y: M.toMeters(1 / (M.num(kv.YpixCal) || cal), unit), source: 'AMT calibration' };
      // fixed-position fields written by AMT capture software
      const date = lines[1], time = lines[2];
      if (/^\d{4}-\d{2}-\d{2}$/.test(date || '')) ds.acquired = M.parseDate(`${date}T${time || '00:00'}`);
      const mag = M.num(lines[3]), hv = M.num(lines[5]);
      if (mag && mag > 10) em.mag = mag;
      if (hv && hv >= 20 && hv <= 400) em.ht = hv * 1000;
      if (/^(Imaging|Diffraction|LowMag|Low Mag)/i.test(lines[6] || '')) em.projection = lines[6];
      if (lines[0]) M.set(ds.instrument, 'name', lines[0]);
      const cam = lines.find((l) => /^Camera:/.test(l));
      if (cam) {
        const m = cam.match(/Camera:\s*([^,]+)/), ex = cam.match(/Exposure:\s*([\d.]+)\s*\(ms\)(?:\s*x\s*(\d+))?/), gain = cam.match(/Gain:\s*([\d.]+)/), bin = cam.match(/Bin:\s*(\d+)/);
        em.camera.name = 'AMT ' + (m ? m[1].trim() : '');
        if (ex) { em.exposure = +ex[1] / 1000 * (ex[2] ? +ex[2] : 1); if (ex[2]) em.frames = +ex[2]; }
        if (gain) em.camera.gain = +gain[1];
        if (bin) em.binning = +bin[1];
        em.camera.settings = cam.replace(/^Camera:\s*/, '');
      }
      const fv3 = lines.indexOf('##fv3');
      if (fv3 >= 0 && M.num(lines[fv3 + 1])) em.camera.sensor = [M.num(lines[fv3 + 1]), M.num(lines[fv3 + 2])];
      M.set(ds.instrument, 'software', 'AMT Image Capture');
      ds.raw['AMT description (line by line)'] = Object.fromEntries(lines.map((l, i) => [`line ${i + 1}`, l]));
      ds.rawText['AMT description.txt'] = text;
      M.addSource(ds, 'AMT description');
      M.note(ds, 'info', 'AMT stores most values by position; the line numbers EasyMeta reads as date, magnification and kV are shown in the raw metadata.');
    },
  });

  // ------------------------------------------------------------------ ImageJ / generic
  /** Dimensions, spacing and unit from an ImageJ description. */
  M.tiffImageJBasics = async function (tiff, ds) {
    const d = tiff.description || '';
    if (!/^ImageJ=/.test(d)) {
      const px = await T().resolution(tiff, tiff.ifd0);
      if (px && !ds.pixel.x) ds.pixel = { x: px, y: px, source: 'TIFF resolution tags' };
      return null;
    }
    const kv = M.parseKeyValues(d, /^\s*(\w+)\s*=\s*(.*?)\s*$/);
    const n = (k) => M.num(kv[k]);
    ds.dims.c = n('channels') || 1;
    ds.dims.z = n('slices') || (n('images') && !n('channels') && !n('frames') ? n('images') : 1);
    ds.dims.t = n('frames') || 1;
    const xr = await T().value(tiff, tiff.ifd0, 282);
    const unit = (kv.unit || '').replace(/\\u00B5/g, 'µ');
    if (M.isNum(xr) && xr > 0 && unit && unit !== 'pixel' && unit !== 'inch') {
      const px = M.toMeters(1 / xr, unit);
      if (px) ds.pixel = { x: px, y: px, z: n('spacing') ? M.toMeters(n('spacing'), unit) : null, source: 'ImageJ calibration' };
    }
    if (n('finterval')) ds.timeInterval = n('finterval');
    return kv;
  };
  M.registerTiffFlavor({
    id: 'imagej', name: 'ImageJ TIFF', modality: 'unknown',
    match: (t) => (/^ImageJ=/.test(t.description || '') ? 0.5 : 0),
    async parse(tiff, ds) {
      const kv = await M.tiffImageJBasics(tiff, ds);
      ds.raw['ImageJ description'] = kv;
      const info = (tiff.ij && tiff.ij.Info) || '';
      const hay = `${info} ${ds.file.name}`;
      if (/Microscope Info|SerialEM|mdoc|Voltage|kV\b|Tecnai|Krios|Titan|Glacios|cryo|tomo|_rec\b|rec-|\.mrc|\.dm[34]|tilt/i.test(hay)) ds.modality = 'EM';
      else if (/\.czi|\.nd2|\.lif|\.lsm|confocal|Airyscan|objective|DAPI|GFP|Alexa|mCherry|laser|Excitation|Emission/i.test(hay)) ds.modality = 'LM';
      ds.modalityGuessed = ds.modality !== 'unknown'; // from words in the info block or the name; the Overview page offers a switch
      if (info) ds.rawText['ImageJ Info.txt'] = info;
      setStackKind(ds);
      // a stack named like a reconstruction is a tomogram, but only as electron microscopy
      if (ds.dims.z > 1 && /rec|tomo/i.test(ds.file.name)) ds._kindFor = { LM: ds.kind, EM: 'tomogram' };
      if (ds._kindFor && ds.modality === 'EM') ds.kind = 'tomogram';
      if (ds.modality === 'unknown') M.note(ds, 'info', 'Plain ImageJ TIFF: EasyMeta cannot tell whether this is light or electron microscopy; use the Light/EM switch on the Overview page.');
    },
  });
  M.registerTiffFlavor({
    id: 'tiff-generic', name: 'TIFF', modality: 'unknown',
    match: () => 0.1,
    async parse(tiff, ds) {
      await M.tiffImageJBasics(tiff, ds);
      const n = await T().countIFDs(tiff, 2000);
      if (n.count > 1) ds.dims.z = n.count;
      if (!n.complete) M.note(ds, 'info', 'Stopped counting pages at 2000.');
      if (tiff.make || tiff.model) { ds.instrument.manufacturer = tiff.make; ds.instrument.model = tiff.model; }
      setStackKind(ds);
    },
  });
  function setStackKind(ds) {
    const z = ds.dims.z || 1, t = ds.dims.t || 1;
    ds.kind = z > 1 && t > 1 ? 'hyperstack' : z > 1 ? 'zstack' : t > 1 ? 'timelapse' : 'image';
  }
  M.setStackKind = setStackKind;
  M.tiffTagsToRaw = tagsToRaw;
})();
