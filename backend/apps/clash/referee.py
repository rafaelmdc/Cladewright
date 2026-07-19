"""The Clade Clash referee (#36 Phase 1) — the server-authoritative match core.

Deliberately PURE: it mutates a plain ``MatchState`` and knows nothing about Redis or
websockets, so the whole game — round draw, lock-ins, difference-model damage, elimination,
deadline — is unit-testable without any I/O. The consumer (transport) and the store
(persistence) wrap this; they never re-implement a rule.

Health model mirrors Phase 0 (docs/clade-clash-design.md#the-loop): both sides start at
HP_MAX, a round is a DIFFERENCE model — only the side whose outcome differs from the other
takes ``engine.damage(gap)`` — and the first to 0 HP is eliminated. A missing lock-in by
the deadline counts as a wrong pick.
"""
from __future__ import annotations

import random
import time
from dataclasses import asdict, dataclass, field
from typing import Optional

from .distance import ENGINES, HP_MAX, ClashPool, DistanceEngine, make_round

ROUND_CAP = 20  # if nobody's HP hits 0 by here, higher HP wins (mirrors CladeClash.tsx)
ROUND_SECONDS = 12  # wall-clock a player has to lock in before the deadline auto-resolves
# Anti-cheat (docs security model): integrity is PLAUSIBILITY, not secrecy. A CORRECT pick
# faster than human reaction after the round appears is the tell — the answer is derivable
# from the tree, but a bot clicking it in 50 ms is not human. Same class as the run pace gate.
REACTION_FLOOR = 0.30  # seconds; a correct pick faster than this counts as superhuman
FAST_PICK_LIMIT = 2  # this many superhuman-fast correct picks flags the match as implausible


@dataclass
class Player:
    id: str  # "u:<user_id>" for a human, "bot:<name>" for the bot — id also tags rank-safety
    display: str
    hp: int = HP_MAX
    is_bot: bool = False
    # Count of superhuman-fast CORRECT picks across the match (reaction-time plausibility).
    fast_picks: int = 0


@dataclass
class RoundState:
    num: int
    center: str
    options: tuple[str, str]
    correct: int  # SERVER SECRET — never serialize into a client-visible payload before reveal
    mrca_rank: tuple[Optional[str], Optional[str]]
    gap: float
    deadline: float  # epoch seconds; past this the round resolves with missing picks = miss
    # player id -> chosen side (0|1). Absent = not locked yet.
    locks: dict[str, int] = field(default_factory=dict)
    # player id -> epoch seconds the lock arrived (for the reaction-time plausibility gate).
    lock_at: dict[str, float] = field(default_factory=dict)
    resolved: bool = False
    # Set once when resolved (so a re-read after save/load is idempotent, not zeroed).
    dmg: int = 0
    damaged: list[str] = field(default_factory=list)


@dataclass
class MatchState:
    id: str
    scope: str
    engine_id: str
    seed: int
    ranked: bool
    players: list[Player]
    round: Optional[RoundState] = None
    round_num: int = 0
    status: str = "playing"  # "playing" | "over"
    winner: Optional[str] = None  # player id, or None for a dead heat, once status == "over"

    @property
    def engine(self) -> DistanceEngine:
        return ENGINES.get(self.engine_id, ENGINES["rank-depth"])

    def player(self, pid: str) -> Optional[Player]:
        return next((p for p in self.players if p.id == pid), None)

    def opponent(self, pid: str) -> Optional[Player]:
        return next((p for p in self.players if p.id != pid), None)


@dataclass
class RoundOutcome:
    """What a resolved round did — the referee's verdict, for the reveal broadcast."""

    round_num: int
    correct: int
    picks: dict[str, Optional[int]]  # player id -> side, or None if they never locked
    damage: int
    damaged: list[str]  # player ids that lost HP this round (0 or 1 of them)
    hp: dict[str, int]  # player id -> HP after this round
    over: bool
    winner: Optional[str]


def _round_rng(seed: int, round_num: int) -> random.Random:
    """Deterministic per-round RNG so a match is replayable from (seed, round_num)."""
    return random.Random(f"{seed}:{round_num}")


def new_match(
    match_id: str,
    players: list[Player],
    *,
    scope: str,
    engine_id: str,
    pool: ClashPool,
    ranked: bool,
    seed: Optional[int] = None,
    now: Optional[float] = None,
) -> MatchState:
    """Create a match and deal round 1. ``ranked`` is decided by the caller (a match with a
    bot is never ranked, see docs security model). Raises if the pool can't form a round."""
    state = MatchState(
        id=match_id,
        scope=scope,
        engine_id=engine_id,
        seed=seed if seed is not None else random.randrange(1 << 62),
        ranked=ranked,
        players=list(players),
    )
    start_round(state, pool, now=now)
    if state.round is None:
        raise ValueError("pool too small/flat to start a Clade Clash match")
    return state


def start_round(state: MatchState, pool: ClashPool, *, now: Optional[float] = None) -> bool:
    """Advance to the next round. Returns False (and ends the match) if the round cap is hit
    or the pool can't produce a fair round after its attempts."""
    now = now if now is not None else time.time()
    if state.round_num >= ROUND_CAP:
        _end_by_hp(state)
        return False
    next_num = state.round_num + 1
    rnd = make_round(pool, state.engine, _round_rng(state.seed, next_num))
    if rnd is None:
        _end_by_hp(state)
        return False
    state.round_num = next_num
    state.round = RoundState(
        num=next_num,
        center=rnd.center,
        options=rnd.options,
        correct=rnd.correct,
        mrca_rank=rnd.mrca_rank,
        gap=rnd.gap,
        deadline=now + ROUND_SECONDS,
    )
    return True


