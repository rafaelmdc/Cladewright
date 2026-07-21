"""Tests for the pipeline dump inventory (#116/#117)."""
from __future__ import annotations

import os
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase

from apps.gamedata.tasks import _discover_dumps, _dumps_root


class DiscoverDumpsTests(SimpleTestCase):
    def _make_tree(self, root: Path) -> None:
        # A CoL ColDP dump dir at the data root.
        (root / "coldp_col").mkdir(parents=True)
        (root / "coldp_col" / "NameUsage.tsv").write_text("x")
        # The pageview DB, nested in braidworks' per-weaver namespace dir the way
        # default_db_path() lays it out (<data>/braidworks/wikipedia/<file>).
        db = root / "braidworks" / "wikipedia" / "wikipedia_pageviews.sqlite"
        db.parent.mkdir(parents=True)
        db.write_text("db")
        # A half-built DB inside a tempfile.TemporaryDirectory the build creates alongside it.
        tmp = root / "braidworks" / "wikipedia" / "tmpABCD1234"
        tmp.mkdir()
        (tmp / "wikipedia_pageviews.sqlite").write_text("partial")

    def test_finds_nested_pageview_db_and_skips_build_tempdir(self):
        import tempfile

        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            self._make_tree(root)
            found = _discover_dumps(root)

        kinds = {kind: path for kind, path, _size in found}
        # The real DB (nested under wikipedia/) is inventoried...
        pv = [p for k, p, _s in found if k == "pageviews"]
        self.assertEqual(len(pv), 1, f"expected exactly one pageview DB, got {pv}")
        self.assertEqual(pv[0].name, "wikipedia_pageviews.sqlite")
        self.assertNotIn("tmpABCD1234", pv[0].parts, "build tempdir must be skipped")
        # ...and the CoL dump dir is still discovered.
        self.assertIn("coldp", kinds)

    def test_dumps_root_is_parent_of_braidworks_data_dir(self):
        with mock.patch.dict(os.environ, {"BRAIDWORKS_DATA_DIR": "/app/data/braidworks"}):
            self.assertEqual(_dumps_root(), Path("/app/data"))


# ── asset backfill (#145/#146 follow-up) ───────────────────────────────────────────────────

from io import StringIO  # noqa: E402

from django.core.management import CommandError, call_command  # noqa: E402
from django.test import TestCase  # noqa: E402

from apps.gamedata.models import AssetVersion, TaxonTip  # noqa: E402
from pipeline.backfill import HasImageBackfill, backfill_blob, default_backfillers  # noqa: E402


class _FakeImages:
    """Stands in for the Wikipedia harvester: `known` have a picture, `missing` genuinely
    don't, and anything else stays UNRESOLVED (the lookup failed)."""

    def __init__(self, known=(), missing=()):
        self.known, self.missing = set(known), set(missing)
        self.asked: list[str] = []

    def harvest_images(self, names):
        self.asked.extend(names)

    def has_image(self, name):
        if name in self.known:
            return True
        if name in self.missing:
            return False
        return None


def _blob(tips):
    return {"version": 1, "scope": "test", "nodes": [], "tips": tips, "aliases": {}}


