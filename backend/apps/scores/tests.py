"""Tests for server-authoritative re-scoring + the score endpoints."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip

from .models import GameMode, Run
from .scoring import rescore

User = get_user_model()


class RescoreTests(TestCase):
    """The pure classifier (no DB)."""

    tips = {
        "tip:1": ["kng:A", "gen:G"],
        "tip:2": ["kng:A", "gen:G"],
        "tip:3": ["kng:A", "gen:H"],
    }
    nodes = {"kng:A": [], "gen:G": ["kng:A"], "gen:H": ["kng:A"]}

    def test_new_and_duplicate(self):
        r = rescore(["tip:1", "tip:2", "tip:1"], self.tips, self.nodes)
        self.assertEqual((r.score, r.new, r.refinements, r.duplicates), (2, 2, 0, 1))

    def test_named_clade_then_tip_is_refinement(self):
        r = rescore(["gen:G", "tip:1"], self.tips, self.nodes)
        self.assertEqual((r.new, r.refinements, r.score), (1, 1, 2))

    def test_clade_already_implied_is_duplicate(self):
        # A tip places its lineage; naming the ancestor clade afterwards pays nothing.
        r = rescore(["tip:1", "gen:G"], self.tips, self.nodes)
        self.assertEqual((r.new, r.duplicates), (1, 1))

    def test_unknown_ids_ignored(self):
        r = rescore(["tip:1", "tip:bogus", "nope"], self.tips, self.nodes)
        self.assertEqual((r.score, r.unknown), (1, 2))


class SubmitAndLeaderboardTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.av = AssetVersion.objects.create(
            scope="test", version=1, pool_size=3, is_current=True
        )
        for key, lineage in {"kng:A": [], "gen:G": ["kng:A"], "gen:H": ["kng:A"]}.items():
            TaxonNode.objects.create(asset=self.av, key=key, rank="genus", sci=key,
                                     parent_key=lineage[-1] if lineage else None,
                                     lineage=lineage)
        for key, lineage in {
            "tip:1": ["kng:A", "gen:G"],
            "tip:2": ["kng:A", "gen:G"],
            "tip:3": ["kng:A", "gen:H"],
        }.items():
            TaxonTip.objects.create(asset=self.av, key=key, sci=key, common=key,
                                    parent_key=lineage[-1], lineage=lineage)

    def test_submit_requires_auth(self):
        res = self.client.post("/api/scores/runs/", {"mode": "marathon_free", "scope": "test",
                                                     "transcript": ["tip:1"]}, format="json")
        self.assertIn(res.status_code, (401, 403))

    def test_submit_rescore_ignores_posted_score(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        res = self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "asset_version": 1,
             "score": 9999,  # must be ignored
             "transcript": ["tip:1", "tip:2", "tip:3", "tip:1"]},  # 3 new, 1 dup
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["score"], 3)
        self.assertEqual(res.data["duplicates"], 1)
        run = Run.objects.get(user=user)
        self.assertEqual(run.score, 3)  # canonical, not 9999
        self.assertEqual(run.scope, "test")

    def test_leaderboard_best_per_user_ordered(self):
        a = User.objects.create_user("alice", password="x")
        b = User.objects.create_user("bob", password="x")
        Run.objects.create(user=a, mode=GameMode.MARATHON_FREE, scope="test", score=5, asset_version=1)
        Run.objects.create(user=a, mode=GameMode.MARATHON_FREE, scope="test", score=8, asset_version=1)
        Run.objects.create(user=b, mode=GameMode.MARATHON_FREE, scope="test", score=6, asset_version=1)
        res = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test")
        self.assertEqual(res.status_code, 200)
        entries = res.data["entries"]
        self.assertEqual([(e["user"], e["score"], e["rank"]) for e in entries],
                         [("alice", 8, 1), ("bob", 6, 2)])  # alice's best (8) only, once
