/* EasyMeta - companion files of EM tilt series:
 *   .mdoc (SerialEM / Thermo Tomography)  - per-image acquisition metadata
 *   .tlt / .rawtlt (IMOD)                 - tilt angles
 *   tilt.com (IMOD / etomo)               - reconstruction parameters
 * An .mdoc dropped without its stack is shown on its own.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  // ------------------------------------------------------------------ mdoc
  function parseMdoc(text) {
    const out = { global: {}, titles: [], sections: [] };
    let cur = null;
    for (const raw of text.split(/\r?\n|\r/)) {
      const line = raw.trim();
      if (!line) continue;
      let m = line.match(/^\[\s*T\s*=\s*(.*?)\s*\]$/);
      if (m) { out.titles.push(m[1]); continue; }
      m = line.match(/^\[\s*(\w+)\s*=\s*([^\]]*?)\s*\]$/);
      if (m) { cur = { type: m[1], index: M.num(m[2]), fields: {} }; out.sections.push(cur); continue; }
      m = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (m) (cur ? cur.fields : out.global)[m[1].trim()] = m[2].trim();
    }
    out.info = interpret(out);
    return out;
  }
  const n1 = (v) => (v === undefined ? null : M.numbers(v)[0] !== undefined ? M.numbers(v)[0] : null);
  const nAll = (v) => (v === undefined ? [] : M.numbers(v));

  /** Software, microscope, date and tilt axis from the [T = ...] title lines. */
  function interpret(md) {
    const info = {};
    for (const t of md.titles) {
      let m = t.match(/^(SerialEM|Tomography|Tomo|EPU|[A-Za-z][\w ]*?):\s*(.*?)\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?)\s*$/);
      if (m) {
        info.software = m[1] === 'Tomography' ? 'Thermo Scientific Tomography' : m[1];
        info.microscope = m[2].replace(/^Acquired on\s+/i, '').trim();
        info.date = M.parseDate(m[3]);
        continue;
      }
      m = t.match(/Tilt\s*axis\s*angle\s*=\s*([-\d.]+)/i);
      if (m) info.tiltAxis = +m[1];
      m = t.match(/binning\s*=\s*(\d+)/i);
      if (m) info.binning = +m[1];
      m = t.match(/spot(?:size)?\s*=\s*(\d+)/i);
      if (m) info.spot = +m[1];
    }
    const zs = md.sections.filter((s) => s.type === 'ZValue');
    info.zCount = zs.length;
    info.angles = zs.map((s) => n1(s.fields.TiltAngle));
    // a montage needs pieces at more than one position (single images can carry "0 0 0")
    info.hasPieces = new Set(zs.filter((s) => s.fields.PieceCoordinates).map((s) => M.numbers(s.fields.PieceCoordinates).slice(0, 2).join(','))).size > 1;
    const angs = info.angles.filter(M.isNum);
    info.angleSpan = angs.length ? Math.max(...angs) - Math.min(...angs) : 0;
    info.frames = zs.map((s) => (s.fields.SubFramePath ? M.basename(s.fields.SubFramePath).toLowerCase() : null));
    return info;
  }

  /** Per-image records from ZValue sections. */
  function tiltsFrom(md) {
    return md.sections.filter((s) => s.type === 'ZValue').map((s, i) => {
      const f = s.fields;
      const fd = nAll(f.FrameDosesAndNumber);
      const slit = nAll(f.FilterSlitAndLoss);
      return {
        section: M.isNum(s.index) ? s.index : i,
        mdocIndex: i,
        angle: n1(f.TiltAngle),
        time: f.DateTime ? M.parseDate(f.DateTime) : null,
        dose: n1(f.ExposureDose),
        priorDose: n1(f.PriorRecordDose),
        defocus: M.isNum(n1(f.TargetDefocus)) ? n1(f.TargetDefocus) * 1e-6 : null,
        defocusReadout: M.isNum(n1(f.Defocus)) ? n1(f.Defocus) * 1e-6 : null,
        mag: n1(f.Magnification),
        exposure: n1(f.ExposureTime),
        pixel: M.isNum(n1(f.PixelSpacing)) ? n1(f.PixelSpacing) * 1e-10 : null,
        spot: n1(f.SpotSize),
        intensity: n1(f.Intensity),
        stageX: nAll(f.StagePosition)[0], stageY: nAll(f.StagePosition)[1], stageZ: n1(f.StageZ),
        frames: n1(f.NumSubFrames), frameDose: fd.length ? fd[0] : null,
        subFrame: f.SubFramePath ? M.basename(f.SubFramePath) : null,
        slit: slit[0], energyLoss: slit[1],
        doseRate: n1(f.DoseRate),
        piece: f.PieceCoordinates ? nAll(f.PieceCoordinates) : null,
        fields: f,
      };
    });
  }

  /** Fill acquisition settings from one mdoc record + the mdoc header. */
  function applyRecord(ds, md, rec, opts) {
    opts = opts || {};
    const em = M.ensureEM(ds);
    const g = md.global, info = md.info, f = rec ? rec.fields : {};
    const inst = ds.instrument;
    if (info.software) M.set(inst, 'software', info.software);
    if (info.microscope) M.set(inst, 'name', info.microscope);
    if (!inst.systemId && /^TITAN|^TALOS|^GLACIOS|^ARCTICA|^TECNAI|^KRIOS/i.test(info.microscope || '')) {
      inst.systemId = info.microscope;
      M.set(inst, 'manufacturer', 'Thermo Fisher Scientific');
      M.set(inst, 'model', info.microscope.replace(/\d+$/, ''));
    }
    const volt = n1(g.Voltage) || n1(f.Voltage);
    if (M.isNum(volt) && volt > 0) M.set(em, 'ht', volt * 1000);
    if (rec) {
      M.set(em, 'mag', rec.mag);
      M.set(em, 'spot', rec.spot !== null ? rec.spot : info.spot);
      if (M.isNum(rec.intensity) && rec.intensity > 0) M.set(em, 'intensity', rec.intensity);
      if (M.isNum(rec.exposure) && rec.exposure > 0) M.set(em, 'exposure', rec.exposure);
      if (M.isNum(rec.defocus)) M.set(em, 'defocusTarget', rec.defocus);
      if (M.isNum(rec.doseRate) && rec.doseRate > 0) M.set(em, 'doseRate', rec.doseRate);
      if (M.isNum(rec.slit) && rec.slit > 0) { em.filter.slitWidth = em.filter.slitWidth || rec.slit; em.filter.slitInserted = em.filter.slitInserted !== undefined ? em.filter.slitInserted : true; }
      const bin = n1(f.Binning);
      if (M.isNum(bin)) M.set(em, 'binning', bin);
      const cpe = n1(f.CountsPerElectron);
      if (M.isNum(cpe)) M.set(em.camera, 'countsPerElectron', cpe);
      const mode = n1(f.EMmode);
      if (mode !== null) M.set(em, 'mode', ['TEM', 'EFTEM', 'STEM', 'Diffraction'][mode]);
      const probe = n1(f.ProbeMode);
      if (probe === 0) M.set(em, 'probeMode', 'Nanoprobe');
      else if (probe === 1) M.set(em, 'probeMode', 'Microprobe');
      const om = n1(f.OperatingMode);
      if (om !== null && f.CameraIndex !== undefined) M.set(em.camera, 'index', n1(f.CameraIndex));
      if (om === 3 || /counting/i.test(f.ReadMode || '')) em.camera.counting = em.camera.counting !== undefined ? em.camera.counting : true;
      if (rec.frames) M.set(em, 'frames', rec.frames);
      if (M.isNum(rec.stageX)) { M.set(em.stage, 'x', rec.stageX * 1e-6); M.set(em.stage, 'y', rec.stageY * 1e-6); }
      if (M.isNum(rec.stageZ)) M.set(em.stage, 'z', rec.stageZ * 1e-6);
      if (opts.single) {
        if (M.isNum(rec.dose)) M.set(em, 'dosePerImage', rec.dose);
        M.set(em.stage, 'alpha', rec.angle);
      }
    }
    if (M.isNum(info.tiltAxis)) M.set(em, 'tiltAxisTitle', info.tiltAxis);
    if (M.isNum(info.binning)) M.set(em, 'binning', info.binning);
    const px = rec && rec.pixel ? rec.pixel : M.isNum(n1(g.PixelSpacing)) ? n1(g.PixelSpacing) * 1e-10 : null;
    if (px && opts.pixel !== false && (!ds.pixel.x || ds.pixel.suspect)) ds.pixel = { x: px, y: px, source: 'mdoc' };
    if (rec && rec.time && !ds.acquired) ds.acquired = rec.time;
    if (!ds.acquired && info.date) ds.acquired = info.date;
    return em;
  }

  /** Merge mdoc records into an existing tilt list by nearest angle. */
  function mergeTilts(tilts, recs) {
    for (const t of tilts) {
      let best = null, bd = 0.6;
      for (const r of recs) {
        if (!M.isNum(r.angle) || !M.isNum(t.angle)) continue;
        const d = Math.abs(r.angle - t.angle);
        if (d < bd) { bd = d; best = r; }
      }
      if (!best) continue;
      for (const k of ['time', 'dose', 'priorDose', 'defocus', 'mag', 'exposure', 'frames', 'frameDose', 'subFrame', 'doseRate']) {
        if ((t[k] === undefined || t[k] === null) && best[k] !== undefined && best[k] !== null) t[k] = best[k];
      }
      t.mdocIndex = best.mdocIndex;
    }
  }

  function mdocStem(name) {
    let n = name.replace(/\.mdoc$/i, '');
    n = n.replace(/\.(mrc|st|tif|tiff|eer|ali|mrcs)$/i, '');
    return n.toLowerCase();
  }

  M.registerCompanion({
    id: 'mdoc', name: 'SerialEM/Tomo .mdoc',
    accepts: (name, ext) => ext === 'mdoc',
    async parse(src) { return parseMdoc(await src.text(0, src.size, 'latin1')); },
    link(c, p) {
      const md = c.parsed, pn = p.name.toLowerCase(), cn = c.name.toLowerCase();
      if (cn === pn + '.mdoc') return { score: 1, relation: 'stack' };
      const img = (md.global.ImageFile || '').toLowerCase();
      if (img && M.basename(img) === pn) return { score: 0.95, relation: 'stack' };
      const fi = md.info.frames.indexOf(pn);
      if (fi >= 0) return { score: 0.9, relation: 'frames', index: fi };
      const cs = mdocStem(c.name), ps = M.stem(p.name).toLowerCase();
      if (cs === ps) return { score: 0.9, relation: 'stack' };
      if (ps.startsWith(cs + '_') || ps.startsWith(cs + '.')) return { score: 0.6, relation: 'context' };
      return null;
    },
    attach(ds, md, link) {
      const recs = tiltsFrom(md);
      M.addSource(ds, 'mdoc');
      ds.raw['mdoc (' + recs.length + ' sections)'] = { header: md.global, titles: md.titles, sections: md.sections.map((s) => Object.assign({ '[section]': `${s.type} = ${s.index}` }, s.fields)) };
      if (link.relation === 'frames') {
        const rec = recs[link.index];
        applyRecord(ds, md, rec, { single: true });
        ds.kind = 'movie';
        ds.parentTilt = {
          series: md.global.ImageFile || M.stem(link.comp.name), index: link.index, total: recs.length, angle: rec.angle,
          order: link.index + 1,
        };
        // the movie file's own frame count / frame dose win over the mdoc (EER fractions differ)
        ds.movie = Object.assign({ frames: rec.frames || ds.dims.z, dosePerImage: rec.dose, frameDose: rec.frameDose }, ds.movie || {});
        // the whole series, for context
        ds.tilt = { tilts: recs, source: 'mdoc', context: true, highlight: link.index };
        return;
      }
      const rep = recs.reduce((a, r) => (M.isNum(r.angle) && (!a || Math.abs(r.angle) < Math.abs(a.angle)) ? r : a), null) || recs[0];
      if (link.relation === 'context') {
        // tomogram / aligned stack made from this series: keep its own pixel size
        applyRecord(ds, md, rep, { pixel: false });
        if (md.info.angleSpan > 1) ds.tilt = { tilts: recs, source: 'mdoc', context: true };
        const raw = rep && rep.pixel ? rep.pixel : M.isNum(n1(md.global.PixelSpacing)) ? n1(md.global.PixelSpacing) * 1e-10 : null;
        if (raw) ds.rawPixel = raw;
        return;
      }
      // the mdoc describes this very file
      applyRecord(ds, md, rep);
      if (md.info.hasPieces && ds.kind !== 'tiltseries') {
        ds.kind = 'montage';
        ds.montage = { pieces: recs.map((r, i) => ({ section: i, x: r.piece[0], y: r.piece[1], z: r.piece[2] })), width: ds.dims.x, height: ds.dims.y };
        return;
      }
      if (md.info.angleSpan > 1) {
        if (ds.tilt && ds.tilt.tilts && ds.tilt.tilts.length) {
          mergeTilts(ds.tilt.tilts, recs);
          ds.tilt.source += ' + mdoc';
        } else {
          ds.tilt = { tilts: recs, source: 'mdoc' };
        }
        if (ds.kind !== 'tomogram') ds.kind = 'tiltseries';
      } else if (recs.length === 1) {
        applyRecord(ds, md, recs[0], { single: true });
      }
    },
    standalone: {
      id: 'mdoc', name: 'SerialEM/Tomo .mdoc', modality: 'EM', extensions: ['mdoc'],
      async parse(src, ctx) {
        const md = ctx.parsed || parseMdoc(await src.text(0, src.size, 'latin1'));
        const ds = M.newDataset(src, this);
        ds.modality = 'EM';
        ds.format.detail = 'metadata only (no image data)';
        const recs = tiltsFrom(md);
        const size = M.numbers(md.global.ImageSize);
        ds.dims = { x: size[0], y: size[1], z: recs.length };
        ds.metadataOnly = true;
        const rep = recs.reduce((a, r) => (M.isNum(r.angle) && (!a || Math.abs(r.angle) < Math.abs(a.angle)) ? r : a), null) || recs[0];
        applyRecord(ds, md, rep);
        M.addSource(ds, 'mdoc');
        if (md.info.hasPieces) {
          ds.kind = 'montage';
          ds.montage = { pieces: recs.map((r, i) => ({ section: i, x: r.piece[0], y: r.piece[1], z: r.piece[2] })), width: size[0], height: size[1] };
        } else if (md.info.angleSpan > 1) {
          ds.kind = 'tiltseries';
          ds.tilt = { tilts: recs, source: 'mdoc' };
        } else if (recs.length === 1) {
          applyRecord(ds, md, recs[0], { single: true });
          ds.kind = recs[0].frames > 1 ? 'movie' : 'image';
        } else ds.kind = 'imagestack';
        if (md.global.ImageFile) M.note(ds, 'info', `This .mdoc describes ${md.global.ImageFile}; open that file together with the .mdoc to see both.`);
        ds.raw['mdoc header'] = md.global;
        ds.raw.Titles = md.titles;
        ds.raw[`mdoc sections (${md.sections.length})`] = md.sections.map((s) => Object.assign({ '[section]': `${s.type} = ${s.index}` }, s.fields));
        return ds;
      },
    },
  });

  // ------------------------------------------------------------------ .tlt / .rawtlt
  M.registerCompanion({
    id: 'tlt', name: 'IMOD tilt angles',
    accepts: (name, ext) => ext === 'tlt' || ext === 'rawtlt',
    maxSize: 1024 * 1024,
    async parse(src) {
      const angles = (await src.text(0, src.size, 'latin1')).split(/\r?\n/).map((l) => M.num(l)).filter(M.isNum);
      return { angles, raw: M.ext(src.name) === 'rawtlt' };
    },
    link(c, p) {
      const cs = M.stem(c.name).toLowerCase(), ps = M.stem(p.name).toLowerCase();
      if (cs === ps) return { score: c.parsed.raw ? 0.8 : 0.82, relation: 'angles' };
      if (ps.startsWith(cs + '_')) return { score: 0.5, relation: 'context' };
      return null;
    },
    attach(ds, t, link) {
      const name = link.comp.name;
      ds.raw[name] = t.angles;
      if (link.relation === 'angles' && ds.dims.z === t.angles.length && ds.kind !== 'tomogram') {
        if (!ds.tilt || !ds.tilt.tilts || !ds.tilt.tilts.some((x) => M.isNum(x.angle))) {
          ds.tilt = { tilts: t.angles.map((a, i) => ({ section: i, angle: a })), source: name, orderUnknown: true };
          ds.kind = 'tiltseries';
        } else {
          ds.tilt.tilts.forEach((x, i) => { x[t.raw ? 'rawAngle' : 'refinedAngle'] = t.angles[i]; });
        }
      } else if (!ds.tilt) {
        ds.tilt = { tilts: t.angles.map((a, i) => ({ section: i, angle: a })), source: name, context: true, orderUnknown: true };
      }
    },
  });

  // ------------------------------------------------------------------ IMOD tilt.com
  M.registerCompanion({
    id: 'tiltcom', name: 'IMOD tilt.com',
    accepts: (name) => /^tilt(_\w+)?\.com$/i.test(name),
    maxSize: 256 * 1024,
    async parse(src) {
      const kv = {};
      for (const line of (await src.text(0, src.size, 'latin1')).split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z][\w]*)\s+(.*?)\s*$/);
        if (m && !line.trim().startsWith('#') && !line.trim().startsWith('$')) kv[m[1]] = m[2];
      }
      return kv;
    },
    link(c, p) {
      const out = (c.parsed.OutputFile || '').toLowerCase();
      if (out && M.basename(out) === p.name.toLowerCase()) return { score: 0.9, relation: 'reconstruction' };
      if (/rec|tomo/i.test(p.name) && ['mrc', 'rec'].includes(p.ext)) return { score: 0.4, relation: 'reconstruction' };
      return null;
    },
    attach(ds, kv) {
      if (ds.kind !== 'tomogram' && ds.kind !== 'map') return;
      const r = (ds.reconstruction = ds.reconstruction || {});
      r.program = 'IMOD tilt';
      r.thickness = M.num(kv.THICKNESS);
      r.binned = M.num(kv.IMAGEBINNED);
      const sirt = M.num(kv.FakeSIRTiterations);
      r.method = sirt ? `SIRT-like filter (${sirt} iterations)` : kv.SIRTIterations ? 'SIRT' : 'Weighted back-projection';
      if (kv.RADIAL) r.radial = kv.RADIAL;
      if (kv.XAXISTILT) r.xAxisTilt = M.num(kv.XAXISTILT);
      if (kv.LOG !== undefined) r.log = kv.LOG;
      ds.raw['tilt.com'] = kv;
    },
  });

  M.mdoc = { parseMdoc, tiltsFrom, applyRecord, mergeTilts };
})();
