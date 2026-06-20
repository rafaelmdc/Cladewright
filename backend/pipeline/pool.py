"""
Stage 3 — select the playable pool.

Rank pool-eligible tips by fame, keep the top ``size``, WITH a per-clade floor so no
major group is starved (decided: floor, no ceiling). Extinct taxa are excluded from
v1. The pool is the universe the "N remaining" counts range over. Order is fully
deterministic (fame desc, source_id tiebreak). See docs/data-pipeline.md §Stage 3.

The floor is a **guarantee**: every group keeps up to ``clade_floor`` tips even if
that pushes the total past ``size`` (only possible when the floors sum to more than
``size`` — a misconfiguration for the real ~2,500 pool). ``size`` is the target for
the global fill stage, not a hard cap on the floors.
"""
from __future__ import annotations

from .types import Taxon, Tree


def _floor_group(taxon: Taxon, floor_rank: str) -> str:
    for rank, name in taxon.lineage:
        if rank == floor_rank:
            return name
    return ""  # no node at that rank — its own ungrouped bucket


def select_pool(
    tree: Tree,
    fame: dict[str, float],
    *,
    size: int = 2500,
    clade_floor: int = 10,
    floor_rank: str = "order",
) -> list[Taxon]:
    candidates = [t for _, t in tree.tips.values() if not t.extinct]

    # Deterministic global ranking: fame desc, then source_id.
    def sort_key(t: Taxon) -> tuple[float, str]:
        return (-fame.get(t.source_id, 0.0), t.source_id)

    candidates.sort(key=sort_key)

    selected: dict[str, Taxon] = {}

    # 1) Per-clade floor: top `clade_floor` by fame within each floor-rank group.
    groups: dict[str, list[Taxon]] = {}
    for t in candidates:
        groups.setdefault(_floor_group(t, floor_rank), []).append(t)
    for members in groups.values():
        for t in members[:clade_floor]:  # floor is a guarantee; not capped by size
            selected[t.source_id] = t

    # 2) Fill remaining slots globally by fame.
    for t in candidates:
        if len(selected) >= size:
            break
        selected.setdefault(t.source_id, t)

    # Return in deterministic global order.
    return sorted(selected.values(), key=sort_key)
