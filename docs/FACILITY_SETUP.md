# Facility setup

EasyMeta 0.1.1

This document is for the person who looks after shared microscope and analysis
computers. It covers installing EasyMeta, naming your instruments, and keeping
it up to date.

- [What you are installing](#what-you-are-installing)
- [Installing](#installing)
- [The Windows launcher](#the-windows-launcher)
- [Naming your instruments](#naming-your-instruments)
- [Updating](#updating)
- [Privacy and security](#privacy-and-security)

## What you are installing

EasyMeta is a folder of plain files: one HTML page, its scripts and style
sheet, and a small Windows launcher. It has no installer, no service, no
database and no dependencies. It needs:

- a current version of Edge, Chrome, Firefox or Safari;
- nothing else. No internet connection, no Python, no administrator rights.

## Installing

1. Download the repository as a ZIP, or clone it.
2. Copy the whole `EasyMeta` folder to the computer, for example to
   `C:\Tools\EasyMeta` or to the user's Documents folder.
3. On Windows, make a shortcut to `EasyMeta.exe` on the desktop. On macOS or
   Linux, bookmark `EasyMeta.html` in the browser.

The folder must stay together. `EasyMeta.html` loads its scripts from the
`js`, `css`, `img` and `config` folders beside it.

Users only need these parts:

```
EasyMeta.exe   EasyMeta.bat   EasyMeta.html
css/   js/   img/   config/
```

The `launcher/` and `tools/` folders are for development. You may leave them
out of a deployed copy.

**One copy for many computers.** The folder can sit on a shared drive, with
one copy of `config/instruments.js` for everyone. If the `.exe` does not start
from the share, open `EasyMeta.html` from the share in a browser instead.

## The Windows launcher

`EasyMeta.exe` is a 24 KB program that does one thing: it opens
`EasyMeta.html`, from its own folder, in an Edge or Chrome "app" window
without tabs or an address bar. If it finds neither browser it opens the page
in the default browser. It uses the .NET Framework 4 that is part of Windows.

The `.exe` is not code-signed. Windows SmartScreen or your organisation's
software policy may block it, especially on a copy downloaded from the
internet. You have three options:

| Option | Notes |
|---|---|
| Use `EasyMeta.bat` | Opens the same app window in Edge. No compiled program involved. |
| Open `EasyMeta.html` | Works everywhere, in a normal browser tab. |
| Build the `.exe` yourself | Run `launcher\build_launcher.bat`. It compiles `launcher\EasyMeta.cs` with the C# compiler that ships with Windows. The source is 70 lines; you can read it first. |

If the launcher reports that `EasyMeta.html` was not found, the `.exe` was
moved out of the `EasyMeta` folder. Put it back, or use a shortcut.

## Naming your instruments

Files often identify a microscope only by a system ID or serial number, such
as `TITAN12345678` or a D-number. `config/instruments.js` maps those to the
names your users know.

Open the file in a text editor. It holds a list of rules. A facility's list
could look like this (these IDs are made up):

```js
window.EasyMeta.instrumentRegistry = [
  { match: /TITAN12345678|\bD1234\b/i, name: 'Titan Krios G4 (D1234)', site: 'Example Facility' },
  { match: /GLACIOS-?1234567|\b1234567\b/i, name: 'Glacios (1234567)', site: 'Example Facility' },
  { match: /2100Plus/i, name: 'JEOL JEM-2100Plus' },
  { match: /Tecnai T12/i, name: 'FEI Tecnai T12' },
];
```

| Field | Meaning |
|---|---|
| `match` | A regular expression. It is tested, ignoring case, against the system ID, serial number, microscope name, model, manufacturer and EM camera name found in the file. |
| `name` | The name to show. |
| `site` | Optional. Your facility or room, shown on the Beam & camera page. |

The **first rule that matches wins**, so put specific rules above general
ones.

The system IDs in the shipped file are made up and commented out. **Put in
the IDs of your own instruments.**

### Finding the text to match

1. Open a file from the instrument in EasyMeta.
2. For electron microscopy, go to **Beam & camera** and read *System ID*,
   *Serial / D-number* and *Name in file*. For light microscopy, go to
   **Optics & channels** and read *System* and *Serial number*.
3. If none of these identifies the instrument, search the **Raw metadata**
   page for a serial number.
4. Write a rule that matches that text.

### Writing a rule

| You want to match | Write |
|---|---|
| The text `TITAN12345678` | `/TITAN12345678/i` |
| Either of two texts | `/TITAN12345678\|D1234/i` |
| `D1234` as a whole word, not inside `D12341` | `/\bD1234\b/i` |
| `GLACIOS-1234567` with or without the hyphen | `/GLACIOS-?1234567/i` |
| Any LSM 980 | `/LSM 980/i` |

Each rule goes on its own line and ends with a comma. Save the file and
reload EasyMeta (close and reopen it, or press `F5`).

A serial number is the safest thing to match. A model name such as `LSM 980`
matches every instrument of that model, which is only right if you have one.

### Where the name appears

- The **Microscope** tile on the Overview page, with the name from the file
  beneath it.
- The **Instrument** row on the Beam & camera page.
- The summary in reports and exports.
- The methods paragraph: "…collected on a Titan Krios G4 (D1234)…".

If a rule has a mistake, such as a missing comma or bracket, the whole list
fails to load. EasyMeta then shows the names from the files, as if the list
were empty. Fix the line and reload.

## Updating

1. Keep a copy of your `config/instruments.js`.
2. Replace the `EasyMeta` folder with the new version.
3. Put your `config/instruments.js` back.

The version number is shown at the right of the status bar. See
[`CHANGELOG.md`](../CHANGELOG.md) for what changed.

**Refreshing the dye spectra** is optional and rarely needed. It is the only
task that uses the internet, and it runs from a script, not from the app:

```
python tools/fetch_fpbase_spectra.py tools/fpbase_spectrum_ids.csv <download folder>
python tools/build_spectra.py tools/fpbase_spectrum_ids.csv <download folder> .
```

## Privacy and security

- **No network access.** The app loads no fonts, scripts or images from the
  internet and sends nothing anywhere. It works on an air-gapped computer.
- **Read-only.** EasyMeta reads the files you open. It never changes, moves or
  deletes them.
- **Nothing is kept.** EasyMeta stores no history or cache. Closing the window
  forgets everything.
- **Exports go where the browser saves them.** A report or export is written
  only when the user asks for one, and lands in the browser's download folder.
- **The development server is not part of the app.** `tools/devserver.py`
  exists for automated testing. It serves any local file to requests from the
  same computer, so do not run it on a shared machine. Users never need it.
