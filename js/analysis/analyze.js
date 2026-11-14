/* EasyMeta - derived values computed after parsing: friendly instrument names,
 * detector inference, doses, tilt-series order and scheme, physical sizes,
 * optical resolution / Nyquist sampling.  Runs once per dataset.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;

  const KIND_LABELS = {
    image: 'Single image', zstack: 'Z-stack', timelapse: 'Time-lapse', hyperstack: 'Z-stack time-lapse',
    tiltseries: 'Tilt series', tomogram: 'Tomogram', map: '3D density map', movie: 'Movie (dose fractions)',
    particles: 'Particle stack', montage: 'Montage', gain: 'Gain reference', imagestack: 'Image stack',
    diffraction: 'Diffraction pattern',
  };

  M.analyze = function (ds) {
    if (ds.modalityOverride) ds.modality = ds.modalityOverride;
    ds.kindLabel = KIND_LABELS[ds.kind] || M.cap(ds.kind || 'image');
    if (ds.modality === 'LM' && ds.kind === 'image') ds.kindLabel = (ds.dims.c || 1) > 1 ? 'Multichannel image' : 'Single image';
    if (ds.kind === 'movie' && ds.format.id === 'tiff') ds.kindLabel = 'Movie (EER frames)';
    if (ds.kindLabelSuffix) ds.kindLabel += ` · ${ds.kindLabelSuffix}`;
    friendlyInstrument(ds);
    if (ds.modality === 'EM') analyzeEM(ds);
    if (ds.modality === 'LM') analyzeLM(ds);
    geometry(ds);
    if (ds.tilt) analyzeTilts(ds);
    ds.checks = M.runChecks ? M.runChecks(ds) : [];
    ds.methods = M.methodsText ? M.methodsText(ds) : '';
  };

  // --------------------------------------------------------------- instrument
  function friendlyInstrument(ds) {
    const inst = ds.instrument;
    const hay = [inst.systemId, inst.serial, inst.name, inst.model, inst.manufacturer, ds.em && ds.em.camera && ds.em.camera.name].filter(Boolean).join(' | ');
    for (const r of M.instrumentRegistry || []) {
      const re = r.match instanceof RegExp ? r.match : new RegExp(r.match, 'i');
      if (re.test(hay)) { inst.friendlyName = r.name; inst.site = r.site || inst.site; inst.registryNote = r.note; break; }
    }
    const parts = [];
    if (inst.manufacturer && !(inst.model || '').toLowerCase().startsWith(inst.manufacturer.toLowerCase().split(' ')[0])) parts.push(shortMaker(inst.manufacturer));
    if (inst.model) parts.push(inst.model);
    else if (inst.name) parts.push(inst.name);
    let label = parts.join(' ');
    if (!label && inst.manufacturer) label = shortMaker(inst.manufacturer);
    if (inst.serial && ds.modality === 'EM' && !label.includes(inst.serial)) label += ` (${inst.serial})`;
    inst.label = inst.friendlyName || label || null;
    inst.detailLabel = inst.friendlyName ? label : null;
  }
  const shortMaker = (m) => (/thermo|fei/i.test(m) ? 'Thermo Fisher' : /zeiss/i.test(m) ? 'Zeiss' : /leica/i.test(m) ? 'Leica' : /olympus|evident/i.test(m) ? 'Olympus' : m);

  // --------------------------------------------------------------- EM
  const SENSORS = [
    { w: 5760, h: 4092, name: 'Gatan K3', mode: 'Counting' },
    { w: 11520, h: 8184, name: 'Gatan K3', mode: 'Super-resolution' },
    { w: 3838, h: 3710, name: 'Gatan K2 Summit', mode: 'Counting' },
    { w: 7676, h: 7420, name: 'Gatan K2 Summit', mode: 'Super-resolution' },
  ];
  // direct electron detectors, by commercial name
  const DIRECT_DETECTOR = /\b(K2|K3|Falcon|Apollo|Celeritas|DE-?\d+|Merlin|Medipix|Timepix|EMPAD|Alpine|Metro|Stela|Arina|Quadro|Singla)\b/i;
  function analyzeEM(ds) {
    const em = M.ensureEM(ds);
    const cam = em.camera;
    // detector from sensor size when only a generic camera name is known
    if (!cam.commercialName) {
      const ro = cam.readout && cam.readout[2] ? [cam.readout[2] - cam.readout[0], cam.readout[3] - cam.readout[1]] : [ds.dims.x * (em.binning || 1), ds.dims.y * (em.binning || 1)];
      const hit = SENSORS.find((s) => (s.w === ro[0] && s.h === ro[1]) || (s.w === ro[1] && s.h === ro[0]));
      if (hit && (!cam.name || /CCD|EF-|BM-|camera|K3|K2/i.test(cam.name))) { cam.inferred = hit.name; cam.mode = cam.mode || hit.mode; }
      else if (/falcon/i.test(cam.name || '')) cam.inferred = 'Falcon';
    }
    // Thermo's microscope software names the camera port by position and an old camera type,
    // "EF-CCD" behind the energy filter and "BM-CCD" at the bottom mount, for a K2/K3 too;
    // a direct electron detector is shown as "EF-DE" / "BM-DE"
    const det = cam.commercialName || cam.inferred || null;
    const port = cam.name && det && DIRECT_DETECTOR.test(det) ? cam.name.replace(/\bCCD\b/i, 'DE') : cam.name;
    cam.label = det || port || null;
    if (det && port && port !== det) cam.label += ` (${port})`;
    if (!cam.mode && cam.counting) cam.mode = 'Counting';
    if (/EF-/i.test(cam.name || '') || em.filter.eftem || em.filter.slitInserted) em.filter.present = true;
    // dose from dose rate when not stored
    const pxA = ds.pixel.x ? ds.pixel.x * 1e10 : null;
    if (!M.isNum(em.dosePerImage) && M.isNum(em.doseRatePx) && M.isNum(em.exposure) && pxA) em.dosePerImage = (em.doseRatePx * em.exposure) / (pxA * pxA);
    if (M.isNum(em.dosePerImage) && M.isNum(em.exposure) && em.exposure > 0) em.doseRateArea = em.dosePerImage / em.exposure;
    if (pxA && M.isNum(em.dosePerImage) && !M.isNum(em.doseRatePx) && M.isNum(em.exposure) && em.exposure > 0) em.doseRatePx = (em.dosePerImage * pxA * pxA) / em.exposure;
    if (ds.movie && M.isNum(em.dosePerImage) && ds.movie.frames && !M.isNum(ds.movie.frameDose)) ds.movie.frameDose = em.dosePerImage / ds.movie.frames;
    // electron wavelength (relativistic) and Nyquist
    if (M.isNum(em.ht) && em.ht > 0) {
      const V = em.ht;
      em.wavelength = 12.2643 / Math.sqrt(V * (1 + 0.978476e-6 * V)) * 1e-10;
    }
    if (ds.rawPixel && ds.pixel.x && (ds.kind === 'tomogram' || ds.kind === 'map')) {
      const b = ds.pixel.x / ds.rawPixel;
      ds.binning = Math.abs(b - Math.round(b)) < 0.05 ? Math.round(b) : Math.round(b * 100) / 100;
    }
  }

  // --------------------------------------------------------------- LM
  const RI = { oil: 1.518, water: 1.333, w: 1.333, silicone: 1.406, sil: 1.406, glycerol: 1.47, glyc: 1.47, air: 1.0, dry: 1.0, multi: 1.45 };
  function analyzeLM(ds) {
    const lm = M.ensureLM(ds);
    const o = lm.objective;
    if (!M.isNum(o.na) && o.name) { const m = o.name.match(/\/\s*(\d\.\d+)/); if (m) o.na = +m[1]; }
    if (!M.isNum(o.mag) && o.name) { const m = o.name.match(/(\d+(?:\.\d+)?)\s*[x×]/i); if (m) o.mag = +m[1]; }
    const IMM = { w: 'Water', wi: 'Water', water: 'Water', oil: 'Oil', sil: 'Silicone', silicone: 'Silicone', glyc: 'Glycerol', glycerol: 'Glycerol', imm: 'Multi-immersion', air: 'Air', dry: 'Air' };
    if (!o.immersion && o.name) { const m = o.name.match(/\b(oil|water|wi|w|sil|silicone|glyc|glycerol|imm)\b/i); if (m) o.immersion = IMM[m[1].toLowerCase()]; }
    if (o.immersion && IMM[String(o.immersion).toLowerCase()]) o.immersion = IMM[String(o.immersion).toLowerCase()];
    const n = M.isNum(o.refractiveIndex) && o.refractiveIndex >= 1 ? o.refractiveIndex : RI[String(o.immersion || '').toLowerCase().split(/\W/)[0]] || (o.na > 1 ? 1.518 : 1.0);
    lm.n = n;
    const confocal = /confocal|laser scanning|airyscan|lsm/i.test(lm.mode || '') || (ds.instrument.model && /\bLSM|\bSP\d|Stellaris|\bFV\d|\bA1(?:R|plus)?\b|\bAX\b|\bC2\b/i.test(ds.instrument.model));
    lm.confocal = !!confocal;
    for (const ch of lm.channels) {
      // Dye peaks: the published peaks of a recognised dye.  ch.exPeak / ch.emPeak keep what
      // the file stored in its own "excitation/emission wavelength" fields, which some
      // software fills with the laser line or the detection centre instead of the dye peak.
      // A measured spectrum (FPbase) wins; its peaks then come from the spectrum itself.
      const d = M.dyes.lookup(ch.dye) || M.dyes.lookup(ch.name);
      const sp = M.spectra ? M.spectra.lookup(ch.dye) || (d ? M.spectra.lookup(d.key) : null) : null;
      ch.spectrum = sp || null;
      if (sp) { ch.dyeInfo = d; ch.dyeEx = sp.exPeak || (d && d.ex); ch.dyeEm = sp.emPeak || (d && d.em); ch.dyeSource = 'FPbase'; }
      else if (d) { ch.dyeInfo = d; ch.dyeEx = d.ex; ch.dyeEm = d.em; ch.dyeSource = 'published'; }
      else if (M.isNum(ch.exPeak) || M.isNum(ch.emPeak)) { ch.dyeEx = ch.exPeak; ch.dyeEm = ch.emPeak; ch.dyeSource = 'file'; }
      else { ch.dyeEx = ch.dyeEm = null; ch.dyeSource = null; }
      ch.dyeKnown = ch.dyeSource === 'FPbase' || ch.dyeSource === 'published';
      // laser lines that excite this channel's dye (a track can have several lines on):
      // below the emission peak and within 60 nm of the excitation peak, else the nearest one
      ch.exMain = ch.exLines || [];
      if (M.isNum(ch.dyeEx) && ch.exMain.length > 1) {
        const below = ch.exMain.filter((l) => !M.isNum(ch.dyeEm) || l < ch.dyeEm);
        const near = below.filter((l) => Math.abs(l - ch.dyeEx) <= 60);
        const pool = below.length ? below : ch.exMain;
        ch.exMain = near.length ? near : [pool.reduce((a, l) => (Math.abs(l - ch.dyeEx) < Math.abs(a - ch.dyeEx) ? l : a))];
      }
      ch.lambdaEm = ch.emBand ? (ch.emBand[0] + ch.emBand[1]) / 2 : M.isNum(ch.dyeEm) ? ch.dyeEm : null;
      ch.lambdaEx = ch.exMain.length ? Math.min(...ch.exMain) : ch.exBand ? (ch.exBand[0] + ch.exBand[1]) / 2 : M.isNum(ch.dyeEx) ? ch.dyeEx : null;
      // Colour: the file's channel colour, unless it is missing, or white/grey on a fluorescence
      // channel (ZEN's default for an unnamed dye), which says nothing about the light. Then the
      // emission colour is used, with far-red and near-infrared channels in reddish purple.
      const wl = ch.lambdaEm || ch.lambdaEx;
      const fluo = /fluor/i.test(ch.contrast || '') || !/bright|dic|phase|transmit|oblique|dodt|esid|reflect/i.test(`${ch.contrast || ''} ${ch.illumination || ''}`);
      if (!ch.color || (wl && fluo && M.isGrey(ch.color))) {
        if (ch.color) ch.fileColor = ch.color;
        ch.color = wl ? M.channelHex(wl) : '#cccccc';
        ch.colorGuessed = true;
      }
      // resolution (FWHM), nm
      if (M.isNum(o.na) && o.na > 0) {
        const lam = confocal ? ch.lambdaEx || ch.lambdaEm : ch.lambdaEm || ch.lambdaEx;
        if (lam) {
          let lat = 0.51 * lam / o.na;
          if (lm.airyscan) lat /= 1.7;
          const naN = Math.min(o.na, n * 0.999);
          let ax = 0.88 * lam / (n - Math.sqrt(n * n - naN * naN));
          if (lm.airyscan) ax /= 1.7;
          ch.resLateral = lat * 1e-9;
          ch.resAxial = ax * 1e-9;
          ch.nyquistXY = ch.resLateral / 2.3;
          ch.nyquistZ = ch.resAxial / 2.3;
        }
      }
    }
    const zs = ds.pixel.z;
    if (ds.dims.z > 1 && M.isNum(zs)) lm.zStep = zs;
    if (lm.scan && M.isNum(lm.scan.zoom) && M.isNum(o.mag)) lm.totalMagNote = `${F.auto(o.mag)}× objective, scan zoom ${F.auto(lm.scan.zoom)}`;
  }

  // --------------------------------------------------------------- geometry
  function geometry(ds) {
    const p = ds.pixel, d = ds.dims;
    const g = (ds.geometry = {});
    if (M.isNum(p.x) && M.isNum(d.x)) g.fovX = p.x * d.x;
    if (M.isNum(p.y || p.x) && M.isNum(d.y)) g.fovY = (p.y || p.x) * d.y;
    if (M.isNum(p.z) && d.z > 1) g.depth = p.z * d.z;
    if (ds.kind === 'tomogram' || ds.kind === 'map') {
      const v = (ds.volume = ds.volume || {});
      const pz = M.isNum(p.z) ? p.z : p.x;
      v.sizeX = M.isNum(p.x) ? p.x * d.x : null;
      v.sizeY = M.isNum(p.y || p.x) ? (p.y || p.x) * d.y : null;
      v.sizeZ = M.isNum(pz) ? pz * d.z : null;
      const axis = v.thicknessAxis || 'z';
      v.thicknessPx = axis === 'y' ? d.y : d.z;
      v.thickness = axis === 'y' ? v.sizeY : v.sizeZ;
    }
    if (ds.modality === 'EM' && M.isNum(p.x)) g.nyquist = 2 * p.x;
  }

  // --------------------------------------------------------------- tilt series
  function analyzeTilts(ds) {
    const T = ds.tilt;
    const tilts = (T.tilts || []).filter((t) => M.isNum(t.angle));
    if (!tilts.length) return;
    let order = null, orderSource = '';
    const timed = tilts.filter((t) => t.time instanceof Date && !isNaN(t.time));
    if (timed.length === tilts.length && new Set(timed.map((t) => +t.time)).size > tilts.length * 0.6) {
      order = tilts.slice().sort((a, b) => a.time - b.time || a.section - b.section);
      orderSource = 'time stamps';
    } else if (tilts.every((t) => M.isNum(t.mdocIndex)) && T.source.includes('mdoc')) {
      order = tilts.slice().sort((a, b) => a.mdocIndex - b.mdocIndex);
      orderSource = '.mdoc order';
    } else if (!T.orderUnknown) {
      order = tilts.slice();
      orderSource = 'file order (assumed)';
    }
    tilts.forEach((t) => { delete t.order; });
    if (order) order.forEach((t, i) => { t.order = i + 1; });
    const sorted = tilts.slice().sort((a, b) => a.angle - b.angle);
    const diffs = sorted.slice(1).map((t, i) => t.angle - sorted[i].angle);
    const step = M.median(diffs.filter((x) => x > 0.05)) || null;
    const info = (T.info = {
      n: tilts.length, min: sorted[0].angle, max: sorted[sorted.length - 1].angle, step, orderSource,
      sorted, order,
    });
    info.range = info.max - info.min;
    // scheme
    info.scheme = order ? detectScheme(order.map((t) => t.angle), step || 1) : { type: 'unknown', label: 'Acquisition order unknown' };
    // doses (e-/Å²)
    const doses = tilts.map((t) => t.dose).filter((v) => M.isNum(v) && v > 0);
    if (doses.length) {
      info.totalDose = M.sum(doses);
      info.dosePerTilt = M.median(doses);
      if (doses.length < tilts.length) info.doseIncomplete = true;
    }
    if (order) {
      let cum = 0;
      for (const t of order) {
        t.cumBefore = M.isNum(t.priorDose) ? t.priorDose : cum;
        cum = t.cumBefore + (M.isNum(t.dose) ? t.dose : 0);
        t.cumAfter = cum;
      }
      if (!info.totalDose && cum > 0) info.totalDose = cum;
    }
    // gaps relative to the regular step
    info.gaps = [];
    if (step) {
      diffs.forEach((dd, i) => {
        if (dd > step * 1.6) info.gaps.push({ from: sorted[i].angle, to: sorted[i + 1].angle, missing: Math.round(dd / step) - 1 });
      });
      const irregular = diffs.filter((dd) => Math.abs(dd - step) > Math.max(0.35, step * 0.25) && dd <= step * 1.6);
      if (irregular.length > Math.max(1, diffs.length * 0.15)) info.irregular = true;
    }
    info.missing = info.gaps.reduce((a, g) => a + g.missing, 0);
    // dimension mismatch with the stack
    if (ds.kind === 'tiltseries' && ds.dims.z && !T.context && ds.dims.z !== tilts.length) info.countMismatch = { stack: ds.dims.z, tilts: tilts.length };
    if (M.isNum(ds.em && ds.em.tiltAxis)) info.tiltAxis = ds.em.tiltAxis;
  }

  function detectScheme(seq, step) {
    const n = seq.length;
    if (n < 3) return { type: 'unknown', label: n === 1 ? 'Single tilt' : 'Too few tilts to tell' };
    const tol = Math.max(0.3, step * 0.3);
    const fmtA = (a) => F.deg(a, Math.abs(a - Math.round(a)) < 0.05 ? 0 : 1);
    const start = seq[0];
    const d = seq.slice(1).map((v, i) => v - seq[i]);
    const sg = d.map((x) => (Math.abs(x) < tol ? 0 : Math.sign(x)));
    const nz = sg.filter((s) => s !== 0);
    const startNote = Math.abs(start) > step * 0.75 ? ` starting at ${fmtA(start)}` : '';
    if (nz.length && nz.every((s) => s === nz[0])) {
      return { type: 'unidirectional', label: `Unidirectional, ${fmtA(start)} → ${fmtA(seq[n - 1])}`, start, short: 'Unidirectional' };
    }
    // bidirectional: monotonic one way, jump back next to the start, monotonic the other way
    const s0 = nz[0];
    const k = sg.findIndex((s) => s !== 0 && s !== s0);
    if (k > 0) {
      const after = sg.slice(k + 1).filter((s) => s !== 0);
      const jumpBack = Math.abs(seq[k + 1] - start) <= step * 1.6 + tol;
      if (jumpBack && after.every((s) => s === -s0) && k >= 2) {
        return { type: 'bidirectional', label: `Bidirectional${startNote}: ${fmtA(start)} → ${fmtA(seq[k])}, then ${fmtA(seq[k + 1])} → ${fmtA(seq[n - 1])}`, start, turn: k, short: 'Bidirectional' };
      }
    }
    // dose-symmetric: distance from the start never shrinks, sides alternate in groups
    const rel = seq.map((v) => v - start);
    let maxSoFar = 0, ok = true;
    for (let i = 1; i < n; i++) {
      const a = Math.abs(rel[i]);
      if (a + step * 0.6 + tol < maxSoFar) { ok = false; break; }
      maxSoFar = Math.max(maxSoFar, a);
    }
    const sides = rel.slice(1).map((r) => (Math.abs(r) < tol ? 0 : Math.sign(r))).filter((s) => s !== 0);
    const runs = [];
    for (const s of sides) { if (runs.length && runs[runs.length - 1].s === s) runs[runs.length - 1].n++; else runs.push({ s, n: 1 }); }
    if (ok && runs.length >= 3) {
      const inner = runs.slice(1, -1).map((r) => r.n);
      const group = M.mostCommon(inner.length ? inner : runs.map((r) => r.n)) || 1;
      const tailOneSided = runs[runs.length - 1].n > group * 2 ? runs[runs.length - 1].n : 0;
      return {
        type: 'dose-symmetric', group, start, short: 'Dose-symmetric',
        label: `Dose-symmetric (Hagen)${startNote}, group size ${group}` + (tailOneSided ? `, last ${tailOneSided} tilts on one side` : ''),
      };
    }
    return { type: 'custom', label: 'Custom / unrecognized order', start, short: 'Custom' };
  }
  M.detectScheme = detectScheme;

  /** The microscope stand with its type, e.g. "Axio Imager.Z2 (upright)". */
  M.standText = (lm) => (lm && lm.stand ? lm.stand + (lm.standType ? ` (${lm.standType.toLowerCase()})` : '') : null);

  /** Airyscan use on a Zeiss LSM in words, {value: 'Used' | 'Not used', detail}; null for other systems. */
  M.airyscanSummary = function (lm) {
    const a = lm && lm.airyscanInfo;
    if (!a) return null;
    if (!a.used) {
      const det = a.otherDetectors.length ? `recorded with ${a.otherDetectors.join(', ')}` : null;
      return { value: 'Not used', detail: [det, a.installed ? 'Airyscan detector present on this system' : 'no Airyscan detector listed'].filter(Boolean).join(' · ') };
    }
    let proc = 'raw detector data, not processed';
    if (a.processed) {
      const p = a.processing;
      const dims = M.unique(p.map((x) => x.dims).filter(Boolean)).join('/');
      const str = p.filter((x) => M.isNum(x.strength)).map((x) => F.num(x.strength, 1));
      const how = p.every((x) => x.auto) ? 'auto' : p.some((x) => x.auto) ? 'auto/manual' : 'manual';
      proc = `processed in ZEN (${[dims, str.length ? `${how} strength ${str.join(' / ')}` : null].filter(Boolean).join(', ')})`;
    }
    return { value: 'Used', detail: [a.mode ? `${a.mode} mode` : null, proc].filter(Boolean).join(' · ') };
  };
})();
