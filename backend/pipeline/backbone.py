"""
Stage 2 — build the rooted backbone from denormalized lineages.

One internal node per distinct (rank, name) lineage cell; one tip per species.
Collapse empty/duplicate rank cells so there are no degenerate chains. Covers ALL
ingested animals — it is the routing structure; only the pool-induced portion is
shipped (Stage 5). See docs/data-pipeline.md §Stage 2.
"""
from __future__ import annotations

from .types import Taxon, Tree


def build_backbone(taxa: list[Taxon]) -> Tree:
    """Assemble taxa into one rooted Tree.

    TODO(phase-1):
      - intern (rank, name) cells to node ids; link parent←child along each lineage
      - attach each species as a tip under its deepest lineage node
      - drop degenerate single-child rank chains that carry no label
    """
    raise NotImplementedError
