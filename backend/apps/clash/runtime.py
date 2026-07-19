"""Shared runtime providers for the match consumer (#36 Phase 1).

Isolated here (not baked into the consumer) so tests can swap the store + pool for in-memory
fakes, and so the concurrency model has one home.

Concurrency: a match has two players and its state is a read-modify-write on Redis. We
serialize per-match mutations with a process-local asyncio lock. That is fully correct for
the INITIAL single-ASGI-pod deployment (both players' consumers live in one process; the
design targets one pod for ~50 players). Scaling websockets to MULTIPLE pods later needs a
cross-pod lock (a Redis lock) instead — tracked as a follow-up in docs/clade-clash-design.md.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from .distance import ClashPool
from .pools import load_pool
from .store import MatchStore, get_redis

# Overridable in tests (monkeypatch these module attributes with fakes).
_store: Optional[MatchStore] = None
_pool_loader = load_pool

_match_locks: dict[str, asyncio.Lock] = {}
# Which seats are currently connected, per match (process-local; single-pod MVP).
_present: dict[str, set[int]] = {}


def get_store() -> MatchStore:
    global _store
    if _store is None:
        _store = MatchStore(get_redis())
    return _store


def get_pool(scope: str) -> Optional[ClashPool]:
    return _pool_loader(scope)


def match_lock(match_id: str) -> asyncio.Lock:
    """A per-match lock, so lock-ins and the deadline timer never interleave a resolve."""
    lock = _match_locks.get(match_id)
    if lock is None:
        lock = asyncio.Lock()
        _match_locks[match_id] = lock
    return lock


def present_add(match_id: str, seat: int) -> bool:
    """Mark ``seat`` connected. Returns True only on the transition to BOTH seats present,
    so exactly one connect arms the round clock (a reconnect while both are present is False)."""
    seats = _present.setdefault(match_id, set())
    was = len(seats)
    seats.add(seat)
    return was < 2 and len(seats) == 2


def present_remove(match_id: str, seat: int) -> None:
    seats = _present.get(match_id)
    if seats is not None:
        seats.discard(seat)
        if not seats:
            _present.pop(match_id, None)


def forget_match(match_id: str) -> None:
    _match_locks.pop(match_id, None)
    _present.pop(match_id, None)
