#!/usr/bin/env python3
"""Build a real ColDP directory for one clade by paging the ChecklistBank API.

ChecklistBank's bulk ColDP export needs auth, but the read API is open and returns
each species with its full classification + vernacular names inline — so we can
reconstruct the ColDP tables our pipeline reads (NameUsage.tsv, VernacularName.tsv)
for a bounded subtree without an export job.

Usage:
    python scripts/fetch_clb_coldp.py --dataset 315448 --root 6224G --out ../data/coldp_mammalia

(315448 = the current Catalogue of Life release; 6224G = class Mammalia.)
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.checklistbank.org"
UA = "Cladewright/0.1 (rafaelmdcorreia@gmail.com)"

# Lineage rank columns we emit (subset of ColDP that our ingest reads).
LINEAGE_COLS = [
    "kingdom", "phylum", "subphylum", "class", "subclass", "order", "suborder",
    "superfamily", "family", "subfamily", "tribe", "subtribe", "genus", "subgenus",
]
NAMEUSAGE_COLS = [
    "ID", "status", "rank", "scientificName", "genericName", "specificEpithet",
    "environment", "extinct", *LINEAGE_COLS,
]


def _get(url: str, attempts: int = 4) -> dict:
    import json
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for i in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except Exception as exc:  # noqa: BLE001 — retry transient API/network errors
            if i == attempts - 1:
                raise
            time.sleep(1.5 * (i + 1))
            print(f"  retry ({exc})", file=sys.stderr)
    return {}


def fetch(dataset: str, root: str, out: Path, *, page: int = 1000) -> None:
    out.mkdir(parents=True, exist_ok=True)
    nu = open(out / "NameUsage.tsv", "w", newline="", encoding="utf-8")
    vn = open(out / "VernacularName.tsv", "w", newline="", encoding="utf-8")
    nu_w = csv.writer(nu, delimiter="\t")
    vn_w = csv.writer(vn, delimiter="\t")
    nu_w.writerow([f"col:{c}" for c in NAMEUSAGE_COLS])
    vn_w.writerow(["col:taxonID", "col:name", "col:language"])

    base = (
        f"{API}/dataset/{dataset}/nameusage/search"
        f"?TAXON_ID={urllib.parse.quote(root)}&rank=species&status=accepted"
    )
    offset, total, n_species, n_vern = 0, None, 0, 0
    while True:
        data = _get(f"{base}&limit={page}&offset={offset}")
        total = data.get("total", total)
        results = data.get("result", [])
        if not results:
            break
        for r in results:
            u = r.get("usage", {})
            name = u.get("name", {})
            ranks = {c.get("rank"): c.get("name") for c in r.get("classification", [])}
            envs = u.get("environments") or []
            nu_w.writerow([
                r.get("id", ""),
                u.get("status", ""),
                name.get("rank", "species"),
                name.get("scientificName", ""),
                name.get("genus", ""),
                name.get("specificEpithet", ""),
                ",".join(envs),
                "true" if u.get("extinct") else "false",
                *[ranks.get(c, "") for c in LINEAGE_COLS],
            ])
            n_species += 1
            for v in r.get("vernacularNames", []) or []:
                if v.get("name"):
                    vn_w.writerow([r.get("id", ""), v["name"], v.get("language", "")])
                    n_vern += 1
        offset += len(results)
        print(f"  {offset}/{total} species…", file=sys.stderr)
        if total is not None and offset >= total:
            break

    nu.close()
    vn.close()
    print(f"Wrote {n_species} species and {n_vern} vernacular rows to {out}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="315448", help="ChecklistBank dataset key (COL release)")
    ap.add_argument("--root", required=True, help="root taxon id (e.g. 6224G = Mammalia)")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--page", type=int, default=1000)
    args = ap.parse_args()
    fetch(args.dataset, args.root, args.out, page=args.page)
