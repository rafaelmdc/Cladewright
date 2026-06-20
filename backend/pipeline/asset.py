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

from .enrich import normalize
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
    node_names: dict[str, list[str]] | None = None,
    hidden_label_max: int = 15,
    scope: str = "kingdom=Animalia",
    version: int = 1,
    provenance: dict | None = None,
) -> dict:
    node_names = node_names or {}
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
        harvested = node_names.get(node_id, [])
        nodes.append(
            {
                "id": node.id,
                "rank": node.rank,
                # Display common name for a clade, e.g. "Bear" for Ursidae (first
                # harvested name), falling back to the backbone common or None.
                "sci": node.sci,
                "common": (harvested[0] if harvested else node.common),
                # Parent is always ancestral to the same tips, hence also induced.
                "parent": node.parent,
                "pool_count": pool_count[node_id],
            }
        )
    nodes.sort(key=lambda n: n["id"])

    # Aliases resolve a typed name to a tip OR an internal clade node (ids are
    # distinguishable by prefix: "tip:" vs rank prefixes). Naming a clade is allowed
    # (animalist-style); the game rewards it only when it places a NEW node.
    aliases: dict[str, list[str]] = {}

    def add_alias(name: str, target_id: str) -> None:
        key = normalize(name)
        if not key:
            return
        bucket = aliases.setdefault(key, [])
        if target_id not in bucket:
            bucket.append(target_id)

    for node_id in induced:
        node = tree.nodes[node_id]
        add_alias(node.sci, node_id)            # e.g. "felidae" -> fam:Felidae
        if node.common:
            add_alias(node.common, node_id)
        for name in node_names.get(node_id, []):  # "bear" -> Ursidae, "whale" -> Cetacea
            add_alias(name, node_id)

    tips = []
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
            add_alias(alias, tid)

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
