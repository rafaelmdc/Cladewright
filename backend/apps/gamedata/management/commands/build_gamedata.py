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
        parser.add_argument("--asset-version", type=int, default=1,
                            help="Version number baked into the asset (load_gamedata stores it "
                                 "as the AssetVersion.version). The pipeline worker passes the "
                                 "next free version per scope; single-clade builds default to 1. "
                                 "(Not --version: that collides with Django's own flag.)")
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
        parser.add_argument("--fame-dump", default="",
                            help="Path to a Wikimedia monthly pageview_complete dump "
                                 "(pageviews-YYYYMM-user.bz2). When set, fame uses the local "
                                 "dump backend (scales to huge scopes); otherwise the keyless "
                                 "pageviews REST api (fine for the current few-thousand-tip scopes).")
        parser.add_argument("--fame-year", type=int, default=0,
                            help="Dump year (with --fame-month), if not inferable from --fame-dump.")
        parser.add_argument("--fame-month", type=int, default=0,
                            help="Dump month 1-12 (with --fame-year).")
        parser.add_argument("--notable-max", type=int, default=0,
                            help="Hard ceiling on tips shipped in the client blob; 0 (default) = "
                                 "ship the WHOLE pool (no remote tail). Above it the scope is served "
                                 "hybrid: notable blob + complete coarse backbone + the rest via "
                                 "/search + /resolve. The full pool always lands in the DB.")
        parser.add_argument("--notable-coverage", type=float, default=0.9,
                            help="Target fraction of total fame (≈pageview) mass the blob should "
                                 "cover; guesses track popularity, so this ≈ fraction served "
                                 "locally. Clamped to [--notable-min, --notable-max].")
        parser.add_argument("--notable-min", type=int, default=5000,
                            help="Floor on tips shipped, so a popularity-concentrated scope still "
                                 "ships a meaty offline pool.")
        parser.add_argument("--frontier-rank", default="family",
                            help="Coarse-backbone cut always shipped in the blob (and the deepest "
                                 "rank /resolve trims to), e.g. 'family'. Guarantees every tail "
                                 "species has a present anchor.")

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

        # Live progress for the long network harvests (names + fame), so the admin job log
        # ticks up instead of going silent for minutes. The provider chunks to ~20 ticks.
        def harvest_progress(phase: str, done: int, total: int) -> None:
            pct = round(100 * done / total) if total else 100
            self.stdout.write(f"      {phase}: {done:,}/{total:,} ({pct}%)")

        # One provider instance shared across stages so a Braidworks batch (network)
        # runs once and species + clade names both read its cache.
        provider = (
            enrich.BraidworksProvider(
                fame_dump_path=opts["fame_dump"] or None,
                fame_year=opts["fame_year"] or None,
                fame_month=opts["fame_month"] or None,
                progress=harvest_progress,
            )
            if opts["enrich"] == "braidworks"
            else enrich.OfflineProvider()
        )
        # Surface where fame (popularity) comes from, so the admin log shows at a glance
        # whether this build will rank by real pageviews or fall back to nothing.
        if opts["enrich"] != "braidworks":
            self.stdout.write("      fame: disabled (offline enrich — every tip scores 0)")
        elif opts["fame_dump"] or (opts["fame_year"] and opts["fame_month"]):
            self.stdout.write("      fame source: pageview dump → local DB (built once, then reused)")
        else:
            source = ("Wikipedia pageviews REST api — per-title, slow; run a 'Download pageview "
                      "dump' job once for scale")
            try:
                from wikipedia_weaver.setup import db_is_valid, default_db_path

                cand = default_db_path()
                if db_is_valid(cand):
                    source = f"prebuilt pageview DB {cand} (local, fast)"
            except Exception:  # noqa: BLE001 - braidworks absent → REST description stands
                pass
            self.stdout.write(f"      fame source: {source}")

        self.stdout.write("3/5 pool select…")
        pool_taxa = pool.select_pool(
            tree, size=opts["pool_size"], clade_floor=opts["clade_floor"],
            include_extinct=opts["include_extinct"],
        )
        self.stdout.write(f"      {len(pool_taxa)} playable tips")

        self.stdout.write(f"4/5 enrich ({opts['enrich']}; species + clades)…")
        enriched = enrich.enrich(pool_taxa, provider)
        # Fame coverage: how many tips actually got a popularity score (and the top one), so
        # the log proves fame landed — a 0% here means the fame source returned nothing.
        if enriched:
            scored = sum(1 for e in enriched if e.fame > 0)
            pct = round(100 * scored / len(enriched))
            top = max(enriched, key=lambda e: e.fame)
            tail = f"top {top.fame:,} ({top.common})" if top.fame else "NO fame harvested"
            self.stdout.write(
                f"      fame: {scored:,}/{len(enriched):,} tips scored ({pct}%) — {tail}"
            )
        node_names = enrich.enrich_clade_nodes(tree, provider)  # "bear"->Ursidae, …
        self.stdout.write(f"      {len(node_names)} clades got common names")

        # The provider's harvest caches (name/title/pageview/sitelink dicts, up to ~1.2M
        # entries EACH on a huge scope) are done being read — everything they fed is now in
        # `enriched` + `node_names`. Drop them before stage 5 so the asset build + validate +
        # write don't run on top of that resident floor (it stacked into the OOM headroom).
        del provider
        import gc
        gc.collect()

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
            version=opts["asset_version"],
            notable_coverage=opts["notable_coverage"],
            notable_min=opts["notable_min"],
            notable_max=opts["notable_max"],
            frontier_rank=opts["frontier_rank"],
        )
        validate.validate_asset(doc)
        asset_builder.write_asset(doc, opts["out"])

        self.stdout.write(self.style.SUCCESS(f"Wrote {opts['out']} (pool_size={doc['pool_size']})"))
