# Changelog

All notable changes to EasyMeta are listed here, newest first.

## Unreleased

### Fixed

- A tomogram whose name carries `TS` or `tilt` from its tilt series, such as
  `TS_01_rec.mrc`, `TS_01.rec`, `TS_01_10.00Apx.mrc` or `TS_01_Vol.mrc`, was
  shown as a tilt series. A reconstruction's extension, labels or name now
  outrank `ts` / `tilt` in the name.
- The light / electron switch on the Overview page was missing for an ImageJ
  TIFF once EasyMeta had guessed its kind, so a wrong guess could not be
  changed. The switch is now shown for every ImageJ and plain TIFF.
- A tilt series, movie, particle stack or montage showed a physical depth
  (number of sections × pixel size) next to its field of view.
- An OME-TIFF showed its acquisition mode as stored, for example
  "LaserScanningConfocalMicroscopy". It now reads "Confocal (laser scanning)",
  in the Mode tile and in the methods paragraph.

## 0.1.0 (2026-11-13)

First public release.

### Program

- Runs offline in a web browser, with nothing to install. Reads only the
  header and metadata blocks it needs.
- Opens files and folders by drag and drop, **Open files…** and
  **Open folder…**.
- Works out whether a file is light or electron microscopy and shows the
  pages that fit: Overview, Optics & channels, Stack, Beam & camera, Tilt
  series, Volume, Frames, Montage, Checks & methods and Raw metadata.
- Light microscopy formats: Zeiss CZI and LSM, Nikon ND2, Leica LIF, Olympus
  OIB and OIF, Imaris IMS, OME-TIFF, ImageJ TIFF.
- Electron microscopy formats: MRC with Thermo FEI1 / FEI2, SerialEM and
  Agard extended headers, EER, Gatan DM3 and DM4, AMT camera TIFF, Zeiss
  SmartSEM TIFF, Thermo SEM / FIB TIFF, Fibics Atlas TIFF.
- Companion files paired automatically: SerialEM / Tomography `.mdoc`, EPU /
  Tomo `.xml`, IMOD `.tlt`, `.rawtlt` and `tilt.com`.
- Wavelength map with measured FPbase spectra for 80 dyes and fluorescent
  proteins.
- Tilt scheme detection (dose-symmetric, bidirectional, unidirectional) with
  graphics for tilt angles, acquisition order and accumulated dose.
- Checks on sampling, spectra, tilt series, dose, detector and file integrity.
- Machine-generated methods paragraph.
- Printable report, standalone HTML report, JSON and CSV export.
- Facility instrument names in `config/instruments.js`.
- Windows launcher `EasyMeta.exe`.

### Documentation

- Added `docs/`: quick start, user guide, supported formats, checks and
  calculations, reports and exports, facility setup, troubleshooting and
  developer guide.
