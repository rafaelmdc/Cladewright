"""
Stage 3 — select the playable pool.

Default (``size=0``, the chosen design): **keep all non-extinct species** in scope —
the pool is everything, like rose.systems/animalist. The "N remaining" counts then
range over the full clade, which (with the reveal threshold) naturally concentrates
hints on small terminal clades and rewards specificity. Used for well-covered clades
and per-clade games. Extinct taxa are excluded from v1.

Legacy curated mode (``size>0``): rank by fame and keep the top ``size`` WITH a
per-clade floor so no major group is starved. The floor is a guarantee — every group
keeps up to ``clade_floor`` tips even if that pushes the total past ``size``. Kept for
poorly-covered scopes where an all-species pool would be mostly unknown organisms.

Order is fully deterministic (fame desc, source_id tiebreak). See
docs/data-pipeline.md §Stage 3.
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
    size: int = 0,
    clade_floor: int = 10,
    floor_rank: str = "order",
) -> list[Taxon]:
    candidates = [t for _, t in tree.tips.values() if not t.extinct]

    # Deterministic global ranking: fame desc, then source_id.
    def sort_key(t: Taxon) -> tuple[float, str]:
        return (-fame.get(t.source_id, 0.0), t.source_id)

    candidates.sort(key=sort_key)

    # size=0 -> "have them all": the whole non-extinct set is the pool.
    if size <= 0:
        return candidates

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
