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
