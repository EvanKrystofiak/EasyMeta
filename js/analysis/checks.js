/* EasyMeta - sanity checks.  Each check is {level, title, detail, area} with
 * level 'error' | 'warn' | 'info' | 'ok'.  Thresholds are rules of thumb and
 * are phrased as such in the text.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const ORDER = { error: 0, warn: 1, info: 2, ok: 3 };

  M.runChecks = function (ds) {
    const out = [];
    const add = (level, area, title, detail) => out.push({ level, area, title, detail: detail || '' });
    for (const n of ds.notes) add(n.level === 'error' ? 'error' : n.level === 'warn' ? 'warn' : 'info', 'File', n.text);
    if (!M.isNum(ds.pixel.x) && !ds.metadataOnly) add('warn', 'Calibration', 'No pixel size is stored in this file.', 'Measurements and scale bars will be in pixels unless the calibration is set elsewhere.');
    if (ds.modality === 'LM') lmChecks(ds, add);
    if (ds.modality === 'EM') emChecks(ds, add);
    out.sort((a, b) => ORDER[a.level] - ORDER[b.level]);
    return out;
  };

  // ------------------------------------------------------------------ light
  function lmChecks(ds, add) {
    const lm = ds.lm;
    if (!lm) return;
    const o = lm.objective || {};
    const px = ds.pixel.x;
    const chans = lm.channels.filter((c) => M.isNum(c.nyquistXY));
    if (M.isNum(px) && chans.length) {
      // shortest wavelength = strictest requirement; longest = most lenient
      const strict = chans.reduce((a, b) => (b.nyquistXY < a.nyquistXY ? b : a));
      const easy = chans.reduce((a, b) => (b.nyquistXY > a.nyquistXY ? b : a));
      const rS = px / strict.nyquistXY, rE = px / easy.nyquistXY;
      const have = F.len(px);
      const name = (c) => c.dye || c.name;
      const res = `Estimated lateral resolution ${F.len(strict.resLateral)} for ${name(strict)} (NA ${F.num(o.na, 2)}${lm.airyscan ? ', Airyscan' : ''}).`;
      if (rE > 2) add('warn', 'Sampling', `Undersampled in XY: pixel ${have}, Nyquist needs ≤ ${F.len(easy.nyquistXY)} even for ${name(easy)}.`, res + ' Pixels this large lose detail: fine for overviews, not for resolution-limited work.');
      else if (rS > 1.15) add('info', 'Sampling', `Pixel ${have} is above Nyquist (${F.len(strict.nyquistXY)}) for ${name(strict)}` + (chans.length > 1 && rE <= 1.15 ? `, fine for ${name(easy)}.` : '.'), res);
      else if (rS < 0.4) add('info', 'Sampling', `Oversampled in XY: pixel ${have} is much smaller than needed (${F.len(strict.nyquistXY)}).`, 'More light dose and bigger files than the optics can use; consider a lower zoom or binning.');
      else add('ok', 'Sampling', `XY sampling matches the optics: pixel ${have}, Nyquist ≤ ${F.len(strict.nyquistXY)}.`, res);
      if (ds.dims.z > 1 && M.isNum(ds.pixel.z) && M.isNum(strict.nyquistZ)) {
        const zS = ds.pixel.z / strict.nyquistZ, zE = ds.pixel.z / easy.nyquistZ;
        const msg = `Z-step ${F.len(ds.pixel.z)}; Nyquist ≤ ${F.len(strict.nyquistZ)} for ${name(strict)} (axial resolution ≈ ${F.len(strict.resAxial)}).`;
        if (zE > 2) add('warn', 'Sampling', 'Z-steps are too large for full 3D resolution.', msg);
        else if (zS > 1.15) add('info', 'Sampling', 'Z-steps are somewhat larger than Nyquist.', msg);
        else if (zS < 0.35) add('info', 'Sampling', 'Z-steps much finer than needed.', msg + ' Fewer slices would save time and bleaching.');
        else add('ok', 'Sampling', 'Z-step matches the axial resolution.', msg);
      }
    } else if (M.isNum(px) && !M.isNum(o.na)) {
      add('info', 'Sampling', 'Objective NA unknown, so sampling could not be checked.');
    }
    const ph = lm.pinholeAU || M.mostCommon(lm.channels.map((c) => c.pinholeAU).filter(M.isNum));
    if (M.isNum(ph) && lm.confocal && !lm.airyscan) {
      if (ph > 1.3) add('info', 'Optics', `Pinhole ${F.auto(ph)} AU: thicker optical sections.`, 'Above about 1 AU the confocal gives less sectioning and resolution; fine when signal is weak.');
      else if (ph < 0.6) add('info', 'Optics', `Pinhole ${F.auto(ph)} AU: small.`, 'Slightly better resolution at the cost of much less signal.');
    }
    // spectra: measured FPbase spectra where bundled, otherwise published peaks; never estimated curves
    const C = lm.channels;
    for (let i = 0; i < C.length; i++) {
      const a = C[i];
      if (a.emBand && a.dyeKnown && (a.dyeEm < a.emBand[0] - 15 || a.dyeEm > a.emBand[1] + 15)) {
        add('warn', 'Spectra', `${a.name}: ${a.dye} has its emission peak at ${Math.round(a.dyeEm)} nm, outside the detection window ${Math.round(a.emBand[0])}–${Math.round(a.emBand[1])} nm.`, 'The dye label or the detector setting may be wrong.');
      }
      const inside = (a.exMain || a.exLines || []).filter((l) => a.emBand && l > a.emBand[0] + 2 && l < a.emBand[1] - 2);
      if (inside.length && a.emBand[1] - a.emBand[0] < 200) add('info', 'Spectra', `${a.name}: the detection window ${Math.round(a.emBand[0])}–${Math.round(a.emBand[1])} nm includes the ${inside.join(', ')} nm laser line.`, 'The main beam splitter normally blocks it, but reflections from the coverslip can still reach the detector.');
      for (let j = 0; j < C.length; j++) {
        if (i === j) continue;
        const b = C[j];
        if (a.track !== undefined && b.track !== undefined && a.track !== b.track) continue; // sequential tracks
        const sameDye = (a.spectrum && a.spectrum === b.spectrum) || (a.dyeInfo && b.dyeInfo && a.dyeInfo.key === b.dyeInfo.key);
        if (sameDye) continue; // the same fluorophore seen by two detectors
        if (a.derived || b.derived) continue; // lifetime channels re-use another channel's photons
        if (j > i && a.emBand && b.emBand) {
          const ov = Math.min(a.emBand[1], b.emBand[1]) - Math.max(a.emBand[0], b.emBand[0]);
          if (ov > 10) add('info', 'Spectra', `Detection windows of ${a.name} and ${b.name} overlap by ${Math.round(ov)} nm.`, a.track !== undefined ? 'They were recorded in the same track (simultaneously).' : 'If they were recorded at the same time, signal can bleed between them.');
        }
        const together = a.track !== undefined && a.track === b.track;
        const lines = b.exMain && b.exMain.length ? b.exMain : b.exLines || [];
        if (a.spectrum && a.spectrum.em && b.emBand && lines.length) {
          // bleed-through from measured spectra: share of A's emission in B's window, and how
          // strongly B's laser excites A
          const frac = M.spectra.area(a.spectrum.em, b.emBand[0], b.emBand[1]) / Math.max(1, M.spectra.area(a.spectrum.em, 0, 2000));
          const exc = a.spectrum.ex ? Math.max(...lines.map((l) => M.spectra.at(a.spectrum.ex, l))) : null;
          if (frac > 0.15 && exc !== null && exc > 0.1) {
            add('info', 'Spectra', `Bleed-through of ${a.dye} into ${b.name}: ${Math.round(frac * 100)} % of its emission falls in that window, and the ${lines.join('/')} nm laser excites it at ${Math.round(exc * 100)} % of peak.`,
              (together ? 'The two channels were recorded in the same track.' : 'Only matters if the two channels were recorded at the same time.') + ` From FPbase spectra${a.spectrum.ex && a.spectrum.ex.kind === 'ab' ? ' (absorption used for excitation)' : ''}.`);
          }
        } else if (b.emBand && a.dyeSource === 'published' && a.dyeEm >= b.emBand[0] && a.dyeEm <= b.emBand[1] && together) {
          // no spectrum bundled: fall back to the emission peak
          add('info', 'Spectra', `${a.dye}'s emission peak (${Math.round(a.dyeEm)} nm) lies inside the detection window of ${b.name}, recorded in the same track.`, 'Expect some of its signal in that channel.');
        }
      }
    }
    if (o.medium && o.immersion && !new RegExp(o.immersion.slice(0, 3), 'i').test(o.medium)) add('info', 'Optics', `Objective immersion is ${o.immersion} but the medium is recorded as ${o.medium}.`);
  }

  // ------------------------------------------------------------------ electron
  function emChecks(ds, add) {
    const em = ds.em || {};
    if (ds.pixelAlt && M.isNum(ds.pixel.x)) {
      for (const alt of ds.pixelAlt) {
        if (M.isNum(alt.value) && Math.abs(alt.value - ds.pixel.x) / ds.pixel.x > 0.01) add('warn', 'Calibration', `Pixel size differs between sources: ${F.pxEM(ds.pixel.x)} (${ds.pixel.source}) vs ${F.pxEM(alt.value)} (${alt.source}).`, 'Binning or a re-calibration may explain it; check which value your processing uses.');
      }
    }
    const t = ds.tilt && ds.tilt.info;
    if (t && !ds.tilt.context) {
      if (t.countMismatch) add('warn', 'Tilt series', `The stack has ${t.countMismatch.stack} images but ${t.countMismatch.tilts} tilt angles were found.`, 'Some tilts may have been removed, or the metadata belongs to a different stack.');
      if (t.missing > 0) add('warn', 'Tilt series', `${t.missing} tilt${t.missing === 1 ? '' : 's'} missing from the regular ${F.deg(t.step)} steps.`, t.gaps.map((g) => `gap ${F.deg(g.from)} → ${F.deg(g.to)}`).join('; '));
      else if (t.step) add('ok', 'Tilt series', `No missing tilts (${t.n} tilts, ${F.deg(t.step)} steps).`);
      if (t.irregular) add('info', 'Tilt series', 'Tilt increments are irregular.', 'Expected for some schemes (e.g. a finer step near 0°).');
      if (t.max - t.min < 100) add('info', 'Tilt series', `Tilt range is ${F.deg(t.min, 0)} to ${F.deg(t.max, 0)} (${F.deg(t.range, 0)} total).`, 'A smaller range means a larger missing wedge and more elongation along Z.');
      if (Math.abs(t.max + t.min) > 8) add('info', 'Tilt series', `Tilt range is asymmetric around 0° (centre ${F.deg((t.max + t.min) / 2)}).`, 'Typical for pre-tilted FIB lamellae.');
      if (M.isNum(t.totalDose)) {
        if (t.totalDose > 250) add('warn', 'Dose', `High Dose on Camera: ${F.dose(t.totalDose)}.`, 'Cryo-ET series usually stay below ~180 e⁻/Å²; radiation damage builds up at the end of the series.');
        else add('info', 'Dose', `Dose on Camera ${F.dose(t.totalDose)} (median ${F.dose(t.dosePerTilt)} per tilt).`, 'Typical cryo-ET totals are about 60–180 e⁻/Å².');
      }
      if (/assumed/.test(t.orderSource)) add('info', 'Tilt series', 'Acquisition order is assumed from the file order.', 'No time stamps were found; open the .mdoc with the stack to know the real order.');
      if (!ds.tilt.tilts.some((x) => M.isNum(x.order))) add('info', 'Tilt series', 'Acquisition order unknown (angles only).');
      const mags = M.unique(ds.tilt.tilts.map((x) => x.mag).filter(M.isNum));
      if (mags.length > 1) add('warn', 'Tilt series', `Magnification changes within the series (${mags.map(F.mag).join(', ')}).`);
    }
    if (ds.kind === 'tomogram' && ds.volume) {
      const v = ds.volume;
      if (M.isNum(v.thickness) && v.thickness > 600e-9) add('info', 'Tomogram', `Volume is ${F.len(v.thickness)} thick.`, 'Unusually thick for cryo-ET; the reconstruction may include empty space above/below the sample.');
      if (ds.binning) add('ok', 'Tomogram', `Reconstructed at bin ${ds.binning} relative to the tilt series (${F.pxEM(ds.rawPixel)} → ${F.pxEM(ds.pixel.x)}).`);
    }
    const cam = em.camera || {};
    if (M.isNum(em.doseRatePx) && (cam.counting || /EER/.test(cam.mode || ''))) {
      const lim = /falcon|EER/i.test((cam.label || '') + (cam.mode || '')) ? 15 : 25;
      if (em.doseRatePx > lim) add('warn', 'Detector', `Dose rate ${F.auto(em.doseRatePx)} e⁻/px/s is high for electron counting.`, 'Coincidence loss reduces DQE above roughly ' + lim + ' e⁻/px/s on this detector type.');
      else add('ok', 'Detector', `Dose rate ${F.auto(em.doseRatePx)} e⁻/px/s is fine for counting.`);
    }
    const lowMag = (M.isNum(em.mag) && em.mag < 5000) || /^LM$/i.test(em.lensMode || '');
    if (M.isNum(em.defocusTarget) && Math.abs(em.defocusTarget) > 8e-6 && !lowMag) add('info', 'Optics', `Large target defocus (${F.len(em.defocusTarget)}).`, 'Strong low-resolution contrast but CTF zeros start early.');
    if (em.phasePlate) add('info', 'Optics', 'A phase plate was used.');
  }
})();
