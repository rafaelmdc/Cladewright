"""Clade Clash websocket consumers (#36 Phase 1).

``HealthConsumer`` is the liveness/smoke probe. ``MatchConsumer`` is the realtime referee
for a versus duel: it authenticates the socket, refuses any frame from a non-participant
(IDOR), owns the countdown, grades every round server-side, and never leaks the correct
side or the opponent's pick before the reveal.

Security posture (docs/clade-clash-design.md#security-model):
  * connect requires an authenticated user AND a signed join token for THIS match + seat;
  * every mutating frame re-checks the sender is a participant (the socket is bound to one
    seat at connect, so a frame can only ever act as that seat);
  * the pre-reveal payload carries centre + candidates + deadline — never the answer, never
    the opponent's pick (only an opaque "opponent locked");
  * a simple per-connection message rate limit caps frame spam.

Concurrency is serialized per match by ``runtime.match_lock`` (single-pod correct; see runtime).
"""
from __future__ import annotations

import asyncio
import time
from typing import Optional
from urllib.parse import parse_qs

from asgiref.sync import sync_to_async
from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import referee, runtime
from .distance import ClashPool
from .tokens import verify_join_token

# The reveal lingers this long on both clients before the next round's clock starts, so the
# server dates the next deadline to match (players get the full ROUND_SECONDS to answer).
# Raised from 2.5s (#144): the reveal draws the round's cladogram and names the shared clade —
# the one moment the game TEACHES — and two and a half seconds was not enough to read it before
# the board changed under you. Mirrored by REVEAL_MS in frontend/src/lib/clash/useClashMatch.ts.
REVEAL_SECONDS = 6.0
# Per-connection frame budget — generous for real play (a couple locks per 12s round), tight
# enough that a script can't flood the referee.
_RATE_MAX = 20
_RATE_WINDOW = 5.0


class HealthConsumer(AsyncJsonWebsocketConsumer):
    """Accepts a ws connection and echoes JSON back, tagged. A liveness probe for the ASGI
    deployment (and the smoke test for the Channels wiring). Carries no auth or state."""

    async def connect(self) -> None:
        await self.accept()
        await self.send_json({"type": "ready"})

    async def receive_json(self, content: dict, **kwargs) -> None:
        await self.send_json({"type": "echo", "payload": content})


# ── presenters (redaction lives here — the referee never renders a client payload) ──────

def _tip(pool: ClashPool, tip_id: str) -> dict:
    return {"id": tip_id, "common": pool.common.get(tip_id, tip_id), "sci": pool.sci.get(tip_id, "")}


def public_round(pool: ClashPool, r: referee.RoundState) -> dict:
    """The round as a player may see it BEFORE reveal: centre + candidates + deadline. No
    ``correct``, and no per-option MRCA rank (deeper rank = closer, so it would leak the
    answer)."""
    return {
        "num": r.num,
        "center": _tip(pool, r.center),
        "options": [_tip(pool, r.options[0]), _tip(pool, r.options[1])],
        "deadline": r.deadline,
        "seconds": referee.ROUND_SECONDS,
    }


def reveal_payload(outcome: referee.RoundOutcome, r: referee.RoundState) -> dict:
    """The reveal: the answer, both picks, damage, HP — identical for both players."""
    return {
        "type": "reveal",
        "round": outcome.round_num,
        "correct": outcome.correct,
        "picks": outcome.picks,
        "mrca_rank": list(r.mrca_rank),
        "damage": outcome.damage,
        "damaged": outcome.damaged,
        "hp": outcome.hp,
        "over": outcome.over,
        "winner": outcome.winner,
    }


