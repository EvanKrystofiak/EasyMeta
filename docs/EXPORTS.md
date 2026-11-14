# Reports and exports

EasyMeta 0.1.1

The **Report & export** menu (top right) is active once a file is open. Every
item acts on the file and image currently shown. Files are saved by the
browser, normally to your Downloads folder.

| Menu item | File saved |
|---|---|
| Print / save as PDF | None; opens the print dialog |
| Save report (.html) | `<name>_report.html` |
| Export all metadata (.json) | `<name>_metadata.json` |
| Export summary (.csv) | `<name>_metadata.csv` |
| Copy methods paragraph | None; copies to the clipboard |

`<name>` is the file name without its extension. For a file with several
images, such as a Leica LIF project, `_series<N>` is added, so each image gets
its own file.

## Printed report and PDF

**Print / save as PDF** opens the browser's print dialog with a report laid out
for A4 paper. To get a PDF, choose *Save as PDF* (or *Microsoft Print to PDF*)
as the printer.

The report holds, in this order:

1. The title, the kind of data and the date the report was made.
2. **Summary:** file, format, size, microscope, software, date, dimensions,
   pixel size, field of view, and the main optical or beam settings, next to
   the preview.
3. **Methods (Machine Generated).**
4. **Channels** (light microscopy): dye, excitation, detection window,
   detector and exposure per channel.
5. **Graphics:** the wavelength map, the tilt angle, acquisition order and
   dose graphics, the volume or stack drawing and the beam footprint, as far
   as they apply.
6. **Tilts** (tilt series): order, angle, dose, prior dose and time per tilt.
7. **Checks:** all of them.
8. A footer with the EasyMeta version. When dye spectra are shown it also
   carries the FPbase citation and license.

The report uses a light theme, whatever the app looks like on screen.

## HTML report

**Save report (.html)** saves the same report as a single HTML file. The
graphics and the preview are embedded, so the file can be e-mailed, archived
next to the data or opened on any computer without EasyMeta.

## JSON export

**Export all metadata (.json)** saves everything EasyMeta parsed and derived
for the image. Use it in scripts and notebooks.

```json
{
  "generator": "EasyMeta 0.1.1",
  "generated": "2026-11-13T19:20:05.123Z",
  "dataset": { }
}
```

### Units

Values in `dataset` are stored in fixed units, whatever the page displays:

| Quantity | Unit |
|---|---|
| Lengths, pixel sizes, defocus, stage positions | metres |
| Angles | degrees |
| Voltages | volts |
| Doses | e⁻/Å² |
| Times, exposures | seconds |
| Wavelengths of light | nanometres |
| Dates | ISO 8601 text, in UTC |

So a pixel size of 2.68 Å is `2.68e-10`, and 300 kV is `300000`.

### Main keys of `dataset`

| Key | Contents |
|---|---|
| `file` | Name, path, size and modification date |
| `format` | Format id, name and detail |
| `modality` | `"LM"`, `"EM"` or `"unknown"` |
| `kind`, `kindLabel` | The kind of data, as a code and as text |
| `acquired` | Acquisition date |
| `instrument` | Manufacturer, model, name, serial, software, the display label |
| `dims` | Counts: `x`, `y`, `z`, `c`, `t`, and where present positions and tiles |
| `pixel` | `x`, `y`, `z` in metres, and the `source` of the calibration |
| `pixelType`, `bits` | Data type |
| `lm` | Light microscopy: `objective`, `channels`, `scan`, mode, pinhole, Airyscan details |
| `em` | Electron microscopy: voltage `ht`, `mag`, illumination, `camera`, `filter`, `stage`, dose, defocus |
| `tilt` | `tilts` (one record per tilt) and `info` (range, step, scheme, doses, gaps) |
| `volume` | Physical size and thickness of a tomogram or map |
| `movie`, `montage`, `parentTilt` | Frames, montage pieces, and the series a movie belongs to |
| `geometry` | Field of view, depth, Nyquist |
| `history` | Processing history lines |
| `checks` | Every check: `level`, `area`, `title`, `detail` |
| `methods` | The methods paragraph |
| `sources`, `companions` | The metadata sources and companion files used |
| `notes` | Notes raised by the format reader |
| `raw` | The raw metadata tree, as on the Raw metadata page |

Only the keys that apply to the file hold data; the others are `null`. XML
metadata inside `raw` is converted to nested objects, with attributes under
keys that start with `@`.

Not included: the preview image, and the complete metadata documents (CZI XML,
OME-XML and similar). Download those from the Raw metadata page.

### Example: read the tilt table in Python

```python
import json

with open("Position_12_metadata.json", encoding="utf-8") as f:
    ds = json.load(f)["dataset"]

print(ds["pixel"]["x"] * 1e10, "Å per pixel")
print(ds["tilt"]["info"]["scheme"]["label"])

for t in sorted(ds["tilt"]["tilts"], key=lambda t: t.get("order") or 0):
    print(t.get("order"), round(t["angle"], 2), t.get("dose"))
```

The JSON mirrors EasyMeta's internal dataset. Its structure can change
between versions; `generator` records the version that wrote the file.

## CSV export

**Export summary (.csv)** saves a table for a spreadsheet. It is UTF-8 with a
byte-order mark, so Excel opens it with the right characters.

The file has up to three blocks, separated by blank lines:

1. A three-column table, `Section, Field, Value`. `Summary` rows repeat the
   report summary, formatted as on screen with their units. For light
   microscopy, `Channel 1`, `Channel 2`, … rows give the name, dye, excitation
   and detection window in nm, detector, gain, exposure in seconds, pinhole in
   Airy units and colour of each channel.
2. For a file with tilt angles, a tilt table with its own header row: tilt
   order, section, angle, time, dose, prior dose, target defocus in µm,
   magnification, exposure and movie file. It holds plain numbers in the units
   named in its header.
3. One `Check` row per check, with its level and text, then one `Methods` row
   with the methods paragraph.

## Methods paragraph

**Copy methods paragraph** copies the draft paragraph to the clipboard. The
status bar confirms it. The same text, in an editable box, is on the Checks &
methods page.

The paragraph is machine generated from the metadata. Check it before use.
[Checks and calculations](CHECKS.md#the-methods-paragraph) describes what goes
into it.
