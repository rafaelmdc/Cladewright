"""Shared runtime providers for the match consumer (#36 Phase 1).

Isolated here (not baked into the consumer) so tests can swap the store + pool for in-memory
fakes, and so the concurrency model has one home.

Concurrency: a match has two players and its state is a read-modify-write on Redis. Each
mutation is serialized per match by ``match_lock`` — a COMBINED lock:

  * a process-local ``asyncio.Lock`` (cheap, serializes consumers in the same process), AND
  * a **Redis distributed lock** (``SET NX`` under the hood) so two *different* pods/workers
    holding the two players can't interleave a resolve either.

The Redis half auto-disables when the store's client can't lock (the in-memory fakes in
tests) — then it's process-local only, which is exactly right for a single-process test. So
one code path is correct from a single pod up to a horizontally-scaled websocket tier.
"""
from __future__ import annotations

import asyncio
from typing import Optional

from asgiref.sync import sync_to_async

from .distance import ClashPool
from .pools import load_pool
from .store import MatchStore, get_redis

# Overridable in tests (monkeypatch these module attributes with fakes).
_store: Optional[MatchStore] = None
_pool_loader = load_pool
# Master switch for the Redis half of the match lock (the process-local half always runs).
enable_redis_lock = True

_LOCK_PREFIX = "cladewright:clash:lock"
_LOCK_TIMEOUT = 15  # seconds a held lock lives before Redis auto-expires it (crash safety)
_LOCK_WAIT = 10  # seconds to block trying to acquire before giving up

_match_locks: dict[str, asyncio.Lock] = {}
# Which seats are currently connected, per match (process-local; presence is per-pod).
_present: dict[str, set[int]] = {}


def get_store() -> MatchStore:
    global _store
    if _store is None:
        _store = MatchStore(get_redis())
    return _store


def get_pool(scope: str) -> Optional[ClashPool]:
    return _pool_loader(scope)


def _redis_lock(match_id: str):
    """A redis-py distributed lock for this match, or None if locking isn't available (a fake
    client in tests, or the switch is off). ``thread_local=False`` so acquire + release can
    run on different threadpool threads (sync_to_async), which they do."""
    if not enable_redis_lock:
        return None
    client = getattr(get_store(), "_client", None)
    if client is None or not hasattr(client, "lock"):
        return None
    return client.lock(
        f"{_LOCK_PREFIX}:{match_id}",
        timeout=_LOCK_TIMEOUT,
        blocking_timeout=_LOCK_WAIT,
        thread_local=False,
    )


class _MatchLock:
    """Async context manager: hold the process-local lock AND (when available) the Redis lock
    for the duration of a critical section. Redis acquire/release run off the event loop."""

    def __init__(self, local: asyncio.Lock, redis_lock) -> None:
        self._local = local
        self._redis_lock = redis_lock

    async def __aenter__(self) -> "_MatchLock":
        await self._local.acquire()
        if self._redis_lock is not None:
            try:
                got = await sync_to_async(self._redis_lock.acquire)()
                if not got:
                    self._redis_lock = None  # couldn't get it in time — proceed local-only
            except Exception:
                self._redis_lock = None  # Redis blip — don't wedge the match, degrade to local
        return self

    async def __aexit__(self, *exc) -> None:
        if self._redis_lock is not None:
            try:
                await sync_to_async(self._redis_lock.release)()
            except Exception:
                pass  # already expired / released — the TTL is the backstop
        self._local.release()


def match_lock(match_id: str) -> "_MatchLock":
    """A per-match lock (process-local + Redis), so lock-ins and the deadline timer never
    interleave a resolve — across pods, not just within one."""
    local = _match_locks.get(match_id)
    if local is None:
        local = asyncio.Lock()
        _match_locks[match_id] = local
    return _MatchLock(local, _redis_lock(match_id))


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
