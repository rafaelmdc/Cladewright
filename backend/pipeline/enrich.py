"""
Stage 4 — enrich with common names + fame, via Braidworks.

CoL VernacularName (Stage 1) covers famous animals but leaves gaps and gives no
popularity signal. Braidworks weavers close both: wikidata vernacular fills name
gaps; Wikipedia pageviews supply the fame score that drives pool selection.
Display-name precedence: CoL vernacular → Wikidata → scientific. See
docs/data-pipeline.md §Stage 4. Enrichment runs over pool *candidates* (a few
thousand), not all animals — Braidworks caching makes re-runs near-free.
"""
from __future__ import annotations

from .types import EnrichedTip, Taxon


def fame_scores(candidates: list[Taxon]) -> dict[str, float]:
    """taxon source_id -> normalized Wikipedia-pageview fame. Used by Stage 3.

    TODO(phase-1): call the Braidworks pageviews weaver; normalize to [0, 1].
    """
    raise NotImplementedError


def enrich(pool_tips: list[Taxon]) -> list[EnrichedTip]:
    """Resolve display common name + aliases + time_weight for each pool tip.

    TODO(phase-1):
      - common name by precedence (CoL → Wikidata vernacular → scientific)
      - build alias list (accepted common names + obvious variants); ambiguity is
        resolved HERE, at build time, not at play time
      - derive time_weight (Marathon novelty base) — final curve is playtest-tuned
    """
    raise NotImplementedError
