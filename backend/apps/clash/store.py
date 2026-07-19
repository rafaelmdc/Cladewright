"""Ephemeral match state in Redis (#36 Phase 1).

A live match is transient — it lives in Redis with a TTL and vanishes when it ends or is
abandoned, so an orphaned match can never grow Redis unbounded (docs security model). The
durable OUTCOME (who won) is written to Postgres at settle time (see models/MatchResult),
the way finished runs persist; this store holds only the in-flight state.

Keys are namespaced (``cladewright:clash:match:<id>``) because this Redis is shared with
Celery. The store is transport-agnostic and takes an injectable client, so the referee
logic and serialization are tested without a real Redis.
"""
from __future__ import annotations

import json
from typing import Optional, Protocol

from django.conf import settings

from . import referee

_PREFIX = "cladewright:clash"
# A match with no activity for this long is abandoned; the key self-expires. Refreshed on
# every save, so an active match never disappears mid-play.
MATCH_TTL = 60 * 30  # 30 minutes


class RedisLike(Protocol):
    def set(self, key: str, value: str, ex: Optional[int] = ...) -> object: ...
    def get(self, key: str) -> Optional[bytes]: ...
    def delete(self, *keys: str) -> object: ...


def _match_key(match_id: str) -> str:
    return f"{_PREFIX}:match:{match_id}"


def get_redis() -> RedisLike:
    """A redis-py client on the channel-layer Redis URL (redis-py ships via celery[redis]).
    Matchmaking + the store share this connection target so all clash keys live together."""
    import redis  # local import: not needed for the pure referee/serialization tests

    url = settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0]
    return redis.Redis.from_url(url)


# Back-compat alias for internal callers.
_default_client = get_redis


class MatchStore:
    """Persist/restore a MatchState. Inject a client in tests; defaults to the shared Redis."""

    def __init__(self, client: Optional[RedisLike] = None) -> None:
        self._client = client or _default_client()

    def save(self, state: referee.MatchState, *, ttl: int = MATCH_TTL) -> None:
        self._client.set(_match_key(state.id), json.dumps(referee.to_dict(state)), ex=ttl)

    def load(self, match_id: str) -> Optional[referee.MatchState]:
        raw = self._client.get(_match_key(match_id))
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        return referee.from_dict(json.loads(raw))

    def delete(self, match_id: str) -> None:
        self._client.delete(_match_key(match_id))
