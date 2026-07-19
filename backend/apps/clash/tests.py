"""Clade Clash tests (#36 Phase 1). This module holds the ASGI/Channels smoke test; the
domain (distance, referee, matchmaking) gets its own tests as each lands."""
from __future__ import annotations

import random

from channels.testing import WebsocketCommunicator
from django.test import SimpleTestCase

from cladewright.asgi import application
from .distance import (
    DEFAULT_ENGINE,
    RANK_DEPTH_ENGINE,
    ClashPool,
    make_round,
    relatedness,
)


class HealthConsumerTests(SimpleTestCase):
    """The whole ASGI stack accepts a ws connection and round-trips JSON — proves origin
    validation, routing, connect, and receive are wired. The health consumer holds no state
    and touches no DB / channel layer, so this needs neither Redis nor a database."""

    async def test_connect_and_echo(self):
        # A browser always sends Origin; supply a valid one (in ALLOWED_HOSTS) so the CSWSH
        # validator lets the handshake through.
        communicator = WebsocketCommunicator(
            application,
            "/ws/clash/health/",
            headers=[(b"origin", b"http://localhost")],
        )
        connected, _ = await communicator.connect()
        self.assertTrue(connected)

        ready = await communicator.receive_json_from()
        self.assertEqual(ready, {"type": "ready"})

        await communicator.send_json_to({"hello": "world"})
        echo = await communicator.receive_json_from()
        self.assertEqual(echo, {"type": "echo", "payload": {"hello": "world"}})

        await communicator.disconnect()

    async def test_rejects_bad_origin(self):
        """A ws handshake with a foreign Origin is refused by AllowedHostsOriginValidator
        (CSWSH gate) before the consumer ever accepts."""
        communicator = WebsocketCommunicator(
            application,
            "/ws/clash/health/",
            headers=[(b"origin", b"http://evil.example")],
        )
        connected, _ = await communicator.connect()
        self.assertFalse(connected)
        await communicator.disconnect()


# A small synthetic taxonomy (8 tips) exercising every relatedness tier. Lineages are
# root->parent ancestor node ids (excluding the tip), mirroring the asset blob.
#   kingdom K
#     order O1
#       family F1: genus G1 (t1,t2,t3), genus G2 (t4)
#       family F2: genus G3 (t5,t6)
#     order O2
#       family F3: genus G4 (t7,t8)
_LINEAGE = {
    "t1": ("K", "O1", "F1", "G1"),
    "t2": ("K", "O1", "F1", "G1"),
    "t3": ("K", "O1", "F1", "G1"),
    "t4": ("K", "O1", "F1", "G2"),
    "t5": ("K", "O1", "F2", "G3"),
    "t6": ("K", "O1", "F2", "G3"),
    "t7": ("K", "O2", "F3", "G4"),
    "t8": ("K", "O2", "F3", "G4"),
}
_RANK = {"K": "kingdom", "O1": "order", "O2": "order", "F1": "family", "F2": "family",
         "F3": "family", "G1": "genus", "G2": "genus", "G3": "genus", "G4": "genus"}


def _fixture_blob() -> dict:
    """The taxonomy above shaped like an AssetVersion.blob (tips + nodes)."""
    nodes = [{"id": nid, "rank": rank} for nid, rank in _RANK.items()]
    tips = [
        {"id": tid, "common": tid.upper(), "sci": f"Genus {tid}", "lineage": list(lin)}
        for tid, lin in _LINEAGE.items()
    ]
    return {"tips": tips, "nodes": nodes}


class RelatednessTests(SimpleTestCase):
    def test_shared_genus_is_closest(self):
        r = relatedness(_LINEAGE["t1"], _LINEAGE["t2"], _RANK)
        self.assertEqual(r.shared_depth, 4)
        self.assertEqual(r.mrca_rank, "genus")
        self.assertEqual(r.mrca_id, "G1")
        self.assertEqual(r.nodal, 2)  # 4 + 4 - 2*4 + 2

    def test_family_then_order_then_kingdom(self):
        self.assertEqual(relatedness(_LINEAGE["t1"], _LINEAGE["t4"], _RANK).mrca_rank, "family")
        self.assertEqual(relatedness(_LINEAGE["t1"], _LINEAGE["t5"], _RANK).mrca_rank, "order")
        self.assertEqual(relatedness(_LINEAGE["t1"], _LINEAGE["t7"], _RANK).mrca_rank, "kingdom")
        # deeper share => smaller nodal distance
        self.assertLess(
            relatedness(_LINEAGE["t1"], _LINEAGE["t4"], _RANK).nodal,
            relatedness(_LINEAGE["t1"], _LINEAGE["t7"], _RANK).nodal,
        )

    def test_a_tip_is_not_its_own_relative(self):
        pool = ClashPool.from_blob(_fixture_blob())
        self.assertEqual(pool.relate("t1", "t1").shared_depth, 0)