class BackfillBlobTests(SimpleTestCase):
    def test_fills_only_what_is_missing(self):
        blob = _blob([
            {"id": "a", "sci": "Vulpes vulpes", "common": "Red fox"},
            {"id": "b", "sci": "Bb bb", "common": "Bb bb", "has_common": True},  # already set
        ])
        filled = backfill_blob(blob, [default_backfillers()[0]])
        self.assertEqual(filled, {"has_common": 1})
        self.assertIs(blob["tips"][0]["has_common"], True)
        # An existing value is left ALONE, even a wrong-looking one — a backfill fills gaps.
        self.assertIs(blob["tips"][1]["has_common"], True)

    def test_force_recomputes_existing_values(self):
        """For a backfiller whose RULE changed — e.g. has_common learning about other scripts."""
        blob = _blob([{"id": "b", "sci": "Bb bb", "common": "Bb bb", "has_common": True}])
        filled = backfill_blob(blob, [default_backfillers()[0]], force=True)
        self.assertEqual(filled, {"has_common": 1})
        self.assertIs(blob["tips"][0]["has_common"], False)  # common == sci → not a vernacular

    def test_nothing_missing_reports_nothing(self):
        blob = _blob([{"id": "a", "sci": "A a", "common": "Ay", "has_common": True}])
        self.assertEqual(backfill_blob(blob, [default_backfillers()[0]]), {})

    def test_unresolved_images_leave_the_field_absent(self):
        """The load-bearing distinction: absent means "ask at draw time", False means "never
        draw this". Writing False for a failed lookup would silently shrink the pack."""
        blob = _blob([
            {"id": "a", "sci": "Panthera leo"},
            {"id": "b", "sci": "Nemo nemo"},
            {"id": "c", "sci": "Unresolved unresolved"},
        ])
        bf = HasImageBackfill(provider=_FakeImages(known=["Panthera leo"], missing=["Nemo nemo"]))
        backfill_blob(blob, [bf])
        self.assertIs(blob["tips"][0]["has_image"], True)
        self.assertIs(blob["tips"][1]["has_image"], False)
        self.assertNotIn("has_image", blob["tips"][2])


class BackfillCommandTests(TestCase):
    def setUp(self):
        self.asset = AssetVersion.objects.create(
            scope="test", version=1, is_current=True,
            blob=_blob([
                {"id": "tip:a", "sci": "Vulpes vulpes", "common": "Red fox",
                 "parent": "n", "lineage": ["n"], "traits": {}},
                {"id": "tip:b", "sci": "Bb bb", "common": "Bb bb",
                 "parent": "n", "lineage": ["n"], "traits": {}},
            ]),
        )
        TaxonTip.objects.create(asset=self.asset, key="tip:a", sci="Vulpes vulpes",
                                common="Red fox", parent_key="n", lineage=["n"])

    def _run(self, *args):
        out = StringIO()
        call_command("backfill_asset", "--scope", "test", "--only", "has_common", *args, stdout=out)
        self.asset.refresh_from_db()
        return out.getvalue()

    def test_fills_bumps_the_version_and_records_provenance(self):
        self._run()
        self.assertEqual(self.asset.version, 2)
        self.assertEqual(self.asset.blob["version"], 2)  # the blob carries it too
        self.assertIs(self.asset.blob["tips"][0]["has_common"], True)
        self.assertIs(self.asset.blob["tips"][1]["has_common"], False)
        entry = self.asset.provenance["backfills"][-1]
        self.assertEqual(entry["filled"], {"has_common": 2})

    def test_leaves_the_relational_mirror_alone(self):
        """The whole reason this is minutes not hours: a backfill adds derived fields only,
        so the node/tip/alias mirror is still correct and is not rebuilt."""
        self._run()
        self.assertEqual(TaxonTip.objects.filter(asset=self.asset).count(), 1)
        self.assertEqual(TaxonTip.objects.get(key="tip:a").common, "Red fox")

    def test_rerun_is_a_no_op(self):
        self._run()
        out = self._run()
        self.assertIn("nothing missing", out)
        self.assertEqual(self.asset.version, 2)  # no second bump

    def test_dry_run_writes_nothing(self):
        out = self._run("--dry-run")
        self.assertIn("DRY RUN", out)
        self.assertEqual(self.asset.version, 1)
        self.assertNotIn("has_common", self.asset.blob["tips"][0])

    def test_unknown_backfiller_is_rejected(self):
        with self.assertRaises(CommandError) as ctx:
            call_command("backfill_asset", "--scope", "test", "--only", "nope", stdout=StringIO())
        self.assertIn("has_common", str(ctx.exception))  # tells you what IS available

    def test_requires_a_target(self):
        with self.assertRaises(CommandError):
            call_command("backfill_asset", stdout=StringIO())

    def test_skips_scopes_with_no_current_blob(self):
        AssetVersion.objects.filter(scope="test").update(is_current=False)
        with self.assertRaises(CommandError):
            call_command("backfill_asset", "--scope", "test", stdout=StringIO())
