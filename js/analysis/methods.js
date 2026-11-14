/* EasyMeta - a draft methods paragraph assembled from the metadata.  Only
 * values present in the file are used; the user is asked to check it.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const join = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
  const ang = (a) => F.deg(a, Math.abs(a - Math.round(a)) < 0.05 ? 0 : 1).replace('−', '−');
  const um = (m, d) => (M.isNum(m) ? F.num(m * 1e6, d === undefined ? 1 : d) : null);
  /** "a" or "an" before a name (vowel sound; 8 reads "eight"). */
  const an = (w) => (/^(?:[aeio]|8|11|18|LSM|FV|SP\d|X\b)/i.test(String(w || '').trim()) ? 'an' : 'a');

  M.methodsText = function (ds) {
    try {
      if (ds.modality === 'LM') return lmText(ds);
      if (ds.modality === 'EM') return emText(ds);
    } catch (e) { return ''; }
    return '';
  };

  function lmText(ds) {
    const lm = ds.lm || { objective: {}, channels: [] };
    const o = lm.objective || {};
    const s = [];
    const what = { zstack: 'Z-stacks', timelapse: 'Time-lapse series', hyperstack: 'Z-stack time-lapse series' }[ds.kind] || 'Images';
    const maker = ds.instrument.manufacturer && ds.instrument.manufacturer.replace(/^Carl /, '');
    let scope = ds.instrument.friendlyName || (ds.instrument.model ? [maker, ds.instrument.model].filter(Boolean).join(' ') : maker ? `${maker} microscope` : 'microscope');
    if (lm.stand && !scope.includes(lm.stand)) scope += ` (${lm.stand}${lm.standType ? ' ' + lm.standType.toLowerCase() : ''} stand)`;
    const ayInfo = lm.airyscanInfo;
    const ay = lm.airyscan ? ` with the Airyscan detector${ayInfo && ayInfo.mode ? ` in ${ayInfo.mode} mode` : ''}` : '';
    const mode = lm.mode && !lm.airyscan ? ` in ${lm.mode.replace(/\s*\(.*\)/, '').toLowerCase()} mode` : '';
    s.push(`${what} were acquired on ${an(scope)} ${scope}${ay}${mode}` + (ds.instrument.software && !ds.instrument.softwareIsConverter ? ` using ${ds.instrument.software}${ds.instrument.softwareVersion ? ' ' + ds.instrument.softwareVersion : ''}` : '') + '.');
    if (o.name || o.mag) {
      const extras = [M.isNum(o.na) && !String(o.name || '').includes(F.num(o.na, 2)) ? `NA ${F.num(o.na, 2)}` : null, o.immersion && !new RegExp(o.immersion, 'i').test(o.name || '') ? `${o.immersion.toLowerCase()} immersion` : null].filter(Boolean);
      const objName = o.name || F.auto(o.mag) + '×';
      s.push(`${/^[aeiou]/i.test(objName) || /^8/.test(objName) ? 'An' : 'A'} ${objName} objective${extras.length ? ' (' + extras.join(', ') + ')' : ''} was used.`);
    }
    const chs = (lm.channels || []).filter((c) => !c.airyscanSum && (c.dye || (c.exLines && c.exLines.length) || c.emBand));
    if (chs.length) {
      const dyeCount = {};
      chs.forEach((c) => { if (c.dye) dyeCount[c.dye] = (dyeCount[c.dye] || 0) + 1; });
      const parts = chs.map((c) => {
        const lines = c.exMain && c.exMain.length ? c.exMain : c.exLines || [];
        const ex = lines.length ? `${join(lines.map((l) => l + ''))} nm` : c.exBand ? `${Math.round(c.exBand[0])}–${Math.round(c.exBand[1])} nm` : null;
        const em = c.emBand ? `${Math.round(c.emBand[0])}–${Math.round(c.emBand[1])} nm` : null;
        const who = c.dye ? (dyeCount[c.dye] > 1 ? `${c.dye} (${c.name})` : c.dye) : c.name;
        if (ex && em) return `${who} was excited at ${ex} and detected at ${em}`;
        if (ex) return `${who} was excited at ${ex}`;
        if (em) return `${who} was detected at ${em}`;
        return `${who} was imaged`;
      });
      const first = join(parts);
      // keep names such as mKate / eGFP as written; capitalise ordinary words
      s.push((/^[a-z][A-Z]/.test(first) ? first : M.cap(first)) + '.');
    }
    if (ayInfo && ayInfo.used && ayInfo.processed) {
      const p = ayInfo.processing;
      const dims = M.unique(p.map((x) => x.dims).filter(Boolean)).join('/');
      const str = p.filter((x) => M.isNum(x.strength)).map((x) => F.num(x.strength, 1));
      const how = p.every((x) => x.auto) ? 'automatic' : p.some((x) => x.auto) ? 'automatic and manual' : 'manual';
      s.push(`The raw Airyscan data were processed in ZEN with ${dims ? dims + ' ' : ''}Airyscan processing${str.length ? ` (${how} strength ${join(str)})` : ''}.`);
    }
    const ph = lm.pinholeAU;
    if (M.isNum(ph) && lm.confocal && !lm.airyscan) s.push(`The pinhole was set to ${F.num(ph, 2)} Airy units.`);
    if (M.isNum(ds.pixel.x)) {
      const fov = ds.geometry && ds.geometry.fovX ? ` (${F.len(ds.geometry.fovX)} × ${F.len(ds.geometry.fovY)} field of view)` : '';
      s.push(`Images were ${F.dims(ds.dims.x, ds.dims.y)} pixels with a pixel size of ${F.pxLM(ds.pixel.x)}${fov}.`);
    }
    if (ds.dims.z > 1) s.push(`Z-stacks of ${ds.dims.z} slices were collected` + (M.isNum(ds.pixel.z) ? ` at ${F.len(ds.pixel.z)} intervals` : '') + '.');
    if (ds.dims.t > 1) s.push(`${ds.dims.t} time points were recorded` + (M.isNum(ds.timeInterval) ? ` every ${F.time(ds.timeInterval)}` : '') + '.');
    return s.join(' ');
  }

  function emText(ds) {
    const em = ds.em || { camera: {}, filter: {} };
    const inst = ds.instrument;
    const scope = inst.friendlyName || [inst.manufacturer && /thermo/i.test(inst.manufacturer) ? 'Thermo Fisher' : inst.manufacturer, inst.model].filter(Boolean).join(' ') || inst.name || 'an electron microscope';
    const sw = inst.software ? ` using ${inst.software}${inst.softwareVersion ? ' ' + inst.softwareVersion.split('.').slice(0, 2).join('.') : ''}` : '';
    const kv = M.isNum(em.ht) ? ` operated at ${F.auto(em.ht / 1000)} kV` : '';
    const cam = em.camera || {};
    const camText = cam.label ? `, recording on a ${cam.commercialName || cam.inferred || cam.name}${cam.mode ? ` in ${String(cam.mode).toLowerCase().replace(/\s*\(.*\)/, '')} mode` : ''}` : '';
    const filt = em.filter && (em.filter.slitInserted || em.filter.present) && M.isNum(em.filter.slitWidth) ? ` behind an energy filter (slit width ${F.auto(em.filter.slitWidth)} eV)` : '';
    const px = M.isNum(ds.pixel.x) ? ` (pixel size ${F.pxEM(ds.pixel.x)})` : '';
    const mag = M.isNum(em.mag) ? ` at a nominal magnification of ${F.mag(em.mag)}${px}` : px ? ` with a pixel size of ${F.pxEM(ds.pixel.x)}` : '';
    const s = [];
    if (/SEM|FIB/.test(em.mode || '')) {
      s.push(`Images were acquired on ${an(scope)} ${scope}${kv}${sw}` + (em.detector ? ` with the ${em.detector} detector` : '') + (M.isNum(em.workingDistance) ? ` at a working distance of ${F.num(em.workingDistance * 1e3, 1)} mm` : '') + (M.isNum(ds.pixel.x) ? `, pixel size ${F.len(ds.pixel.x)}` : '') + (M.isNum(em.beamCurrent) ? `, beam current ${F.auto(em.beamCurrent * 1e12)} pA` : '') + '.');
      return s.join(' ');
    }
    const t = ds.tilt && ds.tilt.info;
    const df = M.isNum(em.defocusTarget) ? `a target defocus of ${F.num(em.defocusTarget * 1e6, 1)} µm` : null;
    if (ds.kind === 'tiltseries' || (ds.kind === 'movie' && ds.parentTilt)) {
      s.push(`Tilt series were collected on ${an(scope)} ${scope}${kv}${sw}${camText}${filt}.`);
      const illum = [M.isNum(em.spot) ? `spot size ${em.spot}` : null, M.isNum(em.illuminatedArea) ? `an illuminated area of ${F.num(em.illuminatedArea * 1e6, 2)} µm` : null, em.c2Aperture ? `a ${em.c2Aperture} C2 aperture` : null].filter(Boolean);
      s.push(`Images were recorded${mag}` + (em.probeMode ? ` in ${em.probeMode.toLowerCase()} mode` : '') + (illum.length ? ` with ${join(illum)}` : '') + '.');
      if (t) {
        const sch = t.scheme && t.scheme.type !== 'unknown' && t.scheme.type !== 'custom' ? `a ${t.scheme.short.toLowerCase()} scheme` + (t.scheme.group > 1 ? ` (group size ${t.scheme.group})` : '') : 'a tilt scheme';
        s.push(`Using ${sch}, ${t.n} tilts were collected from ${ang(t.min)} to ${ang(t.max)}` + (t.step ? ` in ${F.num(t.step, t.step % 1 ? 1 : 0)}° increments` : '') + (M.isNum(t.totalDose) ? `, with a total dose on camera of about ${Math.round(t.totalDose)} e⁻/Å²` : '') + (df ? ` and ${df}` : '') + '.');
      }
      return s.join(' ');
    }
    if (ds.kind === 'tomogram' || ds.kind === 'map') {
      const r = ds.reconstruction || {};
      const v = ds.volume || {};
      s.push(`${ds.kind === 'map' ? 'The map' : 'The tomogram'} has ${F.dims(ds.dims.x, ds.dims.y, ds.dims.z)} voxels` + (M.isNum(ds.pixel.x) ? ` at ${F.pxEM(ds.pixel.x)} per voxel` + (ds.binning ? ` (bin ${ds.binning})` : '') : '') + (M.isNum(v.sizeX) ? `, covering ${F.len(v.sizeX)} × ${F.len(v.sizeY)} × ${F.len(v.sizeZ)}` : '') + '.');
      if (r.program) s.push(`It was reconstructed with ${r.program}` + (r.method ? ` (${r.method})` : '') + '.');
      else {
        const prog = (ds.history || []).find((h) => /^tilt$/i.test(h.program) || /tomographic/i.test(h.text));
        if (prog) s.push('It was reconstructed with IMOD (tilt).');
      }
      if (t && ds.tilt.context) s.push(`The source tilt series covered ${ang(t.min)} to ${ang(t.max)} (${t.n} tilts)` + (M.isNum(t.totalDose) ? ` with a total dose on camera of about ${Math.round(t.totalDose)} e⁻/Å²` : '') + (M.isNum(em.ht) ? `, recorded at ${F.auto(em.ht / 1000)} kV` + (M.isNum(em.mag) ? ` and ${F.mag(em.mag)}` : '') : '') + '.');
      return s.join(' ');
    }
    const what = ds.kind === 'movie' ? 'Movies' : ds.kind === 'gain' ? 'The gain reference' : ds.kind === 'montage' ? 'Montages' : 'Images';
    s.push(`${what} were acquired on ${an(scope)} ${scope}${kv}${sw}${camText}${filt}${mag}.`);
    const dose = M.isNum(em.dosePerImage) ? `a dose of ${F.num(em.dosePerImage, em.dosePerImage < 10 ? 2 : 1)} e⁻/Å²` : null;
    const fr = em.frames || (ds.movie && ds.movie.frames);
    const bits = [dose && (fr > 1 ? `${dose} fractionated into ${fr} frames` : dose), M.isNum(em.exposure) ? `an exposure of ${F.time(em.exposure)}` : null, df].filter(Boolean);
    if (bits.length) s.push(`Each image used ${join(bits)}.`);
    return s.join(' ');
  }
})();
