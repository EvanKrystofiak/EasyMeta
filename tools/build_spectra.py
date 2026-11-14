"""Pack downloaded FPbase spectra into EasyMeta's bundled data file.

    python tools/build_spectra.py tools/fpbase_spectrum_ids.csv <raw_dir> <EasyMeta folder>

Reads <raw_dir>/<id>.json (from tools/fetch_fpbase_spectra.py) and writes
    js/data/spectra_fpbase.js   - spectra resampled to 2 nm, values 0-1000
    SPECTRA_CREDITS.md          - per-spectrum credits (FPbase ids, supplier, reference)
The spectra are FPbase data, redistributed under CC BY-SA 4.0 with attribution
(https://www.fpbase.org/terms/).  Only resampling/trimming is applied.
"""
import csv
import datetime
import json
import os
import sys

STEP = 2  # nm

# extra lookup names (normalised like EasyMeta's dye keys) for common shorthand
ALIASES = {
    "Hoechst 33342": ["hoechst"],
    "FITC": ["fluorescein"],
    "TRITC": ["tamra", "tetramethylrhodamine"],
    "Propidium iodide": ["pi"],
    "EGFP": ["gfp", "megfp"],
    "mClover (mClover3)": ["mclover3", "clover"],
    "GCaMP6 (GCaMP6f, Ca-bound)": ["gcamp", "gcamp6f"],
    "EYFP": ["yfp"],
    "mVenus": ["venus"],
    "mCitrine": ["citrine"],
    "ECFP": ["cfp"],
    "mCerulean": ["cerulean"],
    "mTurquoise2": ["mturquoise"],
    "mTagBFP2": ["tagbfp"],
    "mEmerald": ["emerald"],
    "Dendra2 green": ["dendra2"],
    "mEos3.2 green": ["meos32"],
    "iRFP713": ["irfp"],
    "BV421": ["brilliantviolet421"],
    "MitoTracker Red FM (alt.)": ["mitotrackerredfm"],
}
SKIP = {"Propidium iodide (alt.)"}  # second PI record (absorption only)


