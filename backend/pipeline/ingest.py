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

# We stream the dump row-by-row (csv.reader is a lazy iterator — the 1.8 GB file is never
# loaded whole). The only memory risk is a single pathological field; real CoL dumps carry
# occasional fat cells (long `remarks`/reference strings in columns we don't even use) that
# exceed csv's default 131072-byte cap. Lift the cap to a BOUNDED 16 MiB — generous for any
# legit taxonomic field, but still bounded, so one bad row can't balloon memory.
_MAX_FIELD_BYTES = 16 * 1024 * 1024
csv.field_size_limit(_MAX_FIELD_BYTES)


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


def _headers(path: Path) -> list[str]:
    with open(path, encoding="utf-8", newline="") as fh:
        return next(csv.reader(fh, delimiter="\t"), []) or []


# Ranks that are never ancestors in the accepted backbone — we don't index these into the
# parentID walk map (keeps it to the backbone, not the millions of species rows).
_TERMINAL_RANKS = frozenset(
    {"species", "subspecies", "variety", "subvariety", "form", "subform", "natio",
     "aberration", "morph", "infraspecificname"}
)
_LINEAGE_RANK_SET = frozenset(LINEAGE_RANKS)


_ENGLISH_LANGS = frozenset({"en", "eng", "english", ""})


def _load_vernacular(coldp_dir: Path) -> dict[str, str]:
    """taxonID -> an ENGLISH common name, if VernacularName.tsv has one.

    ENGLISH-ONLY by design. CoL's vernacular coverage is multilingual and, for some
    groups, heavily non-English (Japanese is dominant for fish). A non-English name here
    becomes BOTH the displayed common name AND a search alias — that's why
    "Gadus chalcogrammus" showed as "スケトウダラ" and searching "alaska pollock" missed.
    So we keep only English-tagged rows (untagged counts as English — CoL's English rows
    are often blank-language); the Braidworks weaver supplies real English names for the
    rest. First English name per taxon wins.
    """
    path = coldp_dir / "VernacularName.tsv"
    if not path.exists():
        return {}
    chosen: dict[str, str] = {}
    for row, get in _read_tsv(path):
        taxon_id = get(row, "taxonID") or get(row, "nameID")
        name = get(row, "name")
        if not taxon_id or not name:
            continue
        if get(row, "language").strip().lower() not in _ENGLISH_LANGS:
            continue  # drop non-English vernaculars entirely
        chosen.setdefault(taxon_id, name)
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
    """Read accepted species from a ColDP dump into Taxa with their lineages.

    Handles BOTH ColDP shapes so the pipeline never needs a separate denormalize step:
      * **denormalized** — each row already carries its ranked lineage columns
        (``col:class``, ``col:order``, …). What ``scripts/fetch_clb_coldp.py`` writes.
      * **normalized** — the standard ColDP archive (e.g. CoL's ``latest_coldp.zip``):
        each row has a ``col:parentID``, and the lineage is reconstructed by walking the
        parent chain. The bulk dump is ingested directly, no preprocessing.
    """
    coldp_dir = Path(coldp_dir)
    name_usage = coldp_dir / "NameUsage.tsv"
    if not name_usage.exists():
        raise FileNotFoundError(f"NameUsage.tsv not found in {coldp_dir}")

    # A scope is `rank=value`, where value may be a comma-separated UNION of clades
    # (e.g. `class=Teleostei,Elasmobranchii,Myxini` for "all living fish" — a paraphyletic
    # group with no single CoL node). A row is in scope if its lineage cell at `rank` is any
    # of the values.
    scope_rank, _, scope_value = scope.partition("=")
    scope_rank = scope_rank.strip()
    scope_values = {v.strip().lower() for v in scope_value.split(",") if v.strip()}

    vernacular = _load_vernacular(coldp_dir)
    distribution = _load_distribution(coldp_dir)

    # Pick the shape from the header. Normalized ColDP carries `parentID` and atomized
    # name parts (including a `genus` column) but NO higher-rank lineage columns; the
    # denormalized API dump carries class/order/family/… columns and no parentID. So key
    # off the *higher* ranks (excluding genus/subgenus, which exist in both as name parts)
    # and fall back to parentID.
    hset = {h.replace("col:", "") for h in _headers(name_usage)}
    has_higher = any(r in hset for r in LINEAGE_RANKS if r not in ("genus", "subgenus"))
    denormalized = has_higher or "parentID" not in hset
    lineage_of = _denorm_lineage if denormalized else _build_parent_walker(name_usage)

    # Fold each species' SUBSPECIES English vernaculars up into resolution-only aliases, so
    # "Bengal tiger" → Panthera tigris without the subspecies being a playable tip. Only on
    # the normalized dump (parentID links a subspecies row to its species); restricted to
    # rank=subspecies to avoid CoL's mis-ranked vernaculars (e.g. "cattle" on the Bovidae
    # family). Collected in the SAME pass; attached to the in-scope species afterwards.
    has_parent = "parentID" in hset
    subsp_aliases: dict[str, list[str]] = {}

    taxa: list[Taxon] = []
    for row, get in _read_tsv(name_usage):
        if get(row, "status").lower() not in ACCEPTED_STATUSES:
            continue
        rank = get(row, "rank").lower()
        if rank == "subspecies":
            if has_parent:
                parent_id = get(row, "parentID")
                name = vernacular.get(get(row, "ID"))
                if parent_id and name:
                    subsp_aliases.setdefault(parent_id, []).append(name)
            continue
        if rank != "species":
            continue

        lineage = lineage_of(row, get)
        if not lineage:
            continue
        if scope_rank and scope_values and \
                dict(lineage).get(scope_rank, "").lower() not in scope_values:
            continue

        # Prefer a clean binomial from the atomic fields; fall back to scientificName.
        # Normalized ColDP names the genus field "genus"; the API dump uses "genericName".
        genus = get(row, "genericName") or get(row, "genus")
        epithet = get(row, "specificEpithet")
        sci = f"{genus} {epithet}".strip() if genus and epithet else get(row, "scientificName")
        if not sci:
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

    # Attach each species' subspecies-vernacular aliases (dedup, preserve order).
    for t in taxa:
        extra = subsp_aliases.get(t.source_id)
        if extra:
            t.extra_aliases = list(dict.fromkeys(extra))
    return taxa


