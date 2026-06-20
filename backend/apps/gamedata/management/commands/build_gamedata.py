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

    def handle(self, *args, **opts) -> None:
        coldp_dir: Path = opts["coldp_dir"]
        if not coldp_dir.exists():
            raise CommandError(f"ColDP dir not found: {coldp_dir}")

        # TODO(phase-1): wire the stages. Each currently raises NotImplementedError.
        self.stdout.write("1/5 ingest (BICHO)…")
        taxa = ingest.ingest_coldp(coldp_dir, scope=opts["scope"])

        self.stdout.write("2/5 backbone…")
        tree = backbone.build_backbone(taxa)

        self.stdout.write("3/5 pool select…")
        pool_tips = pool.select_pool(
            tree, size=opts["pool_size"], clade_floor=opts["clade_floor"]
        )

        self.stdout.write("4/5 enrich (Braidworks: common names + pageviews)…")
        enriched = enrich.enrich(pool_tips)

        self.stdout.write("5/5 build + validate asset…")
        doc = asset_builder.build_asset(
            tree, enriched, hidden_label_max=opts["hidden_label_max"]
        )
        validate.validate_asset(doc)
        asset_builder.write_asset(doc, opts["out"])

        self.stdout.write(self.style.SUCCESS(f"Wrote {opts['out']}"))
