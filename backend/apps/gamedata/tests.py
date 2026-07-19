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
