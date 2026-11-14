/* EasyMeta - page renderers.  M.pages.list(ds) decides which pages a dataset
 * gets; each page is a function (ds, app) -> DOM element.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const el = (...a) => M.el(...a);
  const has = (v) => v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && !isFinite(v));

  // ------------------------------------------------------------------ widgets
  function card(title, body, opts) {
    opts = opts || {};
    return el('section', { class: 'card ' + (opts.cls || '') },
      title ? el('div', { class: 'cardHead' }, el('h3', null, title), opts.aside || null) : null,
      el('div', { class: 'cardBody' }, body));
  }
  /** Key/value rows; rows with an empty value are dropped. */
  function kv(rows) {
    const t = el('table', { class: 'kv' });
    for (const r of rows) {
      if (!r || !has(r[1])) continue;
      const v = r[1] instanceof Node ? r[1] : document.createTextNode(String(r[1]));
      t.appendChild(el('tr', null, el('th', null, r[0]), el('td', null, v, r[2] ? el('span', { class: 'hint' }, ' ' + r[2]) : null)));
    }
    return t.children.length ? t : el('p', { class: 'dim' }, 'Not recorded in this file.');
  }
  function tiles(items) {
    const box = el('div', { class: 'facts' });
    for (const it of items) {
      if (!it || !has(it.value)) continue;
      box.appendChild(el('div', { class: 'fact' + (it.accent ? ' accent' : '') },
        el('div', { class: 'factLabel' }, it.label),
        el('div', { class: 'factValue', title: String(it.value) }, String(it.value)),
        it.sub ? el('div', { class: 'factSub', title: String(it.sub) }, it.sub) : null));
    }
    return box;
  }
  function grid(headers, rows, opts) {
    const t = el('table', { class: 'grid' + (opts && opts.compact ? ' compact' : '') });
    t.appendChild(el('thead', null, el('tr', null, headers.map((h) => el('th', null, h)))));
    const tb = el('tbody');
    for (const r of rows) tb.appendChild(el('tr', r.cls ? { class: r.cls } : null, (r.cells || r).map((c) => el('td', null, c instanceof Node ? c : has(c) ? String(c) : '—'))));
    t.appendChild(tb);
    return el('div', { class: 'gridWrap' }, t);
  }
  const svgBox = (s, cls) => el('div', { class: 'gfxBox ' + (cls || ''), html: s });
  const swatch = (c) => el('span', { class: 'swatch', style: { background: c || '#888' } });
  const badge = (s, cls) => el('span', { class: 'badge ' + (cls || '') }, s);
  const yes = (b) => (b === undefined || b === null ? null : b ? 'yes' : 'no');
  M.ui = { card, kv, tiles, grid, svgBox, swatch, badge };

  // ------------------------------------------------------------------ helpers
  function pxText(ds) {
    const p = ds.pixel;
    if (!M.isNum(p.x)) return null;
    if (ds.modality === 'EM') return F.pxEM(p.x);
    return F.pxLM(p.x);
  }
  function dimsText(ds) {
    const d = ds.dims;
    const parts = [];
    if (d.x) parts.push(`${F.int(d.x)} × ${F.int(d.y || 1)}`);
    if (d.z > 1) parts.push(`${F.int(d.z)} ${ds.kind === 'tiltseries' ? 'tilts' : ds.kind === 'movie' ? 'frames' : ds.modality === 'EM' && ds.kind !== 'tomogram' && ds.kind !== 'map' ? 'sections' : 'Z'}`);
    if (d.c > 1) parts.push(`${d.c} ch`);
    if (d.t > 1) parts.push(`${F.int(d.t)} T`);
    if (d.s > 1) parts.push(`${d.s} positions`);
    if (d.m > 1) parts.push(`${d.m} tiles`);
    return parts.join(' · ');
  }
  function physText(ds) {
    const g = ds.geometry || {};
    if (!M.isNum(g.fovX)) return null;
    let s = `${F.len(g.fovX)} × ${F.len(g.fovY)}`;
    if (M.isNum(g.depth)) s += ` × ${F.len(g.depth)}`;
    return s;
  }
  const dateText = (d) => (d ? (d instanceof Date ? F.date(d) : String(d)) : null);

  // ------------------------------------------------------------------ page list
  M.pages = {
    list(ds) {
      const p = [{ id: 'overview', label: 'Overview', render: overview }];
      if (ds.modality === 'LM') {
        p.push({ id: 'optics', label: 'Optics & channels', render: lmOptics });
        p.push({ id: 'stack', label: ds.dims.z > 1 || ds.dims.t > 1 ? 'Stack' : 'Image size', render: lmStack });
      } else if (ds.modality === 'EM') {
        p.push({ id: 'beam', label: /SEM|FIB/.test((ds.em && ds.em.mode) || '') ? 'Beam & detector' : 'Beam & camera', render: emBeam });
        if (ds.tilt && ds.tilt.tilts && ds.tilt.tilts.length > 1) p.push({ id: 'tilt', label: 'Tilt series', render: emTilt });
        if (ds.kind === 'tomogram' || ds.kind === 'map') p.push({ id: 'volume', label: ds.kind === 'map' ? 'Map' : 'Volume', render: emVolume });
        if (ds.kind === 'movie') p.push({ id: 'movie', label: 'Frames', render: emMovie });
        if (ds.kind === 'montage') p.push({ id: 'montage', label: 'Montage', render: emMontage });
      } else {
        p.push({ id: 'stack', label: 'Image size', render: lmStack });
      }
      p.push({ id: 'checks', label: 'Checks & methods', render: checksPage });
      p.push({ id: 'raw', label: 'Raw metadata', render: rawPage });
      return p;
    },
  };

  // ------------------------------------------------------------------ overview
  function overview(ds, app) {
    const root = el('div', { class: 'page' });
    const kindCls = ds.modality === 'EM' ? 'em' : ds.modality === 'LM' ? 'lm' : 'unk';
    root.appendChild(el('div', { class: 'pageHead' },
      el('h1', { class: 'pageTitle' }, ds.title || ds.file.name),
      el('div', { class: 'subtitle' },
        badge(ds.modality === 'EM' ? 'Electron microscopy' : ds.modality === 'LM' ? 'Light microscopy' : 'Unknown modality', kindCls),
        badge(ds.kindLabel, 'kind'),
        el('span', { class: 'dim' }, ` ${ds.format.name}${ds.format.detail ? ' · ' + ds.format.detail : ''} · ${F.bytes(ds.file.size)}`))));
    if (ds.series && ds.series.length > 1) root.appendChild(seriesPicker(ds, app));
    const top = el('div', { class: 'overviewGrid' });
    const prev = el('div', { class: 'card previewCard' }, el('div', { class: 'cardHead' }, el('h3', null, 'Preview')), el('div', { class: 'previewBody', id: 'previewBody' }, previewContent(ds)));
    top.appendChild(prev);
    top.appendChild(el('div', null, tiles(factsFor(ds))));
    root.appendChild(top);
    // sources and modality switch
    const src = el('div', { class: 'sourceLine dim' }, 'Read from: ' + (ds.sources.join(', ') || ds.format.name));
    if (ds.companions.length) src.appendChild(el('span', null, ' · companion files: ' + ds.companions.map((c) => `${c.name}${c.relation ? ' (' + c.relation + ')' : ''}`).join(', ')));
    root.appendChild(src);
    // a plain TIFF does not say what made it: its modality is a guess, which the user can change
    if (ds.modality === 'unknown' || ds.modalityGuessed || ds.modalityOverride) root.appendChild(modalitySwitch(ds, app));
    // checks summary
    const important = (ds.checks || []).filter((c) => c.level !== 'ok');
    const oks = (ds.checks || []).filter((c) => c.level === 'ok');
    const list = el('div', { class: 'checkList' });
    important.slice(0, 5).forEach((c) => list.appendChild(checkRow(c)));
    if (!important.length) list.appendChild(el('div', { class: 'dim' }, 'Nothing to flag.'));
    root.appendChild(card('Checks', [list, el('div', { class: 'cardFoot' }, el('span', { class: 'dim' }, `${important.length} to look at · ${oks.length} passed`), el('button', { class: 'linkBtn', onclick: () => app.showPage('checks') }, 'All checks & methods text →'))]));
    if (ds.description) root.appendChild(card('Description', el('p', { class: 'pre' }, ds.description)));
    return root;
  }

  function previewContent(ds) {
    if (ds._thumb && ds._thumb.canvas) {
      const img = el('img', { src: ds._thumbURL, alt: 'preview', class: 'previewImg' });
      return el('div', null, img, el('div', { class: 'previewNote dim' }, ds._thumb.note || ''));
    }
    if (ds._thumbState === 'loading') return el('div', { class: 'previewEmpty dim' }, 'Reading preview…');
    if (ds._thumbState === 'error') return el('div', { class: 'previewEmpty dim' }, 'No preview: ' + ds._thumbError);
    return el('div', { class: 'previewEmpty dim' }, ds.thumbnailNote || (ds.metadataOnly ? 'Metadata file — no image data.' : 'No cheap preview for this file.'));
  }
  M.pages.previewContent = previewContent;

  function seriesPicker(ds, app) {
    const sel = el('select', { class: 'seriesSelect', onchange: (e) => app.openSeries(+e.target.value) });
    ds.series.forEach((s) => sel.appendChild(el('option', { value: s.index, selected: s.index === ds.seriesIndex ? 'selected' : null }, `${s.index + 1}. ${s.name}`)));
    return el('div', { class: 'seriesBar' }, el('label', null, `Image ${ds.seriesIndex + 1} of ${ds.series.length}: `), sel);
  }

  function modalitySwitch(ds, app) {
    const mk = (m, label) => el('button', { class: 'seg' + (ds.modality === m ? ' on' : ''), onclick: () => app.setModality(m) }, label);
    return el('div', { class: 'modalitySwitch' }, el('span', { class: 'dim' }, 'Treat this file as: '), mk('LM', 'Light microscopy'), mk('EM', 'Electron microscopy'));
  }

  function factsFor(ds) {
    const inst = ds.instrument;
    const f = [];
    const instSub = [inst.detailLabel, inst.software && `${inst.software}${inst.softwareVersion ? ' ' + inst.softwareVersion : ''}`].filter(Boolean).join(' · ');
    f.push({ label: ds.modality === 'EM' ? 'Microscope' : 'Microscope', value: inst.label || inst.name || '—', sub: instSub, accent: true });
    if (ds.modality === 'LM') {
      const lm = ds.lm || { objective: {}, channels: [] };
      const o = lm.objective;
      f.push({ label: 'Objective', value: o.name || (o.mag ? `${F.auto(o.mag)}×` : '—'), sub: [o.mag && `${F.auto(o.mag)}×`, M.isNum(o.na) && `NA ${F.num(o.na, 2)}`, o.immersion].filter(Boolean).join(' · ') });
      const nyq = lm.channels.filter((c) => M.isNum(c.nyquistXY));
      const ch0 = nyq.length ? nyq.reduce((a, b) => (b.nyquistXY < a.nyquistXY ? b : a)) : null;
      const samp = ch0 && M.isNum(ds.pixel.x) ? (ds.pixel.x <= ch0.nyquistXY * 1.15 ? 'meets Nyquist' : `Nyquist ≤ ${F.len(ch0.nyquistXY)} (${ch0.dye || ch0.name})`) : '';
      f.push({ label: 'Pixel size', value: pxText(ds) || 'not calibrated', sub: [M.isNum(ds.pixel.z) && ds.dims.z > 1 ? `Z step ${F.len(ds.pixel.z)}` : null, samp].filter(Boolean).join(' · ') });
      f.push({ label: 'Dimensions', value: dimsText(ds), sub: physText(ds) });
      f.push({ label: 'Channels', value: String(lm.channels.length || ds.dims.c || 1), sub: lm.channels.map((c) => c.dye || c.name).slice(0, 4).join(', ') });
      f.push({ label: 'Mode', value: lm.mode || '—', sub: [M.isNum(lm.pinholeAU) && lm.confocal ? `pinhole ${F.num(lm.pinholeAU, 2)} AU` : null, lm.scan && M.isNum(lm.scan.zoom) ? `zoom ${F.auto(lm.scan.zoom)}` : null, lm.camera].filter(Boolean).join(' · ') });
      const ay = M.airyscanSummary(lm);
      if (ay) f.push({ label: 'Airyscan', value: ay.value, sub: ay.detail, accent: ay.value === 'Used' });
      if (ds.dims.t > 1) f.push({ label: 'Time-lapse', value: `${F.int(ds.dims.t)} time points`, sub: M.isNum(ds.timeInterval) ? `every ${F.time(ds.timeInterval)}` : '' });
    } else if (ds.modality === 'EM') {
      const em = ds.em || { camera: {}, filter: {} };
      if (/SEM|FIB/.test(em.mode || '')) {
        f.push({ label: 'Beam', value: M.isNum(em.ht) ? F.kv(em.ht) : '—', sub: [em.mode, M.isNum(em.beamCurrent) && `${F.auto(em.beamCurrent * 1e12)} pA`].filter(Boolean).join(' · ') });
        f.push({ label: 'Magnification', value: M.isNum(em.mag) ? F.mag(em.mag) : '—', sub: M.isNum(em.workingDistance) ? `WD ${F.len(em.workingDistance)}` : '' });
        f.push({ label: 'Pixel size', value: M.isNum(ds.pixel.x) ? F.len(ds.pixel.x) : 'not calibrated', sub: physText(ds) ? `field ${physText(ds)}` : '' });
        f.push({ label: 'Detector', value: em.detector || '—', sub: em.scanInfo || (M.isNum(em.dwellTime) ? `dwell ${F.time(em.dwellTime)}` : '') });
        f.push({ label: 'Image size', value: dimsText(ds) });
      } else {
        f.push({ label: 'Accelerating voltage', value: M.isNum(em.ht) ? F.kv(em.ht) : '—', sub: [em.mode, em.probeMode, em.illuminationMode].filter(Boolean).join(' · ') });
        f.push({ label: 'Magnification', value: M.isNum(em.mag) ? F.mag(em.mag) : '—', sub: [em.magMode || em.lensMode, em.filter && em.filter.slitInserted && M.isNum(em.filter.slitWidth) ? `slit ${F.auto(em.filter.slitWidth)} eV` : null].filter(Boolean).join(' · ') });
        const bin = ds.binning ? `bin ${ds.binning} (raw ${F.pxEM(ds.rawPixel)})` : null;
        f.push({ label: ds.kind === 'tomogram' || ds.kind === 'map' ? 'Voxel size' : 'Pixel size', value: pxText(ds) || 'not calibrated', sub: [M.isNum(ds.pixel.x) && ds.pixel.x < 1e-8 ? `${F.num(ds.pixel.x * 1e9, 4)} nm` : null, bin, ds.geometry && ds.geometry.nyquist ? `Nyquist ${F.len(ds.geometry.nyquist)}` : null].filter(Boolean).join(' · ') });
        f.push({ label: 'Dimensions', value: dimsText(ds), sub: ds.volume && M.isNum(ds.volume.sizeX) ? `${F.len(ds.volume.sizeX)} × ${F.len(ds.volume.sizeY)} × ${F.len(ds.volume.sizeZ)}` : physText(ds) });
        const t = ds.tilt && ds.tilt.info;
        if (t && ds.kind === 'tiltseries') {
          f.push({ label: 'Tilt range', value: `${F.deg(t.min)} to ${F.deg(t.max)}`, sub: [t.step && `${F.deg(t.step)} steps`, `${t.n} tilts`, t.scheme && t.scheme.short].filter(Boolean).join(' · '), accent: true });
          if (M.isNum(t.totalDose)) f.push({ label: 'Dose on Camera', value: F.dose(t.totalDose), sub: M.isNum(t.dosePerTilt) ? `${F.dose(t.dosePerTilt)} per tilt` : '' });
        } else if (ds.parentTilt) {
          f.push({ label: 'Part of tilt series', value: `tilt ${ds.parentTilt.order} of ${ds.parentTilt.total}`, sub: `${F.deg(ds.parentTilt.angle)} in ${ds.parentTilt.series}`, accent: true });
        }
        if (M.isNum(em.dosePerImage) && ds.kind !== 'tiltseries') f.push({ label: 'Dose', value: F.dose(em.dosePerImage), sub: [em.frames || (ds.movie && ds.movie.frames) ? `${F.int(em.frames || ds.movie.frames)} frames` : null, M.isNum(em.exposure) ? F.time(em.exposure) : null].filter(Boolean).join(' · ') });
        const cam = em.camera || {};
        f.push({ label: 'Detector', value: cam.label || '—', sub: [cam.mode, cam.inferred && !cam.commercialName ? 'inferred from sensor size' : null, M.isNum(em.exposure) && ds.kind !== 'tiltseries' ? null : M.isNum(em.exposure) ? `${F.time(em.exposure)} per image` : null].filter(Boolean).join(' · ') });
        if (M.isNum(em.defocusTarget)) f.push({ label: 'Target defocus', value: F.len(em.defocusTarget) });
        if (ds.kind === 'tomogram' && ds.volume && M.isNum(ds.volume.thickness)) f.push({ label: 'Thickness', value: F.len(ds.volume.thickness), sub: `${F.int(ds.volume.thicknessPx)} px along ${ds.volume.thicknessAxis.toUpperCase()}`, accent: true });
      }
    } else {
      f.push({ label: 'Pixel size', value: M.isNum(ds.pixel.x) ? F.len(ds.pixel.x) : 'not calibrated' });
      f.push({ label: 'Dimensions', value: dimsText(ds), sub: physText(ds) });
    }
    f.push({ label: 'Acquired', value: dateText(ds.acquired) || '—', sub: ds.operator ? `by ${ds.operator}` : '' });
    f.push({ label: 'Data type', value: ds.pixelType || '—', sub: ds.bits && !String(ds.pixelType).includes(`${ds.bits}-bit`) ? `${ds.bits}-bit` : '' });
    return f;
  }

  function checkRow(c) {
    const icon = { error: '✖', warn: '!', info: 'i', ok: '✓' }[c.level];
    return el('div', { class: 'check ' + c.level },
      el('span', { class: 'checkIcon' }, icon),
      el('div', { class: 'checkText' }, el('div', { class: 'checkTitle' }, c.title), c.detail ? el('div', { class: 'checkDetail dim' }, c.detail) : null),
      el('span', { class: 'checkArea dim' }, c.area || ''));
  }

  // ------------------------------------------------------------------ LM pages
  function lmOptics(ds) {
    const lm = ds.lm || { objective: {}, channels: [], scan: {} };
    const o = lm.objective;
    const root = el('div', { class: 'page' });
    root.appendChild(pageHead('Optics & channels', `${lm.channels.length} channel${lm.channels.length === 1 ? '' : 's'}${o.name ? ' · ' + o.name : ''}`));
    const row = el('div', { class: 'twoCol' });
    row.appendChild(card('Objective', kv([
      ['Name', o.name], ['Magnification', M.isNum(o.mag) ? `${F.auto(o.mag)}×` : null], ['Numerical aperture', M.isNum(o.na) ? F.num(o.na, 2) : null],
      ['Immersion', o.immersion], ['Refractive index', M.isNum(o.refractiveIndex) ? F.num(o.refractiveIndex, 3) : null],
      ['Correction', o.correction], ['Working distance', M.isNum(o.workingDistance) ? F.len(o.workingDistance) : null],
      ['Medium', o.medium], ['Tube lens', lm.tubeLens ? `${lm.tubeLens.name || ''}${lm.tubeLens.mag ? ' ' + lm.tubeLens.mag + '×' : ''}`.trim() : null],
    ])));
    const sc = lm.scan || {};
    const ay = M.airyscanSummary(lm);
    row.appendChild(card('Microscope', kv([
      ['System', ds.instrument.label], ['Stand', M.standText(lm)], ['Serial number', ds.instrument.serial], ['Mode', lm.mode],
      ['Airyscan', ay ? `${ay.value}${ay.detail ? ' · ' + ay.detail : ''}` : null], ['Spinning disk', lm.spinningDisk], ['Camera', lm.camera],
      ['System magnification', M.isNum(lm.systemMag) ? `${F.auto(lm.systemMag)}× (as recorded)` : null],
      ['Zoom changer', M.isNum(lm.zoomChanger) ? `${F.auto(lm.zoomChanger)}×` : null],
      ['Pinhole', M.isNum(lm.pinholeAU) ? `${F.num(lm.pinholeAU, 2)} AU` : null], ['Scan zoom', M.isNum(sc.zoom) ? F.auto(sc.zoom) : null],
      ['Pixel dwell', M.isNum(sc.pixelTime) ? F.time(sc.pixelTime) : null], ['Scan speed', sc.speed], ['Averaging', sc.averaging || sc.lineAverage],
      ['Scan direction', sc.direction], ['Software', ds.instrument.software && `${ds.instrument.software}${ds.instrument.softwareVersion ? ' ' + ds.instrument.softwareVersion : ''}`],
      ['Converted with', ds.instrument.convertedWith],
    ])));
    root.appendChild(row);
    if (lm.channels.length) {
      const hasSpectra = lm.channels.some((c) => c.spectrum);
      const dyeNote = el('p', { class: 'dim small' },
        'Laser lines, excitation bands and detection windows are the microscope settings stored in the file. ' +
        (hasSpectra ? 'Curves are measured spectra of the named dyes from FPbase (Lambert 2019, Nat Methods 16:277; fpbase.org), used under CC BY-SA 4.0 — per-spectrum credits in SPECTRA_CREDITS.md. ' : '') +
        '○/● mark each dye’s excitation/emission peak' + (hasSpectra ? ' (from its FPbase spectrum, or EasyMeta’s list of published peaks)' : ' (EasyMeta’s list of published peaks)') +
        (lm.channels.some((c) => c.dyeSource === 'file') ? '; ‡ dyes EasyMeta does not know are drawn at the excitation/emission wavelengths stored in the file.' : '.'));
      root.appendChild(card('Excitation and emission', [svgBox(M.gfx.spectrum(ds), 'wide'), dyeNote], { aside: el('span', { class: 'dim' }, 'where the microscope excited and collected light') }));
      const rows = lm.channels.map((c, i) => [
        el('span', null, swatch(c.color), ' ', c.name || `Channel ${i + 1}`),
        c.dye || '—',
        c.dyeKnown ? `${M.isNum(c.dyeEx) ? Math.round(c.dyeEx) : '—'} / ${M.isNum(c.dyeEm) ? Math.round(c.dyeEm) : '—'} nm${c.dyeSource === 'FPbase' ? ' (FPbase)' : ''}` : '—',
        M.isNum(c.exPeak) || M.isNum(c.emPeak) ? `${M.isNum(c.exPeak) ? Math.round(c.exPeak) : '—'} / ${M.isNum(c.emPeak) ? Math.round(c.emPeak) : '—'} nm` : '—',
        c.exLines && c.exLines.length ? c.exLines.join(', ') + ' nm' : c.exBand ? `${Math.round(c.exBand[0])}–${Math.round(c.exBand[1])} nm` : '—',
        c.emBand ? `${Math.round(c.emBand[0])}–${Math.round(c.emBand[1])} nm` : '—',
        c.filterSet || '—',
        c.detector ? [c.detector.name + (typeof c.airyscan === 'string' ? ` (${c.airyscan})` : c.airyscanSum ? ' (Airyscan sum)' : ''), c.detector.type && c.detector.type !== c.detector.name ? c.detector.type : null].filter(Boolean).join(' · ') || '—' : '—',
        c.detector && M.isNum(c.detector.gain) ? F.auto(c.detector.gain) : '—',
        c.power || '—',
        M.isNum(c.exposure) ? F.time(c.exposure) : '—',
        M.isNum(c.pinholeAU) ? `${F.num(c.pinholeAU, 2)} AU` : M.isNum(c.pinholeUm) ? `${F.auto(c.pinholeUm)} µm` : '—',
      ]);
      root.appendChild(card('Channels', grid(['Channel', 'Dye', 'Dye peaks ex/em', 'Ex/em λ in file', 'Excitation used', 'Detection window', 'Filter', 'Detector', 'Gain', 'Power', 'Exposure', 'Pinhole'], rows)));
    }
    return root;
  }

  function lmStack(ds) {
    const root = el('div', { class: 'page' });
    const d = ds.dims, p = ds.pixel;
    root.appendChild(pageHead(ds.dims.z > 1 || ds.dims.t > 1 ? 'Stack' : 'Image size', dimsText(ds)));
    const unit = M.isNum(p.x);
    const sx = unit ? p.x * d.x : d.x, sy = unit ? (p.y || p.x) * (d.y || 1) : d.y || 1;
    const sz = d.z > 1 ? (unit && M.isNum(p.z) ? p.z * d.z : unit ? null : d.z) : 0;
    const L = (n, size) => `${F.int(n)} px` + (unit && M.isNum(size) ? ` · ${F.len(size)}` : '');
    const box = M.gfx.isoBox({
      sx, sy, sz: sz === null ? sx * 0.05 : sz,
      labels: { x: `X ${L(d.x, sx)}`, y: `Y ${L(d.y || 1, sy)}`, z: d.z > 1 ? `Z ${F.int(d.z)} slices` + (unit && M.isNum(p.z) ? ` · ${F.len(p.z * d.z)}` : '') : null },
      texture: ds._thumbURL, slices: d.z, frames: d.t, channels: ds.lm ? ds.lm.channels : null,
      note: sz === null ? 'Z size unknown (no Z calibration): thickness not to scale' : unit ? 'drawn to scale' : 'in pixels (no calibration)',
    });
    const row = el('div', { class: 'twoCol wideLeft' });
    row.appendChild(card('Shape', svgBox(box), { aside: ds.lm && ds.lm.channels.length > 1 ? el('span', { class: 'chips' }, ds.lm.channels.map((c) => el('span', { class: 'chip' }, swatch(c.color), ' ', c.dye || c.name))) : null }));
    row.appendChild(card('Dimensions', kv([
      ['X', `${F.int(d.x)} px`, unit ? `${F.len(sx)} at ${F.pxLM(p.x)}` : null],
      ['Y', `${F.int(d.y || 1)} px`, unit ? `${F.len(sy)} at ${F.pxLM(p.y || p.x)}` : null],
      ['Z', d.z > 1 ? `${F.int(d.z)} slices` : null, M.isNum(p.z) ? `step ${F.len(p.z)}, depth ${F.len(p.z * d.z)}` : null],
      ['Channels', d.c > 1 ? String(d.c) : null], ['Time points', d.t > 1 ? F.int(d.t) : null, M.isNum(ds.timeInterval) ? `every ${F.time(ds.timeInterval)}, total ${F.time(ds.timeInterval * (d.t - 1))}` : null],
      ['Positions / scenes', d.s > 1 ? String(d.s) : null], ['Tiles', d.m > 1 ? String(d.m) : null], ['Spectral bands', d.lambda > 1 ? String(d.lambda) : null],
      ['Data type', ds.pixelType], ['Uncompressed size', d.x ? F.bytes(d.x * (d.y || 1) * (d.z || 1) * (d.c || 1) * (d.t || 1) * (d.s || 1) * Math.ceil((ds.bits || 8) / 8)) : null],
    ])));
    root.appendChild(row);
    const chans = ds.lm ? ds.lm.channels.filter((c) => M.isNum(c.resLateral)) : [];
    if (chans.length) {
      const rows = chans.map((c) => {
        const okXY = M.isNum(p.x) ? p.x <= c.nyquistXY * 1.15 : null;
        const okZ = d.z > 1 && M.isNum(p.z) ? p.z <= c.nyquistZ * 1.15 : null;
        return [el('span', null, swatch(c.color), ' ', c.dye || c.name), M.isNum(ds.lm.confocal ? c.lambdaEx : c.lambdaEm) ? `${Math.round(ds.lm.confocal ? c.lambdaEx : c.lambdaEm)} nm` : '—',
          F.len(c.resLateral), F.len(c.nyquistXY), okXY === null ? '—' : el('span', { class: okXY ? 'okText' : 'warnText' }, okXY ? 'yes' : `no (${F.len(p.x)})`),
          F.len(c.resAxial), F.len(c.nyquistZ), okZ === null ? '—' : el('span', { class: okZ ? 'okText' : 'warnText' }, okZ ? 'yes' : `no (${F.len(p.z)})`)];
      });
      root.appendChild(card('Resolution and sampling', [grid(['Channel', 'λ used', 'XY resolution', 'XY Nyquist pixel', 'XY sampled?', 'Z resolution', 'Z Nyquist step', 'Z sampled?'], rows),
        el('p', { class: 'dim small' }, `Estimated FWHM from 0.51·λ/NA (lateral) and 0.88·λ/(n−√(n²−NA²)) (axial), n = ${F.num(ds.lm.n, 3)}${ds.lm.confocal ? ', excitation wavelength for confocal' : ', emission wavelength for widefield'}${ds.lm.airyscan ? ', ÷1.7 for Airyscan' : ''}; Nyquist = resolution / 2.3. Rules of thumb, not measurements.`)]));
    }
    if (ds.history.length) root.appendChild(card('Processing history', grid(['Program', 'Step', 'Date'], ds.history.map((h) => [h.program || '—', h.text, h.date || '—']))));
    return root;
  }

  // ------------------------------------------------------------------ EM pages
  function emBeam(ds) {
    const em = ds.em || { camera: {}, filter: {}, stage: {} };
    const cam = em.camera || {}, fl = em.filter || {}, st = em.stage || {};
    const inst = ds.instrument;
    const root = el('div', { class: 'page' });
    const sem = /SEM|FIB/.test(em.mode || '');
    root.appendChild(pageHead(sem ? 'Beam & detector' : 'Beam & camera', [inst.label, M.isNum(em.ht) && F.kv(em.ht), M.isNum(em.mag) && F.mag(em.mag)].filter(Boolean).join(' · ')));
    const row = el('div', { class: 'threeCol' });
    row.appendChild(card('Microscope', kv([
      ['Instrument', inst.friendlyName], ['Model', inst.model], ['Manufacturer', inst.manufacturer], ['System ID', inst.systemId], ['Serial / D-number', inst.serial],
      ['Name in file', inst.name], ['Software', inst.software && `${inst.software}${inst.softwareVersion ? ' ' + inst.softwareVersion : ''}`],
      ['Acquired', dateText(ds.acquired)], ['Operator', ds.operator], ['Specimen', ds.specimen], ['Site', inst.site],
    ])));
    if (sem) {
      row.appendChild(card('Beam', kv([
        ['Beam', em.mode], ['Accelerating voltage', M.isNum(em.ht) ? F.kv(em.ht) : null], ['Beam current', M.isNum(em.beamCurrent) ? `${F.auto(em.beamCurrent * 1e12)} pA` : null],
        ['Spot', em.spot], ['Aperture', em.aperture], ['Working distance', M.isNum(em.workingDistance) ? F.len(em.workingDistance) : null],
        ['Horizontal field width', M.isNum(em.hfw) ? F.len(em.hfw) : null], ['Magnification', M.isNum(em.mag) ? F.mag(em.mag) : null],
      ])));
      row.appendChild(card('Detector & scan', kv([
        ['Detector', em.detector], ['Dwell time', M.isNum(em.dwellTime) ? F.time(em.dwellTime) : null], ['Scan', em.scanInfo],
        ['Pixel size', M.isNum(ds.pixel.x) ? F.len(ds.pixel.x) : null], ['Image size', dimsText(ds)], ['Field of view', physText(ds)],
        ['Stage tilt', M.isNum(st.alpha) ? F.deg(st.alpha) : null],
      ])));
      root.appendChild(row);
      return root;
    }
    row.appendChild(card('Illumination', kv([
      ['Accelerating voltage', M.isNum(em.ht) ? F.kv(em.ht) : null, M.isNum(em.wavelength) ? `λ = ${F.num(em.wavelength * 1e12, 3)} pm` : null],
      ['Mode', [em.mode, em.projection].filter(Boolean).join(' · ')], ['Illumination', em.illuminationMode], ['Probe mode', em.probeMode],
      ['Spot size', em.spot], ['Illuminated area', M.isNum(em.illuminatedArea) ? F.len(em.illuminatedArea) : null],
      ['Intensity (C2)', M.isNum(em.intensity) ? F.auto(em.intensity, 4) : null], ['Convergence angle', M.isNum(em.convergenceAngle) ? `${F.auto(em.convergenceAngle * 1e3)} mrad` : null],
      ['C1 aperture', em.c1Aperture], ['C2 aperture', em.c2Aperture], ['Phase plate', em.phasePlate ? 'yes' : null],
    ])));
    row.appendChild(card('Imaging', kv([
      ['Magnification', M.isNum(em.mag) ? F.mag(em.mag) : null, [em.lensMode, em.magMode].filter(Boolean).join(' ')], ['Indicated / actual', M.isNum(em.actualMag) ? F.mag(em.actualMag) : null],
      ['Pixel size', pxText(ds), ds.pixel.source], ['Target defocus', M.isNum(em.defocusTarget) ? F.len(em.defocusTarget) : null],
      ['Defocus readout', M.isNum(em.defocusReadout) ? F.len(em.defocusReadout) : null, 'objective lens setting, not a CTF fit'],
      ['Objective aperture', em.objAperture], ['Cs', M.isNum(em.cs) ? `${F.auto(em.cs * 1e3)} mm` : null],
      ['Camera length', M.isNum(em.cameraLength) ? F.len(em.cameraLength) : null],
      ['Energy filter', fl.present || fl.eftem || fl.slitInserted !== undefined ? [fl.eftem ? 'EFTEM on' : null, fl.slitInserted === undefined ? null : fl.slitInserted ? 'slit in' : 'slit out', M.isNum(fl.slitWidth) ? `${F.auto(fl.slitWidth)} eV` : null, M.isNum(fl.energyShift) ? `shift ${F.auto(fl.energyShift)} eV` : null].filter(Boolean).join(' · ') : null],
      ['Tilt axis angle', M.isNum(em.tiltAxis) ? F.deg(em.tiltAxis, 2) : M.isNum(em.tiltAxisTitle) ? F.deg(em.tiltAxisTitle, 2) : null, M.isNum(em.tiltAxis) && M.isNum(em.tiltAxisTitle) ? `mdoc title: ${F.deg(em.tiltAxisTitle, 2)}` : null],
    ])));
    root.appendChild(row);
    const row2 = el('div', { class: 'twoCol' });
    row2.appendChild(card('Detector & dose', kv([
      ['Detector', cam.label, cam.inferred && !cam.commercialName ? '(inferred from the sensor size)' : null], ['Serial', cam.serial],
      ['Mode', cam.mode], ['Counting', yes(cam.counting)], ['Super-resolution', cam.superResolution ? `${cam.superResolution}×` : null],
      ['Binning', em.binning], ['Readout area', cam.readout ? `${cam.readout[2] - cam.readout[0]} × ${cam.readout[3] - cam.readout[1]} px` : cam.sensor ? `${cam.sensor[0]} × ${cam.sensor[1]} px sensor` : null],
      ['Exposure', M.isNum(em.exposure) ? F.time(em.exposure) : null], ['Frames', em.frames ? F.int(em.frames) : null],
      ['Dose per image', M.isNum(em.dosePerImage) ? F.dose(em.dosePerImage) : null],
      ['Dose rate', M.isNum(em.doseRatePx) ? `${F.auto(em.doseRatePx)} e⁻/px/s` : null, M.isNum(em.doseRateArea) ? `${F.auto(em.doseRateArea)} e⁻/Å²/s` : null],
      ['Counts per electron', cam.countsPerElectron], ['Gain', cam.gain], ['Camera settings', cam.settings], ['Processing', cam.processing],
      ['Location', cam.location],
    ])));
    const fp = M.gfx.beamFootprint(ds);
    if (fp) row2.appendChild(card('Beam footprint vs camera field', svgBox(fp)));
    else row2.appendChild(card('Stage', kv([
      ['X', M.isNum(st.x) ? F.len(st.x) : null], ['Y', M.isNum(st.y) ? F.len(st.y) : null], ['Z', M.isNum(st.z) ? F.len(st.z) : null],
      ['Alpha (tilt)', M.isNum(st.alpha) ? F.deg(st.alpha, 2) : null], ['Beta', M.isNum(st.beta) ? F.deg(st.beta, 2) : null],
    ])));
    root.appendChild(row2);
    if (fp) root.appendChild(card('Stage', kv([
      ['X', M.isNum(st.x) ? F.len(st.x) : null], ['Y', M.isNum(st.y) ? F.len(st.y) : null], ['Z', M.isNum(st.z) ? F.len(st.z) : null],
      ['Alpha (tilt)', M.isNum(st.alpha) ? F.deg(st.alpha, 2) : null], ['Beta', M.isNum(st.beta) ? F.deg(st.beta, 2) : null],
    ])));
    return root;
  }

  function emTilt(ds) {
    const T = ds.tilt, t = T.info || {};
    const root = el('div', { class: 'page' });
    const head = T.context ? (ds.kind === 'movie' ? 'Tilt series this movie belongs to' : 'Source tilt series') : 'Tilt series';
    root.appendChild(pageHead(head, [`${t.n} tilts`, M.isNum(t.min) && `${F.deg(t.min)} to ${F.deg(t.max)}`, t.step && `${F.deg(t.step)} steps`, t.scheme && t.scheme.short].filter(Boolean).join(' · ')));
    root.appendChild(tiles([
      { label: 'Tilt range', value: `${F.deg(t.min)} to ${F.deg(t.max)}`, sub: `${F.deg(t.range)} total`, accent: true },
      { label: 'Increment', value: t.step ? F.deg(t.step) : '—', sub: t.irregular ? 'irregular' : t.missing ? `${t.missing} missing` : 'regular' },
      { label: 'Tilts', value: String(t.n), sub: ds.kind === 'tiltseries' && ds.dims.z !== t.n ? `stack has ${ds.dims.z} images` : '' },
      { label: 'Scheme', value: t.scheme ? t.scheme.short || t.scheme.label : '—', sub: t.scheme && t.scheme.group > 1 ? `group size ${t.scheme.group}` : t.scheme && M.isNum(t.scheme.start) && Math.abs(t.scheme.start) > 1 ? `starts at ${F.deg(t.scheme.start)}` : '' },
      { label: 'Dose on Camera', value: M.isNum(t.totalDose) ? F.dose(t.totalDose) : '—', sub: M.isNum(t.dosePerTilt) ? `${F.dose(t.dosePerTilt)} per tilt` : '' },
      { label: 'Tilt axis', value: M.isNum(t.tiltAxis) ? F.deg(t.tiltAxis, 1) : ds.em && M.isNum(ds.em.tiltAxisTitle) ? F.deg(ds.em.tiltAxisTitle, 1) : '—' },
      { label: 'Order from', value: t.orderSource || 'unknown', sub: `angles from ${T.source}` },
    ]));
    if (t.scheme) root.appendChild(el('div', { class: 'schemeLine' }, t.scheme.label));
    const row = el('div', { class: 'twoCol' });
    row.appendChild(card('Tilt angles', svgBox(M.gfx.tiltFan(T)), { aside: el('span', { class: 'dim' }, 'each line is one tilt, coloured by acquisition order') }));
    const order = M.gfx.tiltOrder(T);
    if (order) row.appendChild(card('Acquisition order', svgBox(order)));
    root.appendChild(row);
    const dose = M.gfx.tiltDose(T);
    if (dose) root.appendChild(el('div', { class: 'twoCol' }, card('Accumulated dose per tilt', svgBox(dose)), card('Why this matters', el('p', { class: 'dim' },
      'Each bar shows how much dose the specimen had already received when that tilt was recorded (grey) plus the dose of the tilt itself (colour). Dose-symmetric schemes keep the low tilts, which carry the most high-resolution information, at the lowest accumulated dose.'))));
    const rows = T.tilts.slice().sort((a, b) => (a.order && b.order ? a.order - b.order : a.section - b.section)).map((x) => ({
      cls: T.highlight !== undefined && x.mdocIndex === T.highlight ? 'hl' : '',
      cells: [x.order || '—', M.isNum(x.section) ? x.section + 1 : '—', F.deg(x.angle, 2), x.time ? F.date(x.time).slice(11) : '—',
        M.isNum(x.dose) ? F.num(x.dose, 2) : '—', M.isNum(x.cumBefore) ? F.num(x.cumBefore, 1) : '—', M.isNum(x.defocus) ? F.num(x.defocus * 1e6, 2) : '—',
        M.isNum(x.mag) ? F.mag(x.mag) : '—', M.isNum(x.exposure) ? F.time(x.exposure) : '—', x.frames || '—', x.subFrame || '—'],
    }));
    root.appendChild(card('All tilts', grid(['Order', 'Section', 'Angle', 'Time', 'Dose (e⁻/Å²)', 'Prior dose', 'Target defocus (µm)', 'Mag', 'Exposure', 'Frames', 'Movie file'], rows, { compact: true })));
    return root;
  }

  function emVolume(ds) {
    const v = ds.volume || {}, d = ds.dims, p = ds.pixel;
    const root = el('div', { class: 'page' });
    root.appendChild(pageHead(ds.kind === 'map' ? '3D map' : 'Tomogram volume', `${F.dims(d.x, d.y, d.z)} voxels` + (M.isNum(p.x) ? ` · ${F.pxEM(p.x)}` : '')));
    const unit = M.isNum(p.x);
    const pz = M.isNum(p.z) ? p.z : p.x;
    // draw with the thickness axis vertical
    const yThick = v.thicknessAxis === 'y';
    const sx = unit ? p.x * d.x : d.x, sy = unit ? (p.y || p.x) * (yThick ? d.z : d.y) : yThick ? d.z : d.y, sz = unit ? (yThick ? (p.y || p.x) * d.y : pz * d.z) : yThick ? d.y : d.z;
    const L = (n, size) => `${F.int(n)} px` + (unit ? ` · ${F.len(size)}` : '');
    const box = M.gfx.isoBox({
      sx, sy, sz,
      labels: { x: `X ${L(d.x, sx)}`, y: `${yThick ? 'Z' : 'Y'} ${L(yThick ? d.z : d.y, sy)}`, z: `thickness ${L(yThick ? d.y : d.z, sz)}` },
      texture: ds._thumbURL, slices: 0, note: unit ? 'drawn to scale; top face shows the central slice' : 'in voxels (no calibration)',
    });
    const row = el('div', { class: 'twoCol wideLeft' });
    row.appendChild(card('Volume', svgBox(box)));
    const r = ds.reconstruction || {};
    row.appendChild(card('Size', kv([
      ['Voxels', F.dims(d.x, d.y, d.z)], ['Voxel size', unit ? F.pxEM(p.x) : null, unit ? `${F.num(p.x * 1e9, 4)} nm` : null],
      ['Physical size', M.isNum(v.sizeX) ? `${F.len(v.sizeX)} × ${F.len(v.sizeY)} × ${F.len(v.sizeZ)}` : null],
      ['Thickness', M.isNum(v.thickness) ? F.len(v.thickness) : null, `${F.int(v.thicknessPx)} px along ${String(v.thicknessAxis || 'z').toUpperCase()}`],
      ['Binning', ds.binning ? `${ds.binning}×` : null, ds.rawPixel ? `tilt series pixel ${F.pxEM(ds.rawPixel)}` : null],
      ['Nyquist', ds.geometry && ds.geometry.nyquist ? F.len(ds.geometry.nyquist) : null],
      ['Data type', ds.pixelType], ['Volume on disk', F.bytes(ds.file.size)],
      ['Reconstruction', r.program ? `${r.program}${r.method ? ' · ' + r.method : ''}` : null], ['Thickness setting', M.isNum(r.thickness) ? `${r.thickness} px (tilt.com)` : null],
      ['Header density range', ds.mrc ? `${F.auto(ds.mrc.header.dmin)} … ${F.auto(ds.mrc.header.dmax)}, mean ${F.auto(ds.mrc.header.dmean)}` : null],
    ])));
    root.appendChild(row);
    if (ds.history.length) root.appendChild(card('Processing history', grid(['Program', 'Step', 'Date'], ds.history.map((h) => [h.program || '—', h.text.replace(/^[A-Za-z0-9_.\-]+\s*:\s*/, ''), h.date || '—']))));
    return root;
  }

  function emMovie(ds) {
    const root = el('div', { class: 'page' });
    const mv = ds.movie || {};
    root.appendChild(pageHead('Frames', `${F.int(mv.frames || ds.dims.z)} frames`));
    const g = M.gfx.frames(ds);
    if (g) root.appendChild(card('Frames', svgBox(g, 'wide')));
    root.appendChild(card('Movie', kv([
      ['Frames', F.int(mv.frames || ds.dims.z)], ['Dose per frame', M.isNum(mv.frameDose) ? F.dose(mv.frameDose) : null],
      ['Dose on Camera', ds.em && M.isNum(ds.em.dosePerImage) ? F.dose(ds.em.dosePerImage) : null], ['Exposure', ds.em && M.isNum(ds.em.exposure) ? F.time(ds.em.exposure) : null],
      ['EER sub-pixel', mv.subPixel ? `${mv.subPixel} × ${mv.subPixel}` : null], ['EER run-length bits', mv.rleBits], ['Gain reference', mv.gainReference],
      ['Belongs to', ds.parentTilt ? `${ds.parentTilt.series}: tilt ${ds.parentTilt.order} of ${ds.parentTilt.total} (${F.deg(ds.parentTilt.angle)})` : null],
    ])));
    return root;
  }

  function emMontage(ds) {
    const root = el('div', { class: 'page' });
    root.appendChild(pageHead('Montage', `${ds.montage.pieces.length} pieces`));
    root.appendChild(card('Piece layout', svgBox(M.gfx.montage(ds))));
    return root;
  }

  // ------------------------------------------------------------------ checks & methods
  function checksPage(ds, app) {
    const root = el('div', { class: 'page' });
    root.appendChild(pageHead('Checks & methods', 'Rules of thumb applied to the metadata; nothing here reads the pixels.'));
    const list = el('div', { class: 'checkList' });
    (ds.checks || []).forEach((c) => list.appendChild(checkRow(c)));
    if (!(ds.checks || []).length) list.appendChild(el('div', { class: 'dim' }, 'No checks apply to this file.'));
    root.appendChild(card('Checks', list));
    const ta = el('textarea', { class: 'methods', rows: 8, spellcheck: 'true' });
    ta.value = ds.methods || 'Not enough metadata to draft a methods paragraph.';
    const copy = el('button', { class: 'primary', onclick: async () => { const ok = await M.copyText(ta.value); copy.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { copy.textContent = 'Copy text'; }, 1500); } }, 'Copy text');
    root.appendChild(card('Methods paragraph (Machine Generated)', [ta, el('div', { class: 'cardFoot' }, el('span', { class: 'dim' }, 'Built only from values found in the file. Check it and add anything the file does not record (sample preparation, processing).'), copy)]));
    return root;
  }

  // ------------------------------------------------------------------ raw metadata
  function rawPage(ds) {
    const root = el('div', { class: 'page' });
    root.appendChild(pageHead('Raw metadata', 'Everything EasyMeta read from the file, as stored.'));
    const search = el('input', { type: 'search', class: 'rawSearch', placeholder: 'Search keys and values…' });
    const out = el('div', { class: 'rawTree' });
    const blobs = Object.keys(ds.rawText || {});
    const dl = blobs.length ? el('div', { class: 'blobs' }, el('span', { class: 'dim' }, 'Download: '), blobs.map((name) => el('button', { class: 'small', onclick: () => M.download(name, ds.rawText[name]) }, name))) : null;
    root.appendChild(el('div', { class: 'rawBar' }, search, dl));
    root.appendChild(out);
    const draw = () => {
      out.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      if (q.length >= 2) out.appendChild(M.rawTree.search(ds.raw, q));
      else out.appendChild(M.rawTree.render(ds.raw));
    };
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 200); });
    draw();
    return root;
  }

  function pageHead(title, sub) {
    return el('div', { class: 'pageHead' }, el('h1', { class: 'pageTitle' }, title), sub ? el('div', { class: 'subtitle dim' }, sub) : null);
  }
})();
