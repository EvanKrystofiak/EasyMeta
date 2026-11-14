/* EasyMeta - report and exports: printable one-page report (save as PDF from
 * the print dialog), standalone HTML report, JSON of everything, CSV summary.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const E = M.esc;

  const REPORT_CSS = `
  @page { size: A4; margin: 14mm; }
  body { font: 11px/1.45 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; color: #1c2230; margin: 0; background: #fff; }
  h1 { font-size: 20px; margin: 0 0 2px; } h2 { font-size: 13px; margin: 18px 0 6px; border-bottom: 2px solid #17c3b2; padding-bottom: 3px; }
  .sub { color: #5b6475; margin-bottom: 10px; } .brand { float: right; color: #0f9d8f; font-weight: 700; }
  table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid #e3e6eb; vertical-align: top; }
  th { color: #5b6475; font-weight: 600; width: 34%; } table.grid th { width: auto; background: #f2f4f7; } table.grid td { font-variant-numeric: tabular-nums; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; } .gfx { max-width: 100%; height: auto; }
  .sum { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 14px; align-items: start; } .sum.nothumb { grid-template-columns: 1fr; }
  .thumb { width: 190px; height: 190px; object-fit: contain; background: #12151b; border-radius: 4px; }
  .chk { padding: 3px 0; } .chk b { display: inline-block; width: 16px; } .error b { color: #c0392b; } .warn b { color: #b7791f; } .info b { color: #2b6cb0; } .ok b { color: #2f855a; }
  .methods { background: #f2f9f8; border-left: 3px solid #17c3b2; padding: 8px 10px; }
  .foot { margin-top: 18px; color: #8a93a3; font-size: 9px; }
  .avoid { break-inside: avoid; }
  /* graphics on paper */
  .g-plotbg { fill: #f7f8fa; } .g-grid { stroke: #e1e4ea; stroke-width: 1; } .g-axis { stroke: #8a93a3; } .g-zero { stroke: #17c3b2; }
  .g-label, .g-dimlabel, .g-lanelabel { fill: #1c2230; font-size: 13px; } .g-tick, .g-dim, .g-tiny { fill: #5b6475; font-size: 12px; } .g-tiny { font-size: 11px; }
  .g-laser { font-size: 12px; font-weight: 700; } .g-bandtext { fill: #fff; font-size: 11px; } .g-lane { fill: #f2f4f7; }
  .g-legendband { fill: #9aa3b2; } .g-legendline { stroke: #1c2230; }
  .g-stokes { stroke: #1c2230; stroke-opacity: 0.5; stroke-width: 1.5; stroke-dasharray: 2 3; } .g-expeak { fill: #ffffff; stroke-width: 2.5; } .g-empeak { stroke: #1c2230; stroke-width: 1; }
  .g-face-top { fill: #dff3f1; stroke: #0f9d8f; } .g-face-top-edge { fill: none; stroke: #0f9d8f; stroke-width: 1.5; } .g-face-left { fill: #c4e7e3; stroke: #0f9d8f; } .g-face-right { fill: #a9dbd5; stroke: #0f9d8f; }
  .g-ghost { fill: none; stroke: #9aa3b2; stroke-dasharray: 3 3; } .g-slice { stroke: #0f9d8f; stroke-opacity: 0.35; } .g-leader { stroke: #9aa3b2; }
  .g-hatch { stroke: #e0574a; stroke-opacity: 0.45; stroke-width: 2; } .g-wedge { fill-opacity: 1; }
  .g-specimen { fill: #9aa3b2; } .g-first { fill: #17c3b2; stroke: #1c2230; } .g-last { fill: #e0574a; stroke: #1c2230; } .g-trace { stroke: #9aa3b2; stroke-width: 1.2; }
  .g-prior { fill: #c9ced8; } .g-beam { fill: #17c3b2; fill-opacity: 0.18; stroke: #0f9d8f; stroke-width: 2; } .g-camera { fill: none; stroke: #1c2230; stroke-width: 2; }
  .g-beamlabel { fill: #0f9d8f; font-size: 13px; } .g-warntext { fill: #b7791f; font-size: 12px; } .g-frame { fill: #17c3b2; } .g-piece { fill: #dff3f1; stroke: #0f9d8f; }
  `;

  function rows(list) {
    return list.filter((r) => r && r[1] !== null && r[1] !== undefined && r[1] !== '' && r[1] !== '—').map((r) => `<tr><th>${E(r[0])}</th><td>${E(r[1])}</td></tr>`).join('');
  }

  function summaryRows(ds) {
    const inst = ds.instrument;
    const out = [
      ['File', ds.file.path || ds.file.name], ['Format', `${ds.format.name}${ds.format.detail ? ' · ' + ds.format.detail : ''}`], ['Size on disk', F.bytes(ds.file.size)],
      ['Type', `${ds.modality === 'EM' ? 'Electron' : ds.modality === 'LM' ? 'Light' : 'Unknown'} microscopy · ${ds.kindLabel}`],
      ['Microscope', inst.label], ['Microscope details', inst.detailLabel], ['Software', inst.software && `${inst.software}${inst.softwareVersion ? ' ' + inst.softwareVersion : ''}`],
      ['Converted with', inst.convertedWith],
      ['Acquired', ds.acquired ? (ds.acquired instanceof Date ? F.date(ds.acquired) : String(ds.acquired)) : null], ['Operator', ds.operator],
      ['Dimensions', F.dims(ds.dims.x, ds.dims.y, ds.dims.z > 1 ? ds.dims.z : null) + (ds.dims.c > 1 ? ` · ${ds.dims.c} channels` : '') + (ds.dims.t > 1 ? ` · ${ds.dims.t} time points` : '')],
      ['Pixel size', M.isNum(ds.pixel.x) ? (ds.modality === 'EM' ? F.pxEM(ds.pixel.x) : F.pxLM(ds.pixel.x)) + (M.isNum(ds.pixel.z) && ds.dims.z > 1 && ['zstack', 'hyperstack', 'tomogram', 'map'].includes(ds.kind) ? ` · Z ${F.len(ds.pixel.z)}` : '') : 'not calibrated'],
      ['Field of view', ds.geometry && M.isNum(ds.geometry.fovX) ? `${F.len(ds.geometry.fovX)} × ${F.len(ds.geometry.fovY)}` : null],
      ['Data type', ds.pixelType], ['Metadata sources', ds.sources.join(', ')],
    ];
    if (ds.modality === 'LM' && ds.lm) {
      const o = ds.lm.objective;
      const ay = M.airyscanSummary(ds.lm);
      out.push(['Stand', M.standText(ds.lm)], ['Objective', [o.name, M.isNum(o.na) && `NA ${F.num(o.na, 2)}`, o.immersion].filter(Boolean).join(' · ')], ['Mode', ds.lm.mode],
        ['Airyscan', ay ? `${ay.value}${ay.detail ? ' · ' + ay.detail : ''}` : null], ['Pinhole', M.isNum(ds.lm.pinholeAU) ? `${F.num(ds.lm.pinholeAU, 2)} AU` : null]);
    }
    if (ds.modality === 'EM' && ds.em) {
      const em = ds.em;
      out.push(['Accelerating voltage', M.isNum(em.ht) ? F.kv(em.ht) : null], ['Magnification', M.isNum(em.mag) ? F.mag(em.mag) : null],
        ['Illumination', [em.illuminationMode, em.probeMode, M.isNum(em.spot) && `spot ${em.spot}`, M.isNum(em.illuminatedArea) && `illuminated area ${F.len(em.illuminatedArea)}`, em.c2Aperture && `C2 ${em.c2Aperture}`].filter(Boolean).join(' · ')],
        ['Detector', [em.camera && em.camera.label, em.camera && em.camera.mode].filter(Boolean).join(' · ')], ['Energy filter', em.filter && M.isNum(em.filter.slitWidth) ? `${em.filter.slitInserted === false ? 'slit out' : 'slit'} ${F.auto(em.filter.slitWidth)} eV` : null],
        ['Exposure', M.isNum(em.exposure) ? F.time(em.exposure) : null], ['Dose per image', M.isNum(em.dosePerImage) ? F.dose(em.dosePerImage) : null],
        ['Target defocus', M.isNum(em.defocusTarget) ? F.len(em.defocusTarget) : null]);
      const t = ds.tilt && ds.tilt.info;
      if (t) out.push(['Tilt series', `${t.n} tilts, ${F.deg(t.min)} to ${F.deg(t.max)}${t.step ? `, ${F.deg(t.step)} steps` : ''}`], ['Tilt scheme', t.scheme && t.scheme.label], ['Dose on Camera', M.isNum(t.totalDose) ? F.dose(t.totalDose) : null]);
      if (ds.volume && M.isNum(ds.volume.sizeX)) out.push(['Volume', `${F.len(ds.volume.sizeX)} × ${F.len(ds.volume.sizeY)} × ${F.len(ds.volume.sizeZ)}`], ['Thickness', M.isNum(ds.volume.thickness) ? F.len(ds.volume.thickness) : null], ['Binning', ds.binning ? `${ds.binning}×` : null]);
    }
    return out;
  }

  function graphics(ds) {
    const g = [];
    if (ds.modality === 'LM' && ds.lm && ds.lm.channels.length) g.push(['Excitation and emission', M.gfx.spectrum(ds)]);
    if (ds.tilt && ds.tilt.tilts && ds.tilt.tilts.length > 1) {
      g.push(['Tilt angles', M.gfx.tiltFan(ds.tilt)]);
      const o = M.gfx.tiltOrder(ds.tilt);
      if (o) g.push(['Acquisition order', o]);
      const d = M.gfx.tiltDose(ds.tilt);
      if (d) g.push(['Accumulated dose', d]);
    }
    if (ds.kind === 'tomogram' || ds.kind === 'map' || (ds.modality === 'LM' && (ds.dims.z > 1 || ds.dims.t > 1))) {
      const host = document.createElement('div');
      const page = M.pages.list(ds).find((p) => p.id === 'volume' || p.id === 'stack');
      if (page) { host.appendChild(page.render(ds)); const s = host.querySelector('.gfx-iso'); if (s) g.push([ds.modality === 'EM' ? 'Volume' : 'Stack', s.outerHTML]); }
    }
    const fp = ds.modality === 'EM' ? M.gfx.beamFootprint(ds) : '';
    if (fp) g.push(['Beam footprint vs camera field', fp]);
    return g;
  }

  function reportHTML(ds) {
    const checks = (ds.checks || []).map((c) => `<div class="chk ${c.level}"><b>${{ error: '✖', warn: '!', info: 'i', ok: '✓' }[c.level]}</b>${E(c.title)}${c.detail ? ` <span class="sub">— ${E(c.detail)}</span>` : ''}</div>`).join('');
    let channels = '';
    if (ds.modality === 'LM' && ds.lm && ds.lm.channels.length) {
      channels = `<h2>Channels</h2><table class="grid"><tr><th>Channel</th><th>Dye</th><th>Excitation</th><th>Detection</th><th>Detector</th><th>Exposure</th></tr>` +
        ds.lm.channels.map((c) => `<tr><td>${E(c.name || '')}</td><td>${E(c.dye || '—')}</td><td>${E((c.exLines || []).join(', ') || (c.exBand ? Math.round(c.exBand[0]) + '–' + Math.round(c.exBand[1]) : '—'))} nm</td><td>${c.emBand ? Math.round(c.emBand[0]) + '–' + Math.round(c.emBand[1]) + ' nm' : '—'}</td><td>${E(c.detector && c.detector.name || '—')}</td><td>${M.isNum(c.exposure) ? F.time(c.exposure) : '—'}</td></tr>`).join('') + '</table>';
    }
    let tilts = '';
    if (ds.tilt && ds.tilt.tilts && ds.tilt.tilts.length > 1 && !ds.tilt.context) {
      const list = ds.tilt.tilts.slice().sort((a, b) => (a.order || a.section) - (b.order || b.section));
      tilts = `<h2>Tilts</h2><table class="grid"><tr><th>Order</th><th>Angle</th><th>Dose</th><th>Prior dose</th><th>Time</th></tr>` +
        list.map((x) => `<tr><td>${x.order || ''}</td><td>${F.deg(x.angle, 2)}</td><td>${M.isNum(x.dose) ? F.num(x.dose, 2) : '—'}</td><td>${M.isNum(x.cumBefore) ? F.num(x.cumBefore, 1) : '—'}</td><td>${x.time ? F.date(x.time) : '—'}</td></tr>`).join('') + '</table>';
    }
    const gfx = graphics(ds).map(([t, s]) => `<div class="avoid"><h2>${E(t)}</h2>${s}</div>`).join('');
    const thumb = ds._thumbURL ? `<img class="thumb" src="${ds._thumbURL}" alt="preview">` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="generator" content="EasyMeta ${M.version}"><meta name="copyright" content="${E(M.copyright)}"><title>EasyMeta report – ${E(ds.file.name)}</title><style>${REPORT_CSS}</style></head><body>
      <div class="brand">EasyMeta</div><h1>${E(ds.title || ds.file.name)}</h1>
      <div class="sub">${E(ds.modality === 'EM' ? 'Electron microscopy' : ds.modality === 'LM' ? 'Light microscopy' : '')} · ${E(ds.kindLabel)} · report generated ${E(F.date(new Date()))}</div>
      <h2>Summary</h2><div class="sum${thumb ? '' : ' nothumb'}"><table>${rows(summaryRows(ds))}</table>${thumb}</div>
      ${ds.methods ? `<h2>Methods (Machine Generated)</h2><div class="methods">${E(ds.methods)}</div>` : ''}
      ${channels}${gfx}${tilts}
      <h2>Checks</h2>${checks || '<p class="sub">No checks apply.</p>'}
      <div class="foot">Generated by EasyMeta ${M.version} from file metadata only; values are as recorded by the acquisition software. Check before publishing.${ds.lm && ds.lm.channels.some((c) => c.spectrum) ? ' Fluorophore spectra: FPbase (Lambert TJ 2019, Nat Methods 16:277–278, doi:10.1038/s41592-019-0352-8), CC BY-SA 4.0; per-spectrum credits in EasyMeta’s SPECTRA_CREDITS.md.' : ''}<br>EasyMeta ${M.version} · ${E(M.copyright)}</div>
      </body></html>`;
  }

  function printReport(ds) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(reportHTML(ds));
    doc.close();
    const go = () => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); };
    const imgs = Array.from(doc.images);
    if (!imgs.length) setTimeout(go, 150);
    else Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))).then(() => setTimeout(go, 100));
  }

  const base = (ds) => M.stem(ds.file.name) + (ds.series && ds.series.length > 1 ? `_series${ds.seriesIndex + 1}` : '');

  function exportJSON(ds) {
    const keep = Object.assign({}, ds);
    delete keep.thumbnail; delete keep.tiff; delete keep.dm; delete keep.rawText;
    const out = { generator: `EasyMeta ${M.version}`, generated: new Date().toISOString(), dataset: M.rawTree.plain(keep) };
    M.download(base(ds) + '_metadata.json', JSON.stringify(out, null, 2), 'application/json');
  }

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV(ds) {
    const lines = [['Section', 'Field', 'Value'].join(',')];
    for (const [k, v] of summaryRows(ds)) if (v !== null && v !== undefined && v !== '') lines.push(['Summary', k, v].map(csvCell).join(','));
    if (ds.lm) ds.lm.channels.forEach((c, i) => {
      const s = `Channel ${i + 1}`;
      for (const [k, v] of [['Name', c.name], ['Dye', c.dye], ['Excitation (nm)', (c.exLines || []).join(' ') || (c.exBand || []).map(Math.round).join('-')], ['Detection (nm)', c.emBand ? c.emBand.map(Math.round).join('-') : ''], ['Detector', c.detector && c.detector.name], ['Gain', c.detector && c.detector.gain], ['Exposure (s)', c.exposure], ['Pinhole (AU)', c.pinholeAU], ['Color', c.color]]) {
        if (v !== null && v !== undefined && v !== '') lines.push([s, k, v].map(csvCell).join(','));
      }
    });
    if (ds.tilt && ds.tilt.tilts) {
      lines.push('');
      lines.push(['Tilt order', 'Section', 'Angle (deg)', 'Time', 'Dose (e/A2)', 'Prior dose (e/A2)', 'Target defocus (um)', 'Magnification', 'Exposure (s)', 'Movie file'].join(','));
      for (const x of ds.tilt.tilts) lines.push([x.order, M.isNum(x.section) ? x.section + 1 : '', x.angle, x.time ? F.date(x.time) : '', x.dose, x.cumBefore, M.isNum(x.defocus) ? x.defocus * 1e6 : '', x.mag, x.exposure, x.subFrame].map(csvCell).join(','));
    }
    lines.push('');
    for (const c of ds.checks || []) lines.push(['Check', c.level, c.title + (c.detail ? ' — ' + c.detail : '')].map(csvCell).join(','));
    if (ds.methods) lines.push(['Methods', 'Machine Generated', ds.methods].map(csvCell).join(','));
    M.download(base(ds) + '_metadata.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  }

  function saveHTML(ds) { M.download(base(ds) + '_report.html', reportHTML(ds), 'text/html'); }

  M.report = { reportHTML, printReport, exportJSON, exportCSV, saveHTML };
})();
