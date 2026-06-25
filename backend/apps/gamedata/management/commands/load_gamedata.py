"""
load_gamedata — ingest a built asset JSON into Postgres (the source of truth).

Decoupled from ``build_gamedata`` on purpose: the pipeline (BICHO/Braidworks) writes a
JSON file, and THIS command loads that file into the DB. So loading needs no pipeline
deps, and a built asset can be promoted to any environment by shipping the JSON.

    python manage.py load_gamedata --asset ../data/out/mammalia.json --current

Populates, in one transaction:
  * an AssetVersion row (with the whole asset as ``blob`` unless --no-blob),
  * TaxonNode / TaxonTip / Alias rows (the relational mirror for huge-scope serving).

--current marks this build the one the API serves for its scope.
"""
from __future__ import annotations

import json
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.gamedata.models import Alias, AssetVersion, TaxonNode, TaxonTip

BATCH = 5000


class Command(BaseCommand):
    help = "Load a built game-data asset JSON into the database."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--asset", required=True, type=Path, help="Path to built asset JSON.")
        parser.add_argument("--current", action="store_true",
                            help="Mark this build as the current one served for its scope.")
        parser.add_argument("--no-blob", action="store_true",
                            help="Don't store the whole-asset blob (huge scopes served only "
                                 "relationally via search/resolve).")
        parser.add_argument("--no-relational", action="store_true",
                            help="Store only the blob; skip the node/tip/alias tables.")

    def handle(self, *args, **opts) -> None:
        path: Path = opts["asset"]
        if not path.exists():
            raise CommandError(f"asset not found: {path}")
        doc = json.loads(path.read_text(encoding="utf-8"))

        scope = doc.get("scope", "unknown")
        version = int(doc.get("version", 0))
        nodes = doc.get("nodes", [])
        tips = doc.get("tips", [])
        aliases = doc.get("aliases", {})

        # Precompute each node's depth + root→parent lineage from parent pointers, so the
        # relational rows answer "resolve" with a single read (no recursive walk later).
        by_id = {n["id"]: n for n in nodes}
        lineage_cache: dict[str, list[str]] = {}

        def node_lineage(node_id: str) -> list[str]:
            if node_id in lineage_cache:
                return lineage_cache[node_id]
            chain: list[str] = []
            cur = by_id.get(node_id, {}).get("parent")
            while cur is not None and cur in by_id:
                chain.append(cur)
                cur = by_id[cur].get("parent")
            chain.reverse()
            lineage_cache[node_id] = chain
            return chain

        with transaction.atomic():
            if opts["current"]:
                AssetVersion.objects.filter(scope=scope, is_current=True).update(is_current=False)

            # Replace any prior load of this exact (scope, version) so re-runs are idempotent.
            AssetVersion.objects.filter(scope=scope, version=version).delete()

            pool_size = int(doc.get("pool_size", len(tips)))
            # The client blob is the capped "notable" subset (top-fame + complete coarse
            # backbone); the relational mirror below stays FULL so the tail resolves via
            # /search + /resolve. A scope whose whole pool fits gets the full doc as its blob.
            from pipeline.asset import build_notable_blob

            blob_doc = build_notable_blob(
                doc,
                coverage=float(doc.get("notable_coverage", 0.0)),
                min_tips=int(doc.get("notable_min", 5000)),
                max_tips=int(doc.get("notable_max", 0)),
                frontier_rank=str(doc.get("frontier_rank", "family")),
            )
            notable_count = len(blob_doc["tips"]) if blob_doc is not doc else 0

            # Membership filter over the FULL key set, but only when there's a tail to gate:
            # a hybrid scope (capped blob) or a relational-only remote scope. A whole-pool
            # blob already holds every name locally, so it needs no filter.
            membership = None
            if not opts["no_relational"] and (notable_count or opts["no_blob"]):
                from apps.gamedata.membership import build_filter

                membership = build_filter(aliases.keys())

            asset = AssetVersion.objects.create(
                scope=scope,
                label=doc.get("label", ""),
                version=version,
                schema=doc.get("schema", "1.0"),
                pool_size=pool_size,
                pool_size_extant=int(doc.get("pool_size_extant", pool_size)),
                notable_count=notable_count,
                frontier_rank=str(doc.get("frontier_rank", "family")),
                hidden_label_max=int(doc.get("thresholds", {}).get("hidden_label_max", 15)),
                provenance=doc.get("provenance", {}),
                blob=None if opts["no_blob"] else blob_doc,
                membership_filter=membership,
                is_current=opts["current"],
            )

            if not opts["no_relational"]:
                self._load_nodes(asset, nodes, node_lineage)
                self._load_tips(asset, tips)
                self._load_aliases(asset, aliases, by_id, tips)
                # Re-apply admin-curated manual aliases for this scope onto the new build, so
                # they survive a rebuild (they're scope-keyed, not version-keyed).
                from apps.gamedata.models import ManualAlias

                for ma in ManualAlias.objects.filter(scope=scope):
                    ma.apply_to_asset(asset)

        kind = "current" if opts["current"] else "stored"
        if opts["no_blob"]:
            blob_note = ""
        elif notable_count:
            blob_note = f" (+hybrid blob: {notable_count} notable, tail via /resolve)"
        else:
            blob_note = " (+blob, whole pool)"
        self.stdout.write(self.style.SUCCESS(
            f"{kind}: {scope} v{version} — {len(nodes)} nodes, {len(tips)} tips, "
            f"{len(aliases)} aliases" + blob_note
        ))

    def _load_nodes(self, asset, nodes, node_lineage) -> None:
        rows = [
            TaxonNode(
                asset=asset, key=n["id"], rank=n.get("rank", ""), sci=n["sci"],
                common=n.get("common"), parent_key=n.get("parent"),
                pool_count=n.get("pool_count", 0),
                pool_count_extant=n.get("pool_count_extant", n.get("pool_count", 0)),
                depth=len(node_lineage(n["id"])),
                lineage=node_lineage(n["id"]),
            )
            for n in nodes
        ]
        TaxonNode.objects.bulk_create(rows, batch_size=BATCH)

    def _load_tips(self, asset, tips) -> None:
        rows = [
            TaxonTip(
                asset=asset, key=t["id"], sci=t["sci"], common=t.get("common", t["sci"]),
                parent_key=t["parent"], lineage=t.get("lineage", []), traits=t.get("traits", {}),
                fame=int(t.get("fame", 0)),
            )
            for t in tips
        ]
        TaxonTip.objects.bulk_create(rows, batch_size=BATCH)

    def _load_aliases(self, asset, aliases, by_id, tips) -> None:
        tip_by_id = {t["id"]: t for t in tips}
        rows = []
        for norm, targets in aliases.items():
            for target in targets:
                tip = tip_by_id.get(target)
                node = by_id.get(target)
                if tip is not None:
                    rows.append(Alias(asset=asset, norm=norm, target_key=target,
                                      target_kind=Alias.TIP, sci=tip["sci"],
                                      common=tip.get("common"), fame=int(tip.get("fame", 0))))
                elif node is not None:
                    rows.append(Alias(asset=asset, norm=norm, target_key=target,
                                      target_kind=Alias.NODE, sci=node["sci"],
                                      common=node.get("common")))
        Alias.objects.bulk_create(rows, batch_size=BATCH)
