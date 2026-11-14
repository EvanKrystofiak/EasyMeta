/* EasyMeta - SVG graphics.  Every function returns an SVG string sized by its
 * viewBox; colours come from CSS classes (g-*) so the same SVG works on the dark
 * app and the light printed report.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const F = M.fmt;
  const E = M.esc;
  const r1 = (v) => Math.round(v * 10) / 10;

  const svg = (w, h, body, cls) => `<svg class="gfx ${cls || ''}" viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" role="img">${body}</svg>`;
  const text = (x, y, s, cls, extra) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls || 'g-label'}" ${extra || ''}>${E(s)}</text>`;
  const line = (x1, y1, x2, y2, cls, extra) => `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}"${cls === undefined ? ' class="g-axis"' : cls ? ` class="${cls}"` : ''} ${extra || ''}/>`;
  const poly = (pts, cls, extra) => `<polygon points="${pts.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' ')}"${cls ? ` class="${cls}"` : ''} ${extra || ''}/>`;
  const niceStep = (span, target) => {
    const raw = span / (target || 6);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * p) return m * p;
    return 10 * p;
  };
  let uid = 0;

  // ================================================================ spectrum
  /**
   * Wavelength map of the light path: the top strip shows every laser line /
   * excitation band and detection window recorded in the file, plus the measured
   * FPbase spectra of the named dyes when bundled; one lane per channel adds its
   * dye's excitation (○) and emission (●) peak.  Nothing is estimated.
   */
  function spectrum(ds, opts) {
    opts = opts || {};
    const C = (ds.lm && ds.lm.channels) || [];
    const W = 920, laneH = 30, gutter = 170, right = 24;
    const lanes = C.length;
    const withSpectra = M.unique(C.map((c) => c.spectrum).filter(Boolean));
    const plotTop = 26, plotH = withSpectra.length ? 150 : 64, axisY = plotTop + plotH;
    const lanesTop = axisY + 40;
    const H = lanesTop + lanes * laneH + (withSpectra.length ? 56 : 34);
    // x range
    const wls = [];
    for (const c of C) {
      (c.exLines || []).forEach((l) => wls.push(l));
      if (c.exBand) wls.push(...c.exBand);
      if (c.emBand) wls.push(...c.emBand);
      if (M.isNum(c.dyeEx)) wls.push(c.dyeEx);
      if (M.isNum(c.dyeEm)) wls.push(c.dyeEm);
    }
    // let measured spectra widen the range a little, but not to their far tails
    for (const s of withSpectra) {
      if (s.exPeak) wls.push(s.exPeak - 60);
      if (s.emPeak) wls.push(s.emPeak + 80);
    }
    let lo = Math.min(380, ...wls.map((w) => w - 20)), hi = Math.max(720, ...wls.map((w) => w + 30));
    lo = Math.max(300, Math.floor(lo / 50) * 50);
    hi = Math.min(1100, Math.ceil(hi / 50) * 50);
    const x0 = gutter, x1 = W - right;
    const X = (l) => x0 + ((l - lo) / (hi - lo)) * (x1 - x0);
    const id = 'sp' + uid++;
    let b = '';
    // rainbow strip
    let stops = '';
    for (let l = lo; l <= hi; l += 10) stops += `<stop offset="${((l - lo) / (hi - lo)) * 100}%" stop-color="${M.wavelengthHex(l)}"/>`;
    b += `<defs><linearGradient id="${id}r" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs>`;
    b += `<rect x="${x0}" y="${plotTop}" width="${x1 - x0}" height="${plotH}" class="g-plotbg"/>`;
    const step = 50;
    for (let l = Math.ceil(lo / step) * step; l <= hi; l += step) {
      b += line(X(l), plotTop, X(l), axisY, 'g-grid');
      b += text(X(l), axisY + 26, l, 'g-tick', 'text-anchor="middle"');
    }
    b += `<rect x="${x0}" y="${axisY + 2}" width="${x1 - x0}" height="9" fill="url(#${id}r)" rx="2"/>`;
    b += text(x1, axisY + 26 + 14, 'wavelength (nm)', 'g-dim', 'text-anchor="end"');
    b += text(x0 - 10, plotTop + 26, 'all channels', 'g-dim', 'text-anchor="end"');
    b += text(x0 - 10, plotTop + 42, '(as recorded)', 'g-tiny', 'text-anchor="end"');
    if (withSpectra.length) b += text(x0 - 10, plotTop + 64, 'dye spectra:', 'g-tiny', 'text-anchor="end"') + text(x0 - 10, plotTop + 78, 'FPbase', 'g-tiny', 'text-anchor="end"');
    // detection windows of all channels (translucent so overlaps show)
    C.forEach((c) => {
      if (!c.emBand) return;
      b += `<rect x="${r1(X(c.emBand[0]))}" y="${plotTop}" width="${r1(X(c.emBand[1]) - X(c.emBand[0]))}" height="${plotH}" fill="${c.color}" opacity="${withSpectra.length ? 0.14 : 0.22}"/>`;
    });
    // measured spectra (FPbase): emission filled, excitation dashed (dotted when it is absorption)
    let anyAbs = false;
    const drawn = new Set();
    C.forEach((c) => {
      const s = c.spectrum;
      if (!s || drawn.has(s)) return;
      drawn.add(s);
      const credit = [s.credit && s.credit.supplier, s.credit && s.credit.source].filter(Boolean).join(', ');
      const curve = (cv) => {
        const pts = [];
        for (let k = 0; k < cv.v.length; k++) {
          const nm = cv.start + k * M.spectra.step;
          if (nm < lo || nm > hi) continue;
          pts.push(`${r1(X(nm))} ${r1(axisY - (cv.v[k] / 1000) * (plotH - 10))}`);
        }
        return pts.length > 1 ? 'M' + pts.join(' L') : '';
      };
      if (s.em) {
        const d = curve(s.em);
        if (d) {
          const first = d.slice(1).split(' L')[0].split(' ')[0], last = d.split(' L').pop().split(' ')[0];
          b += `<path d="${d} L${last} ${axisY} L${first} ${axisY} Z" fill="${c.color}" opacity="0.18"/>`;
          b += `<path d="${d}" fill="none" stroke="${c.color}" stroke-width="2"><title>${M.esc(s.name)} emission spectrum (FPbase #${s.em.id}${credit ? '; ' + M.esc(credit) : ''})</title></path>`;
        }
      }
      if (s.ex) {
        const d = curve(s.ex);
        if (s.ex.kind === 'ab') anyAbs = true;
        if (d) b += `<path d="${d}" fill="none" stroke="${c.color}" stroke-width="1.8" stroke-dasharray="${s.ex.kind === 'ab' ? '1.5 3' : '6 4'}" opacity="0.9"><title>${M.esc(s.name)} ${s.ex.kind === 'ab' ? 'absorption' : 'excitation'} spectrum (FPbase #${s.ex.id}${credit ? '; ' + M.esc(credit) : ''})</title></path>`;
      }
    });
    // excitation bands (LED / filter) and laser lines
    C.forEach((c) => {
      if (c.exBand && !(c.exLines || []).length) {
        b += `<rect x="${r1(X(c.exBand[0]))}" y="${plotTop}" width="${r1(X(c.exBand[1]) - X(c.exBand[0]))}" height="${plotH}" fill="none" stroke="${M.wavelengthHex((c.exBand[0] + c.exBand[1]) / 2)}" stroke-dasharray="3 3" opacity="0.8"/>`;
      }
    });
    const lines = M.unique(C.flatMap((c) => c.exLines || []));
    lines.forEach((l) => {
      const col = M.wavelengthHex(l);
      b += line(X(l), plotTop, X(l), axisY, '', `stroke="${col}" stroke-width="5" opacity="0.25"`);
      b += line(X(l), plotTop, X(l), axisY, '', `stroke="${col}" stroke-width="2"`);
      b += text(X(l), plotTop - 8, l, 'g-laser', `text-anchor="middle" fill="${col}"`);
    });
    // one lane per channel: detection window, laser lines, dye peaks
    let anyPeak = false, anyFile = false;
    C.forEach((c, i) => {
      const y = lanesTop + i * laneH, yc = y + laneH / 2 + 2;
      b += `<rect x="${x0}" y="${y + 2}" width="${x1 - x0}" height="${laneH - 4}" class="g-lane" rx="4"/>`;
      b += `<circle cx="${12}" cy="${yc}" r="5" fill="${c.color}"/>`;
      const fileOnly = c.dyeSource === 'file'; // dye not recognised: the file's stored ex/em wavelengths
      if (fileOnly) anyFile = true;
      let label = (c.dye && c.dye !== c.name ? `${c.name} · ${c.dye}` : c.name) || `Channel ${i + 1}`;
      if (label.length > 25) label = label.slice(0, 24) + '…';
      b += text(22, yc + 4, label + (fileOnly ? ' ‡' : ''), 'g-lanelabel');
      if (c.emBand) {
        const a = X(c.emBand[0]), z = X(c.emBand[1]);
        b += `<rect x="${r1(a)}" y="${yc - 7}" width="${r1(Math.max(2, z - a))}" height="14" rx="3" fill="${c.color}" opacity="0.55"><title>detection ${Math.round(c.emBand[0])}–${Math.round(c.emBand[1])} nm (from file)</title></rect>`;
        const rgb = (c.color || '#888888').match(/\w\w/g).map((h) => parseInt(h, 16));
        const lum = (0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]) * 0.55 + 26 * 0.45; // band drawn at 55 % over the lane
        const peakInside = [c.dyeEx, c.dyeEm].some((p) => M.isNum(p) && p > c.emBand[0] && p < c.emBand[1]);
        if (z - a > 76 && !peakInside) b += text((a + z) / 2, yc + 4, `${Math.round(c.emBand[0])}–${Math.round(c.emBand[1])}`, 'g-bandtext', `text-anchor="middle" style="fill:${lum > 95 ? '#0b1412' : '#ffffff'}"`);
      }
      if (c.exBand && !(c.exLines || []).length) {
        const a = X(c.exBand[0]), z = X(c.exBand[1]);
        b += `<rect x="${r1(a)}" y="${yc - 7}" width="${r1(Math.max(2, z - a))}" height="14" rx="3" fill="none" stroke="${M.wavelengthHex((c.exBand[0] + c.exBand[1]) / 2)}" stroke-dasharray="3 2"><title>excitation ${Math.round(c.exBand[0])}–${Math.round(c.exBand[1])} nm (from file)</title></rect>`;
      }
      // dye peaks: ○ excitation, ● emission, joined by the Stokes shift
      const src = fileOnly ? 'wavelength stored in the file' : c.dyeSource === 'FPbase' ? 'peak of the FPbase spectrum' : 'published peak';
      if (M.isNum(c.dyeEx) && M.isNum(c.dyeEm)) b += line(X(c.dyeEx), yc, X(c.dyeEm), yc, 'g-stokes');
      if (M.isNum(c.dyeEx)) {
        anyPeak = true;
        b += `<circle cx="${r1(X(c.dyeEx))}" cy="${yc}" r="5.5" class="g-expeak" style="stroke:${M.wavelengthHex(c.dyeEx)}"><title>${M.esc(c.dye || c.name)} excitation ${Math.round(c.dyeEx)} nm (${src})</title></circle>`;
      }
      if (M.isNum(c.dyeEm)) {
        anyPeak = true;
        b += `<circle cx="${r1(X(c.dyeEm))}" cy="${yc}" r="5.5" class="g-empeak" style="fill:${M.wavelengthHex(c.dyeEm)}"><title>${M.esc(c.dye || c.name)} emission ${Math.round(c.dyeEm)} nm (${src})</title></circle>`;
      }
      for (const l of c.exLines || []) {
        // filled: the line that excites this channel's dye; outline: another line on in the same track
        const x = X(l), col = M.wavelengthHex(l);
        const main = !c.exMain || c.exMain.includes(l);
        b += poly([[x - 6, y + 3], [x + 6, y + 3], [x, yc - 6]], '', (main ? `fill="${col}"` : `fill="none" stroke="${col}" stroke-width="1.5"`)) .replace('/>', `><title>${l} nm laser${main ? '' : ' (on in this track)'}</title></polygon>`);
      }
    });
    // legend (a second row for the spectra)
    let ly = H - (withSpectra.length ? 34 : 12);
    let lx = 12;
    const leg = (s, sym) => { b += sym(lx, ly) + text(lx + 24, ly + 4, s, 'g-dim'); lx += 24 + s.length * 6.3 + 16; };
    leg('laser line', (x, y) => poly([[x + 4, y - 6], [x + 16, y - 6], [x + 10, y + 5]], '', 'fill="#e7ebf2"'));
    leg('detection window', (x, y) => `<rect x="${x}" y="${y - 5}" width="20" height="10" rx="2" class="g-legendband"/>`);
    if (anyPeak) {
      leg('dye excitation peak', (x, y) => `<circle cx="${x + 10}" cy="${y}" r="5" class="g-expeak" style="stroke:#e7ebf2"/>`);
      leg('dye emission peak', (x, y) => `<circle cx="${x + 10}" cy="${y}" r="5" class="g-empeak" style="fill:#e7ebf2"/>`);
    }
    if (anyFile) b += text(W - right, ly + 4, '‡ dye not recognised: ex/em wavelengths as stored in the file', 'g-tiny', 'text-anchor="end"');
    if (withSpectra.length) {
      ly = H - 12;
      lx = 12;
      leg('excitation spectrum', (x, y) => line(x, y, x + 20, y, 'g-legendline', 'stroke-width="1.8" stroke-dasharray="6 4"'));
      if (anyAbs) leg('absorption (no excitation spectrum)', (x, y) => line(x, y, x + 20, y, 'g-legendline', 'stroke-width="1.8" stroke-dasharray="1.5 3"'));
      leg('emission spectrum', (x, y) => line(x, y, x + 20, y, 'g-legendline', 'stroke-width="2"'));
      b += text(W - right, ly + 4, 'measured spectra: FPbase (fpbase.org), CC BY-SA 4.0', 'g-tiny', 'text-anchor="end"');
    }
    return svg(W, H, b, 'gfx-spectrum');
  }

  // ================================================================ iso box
  /**
   * opts: {sx, sy, sz: sizes (any unit, same for all), labels: {x, y, z},
   *        texture: dataURL, slices: n, frames: n, channels: [{color, name}],
   *        thin: minimum visual thickness fraction, note}
   */
  function isoBox(o) {
    const W = 640, H = 420;
    let { sx, sy, sz } = o;
    if (!(sx > 0)) sx = 1;
    if (!(sy > 0)) sy = sx;
    if (!(sz > 0)) sz = 0;
    const L = Math.max(sx, sy, sz);
    let a = sx / L, bb = sy / L, c = sz / L;
    const minC = 0.025;
    let exaggerated = false;
    if (c < minC) { if (c > 0) exaggerated = true; c = minC; }
    const cos = Math.cos(Math.PI / 6), sin = Math.sin(Math.PI / 6);
    const P = (x, y, z) => [(x - y) * cos, (x + y) * sin - z];
    const corners = [];
    for (const x of [0, a]) for (const y of [0, bb]) for (const z of [0, c]) corners.push(P(x, y, z));
    const minX = Math.min(...corners.map((p) => p[0])), maxX = Math.max(...corners.map((p) => p[0]));
    const minY = Math.min(...corners.map((p) => p[1])), maxY = Math.max(...corners.map((p) => p[1]));
    const lab = o.labels || {};
    // room on the right for the Z label, at least for it on two lines
    const zParts = lab.z ? lab.z.split(' · ') : [];
    const zW = zParts.length ? Math.max(zParts[0].length, zParts.slice(1).join(' · ').length) * 6.9 + 22 : 0;
    const pad = { l: 70, r: Math.max(70, zW), t: 46, b: 78 };
    const ghosts = o.frames > 1 ? 3 : 0;
    const k = Math.min((W - pad.l - pad.r - ghosts * 16) / (maxX - minX), (H - pad.t - pad.b - ghosts * 10) / (maxY - minY));
    const ox = pad.l - minX * k + (W - pad.l - pad.r - ghosts * 16 - (maxX - minX) * k) / 2;
    const oy = pad.t + ghosts * 10 - minY * k + (H - pad.t - pad.b - ghosts * 10 - (maxY - minY) * k) / 2;
    const S = (x, y, z, dx, dy) => { const p = P(x, y, z); return [ox + p[0] * k + (dx || 0), oy + p[1] * k + (dy || 0)]; };
    const id = 'iso' + uid++;
    let b = '';
    // time-lapse ghosts behind
    for (let g = ghosts; g >= 1; g--) {
      const dx = g * 16, dy = -g * 10;
      b += poly([S(0, 0, c, dx, dy), S(a, 0, c, dx, dy), S(a, bb, c, dx, dy), S(0, bb, c, dx, dy)], 'g-ghost');
      b += poly([S(a, 0, 0, dx, dy), S(a, bb, 0, dx, dy), S(a, bb, c, dx, dy), S(a, 0, c, dx, dy)], 'g-ghost');
    }
    // faces
    b += poly([S(0, bb, 0), S(a, bb, 0), S(a, bb, c), S(0, bb, c)], 'g-face-left');
    b += poly([S(a, 0, 0), S(a, bb, 0), S(a, bb, c), S(a, 0, c)], 'g-face-right');
    const top = [S(0, 0, c), S(a, 0, c), S(a, bb, c), S(0, bb, c)];
    b += poly(top, 'g-face-top');
    if (o.texture) {
      const O = top[0], ex = [top[1][0] - O[0], top[1][1] - O[1]], ey = [top[3][0] - O[0], top[3][1] - O[1]];
      b += `<clipPath id="${id}c"><polygon points="${top.map((p) => r1(p[0]) + ',' + r1(p[1])).join(' ')}"/></clipPath>`;
      // clip on a wrapping group: a clip-path on the image itself would be read in its transformed space
      b += `<g clip-path="url(#${id}c)"><image href="${o.texture}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" transform="matrix(${ex[0]} ${ex[1]} ${ey[0]} ${ey[1]} ${O[0]} ${O[1]})" opacity="0.95"/></g>`;
      b += poly(top, 'g-face-top-edge');
    }
    // slices on the side faces
    const ns = o.slices || 0;
    if (ns > 1 && !exaggerated) {
      const n = Math.min(ns, 48);
      for (let i = 1; i < n; i++) {
        const z = (c * i) / n;
        b += line(...S(0, bb, z), ...S(a, bb, z), 'g-slice');
        b += line(...S(a, bb, z), ...S(a, 0, z), 'g-slice');
      }
    }
    // channel colour strip along the front-left top edge
    if (o.channels && o.channels.length > 1) {
      const n = o.channels.length;
      o.channels.forEach((ch, i) => {
        const p1 = S((a * i) / n, bb, c), p2 = S((a * (i + 1)) / n, bb, c);
        b += line(p1[0], p1[1], p2[0], p2[1], '', `stroke="${ch.color}" stroke-width="5" stroke-linecap="butt"`);
      });
    }
    // dimension labels
    const edgeLabel = (p1, p2, s, off, anchor) => {
      const mx = (p1[0] + p2[0]) / 2 + off[0], my = (p1[1] + p2[1]) / 2 + off[1];
      let ang = (Math.atan2(p2[1] - p1[1], p2[0] - p1[0]) * 180) / Math.PI;
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      return `<text x="${r1(mx)}" y="${r1(my)}" class="g-dimlabel" text-anchor="${anchor || 'middle'}" transform="rotate(${r1(ang)} ${r1(mx)} ${r1(my)})">${E(s)}</text>`;
    };
    if (lab.x) b += edgeLabel(S(0, bb, 0), S(a, bb, 0), lab.x, [-12, 24]);
    if (lab.y) b += edgeLabel(S(a, bb, 0), S(a, 0, 0), lab.y, [14, 24]);
    if (lab.z) {
      // beside the right-hand vertical edge, so it never meets the X and Y labels under the
      // box; on two lines when one does not fit, and kept above the Y label's far end
      const q1 = S(a, 0, 0), q2 = S(a, 0, c);
      const midY = (q1[1] + q2[1]) / 2, zx = q1[0] + 16;
      const lines = zx + lab.z.length * 6.9 <= W - 6 || zParts.length < 2 ? [lab.z] : [zParts[0], zParts.slice(1).join(' · ')];
      const span = (lines.length - 1) * 15;
      const y0 = Math.min(midY + 4 - span / 2, q1[1] - 1 - span);
      b += line(q1[0] + 3, midY, zx - 4, y0 - 4 + span / 2, 'g-leader');
      lines.forEach((s, i) => { b += text(zx, y0 + i * 15, s, 'g-dimlabel', 'text-anchor="start"'); });
    }
    if (exaggerated) b += text(W / 2, H - 8, `thickness drawn ${Math.round(minC / (sz / L))}× thicker than true scale`, 'g-dim', 'text-anchor="middle"');
    else if (o.note) b += text(W / 2, H - 8, o.note, 'g-dim', 'text-anchor="middle"');
    if (ghosts) b += text(S(a, 0, c, ghosts * 16, -ghosts * 10)[0] + 8, S(a, 0, c, ghosts * 16, -ghosts * 10)[1], `× ${o.frames} time points`, 'g-dimlabel');
    return svg(W, H, b, 'gfx-iso');
  }

  // ================================================================ tilt fan
  function tiltFan(T, opts) {
    opts = opts || {};
    const info = T.info;
    const W = 520, H = 300, cx = W / 2, cy = 252, R = 200;
    const pt = (deg, r) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)];
    let b = '';
    const arc = (a1, a2, r) => { const p1 = pt(a1, r), p2 = pt(a2, r); return `M${r1(p1[0])} ${r1(p1[1])} A${r} ${r} 0 0 1 ${r1(p2[0])} ${r1(p2[1])}`; };
    const wedge = (a1, a2) => { const p1 = pt(a1, R), p2 = pt(a2, R); return `M${cx} ${cy} L${r1(p1[0])} ${r1(p1[1])} A${R} ${R} 0 0 1 ${r1(p2[0])} ${r1(p2[1])} Z`; };
    const id = 'fan' + uid++;
    b += `<defs><pattern id="${id}h" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="8" class="g-hatch"/></pattern></defs>`;
    b += `<path d="${wedge(-90, 90)}" class="g-plotbg"/>`;
    if (info) {
      if (info.max < 90) b += `<path d="${wedge(info.max, 90)}" fill="url(#${id}h)" class="g-wedge"/>`;
      if (info.min > -90) b += `<path d="${wedge(-90, info.min)}" fill="url(#${id}h)" class="g-wedge"/>`;
    }
    for (const r of [R * 0.5, R]) b += `<path d="${arc(-90, 90, r)}" class="g-grid" fill="none"/>`;
    for (const a of [-90, -60, -30, 0, 30, 60, 90]) {
      const p = pt(a, R + 16);
      b += line(...pt(a, R * 0.15), ...pt(a, R), 'g-grid');
      b += text(p[0], p[1] + 4, (a > 0 ? '+' : a < 0 ? M.fmt.MINUS : '') + Math.abs(a) + '°', 'g-tick', 'text-anchor="middle"');
    }
    const tilts = (T.tilts || []).filter((t) => M.isNum(t.angle));
    const n = tilts.length;
    const hasOrder = tilts.some((t) => M.isNum(t.order));
    const drawn = hasOrder ? tilts.slice().sort((x, y) => (y.order || 0) - (x.order || 0)) : tilts;
    for (const t of drawn) {
      const col = hasOrder ? M.orderColor((t.order - 1) / Math.max(1, n - 1)) : '#17c3b2';
      const hi = T.highlight !== undefined && t.mdocIndex === T.highlight;
      b += line(...pt(t.angle, R * 0.16), ...pt(t.angle, R * 0.97), '', `stroke="${hi ? '#ffffff' : col}" stroke-width="${hi ? 4 : 2}" stroke-linecap="round" opacity="${hi ? 1 : 0.9}"`);
    }
    if (hasOrder) {
      const first = tilts.find((t) => t.order === 1), last = tilts.find((t) => t.order === n);
      if (first) { const p = pt(first.angle, R * 0.97); b += `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="6" class="g-first"/>` + text(p[0], p[1] - 10, 'first', 'g-tiny', 'text-anchor="middle"'); }
      if (last) { const p = pt(last.angle, R * 0.97); b += `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="5" class="g-last"/>` + text(p[0], p[1] - 10, 'last', 'g-tiny', 'text-anchor="middle"'); }
    }
    // specimen
    b += `<rect x="${cx - 46}" y="${cy - 5}" width="92" height="10" rx="3" class="g-specimen"/>`;
    b += text(cx, cy + 26, 'specimen (tilt axis ⟂ page)', 'g-dim', 'text-anchor="middle"');
    if (info && (info.max < 90 || info.min > -90)) b += text(W - 6, 20, 'missing wedge', 'g-dim', 'text-anchor="end"') + `<rect x="${W - 112}" y="10" width="12" height="12" fill="url(#${id}h)" class="g-wedge"/>`;
    if (hasOrder) {
      b += `<defs><linearGradient id="${id}g"><stop offset="0" stop-color="#17c3b2"/><stop offset="0.5" stop-color="#e3b341"/><stop offset="1" stop-color="#e0574a"/></linearGradient></defs>`;
      b += `<rect x="8" y="10" width="90" height="8" rx="3" fill="url(#${id}g)"/>` + text(8, 32, 'first', 'g-tiny') + text(98, 32, 'last acquired', 'g-tiny', 'text-anchor="end"');
    }
    return svg(W, H, b, 'gfx-fan');
  }

  // ================================================================ order chart
  function tiltOrder(T) {
    const tilts = (T.tilts || []).filter((t) => M.isNum(t.angle) && M.isNum(t.order)).sort((a, b) => a.order - b.order);
    if (tilts.length < 2) return '';
    const W = 560, H = 300, l = 52, r = 16, t = 20, bt = 44;
    const n = tilts.length;
    const amin = Math.min(...tilts.map((x) => x.angle)), amax = Math.max(...tilts.map((x) => x.angle));
    const st = niceStep(amax - amin || 10, 6);
    const ylo = Math.floor(amin / st) * st, yhi = Math.ceil(amax / st) * st;
    const X = (i) => l + ((i - 1) / Math.max(1, n - 1)) * (W - l - r);
    const Y = (a) => t + (1 - (a - ylo) / (yhi - ylo || 1)) * (H - t - bt);
    let b = `<rect x="${l}" y="${t}" width="${W - l - r}" height="${H - t - bt}" class="g-plotbg"/>`;
    for (let a = ylo; a <= yhi + 1e-9; a += st) { b += line(l, Y(a), W - r, Y(a), Math.abs(a) < 1e-9 ? 'g-zero' : 'g-grid') + text(l - 6, Y(a) + 4, F.num(a, st % 1 ? 1 : 0) + '°', 'g-tick', 'text-anchor="end"'); }
    const xs = Math.max(1, niceStep(n, 8));
    for (let i = xs; i <= n; i += xs) b += line(X(i), H - bt, X(i), H - bt + 5, 'g-axis') + text(X(i), H - bt + 18, i, 'g-tick', 'text-anchor="middle"');
    b += text(X(1), H - bt + 18, 1, 'g-tick', 'text-anchor="middle"');
    b += text((l + W - r) / 2, H - 8, 'acquisition order', 'g-dim', 'text-anchor="middle"');
    b += `<text transform="translate(14 ${(t + H - bt) / 2}) rotate(-90)" class="g-dim" text-anchor="middle">tilt angle</text>`;
    let path = '';
    tilts.forEach((x, i) => { path += (i ? ' L' : 'M') + r1(X(x.order)) + ' ' + r1(Y(x.angle)); });
    b += `<path d="${path}" class="g-trace" fill="none"/>`;
    tilts.forEach((x) => { b += `<circle cx="${r1(X(x.order))}" cy="${r1(Y(x.angle))}" r="${n > 80 ? 2.5 : 3.5}" fill="${M.orderColor((x.order - 1) / Math.max(1, n - 1))}"/>`; });
    return svg(W, H, b, 'gfx-order');
  }

  // ================================================================ dose chart
  function tiltDose(T) {
    const tilts = (T.tilts || []).filter((t) => M.isNum(t.angle) && (M.isNum(t.dose) || M.isNum(t.cumBefore)));
    if (tilts.length < 2 || !tilts.some((t) => M.isNum(t.cumAfter) && t.cumAfter > 0)) return '';
    const W = 560, H = 300, l = 56, r = 16, t = 20, bt = 44;
    const amin = Math.min(...tilts.map((x) => x.angle)), amax = Math.max(...tilts.map((x) => x.angle));
    const dmax = Math.max(...tilts.map((x) => x.cumAfter || 0));
    const st = niceStep(dmax, 5);
    const yhi = Math.ceil(dmax / st) * st;
    const span = amax - amin || 1;
    const X = (a) => l + ((a - amin) / span) * (W - l - r - 12) + 6;
    const Y = (d) => t + (1 - d / yhi) * (H - t - bt);
    const bw = Math.max(2, Math.min(14, ((W - l - r) / tilts.length) * 0.7));
    const n = Math.max(...tilts.map((x) => x.order || 0));
    let b = `<rect x="${l}" y="${t}" width="${W - l - r}" height="${H - t - bt}" class="g-plotbg"/>`;
    for (let d = 0; d <= yhi + 1e-9; d += st) b += line(l, Y(d), W - r, Y(d), 'g-grid') + text(l - 6, Y(d) + 4, F.num(d, st % 1 ? 1 : 0), 'g-tick', 'text-anchor="end"');
    const ast = niceStep(span, 6);
    for (let a = Math.ceil(amin / ast) * ast; a <= amax + 1e-9; a += ast) b += text(X(a), H - bt + 18, F.num(a, ast % 1 ? 1 : 0) + '°', 'g-tick', 'text-anchor="middle"');
    b += text((l + W - r) / 2, H - 8, 'tilt angle', 'g-dim', 'text-anchor="middle"');
    b += `<text transform="translate(14 ${(t + H - bt) / 2}) rotate(-90)" class="g-dim" text-anchor="middle">dose (e⁻/Å²)</text>`;
    for (const x of tilts) {
      const before = M.isNum(x.cumBefore) ? x.cumBefore : 0, after = M.isNum(x.cumAfter) ? x.cumAfter : before + (x.dose || 0);
      const col = M.isNum(x.order) && n ? M.orderColor((x.order - 1) / Math.max(1, n - 1)) : '#17c3b2';
      b += `<rect x="${r1(X(x.angle) - bw / 2)}" y="${r1(Y(before))}" width="${r1(bw)}" height="${r1(Y(0) - Y(before))}" class="g-prior"/>`;
      b += `<rect x="${r1(X(x.angle) - bw / 2)}" y="${r1(Y(after))}" width="${r1(bw)}" height="${r1(Math.max(1, Y(before) - Y(after)))}" fill="${col}"/>`;
    }
    b += `<rect x="${l + 10}" y="${t + 8}" width="10" height="10" class="g-prior"/>` + text(l + 26, t + 17, 'dose received before this tilt', 'g-tiny');
    b += `<rect x="${l + 10}" y="${t + 24}" width="10" height="10" fill="#17c3b2"/>` + text(l + 26, t + 33, 'dose of this tilt', 'g-tiny');
    return svg(W, H, b, 'gfx-dose');
  }

  // ================================================================ beam footprint
  function beamFootprint(ds) {
    const em = ds.em || {};
    const D = em.illuminatedArea, fx = ds.geometry && ds.geometry.fovX, fy = ds.geometry && ds.geometry.fovY;
    if (!M.isNum(D) || !M.isNum(fx)) return '';
    const W = 420, H = 300;
    const span = Math.max(D, Math.hypot(fx, fy)) * 1.12;
    const k = (H - 60) / span;
    const cx = W / 2, cy = (H - 30) / 2 + 6;
    let b = `<circle cx="${cx}" cy="${cy}" r="${r1((D / 2) * k)}" class="g-beam"/>`;
    b += `<rect x="${r1(cx - (fx / 2) * k)}" y="${r1(cy - (fy / 2) * k)}" width="${r1(fx * k)}" height="${r1(fy * k)}" class="g-camera"/>`;
    b += text(cx, cy - (D / 2) * k - 8, `illuminated area Ø ${F.len(D)}`, 'g-beamlabel', 'text-anchor="middle"');
    const camLabel = `camera field ${F.len(fx)} × ${F.len(fy)}`;
    const fits = fx * k > camLabel.length * 7 + 12;
    b += text(cx, fits ? cy + 4 : cy + (fy / 2) * k + 18, camLabel, 'g-dimlabel', 'text-anchor="middle"');
    const covered = Math.hypot(fx, fy) <= D;
    b += text(cx, H - 8, covered ? 'the beam covers the whole camera field' : 'parts of the camera field are outside the beam', covered ? 'g-dim' : 'g-warntext', 'text-anchor="middle"');
    return svg(W, H, b, 'gfx-beam');
  }

  // ================================================================ frames
  function frames(ds) {
    const mv = ds.movie || {};
    const n = mv.frames || ds.dims.z;
    if (!n || n < 2) return '';
    const W = 640, H = 120;
    const show = Math.min(n, 48);
    const fw = (W - 40) / show;
    let b = '';
    for (let i = 0; i < show; i++) {
      const x = 20 + i * fw;
      b += `<rect x="${r1(x + 1)}" y="22" width="${r1(Math.max(1, fw - 2))}" height="48" rx="2" class="g-frame" opacity="${0.45 + 0.55 * (i / show)}"/>`;
    }
    if (n > show) b += text(W - 20, 90, `${show} of ${F.int(n)} frames drawn`, 'g-tiny', 'text-anchor="end"');
    const dose = mv.frameDose ? `${F.auto(mv.frameDose, 3)} e⁻/Å² per frame` : '';
    b += text(20, 14, `${F.int(n)} frames` + (dose ? ` · ${dose}` : ''), 'g-dimlabel');
    if (ds.em && M.isNum(ds.em.exposure)) b += text(20, 90, `${F.time(ds.em.exposure)} exposure` + (M.isNum(ds.em.dosePerImage) ? ` · Dose on Camera ${F.dose(ds.em.dosePerImage)}` : ''), 'g-dim');
    return svg(W, H, b, 'gfx-frames');
  }

  // ================================================================ montage
  function montage(ds) {
    const mt = ds.montage;
    if (!mt || !mt.pieces || !mt.pieces.length) return '';
    const pw = mt.width || 1, ph = mt.height || 1;
    const xs = mt.pieces.map((p) => p.x), ys = mt.pieces.map((p) => p.y);
    const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs) + pw, maxY = Math.max(...ys) + ph;
    const W = 560, H = 380;
    const k = Math.min((W - 40) / (maxX - minX), (H - 40) / (maxY - minY));
    let b = '';
    mt.pieces.forEach((p, i) => {
      const x = 20 + (p.x - minX) * k, y = 20 + (p.y - minY) * k;
      b += `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(pw * k)}" height="${r1(ph * k)}" class="g-piece"/>`;
      if (mt.pieces.length <= 100) b += text(x + (pw * k) / 2, y + (ph * k) / 2 + 4, i + 1, 'g-tiny', 'text-anchor="middle"');
    });
    return svg(W, H, b, 'gfx-montage');
  }

  M.gfx = { spectrum, isoBox, tiltFan, tiltOrder, tiltDose, beamFootprint, frames, montage };
})();
