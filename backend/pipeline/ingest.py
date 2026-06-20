"""
Stage 1 — ingest ColDP.

Reads a Catalogue of Life Data Package directly (following the same contract BICHO
documents in BICHOv2/docs/inputs.md). Each accepted NameUsage row carries its full
denormalized ranked lineage, plus environment/extinct; the optional side tables add
common names (VernacularName.tsv) and biomes (Distribution.tsv). Why ColDP over
NCBI: a curated Linnaean checklist without NCBI's placeholder sequencing names.
See docs/data-pipeline.md §Stage 1.

This is a self-contained reader so the pipeline runs without BICHO installed; the
column contract matches BICHO's so its ingest can be swapped in later.
"""
from __future__ import annotations

import csv
from pathlib import Path

from .ids import LINEAGE_RANKS
from .types import Taxon

ACCEPTED_STATUSES = {"accepted", "provisionally accepted"}


def _col(headers: list[str]):
    """Return a getter that finds a ColDP column by name, with/without ``col:``."""
    index = {h: i for i, h in enumerate(headers)}

    def get(row: list[str], name: str) -> str:
        for key in (f"col:{name}", name):
            i = index.get(key)
            if i is not None and i < len(row):
                return row[i].strip()
        return ""

    return get


def _split_multi(value: str) -> list[str]:
    if not value:
        return []
    out: list[str] = []
    for part in value.replace(";", ",").split(","):
        part = part.strip()
        if part:
            out.append(part)
    return out


def _read_tsv(path: Path):
    with open(path, encoding="utf-8", newline="") as fh:
        reader = csv.reader(fh, delimiter="\t")
        headers = next(reader, None)
        if headers is None:
            return
        get = _col(headers)
        for row in reader:
            yield row, get


def _load_vernacular(coldp_dir: Path) -> dict[str, str]:
    """taxonID -> a preferred common name (English first), if VernacularName.tsv exists."""
    path = coldp_dir / "VernacularName.tsv"
    if not path.exists():
        return {}
    chosen: dict[str, str] = {}
    for row, get in _read_tsv(path):
        taxon_id = get(row, "taxonID") or get(row, "nameID")
        name = get(row, "name")
        if not taxon_id or not name:
            continue
        lang = get(row, "language").lower()
        # First name seen wins; an English name upgrades a non-English one.
        if taxon_id not in chosen or lang in ("en", "eng"):
            chosen[taxon_id] = name
    return chosen


def _load_distribution(coldp_dir: Path) -> dict[str, list[str]]:
    """taxonID -> list of biogeographic areas, if Distribution.tsv exists."""
    path = coldp_dir / "Distribution.tsv"
    if not path.exists():
        return {}
    areas: dict[str, list[str]] = {}
    for row, get in _read_tsv(path):
        taxon_id = get(row, "taxonID")
        area = get(row, "area") or get(row, "areaID") or get(row, "gazetteer:areaID")
        if not taxon_id or not area:
            continue
        bucket = areas.setdefault(taxon_id, [])
        if area not in bucket:
            bucket.append(area)
    return areas


def ingest_coldp(coldp_dir: Path, *, scope: str = "kingdom=Animalia") -> list[Taxon]:
    """Read accepted species from a ColDP dump into Taxa with their lineages."""
    coldp_dir = Path(coldp_dir)
    name_usage = coldp_dir / "NameUsage.tsv"
    if not name_usage.exists():
        raise FileNotFoundError(f"NameUsage.tsv not found in {coldp_dir}")

    scope_rank, _, scope_value = scope.partition("=")
    scope_rank, scope_value = scope_rank.strip(), scope_value.strip().lower()

    vernacular = _load_vernacular(coldp_dir)
    distribution = _load_distribution(coldp_dir)

    taxa: list[Taxon] = []
    for row, get in _read_tsv(name_usage):
        if get(row, "status").lower() not in ACCEPTED_STATUSES:
            continue
        if get(row, "rank").lower() != "species":
            continue
        if scope_rank and get(row, scope_rank).lower() != scope_value:
            continue

        # Prefer a clean binomial from the atomic fields; fall back to scientificName.
        genus = get(row, "genericName")
        epithet = get(row, "specificEpithet")
        sci = f"{genus} {epithet}".strip() if genus and epithet else get(row, "scientificName")
        if not sci:
            continue

        lineage: list[tuple[str, str]] = []
        for rank in LINEAGE_RANKS:
            name = get(row, rank)
            if name:
                lineage.append((rank, name))
        if not lineage:
            continue

        source_id = get(row, "ID")
        taxa.append(
            Taxon(
                source_id=source_id,
                scientific_name=sci,
                lineage=lineage,
                vernacular=vernacular.get(source_id),
                environment=_split_multi(get(row, "environment")),
                biomes=distribution.get(source_id, []),
                extinct=get(row, "extinct").lower() in ("true", "1", "yes"),
            )
        )
    return taxa
