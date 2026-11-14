# Supported formats

EasyMeta 0.1.1

EasyMeta recognises a file by its **content**, not by its extension. It reads
the first 8 KB, asks every format reader how well the bytes match, and uses
the best match. A matching extension only raises the score a little, so most
renamed files still open.

- [Light microscopy](#light-microscopy)
- [Electron microscopy](#electron-microscopy)
- [Companion files](#companion-files)
- [How companion files are paired](#how-companion-files-are-paired)
- [How EasyMeta decides what an MRC file is](#how-easymeta-decides-what-an-mrc-file-is)
- [Not supported yet](#not-supported-yet)

"Tested" below means the reader was run on real files of that kind.
"Untested" means it was written from the format description and has not yet
met a real file.

## Light microscopy

| Format | Extensions | Written by | Status | Preview |
|---|---|---|---|---|
| Zeiss CZI | `.czi` | ZEN blue and black | Tested: LSM 980 with Airyscan (raw and processed), LSM 980 confocal on an Axio Imager.Z2 with spectral and NIR detectors, LSM 710 | Thumbnail stored by ZEN |
| Zeiss LSM | `.lsm` | ZEN black, AIM | Tested | Thumbnail stored by ZEN, else the first plane |
| Nikon ND2 | `.nd2` | NIS-Elements (version 3 chunk format) | Tested: Ti spinning disk, TIRF | One frame, from the middle of a Z-stack |
| Leica LIF | `.lif` | LAS X, LAS AF | Tested: Stellaris 5 | Middle Z plane, channels combined |
| Olympus OIB | `.oib` | FluoView | Tested: FV1000 | Thumbnail stored by FluoView, else the middle Z plane |
| Olympus OIF | `.oif` | FluoView | Untested | None |
| Imaris IMS | `.ims` | Bitplane Imaris (HDF5) | Tested: Imaris 5 to 9.9 | Thumbnail stored by Imaris |
| OME-TIFF | `.ome.tif`, `.tif`, `.btf` | Bio-Formats and others | Untested on files from Bio-Formats | Page 1 |
| ImageJ TIFF | `.tif` | Fiji, ImageJ, Micro-Manager | Tested | Page 1 |

### What is read

**Zeiss CZI.** The file header, the metadata XML segment and the embedded
thumbnail. EasyMeta reads the objective, channels with dyes, laser lines and
power, detection windows, detectors, pinhole, scan settings and scaling.

- *LSM model.* The Axio Imager, Axio Observer or Examiner named in a CZI is
  the stand. EasyMeta names the LSM scan head from the hardware configuration
  and scaling stored in the file. It does not use the Microscope "System"
  field, which ZEN 3.x fills with "LSM 800" on LSM 980 systems too. A note on
  the Checks page shows when the two disagree.
- *Airyscan.* EasyMeta reports whether Airyscan was used, in which mode (SR,
  Multiplex, confocal with virtual pinhole), and whether the file holds the
  raw detector data or the image made by Airyscan processing in ZEN, with the
  processing strength.

**Zeiss LSM.** The `CZ_LSMINFO` TIFF tag with its scan information: tracks,
lasers and detectors.

**Nikon ND2.** The chunk map at the end of the file and the metadata chunks it
points to. EasyMeta warns when the experiment defines more frames than were
recorded, which happens when an acquisition is stopped early. Files acquired
with NIS "MultiExcitation" get a note: the filter and laser states stored per
channel can be those at the start of the run. Legacy JPEG2000 ND2 files are
recognised but cannot be read.

**Leica LIF.** The XML header, which lists every image in the project with its
dimensions, channels and hardware settings. EasyMeta offers an image picker.
It reads sequential settings, marks Lightning-deconvolved and otherwise
processed images, and handles TauGating and TauContrast lifetime channels.

**Olympus OIB and OIF.** Both carry the same FluoView settings. OIB packs them
into one container file; OIF is the settings file of a folder of TIFFs.

**Imaris IMS.** The attributes of the `DataSetInfo` groups and the 256 × 256
thumbnail. A file converted from another format usually keeps the source's own
metadata, and EasyMeta reads the instrument from there:

| Converted from | What survives |
|---|---|
| Zeiss CZI, Nikon ND2 | System, lasers and detectors |
| Olympus OIB, older Zeiss LSM | System and laser lines |
| Leica LIF | No system name; shown as "Leica" |

The header line shows the source format, for example "from Zeiss: CZI".

**OME-TIFF.** The OME-XML in the first page: pixels and physical sizes,
channels with fluorophore, colour, excitation and emission wavelengths, the
objective, light sources, detectors and filters. A file with several images
gets an image picker.

**ImageJ TIFF and plain TIFF.** The ImageJ description (channels, slices,
frames, spacing, unit) or the TIFF resolution tags. These files rarely say
what microscope made them, so EasyMeta guesses light or electron microscopy
from words in the ImageJ info block and the file name. Because that is only a
guess, the Overview page shows a switch for these files, and you can change
it.

## Electron microscopy

| Format | Extensions | Written by | Status | Preview |
|---|---|---|---|---|
| MRC | `.mrc`, `.mrcs`, `.st`, `.ali`, `.preali`, `.rec`, `.map`, `.ccp4`, `.sub` | Any; Thermo FEI1 / FEI2, SerialEM and Agard extended headers | Tested: Tomo5 Krios series, IMOD tomograms, SerialEM, EPU | One section: the tilt nearest 0°, or the central slice |
| EER | `.eer` | Thermo Falcon 4 / 4i | Tested (metadata) | None: frames hold single electron events |
| Gatan DM | `.dm3`, `.dm4` | DigitalMicrograph | Tested: K2, K3 gain reference, Orius | Embedded thumbnail, else the first image |
| AMT camera TIFF | `.tif` | AMT Image Capture | Tested | Page 1 |
| Zeiss SmartSEM TIFF | `.tif` | Zeiss SEM | Untested | Page 1 |
| Thermo SEM / FIB TIFF | `.tif` | Thermo Fisher / FEI SEM and FIB | Untested | Page 1 |
| Fibics Atlas TIFF | `.tif` | Fibics Atlas | Untested | Page 1 |

### What is read

**MRC.** The 1024-byte header and the extended header. Nothing else, except
one section for the preview.

- *Thermo FEI1 / FEI2 extended header* (EPU, Tomography): microscope type and
  D-number, software, voltage, dose, stage position and tilt, pixel size,
  defocus, magnification, spot size, illuminated area, energy filter, camera
  name, detector, counting mode and time stamp, for every section.
- *SerialEM extended header:* tilt angle, montage piece coordinates, stage
  position, magnification, intensity and dose per section.
- *Labels:* shown as the processing history.

EasyMeta also checks the file against its header:

| Finding | Reported as |
|---|---|
| The file is shorter than the header describes | Error: truncated, with the number of missing sections |
| The file is longer than the header describes | Warning |
| The pixel size is exactly 1.000 Å | Warning: it was probably never set |
| The thin dimension runs along Y | Information: IMOD output before rotation |
| The IMOD flag for CTF correction is set | Information |

**EER.** The acquisition metadata Thermo stores in the TIFF tags: the camera
and its serial number, exposure, frame count, dose rate, total dose, dose per
frame, sub-pixel and run-length settings, and the gain reference name.

**Gatan DM3 / DM4.** The tag tree. EasyMeta steps over the pixel arrays without
reading them, so only the tags are fetched, usually tens of KB.

**AMT camera TIFF.** AMT stores most values by position, not by name. EasyMeta
reads the date, magnification and voltage from fixed lines and shows those
line numbers on the Raw metadata page so you can check them.

**SEM and FIB TIFFs.** The vendor's metadata block: beam voltage and current,
working distance, detector, dwell time, pixel size and stage tilt. A Fibics
Atlas export re-saved by ImageJ loses its metadata tag; EasyMeta says so.

## Companion files

| File | Written by | Recognised by | Shown alone? |
|---|---|---|---|
| `.mdoc` | SerialEM, Thermo Tomography | Extension | Yes, as a metadata-only entry |
| EPU / Tomo `.xml` | Thermo Fisher EPU and Tomography | Extension and content | Yes, as a metadata-only entry |
| `.tlt`, `.rawtlt` | IMOD | Extension | No |
| `tilt.com` | IMOD / etomo | File name (`tilt.com`, `tilt_a.com` and similar) | No |

**`.mdoc`** adds, per tilt: angle, time, dose, prior dose, target defocus,
magnification, exposure, pixel size, spot size, frame count, frame dose, movie
file name and slit width. From the header and title lines it adds the
software, microscope name, date, voltage and tilt axis angle.

**EPU / Tomo `.xml`** adds the microscope state for one image: optics,
apertures including C2, detector, binning, exposure and dose.

**`.tlt` / `.rawtlt`** add tilt angles when the stack has none of its own.
Angles alone carry no acquisition order, so the Tilt series page then says the
order is unknown.

**`tilt.com`** adds the reconstruction program, thickness setting, binning and
method (weighted back-projection, SIRT-like filter or SIRT) to a tomogram.

## How companion files are paired

A companion is paired with an image only when both are open **and in the same
folder**. Names are compared without regard to case.

### `.mdoc`

| The `.mdoc` … | Paired as | Effect |
|---|---|---|
| is named `<image name>.mdoc`, e.g. `stack.mrc.mdoc` for `stack.mrc` | The stack's own metadata | Fills the tilt list and acquisition settings |
| names the image in its `ImageFile` line | The stack's own metadata | Same |
| has the same base name as the image, e.g. `stack.mdoc` for `stack.st` | The stack's own metadata | Same |
| lists the image as a `SubFramePath` | The series this movie belongs to | The movie is shown as "tilt *n* of *N*" and gets a Tilt series page |
| has a base name the image name starts with, followed by `_` or `.`, e.g. `stack.mrc.mdoc` for `stack_rec.mrc` | The source series | A tomogram keeps its own voxel size and gains the source tilt series and its binning |

### Others

| Companion | Paired when |
|---|---|
| `.tlt`, `.rawtlt` | It has the same base name as the image. The angles are used as the stack's own only if their number equals the number of sections. For an image whose name starts with that base name followed by `_`, such as a tomogram, they are shown as the source series. |
| `tilt.com` | Its `OutputFile` line names the image. Failing that, the image is an `.mrc` or `.rec` whose name contains `rec` or `tomo`. |
| EPU / Tomo `.xml` | It has the same base name as the image, ignoring a trailing `_fractions`, `_eer` or `_gain`. |

A companion can serve several images. One `.mdoc` typically describes its
stack and gives context to the tomogram made from it.

## How EasyMeta decides what an MRC file is

MRC is one container for many kinds of data. EasyMeta applies these rules in
order and stops at the first that fits:

1. More than one section, with tilt angles in the extended header that span
   more than 1° → **tilt series**.
2. SerialEM piece coordinates at more than one position → **montage**.
3. One section → **single image**, or **gain reference** if the name contains
   `gain`, `countref`, `superref` or `norm`.
4. Thermo's dose-fraction flag is set, or the name contains `fraction`,
   `frames`, `movie` or `_fr` → **movie**.
5. The extension is `.st`, `.ali` or `.preali` → **tilt series**.
6. The file says it is a reconstruction → **tomogram**. It says so by any of:
   - the extension `.rec`;
   - a label that mentions a reconstruction or tomogram-processing program
     (IMOD `tilt`, AreTomo, Warp, IsoNet, cryoCARE, `trimvol`, `clip rotx`);
   - `rec`, `recon`, `reconstruction`, `tomogram`, `sirt`, `wbp` or `vol` as a
     separate word of the name, as in `TS_01_rec.mrc` or `TS_01_Vol.mrc`;
   - a Warp-style pixel size in the name, as in `TS_01_10.00Apx.mrc`.

   A cube of 1024 voxels or less per side is called a **3D map** instead.
7. The name contains `ts`, `tilt` or `tiltseries` as a separate word →
   **tilt series**.
8. The name starts with `rec` or `tomo`, or contains `_rec` or `_tomo` →
   **tomogram** (or **3D map**, as in rule 6).
9. The extension is `.map`, or the space group is 1 and the volume is a cube →
   **3D map**.
10. The extension is `.mrcs`, or the images are square, at most 1024 pixels
    and there are more than 20 → **particle stack**.
11. The space group is 1 or 401 → **tomogram** if one dimension is much
    thinner than the others, otherwise **3D map**.
12. At most 200 sections of at least 2048 pixels → **movie**.
13. Anything else → **image stack**.

A paired `.mdoc` can then refine the result: it turns a stack with a tilt
range into a tilt series, a stack with piece coordinates into a montage, and a
file listed as a `SubFramePath` into a movie.

Rule 6 comes before rule 7 because a tomogram usually inherits `TS` or `tilt`
from the name of its tilt series. A stack with no angles, no telling
extension and only `ts` in its name, such as `TS_01.mrc`, is taken for a tilt
series.

## Not supported yet

Leica LOF / XLIF, Olympus OIR / VSI, Thermo Velox EMD, FEI TIA SER / EMI, and
legacy JPEG2000 ND2.

Each format is one file in `js/formats/`. The
[developer guide](DEVELOPER.md#adding-a-format) shows how to add one.
