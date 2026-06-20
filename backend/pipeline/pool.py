"""
Stage 3 — select the playable pool.

Rank pool-eligible tips by fame, keep the top ``size``, WITH a per-clade floor so no
major group is starved (decided: floor, no ceiling). Extinct taxa are excluded from
v1 but their flag is preserved upstream for a later themed paleo mode. The pool is
the universe the "N remaining" counts range over. See docs/data-pipeline.md §Stage 3.
"""
from __future__ import annotations

from .types import Taxon, Tree


def select_pool(
    tree: Tree,
    *,
    size: int = 2500,
    clade_floor: int = 10,
    floor_rank: str = "order",
) -> list[Taxon]:
    """Choose the playable tips.

    TODO(phase-1):
      - exclude extinct (v1)
      - within each ``floor_rank`` group, take the top ``clade_floor`` by fame
      - fill remaining slots globally by fame up to ``size``
      - fame comes from enrich.fame_scores(); order is deterministic (fame, id tiebreak)
    """
    raise NotImplementedError
