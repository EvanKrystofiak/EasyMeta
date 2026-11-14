/* EasyMeta - Thermo Fisher EPU / Tomo "MicroscopeImage" XML (one per acquired
 * image: Atlas, GridSquare, FoilHole, Data).  Attached to the image file with
 * the same name, or shown on its own.
 */
(function () {
  'use strict';
  const M = window.EasyMeta;
  const X = () => M.xml;

  function parseEPU(text) {
    const doc = X().parse(text);
    const root = doc.documentElement;
    const custom = {};
    const cd = X().kid(root, 'CustomData');
    for (const kv of X().kids(cd, 'KeyValueOfstringanyType')) {
      const k = X().text(X().kid(kv, 'Key')), v = X().kid(kv, 'Value');
      if (k && v && v.getAttribute('i:nil') !== 'true') custom[k] = v.textContent.trim();
    }
    const md = X().kid(root, 'microscopeData');
    const t = (...p) => { const n = X().path(md, ...p); return n ? X().text(n) : null; };
    const n = (...p) => M.num(t(...p));
    const camInput = {};
    for (const kv of X().all(X().path(md, 'acquisition', 'camera', 'CameraSpecificInput'), 'KeyValueOfstringanyType')) {
      const k = X().text(X().kid(kv, 'Key')), v = X().kid(kv, 'Value');
      if (k && v && v.getAttribute('i:nil') !== 'true') camInput[k] = v.textContent.trim();
    }
    const px = X().path(root, 'SpatialScale', 'pixelSize', 'x', 'numericValue');
    return {
      doc, custom, camInput,
      date: t('acquisition', 'acquisitionDateTime'),
      software: t('core', 'ApplicationSoftware'), version: t('core', 'ApplicationSoftwareVersion'),
      ht: n('gun', 'AccelerationVoltage'), source: t('gun', 'Sourcetype'),
      model: t('instrument', 'InstrumentModel'), id: t('instrument', 'InstrumentID'), computer: t('instrument', 'ComputerName'),
      camera: t('acquisition', 'camera', 'Name'), exposure: n('acquisition', 'camera', 'ExposureTime'),
      binning: n('acquisition', 'camera', 'Binning', 'x'),
      readout: [n('acquisition', 'camera', 'ReadoutArea', 'width'), n('acquisition', 'camera', 'ReadoutArea', 'height')],
      cameraLocation: t('acquisition', 'camera', 'CameraLocation'),
      columnMode: t('optics', 'ColumnOperatingMode'), subMode: t('optics', 'ColumnOperatingTemSubMode'),
      defocus: n('optics', 'Defocus'), eftem: t('optics', 'EFTEMOn'), intensity: n('optics', 'Intensity'),
      illumination: t('optics', 'IlluminationMode'), lensMode: t('optics', 'ObjectiveLensMode'),
      probe: t('optics', 'ProbeMode'), projector: t('optics', 'ProjectorMode'), spot: n('optics', 'SpotIndex'),
      mag: n('optics', 'TemMagnification', 'NominalMagnification'), beamDiameter: n('optics', 'BeamDiameter'),
      slitWidth: n('optics', 'EnergyFilter', 'EnergySelectionSlitWidth'), slitIn: t('optics', 'EnergyFilter', 'EnergySelectionSlitInserted'),
      stage: { a: n('stage', 'Position', 'A'), b: n('stage', 'Position', 'B'), x: n('stage', 'Position', 'X'), y: n('stage', 'Position', 'Y'), z: n('stage', 'Position', 'Z') },
      pixel: px ? M.num(X().text(px)) : null,
    };
  }

  function apply(ds, e, opts) {
    opts = opts || {};
    const em = M.ensureEM(ds);
    const inst = ds.instrument;
    if (e.model) {
      const m = e.model.match(/^([A-Za-z ]+?)[-\s]?(\d+)?$/);
      M.set(inst, 'manufacturer', 'Thermo Fisher Scientific');
      M.set(inst, 'model', m ? m[1] : e.model);
      M.set(inst, 'systemId', e.model);
    }
    if (e.id) M.set(inst, 'serial', e.id);
    if (e.software) { M.set(inst, 'software', e.software); M.set(inst, 'softwareVersion', e.version); }
    M.set(em, 'ht', e.ht);
    M.set(em, 'mag', e.mag);
    M.set(em, 'spot', e.spot);
    if (M.isNum(e.intensity)) M.set(em, 'intensity', e.intensity);
    if (M.isNum(e.beamDiameter) && e.beamDiameter > 0) M.set(em, 'illuminatedArea', e.beamDiameter);
    if (e.probe) M.set(em, 'probeMode', /nano/i.test(e.probe) ? 'Nanoprobe' : /micro/i.test(e.probe) ? 'Microprobe' : e.probe);
    if (e.illumination) M.set(em, 'illuminationMode', e.illumination);
    if (e.columnMode) M.set(em, 'mode', e.columnMode);
    if (e.projector) M.set(em, 'projection', e.projector);
    if (e.lensMode) M.set(em, 'lensMode', e.lensMode);
    const c = e.custom;
    const applied = M.num(c.AppliedDefocus);
    if (M.isNum(applied)) M.set(em, 'defocusTarget', applied);
    if (M.isNum(e.defocus)) M.set(em, 'defocusReadout', e.defocus);
    if (c['Aperture[C2].Name'] && c['Aperture[C2].Name'] !== 'None') M.set(em, 'c2Aperture', c['Aperture[C2].Name'] + (/^\d+$/.test(c['Aperture[C2].Name']) ? ' µm' : ''));
    if (c['Aperture[OBJ].Name']) M.set(em, 'objAperture', c['Aperture[OBJ].Name'] + (/^\d+$/.test(c['Aperture[OBJ].Name']) ? ' µm' : ''));
    if (c['Aperture[C1].Name'] && c['Aperture[C1].Name'] !== 'None') M.set(em, 'c1Aperture', c['Aperture[C1].Name']);
    if (/true/i.test(c.PhasePlateUsed || '')) em.phasePlate = true;
    const dose = M.num(c.Dose);
    if (M.isNum(dose) && dose > 0) M.set(em, 'dosePerImage', dose / 1e20);
    if (/true/i.test(e.eftem || '')) em.filter.eftem = true;
    if (M.isNum(e.slitWidth) && e.slitWidth > 0) em.filter.slitWidth = e.slitWidth;
    if (e.slitIn) em.filter.slitInserted = /true/i.test(e.slitIn);
    const cam = em.camera;
    M.set(cam, 'name', e.camera);
    const det = e.camera ? `Detectors[${e.camera}]` : null;
    M.set(cam, 'commercialName', c.DetectorCommercialName || (det && c[det + '.CommercialName']));
    if (det && c[det + '.CameraSerialNumber']) M.set(cam, 'serial', c[det + '.CameraSerialNumber']);
    if (det && c[det + '.ElectronCounted']) cam.counting = /true/i.test(c[det + '.ElectronCounted']);
    else if (e.camInput.ElectronCountingEnabled) cam.counting = /true/i.test(e.camInput.ElectronCountingEnabled);
    const sr = M.num(e.camInput.SuperResolutionFactor);
    if (sr && sr > 1) cam.superResolution = sr;
    if (det && M.num(c[det + '.DoseRate'])) M.set(em, 'doseRatePx', M.num(c[det + '.DoseRate']));
    if (det && M.num(c[det + '.FrameRate'])) cam.frameRate = M.num(c[det + '.FrameRate']);
    if (e.cameraLocation) cam.location = e.cameraLocation;
    M.set(em, 'exposure', e.exposure);
    M.set(em, 'binning', e.binning);
    if (e.readout[0]) cam.readout = [0, 0, e.readout[0], e.readout[1]];
    if (M.isNum(e.stage.a)) M.set(em.stage, 'alpha', e.stage.a * 180 / Math.PI);
    if (M.isNum(e.stage.b)) M.set(em.stage, 'beta', e.stage.b * 180 / Math.PI);
    M.set(em.stage, 'x', e.stage.x); M.set(em.stage, 'y', e.stage.y); M.set(em.stage, 'z', e.stage.z);
    if (e.pixel && opts.pixel !== false && (!ds.pixel.x || ds.pixel.suspect)) ds.pixel = { x: e.pixel, y: e.pixel, source: 'EPU XML' };
    if (e.date) ds.acquired = ds.acquired || M.parseDate(e.date);
    const nm = ds.file.name;
    if (/^Atlas/i.test(nm)) ds.epuRole = 'Atlas';
    else if (/^GridSquare/i.test(nm)) ds.epuRole = 'Grid square';
    else if (/^FoilHole.*_Data_/i.test(nm)) ds.epuRole = 'Data acquisition';
    else if (/^FoilHole/i.test(nm)) ds.epuRole = 'Foil hole';
  }

  const epuStem = (name) => M.stem(name).replace(/_(fractions|eer|gain)$/i, '').toLowerCase();

  M.registerCompanion({
    id: 'epu', name: 'EPU/Tomo XML',
    accepts(name, ext, head) {
      if (ext !== 'xml') return false;
      const s = M.decodeText(head.subarray(0, 600), 'utf-8');
      return /<MicroscopeImage[\s>]/.test(s) || /Fei\.SharedObjects/.test(s);
    },
    async parse(src) { return parseEPU(await src.text(0, src.size, 'utf-8')); },
    link(c, p) {
      if (epuStem(c.name) === epuStem(p.name)) return { score: 0.95, relation: 'image' };
      return null;
    },
    attach(ds, e) {
      apply(ds, e);
      ds.raw['EPU XML'] = e.doc.documentElement;
      ds.raw['EPU custom data'] = e.custom;
      M.addSource(ds, 'EPU XML');
    },
    standalone: {
      id: 'epu', name: 'EPU/Tomo XML', modality: 'EM', extensions: ['xml'],
      async parse(src, ctx) {
        const e = ctx.parsed || parseEPU(await src.text(0, src.size, 'utf-8'));
        const ds = M.newDataset(src, this);
        ds.modality = 'EM';
        ds.kind = 'image';
        ds.metadataOnly = true;
        ds.format.detail = 'metadata only (image not opened)';
        apply(ds, e);
        if (e.readout[0]) ds.dims = { x: Math.round(e.readout[0] / (e.binning || 1)), y: Math.round(e.readout[1] / (e.binning || 1)) };
        ds.raw['EPU XML'] = e.doc.documentElement;
        ds.raw['EPU custom data'] = e.custom;
        M.addSource(ds, 'EPU XML');
        M.note(ds, 'info', 'Open this XML together with its image (same name, .mrc/.tiff/.eer) to see both.');
        return ds;
      },
    },
  });
  M.epu = { parseEPU, apply };
})();