class MakeRoundTests(SimpleTestCase):
    def setUp(self):
        self.pool = ClashPool.from_blob(_fixture_blob())

    def test_correct_option_is_the_closer_relative(self):
        rng = random.Random(0)
        for _ in range(200):
            rnd = make_round(self.pool, RANK_DEPTH_ENGINE, rng)
            self.assertIsNotNone(rnd)
            near = self.pool.relate(rnd.center, rnd.options[rnd.correct])
            far = self.pool.relate(rnd.center, rnd.options[1 - rnd.correct])
            self.assertGreater(near.shared_depth, far.shared_depth)
            # the gap the round advertises must clear the engine's fairness floor
            self.assertGreaterEqual(rnd.gap, RANK_DEPTH_ENGINE.min_gap)

    def test_seeded_rng_is_deterministic(self):
        a = make_round(self.pool, DEFAULT_ENGINE, random.Random(42))
        b = make_round(self.pool, DEFAULT_ENGINE, random.Random(42))
        self.assertEqual((a.center, a.options, a.correct), (b.center, b.options, b.correct))

    def test_pool_too_small_returns_none(self):
        tiny = {"tips": [{"id": "x", "lineage": ["K"]}], "nodes": [{"id": "K", "rank": "kingdom"}]}
        self.assertIsNone(make_round(ClashPool.from_blob(tiny)))

    def test_damage_scales_with_gap_and_caps(self):
        # rank-depth: gap 2 -> 12, gap 3 -> 19, huge gap capped at 40
        self.assertEqual(RANK_DEPTH_ENGINE.damage(2), 12)
        self.assertEqual(RANK_DEPTH_ENGINE.damage(3), 19)
        self.assertEqual(RANK_DEPTH_ENGINE.damage(100), 40)


from . import referee, store  # noqa: E402


def _pool():
    return ClashPool.from_blob(_fixture_blob())


def _two_humans():
    return [
        referee.Player(id="u:1", display="Alice"),
        referee.Player(id="u:2", display="Bob"),
    ]


