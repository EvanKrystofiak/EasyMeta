# Developer guide

EasyMeta 0.1.1

- [Design in one page](#design-in-one-page)
- [Repository layout](#repository-layout)
- [How a file becomes pages](#how-a-file-becomes-pages)
- [The dataset](#the-dataset)
- [Reading bytes](#reading-bytes)
- [Adding a format](#adding-a-format)
- [Adding a TIFF flavour](#adding-a-tiff-flavour)
- [Adding a companion file type](#adding-a-companion-file-type)
- [Adding a check](#adding-a-check)
- [Pages and graphics](#pages-and-graphics)
- [Testing with real files](#testing-with-real-files)
- [Building the launcher and the icon](#building-the-launcher-and-the-icon)
- [Refreshing the dye spectra](#refreshing-the-dye-spectra)
- [Releasing a version](#releasing-a-version)

## Design in one page

- **No build step, no dependencies.** EasyMeta is plain JavaScript loaded with
  `<script>` tags. There are no ES modules, because a page opened from
  `file://` cannot import them. Every script attaches itself to one global,
  `window.EasyMeta`, written `M` inside the code.
- **Read as little as possible.** A parser asks for byte ranges and gets only
  those. A multi-GB file is never loaded.
- **One normalised dataset.** Every format reader fills the same structure.
  Pages, checks, the methods text and the exports read only that structure, so
  a new format gets all of them for free.
- **Offline.** Nothing is fetched from the internet. Keep it that way: no CDN
  links, no web fonts, no analytics.

## Repository layout

```
EasyMeta.html          the app; the <script> order here is the load order
css/easymeta.css       styles (dark theme)
config/instruments.js  facility instrument names
js/core/               util, file access, TIFF, OLE2, HDF5, XML/INI text, previews, registry
js/formats/            one file per format or group of formats
js/analysis/           derived values, checks, methods text, dyes, spectra lookup
js/data/               spectra_fpbase.js (FPbase spectra, CC BY-SA 4.0)
js/views/              pages, SVG graphics, raw metadata tree, report and export
js/app.js              controller: open, drop, navigation, status bar
launcher/              EasyMeta.cs + build_launcher.bat -> EasyMeta.exe
tools/                 dev server, icon packer, spectra download and build
docs/                  this documentation
```

Scripts load in this order: core, `config/instruments.js`, EM formats, LM
formats, spectra data, analysis, views, `app.js`. A script may use anything
loaded before it.

## How a file becomes pages

```
drop / open
   │
   ▼
Session.add()            js/core/registry.js
   │  reads the first 8 KB of each file
   │  companion? -> parse it now          registerCompanion().accepts / parse
   │  else detectFormat() -> best sniff() score
   │  then links companions to primaries  registerCompanion().link
   ▼
Session.load(entry)
   │  format.parse(src, ctx)  -> dataset
   │  companion.attach(dataset, parsed, link)
   │  M.analyze(dataset)                  js/analysis/analyze.js
   │     derived values, tilt scheme, M.runChecks, M.methodsText
   ▼
M.pages.list(dataset)    js/views/pages.js  -> the page buttons
page.render(dataset)     -> DOM
```

A parsed dataset is cached per file and per image index, so switching between
files does not parse again.

## The dataset

`M.newDataset(src, format)` in `js/core/registry.js` creates it. The comments
there are the reference; this is a summary.

| Field | Contents |
|---|---|
| `file` | `name`, `path`, `size`, `modified` |
| `format` | `id`, `name`, `detail` |
| `modality` | `'LM'`, `'EM'` or `'unknown'` |
| `kind` | `image`, `zstack`, `timelapse`, `hyperstack`, `tiltseries`, `tomogram`, `map`, `movie`, `particles`, `montage`, `gain`, `imagestack` |
| `title`, `acquired` | Display title; a `Date` or a string |
| `instrument` | `manufacturer`, `model`, `name`, `serial`, `systemId`, `software`, `softwareVersion` |
| `dims` | Counts: `x y z c t s m` |
| `pixel` | `x y z` in metres, plus `source` |
| `pixelType`, `bits` | Data type |
| `lm` | From `M.ensureLM(ds)`: `objective`, `channels[]`, `scan`, `stage` |
| `em` | From `M.ensureEM(ds)`: `camera`, `stage`, `filter`, and beam settings |
| `tilt` | `{ tilts: [...], source }`; `context: true` when the tilts describe a source series |
| `volume`, `movie`, `montage`, `parentTilt` | Kind-specific details |
| `history` | Processing steps: `{ program, text, date }` |
| `series`, `seriesIndex` | The images in a multi-image file, and the current one |
| `raw` | Nested raw metadata for the Raw metadata page |
| `rawText` | Whole metadata documents by file name; offered as downloads |
| `notes` | `{ level, text }`, added with `M.note()`; they become checks |
| `sources`, `companions` | What the metadata was read from |
| `thumbnail` | `async () => ({ canvas, note })`, or `null` |

**Units are fixed.** Lengths in metres, angles in degrees, voltages in volts,
doses in e⁻/Å², times in seconds, wavelengths of light in nanometres. Convert
when you parse; the views format for display with `M.fmt`.

Helpers you will use in every parser:

| Helper | Use |
|---|---|
| `M.set(obj, key, value)` | Sets a value only if it is meaningful and the key is still empty. The first good value wins; pass `true` as a fourth argument to overwrite. |
| `M.note(ds, level, text)` | Adds a note with level `'info'`, `'warn'` or `'error'`. It appears on the Checks page under *File*. |
| `M.addSource(ds, name)` | Records a metadata source for the *Read from* line. |
| `M.ensureLM(ds)`, `M.ensureEM(ds)` | Create and return the `lm` or `em` block. |
| `M.num`, `M.first`, `M.isNum` | Safe number parsing and selection. |
| `M.toMeters(value, unit)` | Length conversion from a unit name. |
| `M.parseDate`, `M.oleDate` | Date parsing. |
| `M.xml`, `M.parseIni`, `M.parseKeyValues` | Text formats, in `js/core/text.js`. |

## Reading bytes

A parser receives a `FileSource` (`js/core/source.js`). It wraps a browser
`File`, or an HTTP URL that supports Range requests.

| Call | Returns |
|---|---|
| `await src.read(offset, length)` | `Uint8Array`, clipped to the file |
| `await src.view(offset, length)` | `DataView` |
| `await src.bin(offset, length, littleEndian)` | A `Bin` cursor; little-endian unless you pass `false` |
| `await src.text(offset, length, encoding)` | Decoded text |

Reads go through a block cache: 64 KB blocks, at most 16 MB per file. A read
larger than 2 MB bypasses the cache. For many small scattered reads, pass
`{ cache: false }` to fetch exactly the range.

`Bin` reads values two ways. Lower-case methods (`u8 u16 u32 i32 u64 f32 f64
ascii cstr utf16`) read at the cursor and advance it. Upper-case methods
(`U8 U16 I16 U32 I32 U64 F32 F64 STR`) read at a given offset and leave the
cursor alone.

`src.bytesRead` counts what was fetched. The status bar shows it, which makes
an accidental whole-file read easy to spot.

## Adding a format

1. Create `js/formats/<name>.js`.
2. Add a `<script>` tag for it in `EasyMeta.html`, next to the other formats.
3. Add the format to the welcome text in `js/app.js` and to the tables in
   `README.md` and `docs/FORMATS.md`.

A minimal reader:

```js
/* EasyMeta - Example XYZ format. */
(function () {
  'use strict';
  const M = window.EasyMeta;

  M.registerFormat({
    id: 'xyz', name: 'Example XYZ', modality: 'EM', extensions: ['xyz'],

    // head: the first 8 KB as a Uint8Array; ext: lower-case extension.
    // Return a score from 0 (not mine) to 1 (certain).
    sniff: (head, ext) => (M.startsWith(head, 'XYZ1') ? 1 : 0),

    async parse(src, ctx) {
      const ds = M.newDataset(src, this);
      const b = await src.bin(0, 64);                 // header, little-endian
      ds.dims = { x: b.U32(4), y: b.U32(8), z: b.U32(12) };
      const px = b.F32(16) * 1e-10;                   // stored in Å -> metres
      ds.pixel = { x: px, y: px, source: 'XYZ header' };
      ds.kind = ds.dims.z > 1 ? 'imagestack' : 'image';

      const em = M.ensureEM(ds);
      M.set(em, 'ht', b.F32(20) * 1000);              // stored in kV -> volts
      M.set(em, 'mag', b.F32(24));

      ds.raw['XYZ header'] = { nx: ds.dims.x, ny: ds.dims.y, nz: ds.dims.z };
      M.addSource(ds, 'XYZ header');
      return ds;
    },
  });
})();
```

How detection works:

- `sniff` scores are compared across all formats. A format wins with the
  highest score, and needs at least 0.3.
- If the file's extension is in `extensions`, 0.25 is added to a non-zero
  score. Use a low score, such as 0.3, for a weak signature and let the
  extension decide.
- `ctx` holds `seriesIndex`, the session `entry` and the `session`. A format
  with several images per file sets `ds.series = [{ index, name }]` and
  `ds.seriesIndex`, and parses the image `ctx.seriesIndex` asks for.

To add a preview, set `ds.thumbnail` to an async function that returns
`{ canvas, note }`. `js/core/image.js` has `M.img.readPlane`,
`M.img.grayCanvas` and related helpers that read one plane, shrink it and
auto-contrast it. Read one plane at most.

## Adding a TIFF flavour

Many formats are TIFF inside. The TIFF format in `js/formats/tiff_family.js`
opens the file, reads page 1 and hands it to the best-matching flavour.

```js
M.registerTiffFlavor({
  id: 'myscope', name: 'MyScope TIFF', modality: 'EM',
  // tiff.ifd0.tags is a Map of tag code -> entry; tiff.description is tag 270
  match: (tiff) => (tiff.ifd0.tags.has(65100) ? 0.9 : 0),
  async parse(tiff, ds, ctx) {
    ds.modality = 'EM';
    ds.kind = 'image';
    // read the vendor tag, fill ds ...
  },
});
```

The generic flavour scores 0.1 and ImageJ 0.5, so a vendor flavour should
score higher. The container fills `ds.dims.x`, `ds.dims.y`, `ds.bits` and
`ds.pixelType` before `parse` runs, and adds a page-1 preview afterwards
unless the flavour sets `ds.thumbnail` or `ds.noThumbnail`.

## Adding a companion file type

A companion is a side-car file that adds metadata to an image.

```js
M.registerCompanion({
  id: 'mylog', name: 'MyScope log',
  maxSize: 1024 * 1024,                       // larger files are not parsed (default 8 MB)
  accepts: (name, ext, head) => ext === 'log',
  async parse(src) { return parseLog(await src.text(0, src.size)); },
  // c: the companion entry, p: a primary entry in the same folder.
  // Return null, or { score, relation }.
  link(c, p) {
    return M.stem(c.name).toLowerCase() === M.stem(p.name).toLowerCase()
      ? { score: 0.9, relation: 'image' } : null;
  },
  attach(ds, parsed, link) {
    // copy values into ds with M.set(...)
  },
});
```

- `link` is tried for every primary file **in the same folder**.
- A score of 0.5 or more shows the companion as a tag in the Files list.
- A score of 0.85 or more is a "strong" link. A companion type that also
  defines `standalone` (a format definition, as for `.mdoc` and EPU XML) is
  shown as its own entry only while it has no strong link.
- `attach` runs after the format's `parse` and before `M.analyze`.

## Adding a check

Checks live in `js/analysis/checks.js`. Add a line inside `lmChecks` or
`emChecks`:

```js
add('warn', 'Detector', 'Short title that states the finding.', 'One sentence of explanation or advice.');
```

The levels are `'error'`, `'warn'`, `'info'` and `'ok'`. Follow the existing
style: state what the metadata shows, give the numbers, and phrase thresholds
as rules of thumb. Add the check to `docs/CHECKS.md`.

A value that several checks or pages need belongs in `js/analysis/analyze.js`,
computed once, not in the check.

## Pages and graphics

`M.pages.list(ds)` in `js/views/pages.js` decides which pages a dataset gets.
A page is `{ id, label, render(ds, app) }`, and `render` returns a DOM element.
The small widgets `card`, `kv`, `tiles`, `grid` and `svgBox` are in `M.ui`.
`kv` drops rows with an empty value, so a page does not need to test each one.

Graphics are in `js/views/graphics.js`. Each function returns an **SVG
string** sized by its `viewBox`. Colours come from CSS classes named `g-*`,
never from inline colours. The same SVG is styled dark by `css/easymeta.css`
in the app and light by the style block in `js/views/report.js` in the
report. When you add a class, define it in both places.

## Testing with real files

The app cannot open a file by path when it runs from `file://`. For automated
tests there is a small development server:

```
python tools/devserver.py 8765
```

It serves the EasyMeta folder at `http://127.0.0.1:8765/` and any local file
at `/fs/<url-encoded absolute path>`, with HTTP Range support. The app then
reads the file exactly as it reads a dropped file.

Two URL parameters drive the app:

| Parameter | Effect |
|---|---|
| `open=<url>` | Opens that file. Repeat it to open companions together. |
| `page=<id>` | Shows a page: `overview`, `optics`, `stack`, `beam`, `tilt`, `volume`, `movie`, `montage`, `checks`, `raw`. |

Example:

```
http://127.0.0.1:8765/EasyMeta.html?open=/fs/E%3A/data/stack.mrc&open=/fs/E%3A/data/stack.mrc.mdoc&page=tilt
```

From the browser console, `EasyMeta.app.ds` is the current dataset and
`EasyMeta.app.ds.checks` its checks.

A headless browser can take a screenshot of any page this way:

```
msedge --headless=new --window-size=1480,940 --virtual-time-budget=9000 --screenshot=out.png "<url>"
```

The server binds to `127.0.0.1` only, but it serves any file the user can
read. Do not leave it running on a shared computer.

## Building the launcher and the icon

```
launcher\build_launcher.bat
```

This compiles `launcher\EasyMeta.cs` into `EasyMeta.exe` with the C# compiler
of the .NET Framework 4 that ships with Windows. No Visual Studio or SDK is
needed.

`tools/make_icon.py` packs PNG renders of `img/easymeta.svg` into the `.ico`
used by the launcher.

## Refreshing the dye spectra

The spectra in `js/data/spectra_fpbase.js` are built from FPbase by two
scripts. Downloading needs the internet once:

```
python tools/fetch_fpbase_spectra.py tools/fpbase_spectrum_ids.csv <download folder>
python tools/build_spectra.py tools/fpbase_spectrum_ids.csv <download folder> .
```

`tools/fpbase_spectrum_ids.csv` lists the fluorophores and their FPbase
spectrum ids. To add a dye, add a row and rerun both scripts. The build also
rewrites `SPECTRA_CREDITS.md`. The spectra data is redistributed under
CC BY-SA 4.0; keep the credits file with it.

A dye without an FPbase spectrum can be given peak wavelengths by hand in
`js/analysis/dyes.js`.

## Releasing a version

1. Update `M.version` in `js/core/util.js`.
2. Update `AssemblyVersion` and `AssemblyFileVersion` in
   `launcher/EasyMeta.cs` and rebuild the launcher.
3. Add an entry to `CHANGELOG.md`.
4. Update the version line at the top of the documents in `docs/`.
5. Commit, tag (`git tag v0.2.0`) and push the tag.
6. Publish a GitHub release from the tag, with the changelog entry as its
   notes.