def _denorm_lineage(row, get) -> list[tuple[str, str]]:
    """Lineage straight off a row's ranked columns (denormalized ColDP)."""
    out: list[tuple[str, str]] = []
    for rank in LINEAGE_RANKS:
        name = get(row, rank)
        if name:
            out.append((rank, name))
    return out


def _build_parent_walker(name_usage: Path):
    """First pass over a NORMALIZED dump: index the accepted backbone (every non-terminal
    rank) as id → (parentID, rank, name). Returns a closure that, given a species row,
    walks its parent chain into an ordered ranked lineage. Memory is bounded by the
    backbone (higher taxa), not the species rows."""
    backbone: dict[str, tuple[str, str, str]] = {}
    for row, get in _read_tsv(name_usage):
        if get(row, "status").lower() not in ACCEPTED_STATUSES:
            continue
        rank = get(row, "rank").lower()
        if rank in _TERMINAL_RANKS:
            continue
        nid = get(row, "ID")
        if not nid:
            continue
        name = get(row, "scientificName") or get(row, "uninomial") or get(row, "genus")
        backbone[nid] = (get(row, "parentID"), rank, name)

    def lineage_of(row, get) -> list[tuple[str, str]]:
        by_rank: dict[str, str] = {}
        cur = get(row, "parentID")
        seen: set[str] = set()
        while cur and cur in backbone and cur not in seen:
            seen.add(cur)
            parent_id, rank, name = backbone[cur]
            if name and rank in _LINEAGE_RANK_SET and rank not in by_rank:
                by_rank[rank] = name
            cur = parent_id
        return [(r, by_rank[r]) for r in LINEAGE_RANKS if r in by_rank]

    return lineage_of