def record_lock(state: MatchState, pid: str, side: int, *, now: Optional[float] = None) -> bool:
    """Record a player's lock-in for the current round. Returns True if this was a NEW,
    accepted lock (valid player, in-range side, round live + unresolved, not already locked);
    False otherwise (duplicate, unknown player, bad side, resolved). Idempotent + safe: a
    second lock from the same player is ignored, so a client can't overwrite its pick."""
    now = now if now is not None else time.time()
    r = state.round
    if r is None or r.resolved or state.status != "playing":
        return False
    if state.player(pid) is None or side not in (0, 1):
        return False
    if pid in r.locks:
        return False
    r.locks[pid] = side
    r.lock_at[pid] = now
    return True


def both_locked(state: MatchState) -> bool:
    r = state.round
    return r is not None and all(p.id in r.locks for p in state.players)


def deadline_passed(state: MatchState, *, now: Optional[float] = None) -> bool:
    now = now if now is not None else time.time()
    r = state.round
    return r is not None and not r.resolved and now >= r.deadline


def resolve_round(state: MatchState, *, now: Optional[float] = None) -> RoundOutcome:
    """Grade the current round: difference-model damage, HP, elimination. Idempotent per
    round (guards on ``resolved``). Call on both-locked OR at the deadline; a player who
    never locked is graded as a wrong pick. Does NOT deal the next round — the caller does
    that after the reveal lingers (start_round), so the reveal can be shown."""
    r = state.round
    assert r is not None, "no round to resolve"
    picks = {p.id: r.locks.get(p.id) for p in state.players}

    if not r.resolved:
        outcomes = {pid: (pick == r.correct) for pid, pick in picks.items()}
        # Reaction-time plausibility: a CORRECT pick landing faster than a human could react
        # after the round appeared is the anti-cheat tell (the answer is derivable, but not
        # that fast). Round start = deadline - ROUND_SECONDS.
        round_start = r.deadline - ROUND_SECONDS
        for p in state.players:
            if outcomes.get(p.id) and p.id in r.lock_at:
                reaction = r.lock_at[p.id] - round_start
                if reaction < REACTION_FLOOR:
                    p.fast_picks += 1
        dmg = int(round(state.engine.damage(r.gap)))
        damaged: list[str] = []
        # Difference model: only when the two outcomes DIFFER does the wrong side bleed.
        vals = list(outcomes.values())
        if vals[0] != vals[1]:
            loser = next(p for p in state.players if not outcomes[p.id])
            loser.hp = max(0, loser.hp - dmg)
            damaged.append(loser.id)
        r.resolved = True
        r.dmg = dmg
        r.damaged = damaged

    # Elimination: someone at 0 HP ends the match now.
    over = any(p.hp <= 0 for p in state.players)
    if over:
        state.status = "over"
        _set_winner(state)

    return RoundOutcome(
        round_num=r.num,
        correct=r.correct,
        picks=picks,
        damage=r.dmg,
        damaged=list(r.damaged),
        hp={p.id: p.hp for p in state.players},
        over=state.status == "over",
        winner=state.winner,
    )


def _set_winner(state: MatchState) -> None:
    """Winner = the strictly-higher HP survivor; equal HP is a dead heat (winner None)."""
    a, b = state.players
    if a.hp > b.hp:
        state.winner = a.id
    elif b.hp > a.hp:
        state.winner = b.id
    else:
        state.winner = None


def _end_by_hp(state: MatchState) -> None:
    state.status = "over"
    _set_winner(state)


def match_flagged(state: MatchState) -> bool:
    """Whether the match's timing was implausible (a player racked up superhuman-fast correct
    picks). A flagged match still finishes and shows a winner, but is excluded from ranking."""
    return any(p.fast_picks >= FAST_PICK_LIMIT for p in state.players)


# ── serialization (for the Redis store) ──────────────────────────────────────────────
# The full state (incl. the secret ``correct``) round-trips for server-side persistence.
# Client-facing redaction lives in the consumer, not here.

def to_dict(state: MatchState) -> dict:
    d = asdict(state)
    # tuples -> lists survive asdict already; nothing else special.
    return d


def from_dict(d: dict) -> MatchState:
    players = [Player(**p) for p in d["players"]]
    rnd = None
    if d.get("round"):
        rd = dict(d["round"])
        rd["options"] = tuple(rd["options"])
        rd["mrca_rank"] = tuple(rd["mrca_rank"])
        # locks/lock_at keys are player-id strings already; JSON preserved them.
        rnd = RoundState(
            num=rd["num"],
            center=rd["center"],
            options=rd["options"],
            correct=rd["correct"],
            mrca_rank=rd["mrca_rank"],
            gap=rd["gap"],
            deadline=rd["deadline"],
            locks={k: int(v) for k, v in rd.get("locks", {}).items()},
            lock_at={k: float(v) for k, v in rd.get("lock_at", {}).items()},
            resolved=rd.get("resolved", False),
            dmg=rd.get("dmg", 0),
            damaged=list(rd.get("damaged", [])),
        )
    return MatchState(
        id=d["id"],
        scope=d["scope"],
        engine_id=d["engine_id"],
        seed=d["seed"],
        ranked=d["ranked"],
        players=players,
        round=rnd,
        round_num=d["round_num"],
        status=d["status"],
        winner=d.get("winner"),
    )
