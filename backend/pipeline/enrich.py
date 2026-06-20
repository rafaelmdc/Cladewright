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

_WS = re.compile(r"[\s_]+")  # underscores count as spaces (Wikipedia titles use them)
_PUNCT = re.compile(r"[^\w\s]")


def despace(name: str) -> str:
    """Turn a Wikipedia-style title into a display name: 'Brown_bear' -> 'Brown bear'."""
    return name.replace("_", " ").strip()


def normalize(name: str) -> str:
    """Lowercase, drop punctuation, fold underscores+whitespace — the alias-index key.

    Players type natural names ('brown bear'), never underscores, so any underscore in
    a source string must collapse to a space for the lookup to match.
    """
    return _WS.sub(" ", _PUNCT.sub("", name.lower().replace("_", " "))).strip()


class EnrichProvider(Protocol):
    """How the pipeline reaches common names + fame. Implemented by Braidworks.

    ``prepare`` is an optional batch hook: a provider that fans out over a network
    (Braidworks) runs the whole batch once and caches, so the per-taxon ``fame`` /
    ``common_name`` calls are then local lookups.
    """

    def prepare(self, taxa: list[Taxon]) -> None: ...
    def fame(self, taxon: Taxon) -> float: ...
    def common_name(self, taxon: Taxon) -> str | None: ...


class OfflineProvider:
    """Deterministic, network-free default. Fame is a stable hash in [0, 1); common
    name is whatever CoL vernacular provided (no Wikidata fallback offline)."""

    def prepare(self, taxa: list[Taxon]) -> None:
        return None

    def fame(self, taxon: Taxon) -> float:
        digest = hashlib.sha1(taxon.source_id.encode("utf-8")).digest()
        return int.from_bytes(digest[:4], "big") / 0xFFFFFFFF

    def common_name(self, taxon: Taxon) -> str | None:
        return despace(taxon.vernacular) if taxon.vernacular else None

    def names(self, taxon: Taxon) -> list[str]:
        """All name strings for the alias index (offline: just the CoL vernacular)."""
        return [despace(taxon.vernacular)] if taxon.vernacular else []


class BraidworksProvider:
    """Real enrichment via Braidworks: organism.scientific_name -> vernacular names
    (Wikidata) + Wikipedia pageviews, in one batched braid. Requires the braidworks
    weavers installed in this environment (``wikidata_weaver``, ``wikipedia_weaver``);
    see backend/pipeline/README.md. Fame is the log-normalized pageview count.

    Call ``prepare(taxa)`` once before ``fame`` / ``common_name`` (the pipeline does).
    """

    def __init__(self) -> None:
        # scientific_name -> {"names": [...], "pageviews": int}
        self._cache: dict[str, dict[str, object]] = {}
        self._max_log = 1.0

    def prepare(self, taxa: list[Taxon]) -> None:
        if self._cache:
            return  # already prepared for this run (idempotent across stages)
        import asyncio
        import math

        from braidworks.core import Braider, LocalExecutor, Strand, StrandSet
        from braidworks.core.discovery import build_registry_from_entry_points

        registry = build_registry_from_entry_points(only=frozenset({"wikidata", "wikipedia"}))
        braid = Braider(registry).plan(
            available_types=frozenset({"organism.scientific_name"}),
            target_types=frozenset({"organism.vernacular_names", "wikipedia.pageviews"}),
        )
        # Dedup by scientific name; the input strand rides through to the output so we
        # can map results back without relying on entity ids.
        names = sorted({t.scientific_name for t in taxa})
        inputs = [
            StrandSet.from_strands(name, [Strand("organism.scientific_name", name)])
            for name in names
        ]
        result = asyncio.run(LocalExecutor(registry).execute(braid, inputs))

        for ss in result.resolved:
            name_strand = ss.get("organism.scientific_name")
            if name_strand is None:
                continue
            pv_strand = ss.get("wikipedia.pageviews")
            vn_strand = ss.get("organism.vernacular_names")
            self._cache[name_strand.value] = {
                "names": list(vn_strand.value) if vn_strand else [],
                "pageviews": int(pv_strand.value) if pv_strand else 0,
            }
        self._max_log = max(
            (math.log1p(e["pageviews"]) for e in self._cache.values()), default=1.0
        ) or 1.0

    def fame(self, taxon: Taxon) -> float:
        import math

        entry = self._cache.get(taxon.scientific_name)
        if not entry:
            return 0.0
        return math.log1p(int(entry["pageviews"])) / self._max_log

    def common_name(self, taxon: Taxon) -> str | None:
        if taxon.vernacular:
            return despace(taxon.vernacular)
        entry = self._cache.get(taxon.scientific_name)
        names = entry["names"] if entry else []
        return despace(names[0]) if names else None

    def names(self, taxon: Taxon) -> list[str]:
        """Every harvested name (Wikidata label/altLabel/vernacular) + CoL vernacular,
        despaced — the colloquial aliases that make resolution feel right."""
        entry = self._cache.get(taxon.scientific_name)
        names = list(entry["names"]) if entry else []
        if taxon.vernacular:
            names.append(taxon.vernacular)
        return [despace(n) for n in names]


def fame_scores(taxa: list[Taxon], provider: EnrichProvider | None = None) -> dict[str, float]:
    """source_id -> normalized fame. Used by Stage 3 (pool selection)."""
    provider = provider or OfflineProvider()
    provider.prepare(taxa)
    return {t.source_id: provider.fame(t) for t in taxa}


def enrich(
    pool_taxa: list[Taxon],
    fame: dict[str, float],
    provider: EnrichProvider | None = None,
) -> list[EnrichedTip]:
    provider = provider or OfflineProvider()
    provider.prepare(pool_taxa)  # no-op if already prepared in fame_scores
    out: list[EnrichedTip] = []
    for taxon in pool_taxa:
        # Display name precedence: CoL/Wikidata vernacular → scientific.
        common = provider.common_name(taxon) or taxon.scientific_name

        # Alias set: scientific name + common name + every harvested name string
        # (Wikidata label/altLabel/vernacular: "panda bear", "the lion", …), all
        # normalized. This is what makes natural-name resolution work.
        keys = {normalize(common), normalize(taxon.scientific_name)}
        keys.update(normalize(n) for n in provider.names(taxon))
        aliases = sorted(keys - {""})

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
