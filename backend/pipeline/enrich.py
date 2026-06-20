"""
Stage 4 — enrich with common names + fame.

CoL VernacularName (Stage 1) covers famous animals but leaves gaps and gives no
popularity signal. The real implementation closes both via **Braidworks** weavers:
wikidata vernacular fills name gaps; Wikipedia pageviews supply the fame score that
drives pool selection. Display-name precedence: CoL vernacular → Wikidata →
scientific. See docs/data-pipeline.md §Stage 4.

Until those weavers exist, a deterministic offline provider keeps the whole pipeline
runnable and reproducible. Swap in the Braidworks-backed provider by passing one to
`fame_scores` / `enrich`.
"""
from __future__ import annotations

import hashlib
import re
from typing import Protocol

from .types import EnrichedTip, Taxon

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]")


def normalize(name: str) -> str:
    """Lowercase, drop punctuation, collapse whitespace — the alias-index key form."""
    return _WS.sub(" ", _PUNCT.sub("", name.lower())).strip()


class EnrichProvider(Protocol):
    """How the pipeline reaches common names + fame. Implemented by Braidworks."""

    def fame(self, taxon: Taxon) -> float: ...
    def common_name(self, taxon: Taxon) -> str | None: ...


class OfflineProvider:
    """Deterministic, network-free default. Fame is a stable hash in [0, 1); common
    name is whatever CoL vernacular provided (no Wikidata fallback offline)."""

    def fame(self, taxon: Taxon) -> float:
        digest = hashlib.sha1(taxon.source_id.encode("utf-8")).digest()
        return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF

    def common_name(self, taxon: Taxon) -> str | None:
        return taxon.vernacular


def fame_scores(taxa: list[Taxon], provider: EnrichProvider | None = None) -> dict[str, float]:
    """source_id -> normalized fame. Used by Stage 3 (pool selection)."""
    provider = provider or OfflineProvider()
    return {t.source_id: provider.fame(t) for t in taxa}


def enrich(
    pool_taxa: list[Taxon],
    fame: dict[str, float],
    provider: EnrichProvider | None = None,
) -> list[EnrichedTip]:
    provider = provider or OfflineProvider()
    out: list[EnrichedTip] = []
    for taxon in pool_taxa:
        # Display name precedence: CoL/Wikidata vernacular → scientific.
        common = provider.common_name(taxon) or taxon.scientific_name

        # Alias set: common name + scientific name (normalized). Richer aliases
        # (genus-level "bear", spelling variants) are a later enrichment.
        aliases = sorted({normalize(common), normalize(taxon.scientific_name)} - {""})

        out.append(
            EnrichedTip(
                taxon=taxon,
                common=common,
                aliases=aliases,
                fame=fame.get(taxon.source_id, 0.0),
                time_weight=1.0,  # base; Marathon novelty multiplier is applied live
            )
        )
    return out
