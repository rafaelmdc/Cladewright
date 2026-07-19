"""Settle a finished match into a durable MatchResult (#36 Phase 1).

Called once, at match end, from the consumer. Parses the referee's ``MatchState`` (player
ids like ``u:<id>``) into a row. Idempotent on ``match_id`` so a double-settle is a no-op.
A match with implausible timing is recorded but flagged (excluded from ranking).
"""
from __future__ import annotations

from typing import Optional

from . import referee
from .models import MatchResult


def _user_id(player_id: str) -> Optional[int]:
    """'u:42' -> 42; anything else (e.g. a bot) -> None."""
    if player_id.startswith("u:"):
        try:
            return int(player_id[2:])
        except ValueError:
            return None
    return None


def persist_result(state: referee.MatchState) -> Optional[MatchResult]:
    """Write (once) the MatchResult for a finished match. Returns the row, or None if it
    can't be persisted as a human-vs-human ranked-eligible result (e.g. a bot participant)."""
    p0, p1 = state.players
    uid0, uid1 = _user_id(p0.id), _user_id(p1.id)
    if uid0 is None or uid1 is None:
        return None  # not a human-vs-human match — nothing durable to record

    winner_uid = _user_id(state.winner) if state.winner else None
    result, _created = MatchResult.objects.get_or_create(
        match_id=state.id,
        defaults={
            "scope": state.scope,
            "engine_id": state.engine_id,
            "player0_id": uid0,
            "player1_id": uid1,
            "winner_id": winner_uid,
            "hp0": p0.hp,
            "hp1": p1.hp,
            "rounds": state.round_num,
            "ranked": state.ranked,
            "flagged": referee.match_flagged(state),
        },
    )
    return result
