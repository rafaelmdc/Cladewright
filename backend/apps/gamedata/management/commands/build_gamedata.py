"""
build_gamedata — regenerate the game-data asset from a ColDP dump.

This is the ONE place the heavy Python deps (BICHO, Braidworks) are touched.
It runs the offline pipeline (backend/pipeline/) and writes a versioned asset:

    ColDP ──ingest──▶ backbone ──pool select──▶ enrich ──▶ asset (validated)

A build is a pure function of (ColDP dump, pinned dep versions, pool config) — same
inputs, byte-identical asset. See docs/data-pipeline.md and docs/game-asset-format.md.

Phase 0: argument surface only; every stage raises NotImplementedError. Phase 1
fills the stages in backend/pipeline/.
"""
from __future__ import annotations

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from pipeline import asset as asset_builder
from pipeline import backbone, enrich, ingest, pool, validate


class Command(BaseCommand):
    help = "Build the game-data asset from a Catalogue of Life Data Package."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--coldp-dir", required=True, type=Path,
                            help="Path to the ColDP dump directory (NameUsage.tsv, …).")
        parser.add_argument("--out", required=True, type=Path,
                            help="Where to write the game-data asset JSON.")
        parser.add_argument("--scope", default="kingdom=Animalia",
                            help="BICHO scope filter (default: kingdom=Animalia).")
        parser.add_argument("--pool-size", type=int, default=2500,
                            help="Number of playable tips to keep (default: 2500).")
        parser.add_argument("--clade-floor", type=int, default=10,
                            help="Min tips guaranteed per major clade (per-clade floor).")
        parser.add_argument("--hidden-label-max", type=int, default=15,
                            help="Default 'N remaining' reveal threshold baked into the asset.")
        parser.add_argument("--enrich", choices=["offline", "braidworks"], default="offline",
                            help="Enrichment provider: offline stub (default) or real "
                                 "Braidworks (Wikidata names + Wikipedia pageviews).")

    def handle(self, *args, **opts) -> None:
        coldp_dir: Path = opts["coldp_dir"]
        if not coldp_dir.exists():
            raise CommandError(f"ColDP dir not found: {coldp_dir}")

        # Stage order: fame must be known before pool selection ranks within clades.
        # TODO(phase-1): pass a Braidworks-backed EnrichProvider for real names/fame;
        # the default OfflineProvider keeps this runnable without the weavers.
        self.stdout.write("1/6 ingest (ColDP)…")
        taxa = ingest.ingest_coldp(coldp_dir, scope=opts["scope"])
        self.stdout.write(f"      {len(taxa)} accepted species")

        self.stdout.write("2/6 backbone…")
        tree = backbone.build_backbone(taxa)
        self.stdout.write(f"      {len(tree.nodes)} clade nodes")

        # One provider instance shared across stages so a Braidworks batch (network)
        # runs once and both fame + names read its cache.
        provider = (
            enrich.BraidworksProvider() if opts["enrich"] == "braidworks"
            else enrich.OfflineProvider()
        )

        self.stdout.write(f"3/6 fame scores ({opts['enrich']})…")
        fame = enrich.fame_scores(taxa, provider)

        self.stdout.write("4/6 pool select (fame + per-clade floor)…")
        pool_taxa = pool.select_pool(
            tree, fame, size=opts["pool_size"], clade_floor=opts["clade_floor"]
        )
        self.stdout.write(f"      {len(pool_taxa)} playable tips")

        self.stdout.write("5/6 enrich (common names + aliases; species + clades)…")
        enriched = enrich.enrich(pool_taxa, fame, provider)
        node_names = enrich.enrich_clade_nodes(tree, provider)  # "bear"->Ursidae, …
        self.stdout.write(f"      {len(node_names)} clades got common names")

        self.stdout.write("6/6 build + validate asset…")
        doc = asset_builder.build_asset(
            tree,
            enriched,
            node_names=node_names,
            hidden_label_max=opts["hidden_label_max"],
            scope=opts["scope"],
        )
        validate.validate_asset(doc)
        asset_builder.write_asset(doc, opts["out"])

        self.stdout.write(self.style.SUCCESS(f"Wrote {opts['out']} (pool_size={doc['pool_size']})"))