def resample(points):
    """[[nm, value], ...] at ~1 nm -> (start, [ints 0..1000]) at STEP nm, trimmed."""
    pts = sorted((float(a), float(b)) for a, b in points if b is not None)
    if len(pts) < 2:
        return None
    lo, hi = pts[0][0], pts[-1][0]
    start = int(-(-lo // STEP) * STEP)
    peak = max(v for _, v in pts) or 1.0
    out, j = [], 0
    nm = start
    while nm <= hi:
        while j + 1 < len(pts) - 1 and pts[j + 1][0] <= nm:
            j += 1
        (x0, y0), (x1, y1) = pts[j], pts[min(j + 1, len(pts) - 1)]
        y = y0 if x1 == x0 else y0 + (y1 - y0) * (nm - x0) / (x1 - x0)
        out.append(max(0, min(1000, round(1000 * y / peak))))
        nm += STEP
    # trim near-zero tails, keeping one zero sample at each end
    first = next((i for i, v in enumerate(out) if v >= 5), 0)
    last = len(out) - 1 - next((i for i, v in enumerate(reversed(out)) if v >= 5), 0)
    first = max(0, first - 1)
    last = min(len(out) - 1, last + 1)
    return start + first * STEP, out[first:last + 1]


def peak_of(points):
    return int(max(points, key=lambda p: p[1])[0])


def main(id_map, raw_dir, root):
    entries, credits = [], []
    with open(id_map, encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    for row in rows:
        name = row["requested"].strip()
        if name in SKIP or row["fpbase_owner"].startswith("NOT IN"):
            continue
        ex_id = (row["ex_id"] or "").strip() or (row["ab_id"] or "").strip()
        ex_kind = "ex" if (row["ex_id"] or "").strip() else "ab"
        em_id = (row["em_id"] or "").strip()
        entry = {"name": name.replace(" (alt.)", ""), "fpbase": row["fpbase_owner"], "aliases": ALIASES.get(name, [])}
        for key, sid, kind in (("ex", ex_id, ex_kind), ("em", em_id, "em")):
            if not sid:
                continue
            with open(os.path.join(raw_dir, f"{sid}.json"), encoding="utf-8") as f:
                spec = json.load(f)
            r = resample(spec["data"])
            if not r:
                continue
            start, values = r
            entry[key] = {"id": int(sid), "kind": kind, "start": start, "v": values}
            entry[key + "Peak"] = int(spec.get("peak_wave") or peak_of(spec["data"]))
        entry["credit"] = {k: v for k, v in (("supplier", row["dye_manufacturer"]), ("source", row["source_field"]), ("doi", row["protein_primary_reference_doi"])) if v}
        entries.append(entry)
        credits.append((entry, ex_id, ex_kind, em_id, row))

    today = datetime.date.today().isoformat()
    data = {"generated": today, "step": STEP, "source": "FPbase (https://www.fpbase.org)", "license": "CC BY-SA 4.0", "entries": entries}
    header = (
        "/* EasyMeta - measured fluorophore spectra from FPbase (https://www.fpbase.org).\n"
        " * Lambert TJ (2019) FPbase: a community-editable fluorescent protein database.\n"
        " * Nat Methods 16:277-278, doi:10.1038/s41592-019-0352-8.  Used under the FPbase data\n"
        " * policy (https://www.fpbase.org/terms/); redistributed under CC BY-SA 4.0\n"
        " * (https://creativecommons.org/licenses/by-sa/4.0/).  Changes: resampled to 2 nm,\n"
        " * peak-normalised to 1000, near-zero tails trimmed.  Per-spectrum credits (original\n"
        " * authors / suppliers) are in SPECTRA_CREDITS.md.  Dye names are trademarks of their owners.\n"
        f" * Generated {today} by tools/build_spectra.py - do not edit by hand.\n */\n"
    )
    js = header + "window.EasyMeta = window.EasyMeta || {};\nwindow.EasyMeta.spectraData = " + json.dumps(data, separators=(",", ":")) + ";\n"
    out_js = os.path.join(root, "js", "data", "spectra_fpbase.js")
    os.makedirs(os.path.dirname(out_js), exist_ok=True)
    with open(out_js, "w", encoding="utf-8", newline="\n") as f:
        f.write(js)

    lines = [
        "# Fluorophore spectra credits",
        "",
        "EasyMeta draws measured excitation/emission spectra from **FPbase** (https://www.fpbase.org):",
        "Lambert TJ (2019) *FPbase: a community-editable fluorescent protein database.* Nat Methods 16:277-278,",
        "doi:10.1038/s41592-019-0352-8.",
        "",
        "The spectra are used under the FPbase data policy (https://www.fpbase.org/terms/) and redistributed",
        "in `js/data/spectra_fpbase.js` under **CC BY-SA 4.0** (https://creativecommons.org/licenses/by-sa/4.0/).",
        "Changes made: resampled to 2 nm, peak-normalised, near-zero tails trimmed. Where FPbase has no",
        "excitation spectrum, the absorption spectrum is used and labelled as such. Credit for each spectrum",
        "belongs to the original authors or supplier listed below; dye names are trademarks of their owners.",
        "",
        f"Downloaded {today} with `tools/fetch_fpbase_spectra.py`, built with `tools/build_spectra.py`.",
        "",
        "| Fluorophore | FPbase record | FPbase spectrum ids | Supplier / data source | Reference |",
        "|---|---|---|---|---|",
    ]
    for entry, ex_id, ex_kind, em_id, row in credits:
        ids = ", ".join(x for x in ((f"{ex_id} ({'excitation' if ex_kind == 'ex' else 'absorption'})" if ex_id else ""), (f"{em_id} (emission)" if em_id else "")) if x)
        supplier = " / ".join(x for x in (row["dye_manufacturer"], row["source_field"]) if x) or "not stated on FPbase"
        doi = f"doi:{row['protein_primary_reference_doi']}" if row["protein_primary_reference_doi"] else ""
        lines.append(f"| {entry['name']} | {row['fpbase_owner']} | {ids} | {supplier} | {doi} |")
    lines += ["", "Not on FPbase (shown with its published peaks only): DyLight 594."]
    with open(os.path.join(root, "SPECTRA_CREDITS.md"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{len(entries)} fluorophores, {os.path.getsize(out_js) / 1024:.0f} KB -> {out_js}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
