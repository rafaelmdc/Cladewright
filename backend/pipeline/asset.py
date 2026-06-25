"""
Stage 5 — build + write the game-data asset.

Precompute everything the client needs so play is O(lineage length): the
pool-induced backbone (only nodes ancestral to some pool tip), per-node pool_count,
per-tip ancestor-id lineage, traits, the alias index, and a provenance block. Exact
shape: docs/game-asset-format.md. (Fame/time_weight are post-MVP — not emitted.)
"""
from __future__ import annotations

import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .enrich import index_keys, is_junk_name
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
    group_aliases: dict[str, list[str]] | None = None,
    hidden_label_max: int = 15,
    scope: str = "kingdom=Animalia",
    label: str = "",
    version: int = 1,
    provenance: dict | None = None,
) -> dict:
    node_names = node_names or {}
    group_aliases = group_aliases or {}
    # Resolve each pool tip to its backbone parent + lineage.
    tip_lineages: dict[str, list[str]] = {}
    pool_count: Counter[str] = Counter()  # all pool tips (incl. extinct, if pooled)
    pool_count_extant: Counter[str] = Counter()  # excluding extinct tips
    for tip in enriched:
        tid = tip_id(tip.taxon.scientific_name)
        parent_id, _ = tree.tips[tid]
        lineage = _lineage_ids(tree, parent_id)
        tip_lineages[tid] = lineage
        for node_id in lineage:
            pool_count[node_id] += 1
            if not tip.taxon.extinct:
                pool_count_extant[node_id] += 1

    induced = set(pool_count)  # every ancestor of some pool tip

    nodes = []
    for node_id in induced:
        node = tree.nodes[node_id]
        harvested = node_names.get(node_id, [])
        # Display common name for a clade, e.g. "Bear" for Ursidae — first non-junk
        # harvested name (the list is enwiki-title-first), falling back to the backbone
        # common or None. Junk = authority strings like "Vulpes Frisch, 1775".
        node_common = next((h for h in harvested if not is_junk_name(h)), None)
        nodes.append(
            {
                "id": node.id,
                "rank": node.rank,
                "sci": node.sci,
                "common": (node_common or node.common),
                # Parent is always ancestral to the same tips, hence also induced.
                "parent": node.parent,
                "pool_count": pool_count[node_id],
                # Extant-only denominator for the "N remaining" counter when the player
                # has the extinct toggle off. Equals pool_count when no extinct pooled.
                "pool_count_extant": pool_count_extant[node_id],
            }
        )
    nodes.sort(key=lambda n: n["id"])

    # Aliases resolve a typed name to a tip OR an internal clade node (ids are
    # distinguishable by prefix: "tip:" vs rank prefixes). Naming a clade is allowed
    # (animalist-style); the game rewards it only when it places a NEW node.
    aliases: dict[str, list[str]] = {}

    # A virtual paraphyletic group (grp:Fox) claims its alias keys EXCLUSIVELY, so a
    # vague name like "fox" resolves only to the group node — never to a member genus
    # that happens to carry "fox" as a Wikidata alias. Build the claim map first.
    claimed: dict[str, str] = {}  # alias key -> owning group node id
    for gid, names in group_aliases.items():
        for name in names:
            for key in index_keys(name):
                claimed[key] = gid

    def add_alias(name: str, target_id: str) -> None:
        # Bake singular+plural keys at build; query stays a single normalize() lookup.
        for key in index_keys(name):
            if claimed.get(key, target_id) != target_id:
                continue  # this name belongs to a paraphyletic group node
            bucket = aliases.setdefault(key, [])
            if target_id not in bucket:  # dedup: never the same target twice
                bucket.append(target_id)

    # The group nodes own their claimed names.
    for gid, names in group_aliases.items():
        for name in names:
            add_alias(name, gid)

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
                # Popularity score (enwiki pageviews, sitelink-count fallback). Ranks the
                # pool for the capped "notable" blob + weights the Marathon time bonus.
                "fame": tip.fame,
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

    extant_tips = sum(1 for t in enriched if not t.taxon.extinct)
    return {
        "version": version,
        "schema": "1.0",
        "scope": scope,
        "label": label,
        "pool_size": len(tips),
        # Tips excluding extinct — the "N remaining" denominator when the player's extinct
        # toggle is off. Equals pool_size when no extinct were pooled.
        "pool_size_extant": extant_tips,
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
