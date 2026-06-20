"""
Stage 5 — build + write the game-data asset.

Precompute everything the client needs so play is O(lineage length): the
pool-induced backbone (only nodes on a root→pool-tip path), per-node pool_count,
per-tip ancestor-id lineage, traits, fame, time_weight, the alias index, and a
provenance block. Exact shape: docs/game-asset-format.md.
"""
from __future__ import annotations

import json
from pathlib import Path

from .types import EnrichedTip, Tree


def build_asset(
    tree: Tree,
    enriched: list[EnrichedTip],
    *,
    hidden_label_max: int = 15,
) -> dict:
    """Assemble the asset dict (the wire contract in docs/game-asset-format.md).

    TODO(phase-1):
      - prune backbone to the pool-induced subtree; keep degree-2 nodes only where a
        rank label/hint attaches
      - compute pool_count per node (count of pool tips beneath)
      - emit per-tip ordered ancestor lineage (root→parent) for O(L) MRCA
      - build the normalized alias index
      - stamp provenance (ColDP release, BICHO/Braidworks versions, pool config, ts)
        and a monotonic `version`
    """
    raise NotImplementedError


def write_asset(doc: dict, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