class MatchConsumer(AsyncJsonWebsocketConsumer):
    """The referee for one player's side of a duel."""

    async def connect(self) -> None:
        self.match_id: str = self.scope["url_route"]["kwargs"]["match_id"]
        self.group = f"clash.match.{self.match_id}"
        self._rate: list[float] = []

        user = self.scope.get("user")
        if user is None or not user.is_authenticated:
            await self.close(code=4401)  # unauthenticated
            return

        token = self._query_param("token")
        payload = verify_join_token(token, user.id)
        if payload is None or payload["m"] != self.match_id:
            await self.close(code=4403)  # not authorized for this match
            return
        self.seat: int = payload["s"]
        self.player_id = f"u:{user.id}"

        state = await self._load()
        if state is None:
            await self.close(code=4404)  # match gone (ended/expired)
            return
        # IDOR belt-and-braces: the seat the token grants must actually be this player's seat.
        if state.player(self.player_id) is None or state.players[self.seat].id != self.player_id:
            await self.close(code=4403)
            return

        self.scope_key = state.scope
        self.pool = await self._get_pool(state.scope)
        if self.pool is None:
            await self.close(code=4404)
            return

        await self.channel_layer.group_add(self.group, self.channel_name)
        await self.accept()

        # Snapshot the current state to just-connected me.
        await self.send_json(self._match_snapshot(state))

        # Presence: when the second player arrives, (re)start the current round's clock fresh
        # and tell both — the first player may have been waiting.
        both = runtime.present_add(self.match_id, self.seat)
        if both:
            await self._arm_current_round()

    async def disconnect(self, code) -> None:
        if not hasattr(self, "seat"):
            return
        runtime.present_remove(self.match_id, self.seat)
        await self.channel_layer.group_discard(self.group, self.channel_name)
        # Tell the opponent; the match keeps resolving (a disconnected player simply misses
        # rounds and loses on HP), so no explicit forfeit is needed.
        await self.channel_layer.group_send(
            self.group, {"type": "peer.left", "seat": self.seat}
        )

    async def receive_json(self, content: dict, **kwargs) -> None:
        if not self._allow_frame():
            return  # rate limited — silently drop
        if not isinstance(content, dict):
            return
        if content.get("type") == "lock":
            await self._handle_lock(content.get("side"))

    # ── lock-in ────────────────────────────────────────────────────────────────────
    async def _handle_lock(self, side) -> None:
        if side not in (0, 1):
            return
        async with runtime.match_lock(self.match_id):
            state = await self._load()
            if state is None or state.round is None:
                return
            round_num = state.round.num
            newly = referee.record_lock(state, self.player_id, side)
            if not newly:
                return
            await self._save(state)
            both = referee.both_locked(state)
        # Tell the room someone locked (by SEAT, never the side).
        await self.channel_layer.group_send(
            self.group, {"type": "lock.progress", "seat": self.seat}
        )
        if both:
            await self._resolve_and_advance(round_num)

    # ── resolve / advance (exactly one caller proceeds per round) ────────────────────
    async def _resolve_and_advance(self, expected_round_num: int) -> None:
        now = time.time()
        async with runtime.match_lock(self.match_id):
            state = await self._load()
            if state is None or state.round is None:
                return
            r = state.round
            if r.num != expected_round_num or r.resolved:
                return  # already handled by the other side / the other timer
            outcome = referee.resolve_round(state, now=now)
            reveal = reveal_payload(outcome, r)
            next_round = None
            next_num = None
            if not outcome.over:
                # Date the next round so its clock starts AFTER the reveal lingers.
                referee.start_round(state, self.pool, now=now + REVEAL_SECONDS)
                if state.round is not None:
                    next_round = public_round(self.pool, state.round)
                    next_num = state.round.num
                else:
                    outcome_over = referee.resolve_round(state, now=now)  # cap hit -> over
                    reveal = reveal_payload(outcome_over, r)
            await self._save(state)
            if outcome.over or state.status == "over":
                await self._settle(state)
        await self.channel_layer.group_send(
            self.group, {"type": "match.reveal", "reveal": reveal, "next": next_round}
        )
        if next_round is not None:
            self._arm_deadline(next_num, next_round["deadline"])

    async def _arm_current_round(self) -> None:
        """(Re)start the live round's clock now that both are present, and broadcast it."""
        now = time.time()
        async with runtime.match_lock(self.match_id):
            state = await self._load()
            if state is None or state.round is None or state.round.resolved:
                return
            state.round.deadline = now + referee.ROUND_SECONDS
            num = state.round.num
            deadline = state.round.deadline
            payload = public_round(self.pool, state.round)
            await self._save(state)
        await self.channel_layer.group_send(
            self.group, {"type": "match.round", "round": payload}
        )
        self._arm_deadline(num, deadline)

    def _arm_deadline(self, round_num: int, deadline: float) -> None:
        async def watch():
            await asyncio.sleep(max(0.0, deadline - time.time()))
            await self._resolve_and_advance(round_num)

        asyncio.ensure_future(watch())

    async def _settle(self, state: referee.MatchState) -> None:
        """Match end: write the durable MatchResult (idempotent), then clear the ephemeral
        Redis state and the process-local lock/presence. A persistence hiccup must not crash
        the socket teardown, so it's guarded."""
        try:
            await self._persist(state)
        except Exception:  # noqa: BLE001 — best-effort; the reveal already went out
            pass
        await self._delete()
        runtime.forget_match(self.match_id)

    @database_sync_to_async
    def _persist(self, state):
        from .results import persist_result

        persist_result(state)

    # ── group event handlers (fan-out to this socket) ────────────────────────────────
    async def lock_progress(self, event) -> None:
        # Render for MY seat: my own lock is an ack, the other seat is an opaque "opponent".
        if event["seat"] == self.seat:
            await self.send_json({"type": "you_locked"})
        else:
            await self.send_json({"type": "opponent_locked"})

    async def match_reveal(self, event) -> None:
        msg = dict(event["reveal"])
        if event.get("next"):
            msg["next"] = event["next"]
        await self.send_json(msg)

    async def match_round(self, event) -> None:
        await self.send_json({"type": "round", "round": event["round"]})

    async def peer_left(self, event) -> None:
        if event["seat"] != self.seat:
            await self.send_json({"type": "opponent_left"})

    # channels maps a group event's "type" to a method by replacing "." with "_":
    # lock.progress -> lock_progress, match.reveal -> match_reveal, peer.left -> peer_left.

    # ── helpers ──────────────────────────────────────────────────────────────────────
    def _match_snapshot(self, state: referee.MatchState) -> dict:
        return {
            "type": "match",
            "match_id": state.id,
            "seat": self.seat,
            "ranked": state.ranked,
            "players": [{"id": p.id, "display": p.display, "hp": p.hp} for p in state.players],
            "round": public_round(self.pool, state.round) if state.round else None,
            "status": state.status,
        }

    def _query_param(self, name: str) -> Optional[str]:
        qs = parse_qs(self.scope.get("query_string", b"").decode())
        vals = qs.get(name)
        return vals[0] if vals else None

    def _allow_frame(self) -> bool:
        now = time.time()
        self._rate = [t for t in self._rate if now - t < _RATE_WINDOW]
        if len(self._rate) >= _RATE_MAX:
            return False
        self._rate.append(now)
        return True

    @sync_to_async
    def _load(self):
        return runtime.get_store().load(self.match_id)

    @sync_to_async
    def _save(self, state):
        runtime.get_store().save(state)

    @sync_to_async
    def _delete(self):
        runtime.get_store().delete(self.match_id)

    @database_sync_to_async
    def _get_pool(self, scope):
        return runtime.get_pool(scope)
