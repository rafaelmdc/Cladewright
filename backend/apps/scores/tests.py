"""Tests for server-authoritative re-scoring + the score endpoints."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip

from .models import GameMode, NamedSpecies, PlayerStat, Run
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

    def test_player_stats_and_unique_species(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        post = lambda tr: self.client.post(  # noqa: E731
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "asset_version": 1, "transcript": tr},
            format="json",
        )
        post(["tip:1", "tip:2", "tip:3"])  # 3 species
        post(["tip:1", "tip:2"])           # 2 species, both already known

        stat = PlayerStat.objects.get(user=user, mode="marathon_free")
        self.assertEqual(stat.games_played, 2)
        self.assertEqual(stat.total_named, 5)   # 3 + 2 (repeats across sessions count)
        self.assertEqual(stat.unique_named, 3)  # tip:1/2/3 distinct
        self.assertEqual(NamedSpecies.objects.filter(user=user).count(), 3)

    def test_account_stats_endpoint(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "asset_version": 1,
             "transcript": ["tip:1", "tip:2"]},
            format="json",
        )
        res = self.client.get("/api/auth/stats/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["totals"], {"games_played": 1, "total_named": 2, "unique_named": 2})
        self.assertEqual(res.data["modes"][0]["mode"], "marathon_free")
        self.assertEqual(len(res.data["recent_runs"]), 1)

    def test_delete_account_cascades(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "asset_version": 1, "transcript": ["tip:1"]},
            format="json",
        )
        res = self.client.delete("/api/auth/account/")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(User.objects.filter(username="alice").exists())
        self.assertEqual(Run.objects.count(), 0)          # cascaded
        self.assertEqual(NamedSpecies.objects.count(), 0)  # cascaded

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

    def test_leaderboards_split_by_difficulty(self):
        a = User.objects.create_user("alice", password="x")
        Run.objects.create(user=a, mode=GameMode.MARATHON_FREE, scope="test", difficulty="common", score=5, asset_version=1)
        Run.objects.create(user=a, mode=GameMode.MARATHON_FREE, scope="test", difficulty="scientific", score=9, asset_version=1)
        common = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test&difficulty=common")
        sci = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test&difficulty=scientific")
        self.assertEqual([e["score"] for e in common.data["entries"]], [5])
        self.assertEqual([e["score"] for e in sci.data["entries"]], [9])

    def test_submit_records_difficulty(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "difficulty": "scientific",
             "asset_version": 1, "transcript": ["tip:1"]},
            format="json",
        )
        self.assertEqual(Run.objects.get(user=user).difficulty, "scientific")

    def test_games_endpoint_lists_only_enabled(self):
        # Seed migration enables marathon_free and disables the rest.
        res = self.client.get("/api/scores/games/")
        self.assertEqual(res.status_code, 200)
        modes = [g["mode"] for g in res.data["games"]]
        self.assertEqual(modes, ["marathon_free"])
        self.assertNotIn("classic", modes)

    def test_submit_to_disabled_mode_rejected(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        res = self.client.post(
            "/api/scores/runs/",
            {"mode": "classic", "scope": "test", "asset_version": 1,
             "transcript": ["tip:1"]},  # classic is seeded disabled
            format="json",
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"], "mode not enabled")
        self.assertFalse(Run.objects.filter(user=user).exists())
