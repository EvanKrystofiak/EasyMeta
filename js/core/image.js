/* EasyMeta - cheap previews: read one plane (or a subset of its rows), shrink it,
 * auto-contrast it and draw it on a canvas.  Also the small decoders TIFF needs
 * (LZW, PackBits, Deflate via the browser's DecompressionStream).
 */
(function () {
  'use strict';
  const M = window.EasyMeta;

  const MAX_FULL_READ = 16 * 1024 * 1024; // read a whole plane up to this size; above it, sample rows
  const TYPE_BYTES = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f16: 2, f32: 4, f64: 8, rgb8: 3, rgba8: 4, u4: 0.5 };
  const hostLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

  function half(h) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
    if (e === 31) return f ? NaN : s * Infinity;
    return s * Math.pow(2, e - 15) * (1 + f / 1024);
  }

  /** Convert raw bytes to a Float32Array of `n` samples of `type`. */
  function toFloat(bytes, type, n, le) {
    const out = new Float32Array(n);
    const aligned = (bytes.byteOffset % Math.max(1, Math.floor(TYPE_BYTES[type] || 1))) === 0;
    if (le === hostLE && aligned) {
      const buf = bytes.buffer, o = bytes.byteOffset;
      let v = null;
      if (type === 'u8') v = new Uint8Array(buf, o, n);
      else if (type === 'i8') v = new Int8Array(buf, o, n);
      else if (type === 'u16') v = new Uint16Array(buf, o, n);
      else if (type === 'i16') v = new Int16Array(buf, o, n);
      else if (type === 'u32') v = new Uint32Array(buf, o, n);
      else if (type === 'i32') v = new Int32Array(buf, o, n);
      else if (type === 'f32') v = new Float32Array(buf, o, n);
      else if (type === 'f64') v = new Float64Array(buf, o, n);
      if (v) { out.set(v); return out; }
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < n; i++) {
      switch (type) {
        case 'u8': out[i] = dv.getUint8(i); break;
        case 'i8': out[i] = dv.getInt8(i); break;
        case 'u16': out[i] = dv.getUint16(i * 2, le); break;
        case 'i16': out[i] = dv.getInt16(i * 2, le); break;
        case 'u32': out[i] = dv.getUint32(i * 4, le); break;
        case 'i32': out[i] = dv.getInt32(i * 4, le); break;
        case 'f16': out[i] = half(dv.getUint16(i * 2, le)); break;
        case 'f32': out[i] = dv.getFloat32(i * 4, le); break;
        case 'f64': out[i] = dv.getFloat64(i * 8, le); break;
        case 'u4': out[i] = (i & 1) ? (dv.getUint8(i >> 1) >> 4) : (dv.getUint8(i >> 1) & 15); break;
        default: out[i] = 0;
      }
    }
    return out;
  }

  /** Box-average a w×h image down so its longer side is <= maxDim. */
  function shrink(data, w, h, maxDim) {
    const f = Math.max(1, Math.ceil(Math.max(w, h) / maxDim));
    if (f === 1) return { data, w, h };
    const ow = Math.max(1, Math.floor(w / f)), oh = Math.max(1, Math.floor(h / f));
    const out = new Float32Array(ow * oh);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        let s = 0, c = 0;
        for (let yy = y * f; yy < (y + 1) * f && yy < h; yy++) {
          const row = yy * w;
          for (let xx = x * f; xx < (x + 1) * f && xx < w; xx++) {
            const v = data[row + xx];
            if (v === v) { s += v; c++; }
          }
        }
        out[y * ow + x] = c ? s / c : 0;
      }
    }
    return { data: out, w: ow, h: oh };
  }

  /** Shrink only along X (rows were already sub-sampled). */
  function shrinkX(data, w, h, ow) {
    if (ow >= w) return { data, w, h };
    const f = w / ow;
    const out = new Float32Array(ow * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < ow; x++) {
        const a = Math.floor(x * f), b = Math.max(a + 1, Math.floor((x + 1) * f));
        let s = 0, c = 0;
        for (let xx = a; xx < b; xx++) { const v = data[y * w + xx]; if (v === v) { s += v; c++; } }
        out[y * ow + x] = c ? s / c : 0;
      }
    }
    return { data: out, w: ow, h };
  }

  /**
   * Read one uncompressed plane from `src` and return it shrunk to <= maxDim.
   * spec: {offset, width, height, type, le, rowBytes?}.  Planes bigger than
   * MAX_FULL_READ are sampled every k-th row so only a fraction is read.
   */
  async function readPlane(src, spec, maxDim) {
    maxDim = maxDim || 512;
    const { width: w, height: h, type } = spec;
    const le = spec.le !== false;
    const bpp = TYPE_BYTES[type];
    const rowBytes = spec.rowBytes || Math.ceil(w * bpp);
    const total = rowBytes * h;
    if (total <= MAX_FULL_READ) {
      const bytes = await src.read(spec.offset, total);
      let data;
      if (rowBytes === Math.ceil(w * bpp)) data = toFloat(bytes, type, w * h, le);
      else {
        data = new Float32Array(w * h);
        for (let y = 0; y < h; y++) data.set(toFloat(bytes.subarray(y * rowBytes, y * rowBytes + Math.ceil(w * bpp)), type, w, le), y * w);
      }
      return shrink(data, w, h, maxDim);
    }
    const step = Math.max(1, Math.ceil(h / maxDim));
    const rows = Math.floor(h / step);
    const ow = Math.min(w, Math.ceil(w / Math.ceil(w / maxDim)));
    const data = new Float32Array(w * rows);
    await parallel(rows, 8, async (r) => {
      const y = r * step + (step >> 1);
      const bytes = await src.read(spec.offset + y * rowBytes, Math.ceil(w * bpp), { cache: false });
      data.set(toFloat(bytes, type, w, le), r * w);
    });
    return shrinkX(data, w, rows, ow);
  }

  /** Run fn(0..n-1) with at most `limit` calls in flight (many small reads). */
  async function parallel(n, limit, fn) {
    let next = 0;
    const worker = async () => { while (next < n) { const i = next++; await fn(i); } };
    await Promise.all(Array.from({ length: Math.min(limit, n) }, worker));
  }

  /** Low/high display limits from percentiles of a sample of the data. */
  function limits(data, lo, hi) {
    const n = data.length;
    const step = Math.max(1, Math.floor(n / 200000));
    const s = [];
    for (let i = 0; i < n; i += step) { const v = data[i]; if (v === v && isFinite(v)) s.push(v); }
    if (!s.length) return [0, 1];
    s.sort((a, b) => a - b);
    const a = s[Math.floor((s.length - 1) * (lo === undefined ? 0.005 : lo))];
    let b = s[Math.floor((s.length - 1) * (hi === undefined ? 0.995 : hi))];
    if (b <= a) b = a + 1;
    return [a, b];
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  /** Grayscale canvas.  opts: {flipY, lo, hi, invert} */
  function grayCanvas(img, opts) {
    opts = opts || {};
    const [a, b] = limits(img.data, opts.lo, opts.hi);
    const c = makeCanvas(img.w, img.h);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(img.w, img.h);
    const sc = 255 / (b - a);
    for (let y = 0; y < img.h; y++) {
      const sy = opts.flipY ? img.h - 1 - y : y;
      for (let x = 0; x < img.w; x++) {
        let v = (img.data[sy * img.w + x] - a) * sc;
        if (opts.invert) v = 255 - v;
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        const o = (y * img.w + x) * 4;
        id.data[o] = id.data[o + 1] = id.data[o + 2] = v;
        id.data[o + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  /** Additive colour composite of channels [{data, w, h, color:'#rrggbb'}] (same size). */
  function compositeCanvas(chs, opts) {
    opts = opts || {};
    const w = chs[0].w, h = chs[0].h;
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(w, h);
    const acc = new Float32Array(w * h * 3);
    for (const ch of chs) {
      const [a, b] = limits(ch.data, 0.002, 0.998);
      const rgb = (ch.color || '#ffffff').match(/\w\w/g).map((x) => parseInt(x, 16) / 255);
      const sc = 1 / (b - a);
      for (let i = 0; i < w * h; i++) {
        let v = (ch.data[i] - a) * sc;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        acc[i * 3] += v * rgb[0]; acc[i * 3 + 1] += v * rgb[1]; acc[i * 3 + 2] += v * rgb[2];
      }
    }
    for (let y = 0; y < h; y++) {
      const sy = opts.flipY ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const i = sy * w + x, o = (y * w + x) * 4;
        id.data[o] = Math.min(255, acc[i * 3] * 255);
        id.data[o + 1] = Math.min(255, acc[i * 3 + 1] * 255);
        id.data[o + 2] = Math.min(255, acc[i * 3 + 2] * 255);
        id.data[o + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  /** Canvas from an encoded image (JPEG/PNG/BMP bytes) using the browser decoder. */
  function encodedCanvas(bytes, mime) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'image/jpeg' }));
      const im = new Image();
      im.onload = () => {
        const c = makeCanvas(im.naturalWidth, im.naturalHeight);
        c.getContext('2d').drawImage(im, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      im.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      im.src = url;
    });
  }

  /** Canvas from interleaved 8-bit RGB(A) pixels. */
  function rgbCanvas(bytes, w, h, channels, opts) {
    opts = opts || {};
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const id = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const sy = opts.flipY ? h - 1 - y : y;
      for (let x = 0; x < w; x++) {
        const i = (sy * w + x) * channels, o = (y * w + x) * 4;
        if (opts.bgra) { id.data[o] = bytes[i + 2]; id.data[o + 1] = bytes[i + 1]; id.data[o + 2] = bytes[i]; }
        else { id.data[o] = bytes[i]; id.data[o + 1] = bytes[i + 1]; id.data[o + 2] = bytes[i + 2]; }
        id.data[o + 3] = 255;
      }
    }
    ctx.putImageData(id, 0, 0);
    return c;
  }

  // ------------------------------------------------------------- decoders
  async function inflate(bytes, format) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress (no DecompressionStream)');
    const ds = new DecompressionStream(format || 'deflate');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function lzw(input, expected) {
    const out = new Uint8Array(expected || input.length * 4);
    let op = 0, bitPos = 0, codeLen = 9, next = 258;
    const prefix = new Int32Array(4096), suffix = new Uint8Array(4096), first = new Uint8Array(4096), len = new Uint16Array(4096);
    for (let i = 0; i < 256; i++) { prefix[i] = -1; suffix[i] = i; first[i] = i; len[i] = 1; }
    let old = -1;
    const totalBits = input.length * 8;
    const write = (code) => {
      const l = len[code];
      if (op + l > out.length) return false;
      let c = code;
      for (let k = l - 1; k >= 0; k--) { out[op + k] = suffix[c]; c = prefix[c]; }
      op += l;
      return true;
    };
    while (bitPos + codeLen <= totalBits) {
      let code = 0;
      for (let k = 0; k < codeLen; k++) {
        const bit = (input[(bitPos + k) >> 3] >> (7 - ((bitPos + k) & 7))) & 1;
        code = (code << 1) | bit;
      }
      bitPos += codeLen;
      if (code === 257) break;
      if (code === 256) { codeLen = 9; next = 258; old = -1; continue; }
      if (old === -1) { if (!write(code)) break; old = code; continue; }
      if (code < next) {
        if (!write(code)) break;
        if (next < 4096) { prefix[next] = old; suffix[next] = first[code]; first[next] = first[old]; len[next] = len[old] + 1; next++; }
      } else {
        if (next < 4096) { prefix[next] = old; suffix[next] = first[old]; first[next] = first[old]; len[next] = len[old] + 1; next++; }
        if (!write(code)) break;
      }
      old = code;
      if (next + 1 >= (1 << codeLen) && codeLen < 12) codeLen++;
    }
    return out.subarray(0, op);
  }

  function packbits(input, expected) {
    const out = new Uint8Array(expected);
    let ip = 0, op = 0;
    while (ip < input.length && op < expected) {
      const n = (input[ip++] << 24) >> 24;
      if (n >= 0) { for (let k = 0; k <= n && op < expected; k++) out[op++] = input[ip++]; }
      else if (n !== -128) { const v = input[ip++]; for (let k = 0; k < 1 - n && op < expected; k++) out[op++] = v; }
    }
    return out;
  }

  async function decompress(bytes, compression, expected) {
    if (compression === 1) return bytes;
    if (compression === 5) return lzw(bytes, expected);
    if (compression === 8 || compression === 32946) return inflate(bytes, 'deflate');
    if (compression === 32773) return packbits(bytes, expected);
    throw new Error('Unsupported compression ' + compression);
  }

  /** Undo TIFF horizontal differencing (predictor 2) in place. */
  function unpredict(bytes, w, h, spp, bps, le) {
    if (bps === 8) {
      for (let y = 0; y < h; y++) for (let x = spp; x < w * spp; x++) bytes[y * w * spp + x] = (bytes[y * w * spp + x] + bytes[y * w * spp + x - spp]) & 255;
    } else if (bps === 16) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let y = 0; y < h; y++) for (let x = spp; x < w * spp; x++) {
        const p = (y * w * spp + x) * 2;
        dv.setUint16(p, (dv.getUint16(p, le) + dv.getUint16(p - spp * 2, le)) & 0xffff, le);
      }
    }
  }

  /**
   * First plane of a TIFF IFD as a small canvas (strips or tiles; none/LZW/Deflate/PackBits).
   * Big uncompressed strips are row-sampled; compressed data over ~48 MB is skipped.
   */
  async function tiffPlane(tiff, ifd, opts) {
    opts = opts || {};
    const L = await M.TIFF.layout(tiff, ifd);
    const { width: w, height: h } = L;
    if (!w || !h) return null;
    if (![1, 5, 8, 32946, 32773].includes(L.compression)) return null;
    const spp = L.planar === 2 ? 1 : L.samples;
    const bits = L.bits;
    let type;
    if (bits === 8) type = L.sampleFormat === 2 ? 'i8' : 'u8';
    else if (bits === 16) type = L.sampleFormat === 2 ? 'i16' : L.sampleFormat === 3 ? 'f16' : 'u16';
    else if (bits === 32) type = L.sampleFormat === 3 ? 'f32' : L.sampleFormat === 2 ? 'i32' : 'u32';
    else if (bits === 64 && L.sampleFormat === 3) type = 'f64';
    else return null;
    const bpp = bits / 8;
    const tiled = ifd.tags.has(322);
    const offs = await M.TIFF.value(tiff, ifd, tiled ? 324 : 273);
    const cnts = await M.TIFF.value(tiff, ifd, tiled ? 325 : 279);
    const offsets = [].concat(offs), counts = [].concat(cnts);
    const isRGB = spp >= 3 && bits === 8 && (L.photometric === 2 || opts.rgb);
    const maxDim = opts.maxDim || 512;

    // fast path: uncompressed, single contiguous strip layout -> row sampling
    if (!tiled && L.compression === 1 && spp === 1) {
      const rps = L.rowsPerStrip || h;
      const contiguous = offsets.every((o, i) => i === 0 || o === offsets[i - 1] + counts[i - 1]);
      if (contiguous) {
        const img = await readPlane(tiff.src, { offset: offsets[0], width: w, height: h, type, le: tiff.le }, maxDim);
        return grayCanvas(img, opts);
      }
      const step = Math.max(1, Math.ceil(h / maxDim));
      const rows = Math.floor(h / step);
      const data = new Float32Array(w * rows);
      await parallel(rows, 8, async (r) => {
        const y = r * step + (step >> 1);
        const s = Math.floor(y / rps), within = y - s * rps;
        const bytes = await tiff.src.read(offsets[s] + within * w * bpp, w * bpp, { cache: false });
        data.set(toFloat(bytes, type, w, tiff.le), r * w);
      });
      return grayCanvas(shrinkX(data, w, rows, Math.min(w, maxDim)), opts);
    }
    const total = counts.reduce((a, b) => a + b, 0);
    if (total > MAX_FULL_READ) return null;
    const full = new Uint8Array(w * h * spp * bpp);
    if (tiled) {
      const tw = L.tileWidth, tl = L.tileLength;
      const across = Math.ceil(w / tw);
      for (let t = 0; t < offsets.length && t < across * Math.ceil(h / tl); t++) {
        let tb = await tiff.src.read(offsets[t], counts[t]);
        tb = await decompress(tb, L.compression, tw * tl * spp * bpp);
        if (L.predictor === 2) unpredict(tb, tw, tl, spp, bits, tiff.le);
        const tx = (t % across) * tw, ty = Math.floor(t / across) * tl;
        for (let y = 0; y < tl && ty + y < h; y++) {
          const n = Math.min(tw, w - tx) * spp * bpp;
          full.set(tb.subarray(y * tw * spp * bpp, y * tw * spp * bpp + n), ((ty + y) * w + tx) * spp * bpp);
        }
      }
    } else {
      const rps = L.rowsPerStrip || h;
      let pos = 0;
      for (let s = 0; s < offsets.length; s++) {
        const rowsHere = Math.min(rps, h - s * rps);
        if (rowsHere <= 0) break;
        let sb = await tiff.src.read(offsets[s], counts[s]);
        sb = await decompress(sb, L.compression, rowsHere * w * spp * bpp);
        if (L.predictor === 2) unpredict(sb, w, rowsHere, spp, bits, tiff.le);
        full.set(sb.subarray(0, Math.min(sb.length, full.length - pos)), pos);
        pos += rowsHere * w * spp * bpp;
      }
    }
    if (isRGB) {
      const c = rgbCanvas(full, w, h, spp, opts);
      return scaleCanvas(c, maxDim);
    }
    let data = toFloat(full, type, w * h * spp, tiff.le);
    if (spp > 1) { const d = new Float32Array(w * h); for (let i = 0; i < w * h; i++) d[i] = data[i * spp]; data = d; }
    return grayCanvas(shrink(data, w, h, maxDim), opts);
  }

  function scaleCanvas(c, maxDim) {
    const f = Math.max(c.width, c.height) / maxDim;
    if (f <= 1) return c;
    const o = makeCanvas(Math.round(c.width / f), Math.round(c.height / f));
    const ctx = o.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }

  M.img = { TYPE_BYTES, toFloat, shrink, shrinkX, readPlane, parallel, limits, grayCanvas, compositeCanvas, encodedCanvas, rgbCanvas, scaleCanvas, tiffPlane, makeCanvas, half };
  M.inflate = inflate;
  M.decompress = decompress;
})();
