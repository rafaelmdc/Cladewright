"""
Server-authoritative run re-scoring.

A submitted Marathon run is **never trusted** for its score (docs/architecture.md). The
client sends the ordered list of target ids it placed (the transcript); the server
replays them against the asset and recomputes the canonical score. Unknown ids and
duplicates contribute nothing, so a run can't be inflated by padding the transcript.

``rescore`` mirrors the frontend induced-tree placement classifier
(frontend/src/lib/tree/induced.ts) exactly:
  * tip   — counts unless already placed; it's a *refinement* if some ancestor clade was
            explicitly named earlier, else *new*. Both count as one placement.
  * node  — counts as *new* only if it wasn't already implied by a deeper placement
            (i.e. not already on the present tree); otherwise it's a duplicate.
The canonical Marathon score is base placements (new + refinement, one each) PLUS a combo
bonus: naming several in quick succession multiplies a placement's worth (#77). The combo
bonus is recomputed here from the run's per-placement TIMINGS — never trusted from the
client — and the timings themselves are anchored to a signed run session (see sessions.py),
so the score stays server-authoritative. Base placements stay 1-each so historical (pre-
combo) runs remain comparable; combos only ever ADD on top.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

# Combo scoring (mirrors the frontend's comboBonus in Marathon.tsx). A placement at combo
# level c≥2 is worth `min(round((c-1) * multiplier), CAP)` bonus points on top of its base
# point; below ×2 there's no bonus. The cap keeps a long streak from running away.
COMBO_SCORE_CAP = 10


def combo_bonus_points(combo: int, multiplier: float) -> int:
    """Bonus points for a placement made at this combo level (0 below ×2; capped)."""
    return min(round((combo - 1) * multiplier), COMBO_SCORE_CAP) if combo >= 2 else 0


def clade_bonus_points(size: int, multiplier: float) -> int:
    """Bonus points for completing a clade of ``size`` species — sqrt-scaled so big clades
    are prestigious but no single mega-clade dominates, keeping breadth worthwhile (#77)."""
    return round(multiplier * math.sqrt(size)) if size > 0 else 0


@dataclass(frozen=True)
class RescoreResult:
    score: int  # canonical score = base placements + combo bonus + clade-completion bonus
    base: int  # placements (new + refinements), the pre-bonus score
    combo_bonus: int  # extra points from combos (0 when no/invalid timings)
    clade_bonus: int  # extra points from completing clades
    new: int
    refinements: int
    duplicates: int
    unknown: int  # transcript ids not present in the asset (ignored)
    placed_tips: tuple[str, ...]  # distinct SPECIES (tips) placed this run, for stats

    def as_dict(self) -> dict:
        return {
            "score": self.score,
            "base": self.base,
            "combo_bonus": self.combo_bonus,
            "clade_bonus": self.clade_bonus,
            "new": self.new,
            "refinements": self.refinements,
            "duplicates": self.duplicates,
            "unknown": self.unknown,
            "animals_named": len(self.placed_tips),
        }


def rescore(
    transcript: list[str],
    tip_lineages: dict[str, list[str]],
    node_lineages: dict[str, list[str]],
    *,
    timings: list[float] | None = None,
    combo_window_seconds: float = 0,
    combo_multiplier: float = 0,
    node_pool_counts: dict[str, int] | None = None,
    clade_multiplier: float = 0,
    clade_min_size: int = 0,
) -> RescoreResult:
    """Replay ``transcript`` (ordered placed ids) and return the canonical result.

    ``tip_lineages[tip_id]``  = that tip's root→parent ancestor node ids.
    ``node_lineages[node_id]`` = that node's root→parent ancestor node ids (NOT incl. itself).
    Both come straight off the asset's denormalized lineages (blob or relational mirror).

    ``timings`` (ms since the first placement, parallel to ``transcript``) drive the combo
    bonus: a placement continues the combo when it lands within ``combo_window_seconds`` of
    the previous one. Omit (or pass mismatched-length) timings to score base placements only
    — the caller validates timings against the signed run session before passing them.

    ``node_pool_counts`` (clade node id → its species denominator, extant-aware as the run's
    mode dictates) drives the clade-completion bonus: when naming a tip drives a clade to
    fully named, the largest such clade newly completed this placement scores
    ``clade_bonus_points(size, clade_multiplier)`` (once per clade per run, size ≥
    ``clade_min_size``). Mirrors the client's completion celebration so HUD == leaderboard.
    """
    present: set[str] = set()       # node ids on the current induced tree
    named_nodes: set[str] = set()   # clade nodes the player explicitly named
    named_tips: set[str] = set()    # species placed
    new = refinements = duplicates = unknown = combo_bonus = clade_bonus = 0

    # Only honour timings when they line up 1:1 with the transcript; otherwise no combo.
    use_combo = (
        timings is not None
        and len(timings) == len(transcript)
        and combo_window_seconds > 0
        and combo_multiplier > 0
    )
    window_ms = combo_window_seconds * 1000
    combo = 0
    combo_open_until = float("-inf")

    # Clade completion: count distinct named tips under each ancestor clade; award the bonus
    # the first time a clade reaches its full denominator.
    use_clade = bool(node_pool_counts) and clade_multiplier > 0
    pool_counts = node_pool_counts or {}
    named_under: dict[str, int] = {}
    completed: set[str] = set()

    for i, tid in enumerate(transcript):
        counted = False  # did this id score as a placement (new/refinement)?
        if tid in tip_lineages:
            if tid in named_tips:
                duplicates += 1
                continue
            lineage = tip_lineages[tid]
            refining = any(a in named_nodes for a in lineage)
            present.update(lineage)
            named_tips.add(tid)
            if refining:
                refinements += 1
            else:
                new += 1
            counted = True

            # A newly-named tip may complete one or more ancestor clades — award the biggest
            # one not already completed (matches the client's single celebration).
            if use_clade:
                best_size = 0
                for a in lineage:
                    if a in completed:
                        continue
                    named_under[a] = named_under.get(a, 0) + 1
                    size = pool_counts.get(a, 0)
                    if size and named_under[a] >= size and size >= clade_min_size:
                        completed.add(a)
                        best_size = max(best_size, size)
                if best_size:
                    clade_bonus += clade_bonus_points(best_size, clade_multiplier)
        elif tid in node_lineages:
            if tid in named_nodes:
                duplicates += 1
                continue
            already_present = tid in present
            present.update(node_lineages[tid])
            present.add(tid)
            named_nodes.add(tid)
            if already_present:
                duplicates += 1  # a clade already implied by a deeper placement
            else:
                new += 1
                counted = True
        else:
            unknown += 1

        # Advance the combo on each scoring placement, mirroring the client's window rule.
        if counted and use_combo:
            t = timings[i]
            combo = combo + 1 if t <= combo_open_until else 1
            combo_open_until = t + window_ms
            combo_bonus += combo_bonus_points(combo, combo_multiplier)

    base = new + refinements
    return RescoreResult(
        score=base + combo_bonus + clade_bonus,
        base=base,
        combo_bonus=combo_bonus,
        clade_bonus=clade_bonus,
        new=new,
        refinements=refinements,
        duplicates=duplicates,
        unknown=unknown,
        placed_tips=tuple(named_tips),  # distinct species placed this run
    )
