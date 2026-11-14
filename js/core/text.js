/* EasyMeta - helpers for the text inside microscopy files: XML (namespace-agnostic
 * lookups), INI sections and loose "key = value" lines.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const X = {
    parse(text) {
      const doc = new DOMParser().parseFromString(String(text).replace(/^﻿/, '').replace(/\0+$/, ''), 'application/xml');
      const err = doc.getElementsByTagName('parsererror')[0];
      if (err) throw new Error('XML parse error: ' + err.textContent.slice(0, 120));
      return doc;
    },
    /** All descendants named `name` (any namespace). */
    all(node, name) { return node ? Array.from(node.getElementsByTagNameNS('*', name)) : []; },
    /** First descendant named `name`. */
    one(node, name) { return node ? node.getElementsByTagNameNS('*', name)[0] || null : null; },
    /** Direct children (optionally only those named `name`). */
    kids(node, name) {
      if (!node) return [];
      return Array.from(node.children).filter((c) => !name || c.localName === name);
    },
    kid(node, name) { return X.kids(node, name)[0] || null; },
    /** Follow a path of child names: X.path(el, 'Information', 'Image', 'SizeX') */
    path(node, ...names) {
      let n = node;
      for (const name of names) { n = X.kid(n, name); if (!n) return null; }
      return n;
    },
    /** Trimmed text of a node, or of the first descendant named `name`. */
    text(node, name) {
      const n = name ? X.one(node, name) : node;
      if (!n) return null;
      const t = n.textContent.trim();
      return t === '' ? null : t;
    },
    num(node, name) { return M.num(X.text(node, name)); },
    attr(node, name) { return node && node.getAttribute ? node.getAttribute(name) : null; },
    attrNum(node, name) { return M.num(X.attr(node, name)); },
  };
  M.xml = X;

  /** INI text -> {section: {key: value}} (keys before any section go in ''). */
  M.parseIni = function (text) {
    const out = { '': {} };
    let sec = out[''];
    for (let line of String(text).split(/\r?\n|\r/)) {
      line = line.trim();
      if (!line || line[0] === ';' || line[0] === '#') continue;
      const m = line.match(/^\[(.+)\]$/);
      if (m) { sec = out[m[1].trim()] = out[m[1].trim()] || {}; continue; }
      const i = line.indexOf('=');
      if (i <= 0) continue;
      let v = line.slice(i + 1).trim();
      if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
      sec[line.slice(0, i).trim()] = v;
    }
    if (!Object.keys(out['']).length) delete out[''];
    return out;
  };

  /** Lines like "Key = value" or "Key: value" -> object (later keys win). */
  M.parseKeyValues = function (text, sepRe) {
    const out = {};
    sepRe = sepRe || /^\s*([^=:]+?)\s*[=:]\s*(.*?)\s*$/;
    for (const line of String(text).split(/\r?\n|\r/)) {
      const m = line.match(sepRe);
      if (m && m[1]) out[m[1].trim()] = m[2];
    }
    return out;
  };

  /** Numbers in a string: "1.5 2 -3e-2" -> [1.5, 2, -0.03]. */
  M.numbers = (s) => (String(s || '').match(/[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/g) || []).map(Number);
})();
