/* EasyMeta - application controller: opening files/folders, navigation,
 * previews, status bar and the report menu.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const el = (...a) => M.el(...a);
  const $ = (s) => document.querySelector(s);

  const app = {
    session: new M.Session(),
    entry: null,
    ds: null,
    page: 'overview',
    pages: [],
    filter: '',

    init() {
      $('#btnOpen').addEventListener('click', () => $('#fileInput').click());
      $('#btnFolder').addEventListener('click', () => $('#folderInput').click());
      $('#fileInput').addEventListener('change', (e) => { this.addFiles(Array.from(e.target.files).map((f) => ({ file: f, path: f.name }))); e.target.value = ''; });
      $('#folderInput').addEventListener('change', (e) => { this.addFiles(Array.from(e.target.files).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ''; });
      $('#btnReport').addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
      document.addEventListener('click', () => this.toggleMenu(false));
      $('#btnClear').addEventListener('click', () => this.clear());
      $('#fileFilter').addEventListener('input', (e) => { this.filter = e.target.value.toLowerCase(); this.renderFiles(); });
      for (const b of document.querySelectorAll('#reportMenu button')) b.addEventListener('click', () => this.reportAction(b.dataset.action));
      this.initDrop();
      document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); }
        if (e.key === 'Escape') this.toggleMenu(false);
      });
      $('#statusRight').textContent = `EasyMeta ${M.version} · ${M.copyright.replace('Copyright ', '')} · runs offline — files never leave this computer`;
      this.renderNav();
      this.renderWelcome();
      this.renderFiles();
      const params = new URLSearchParams(location.search);
      if (params.getAll('open').length) this.openUrls(params.getAll('open'), params.get('page'));
    },

    // ------------------------------------------------------------ opening
    initDrop() {
      const ov = $('#dropOverlay');
      let depth = 0;
      window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; ov.classList.add('show'); });
      window.addEventListener('dragleave', (e) => { e.preventDefault(); depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
      window.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      window.addEventListener('drop', async (e) => {
        e.preventDefault();
        depth = 0;
        ov.classList.remove('show');
        // Take everything from the DataTransfer now: it is emptied once this handler awaits.
        const dt = e.dataTransfer;
        const dropped = Array.from(dt.items || []).filter((i) => i.kind === 'file').map((i) => {
          const entry = i.webkitGetAsEntry ? i.webkitGetAsEntry() : null;
          const dir = !!(entry && entry.isDirectory);
          return { file: dir ? null : i.getAsFile(), entry: dir ? entry : null, handle: dir && i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null };
        });
        if (!dropped.length) dropped.push(...Array.from(dt.files || []).map((file) => ({ file })));
        // Dropped files are used as they are. Folders need the browser's file-system API, which
        // Chrome and Edge refuse on a page opened from disk (file://); the newer handle API is
        // tried next, and if that is refused too the user is pointed to Open folder….
        const items = dropped.filter((d) => d.file).map((d) => ({ file: d.file, path: d.file.name }));
        let refused = 0;
        for (const d of dropped.filter((x) => x.entry)) {
          this.status('Scanning dropped folders…');
          const r = await collect(d.entry);
          let got = r.out;
          if (r.failed && d.handle) {
            const h = await Promise.race([d.handle, new Promise((res) => setTimeout(() => res(null), 3000))]);
            if (h && h.kind === 'directory') got = await collectHandle(h).catch(() => got);
          }
          if (r.failed && !got.length) refused++;
          items.push(...got);
        }
        if (!items.length) {
          this.status(refused ? 'This browser does not let a page opened from disk read a dropped folder. Use Open folder… instead, or drop the files themselves.' : 'Nothing that can be opened was dropped.');
          return;
        }
        this.addFiles(items, refused ? `${refused} dropped folder${refused === 1 ? '' : 's'} not readable here: use Open folder…` : null);
      });
    },

    /** notice: a note kept at the end of the status line until the next files are added. */
    async addFiles(items, notice) {
      this.notice = notice || null;
      if (!items.length) return;
      const t0 = performance.now();
      this.status(`Checking ${items.length} file${items.length === 1 ? '' : 's'}…`);
      let fresh;
      try {
        fresh = await this.session.add(items, (i, n) => this.status(`Checking files… ${i} / ${n}`));
      } catch (err) {
        this.status('Could not read the files: ' + err.message);
        return;
      }
      this.renderFiles();
      const prim = this.session.primaries();
      const msg = `${prim.length} file${prim.length === 1 ? '' : 's'} recognised` + (this.session.ignored ? ` · ${this.session.ignored} other file${this.session.ignored === 1 ? '' : 's'} skipped` : '') + ` (${Math.round(performance.now() - t0)} ms)` + (this.notice ? ` · ${this.notice}` : '');
      this.status(msg);
      const target = fresh[0] || (this.entry && prim.includes(this.entry) ? this.entry : prim[0]);
      if (target) await this.open(target, 0);
      else if (!prim.length) this.renderWelcome('None of these files is a format EasyMeta knows (yet).');
    },

    async openUrls(urls, page) {
      const items = [];
      for (const u of urls) {
        try { items.push({ src: await M.FileSource.fromUrl(u.trim()) }); } catch (err) { this.status(err.message); }
      }
      await this.addFiles(items);
      if (page) this.showPage(page);
    },

    async open(entry, seriesIndex) {
      this.entry = entry;
      this.renderFiles();
      $('#fileField').textContent = entry.path;
      $('#fileField').title = entry.path;
      this.status(`Reading ${entry.name}…`);
      const before = entry.src.bytesRead;
      const t0 = performance.now();
      let ds;
      try {
        ds = await this.session.load(entry, seriesIndex || 0);
      } catch (err) {
        console.error(err);
        this.ds = null;
        this.renderNav();
        this.renderError(entry, err);
        this.status(`Could not read ${entry.name}: ${err.message}`);
        return;
      }
      if (this.entry !== entry) return;
      this.ds = ds;
      ds._readStatus = { bytes: entry.src.bytesRead - before, ms: performance.now() - t0 };
      this.pages = M.pages.list(ds);
      if (!this.pages.some((p) => p.id === this.page)) this.page = 'overview';
      this.renderNav();
      this.renderPage();
      this.statusRead();
      this.loadThumb(ds);
    },

    openSeries(i) { if (this.entry) this.open(this.entry, i); },

    clear() {
      this.session.clear();
      this.entry = null;
      this.ds = null;
      this.page = 'overview';
      $('#fileField').textContent = 'No file open';
      this.renderNav();
      this.renderFiles();
      this.renderWelcome();
      this.status('Ready');
    },

    // ------------------------------------------------------------ preview
    async loadThumb(ds) {
      if (ds._thumbState) return;
      if (!ds.thumbnail) { ds._thumbState = 'none'; this.refreshPreview(ds); return; }
      ds._thumbState = 'loading';
      this.refreshPreview(ds);
      try {
        const r = await ds.thumbnail();
        if (r && r.canvas) {
          ds._thumb = r;
          ds._thumbURL = r.canvas.toDataURL('image/jpeg', 0.9);
          ds._thumbState = 'done';
        } else ds._thumbState = 'none';
      } catch (err) {
        console.warn('preview failed', err);
        ds._thumbState = 'error';
        ds._thumbError = err.message || String(err);
      }
      if (this.ds !== ds) return;
      if (['overview', 'stack', 'volume'].includes(this.page)) this.renderPage(true);
      this.statusRead();
    },
    refreshPreview(ds) {
      const box = document.getElementById('previewBody');
      if (box && this.ds === ds) { box.innerHTML = ''; box.appendChild(M.pages.previewContent(ds)); }
    },

    // ------------------------------------------------------------ navigation
    showPage(id) {
      if (!this.pages.some((p) => p.id === id)) return;
      this.page = id;
      this.renderNav();
      this.renderPage();
    },
    setModality(m) {
      const ds = this.ds;
      if (!ds) return;
      ds.modalityOverride = m;
      ds.modality = m;
      if (m === 'LM') M.ensureLM(ds); else M.ensureEM(ds);
      M.analyze(ds);
      this.pages = M.pages.list(ds);
      this.renderNav();
      this.renderPage();
    },

    // ------------------------------------------------------------ rendering
    renderNav() {
      const nav = $('#navButtons');
      nav.innerHTML = '';
      for (const p of this.pages) nav.appendChild(el('button', { class: 'navBtn' + (p.id === this.page ? ' on' : ''), onclick: () => this.showPage(p.id) }, p.label));
      $('#btnReport').disabled = !this.ds;
    },
    renderPage(keepScroll) {
      const main = $('#page');
      const scroll = main.scrollTop;
      main.innerHTML = '';
      const p = this.pages.find((x) => x.id === this.page);
      if (!p || !this.ds) return;
      try {
        main.appendChild(p.render(this.ds, this));
      } catch (err) {
        console.error(err);
        main.appendChild(el('div', { class: 'page' }, el('div', { class: 'card errorCard' }, el('h3', null, 'This page could not be drawn'), el('pre', null, err.stack || String(err)))));
      }
      if (keepScroll) main.scrollTop = scroll;
    },
    renderWelcome(msg) {
      const main = $('#page');
      main.innerHTML = '';
      const formats = [
        ['Light microscopy', 'Zeiss CZI · LSM, Nikon ND2, Leica LIF, Olympus OIB · OIF, Imaris IMS, OME-TIFF, ImageJ TIFF'],
        ['Electron microscopy', 'MRC · MRCS · ST · ALI · REC · MAP (Thermo FEI1/FEI2, SerialEM headers), EER, Gatan DM3 · DM4, Zeiss & Thermo SEM/FIB TIFF, AMT camera TIFF, Fibics Atlas'],
        ['Companion files', 'SerialEM / Tomo .mdoc, EPU/Tomo XML, IMOD .tlt · .rawtlt · tilt.com — drop them together with the image, or drop the whole folder'],
      ];
      main.appendChild(el('div', { class: 'page welcome' },
        el('div', { class: 'dropZone', onclick: () => $('#fileInput').click() },
          el('div', { class: 'dropIcon', html: '<svg viewBox="0 0 48 48" width="56" height="56"><path d="M24 6v24m0 0-9-9m9 9 9-9" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 30v8a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>' }),
          el('h2', null, 'Drop microscopy files or a folder here'),
          el('p', { class: 'dim' }, 'or click to choose files · Ctrl+O'),
          msg ? el('p', { class: 'warnText' }, msg) : null),
        el('div', { class: 'formatList' }, formats.map(([h, t]) => el('div', { class: 'card' }, el('h3', null, h), el('p', { class: 'dim' }, t)))),
        el('p', { class: 'dim small center' }, 'EasyMeta reads only the headers and metadata blocks it needs — a few KB even from multi-GB files. Nothing is uploaded.'),
        el('p', { class: 'dim small center' }, `EasyMeta ${M.version} · ${M.copyright}`)));
    },
    renderError(entry, err) {
      const main = $('#page');
      main.innerHTML = '';
      main.appendChild(el('div', { class: 'page' }, el('div', { class: 'pageHead' }, el('h1', { class: 'pageTitle' }, entry.name)),
        el('div', { class: 'card errorCard' }, el('h3', null, 'This file could not be read'), el('p', null, err.message || String(err)),
          el('p', { class: 'dim' }, `Recognised as ${entry.fmt ? entry.fmt.name : 'unknown'}. If the file is fine in its own software, please send it to the EasyMeta maintainer.`),
          el('details', null, el('summary', { class: 'dim' }, 'Technical details'), el('pre', null, err.stack || '')))));
    },
    renderFiles() {
      const list = $('#filesList');
      list.innerHTML = '';
      const prim = this.session.primaries();
      const comps = this.session.entries.filter((e) => e.role === 'companion').length;
      $('#filesCount').textContent = prim.length ? `${prim.length} file${prim.length === 1 ? '' : 's'}` + (comps ? ` · ${comps} companion${comps === 1 ? '' : 's'}` : '') : 'none open';
      $('#fileFilter').style.display = prim.length > 12 ? '' : 'none';
      $('#btnClear').style.display = prim.length ? '' : 'none';
      const shown = prim.filter((e) => !this.filter || e.path.toLowerCase().includes(this.filter)).slice(0, 1000);
      for (const e of shown) {
        const tags = e.links.filter((l) => l.score >= 0.5).map((l) => l.comp.comp.id).filter((v, i, a) => a.indexOf(v) === i);
        list.appendChild(el('button', { class: 'fileBtn' + (e === this.entry ? ' on' : ''), title: e.path, onclick: () => this.open(e, 0) },
          el('span', { class: 'fileName' }, e.name),
          el('span', { class: 'fileMeta' }, `${e.fmt ? e.fmt.name : ''}${tags.length ? ' + ' + tags.join(', ') : ''}`)));
      }
      if (prim.length > shown.length && !this.filter) list.appendChild(el('div', { class: 'dim small' }, `… ${prim.length - shown.length} more (use the filter)`));
    },

    // ------------------------------------------------------------ status & report
    status(text) { $('#statusLeft').textContent = text; },
    statusRead() {
      const e = this.entry, ds = this.ds;
      if (!e || !ds) return;
      const pct = e.src.size ? (100 * e.src.bytesRead) / e.src.size : 0;
      const pctTxt = pct < 0.01 ? '< 0.01' : pct < 1 ? pct.toFixed(2) : pct.toFixed(pct < 10 ? 1 : 0);
      const comp = ds.companions.length ? ` + ${ds.companions.length} companion file${ds.companions.length === 1 ? '' : 's'}` : '';
      this.status(`${ds.format.name} · read ${F.bytes(e.src.bytesRead)} of ${F.bytes(e.src.size)} (${pctTxt} %)${comp} · metadata in ${Math.round(ds._readStatus ? ds._readStatus.ms : 0)} ms` + (this.notice ? ` · ${this.notice}` : ''));
    },
    toggleMenu(force) {
      const m = $('#reportMenu');
      const show = force === undefined ? !m.classList.contains('show') : force;
      m.classList.toggle('show', show && !!this.ds);
    },
    async reportAction(action) {
      this.toggleMenu(false);
      const ds = this.ds;
      if (!ds) return;
      if (action === 'print') M.report.printReport(ds);
      else if (action === 'html') M.report.saveHTML(ds);
      else if (action === 'json') M.report.exportJSON(ds);
      else if (action === 'csv') M.report.exportCSV(ds);
      else if (action === 'methods') {
        const ok = await M.copyText(ds.methods || '');
        this.status(ok ? 'Methods paragraph copied to the clipboard.' : 'Could not copy to the clipboard.');
      }
    },
  };

  /** Walk a dropped folder (FileSystemDirectoryEntry) into {out: [{file, path}], failed: entries the browser refused}. */
  async function collect(root) {
    const out = [];
    let failed = 0;
    const walk = async (entry) => {
      if (entry.isFile) {
        const file = await new Promise((res, rej) => entry.file(res, rej)).catch(() => null);
        if (file) out.push({ file, path: entry.fullPath.replace(/^\//, '') });
        else failed++;
        if (out.length && out.length % 200 === 0) app.status(`Scanning dropped folders… ${out.length} files`);
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        for (;;) {
          const batch = await new Promise((res) => reader.readEntries(res, () => { failed++; res([]); }));
          if (!batch.length) break;
          for (const b of batch) await walk(b);
        }
      }
    };
    await walk(root);
    return { out, failed };
  }

  /** The same walk with the File System Access API (FileSystemDirectoryHandle). */
  async function collectHandle(root) {
    const out = [];
    const walk = async (h, dir) => {
      if (h.kind === 'file') out.push({ file: await h.getFile(), path: dir + h.name });
      else for await (const k of h.values()) await walk(k, dir + h.name + '/');
    };
    await walk(root, '');
    return out;
  }

  M.app = app;
  window.addEventListener('DOMContentLoaded', () => app.init());
})();
