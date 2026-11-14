# Troubleshooting

EasyMeta 0.1.1

- [Starting](#starting)
- [Opening files](#opening-files)
- [Companion files](#companion-files)
- [Values that look wrong or are missing](#values-that-look-wrong-or-are-missing)
- [Reports and exports](#reports-and-exports)
- [Known limitations](#known-limitations)
- [Reporting a problem](#reporting-a-problem)

## Starting

**Windows blocks `EasyMeta.exe`, or nothing happens when I double-click it.**
The launcher is not code-signed, so SmartScreen or your organisation's policy
may stop it. Double-click `EasyMeta.bat` instead, or open `EasyMeta.html` in
Edge, Chrome or Firefox. All three start the same program.

**"EasyMeta.html was not found next to EasyMeta.exe."**
The `.exe` was moved or copied out of the `EasyMeta` folder. Put it back and
make a shortcut to it instead.

**The page opens but is blank or unstyled.**
`EasyMeta.html` was separated from its folders. It needs `js`, `css`, `img`
and `config` beside it. Copy the whole folder again.

**Which browsers work?**
Current versions of Edge, Chrome, Firefox and Safari.

## Opening files

**I dropped a folder and nothing opened.**
Edge and Chrome do not let a page opened from disk read a dropped folder. The
status bar says so. Click **Open folder…** and choose the same folder, or drop
the files themselves.

**"None of these files is a format EasyMeta knows (yet)."**
EasyMeta did not recognise any of the files. Check
[Supported formats](FORMATS.md). Formats not supported yet include Leica LOF
and XLIF, Olympus OIR and VSI, Thermo Velox EMD and FEI TIA SER / EMI.

**The status bar says "… other files skipped".**
That is normal for a folder. EasyMeta lists only the files it can read and
counts the rest.

**"This file could not be read."**
EasyMeta recognised the format but failed while reading the file. The card
shows the reason; *Technical details* shows where it failed. Common causes:

- The file is incomplete: a copy or an acquisition that did not finish.
- It is a variant EasyMeta does not handle, such as a legacy JPEG2000 ND2.

If the file opens in its own software, see
[Reporting a problem](#reporting-a-problem).

**There is no preview.**
The Preview card says why:

| Message | Reason |
|---|---|
| *No cheap preview for this file.* | A preview would mean reading much of the file, so EasyMeta does not make one. |
| *EER frames hold individual electron events…* | EER movies are not decoded. |
| *Metadata file — no image data.* | You opened an `.mdoc` or EPU `.xml` on its own. |
| *No preview:* followed by an error | The plane could not be decoded. The metadata is unaffected. |

**A huge folder takes a while.**
EasyMeta reads the first 8 KB of every file to recognise it. On a network
drive with thousands of files this takes time; the status bar counts
progress. Opening a sub-folder is quicker.

## Companion files

**The `.mdoc` was not paired with my stack.**
A paired file shows a tag such as `MRC + mdoc` in the Files list. If the tag
is missing, check that:

1. The `.mdoc` was opened **together** with the stack. Opening the folder is
   the simplest way.
2. Both are in the **same folder**.
3. The names correspond: `stack.mrc.mdoc` for `stack.mrc`, or the same base
   name, or the stack's name on the `ImageFile` line of the `.mdoc`.

[Supported formats](FORMATS.md#how-companion-files-are-paired) has the full
rules.

**The `.mdoc` appears as its own entry in the Files list.**
EasyMeta did not find its stack among the open files, so it shows the `.mdoc`
on its own. Open the stack as well and the two are joined.

**The Tilt series page says "Order from: file order (assumed)".**
The stack has no time stamps, so EasyMeta assumed it is stored in acquisition
order. The scheme and the accumulated dose are then only as good as that
assumption. Open the `.mdoc` with the stack.

**My tomogram shows no binning and no source tilt series.**
Both come from the `.mdoc` of the tilt series. Open it together with the
tomogram, in the same folder. The tomogram's name must start with the
`.mdoc`'s base name, as in `Position_12.mrc.mdoc` and `Position_12_rec.mrc`.

**My tomogram shows no reconstruction method.**
That comes from IMOD's `tilt.com`. Open it together with the tomogram.

## Values that look wrong or are missing

**A value shows "—" or "Not recorded in this file."**
The file does not store it, or EasyMeta does not read it from this format yet.
Search the **Raw metadata** page: if the value is there under another name,
the file has it.

**The microscope is shown as a serial number or system ID.**
That is all the file contains. Your facility can map it to a name in
`config/instruments.js`. See
[Facility setup](FACILITY_SETUP.md#naming-your-instruments).

**The microscope name is the wrong instrument.**
A rule in `config/instruments.js` matches too broadly, or the example entries
that ship with EasyMeta are still in place. Edit the file.

**"The header pixel size is exactly 1.000 Å."**
The MRC header was never given a real pixel size. Take the pixel size from the
`.mdoc` or from your records. When an `.mdoc` is paired, EasyMeta uses its
pixel size instead.

**"Pixel size differs between sources."**
Two metadata sources disagree by more than 1 %. Binning or a re-calibration
usually explains it. Check which value your processing software uses.

**"File is truncated."**
The file is shorter than its header describes. The transfer or the
acquisition was probably cut short. Copy the file again and compare sizes.

**A plain TIFF is shown as the wrong kind of microscopy.**
ImageJ and plain TIFF files rarely say what made them, so EasyMeta guesses
from words in the file name and the ImageJ info block. Use the **Treat this
file as** switch on the Overview page to change it.

**A tomogram is shown as a tilt series, or the other way round.**
An MRC file with tilt angles in its header is always a tilt series. Without
them, EasyMeta goes by the extension, the labels in the header and the file
name. A tomogram is recognised by the extension `.rec`, by a label written by
a reconstruction program, or by a word such as `rec`, `tomogram` or `Vol` in
its name. A file named only `TS_01.mrc`, with no such sign, is taken for a
tilt series. Rename it, for example to `TS_01_rec.mrc`.
[Supported formats](FORMATS.md#how-easymeta-decides-what-an-mrc-file-is) lists
the rules.

**A Zeiss file says LSM 980 but ZEN says LSM 800, or the other way round.**
EasyMeta names the scan head from the hardware configuration in the file.
ZEN 3.x writes "LSM 800" in the Microscope "System" field on LSM 980 systems
too. A note on the Checks page shows when the two disagree.

**A dye is marked ‡ and has no spectrum.**
EasyMeta does not know the dye name stored in the file. It draws the
excitation and emission wavelengths the file stores. The checks that need a
known dye are skipped for that channel.

**A channel colour differs from my acquisition software.**
EasyMeta uses the colour stored in the file. A white or grey fluorescence
channel is drawn in its emission colour instead, so that the wavelength map
stays readable.

**The detector says "inferred from the sensor size".**
The file names only a generic camera. EasyMeta recognised a Gatan K2 or K3
from the image size. Treat it as a good guess.

**The camera is called EF-DE, but my software says EF-CCD.**
Thermo software names the camera position "EF-CCD" whatever camera is there.
EasyMeta shows "EF-DE" for a direct electron detector. The Raw metadata page
keeps the file's own name.

**A check flags something I did on purpose.**
Checks are rules of thumb. A 2 AU pinhole, an asymmetric tilt range on a
lamella or oversampling for deconvolution can all be right for your
experiment. The check tells you what the metadata says, not what you should
have done.

## Reports and exports

**How do I get a PDF?**
Choose **Report & export → Print / save as PDF**, then pick *Save as PDF* or
*Microsoft Print to PDF* as the printer.

**Nothing prints, or the dialog does not open.**
Use **Save report (.html)** instead, open the saved file in a browser and
print from there.

**"Could not copy to the clipboard."**
The browser refused clipboard access. Go to **Checks & methods**, click in the
methods box, select the text and copy it with `Ctrl+C`.

**Where did my export go?**
To the browser's download folder, normally `Downloads`.

**Excel shows odd characters in the CSV.**
The file is UTF-8 with a byte-order mark, which current Excel versions read
correctly on double-click. If yours does not, use *Data → From Text/CSV* and
choose UTF-8.

## Known limitations

- **Formats marked untested** in [Supported formats](FORMATS.md) were written
  from format descriptions and may misread real files: Olympus OIF, OME-TIFF
  from Bio-Formats, Zeiss SmartSEM, Thermo SEM / FIB and Fibics Atlas TIFF.
- **Legacy JPEG2000 ND2** files are recognised but cannot be read.
- **Dropped folders** cannot be read in Edge or Chrome when EasyMeta runs
  from disk. Use **Open folder…**.

## Reporting a problem

Open an issue at <https://github.com/EvanKrystofiak/EasyMeta/issues> with:

1. The EasyMeta version, shown at the right of the status bar.
2. Your browser and operating system.
3. The file format and the software that wrote the file, with its version.
4. What you expected and what EasyMeta showed. A screenshot helps.
5. For a file that could not be read: the text under *Technical details*.

A small example file makes a fix far more likely. Do not attach data you may
not share; a file from a test sample is just as useful.
