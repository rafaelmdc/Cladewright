"""
Stage 5 — build + write the game-data asset.

Precompute everything the client needs so play is O(lineage length): the
pool-induced backbone (only nodes ancestral to some pool tip), per-node pool_count,
per-tip ancestor-id lineage, traits, fame, time_weight, the alias index, and a
provenance block. Exact shape: docs/game-asset-format.md.
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .ids import tip_id
from .types import EnrichedTip, Tree


def _lineage_ids(tree: Tree, parent_id: str) -> list[str]:
    """Reconstruct a tip's root→parent ancestor-id path from the backbone."""
    chain: list[str] = []
    node_id: str | None = parent_id
    while node_id is not None:
        chain.append(node_id)
        node_id = tree.nodes[node_id].parent
    chain.reverse()
    return chain


def build_asset(
    tree: Tree,
    enriched: list[EnrichedTip],
    *,
    hidden_label_max: int = 15,
    scope: str = "kingdom=Animalia",
    version: int = 1,
    provenance: dict | None = None,
) -> dict:
    # Resolve each pool tip to its backbone parent + lineage.
    tip_lineages: dict[str, list[str]] = {}
    pool_count: Counter[str] = Counter()
    for tip in enriched:
        tid = tip_id(tip.taxon.scientific_name)
        parent_id, _ = tree.tips[tid]
        lineage = _lineage_ids(tree, parent_id)
        tip_lineages[tid] = lineage
        for node_id in lineage:
            pool_count[node_id] += 1

    induced = set(pool_count)  # every ancestor of some pool tip

    nodes = []
    for node_id in induced:
        node = tree.nodes[node_id]
        nodes.append(
            {
                "id": node.id,
                "rank": node.rank,
                "sci": node.sci,
                "common": node.common,
                # Parent is always ancestral to the same tips, hence also induced.
                "parent": node.parent,
                "pool_count": pool_count[node_id],
            }
        )
    nodes.sort(key=lambda n: n["id"])

    tips = []
    aliases: dict[str, list[str]] = {}
    for tip in enriched:
        tid = tip_id(tip.taxon.scientific_name)
        tips.append(
            {
                "id": tid,
                "sci": tip.taxon.scientific_name,
                "common": tip.common,
                "parent": tree.tips[tid][0],
                "lineage": tip_lineages[tid],
                "fame": round(tip.fame, 6),
                "time_weight": tip.time_weight,
                "traits": {
                    "environment": tip.taxon.environment,
                    "biomes": tip.taxon.biomes,
                    "extinct": tip.taxon.extinct,
                },
            }
        )
        for alias in tip.aliases:
            bucket = aliases.setdefault(alias, [])
            if tid not in bucket:
                bucket.append(tid)

    tips.sort(key=lambda t: t["id"])

    prov = {
        "coldp_release": "unknown",
        "bicho_version": "unknown",
        "braidworks_version": "unknown",
        "built_at": datetime.now(timezone.utc).isoformat(),
        **(provenance or {}),
    }

    return {
        "version": version,
        "schema": "1.0",
        "scope": scope,
        "pool_size": len(tips),
        "thresholds": {"hidden_label_max": hidden_label_max},
        "provenance": prov,
        "nodes": nodes,
        "tips": tips,
        "aliases": aliases,
    }


def write_asset(doc: dict, out: Path) -> None:
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
