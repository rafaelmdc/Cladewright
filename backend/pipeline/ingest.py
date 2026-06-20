"""
Stage 1 — ingest ColDP via BICHO.

Each accepted NameUsage row carries its full denormalized ranked lineage, plus
environment/extinct and (side tables) biomes from Distribution.tsv and common names
from VernacularName.tsv. Why ColDP over NCBI: it's a curated Linnaean checklist
without NCBI's placeholder sequencing names. See docs/data-pipeline.md §Stage 1.
"""
from __future__ import annotations

from pathlib import Path

from .types import Taxon


def ingest_coldp(coldp_dir: Path, *, scope: str = "kingdom=Animalia") -> list[Taxon]:
    """Read the ColDP dump into Taxa.

    TODO(phase-1):
      - run BICHO `taxa ingest` (scoped) for lineage + environment + extinct + biomes
      - read VernacularName.tsv for common names (BICHO doesn't today — extend it or
        read the side table here)
      - keep only accepted / provisionally-accepted statuses
    """
    raise NotImplementedError
