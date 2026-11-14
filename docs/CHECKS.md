# Checks and calculations

EasyMeta 0.1.0

This document lists every value EasyMeta derives and every check it runs, with
the formula or threshold behind it. All of them use the metadata only. No
pixels are analysed.

The thresholds are rules of thumb for a first look at a dataset. They are
written in `js/analysis/analyze.js` and `js/analysis/checks.js`.

- [Check levels](#check-levels)
- [Checks for every file](#checks-for-every-file)
- [Light microscopy: resolution and Nyquist](#light-microscopy-resolution-and-nyquist)
- [Light microscopy: checks](#light-microscopy-checks)
- [Light microscopy: dyes, spectra and colours](#light-microscopy-dyes-spectra-and-colours)
- [Electron microscopy: derived values](#electron-microscopy-derived-values)
- [Electron microscopy: tilt series analysis](#electron-microscopy-tilt-series-analysis)
- [Electron microscopy: checks](#electron-microscopy-checks)
- [The methods paragraph](#the-methods-paragraph)

## Check levels

| Icon | Level | Meaning |
|---|---|---|
| ✖ | Error | Something is wrong with the file. |
| ! | Warning | Worth a look before you rely on the data. |
| i | Information | A fact worth knowing. Often fine. |
| ✓ | Passed | The rule was applied and met. |

Checks are sorted with the most serious first. The Overview page shows up to
five that are not "passed". The Checks & methods page shows all of them.

## Checks for every file

| Level | Check | Condition |
|---|---|---|
| Warning | No pixel size is stored in this file | The file has no calibration. Not raised for metadata-only entries. |
| varies | Notes from the format reader | Anything the reader found while parsing: a truncated file, a pixel size of exactly 1.000 Å, a processed image, a disagreement between two fields. These appear under the area **File**. |

## Light microscopy: resolution and Nyquist

For each channel EasyMeta estimates the optical resolution as a full width at
half maximum (FWHM):

| Quantity | Formula |
|---|---|
| Lateral resolution | 0.51 · λ / NA |
| Axial resolution | 0.88 · λ / (n − √(n² − NA²)) |
| Nyquist pixel, Nyquist Z step | resolution / 2.3 |

**Which wavelength λ.** For a confocal, the excitation wavelength: the shortest
laser line that excites the channel's dye. For widefield, the emission
wavelength: the centre of the detection window, or the dye's emission peak.

**Confocal or widefield.** A file counts as confocal when its mode says
confocal, laser scanning, Airyscan or LSM, or when the instrument model is a
known point scanner (Zeiss LSM, Leica SP or Stellaris, Olympus FV, Nikon A1,
AX or C2).

**Airyscan.** Both resolutions are divided by 1.7.

**Refractive index n.** The value stored in the file if there is one.
Otherwise it comes from the immersion:

| Immersion | n |
|---|---|
| Oil | 1.518 |
| Glycerol | 1.47 |
| Multi-immersion | 1.45 |
| Silicone | 1.406 |
| Water | 1.333 |
| Air / dry | 1.0 |

If the immersion is unknown, EasyMeta uses 1.518 when the NA is above 1 and
1.0 otherwise.

**Missing NA or magnification.** If the file gives only an objective name such
as `Plan-Apochromat 63x/1.40 Oil`, EasyMeta reads the magnification, NA and
immersion from the name.

**Sampled?** The Stack page marks a channel as sampled when the pixel (or Z
step) is at most 1.15 × its Nyquist value.

## Light microscopy: checks

### Sampling

The XY check uses two channels: the one with the smallest Nyquist pixel (the
*strictest*, usually the shortest wavelength) and the one with the largest
(the *most lenient*).

| Level | Message | Condition |
|---|---|---|
| Warning | Undersampled in XY | Pixel > 2 × Nyquist of the most lenient channel |
| Information | Pixel is above Nyquist | Pixel > 1.15 × Nyquist of the strictest channel |
| Information | Oversampled in XY | Pixel < 0.4 × Nyquist of the strictest channel |
| Passed | XY sampling matches the optics | Otherwise |
| Warning | Z-steps are too large for full 3D resolution | Z step > 2 × Nyquist of the most lenient channel |
| Information | Z-steps are somewhat larger than Nyquist | Z step > 1.15 × Nyquist of the strictest channel |
| Information | Z-steps much finer than needed | Z step < 0.35 × Nyquist of the strictest channel |
| Passed | Z-step matches the axial resolution | Otherwise |
| Information | Objective NA unknown, so sampling could not be checked | A pixel size is known but the NA is not |

### Optics

| Level | Message | Condition |
|---|---|---|
| Information | Pinhole: thicker optical sections | Confocal without Airyscan, pinhole > 1.3 AU |
| Information | Pinhole: small | Confocal without Airyscan, pinhole < 0.6 AU |
| Information | Objective immersion differs from the recorded medium | The two are both recorded and do not match |

### Spectra

| Level | Message | Condition |
|---|---|---|
| Warning | Emission peak outside the detection window | A known dye's emission peak lies more than 15 nm outside the channel's window. The dye label or the detector setting may be wrong. |
| Information | The detection window includes a laser line | A laser line used for the channel lies inside its window, for windows narrower than 200 nm |
| Information | Detection windows overlap | Two channels' windows overlap by more than 10 nm |
| Information | Bleed-through of dye A into channel B | From measured spectra: more than 15 % of A's emission falls in B's window **and** B's laser excites A at more than 10 % of its peak |
| Information | Emission peak inside another channel's window | Fallback for a dye without a bundled spectrum, for channels recorded in the same track |

The spectra checks compare each pair of channels, with three exceptions. Pairs
in different tracks are skipped, because they were recorded one after the
other. Pairs with the same dye are skipped, because that is one fluorophore
seen by two detectors. Lifetime channels derived from another channel's
photons are skipped.

## Light microscopy: dyes, spectra and colours

**Where the dye peaks come from**, in order of preference:

1. *FPbase.* If the dye has a measured spectrum bundled with EasyMeta, the
   peaks are read from that spectrum. The channel table marks them `(FPbase)`.
2. *Published peaks.* Otherwise, if the name matches EasyMeta's hand-written
   list in `js/analysis/dyes.js`, those peaks are used.
3. *The file.* Otherwise the excitation and emission wavelengths stored in the
   file are used and the dye is marked ‡.

Dye names are matched loosely. Case, spaces, hyphens and brackets are
ignored, `AF488` and `Alexa Fluor 488` are the same, and a known dye inside a
longer name is found, so `Phalloidin-Alexa488` matches Alexa Fluor 488.

**Which laser line excites a channel.** A track can have several laser lines
on at once. For a channel with a known dye EasyMeta keeps the lines below the
dye's emission peak and within 60 nm of its excitation peak. If none
qualifies it keeps the nearest one.

**Channel colours.** The display colour stored in the file is used. If the
file has none, or stores white or grey for a fluorescence channel, EasyMeta
uses the colour of the emission wavelength. Wavelengths of 650 nm and above
are drawn reddish purple so that far-red channels stay visible.

**Spectra.** 80 dyes and fluorescent proteins have measured spectra from
FPbase, resampled to 2 nm and normalised to their peak.
[`SPECTRA_CREDITS.md`](../SPECTRA_CREDITS.md) lists them.

## Electron microscopy: derived values

| Value | How it is derived |
|---|---|
| Electron wavelength | Relativistic: λ = 12.2643 / √(V · (1 + 0.978476 × 10⁻⁶ · V)) Å, with V in volts. 300 kV gives 1.969 pm. |
| Nyquist | 2 × pixel size |
| Dose per image | Taken from the file. If absent: dose rate (e⁻/px/s) × exposure / pixel area (Å²) |
| Dose rate per area | Dose per image / exposure |
| Dose rate per pixel | Taken from the file. If absent: dose per image × pixel area / exposure |
| Dose per frame | Dose per image / number of frames |
| Binning of a tomogram | Voxel size / pixel size of the source tilt series. Needs the `.mdoc` of the series. |
| Field of view | Pixel size × image size |
| Tomogram thickness | The Z dimension, or Y when Y is the thinnest dimension |

**Detector inferred from the sensor size.** When the file names only a generic
camera, EasyMeta compares the readout size with known sensors:

| Readout | Detector |
|---|---|
| 5760 × 4092 | Gatan K3, counting |
| 11520 × 8184 | Gatan K3, super-resolution |
| 3838 × 3710 | Gatan K2 Summit, counting |
| 7676 × 7420 | Gatan K2 Summit, super-resolution |

The page then says "inferred from the sensor size".

**EF-DE and BM-DE.** Thermo software calls the camera position "EF-CCD"
(behind the energy filter) or "BM-CCD" (bottom mount), whatever camera is
there. When the detector is a direct electron detector, EasyMeta shows
"EF-DE" or "BM-DE". The Raw metadata page keeps the file's own name.

## Electron microscopy: tilt series analysis

**Acquisition order.** EasyMeta uses the first source that is available:

1. *Time stamps*, when every tilt has one and they are mostly distinct.
2. *The order of the sections in the `.mdoc`.*
3. *The order in the file*, marked "(assumed)".

A `.tlt` or `.rawtlt` file gives angles only. With no other source the order
is reported as unknown.

**Increment.** The median difference between neighbouring angles.

**Missing tilts.** A gap larger than 1.6 × the increment counts as missing
tilts. The number missing is the gap divided by the increment, minus one.

**Irregular increments.** Reported when more than 15 % of the increments
differ from the median by more than 0.35° or 25 % of the increment, whichever
is larger.

**Scheme.** Detected from the angles in acquisition order:

| Scheme | Rule |
|---|---|
| Unidirectional | Every step goes the same way. |
| Bidirectional | The series runs one way, jumps back to within about 1.6 increments of the start, then runs the other way. |
| Dose-symmetric | The distance from the start angle never shrinks, and the two sides alternate in at least three runs. The group size is the most common run length. |
| Custom | None of the above. |

A series with fewer than three tilts has no scheme.

**Dose.** The dose on camera is the sum of the per-tilt doses. The dose per
tilt is their median. The accumulated dose before each tilt is the
`PriorRecordDose` from the `.mdoc` when present, otherwise the running sum in
acquisition order.

## Electron microscopy: checks

### Calibration

| Level | Message | Condition |
|---|---|---|
| Warning | Pixel size differs between sources | Two sources disagree by more than 1 % |

### Tilt series

| Level | Message | Condition |
|---|---|---|
| Warning | The stack has *N* images but *M* tilt angles were found | The counts differ |
| Warning | Tilts missing from the regular steps | At least one gap, listed with its angles |
| Passed | No missing tilts | No gap |
| Information | Tilt increments are irregular | See above. Expected for some schemes. |
| Information | Tilt range | The total range is under 100°. A smaller range means a larger missing wedge. |
| Information | Tilt range is asymmetric around 0° | The centre of the range is more than 4° from 0°. Typical for pre-tilted FIB lamellae. |
| Information | Acquisition order is assumed from the file order | No time stamps and no `.mdoc` |
| Information | Acquisition order unknown (angles only) | Angles from a `.tlt` file only |
| Warning | Magnification changes within the series | More than one magnification among the tilts |

### Dose

| Level | Message | Condition |
|---|---|---|
| Warning | High Dose on Camera | Total above 250 e⁻/Å² |
| Information | Dose on Camera, with the median per tilt | Any other total. Typical cryo-ET totals are about 60–180 e⁻/Å². |

### Detector

| Level | Message | Condition |
|---|---|---|
| Warning | Dose rate is high for electron counting | Counting detector, above 15 e⁻/px/s on a Falcon or EER detector, above 25 e⁻/px/s on others |
| Passed | Dose rate is fine for counting | At or below that limit |

### Tomogram

| Level | Message | Condition |
|---|---|---|
| Information | Volume is unusually thick | Thickness above 600 nm |
| Passed | Reconstructed at bin *N* relative to the tilt series | The binning could be derived |

### Optics

| Level | Message | Condition |
|---|---|---|
| Information | Large target defocus | Above 8 µm in size, at 5,000× or more and not in LM lens mode |
| Information | A phase plate was used | The file says so |

## The methods paragraph

EasyMeta drafts a methods paragraph from the values in the file. It is
labelled *(Machine Generated)*. A sentence or clause is left out when the file
does not record its value.

**Light microscopy** covers, in this order: the microscope, stand, Airyscan or
mode, and software; the objective with NA and immersion; each channel's dye,
excitation and detection window; Airyscan processing; the pinhole; image size,
pixel size and field of view; the Z-stack; the time series.

**Electron microscopy** depends on the kind of data:

| Data | The paragraph covers |
|---|---|
| Tilt series | Microscope, voltage, software, detector and mode, energy filter; magnification, pixel size, probe mode, spot size, illuminated area, C2 aperture; scheme, number of tilts, range, increment, total dose, target defocus |
| Tomogram or map | Voxels, voxel size, binning, physical size; reconstruction program and method; the source tilt series |
| Single image or movie | Microscope, voltage, software, detector, filter, magnification; dose, frames, exposure, defocus |
| SEM / FIB image | Microscope, voltage, software, detector, working distance, pixel size, beam current |

If your facility has named its instruments in `config/instruments.js`, the
paragraph uses that name. See [Facility setup](FACILITY_SETUP.md).

Always read the paragraph against your own records. It cannot know the sample
preparation, the grid, or anything done after acquisition.
