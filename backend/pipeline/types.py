"""
Internal pipeline types (not the wire format — that's docs/game-asset-format.md).

These are the in-memory shapes passed between stages. Kept deliberately small;
flesh out fields as stages are implemented in Phase 1.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Taxon:
    """One accepted species from ColDP, with its denormalized ranked lineage."""

    source_id: str
    scientific_name: str
    # ordered (rank, name) lineage from kingdom down to the parent of this species
    lineage: list[tuple[str, str]]
    vernacular: str | None = None          # CoL VernacularName, if present
    # Resolution-only aliases (NOT the display name): English vernaculars of this species'
    # subspecies, folded up so "Bengal tiger" resolves to Panthera tigris. See ingest.
    extra_aliases: list[str] = field(default_factory=list)
    environment: list[str] = field(default_factory=list)
    biomes: list[str] = field(default_factory=list)
    extinct: bool = False


@dataclass
class Node:
    """Internal clade node in the backbone."""

    id: str
    rank: str
    sci: str
    common: str | None
    parent: str | None
    pool_count: int = 0


@dataclass
class Tree:
    """The full backbone: id -> Node, plus the species tips hung beneath it."""

    nodes: dict[str, Node]
    root_id: str
    # tip id -> (parent node id, Taxon)
    tips: dict[str, tuple[str, Taxon]]


@dataclass
class EnrichedTip:
    """A pool tip after common-name + fame enrichment.

    ``fame`` is a popularity score (Wikipedia pageviews, with Wikidata sitelink count as
    the fallback for taxa with no enwiki article). It ranks the playable pool (which N to
    bundle in a capped "notable" blob) and weights the Marathon obscurity time bonus.
    0 when neither signal is available (offline provider, or a taxon Wikidata doesn't know).
    """

    taxon: Taxon
    common: str           # resolved display name (vernacular → wikidata → sci)
    aliases: list[str]
    fame: int = 0
    # Whether ``common`` is a REAL vernacular rather than the scientific name this falls back
    # to. Two thirds of a pack like Fish have no vernacular at all, so a game mode that
    # promises common names needs to know the difference rather than guess at the render
    # site (#145). See enrich.py::has_vernacular.
    has_common: bool = False
    # Whether the species has a picture on Wikipedia. Clade Clash is built around the art, so
    # its round generator draws only from species that HAVE some (#146). None = never looked
    # (offline builds); the client then falls back to asking Wikipedia itself.
    has_image: bool | None = None
