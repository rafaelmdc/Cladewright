"""
Stage 2 — build the rooted backbone from denormalized lineages.

One internal node per distinct (rank, name) lineage cell; one tip per species.
A (rank, name) that appears under two different parents (a homonym) gets a distinct
node so unrelated clades never merge. Covers ALL ingested animals — it is the
routing structure; only the pool-induced portion is shipped (Stage 5). See
docs/data-pipeline.md §Stage 2.
"""
from __future__ import annotations

from .ids import base_node_id, tip_id
from .types import Node, Taxon, Tree


def build_backbone(taxa: list[Taxon]) -> Tree:
    nodes: dict[str, Node] = {}
    tips: dict[str, tuple[str, Taxon]] = {}
    # (rank, name, parent_id) -> node id, so homonyms under different parents split.
    by_key: dict[tuple[str, str, str | None], str] = {}
    root_id: str | None = None

    for taxon in taxa:
        parent_id: str | None = None
        for rank, name in taxon.lineage:
            key = (rank, name, parent_id)
            node_id = by_key.get(key)
            if node_id is None:
                node_id = _unique_id(base_node_id(rank, name), nodes)
                by_key[key] = node_id
                nodes[node_id] = Node(
                    id=node_id, rank=rank, sci=name, common=None, parent=parent_id
                )
                if parent_id is None:
                    if root_id is None:
                        root_id = node_id
                    elif root_id != node_id:
                        # Multiple roots — outside a single-kingdom scope. Keep the
                        # first; a synthetic super-root could be added if ever needed.
                        pass
            parent_id = node_id

        if parent_id is None:
            continue  # taxon with empty lineage; skip
        tips[tip_id(taxon.scientific_name)] = (parent_id, taxon)

    if root_id is None:
        raise ValueError("backbone has no root — no taxa with a lineage were ingested")
    return Tree(nodes=nodes, root_id=root_id, tips=tips)


def _unique_id(base: str, nodes: dict[str, Node]) -> str:
    if base not in nodes:
        return base
    n = 2
    while f"{base}#{n}" in nodes:
        n += 1
    return f"{base}#{n}"
