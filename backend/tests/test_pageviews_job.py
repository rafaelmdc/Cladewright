"""The 'Download pageview dump' pipeline job (#fame-at-scale): one job builds the local
Wikipedia pageview DB once, then every fame build reuses it instead of the per-title REST
api. These tests cover the wiring that runs in the web/test image (no braidworks installed);
the actual download/build is exercised on the pipeline worker.
"""
from __future__ import annotations

from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from apps.gamedata import tasks
from apps.gamedata.models import PipelineJob


class FetchPageviewsCommandTests(TestCase):
    def test_bad_month_rejected_before_any_braidworks_import(self):
        with self.assertRaises(CommandError) as ctx:
            call_command("fetch_pageviews_dump", "--year", "2026", "--month", "13")
        self.assertIn("month", str(ctx.exception))

    def test_missing_braidworks_gives_a_clear_error(self):
        # In the web/test image wikipedia_weaver isn't installed; a valid month gets past
        # arg-validation and reports the pipeline-image-only requirement (not a raw ImportError).
        with self.assertRaises(CommandError) as ctx:
            call_command("fetch_pageviews_dump", "--year", "2026", "--month", "6")
        self.assertIn("wikipedia_weaver", str(ctx.exception))


class FetchPageviewsDispatchTests(TestCase):
    def _job(self, **kw):
        return PipelineJob.objects.create(kind=PipelineJob.Kind.FETCH_PAGEVIEWS, **kw)

    def test_requires_year_and_month(self):
        job = self._job(fame_year=0, fame_month=0)
        with self.assertRaises(ValueError):
            tasks._run_fetch_pageviews(job, mock.Mock(), lambda _l: None)

    def test_dispatches_to_command_with_month_and_optional_dump(self):
        job = self._job(fame_year=2026, fame_month=6, fame_dump="data/pageviews-202606-user.bz2")
        # call_command is imported lazily inside the helper, so patch it at its source module.
        with mock.patch("django.core.management.call_command") as cc:
            tasks._run_fetch_pageviews(job, mock.Mock(), lambda _l: None)
        args = cc.call_args.args
        self.assertEqual(args[0], "fetch_pageviews_dump")
        self.assertIn("--year", args)
        self.assertIn("2026", args)
        self.assertIn("--dump", args)
