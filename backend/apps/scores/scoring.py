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
The canonical Marathon score is the number of placements (new + refinement), matching the
on-screen tally.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RescoreResult:
    score: int  # canonical score = total placements (new + refinements)
    new: int
    refinements: int
    duplicates: int
    unknown: int  # transcript ids not present in the asset (ignored)
    placed_tips: tuple[str, ...]  # distinct SPECIES (tips) placed this run, for stats

    def as_dict(self) -> dict:
        return {
            "score": self.score,
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
) -> RescoreResult:
    """Replay ``transcript`` (ordered placed ids) and return the canonical result.

    ``tip_lineages[tip_id]``  = that tip's root→parent ancestor node ids.
    ``node_lineages[node_id]`` = that node's root→parent ancestor node ids (NOT incl. itself).
    Both come straight off the asset's denormalized lineages (blob or relational mirror).
    """
    present: set[str] = set()       # node ids on the current induced tree
    named_nodes: set[str] = set()   # clade nodes the player explicitly named
    named_tips: set[str] = set()    # species placed
    new = refinements = duplicates = unknown = 0

    for tid in transcript:
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
        else:
            unknown += 1

    return RescoreResult(
        score=new + refinements,
        new=new,
        refinements=refinements,
        duplicates=duplicates,
        unknown=unknown,
        placed_tips=tuple(named_tips),  # distinct species placed this run
    )
