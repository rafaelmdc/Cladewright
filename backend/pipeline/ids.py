"""Stable id construction shared across pipeline stages.

Internal node ids look like ``gen:Ursus``; tip ids like ``tip:Ursus_arctos``. The
same name at the same rank under *different* parents (a homonym) is disambiguated
with a ``#n`` suffix so distinct clades never collapse together.
"""
from __future__ import annotations

# Canonical ColDP lineage ranks, ordered kingdom -> genus, with id prefixes.
RANK_PREFIX: dict[str, str] = {
    "kingdom": "kng",
    "phylum": "phy",
    "subphylum": "subphy",
    "superclass": "supercls",
    "class": "cls",
    "subclass": "subcls",
    "superorder": "superord",
    "order": "ord",
    "suborder": "subord",
    "superfamily": "superfam",
    "family": "fam",
    "subfamily": "subfam",
    "tribe": "tribe",
    "subtribe": "subtribe",
    "genus": "gen",
    "subgenus": "subgen",
}

# The lineage columns we read from ColDP NameUsage, in descent order.
LINEAGE_RANKS: tuple[str, ...] = tuple(RANK_PREFIX.keys())


def rank_prefix(rank: str) -> str:
    return RANK_PREFIX.get(rank, rank[:4].lower())


def base_node_id(rank: str, name: str) -> str:
    return f"{rank_prefix(rank)}:{name}"


def tip_id(scientific_name: str) -> str:
    return "tip:" + scientific_name.strip().replace(" ", "_")
