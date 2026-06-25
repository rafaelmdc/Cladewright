"""Tests for server-authoritative re-scoring + the score endpoints."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip

from .models import GameMode, NamedSpeciesSet, PlayerStat, Run, SpeciesToken
from .named_set import named_keys
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

    def test_combo_bonus_from_timings(self):
        # Three placements within the window → combo 1,2,3 → bonus 0+1+2 on top of base 3.
        r = rescore(
            ["tip:1", "tip:2", "tip:3"], self.tips, self.nodes,
            timings=[0, 1000, 2000], combo_window_seconds=6, combo_multiplier=1.0,
        )
        self.assertEqual((r.base, r.combo_bonus, r.score), (3, 3, 6))

    def test_combo_breaks_outside_window(self):
        # A gap longer than the window resets the combo, so no placement reaches ×2.
        r = rescore(
            ["tip:1", "tip:2"], self.tips, self.nodes,
            timings=[0, 99000], combo_window_seconds=6, combo_multiplier=1.0,
        )
        self.assertEqual((r.combo_bonus, r.score), (0, 2))

    def test_combo_ignored_without_timings(self):
        r = rescore(["tip:1", "tip:2"], self.tips, self.nodes, combo_multiplier=1.0)
        self.assertEqual((r.combo_bonus, r.score), (0, 2))

    def test_clade_completion_bonus(self):
        # Naming both species under gen:G (size 2) completes it → sqrt-scaled bonus once.
        pools = {"gen:G": 2, "gen:H": 1, "kng:A": 3}
        r = rescore(
            ["tip:1", "tip:2"], self.tips, self.nodes,
            node_pool_counts=pools, clade_multiplier=2.0, clade_min_size=2,
        )
        self.assertEqual((r.base, r.clade_bonus, r.score), (2, round(2 * 2**0.5), 5))

    def test_clade_bonus_respects_min_size(self):
        # gen:H has one species; with min size 2 a single-species clade earns nothing.
        pools = {"gen:H": 1, "kng:A": 3}
        r = rescore(
            ["tip:3"], self.tips, self.nodes,
            node_pool_counts=pools, clade_multiplier=2.0, clade_min_size=2,
        )
        self.assertEqual((r.clade_bonus, r.score), (0, 1))


class RunSessionTests(TestCase):
    """The signed run token (anti-forge plumbing for combo scoring)."""

    def test_roundtrip_valid(self):
        from .sessions import issue_run_token, verify_run_token
        tok = issue_run_token(42)
        payload = verify_run_token(tok, 42)
        self.assertEqual(payload["u"], 42)

    def test_rejects_other_user(self):
        from .sessions import issue_run_token, verify_run_token
        self.assertIsNone(verify_run_token(issue_run_token(1), 2))

    def test_rejects_tampered_and_missing(self):
        from .sessions import issue_run_token, verify_run_token
        self.assertIsNone(verify_run_token(None, 1))
        self.assertIsNone(verify_run_token(issue_run_token(1) + "x", 1))


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

    def test_ranked_run_without_session_is_downgraded(self):
        # A ranked submit with no signed session token still records (stats) but is dropped
        # to unranked, so a hand-crafted POST can't reach the board (#77).
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        res = self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "transcript": ["tip:1", "tip:2"]},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertFalse(res.data["ranked"])
        self.assertFalse(Run.objects.get(user=user).ranked)

    def test_rate_plausibility_bound(self):
        # The placement-rate guard rejects more placements than humanly possible in the real
        # elapsed wall-clock (a dump-the-whole-tree submit), and accepts a normal pace. A
        # missing session can't be measured, so it's never plausible.
        import time as _time

        from .views import MAX_PLACEMENTS_PER_SECOND, RATE_SLACK_SECONDS, _rate_plausible
        fresh = {"u": 1, "t": int(_time.time())}  # started "now": only the slack has elapsed
        budget = RATE_SLACK_SECONDS * MAX_PLACEMENTS_PER_SECOND
        self.assertTrue(_rate_plausible(fresh, budget))
        self.assertFalse(_rate_plausible(fresh, budget + 50))
        self.assertFalse(_rate_plausible(None, 1))

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

        stat = PlayerStat.objects.get(user=user, mode="marathon_free", difficulty="common")
        self.assertEqual(stat.games_played, 2)
        self.assertEqual(stat.total_named, 5)   # 3 + 2 (repeats across sessions count)
        self.assertEqual(stat.unique_named, 3)  # tip:1/2/3 distinct
        # The unique set is one roaring-bitmap row whose cardinality matches, and decodes
        # back to exactly the distinct species named (#55).
        nss = NamedSpeciesSet.objects.get(user=user, mode="marathon_free", difficulty="common")
        self.assertEqual(nss.count, 3)
        self.assertEqual(
            set(named_keys(user, "marathon_free", "common")), {"tip:1", "tip:2", "tip:3"}
        )

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
        m0 = res.data["modes"][0]
        self.assertEqual(m0["mode"], "marathon_free")
        self.assertEqual(m0["difficulty"], "common")
        self.assertEqual(m0["game"], "marathon_free|common")
        self.assertIn("·", m0["label"])  # composed "Marathon · Common"
        self.assertEqual(len(res.data["recent_runs"]), 1)

    def test_stats_split_by_difficulty(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        for diff, tr in (("common", ["tip:1", "tip:2"]), ("scientific", ["tip:1"])):
            self.client.post(
                "/api/scores/runs/",
                {"mode": "marathon_free", "scope": "test", "difficulty": diff,
                 "asset_version": 1, "transcript": tr},
                format="json",
            )
        # Two separate game rows, each with its own counts.
        games = {m["game"]: m for m in self.client.get("/api/auth/stats/").data["modes"]}
        self.assertEqual(games["marathon_free|common"]["total_named"], 2)
        self.assertEqual(games["marathon_free|scientific"]["total_named"], 1)

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
        self.assertEqual(Run.objects.count(), 0)              # cascaded
        self.assertEqual(NamedSpeciesSet.objects.count(), 0)  # cascaded
        # SpeciesToken is a shared dictionary (not user-owned) — it survives the account
        # deletion; only the user's set row is removed.
        self.assertTrue(SpeciesToken.objects.filter(species_key="tip:1").exists())

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
        games = {g["mode"]: g for g in res.data["games"]}
        self.assertIn("marathon_free", games)         # free play, a Hub card
        self.assertIn("marathon_daily", games)        # daily, flagged for the Hub strip
        self.assertTrue(games["marathon_daily"]["is_daily"])
        self.assertFalse(games["marathon_free"]["is_daily"])
        self.assertNotIn("classic", games)            # still disabled

    def test_unranked_run_counts_to_stats_but_not_leaderboard(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        res = self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test", "asset_version": 1,
             "ranked": False, "transcript": ["tip:1", "tip:2"]},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertIsNone(res.data["rank"])          # no board placement
        self.assertFalse(res.data["ranked"])
        # ...but the run + stats are recorded.
        self.assertFalse(Run.objects.get(user=user).ranked)
        self.assertEqual(
            PlayerStat.objects.get(user=user, mode="marathon_free", difficulty="common").total_named,
            2,
        )
        # ...and it does NOT show on the leaderboard.
        board = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test")
        self.assertEqual(board.data["entries"], [])

    def test_daily_one_shot_and_scope_pinned(self):
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        info = self.client.get("/api/scores/daily/").data
        self.assertTrue(info["available"])
        self.assertEqual(info["mode"], "marathon_daily")
        self.assertEqual(info["scope"], "test")  # rotation falls back to the served scope

        body = {"mode": "marathon_daily", "scope": "whatever", "asset_version": 1,
                "transcript": ["tip:1", "tip:2"]}
        first = self.client.post("/api/scores/runs/", body, format="json")
        self.assertEqual(first.status_code, 201)
        run = Run.objects.get(user=user, mode="marathon_daily")
        self.assertEqual(run.scope, "test")          # scope pinned server-side
        self.assertIsNotNone(run.puzzle_date)        # daily carries the puzzle date

        # Locked for the day — a second daily submit is rejected.
        second = self.client.post("/api/scores/runs/", body, format="json")
        self.assertEqual(second.status_code, 409)

        # The daily endpoint now reports the played result + the global streak.
        after = self.client.get("/api/scores/daily/").data
        self.assertTrue(after["played_today"])
        self.assertEqual(after["today_score"], 2)
        self.assertEqual(after["streak"]["current"], 1)

    def test_mixed_scope_submit_and_leaderboard(self):
        # A second scope that shares the deterministic backbone node "kng:A" (as real scopes
        # do) but has its own tips — exactly what client-side scope mixing merges.
        av2 = AssetVersion.objects.create(scope="test2", version=1, pool_size=1, is_current=True)
        TaxonNode.objects.create(asset=av2, key="kng:A", rank="kingdom", sci="kng:A",
                                 parent_key=None, lineage=[])
        TaxonNode.objects.create(asset=av2, key="gen:Z", rank="genus", sci="gen:Z",
                                 parent_key="kng:A", lineage=["kng:A"])
        TaxonTip.objects.create(asset=av2, key="tip:9", sci="tip:9", common="tip:9",
                                parent_key="gen:Z", lineage=["kng:A", "gen:Z"])

        from .sessions import issue_run_token
        user = User.objects.create_user("alice", password="x")
        self.client.force_authenticate(user)
        # Mix posted in non-canonical order; the run should re-score across BOTH assets
        # (tip:1 from "test", tip:9 from "test2") and store the canonical scope. A ranked run
        # needs a valid signed session token (#77), else it drops off the board.
        res = self.client.post(
            "/api/scores/runs/",
            {"mode": "marathon_free", "scope": "test2+test",
             "transcript": ["tip:1", "tip:9"], "run_token": issue_run_token(user.id)},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["score"], 2)        # both tips placed across the mix
        self.assertEqual(res.data["unknown"], 0)      # tip:9 is NOT unknown — found in test2
        run = Run.objects.get(user=user)
        self.assertEqual(run.scope, "test+test2")     # canonical (sorted)

        # The board is reachable regardless of the order the client lists the clades.
        board = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test2+test")
        self.assertEqual(board.status_code, 200)
        self.assertEqual([e["score"] for e in board.data["entries"]], [2])

    def test_daily_runs_feed_global_free_board(self):
        # A daily run on "test" must appear on the all-time global (marathon_free) board for
        # that scope, alongside free runs — so daily-only players still rank globally (#46).
        a = User.objects.create_user("alice", password="x")  # daily-only player
        b = User.objects.create_user("bob", password="x")     # free-play player
        Run.objects.create(user=a, mode=GameMode.MARATHON_DAILY, scope="test", difficulty="common",
                            score=12, asset_version=1, puzzle_date=__import__("datetime").date(2026, 6, 1))
        Run.objects.create(user=b, mode=GameMode.MARATHON_FREE, scope="test", difficulty="common",
                            score=7, asset_version=1)
        res = self.client.get("/api/scores/leaderboard/?mode=marathon_free&scope=test&difficulty=common")
        self.assertEqual(res.status_code, 200)
        # Alice's daily (12) outranks Bob's free run (7) on the SAME global board.
        self.assertEqual([(e["user"], e["score"]) for e in res.data["entries"]],
                         [("alice", 12), ("bob", 7)])

    def test_daily_board_excludes_free_runs(self):
        # The daily board itself stays date-indexed + daily-only (the union is one-way).
        import datetime as _dt
        a = User.objects.create_user("alice", password="x")
        Run.objects.create(user=a, mode=GameMode.MARATHON_FREE, scope="test", difficulty="common",
                            score=99, asset_version=1)  # a free run must NOT leak onto the daily board
        board = self.client.get("/api/scores/leaderboard/?mode=marathon_daily"
                                f"&date={_dt.date.today().isoformat()}")
        self.assertEqual(board.status_code, 200)
        self.assertEqual(board.data["entries"], [])

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


class NamedSetTests(TestCase):
    """The compact roaring-bitmap unique-named-species store (#55)."""

    def setUp(self):
        from .named_set import add_named, intern_tokens, named_count

        self.add_named = add_named
        self.intern_tokens = intern_tokens
        self.named_count = named_count
        self.user = User.objects.create_user("alice", password="x")

    def test_union_accumulates_and_dedups(self):
        # Two runs union into one set; a species named twice counts once.
        self.assertEqual(self.add_named(self.user, "marathon_free", "common", ["tip:1", "tip:2"]), 2)
        self.assertEqual(
            self.add_named(self.user, "marathon_free", "common", ["tip:2", "tip:3"]), 3
        )
        self.assertEqual(self.named_count(self.user, "marathon_free", "common"), 3)
        self.assertEqual(
            set(named_keys(self.user, "marathon_free", "common")), {"tip:1", "tip:2", "tip:3"}
        )
        # One row holds the whole set — not one per species.
        self.assertEqual(
            NamedSpeciesSet.objects.filter(user=self.user, mode="marathon_free").count(), 1
        )

    def test_difficulty_sets_are_independent(self):
        self.add_named(self.user, "marathon_free", "common", ["tip:1", "tip:2"])
        self.add_named(self.user, "marathon_free", "scientific", ["tip:1"])
        self.assertEqual(self.named_count(self.user, "marathon_free", "common"), 2)
        self.assertEqual(self.named_count(self.user, "marathon_free", "scientific"), 1)

    def test_tokens_are_shared_across_users(self):
        # The same species_key interns to the SAME token for every user — the dictionary is
        # global, so a million-species scope is stored once, not per player.
        bob = User.objects.create_user("bob", password="x")
        self.add_named(self.user, "marathon_free", "common", ["tip:1", "tip:9"])
        self.add_named(bob, "marathon_free", "common", ["tip:9", "tip:5"])
        self.assertEqual(SpeciesToken.objects.filter(species_key="tip:9").count(), 1)
        self.assertEqual(self.intern_tokens(["tip:9"]), self.intern_tokens(["tip:9"]))

    def test_large_set_is_compact(self):
        # 5,000 species fit in a few KB blob — the whole point vs 5,000 rows.
        keys = [f"tip:{i}" for i in range(5000)]
        self.assertEqual(self.add_named(self.user, "marathon_free", "common", keys), 5000)
        row = NamedSpeciesSet.objects.get(user=self.user, mode="marathon_free", difficulty="common")
        self.assertLess(len(bytes(row.bitmap)), 12_000)  # ~few KB, far under 5000 string rows
        self.assertEqual(len(named_keys(self.user, "marathon_free", "common")), 5000)

    def test_blank_and_unknown_keys_ignored(self):
        # Empty strings/blanks contribute nothing and don't create tokens.
        self.assertEqual(self.add_named(self.user, "marathon_free", "common", ["", "tip:1", ""]), 1)
        self.assertFalse(SpeciesToken.objects.filter(species_key="").exists())
