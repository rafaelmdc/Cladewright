"""
Asset conformance checks — the asset's contract, enforced before write.

Mirrors docs/game-asset-format.md §Validation. A build must FAIL rather than ship a
bad asset.
"""
from __future__ import annotations


class AssetValidationError(Exception):
    pass


def validate_asset(doc: dict) -> None:
    """Raise AssetValidationError on any structural problem.

    TODO(phase-1) — check:
      - every node.parent / tip.parent resolves; exactly one root; no cycles
      - node.pool_count == recomputed count of pool tips beneath it (don't trust)
      - every tip.lineage is a valid root→parent path ending at tip.parent
      - every alias target is a real tip id
      - len(tips) == pool_size; thresholds + provenance present
    """
    raise NotImplementedError
