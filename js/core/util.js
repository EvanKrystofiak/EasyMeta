/* EasyMeta - shared helpers: namespace, DOM, number/unit formatting, text, colour.
 * Every other script registers itself on window.EasyMeta (no ES modules, so the
 * app also runs straight from file://).
 */
(function () {
  'use strict';
  const M = (window.EasyMeta = window.EasyMeta || {});
  M.version = '0.1.0';
  M.copyright = 'Copyright © 2026 Evan Krystofiak';

  // ---------------------------------------------------------------- values
  M.isNum = (v) => typeof v === 'number' && isFinite(v);

  /** Parse a number from a number/string/bigint; null when it is not one. */
  M.num = function (v) {
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v !== 'string') return null;
    const s = v.trim();
    if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.test(s)) return null;
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  };
  /** First defined, non-null, non-NaN, non-empty-string argument. */
  M.first = function (...vals) {
    for (const v of vals) {
      if (v === undefined || v === null) continue;
      if (typeof v === 'number' && !isFinite(v)) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
    return null;
  };
  M.clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  M.unique = (arr) => Array.from(new Set(arr));
  M.median = function (arr) {
    const a = arr.filter(M.isNum).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  M.sum = (arr) => arr.reduce((s, v) => s + (M.isNum(v) ? v : 0), 0);
  M.mostCommon = function (arr) {
    const counts = new Map();
    for (const v of arr) if (v !== null && v !== undefined) counts.set(v, (counts.get(v) || 0) + 1);
    let best = null, n = 0;
    for (const [v, c] of counts) if (c > n) { best = v; n = c; }
    return best;
  };
  M.range = (n) => Array.from({ length: n }, (_, i) => i);
  M.deepGet = function (obj, path) {
    let o = obj;
    for (const k of path.split('.')) {
      if (o === null || o === undefined) return undefined;
      o = o[k];
    }
    return o;
  };
  /** Case-insensitive lookup of the first matching key in an object. */
  M.pick = function (obj, ...keys) {
    if (!obj) return undefined;
    const lower = {};
    for (const k of Object.keys(obj)) lower[k.toLowerCase()] = k;
    for (const k of keys) {
      const real = lower[k.toLowerCase()];
      if (real !== undefined && obj[real] !== undefined && obj[real] !== null && obj[real] !== '') return obj[real];
    }
    return undefined;
  };

  // ---------------------------------------------------------------- names
  M.basename = (p) => String(p || '').split(/[\\/]/).pop();
  M.dirname = function (p) {
    const s = String(p || '');
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i >= 0 ? s.slice(0, i) : '';
  };
  /** Lower-case last extension without the dot ('' if none). */
  M.ext = function (name) {
    const b = M.basename(name);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i + 1).toLowerCase() : '';
  };
  /** Name without its last extension (or without .ome.tif / .mrc.mdoc style double ones). */
  M.stem = function (name) {
    let b = M.basename(name);
    b = b.replace(/\.ome\.(tiff?|btf)$/i, '');
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(0, i) : b;
  };

  // ---------------------------------------------------------------- text
  const decoders = {};
  M.decodeText = function (bytes, enc) {
    enc = enc || 'utf-8';
    if (!decoders[enc]) decoders[enc] = new TextDecoder(enc, { fatal: false });
    return decoders[enc].decode(bytes);
  };
  /** Latin-1 string from bytes, cut at the first NUL, trimmed. */
  M.cstr = function (bytes) {
    let end = bytes.indexOf(0);
    if (end < 0) end = bytes.length;
    return M.decodeText(bytes.subarray(0, end), 'latin1').trim();
  };
  M.esc = (s) => String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  M.cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  /** Split CamelCase / snake_case keys into readable words. */
  M.words = (s) => String(s).replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();

  // ---------------------------------------------------------------- units
  const LEN_UNITS = {
    m: 1, meter: 1, meters: 1, metre: 1, mm: 1e-3, millimeter: 1e-3, cm: 1e-2,
    um: 1e-6, 'µm': 1e-6, 'μm': 1e-6, micron: 1e-6, microns: 1e-6, micrometer: 1e-6, micrometre: 1e-6,
    nm: 1e-9, nanometer: 1e-9, nanometre: 1e-9, a: 1e-10, 'å': 1e-10, angstrom: 1e-10, 'ångström': 1e-10,
    pm: 1e-12, inch: 0.0254, in: 0.0254,
  };
  /** Length in metres from a value and a unit name; null if the unit is unknown. */
  M.toMeters = function (value, unit) {
    const v = M.num(value);
    if (v === null) return null;
    const u = String(unit || '').trim().toLowerCase().replace(/μ/g, 'µ');
    const f = LEN_UNITS[u] !== undefined ? LEN_UNITS[u] : LEN_UNITS[u.replace(/s$/, '')];
    return f === undefined ? null : v * f;
  };

  // ---------------------------------------------------------------- formatting
  const MINUS = '−';
  const signed = (s) => s.replace(/^-/, MINUS);
  function fixed(v, d) { return signed(Number(v).toFixed(d)); }
  /** Number with sensible decimals for its magnitude. */
  function auto(v, sig) {
    sig = sig || 3;
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return signed(Math.round(v).toLocaleString('en-US'));
    const d = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
    const s = fixed(v, Math.min(d, 6));
    return s.includes('.') ? s.replace(/\.?0+$/, '') : s; // 63.0 -> 63, 2.50 -> 2.5
  }
  M.fmt = {
    MINUS,
    auto,
    fixed,
    int: (v) => (M.isNum(v) ? signed(Math.round(v).toLocaleString('en-US')) : '—'),
    num: (v, d) => (M.isNum(v) ? (d === undefined ? auto(v) : fixed(v, d)) : '—'),
    /** Length in metres -> "3.30 Å", "41.9 nm", "67.5 µm", "2.10 mm". */
    len(m, sig) {
      if (!M.isNum(m)) return '—';
      const a = Math.abs(m);
      if (a >= 1e-3) return auto(m * 1e3, sig) + ' mm';
      if (a >= 1e-6) return auto(m * 1e6, sig) + ' µm';
      if (a >= 1e-9 || a === 0) return auto(m * 1e9, sig) + ' nm';
      return auto(m * 1e10, sig) + ' Å';
    },
    /** Pixel size in metres for light microscopy: µm, or nm when below 0.1 µm. */
    pxLM(m) {
      if (!M.isNum(m)) return '—';
      return m >= 1e-7 ? fixed(m * 1e6, 4).replace(/0+$/, '').replace(/\.$/, '.0') + ' µm' : auto(m * 1e9, 4) + ' nm';
    },
    /** Pixel size in metres for EM: Å below 10 nm, otherwise nm. */
    pxEM(m) {
      if (!M.isNum(m)) return '—';
      return m < 1e-8 ? fixed(m * 1e10, 3) + ' Å' : auto(m * 1e9, 4) + ' nm';
    },
    bytes(n) {
      if (!M.isNum(n)) return '—';
      const u = ['B', 'KB', 'MB', 'GB', 'TB'];
      let i = 0;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + ' ' + u[i];
    },
    time(s) {
      if (!M.isNum(s)) return '—';
      const a = Math.abs(s);
      if (a === 0) return '0 s';
      if (a < 1e-3) return auto(s * 1e6) + ' µs';
      if (a < 1) return auto(s * 1e3) + ' ms';
      if (a < 120) return auto(s) + ' s';
      if (a < 7200) return auto(s / 60) + ' min';
      return auto(s / 3600) + ' h';
    },
    mag: (v) => (M.isNum(v) ? Math.round(v).toLocaleString('en-US') + '×' : '—'),
    kv: (V) => (M.isNum(V) ? (Math.abs(V) >= 1000 ? auto(V / 1000) + ' kV' : auto(V) + ' V') : '—'),
    deg: (v, d) => (M.isNum(v) ? fixed(v, d === undefined ? 1 : d) + '°' : '—'),
    nm: (v) => (M.isNum(v) ? Math.round(v) + ' nm' : '—'),
    dose: (v) => (M.isNum(v) ? auto(v, 3) + ' e⁻/Å²' : '—'),
    pct: (v, d) => (M.isNum(v) ? fixed(v, d === undefined ? 1 : d) + ' %' : '—'),
    /** "1,036 × 1,726 × 75" */
    dims: (...a) => a.filter((v) => M.isNum(v)).map((v) => Math.round(v).toLocaleString('en-US')).join(' × '),
    date(d) {
      if (!d) return '—';
      if (typeof d === 'string') return d;
      if (!(d instanceof Date) || isNaN(d)) return '—';
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    },
  };

  // ---------------------------------------------------------------- dates
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  /**
   * Parse the date formats microscopes write.  Wall-clock dates (no zone) are
   * returned as local Dates with the same clock time; ISO dates with a zone are
   * converted to local time.
   */
  M.parseDate = function (s) {
    if (s instanceof Date) return isNaN(s) ? null : s;
    if (!s) return null;
    s = String(s).trim();
    let m;
    // 13-Jan-2025  17:15:32 / 22-Mar-24 18:01:11 (SerialEM, Tomo)
    if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo !== undefined) return new Date(y, mo, +m[1], +m[4], +m[5], +(m[6] || 0));
    }
    // ISO 8601 (with optional fraction / zone)
    if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?/))) {
      if (m[7]) { const d = new Date(s.replace(/(\.\d{3})\d+/, '$1')); if (!isNaN(d)) return d; }
      return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    }
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    // 03/31/2026 14:47[:05] [PM]
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i))) {
      let h = +(m[4] || 0);
      if (m[7] && /pm/i.test(m[7]) && h < 12) h += 12;
      if (m[7] && /am/i.test(m[7]) && h === 12) h = 0;
      return new Date(+m[3], +m[1] - 1, +m[2], h, +(m[5] || 0), +(m[6] || 0));
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  };
  /** OLE automation date (days since 1899-12-30, wall clock) -> Date. */
  M.oleDate = function (days) {
    if (!M.isNum(days) || days <= 0) return null;
    const t = new Date(Math.round((days - 25569) * 86400000));
    return new Date(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours(), t.getUTCMinutes(), t.getUTCSeconds());
  };
  /** Windows FILETIME (100 ns since 1601, UTC) -> Date. */
  M.fileTime = function (high, low) {
    const t = (high * 4294967296 + (low >>> 0)) / 10000 - 11644473600000;
    return t > 0 ? new Date(t) : null;
  };

  // ---------------------------------------------------------------- colour
  /** Approximate display colour of a wavelength (nm), never too dark to see. */
  M.wavelengthRGB = function (nm) {
    let r = 0, g = 0, b = 0;
    const w = nm;
    if (w < 380) { r = 0.45; g = 0; b = 0.8; }
    else if (w < 440) { r = -(w - 440) / 60; g = 0; b = 1; }
    else if (w < 490) { r = 0; g = (w - 440) / 50; b = 1; }
    else if (w < 510) { r = 0; g = 1; b = -(w - 510) / 20; }
    else if (w < 580) { r = (w - 510) / 70; g = 1; b = 0; }
    else if (w < 645) { r = 1; g = -(w - 645) / 65; b = 0; }
    else { r = 1; g = 0; b = 0; }
    let f = 1;
    if (w > 700) f = Math.max(0.55, 1 - 0.45 * (w - 700) / 100);
    else if (w < 420) f = 0.6 + 0.4 * Math.max(0, (w - 380) / 40);
    const c = (x) => Math.round(255 * Math.pow(Math.max(0, Math.min(1, x * f)), 0.8));
    // lift very dark violets and deep reds so they read on a dark background
    let rgb = [c(r), c(g), c(b)];
    const lum = 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2];
    if (lum < 70) rgb = rgb.map((v) => Math.min(255, v + (70 - lum)));
    return rgb;
  };
  M.hex = (rgb) => '#' + rgb.map((v) => Math.round(M.clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  M.wavelengthHex = (nm) => M.hex(M.wavelengthRGB(nm));
  /** Display colour of a fluorescence channel by its emission wavelength: the spectral colour,
   *  except far-red and near-infrared light (650 nm and up), which is drawn reddish purple. */
  M.NIR_COLOR = '#cc339e';
  M.channelHex = (nm) => (nm >= 650 ? M.NIR_COLOR : M.wavelengthHex(nm));
  /** True for white, grey and black (#rrggbb). */
  M.isGrey = function (hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    const v = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
    return Math.max(...v) - Math.min(...v) < 24;
  };
  /** Parse colours as written by vendors: #RRGGBB, #AARRGGBB, "r g b" (0-1 or 0-255), ARGB ints. */
  M.parseColor = function (v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') {
      const n = v >>> 0;
      return M.hex([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
    }
    const s = String(v).trim();
    let m;
    if ((m = s.match(/^#?([0-9a-f]{8})$/i))) return '#' + m[1].slice(2).toLowerCase();
    if ((m = s.match(/^#?([0-9a-f]{6})$/i))) return '#' + m[1].toLowerCase();
    const parts = s.split(/[\s,;]+/).map(Number).filter((x) => isFinite(x));
    if (parts.length >= 3) {
      const scale = parts.slice(0, 3).every((x) => x <= 1) ? 255 : 1;
      return M.hex(parts.slice(0, 3).map((x) => x * scale));
    }
    const named = { red: '#ff3b30', green: '#34c759', blue: '#3d7dff', cyan: '#00e5ff', magenta: '#ff2bd6', yellow: '#ffd60a', white: '#ffffff', gray: '#aaaaaa', grey: '#aaaaaa' };
    return named[s.toLowerCase()] || null;
  };
  M.mixHex = function (a, b, t) {
    const pa = a.match(/\w\w/g).map((x) => parseInt(x, 16));
    const pb = b.match(/\w\w/g).map((x) => parseInt(x, 16));
    return M.hex(pa.map((v, i) => v + (pb[i] - v) * t));
  };
  /** Colour ramp for acquisition order (teal -> amber -> red). */
  M.orderColor = function (t) {
    t = M.clamp(t, 0, 1);
    return t < 0.5 ? M.mixHex('#17c3b2', '#e3b341', t * 2) : M.mixHex('#e3b341', '#e0574a', (t - 0.5) * 2);
  };

  // ---------------------------------------------------------------- DOM
  /** el('div', {class: 'x', onclick: fn}, child, 'text', ...) */
  M.el = function (tag, attrs, ...children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat()) {
      if (c === undefined || c === null || c === false) continue;
      e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return e;
  };
  M.$ = (sel, root) => (root || document).querySelector(sel);
  M.nextFrame = () => new Promise((r) => setTimeout(r, 0));

  /** Download a Blob or string as a file. */
  M.download = function (name, data, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain' });
    const a = M.el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  M.copyText = async function (text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {
      const ta = M.el('textarea', { style: { position: 'fixed', left: '-9999px' } });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
      return ok;
    }
  };
})();
