/* EasyMeta - Nikon ND2 (NIS-Elements, version 3 chunk format).
 *
 * The chunk map at the end of the file points to the metadata chunks
 * (ImageAttributesLV, ImageMetadataLV, ImageMetadataSeqLV|0, ImageTextInfoLV,
 * ImageCalibrationLV|0), stored in Nikon's binary "CLX lite variant" encoding.
 * The preview reads one frame chunk (ImageDataSeq|n).
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const CHUNK_MAGIC = 0x0abeceda;

  async function chunkMap(src) {
    const tail = await src.bin(src.size - 40, 40, true);
    const sig = M.decodeText(tail.u.subarray(0, 32), 'latin1');
    if (!/ND2 CHUNK MAP SIGNATURE/.test(sig)) throw new Error('ND2 chunk map not found (legacy JPEG2000 ND2 files are not supported yet)');
    const pos = tail.U64(32);
    const h = await src.bin(pos, 16, true);
    if (h.U32(0) !== CHUNK_MAGIC) throw new Error('Corrupt ND2 chunk map');
    const nameLen = h.U32(4), dataLen = h.U64(8);
    const data = await src.read(pos + 16 + nameLen, dataLen);
    const map = new Map();
    const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let p = 0;
    while (p < data.length) {
      let e = p;
      while (e < data.length && data[e] !== 0x21) e++; // '!'
      if (e >= data.length) break;
      const name = M.decodeText(data.subarray(p, e + 1), 'latin1');
      if (/SIGNATURE/.test(name)) break;
      if (e + 17 > data.length) break;
      map.set(name, { pos: Number(dv.getBigUint64(e + 1, true)), size: Number(dv.getBigUint64(e + 9, true)) });
      p = e + 17;
    }
    return map;
  }

  async function readChunk(src, map, name, maxSize) {
    const c = map.get(name);
    if (!c) return null;
    const h = await src.bin(c.pos, 16, true);
    if (h.U32(0) !== CHUNK_MAGIC) return null;
    const nameLen = h.U32(4), len = h.U64(8);
    if (maxSize && len > maxSize) return null;
    return { offset: c.pos + 16 + nameLen, length: len, data: maxSize === 0 ? null : await src.read(c.pos + 16 + nameLen, len) };
  }

  // -------------------------------------------------------- CLX lite variant
  async function liteVariant(bytes) {
    const out = {};
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 0;
    const add = (name, val) => {
      if (name in out) {
        if (!Array.isArray(out[name]) || !out[name].__list) { const l = [out[name]]; l.__list = true; out[name] = l; }
        out[name].push(val);
      } else out[name] = val;
    };
    while (p + 2 <= bytes.length) {
      const start = p;
      const type = bytes[p], nlen = bytes[p + 1];
      p += 2;
      if (type === 76) { // compressed remainder
        const rest = await M.inflate(bytes.subarray(p + 10), 'deflate');
        Object.assign(out, await liteVariant(rest));
        break;
      }
      if (type === 0 && nlen === 0) break;
      const name = M.decodeText(bytes.subarray(p, p + nlen * 2 - 2), 'utf-16le');
      p += nlen * 2;
      let val;
      switch (type) {
        case 1: val = bytes[p] !== 0; p += 1; break;
        case 2: val = dv.getInt32(p, true); p += 4; break;
        case 3: val = dv.getUint32(p, true); p += 4; break;
        case 4: val = Number(dv.getBigInt64(p, true)); p += 8; break;
        case 5: val = Number(dv.getBigUint64(p, true)); p += 8; break;
        case 6: val = dv.getFloat64(p, true); p += 8; break;
        case 7: val = Number(dv.getBigUint64(p, true)); p += 8; break;
        case 8: {
          let e = p;
          while (e + 1 < bytes.length && (bytes[e] | bytes[e + 1])) e += 2;
          val = M.decodeText(bytes.subarray(p, e), 'utf-16le');
          p = e + 2;
          break;
        }
        case 9: {
          const n = Number(dv.getBigUint64(p, true));
          p += 8;
          val = n > 256 ? `(${n} bytes)` : Array.from(bytes.subarray(p, p + n));
          p += n;
          break;
        }
        case 11: {
          const count = dv.getUint32(p, true);
          const length = Number(dv.getBigUint64(p + 4, true));
          p += 12;
          const inner = length - (p - start);
          val = await liteVariant(bytes.subarray(p, p + inner));
          p += inner + count * 8; // skip the offset table
          break;
        }
        default:
          return out; // unknown type: stop rather than misread
      }
      add(name, val);
    }
    return out;
  }

  /** Older NIS files store the same tree as "variant" XML. */
  function xmlVariant(text) {
    const doc = M.xml.parse(text);
    const conv = (el) => {
      const kids = Array.from(el.children);
      if (!kids.length) {
        const v = el.getAttribute('value');
        const t = el.getAttribute('runtype') || '';
        if (/double|float/i.test(t)) return M.num(v);
        if (/int|long/i.test(t)) return M.num(v);
        if (/bool/i.test(t)) return v === 'true' || v === '1';
        return v;
      }
      const o = {};
      for (const k of kids) o[k.tagName] = conv(k);
      return o;
    };
    return conv(doc.documentElement);
  }

  async function decodeChunk(src, map, names) {
    for (const n of names) {
      const c = await readChunk(src, map, n, 32 * 1024 * 1024);
      if (!c) continue;
      if (/LV/.test(n)) return liteVariant(c.data);
      return xmlVariant(M.decodeText(c.data, 'utf-8'));
    }
    return null;
  }

  /** Walk an object tree depth-first looking for a key. */
  function find(o, key, depth) {
    if (!o || typeof o !== 'object' || (depth || 0) > 12) return undefined;
    if (key in o) return o[key];
    for (const v of Object.values(o)) {
      if (v && typeof v === 'object') { const r = find(v, key, (depth || 0) + 1); if (r !== undefined) return r; }
    }
    return undefined;
  }
  const values = (o) => (o && typeof o === 'object' ? (Array.isArray(o) ? o : Object.values(o)) : []);
  /** Wavelengths of a spectrum object: peak (1 point) or band [lo, hi]. */
  function spectrum(s) {
    if (!s || typeof s !== 'object') return null;
    const pts = values(s.pPoint || s.pPoints || {}).map((p) => (p && M.num(p.dWavelength))).filter((w) => w > 200 && w < 2000);
    if (!pts.length) return null;
    if (pts.length === 1) return { peak: pts[0] };
    return { band: [Math.min(...pts), Math.max(...pts)] };
  }
  /** COLORREF (0x00BBGGRR) -> #rrggbb */
  const colorref = (v) => (M.isNum(v) ? M.hex([v & 255, (v >> 8) & 255, (v >> 16) & 255]) : null);

  // The human-readable description NIS writes.  Imaris conversions keep this text too.
  function applyInstrumentText(ds, lm, big) {
    const scope = (big.match(/Microscope:[ \t]*([^\s][^\r\n]*)/) || [])[1];
    const cam = (big.match(/Camera Name:[ \t]*([^\s][^\r\n]*)/) || [])[1];
    if (cam) lm.camera = cam.trim();
    // a confocal's scan head is listed as the camera, and the "microscope" is then its stand
    const head = /^Nikon\s+((?:A1|AX|C1|C2)\S*)/i.exec(lm.camera || '');
    if (head) {
      ds.instrument.model = head[1];
      if (scope) lm.stand = scope.trim();
    } else if (scope) ds.instrument.model = scope.trim();
  }
  /** Per-plane blocks of the description: {plane index: text}. */
  function planeTexts(big) {
    const out = {};
    for (const m of big.matchAll(/Plane #(\d+):([\s\S]*?)(?=Plane #\d+:|$)/g)) out[+m[1] - 1] = m[2];
    return out;
  }
  function applyPlaneText(ch, pt, lm) {
    const mod = (pt.match(/Modality:\s*([^\r\n]+)/) || [])[1];
    if (mod) ch.mode = mod.trim();
    const ex = (pt.match(/Exposure:\s*([\d.]+)\s*(ms|s|us|µs)/) || []);
    if (ex[1] && !ch.exposure) ch.exposure = +ex[1] * ({ ms: 1e-3, s: 1, us: 1e-6, 'µs': 1e-6 }[ex[2]] || 1e-3);
    // "Line:3; ExW:561; Power: 25.0; On" (AOTF / laser combiner lines switched on for this plane)
    const on = [...pt.matchAll(/ExW:\s*(\d{3})\s*;\s*Power:\s*([\d.]+)\s*;\s*On\b/gi)].map((m) => ({ wl: +m[1], p: +m[2] })).filter((l) => l.p > 0);
    if (on.length && !(ch.exLines || []).length) {
      ch.exLines = M.unique(on.map((l) => l.wl));
      ch.power = on.map((l) => `${l.wl} nm: ${M.fmt.auto(l.p)} %`).join(', ');
    }
    if (!(ch.exLines || []).length) {
      const lasers = [...pt.matchAll(/(?:Laser|Wavelength)[^\r\n]*?(\d{3})\s*nm/gi)].map((m) => +m[1]);
      if (lasers.length) ch.exLines = M.unique(lasers);
    }
    // emission filter written as centre/width, e.g. "FilterChanger(FilterWheel): 1 (455/50)"
    const fw = pt.match(/FilterChanger\([^)]*(?:Wheel|Em)[^)]*\):[^(\r\n]*\((\d{3})\/(\d{2,3})\)/i);
    if (fw && !ch.emBand) ch.emBand = [+fw[1] - +fw[2] / 2, +fw[1] + +fw[2] / 2];
    const cube = pt.match(/FilterChanger\(Turret[^)]*\):\s*\d+\s*\(([^)]+)\)/i);
    if (cube && !ch.filterSet) ch.filterSet = cube[1].trim();
    if (/CSU|spinning/i.test(pt)) lm.spinningDisk = (pt.match(/CSU[-\w]*/) || [lm.spinningDisk || 'spinning disk'])[0];
    const zc = pt.match(/\bZoom:\s*([\d.]+)x/i);
    if (zc) lm.zoomChanger = +zc[1];
    const gain = (pt.match(/Gain:\s*([\d.]+)/i) || [])[1];
    if (gain) ch.detector = { name: lm.camera || null, gain: +gain };
  }
  /** The acquisition mode of the whole image, once the channels are read. */
  function applyModeText(ds, lm, big) {
    const modes = lm.channels.map((c) => c.mode).filter(Boolean);
    if (modes.length) lm.mode = M.mostCommon(modes);
    if (lm.spinningDisk || /spinning disk/i.test(lm.mode || '')) lm.mode = 'Spinning-disk confocal';
    if (/MultiExcitation:\s*On/i.test(big) && lm.channels.length > 1) {
      M.note(ds, 'info', 'Acquired with NIS "MultiExcitation": the filter and laser states NIS stored per channel can be those at the start of the run, so check them against the channel names.');
    }
    if (lm.spinningDisk && /^CSU/i.test(lm.spinningDisk)) lm.spinningDisk = 'Yokogawa ' + lm.spinningDisk.trim();
    else if (/confocal/i.test(big)) lm.mode = /spinning/i.test(big) ? 'Spinning-disk confocal' : 'Confocal';
    else if (/widefield|wide-field/i.test(big)) lm.mode = 'Widefield';
  }
  M.nd2Text = { applyInstrumentText, planeTexts, applyPlaneText, applyModeText };

  async function parse(src, ctx) {
    const ds = M.newDataset(src, this);
    ds.modality = 'LM';
    const map = await chunkMap(src);
    const attrsRoot = await decodeChunk(src, map, ['ImageAttributesLV!', 'ImageAttributes!']);
    const attrs = (attrsRoot && (attrsRoot.SLxImageAttributes || attrsRoot)) || {};
    const expRoot = await decodeChunk(src, map, ['ImageMetadataLV!', 'ImageMetadata!']);
    const picRoot = await decodeChunk(src, map, ['ImageMetadataSeqLV|0!', 'ImageMetadataSeq|0!']);
    const pic = (picRoot && (picRoot.SLxPictureMetadata || picRoot)) || {};
    const textRoot = await decodeChunk(src, map, ['ImageTextInfoLV!', 'ImageTextInfo!']);
    const calRoot = await decodeChunk(src, map, ['ImageCalibrationLV|0!', 'ImageCalibration|0!']);
    const cal = (calRoot && (calRoot.SLxCalibration || calRoot)) || {};
    const ver = await readChunk(src, map, 'ND2 FILE SIGNATURE CHUNK NAME01!', 1024);
    ds.format.detail = 'ND2' + (ver && ver.data ? ' · ' + M.decodeText(ver.data, 'latin1').replace(/\0/g, '').trim() : '');

    const lm = M.ensureLM(ds);
    const w = attrs.uiWidth, h = attrs.uiHeight, comp = attrs.uiComp || 1, seq = attrs.uiSequenceCount || 1;
    ds.bits = attrs.uiBpcSignificant || attrs.uiBpcInMemory || null;
    ds.pixelType = `${attrs.uiBpcInMemory || '?'}-bit` + (attrs.uiBpcSignificant && attrs.uiBpcSignificant !== attrs.uiBpcInMemory ? ` (${attrs.uiBpcSignificant}-bit significant)` : '');

    // experiment loops -> Z / T / XY
    let z = 1, t = 1, xy = 1, zStep = null, tPeriod = null;
    const walk = (exp, depth) => {
      if (!exp || depth > 10) return;
      for (const e of [].concat(exp)) {
        if (!e || typeof e !== 'object') continue;
        const type = e.uiLoopType, pars = e.uLoopPars || {};
        const count = e.uiCount || pars.uiCount || 1;
        if (type === 1 || type === 8) { t *= count; tPeriod = tPeriod || (M.num(pars.dPeriod) ? pars.dPeriod / 1000 : null); }
        else if (type === 2) { const pts = values(pars.Points).length || count; xy *= pts; }
        else if (type === 4 || type === 6) { z *= count; zStep = zStep || M.num(pars.dZStep); }
        else if (type === 3 || type === 7) {
          // NE time loop / multi-phase
          let n = 0;
          for (const ph of values(pars.pPeriod)) { n += ph.uiCount || 0; tPeriod = tPeriod || (M.num(ph.dPeriod) ? ph.dPeriod / 1000 : null); }
          t *= n || count;
        }
        const next = e.ppNextLevelEx;
        if (next) for (const v of values(next)) walk(v, depth + 1);
      }
    };
    if (expRoot) walk(expRoot.SLxExperiment || expRoot, 0);
    if (z * t * xy !== seq && seq > 1) { // loops missing or partial acquisition
      if (z === 1 && xy === 1) t = seq;
      else if (t * z * xy > seq) M.note(ds, 'warn', `The experiment defines ${M.fmt.int(t * z * xy)} frames but only ${M.fmt.int(seq)} were recorded (acquisition stopped early?).`);
    }
    ds.dims = { x: w, y: h, z, c: comp, t, s: xy };
    if (zStep) ds.zStepSetting = zStep * 1e-6;
    if (tPeriod) ds.timeInterval = tPeriod;

    // calibration
    const um = M.num(pic.dCalibration) || M.num(cal.dCalibration);
    if (um && um > 0) ds.pixel = { x: um * 1e-6, y: um * 1e-6, z: zStep ? Math.abs(zStep) * 1e-6 : null, source: 'ND2 calibration' };

    // objective
    const o = lm.objective;
    o.name = pic.wsObjectiveName || cal.wsObjectiveName || find(pic, 'wsObjectiveName') || null;
    const mag = M.num(pic.dObjectiveMag) || M.num(cal.dObjectiveMag);
    o.mag = mag > 0 ? mag : null; // NIS writes -1 when unknown; analysis reads it from the name
    const na = M.num(pic.dObjectiveNA) || M.num(cal.dObjectiveNA);
    o.na = na > 0 ? na : null;
    o.refractiveIndex = M.num(pic.dRefractIndex1) || M.num(cal.dRefractIndex1);
    if (o.name) {
      const imm = o.name.match(/\b(Oil|Water|Sil|Glyc|WI|W|Air|Dry)\b/i);
      if (imm) o.immersion = { WI: 'Water', W: 'Water', Sil: 'Silicone', Glyc: 'Glycerol', Dry: 'Air' }[imm[1]] || M.cap(imm[1].toLowerCase());
      o.correction = (o.name.match(/(Plan Apo\s*λ?D?|Plan Apo VC|Plan Apo|Plan Fluor|S Plan Fluor|CFI\s+\w+|Apo TIRF|SR Apo TIRF)/i) || [])[0] || null;
    }
    if (!o.immersion && M.isNum(o.refractiveIndex)) o.immersion = o.refractiveIndex > 1.48 ? 'Oil' : o.refractiveIndex > 1.38 ? 'Silicone/Glycerol' : o.refractiveIndex > 1.3 ? 'Water' : 'Air';
    ds.instrument.manufacturer = 'Nikon';

    // text info (human readable description NIS writes)
    const ti = (textRoot && (textRoot.SLxImageTextInfo || textRoot)) || {};
    const texts = Object.entries(ti).filter(([, v]) => typeof v === 'string' && v.trim());
    const big = texts.map(([, v]) => v).join('\n');
    const desc = texts.find(([k]) => /TextInfoItem_5$/.test(k));
    if (desc) ds.description = desc[1];
    applyInstrumentText(ds, lm, big);
    if (!lm.camera) {
      const cs = find(pic, 'CameraUserName') || find(pic, 'CameraFamilyName');
      if (cs) lm.camera = cs;
    }
    const dateText = texts.find(([k]) => /TextInfoItem_9$/.test(k));
    if (dateText) ds.acquired = M.parseDate(dateText[1]) || dateText[1];
    const appText = texts.find(([k, v]) => /TextInfoItem_1[0-9]$/.test(k) && /NIS/i.test(v));
    ds.instrument.software = appText ? appText[1] : 'NIS-Elements';
    const planeText = planeTexts(big);

    // channels
    const planes = pic.sPicturePlanes || find(pic, 'sPicturePlanes') || {};
    const planeList = values(planes.sPlaneNew || planes.sPlane || {});
    const settings = values(planes.sSampleSetting || {});
    planeList.forEach((pl, i) => {
      if (!pl || typeof pl !== 'object') return;
      const ch = { name: pl.sDescription || `Channel ${i + 1}` };
      ch.color = colorref(pl.uiColor);
      const probe = pl.pFluorescentProbe || {};
      if (probe.m_sName) ch.dye = probe.m_sName;
      const pex = spectrum(probe.m_ExcitationSpectrum), pem = spectrum(probe.m_EmissionSpectrum);
      if (pex) ch.exPeak = pex.peak || (pex.band[0] + pex.band[1]) / 2;
      if (pem) ch.emPeak = pem.peak || (pem.band[0] + pem.band[1]) / 2;
      const filters = values((pl.pFilterPath || {}).m_pFilter || {});
      for (const f of filters) {
        const ex = spectrum(f.m_ExcitationSpectrum), em = spectrum(f.m_EmissionSpectrum);
        if (f.m_sName) ch.filterSet = ch.filterSet ? ch.filterSet + ' / ' + f.m_sName : f.m_sName;
        if (ex && ex.band && !ch.exBand) ch.exBand = ex.band;
        if (ex && ex.peak) ch.exLines = M.unique([...(ch.exLines || []), Math.round(ex.peak)]);
        if (em && em.band && !ch.emBand) ch.emBand = em.band;
        if (em && em.peak && !ch.emPeak) ch.emPeak = em.peak;
      }
      const ph = M.num(pl.dPinholeDiameter);
      if (ph) ch.pinholeUm = ph;
      const st = settings[i] || settings[0];
      if (st) {
        const exp = M.num(st.dExposureTime) || M.num(find(st, 'dExposureTime'));
        if (exp) ch.exposure = exp / 1000;
      }
      if (planeText[i]) applyPlaneText(ch, planeText[i], lm);
      if (!ch.detector && lm.camera) ch.detector = { name: lm.camera };
      lm.channels.push(ch);
    });
    if (!lm.channels.length && comp > 1) for (let i = 0; i < comp; i++) lm.channels.push({ name: `Component ${i + 1}` });
    applyModeText(ds, lm, big);
    lm.scan.zoom = M.num(pic.dZoom) || null;

    // stage
    if (M.isNum(pic.dXPos)) lm.stage = { x: pic.dXPos * 1e-6, y: pic.dYPos * 1e-6, z: M.isNum(pic.dZPos) ? pic.dZPos * 1e-6 : null };

    ds.kind = ds.dims.z > 1 && ds.dims.t > 1 ? 'hyperstack' : ds.dims.z > 1 ? 'zstack' : ds.dims.t > 1 ? 'timelapse' : 'image';
    ds.raw['Image attributes'] = attrs;
    if (expRoot) ds.raw['Experiment loops'] = expRoot;
    if (picRoot) ds.raw['Frame 1 metadata'] = picRoot;
    if (calRoot) ds.raw.Calibration = calRoot;
    if (texts.length) ds.raw['Text info'] = Object.fromEntries(texts);
    ds.raw['Chunks'] = Object.fromEntries(Array.from(map.entries()).slice(0, 400).map(([k, v]) => [k, `${M.fmt.bytes(v.size)} at ${v.pos}`]));
    M.addSource(ds, 'ND2 metadata chunks');

    ds.thumbnail = async () => {
      const zi = Math.floor(z / 2);
      const frame = z > 1 ? zi : 0;
      const ch = await readChunk(src, map, `ImageDataSeq|${frame}!`, 0);
      if (!ch) return null;
      const bpc = attrs.uiBpcInMemory || 16;
      const type = bpc <= 8 ? 'u8' : bpc <= 16 ? 'u16' : 'f32';
      const rowBytes = attrs.uiWidthBytes || w * comp * (bpc / 8);
      let raw;
      if (attrs.eCompression === 1 || attrs.eCompression === 'lossless') {
        const zb = await src.read(ch.offset + 8, ch.length - 8);
        raw = await M.inflate(zb, 'deflate');
      } else if (attrs.eCompression && attrs.eCompression !== 0 && attrs.eCompression !== 2) return null;
      else if (rowBytes * h > 64 * 1024 * 1024) return null;
      else raw = await src.read(ch.offset + 8, rowBytes * h);
      const all = new Float32Array(w * h * comp);
      for (let y = 0; y < h; y++) all.set(M.img.toFloat(raw.subarray(y * rowBytes, y * rowBytes + w * comp * (bpc / 8)), type, w * comp, true), y * w * comp);
      const chs = [];
      for (let c = 0; c < comp; c++) {
        const d = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) d[i] = all[i * comp + c];
        const s = M.img.shrink(d, w, h, 512);
        const lc = lm.channels[c] || {};
        chs.push({ data: s.data, w: s.w, h: s.h, color: lc.color || (comp === 1 ? '#ffffff' : ['#ff4040', '#40ff40', '#4080ff', '#ffffff'][c % 4]) });
      }
      const canvas = comp === 1 ? M.img.grayCanvas(chs[0]) : M.img.compositeCanvas(chs);
      return { canvas, note: z > 1 ? `frame ${frame + 1} (middle of Z)` : 'frame 1' };
    };
    return ds;
  }

  M.registerFormat({
    id: 'nd2', name: 'Nikon ND2', modality: 'LM', extensions: ['nd2'],
    sniff(h) {
      if (h.length < 8) return 0;
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      if (dv.getUint32(0, true) === CHUNK_MAGIC) return 1;
      if (dv.getUint32(0, false) === 0x0000000c && dv.getUint32(4, false) === 0x6a502020) return 0.9; // legacy JPEG2000 ND2
      return 0;
    },
    parse,
  });
  M.nd2 = { liteVariant };
})();
