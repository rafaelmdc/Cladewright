"""Matchmaking for Clade Clash versus (#36 Phase 1): quick-match queue + private rooms.

Two ways to pair, both minting a match server-side and handing each player a signed join
token (tokens.py) — the ws authorization anchor:

  * Quick match — a per-(scope, engine) Redis FIFO queue. The first arrival waits; the
    second pops them and a match is born. The waiter learns of it by polling ``poll_pairing``.
  * Private room — a host creates a short code and waits; a friend joins by code.

Deliberately dependency-injected (redis client, match store, pool loader, id + token
factories) so the whole rendezvous is unit-tested without Redis or a database. Match ids are
random + unguessable; the token, not the id, is what authorizes a join.
"""
from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from typing import Callable, Optional

from . import referee
from .distance import ClashPool
from .store import MatchStore
from .tokens import issue_join_token

_PREFIX = "cladewright:clash"
# A pending pairing (waiter/host hasn't polled it yet) and a room both expire on their own,
# so a player who navigates away never wedges the queue or leaks a room forever.
PAIRING_TTL = 10 * 60
ROOM_TTL = 15 * 60
_ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no ambiguous 0/O/1/I


def _queue_key(scope: str, engine_id: str) -> str:
    return f"{_PREFIX}:queue:{scope}:{engine_id}"


def _pairing_key(user_id: int) -> str:
    return f"{_PREFIX}:pairing:u:{user_id}"


def _room_key(code: str) -> str:
    return f"{_PREFIX}:room:{code}"


@dataclass
class Pairing:
    """What a paired player needs to open their websocket."""

    match_id: str
    seat: int
    token: str
    opponent: str
    scope: str
    engine_id: str

    def as_dict(self) -> dict:
        return {
            "match_id": self.match_id,
            "seat": self.seat,
            "token": self.token,
            "opponent": self.opponent,
            "scope": self.scope,
            "engine_id": self.engine_id,
        }


class QueueError(Exception):
    """A matchmaking request that can't be satisfied (unknown room, no pool, self-join)."""


class Matchmaker:
    def __init__(
        self,
        redis,
        *,
        store: MatchStore,
        pool_loader: Callable[[str], Optional[ClashPool]],
        id_gen: Callable[[], str] = lambda: secrets.token_urlsafe(12),
        token_issuer: Callable[[str, int, int], str] = issue_join_token,
    ) -> None:
        self._r = redis
        self._store = store
        self._pool_loader = pool_loader
        self._id_gen = id_gen
        self._issue = token_issuer

    # ── quick match ──────────────────────────────────────────────────────────────────
    def quick_match(
        self, user_id: int, display: str, *, scope: str, engine_id: str
    ) -> Pairing | dict:
        """Pair with a waiting player if one exists, else join the queue. Returns a Pairing
        when matched now, or ``{"status": "waiting"}`` when queued."""
        qkey = _queue_key(scope, engine_id)
        # Pop waiters until we find a different, still-valid one (skip our own stale entry).
        while True:
            raw = self._r.lpop(qkey)
            if raw is None:
                # Nobody waiting — enqueue self (id + display) and wait for someone to pop us.
                self._r.rpush(qkey, json.dumps({"u": user_id, "d": display}))
                return {"status": "waiting"}
            entry = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
            if entry["u"] == user_id:
                continue  # our own leftover ticket — drop it and keep looking
            waiter_id, waiter_display = entry["u"], entry["d"]
            break

        # Waiter takes seat 0, initiator seat 1.
        match_id = self._create_match(
            seat0=(waiter_id, waiter_display),
            seat1=(user_id, display),
            scope=scope,
            engine_id=engine_id,
        )
        # Stash the waiter's pairing for them to poll; return the initiator's directly.
        waiter_pairing = Pairing(match_id, 0, self._issue(match_id, waiter_id, 0), display, scope, engine_id)
        self._r.set(_pairing_key(waiter_id), json.dumps(waiter_pairing.as_dict()), ex=PAIRING_TTL)
        return Pairing(match_id, 1, self._issue(match_id, user_id, 1), waiter_display, scope, engine_id)

    def leave_queue(self, user_id: int, display: str, *, scope: str, engine_id: str) -> None:
        self._r.lrem(_queue_key(scope, engine_id), 0, json.dumps({"u": user_id, "d": display}))

    # ── private rooms ────────────────────────────────────────────────────────────────
    def create_room(self, user_id: int, display: str, *, scope: str, engine_id: str) -> str:
        code = "".join(secrets.choice(_ROOM_CODE_ALPHABET) for _ in range(6))
        self._r.set(
            _room_key(code),
            json.dumps({"host": user_id, "display": display, "scope": scope, "engine_id": engine_id}),
            ex=ROOM_TTL,
        )
        return code

    def join_room(self, code: str, user_id: int, display: str) -> Pairing:
        raw = self._r.get(_room_key(code))
        if raw is None:
            raise QueueError("room not found or expired")
        room = json.loads(raw.decode() if isinstance(raw, bytes) else raw)
        if room["host"] == user_id:
            raise QueueError("cannot join your own room")
        self._r.delete(_room_key(code))
        scope, engine_id = room["scope"], room["engine_id"]
        match_id = self._create_match(
            seat0=(room["host"], room["display"]),
            seat1=(user_id, display),
            scope=scope,
            engine_id=engine_id,
        )
        host_pairing = Pairing(match_id, 0, self._issue(match_id, room["host"], 0), display, scope, engine_id)
        self._r.set(_pairing_key(room["host"]), json.dumps(host_pairing.as_dict()), ex=PAIRING_TTL)
        return Pairing(match_id, 1, self._issue(match_id, user_id, 1), room["display"], scope, engine_id)

    # ── polling ──────────────────────────────────────────────────────────────────────
    def poll_pairing(self, user_id: int) -> Optional[dict]:
        """Return + consume this user's pending pairing (the waiter/host side), or None."""
        key = _pairing_key(user_id)
        raw = self._r.get(key)
        if raw is None:
            return None
        self._r.delete(key)
        return json.loads(raw.decode() if isinstance(raw, bytes) else raw)

    # ── internals ────────────────────────────────────────────────────────────────────
    def _create_match(
        self, *, seat0: tuple[int, str], seat1: tuple[int, str], scope: str, engine_id: str
    ) -> str:
        pool = self._pool_loader(scope)
        if pool is None:
            raise QueueError(f"scope '{scope}' has no playable pool")
        match_id = self._id_gen()
        players = [
            referee.Player(id=f"u:{seat0[0]}", display=seat0[1]),
            referee.Player(id=f"u:{seat1[0]}", display=seat1[1]),
        ]
        # Human vs human is ranked; a bot match never routes through matchmaking.
        state = referee.new_match(
            match_id, players, scope=scope, engine_id=engine_id, pool=pool, ranked=True
        )
        self._store.save(state)
        return match_id
