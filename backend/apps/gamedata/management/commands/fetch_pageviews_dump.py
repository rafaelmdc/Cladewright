"""Download + build the monthly Wikipedia pageview DB ONCE, to the shared braidworks data
dir (the worker's PVC when ``BRAIDWORKS_DATA_DIR`` points there), so every fame build reuses
it instead of hitting the per-title pageviews REST api.

The REST api is one HTTP request per article — fine for a few-thousand-species scope, but
impossible for a million-species one (Arthropoda). The local DB turns fame into an O(1) local
lookup, so a huge build does ~N/200 batched Wikidata title queries + N local pageview reads,
not N web calls. Run via the admin "Download pageview dump" pipeline job; subsequent builds
auto-detect the DB (see pipeline/enrich.py) and use it with no extra config.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Download + build the monthly Wikipedia pageview DB (fame at scale; one-time)."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--year", type=int, required=True, help="Dump year, e.g. 2026.")
        parser.add_argument("--month", type=int, required=True, help="Dump month 1–12.")
        parser.add_argument(
            "--dump", default="",
            help="Optional already-downloaded pageviews-YYYYMM-user.bz2 on disk; "
                 "otherwise the monthly dump is streamed from Wikimedia.",
        )
        parser.add_argument(
            "--refresh", action="store_true",
            help="Rebuild even if a valid DB already exists.",
        )

    def handle(self, *args, **opts) -> None:
        year, month = opts["year"], opts["month"]
        if not (1 <= month <= 12):
            raise CommandError("--month must be 1–12")

        try:
            from wikipedia_weaver.setup import (
                db_is_valid,
                default_db_path,
                ensure_pageviews_db,
            )
        except ImportError as exc:  # pragma: no cover - pipeline image only
            raise CommandError(
                "wikipedia_weaver is not installed — this runs on the pipeline worker image "
                "(requirements-pipeline.txt), not the web image."
            ) from exc

        target = default_db_path()
        if db_is_valid(target) and not opts["refresh"]:
            self.stdout.write(
                f"pageview DB already present + valid at {target} — reusing "
                "(pass --refresh to rebuild)."
            )
            return

        self.stdout.write(f"building pageview DB for {year}-{month:02d} → {target}")
        self.stdout.write(
            "  one-time: streams a ~3 GB monthly dump and builds a ~0.4 GB enwiki SQLite — "
            "this takes minutes, not seconds."
        )
        path = ensure_pageviews_db(
            None,  # → default_db_path(); honours BRAIDWORKS_DATA_DIR (point it at the PVC)
            year=year,
            month=month,
            dump_path=opts["dump"] or None,
            auto=True,  # consent to auto-download when no --dump is given
            refresh=opts["refresh"],
        )

        import sqlite3

        with sqlite3.connect(path) as con:
            rows = con.execute("SELECT COUNT(*) FROM pageviews").fetchone()[0]
        self.stdout.write(self.style.SUCCESS(
            f"pageview DB ready: {rows:,} article titles at {path}. "
            "Future fame builds will reuse it automatically."
        ))
