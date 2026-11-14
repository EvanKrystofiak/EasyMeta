/* EasyMeta - lookup of the measured fluorophore spectra bundled from FPbase
 * (js/data/spectra_fpbase.js, CC BY-SA 4.0; credits in SPECTRA_CREDITS.md).
 * Curves are stored at a fixed step, peak-normalised to 1000.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const D = M.spectraData || null;
  const byKey = new Map();
  if (D) {
    for (const e of D.entries) {
      for (const k of [M.dyes.key(e.name), M.dyes.key(e.fpbase), ...(e.aliases || [])]) {
        if (k && !byKey.has(k)) byKey.set(k, e);
      }
    }
  }

  /** Spectra entry for a dye or protein name, or null. */
  function lookup(name) {
    if (!D || !name) return null;
    const k = M.dyes.key(name);
    if (byKey.has(k)) return byKey.get(k);
    // a known name inside a longer label, e.g. "Phalloidin-AF488"
    let best = null;
    for (const key of byKey.keys()) if (key.length >= 4 && k.includes(key) && (!best || key.length > best.length)) best = key;
    return best ? byKey.get(best) : null;
  }

  /** Relative value (0..1) of a curve at wavelength nm (linear interpolation). */
  function at(curve, nm) {
    if (!curve) return 0;
    const i = (nm - curve.start) / D.step;
    if (i < 0 || i > curve.v.length - 1) return 0;
    const i0 = Math.floor(i), f = i - i0;
    const a = curve.v[i0], b = curve.v[Math.min(i0 + 1, curve.v.length - 1)];
    return (a + (b - a) * f) / 1000;
  }

  /** Area of a curve between lo and hi nm (arbitrary units). */
  function area(curve, lo, hi) {
    if (!curve) return 0;
    let s = 0;
    curve.v.forEach((v, i) => {
      const nm = curve.start + i * D.step;
      if (nm >= lo && nm <= hi) s += v;
    });
    return s;
  }

  const range = (curve) => (curve ? [curve.start, curve.start + (curve.v.length - 1) * D.step] : null);

  M.spectra = { available: !!D, data: D, lookup, at, area, range, step: D ? D.step : 2 };
})();
