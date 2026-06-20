"""
Asset conformance checks — the asset's contract, enforced before write.

Mirrors docs/game-asset-format.md §Validation. A build must FAIL rather than ship a
bad asset. Crucially, ``pool_count`` is recomputed and compared, never trusted.
"""
from __future__ import annotations

from collections import Counter


class AssetValidationError(Exception):
    pass


def validate_asset(doc: dict) -> None:
    nodes = {n["id"]: n for n in doc["nodes"]}
    tips = {t["id"]: t for t in doc["tips"]}

    if len(nodes) != len(doc["nodes"]):
        raise AssetValidationError("duplicate node ids")
    if len(tips) != len(doc["tips"]):
        raise AssetValidationError("duplicate tip ids")

    # Exactly one root; every parent resolves.
    roots = [n for n in doc["nodes"] if n["parent"] is None]
    if len(roots) != 1:
        raise AssetValidationError(f"expected exactly one root, found {len(roots)}")
    for n in doc["nodes"]:
        if n["parent"] is not None and n["parent"] not in nodes:
            raise AssetValidationError(f"node {n['id']} has dangling parent {n['parent']}")

    # No cycles: every node reaches the root by walking parents.
    root_id = roots[0]["id"]
    for n in doc["nodes"]:
        seen = set()
        cur = n["id"]
        while cur is not None:
            if cur in seen:
                raise AssetValidationError(f"cycle through node {n['id']}")
            seen.add(cur)
            if cur == root_id:
                break
            cur = nodes[cur]["parent"]

    # Tips: parent resolves; lineage is a valid root→parent path ending at parent.
    recomputed: Counter[str] = Counter()
    for t in doc["tips"]:
        if t["parent"] not in nodes:
            raise AssetValidationError(f"tip {t['id']} has dangling parent {t['parent']}")
        lineage = t["lineage"]
        if not lineage or lineage[-1] != t["parent"]:
            raise AssetValidationError(f"tip {t['id']} lineage does not end at its parent")
        if nodes[lineage[0]]["parent"] is not None:
            raise AssetValidationError(f"tip {t['id']} lineage does not start at the root")
        for i in range(1, len(lineage)):
            if lineage[i] not in nodes:
                raise AssetValidationError(f"tip {t['id']} lineage has unknown node {lineage[i]}")
            if nodes[lineage[i]]["parent"] != lineage[i - 1]:
                raise AssetValidationError(f"tip {t['id']} lineage is not a parent chain")
        for node_id in lineage:
            recomputed[node_id] += 1

    # pool_count must equal the recomputed count of pool tips beneath each node.
    for n in doc["nodes"]:
        if n["pool_count"] != recomputed[n["id"]]:
            raise AssetValidationError(
                f"node {n['id']} pool_count={n['pool_count']} != recomputed {recomputed[n['id']]}"
            )

    # Aliases target real tips.
    for alias, targets in doc["aliases"].items():
        for tid in targets:
            if tid not in tips:
                raise AssetValidationError(f"alias {alias!r} targets unknown tip {tid}")

    if len(doc["tips"]) != doc["pool_size"]:
        raise AssetValidationError("pool_size does not match number of tips")
    if "thresholds" not in doc or "hidden_label_max" not in doc["thresholds"]:
        raise AssetValidationError("missing thresholds.hidden_label_max")
    if "provenance" not in doc:
        raise AssetValidationError("missing provenance block")
