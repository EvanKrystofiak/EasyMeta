/* EasyMeta - dataset model, format registry and the open-files session.
 *
 * Adding a format: create js/formats/<name>.js that calls one of
 *   M.registerFormat({id, name, modality, extensions, sniff(head, ext), parse(src, ctx)})
 *   M.registerTiffFlavor({id, name, modality, match(tiff), parse(tiff, ds, ctx)})
 *   M.registerCompanion({id, name, accepts(name, ext, head), parse(src), link(comp, primary), attach(ds, parsed, link)})
 * and add a <script> tag to EasyMeta.html.  parse() fills a dataset made by
 * M.newDataset(); the pages, checks and report read only that dataset.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  // ------------------------------------------------------------------ model
  /**
   * The normalized description of one image/series.  Lengths are metres, angles
   * degrees, voltages volts, doses e-/Å², times seconds, wavelengths nm.
   */
  M.newDataset = function (src, fmt) {
    return {
      file: { name: src.name, path: src.path, size: src.size, modified: src.lastModified },
      format: { id: fmt.id, name: fmt.name, detail: '' },
      modality: fmt.modality || 'unknown', // 'LM' | 'EM' | 'unknown'
      kind: 'image',      // image | zstack | timelapse | hyperstack | tiltseries | tomogram | map | movie | particles | montage | gain
      kindLabel: '',
      title: src.name,
      acquired: null,     // Date or string
      instrument: {},     // manufacturer, model, name, serial, software, softwareVersion, friendlyName, site
      dims: {},           // x y z c t s m (counts)
      pixel: {},          // x y z (metres)
      pixelType: '',
      bits: null,
      lm: null,           // see M.ensureLM
      em: null,           // see M.ensureEM
      tilt: null,         // {tilts: [...], source}
      volume: null,
      movie: null,
      montage: null,
      parentTilt: null,   // a movie that is one tilt of a series
      history: [],        // processing history lines
      series: null,       // [{name, ...}] when the file holds several images
      seriesIndex: 0,
      raw: {},            // nested raw metadata (shown in the Raw page)
      rawText: {},        // name -> full text/XML blob (downloadable)
      notes: [],
      sources: [],
      companions: [],
      thumbnail: null,    // async () => {canvas, note} | null
    };
  };
  M.ensureLM = (ds) => ds.lm || (ds.lm = { objective: {}, channels: [], scan: {}, stage: {} });
  M.ensureEM = (ds) => ds.em || (ds.em = { camera: {}, stage: {}, filter: {} });
  M.note = (ds, level, text) => { if (!ds.notes.some((n) => n.text === text)) ds.notes.push({ level, text }); };
  M.addSource = (ds, s) => { if (s && !ds.sources.includes(s)) ds.sources.push(s); };
  /** Set obj[key] = val unless val is empty (keeps the first good value unless force). */
  M.set = function (obj, key, val, force) {
    if (val === undefined || val === null || val === '' || (typeof val === 'number' && !isFinite(val))) return;
    if (!force && obj[key] !== undefined && obj[key] !== null && obj[key] !== '') return;
    obj[key] = val;
  };

  // ------------------------------------------------------------------ registries
  M.formats = [];
  M.registerFormat = function (def) {
    def.extensions = def.extensions || [];
    M.formats.push(def);
    return def;
  };
  M.tiffFlavors = [];
  M.registerTiffFlavor = function (def) { M.tiffFlavors.push(def); return def; };
  M.companionTypes = [];
  M.registerCompanion = function (def) { M.companionTypes.push(def); return def; };

  /** Pick the format whose sniff() scores highest (extension adds a little). */
  M.detectFormat = async function (src, head) {
    head = head || (await src.read(0, Math.min(src.size, 8192)));
    const ext = M.ext(src.name);
    let best = null, bestScore = 0;
    for (const f of M.formats) {
      let s = 0;
      try { s = (f.sniff && f.sniff(head, ext, src)) || 0; } catch (e) { s = 0; }
      if (s > 0 && f.extensions.includes(ext)) s += 0.25;
      if (s > bestScore) { best = f; bestScore = s; }
    }
    return bestScore >= 0.3 ? best : null;
  };

  // ------------------------------------------------------------------ session
  let nextId = 1;
  const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  class Session {
    constructor() {
      this.entries = [];
      this.ignored = 0;
    }

    /** Add files: [{file, path}] or [{src}]. Returns the new primary entries. */
    async add(items, onProgress) {
      const fresh = [];
      let i = 0;
      for (const it of items) {
        i++;
        if (onProgress && i % 25 === 0) onProgress(i, items.length);
        const src = it.src || M.FileSource.fromFile(it.file, it.path);
        const path = src.path || src.name;
        if (this.entries.some((e) => e.path === path && e.src.size === src.size)) continue;
        const entry = { id: nextId++, src, name: src.name, path, dir: M.dirname(path), ext: M.ext(src.name), links: [], cache: new Map() };
        try {
          await this._classify(entry);
        } catch (err) {
          entry.role = 'unsupported';
          entry.error = String(err && err.message ? err.message : err);
        }
        if (entry.role === 'unsupported') { this.ignored++; continue; }
        this.entries.push(entry);
        fresh.push(entry);
      }
      this._link();
      this.entries.sort((a, b) => natural.compare(a.path, b.path));
      return fresh.filter((e) => e.role === 'primary');
    }

    async _classify(entry) {
      const head = await entry.src.read(0, Math.min(entry.src.size, 8192));
      for (const c of M.companionTypes) {
        if (c.accepts(entry.name, entry.ext, head)) {
          entry.role = 'companion';
          entry.comp = c;
          if (entry.src.size <= (c.maxSize || 8 * 1024 * 1024)) {
            try { entry.parsed = await c.parse(entry.src, head); } catch (e) { entry.parsed = null; entry.error = String(e.message || e); }
          }
          return;
        }
      }
      const fmt = await M.detectFormat(entry.src, head);
      if (fmt) { entry.role = 'primary'; entry.fmt = fmt; } else entry.role = 'unsupported';
    }

    /** Attach companions (mdoc, tlt, EPU xml, ...) to the files they describe. */
    _link() {
      const primaries = this.entries.filter((e) => e.role === 'primary' && !e.standalone);
      for (const p of primaries) p.links = [];
      for (const c of this.entries.filter((e) => e.role === 'companion' || e.standalone)) {
        if (!c.parsed) continue;
        let strong = false;
        for (const p of primaries) {
          if (p.dir !== c.dir && !(c.comp.crossDir && c.comp.crossDir(c, p))) continue;
          let r = null;
          try { r = c.comp.link(c, p); } catch (e) { r = null; }
          if (r && r.score > 0) {
            p.links.push(Object.assign({ comp: c }, r));
            if (r.score >= 0.85) strong = true;
            p.cache.clear();
          }
        }
        // companions that describe a dataset on their own (mdoc, EPU xml) become entries
        if (c.comp.standalone && !strong) {
          c.role = 'primary';
          c.standalone = true;
          c.fmt = c.comp.standalone;
        } else if (c.standalone && strong) {
          c.role = 'companion';
          c.standalone = false;
        }
      }
      for (const p of primaries) p.links.sort((a, b) => b.score - a.score);
    }

    primaries() { return this.entries.filter((e) => e.role === 'primary'); }

    /** Parse (once) and return the dataset for an entry / series. */
    load(entry, seriesIndex) {
      const key = seriesIndex || 0;
      if (!entry.cache.has(key)) entry.cache.set(key, this._load(entry, key));
      return entry.cache.get(key);
    }

    async _load(entry, seriesIndex) {
      const t0 = performance.now();
      const ds = await entry.fmt.parse(entry.src, { seriesIndex, entry, session: this, parsed: entry.parsed });
      for (const link of entry.links) {
        try {
          await link.comp.comp.attach(ds, link.comp.parsed, link, entry);
          ds.companions.push({ name: link.comp.name, path: link.comp.path, relation: link.relation || '', type: link.comp.comp.name });
          M.addSource(ds, link.comp.name);
        } catch (err) {
          M.note(ds, 'warn', `Could not use ${link.comp.name}: ${err.message || err}`);
        }
      }
      if (M.analyze) M.analyze(ds);
      ds.parseMs = performance.now() - t0;
      return ds;
    }

    clear() { this.entries = []; this.ignored = 0; }
  }
  M.Session = Session;
})();
