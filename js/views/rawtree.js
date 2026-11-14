/* EasyMeta - collapsible tree for raw metadata (plain objects, arrays and XML
 * elements).  Children are built only when a branch is opened, so huge vendor
 * XML stays fast.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const el = (...a) => M.el(...a);
  const isEl = (v) => v && typeof v === 'object' && v.nodeType === 1;
  const MAX_KIDS = 300;

  function entries(v) {
    if (isEl(v)) {
      const out = [];
      for (const a of Array.from(v.attributes || [])) out.push(['@' + a.name, a.value]);
      const kids = Array.from(v.children);
      const counts = {};
      for (const k of kids) counts[k.localName] = (counts[k.localName] || 0) + 1;
      const seen = {};
      for (const k of kids) {
        const n = k.localName;
        const label = counts[n] > 1 ? `${n}[${seen[n] = (seen[n] || 0) + 1}]` : n;
        out.push([label, k.children.length || k.attributes.length ? k : k.textContent.trim()]);
      }
      if (!kids.length && v.textContent.trim() && v.attributes.length) out.push(['#text', v.textContent.trim()]);
      return out;
    }
    if (Array.isArray(v)) return v.map((x, i) => [String(i), x]);
    if (v instanceof Uint8Array) return [];
    return Object.entries(v).filter(([, x]) => typeof x !== 'function');
  }
  function isBranch(v) {
    if (v === null || v === undefined) return false;
    if (v instanceof Date || v instanceof Uint8Array) return false;
    if (isEl(v)) return true;
    if (Array.isArray(v)) return !(v.length <= 16 && v.every((x) => x === null || typeof x !== 'object'));
    return typeof v === 'object';
  }
  function leafText(v) {
    if (v === null || v === undefined) return 'null';
    if (v instanceof Date) return M.fmt.date(v);
    if (v instanceof Uint8Array) return `(${v.length} bytes)`;
    if (Array.isArray(v)) return '[' + v.map((x) => (typeof x === 'number' ? M.fmt.auto(x, 6) : String(x))).join(', ') + ']';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toPrecision(8));
    return String(v);
  }
  function leaf(k, v) {
    const s = leafText(v);
    const val = el('span', { class: 'rv' + (typeof v === 'number' ? ' num' : '') });
    if (s.length > 400) {
      val.textContent = s.slice(0, 400) + '… ';
      val.appendChild(el('button', { class: 'linkBtn', onclick: (e) => { e.target.parentNode.textContent = s; } }, `show all ${s.length} characters`));
    } else val.textContent = s;
    return el('div', { class: 'rleaf' }, el('span', { class: 'rk' }, k), val);
  }
  function branch(k, v, open) {
    const kids = entries(v);
    const sum = isEl(v) ? `<${v.localName}>` : Array.isArray(v) ? `[${v.length}]` : `{${kids.length}}`;
    const d = el('details', open ? { open: '' } : null, el('summary', null, el('span', { class: 'rk' }, k), el('span', { class: 'rs dim' }, ' ' + sum)));
    const fill = () => {
      if (d._filled) return;
      d._filled = true;
      const box = el('div', { class: 'rkids' });
      kids.slice(0, MAX_KIDS).forEach(([ck, cv]) => box.appendChild(isBranch(cv) ? branch(ck, cv, false) : leaf(ck, cv)));
      if (kids.length > MAX_KIDS) box.appendChild(el('div', { class: 'dim' }, `… ${kids.length - MAX_KIDS} more (use search)`));
      d.appendChild(box);
    };
    if (open) fill();
    d.addEventListener('toggle', fill);
    return d;
  }

  function render(obj) {
    const box = el('div', { class: 'rroot' });
    const top = entries(obj || {});
    if (!top.length) return el('p', { class: 'dim' }, 'No raw metadata.');
    top.forEach(([k, v], i) => box.appendChild(isBranch(v) ? branch(k, v, i === 0 && top.length <= 3) : leaf(k, v)));
    return box;
  }

  function search(obj, q) {
    const hits = [];
    const stack = [['', obj, 0]];
    let visited = 0;
    while (stack.length && hits.length < 400 && visited < 400000) {
      const [path, v, depth] = stack.pop();
      visited++;
      if (depth > 40) continue;
      for (const [k, x] of entries(v).reverse()) {
        const p = path ? path + ' › ' + k : k;
        if (isBranch(x)) {
          if (k.toLowerCase().includes(q)) hits.push([p, isEl(x) ? `<${x.localName}>` : '(group)']);
          stack.push([p, x, depth + 1]);
        } else {
          const s = leafText(x);
          if (k.toLowerCase().includes(q) || s.toLowerCase().includes(q)) hits.push([p, s]);
        }
      }
    }
    const box = el('div', { class: 'rhits' });
    if (!hits.length) box.appendChild(el('p', { class: 'dim' }, 'No matches.'));
    for (const [p, s] of hits) box.appendChild(el('div', { class: 'rleaf' }, el('span', { class: 'rk path' }, p), el('span', { class: 'rv' }, s.length > 300 ? s.slice(0, 300) + '…' : s)));
    if (hits.length >= 400) box.appendChild(el('p', { class: 'dim' }, 'Showing the first 400 matches.'));
    return box;
  }

  /** Plain-object copy (XML -> objects, no functions/canvases) for JSON export. */
  function plain(v, depth) {
    depth = depth || 0;
    if (depth > 60) return '(too deep)';
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return isNaN(v) ? null : v.toISOString();
    if (v instanceof Uint8Array) return `(${v.length} bytes)`;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    if (typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (isEl(v)) { const o = {}; for (const [k, x] of entries(v)) o[k] = plain(x, depth + 1); return o; }
    if (Array.isArray(v)) return v.map((x) => plain(x, depth + 1));
    if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return undefined;
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (k.startsWith('_')) continue; const p = plain(x, depth + 1); if (p !== undefined) o[k] = p; }
    return o;
  }

  M.rawTree = { render, search, plain, entries };
})();
