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
from pipeline import backbone, enrich, ingest, paraphyletic, pool, validate


class Command(BaseCommand):
    help = "Build the game-data asset from a Catalogue of Life Data Package."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--coldp-dir", required=True, type=Path,
                            help="Path to the ColDP dump directory (NameUsage.tsv, …).")
        parser.add_argument("--out", required=True, type=Path,
                            help="Where to write the game-data asset JSON.")
        parser.add_argument("--scope", default="kingdom=Animalia",
                            help="Taxonomic filter, rank=value[,value…] (union). The bulk of "
                                 "the dump is sliced to this. Default: kingdom=Animalia.")
        parser.add_argument("--scope-key", default="",
                            help="Stable scope identity baked into the asset + used by the API "
                                 "(?scope=, one-current-per-scope), e.g. 'fish'. Defaults to "
                                 "--scope when omitted (so single-clade builds stay as-is).")
        parser.add_argument("--label", default="",
                            help="Human display name for the scope, e.g. 'Birds'. Shown in the "
                                 "scope picker. Defaults to a title-cased --scope-key.")
        parser.add_argument("--pool-size", type=int, default=0,
                            help="Playable tips to keep; 0 (default) = all non-extinct "
                                 "species in scope (animalist-style 'have them all').")
        parser.add_argument("--clade-floor", type=int, default=10,
                            help="Min tips guaranteed per major clade (capped mode only).")
        parser.add_argument("--include-extinct", action="store_true",
                            help="Keep extinct species in the pool (tagged extinct). The "
                                 "client extinct toggle hides/shows them; asset bakes a "
                                 "separate extant-only 'N remaining' count.")
        parser.add_argument("--hidden-label-max", type=int, default=15,
                            help="Default 'N remaining' reveal threshold baked into the asset.")
        parser.add_argument("--enrich", choices=["offline", "braidworks"], default="offline",
                            help="Enrichment provider: offline stub (default) or real "
                                 "Braidworks (Wikidata names + enwiki titles).")

    def handle(self, *args, **opts) -> None:
        coldp_dir: Path = opts["coldp_dir"]
        if not coldp_dir.exists():
            raise CommandError(f"ColDP dir not found: {coldp_dir}")

        # TODO(phase-1): pass a Braidworks-backed EnrichProvider for real names;
        # the default OfflineProvider keeps this runnable without the weavers.
        self.stdout.write("1/5 ingest (ColDP)…")
        taxa = ingest.ingest_coldp(coldp_dir, scope=opts["scope"])
        self.stdout.write(f"      {len(taxa)} accepted species")

        self.stdout.write("2/5 backbone…")
        tree = backbone.build_backbone(taxa)
        self.stdout.write(f"      {len(tree.nodes)} clade nodes")

        # Virtual clade nodes for paraphyletic vague names ("fox" -> a Fox group).
        group_aliases = paraphyletic.apply_groups(tree)
        self.stdout.write(f"      {len(group_aliases)} virtual group nodes")

        # One provider instance shared across stages so a Braidworks batch (network)
        # runs once and species + clade names both read its cache.
        provider = (
            enrich.BraidworksProvider() if opts["enrich"] == "braidworks"
            else enrich.OfflineProvider()
        )

        self.stdout.write("3/5 pool select…")
        pool_taxa = pool.select_pool(
            tree, size=opts["pool_size"], clade_floor=opts["clade_floor"],
            include_extinct=opts["include_extinct"],
        )
        self.stdout.write(f"      {len(pool_taxa)} playable tips")

        self.stdout.write(f"4/5 enrich ({opts['enrich']}; species + clades)…")
        enriched = enrich.enrich(pool_taxa, provider)
        node_names = enrich.enrich_clade_nodes(tree, provider)  # "bear"->Ursidae, …
        self.stdout.write(f"      {len(node_names)} clades got common names")

        self.stdout.write("5/5 build + validate asset…")
        # Identity vs filter: --scope slices the dump; --scope-key is the stable id the API
        # serves under. Single-clade builds that pass neither key nor label still work
        # (key falls back to the filter string, label to a title-cased key).
        scope_key = opts["scope_key"] or opts["scope"]
        label = opts["label"] or scope_key.replace("_", " ").title()
        doc = asset_builder.build_asset(
            tree,
            enriched,
            node_names=node_names,
            group_aliases=group_aliases,
            hidden_label_max=opts["hidden_label_max"],
            scope=scope_key,
            label=label,
        )
        validate.validate_asset(doc)
        asset_builder.write_asset(doc, opts["out"])

        self.stdout.write(self.style.SUCCESS(f"Wrote {opts['out']} (pool_size={doc['pool_size']})"))
