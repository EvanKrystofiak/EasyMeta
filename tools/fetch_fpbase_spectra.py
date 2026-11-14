"""Download the fluorophore spectra EasyMeta bundles, from FPbase's public API.

    python tools/fetch_fpbase_spectra.py tools/fpbase_spectrum_ids.csv <raw_dir>

Fetches https://www.fpbase.org/api/spectrum/<id>/ for every ex/ab/em id in the
map and saves each response as <raw_dir>/<id>.json (already-downloaded ids are
skipped).  Run once at build time, then tools/build_spectra.py; the app itself
never goes online.  FPbase data policy: https://www.fpbase.org/terms/
"""
import csv
import json
import os
import sys
import time
import urllib.request

API = "https://www.fpbase.org/api/spectrum/{}/"
HEADERS = {
    "User-Agent": "EasyMeta-build/0.1 (offline microscopy metadata viewer; one-time spectra download)",
    "Accept": "application/json",
}


def spectrum_ids(id_map):
    ids = []
    with open(id_map, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            for key in ("ex_id", "ab_id", "em_id"):
                v = (row.get(key) or "").strip()
                if v.isdigit() and v not in ids:
                    ids.append(v)
    return ids


def main(id_map, raw_dir):
    os.makedirs(raw_dir, exist_ok=True)
    ids = spectrum_ids(id_map)
    total = 0
    for i, sid in enumerate(ids, 1):
        path = os.path.join(raw_dir, f"{sid}.json")
        if os.path.exists(path):
            continue
        req = urllib.request.Request(API.format(sid), headers=HEADERS)
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
                break
            except Exception as e:  # retry transient errors, then give up on this id
                if attempt == 2:
                    print(f"{i}/{len(ids)} spectrum {sid}: FAILED ({e})", flush=True)
                    data = None
                time.sleep(2)
        if data is None:
            continue
        json.loads(data)  # must be JSON
        with open(path, "wb") as f:
            f.write(data)
        total += len(data)
        print(f"{i}/{len(ids)} spectrum {sid}: {len(data)} bytes", flush=True)
        time.sleep(0.3)  # be gentle with a community-run server
    print(f"done: {len(ids)} ids, {total / 1e6:.2f} MB downloaded", flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