class RefereeTests(SimpleTestCase):
    def _match(self, seed=1):
        return referee.new_match(
            "m1", _two_humans(), scope="test", engine_id="rank-depth",
            pool=_pool(), ranked=True, seed=seed, now=1000.0,
        )

    def test_difference_model_only_wrong_side_bleeds(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", c, now=1001.0)       # Alice right
        referee.record_lock(st, "u:2", 1 - c, now=1001.0)   # Bob wrong
        self.assertTrue(referee.both_locked(st))
        out = referee.resolve_round(st)
        self.assertEqual(out.hp["u:1"], referee.HP_MAX)      # winner untouched
        self.assertLess(out.hp["u:2"], referee.HP_MAX)       # loser bled
        self.assertEqual(out.damaged, ["u:2"])
        self.assertEqual(out.damage, int(round(st.engine.damage(st.round.gap))))

    def test_both_correct_no_damage(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", c)
        referee.record_lock(st, "u:2", c)
        out = referee.resolve_round(st)
        self.assertEqual(out.hp, {"u:1": referee.HP_MAX, "u:2": referee.HP_MAX})
        self.assertEqual(out.damaged, [])

    def test_both_wrong_no_damage(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", 1 - c)
        referee.record_lock(st, "u:2", 1 - c)
        out = referee.resolve_round(st)
        self.assertEqual(out.damaged, [])

    def test_missing_lockin_by_deadline_is_a_miss(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", c)  # Alice right; Bob never locks
        self.assertTrue(referee.deadline_passed(st, now=st.round.deadline + 1))
        out = referee.resolve_round(st, now=st.round.deadline + 1)
        self.assertIsNone(out.picks["u:2"])
        self.assertEqual(out.damaged, ["u:2"])  # a no-show is graded wrong

    def test_lock_is_idempotent_and_rejects_overwrite(self):
        st = self._match()
        c = st.round.correct
        self.assertTrue(referee.record_lock(st, "u:1", c))
        self.assertFalse(referee.record_lock(st, "u:1", 1 - c))  # can't change the pick
        self.assertEqual(st.round.locks["u:1"], c)

    def test_resolve_is_idempotent(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", c)
        referee.record_lock(st, "u:2", 1 - c)
        first = referee.resolve_round(st)
        hp_after = dict(first.hp)
        second = referee.resolve_round(st)  # double trigger (both-locked AND deadline)
        self.assertEqual(second.hp, hp_after)  # no second hit

    def test_elimination_ends_match(self):
        st = self._match()
        # Bomb Bob every round until he's eliminated; Alice always right.
        guard = 0
        while st.status == "playing" and guard < 100:
            guard += 1
            c = st.round.correct
            referee.record_lock(st, "u:1", c)
            referee.record_lock(st, "u:2", 1 - c)
            out = referee.resolve_round(st)
            if out.over:
                break
            referee.start_round(st, _pool(), now=2000.0)
        self.assertEqual(st.status, "over")
        self.assertEqual(st.winner, "u:1")
        self.assertLessEqual(st.player("u:2").hp, 0)

    def test_round_cap_ends_by_hp_as_dead_heat(self):
        st = self._match()
        for _ in range(referee.ROUND_CAP + 2):
            if st.status != "playing":
                break
            c = st.round.correct
            referee.record_lock(st, "u:1", c)
            referee.record_lock(st, "u:2", c)  # both right forever -> no damage
            out = referee.resolve_round(st)
            if out.over:
                break
            referee.start_round(st, _pool(), now=2000.0)
        self.assertEqual(st.status, "over")
        self.assertIsNone(st.winner)  # equal HP -> dead heat
        self.assertLessEqual(st.round_num, referee.ROUND_CAP)

    def test_same_seed_same_rounds(self):
        a = self._match(seed=7)
        b = self._match(seed=7)
        self.assertEqual(
            (a.round.center, a.round.options, a.round.correct),
            (b.round.center, b.round.options, b.round.correct),
        )


class _FakeRedis:
    """Minimal dict-backed stand-in for a redis client (set/get/delete)."""

    def __init__(self):
        self.data: dict[str, str] = {}

    def set(self, key, value, ex=None):
        self.data[key] = value

    def get(self, key):
        v = self.data.get(key)
        return v.encode() if isinstance(v, str) else v

    def delete(self, *keys):
        for k in keys:
            self.data.pop(k, None)


class MatchStoreTests(SimpleTestCase):
    def test_roundtrip_preserves_state_and_secret(self):
        st = referee.new_match(
            "abc", _two_humans(), scope="test", engine_id="rank-depth",
            pool=_pool(), ranked=True, seed=3, now=1000.0,
        )
        referee.record_lock(st, "u:1", st.round.correct, now=1001.0)
        s = store.MatchStore(_FakeRedis())
        s.save(st)
        back = s.load("abc")
        self.assertEqual(back.id, "abc")
        self.assertEqual(back.round.correct, st.round.correct)  # secret persists server-side
        self.assertEqual(back.round.locks, {"u:1": st.round.correct})
        self.assertEqual(back.round.options, st.round.options)  # stayed a tuple
        self.assertEqual([p.hp for p in back.players], [referee.HP_MAX, referee.HP_MAX])

    def test_load_missing_is_none_and_delete(self):
        s = store.MatchStore(_FakeRedis())
        self.assertIsNone(s.load("nope"))
        st = referee.new_match(
            "z", _two_humans(), scope="t", engine_id="rank-depth",
            pool=_pool(), ranked=False, seed=1, now=1.0,
        )
        s.save(st)
        self.assertIsNotNone(s.load("z"))
        s.delete("z")
        self.assertIsNone(s.load("z"))


from .matchmaking import Matchmaker, QueueError  # noqa: E402
from .tokens import verify_join_token  # noqa: E402


class _FakeRedisFull(_FakeRedis):
    """Adds list ops (rpush/lpop/lrem) so the matchmaking queue can be tested in-memory."""

    def __init__(self):
        super().__init__()
        self.lists: dict[str, list] = {}

    def rpush(self, key, *vals):
        self.lists.setdefault(key, []).extend(vals)

    def lpop(self, key):
        lst = self.lists.get(key)
        if not lst:
            return None
        v = lst.pop(0)
        return v.encode() if isinstance(v, str) else v

    def lrem(self, key, count, value):
        self.lists[key] = [x for x in self.lists.get(key, []) if x != value]


class MatchmakingTests(SimpleTestCase):
    def _mm(self, redis):
        return Matchmaker(redis, store=store.MatchStore(redis), pool_loader=lambda scope: _pool())

    def test_quick_match_pairs_two_players(self):
        r = _FakeRedisFull()
        mm = self._mm(r)
        first = mm.quick_match(1, "Alice", scope="test", engine_id="rank-depth")
        self.assertEqual(first, {"status": "waiting"})

        second = mm.quick_match(2, "Bob", scope="test", engine_id="rank-depth")
        self.assertEqual(second.seat, 1)
        self.assertEqual(second.opponent, "Alice")
        # Bob's token authorizes Bob (seat 1) for this match; not Alice.
        self.assertEqual(verify_join_token(second.token, 2)["s"], 1)
        self.assertIsNone(verify_join_token(second.token, 1))

        # Alice (the waiter) picks up her pairing by polling — seat 0, opponent Bob.
        alice = mm.poll_pairing(1)
        self.assertEqual(alice["seat"], 0)
        self.assertEqual(alice["opponent"], "Bob")
        self.assertEqual(alice["match_id"], second.match_id)
        self.assertEqual(verify_join_token(alice["token"], 1)["s"], 0)
        # Consumed — a second poll is empty.
        self.assertIsNone(mm.poll_pairing(1))
        # The match really exists in the store, with both seats.
        st = store.MatchStore(r).load(second.match_id)
        self.assertEqual({p.id for p in st.players}, {"u:1", "u:2"})
        self.assertTrue(st.ranked)

    def test_quick_match_does_not_pair_with_self(self):
        r = _FakeRedisFull()
        mm = self._mm(r)
        self.assertEqual(mm.quick_match(1, "A", scope="s", engine_id="rank-depth"), {"status": "waiting"})
        # Same user again: skips their own stale ticket, re-enqueues, stays waiting.
        self.assertEqual(mm.quick_match(1, "A", scope="s", engine_id="rank-depth"), {"status": "waiting"})

    def test_leave_queue_removes_ticket(self):
        r = _FakeRedisFull()
        mm = self._mm(r)
        mm.quick_match(1, "A", scope="s", engine_id="rank-depth")
        mm.leave_queue(1, "A", scope="s", engine_id="rank-depth")
        # Now a second player finds nobody waiting.
        self.assertEqual(mm.quick_match(2, "B", scope="s", engine_id="rank-depth"), {"status": "waiting"})

    def test_private_room_flow(self):
        r = _FakeRedisFull()
        mm = self._mm(r)
        code = mm.create_room(1, "Host", scope="test", engine_id="rank-depth")
        self.assertEqual(len(code), 6)
        joiner = mm.join_room(code, 2, "Guest")
        self.assertEqual(joiner.seat, 1)
        self.assertEqual(joiner.opponent, "Host")
        host = mm.poll_pairing(1)
        self.assertEqual(host["seat"], 0)
        self.assertEqual(host["match_id"], joiner.match_id)
        # Room is single-use.
        with self.assertRaises(QueueError):
            mm.join_room(code, 3, "Late")

    def test_cannot_join_own_room(self):
        r = _FakeRedisFull()
        mm = self._mm(r)
        code = mm.create_room(1, "Host", scope="test", engine_id="rank-depth")
        with self.assertRaises(QueueError):
            mm.join_room(code, 1, "Host")

    def test_join_unknown_room(self):
        mm = self._mm(_FakeRedisFull())
        with self.assertRaises(QueueError):
            mm.join_room("ZZZZZZ", 2, "B")


from channels.routing import URLRouter  # noqa: E402
from django.test import override_settings  # noqa: E402

from . import runtime  # noqa: E402
from .routing import websocket_urlpatterns  # noqa: E402
from .tokens import issue_join_token  # noqa: E402


def _default_pool_loader():
    from .pools import load_pool
    return load_pool


class _User:
    is_authenticated = True

    def __init__(self, uid):
        self.id = uid


def _authed_app(user):
    """Route straight to the ws URLRouter with a pre-authenticated user in scope, so the
    consumer's auth path is exercised without a real session/DB (origin validation is
    covered separately via the HealthConsumer)."""
    router = URLRouter(websocket_urlpatterns)

    async def app(scope, receive, send):
        scope = dict(scope)
        scope["user"] = user
        await router(scope, receive, send)

    return app


async def _recv_until(comm, type_, tries=12):
    """Drain messages until one of ``type_`` (a str or set), returning it; else None."""
    wanted = {type_} if isinstance(type_, str) else set(type_)
    for _ in range(tries):
        msg = await comm.receive_json_from(timeout=2)
        if msg.get("type") in wanted:
            return msg
    return None


@override_settings(CHANNEL_LAYERS={"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}})
class MatchConsumerTests(SimpleTestCase):
    def setUp(self):
        self.redis = _FakeRedisFull()
        runtime._store = store.MatchStore(self.redis)
        runtime._pool_loader = lambda scope: _pool()
        runtime._present.clear()
        runtime._match_locks.clear()

    def tearDown(self):
        runtime._store = None
        runtime._pool_loader = _default_pool_loader()
        runtime._present.clear()
        runtime._match_locks.clear()

    def _seed_match(self, mid="M", seed=1):
        st = referee.new_match(
            mid, _two_humans(), scope="test", engine_id="rank-depth",
            pool=_pool(), ranked=True, seed=seed, now=1000.0,
        )
        store.MatchStore(self.redis).save(st)
        return st

    async def _connect(self, mid, user_id, seat):
        token = issue_join_token(mid, user_id, seat)
        comm = WebsocketCommunicator(_authed_app(_User(user_id)), f"/ws/clash/match/{mid}/?token={token}")
        connected, _ = await comm.connect()
        return comm, connected

    async def test_rejects_unauthenticated(self):
        self._seed_match("A")
        router = URLRouter(websocket_urlpatterns)

        async def anon_app(scope, receive, send):
            scope = dict(scope)
            scope["user"] = None
            await router(scope, receive, send)

        token = issue_join_token("A", 1, 0)
        comm = WebsocketCommunicator(anon_app, f"/ws/clash/match/A/?token={token}")
        connected, _ = await comm.connect()
        self.assertFalse(connected)
        await comm.disconnect()

    async def test_rejects_missing_or_foreign_token(self):
        self._seed_match("B")
        comm = WebsocketCommunicator(_authed_app(_User(1)), "/ws/clash/match/B/")
        connected, _ = await comm.connect()
        self.assertFalse(connected)
        await comm.disconnect()
        # A token minted for a DIFFERENT user can't be used by user 1 (IDOR).
        foreign = issue_join_token("B", 2, 1)
        comm2 = WebsocketCommunicator(_authed_app(_User(1)), f"/ws/clash/match/B/?token={foreign}")
        connected2, _ = await comm2.connect()
        self.assertFalse(connected2)
        await comm2.disconnect()

    async def test_full_round_grades_and_bleeds_loser(self):
        st = self._seed_match("C", seed=5)
        correct = st.round.correct

        c0, ok0 = await self._connect("C", 1, 0)
        self.assertTrue(ok0)
        snap0 = await c0.receive_json_from(timeout=2)
        self.assertEqual(snap0["type"], "match")
        self.assertEqual(snap0["seat"], 0)

        c1, ok1 = await self._connect("C", 2, 1)
        self.assertTrue(ok1)

        await c0.send_json_to({"type": "lock", "side": correct})
        await c1.send_json_to({"type": "lock", "side": 1 - correct})

        reveal = await _recv_until(c0, "reveal")
        self.assertIsNotNone(reveal)
        self.assertEqual(reveal["correct"], correct)
        self.assertEqual(reveal["hp"]["u:1"], referee.HP_MAX)
        self.assertLess(reveal["hp"]["u:2"], referee.HP_MAX)
        self.assertEqual(reveal["damaged"], ["u:2"])
        self.assertIn("next", reveal)

        await c0.disconnect()
        await c1.disconnect()

    async def test_opponent_lock_is_opaque(self):
        st = self._seed_match("D", seed=2)
        c0, _ = await self._connect("D", 1, 0)
        await c0.receive_json_from(timeout=2)  # snapshot
        c1, _ = await self._connect("D", 2, 1)

        await c0.send_json_to({"type": "lock", "side": st.round.correct})
        opp = await _recv_until(c1, "opponent_locked")
        self.assertIsNotNone(opp)
        self.assertNotIn("side", opp)

        await c0.disconnect()
        await c1.disconnect()


from django.contrib.auth import get_user_model  # noqa: E402
from django.test import TestCase  # noqa: E402

from .models import MatchResult  # noqa: E402
from .results import persist_result  # noqa: E402


class PlausibilityTests(SimpleTestCase):
    def _match(self):
        return referee.new_match(
            "p", _two_humans(), scope="test", engine_id="rank-depth",
            pool=_pool(), ranked=True, seed=4, now=1000.0,
        )

    def test_superhuman_fast_correct_picks_flag_the_match(self):
        st = self._match()
        # Round 1: u:1 answers correctly ~0.1s after the round appears (superhuman); u:2 slow.
        c = st.round.correct
        referee.record_lock(st, "u:1", c, now=1000.1)
        referee.record_lock(st, "u:2", c, now=1005.0)
        referee.resolve_round(st)
        self.assertEqual(st.player("u:1").fast_picks, 1)
        self.assertEqual(st.player("u:2").fast_picks, 0)
        self.assertFalse(referee.match_flagged(st))

        # Round 2: same again -> hits the limit -> flagged.
        referee.start_round(st, _pool(), now=2000.0)
        c2 = st.round.correct
        referee.record_lock(st, "u:1", c2, now=2000.1)
        referee.record_lock(st, "u:2", c2, now=2005.0)
        referee.resolve_round(st)
        self.assertEqual(st.player("u:1").fast_picks, 2)
        self.assertTrue(referee.match_flagged(st))

    def test_normal_reaction_is_not_flagged(self):
        st = self._match()
        c = st.round.correct
        referee.record_lock(st, "u:1", c, now=1003.0)  # ~3s — human
        referee.record_lock(st, "u:2", 1 - c, now=1004.0)
        referee.resolve_round(st)
        self.assertEqual(st.player("u:1").fast_picks, 0)
        self.assertFalse(referee.match_flagged(st))


class MatchResultTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.u1 = User.objects.create_user(username="alice")
        self.u2 = User.objects.create_user(username="bob")

    def _finished(self, *, winner, hp, ranked=True, fast=(0, 0), mid="R1"):
        players = [
            referee.Player(id=f"u:{self.u1.id}", display="Alice", hp=hp[0], fast_picks=fast[0]),
            referee.Player(id=f"u:{self.u2.id}", display="Bob", hp=hp[1], fast_picks=fast[1]),
        ]
        st = referee.MatchState(
            id=mid, scope="test", engine_id="rank-depth", seed=1, ranked=ranked,
            players=players, round_num=7, status="over", winner=winner,
        )
        return st

    def test_persists_ranked_result(self):
        st = self._finished(winner=f"u:{self.u1.id}", hp=(60, 0))
        res = persist_result(st)
        self.assertIsNotNone(res)
        self.assertEqual(res.winner_id, self.u1.id)
        self.assertEqual((res.hp0, res.hp1), (60, 0))
        self.assertEqual(res.rounds, 7)
        self.assertTrue(res.counts_for_ranking)

    def test_flagged_match_does_not_count_for_ranking(self):
        st = self._finished(winner=f"u:{self.u1.id}", hp=(80, 0), fast=(3, 0), mid="R2")
        res = persist_result(st)
        self.assertTrue(res.flagged)
        self.assertFalse(res.counts_for_ranking)

    def test_dead_heat_has_no_winner(self):
        st = self._finished(winner=None, hp=(40, 40), mid="R3")
        res = persist_result(st)
        self.assertIsNone(res.winner_id)

    def test_settle_is_idempotent(self):
        st = self._finished(winner=f"u:{self.u2.id}", hp=(0, 30), mid="R4")
        persist_result(st)
        persist_result(st)  # second settle must not duplicate
        self.assertEqual(MatchResult.objects.filter(match_id="R4").count(), 1)

    def test_bot_match_is_not_persisted(self):
        players = [
            referee.Player(id=f"u:{self.u1.id}", display="Alice", hp=50),
            referee.Player(id="bot:easy", display="Bot", hp=0, is_bot=True),
        ]
        st = referee.MatchState(
            id="R5", scope="test", engine_id="rank-depth", seed=1, ranked=False,
            players=players, round_num=3, status="over", winner=f"u:{self.u1.id}",
        )
        self.assertIsNone(persist_result(st))
        self.assertEqual(MatchResult.objects.count(), 0)
