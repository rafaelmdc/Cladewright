"""Server-authoritative phylogenetic distance + round generation (#36 Phase 1).

This is the Python mirror of the client's ``frontend/src/lib/game/distance.ts`` and
``cladeClash.ts``. In solo (Phase 0) the client generated + graded rounds itself, which is
fine because it's unranked. Versus is RANKED, so the SERVER must be the referee: it draws
each round and decides the correct side from the tree topology, and the client only renders.
The metric here MUST match the client's so a round looks identical on both ends.

The asset is topology-only: each tip carries a ``lineage`` (root->parent ancestor node ids)
and each node a taxonomic ``rank``. "Closer" = deeper most-recent common ancestor (longer
shared lineage prefix); nodal edge distance is the tiebreak/alternative metric. All O(L)
over the lineage lists. See docs/clade-clash-design.md#the-distance-signal.
"""
from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, Mapping, Sequence

HP_MAX = 100  # starting health for a duel (GeoGuessr-style), mirrors cladeClash.ts


@dataclass(frozen=True)
class Relatedness:
    """How related two tips are. Mirrors distance.ts's Relatedness."""

    mrca_id: str | None  # node id of the most-recent common ancestor; None if none shared
    mrca_rank: str | None  # taxonomic rank of the MRCA (drives the reveal copy)
    shared_depth: int  # length of the shared root->parent prefix — bigger = closer
    nodal: float  # nodal (edge) distance between the tips; inf if unrelated


UNRELATED = Relatedness(mrca_id=None, mrca_rank=None, shared_depth=0, nodal=float("inf"))


def relatedness(
    lineage_a: Sequence[str],
    lineage_b: Sequence[str],
    rank_of: Mapping[str, str | None],
) -> Relatedness:
    """Relatedness of two tips from their lineages. Symmetric; O(min lineage length).
    ``rank_of`` maps a node id to its taxonomic rank. Mirrors distance.ts ``relatedness``."""
    n = min(len(lineage_a), len(lineage_b))
    s = 0
    while s < n and lineage_a[s] == lineage_b[s]:
        s += 1
    if s == 0:
        return UNRELATED
    mrca_id = lineage_a[s - 1]
    # Each tip sits one edge below its last ancestor; the +2 counts those two tip edges.
    nodal = len(lineage_a) + len(lineage_b) - 2 * s + 2
    return Relatedness(
        mrca_id=mrca_id,
        mrca_rank=rank_of.get(mrca_id),
        shared_depth=s,
        nodal=nodal,
    )


@dataclass(frozen=True)
class DistanceEngine:
    """What "closer relative" means. Mirrors the DistanceEngine interface in cladeClash.ts:
    the generator ranks/gaps candidates on ``closeness`` (bigger = closer), rejects rounds
    whose gap is under ``min_gap``, and a miss costs ``damage(gap)`` health."""

    id: str
    label: str
    closeness: Callable[[Relatedness], float]
    min_gap: float
    damage: Callable[[float], float]


def _rank_depth_damage(gap: float) -> float:
    # gap 2 -> 12, +7 per extra step of gap, capped at 40. Mirrors cladeClash.ts.
    return min(40.0, 12.0 + max(0.0, gap - 2) * 7)


RANK_DEPTH_ENGINE = DistanceEngine(
    id="rank-depth",
    label="Shared-clade depth",
    closeness=lambda r: r.shared_depth,
    min_gap=2,
    damage=_rank_depth_damage,
)


def _nodal_damage(gap: float) -> float:
    return min(40.0, 8.0 + gap * 3)


NODAL_ENGINE = DistanceEngine(
    id="nodal",
    label="Nodal edge distance",
    closeness=lambda r: -r.nodal,  # fewer edges apart = closer
    min_gap=2,
    damage=_nodal_damage,
)

DEFAULT_ENGINE = RANK_DEPTH_ENGINE
ENGINES = {e.id: e for e in (RANK_DEPTH_ENGINE, NODAL_ENGINE)}


@dataclass(frozen=True)
class ClashPool:
    """A ready-to-play pool distilled from an asset blob: the tips to sample and the lookups
    the metric needs. Built once per match (see ``from_blob``) and reused every round."""

    tip_ids: tuple[str, ...]
    lineage: Mapping[str, tuple[str, ...]]
    rank_of: Mapping[str, str | None]
    # Display fields per tip id, so a generated round carries names without a second lookup.
    common: Mapping[str, str]
    sci: Mapping[str, str]

    @classmethod
    def from_blob(cls, blob: dict) -> "ClashPool":
        """Distill a ClashPool from an AssetVersion.blob (tips + nodes)."""
        rank_of = {node["id"]: node.get("rank") for node in blob.get("nodes", [])}
        tip_ids: list[str] = []
        lineage: dict[str, tuple[str, ...]] = {}
        common: dict[str, str] = {}
        sci: dict[str, str] = {}
        for tip in blob.get("tips", []):
            tid = tip["id"]
            tip_ids.append(tid)
            lineage[tid] = tuple(tip.get("lineage", []))
            common[tid] = tip.get("common") or tip.get("sci") or tid
            sci[tid] = tip.get("sci") or ""
        return cls(
            tip_ids=tuple(tip_ids),
            lineage=lineage,
            rank_of=rank_of,
            common=common,
            sci=sci,
        )

    def relate(self, a: str, b: str) -> Relatedness:
        if a == b:
            return UNRELATED
        return relatedness(self.lineage[a], self.lineage[b], self.rank_of)


@dataclass(frozen=True)
class ClashRound:
    """One generated round. ``options`` are the two candidate tip ids in display order;
    ``correct`` (0|1) is the closer relative — the authoritative answer, computed here and
    never derived from the client. ``gap`` sizes difficulty + damage."""

    center: str
    options: tuple[str, str]
    correct: int  # 0 or 1
    mrca_rank: tuple[str | None, str | None]  # each option's MRCA rank, for the reveal copy
    gap: float

    def option_common(self, pool: ClashPool) -> tuple[str, str]:
        return (pool.common[self.options[0]], pool.common[self.options[1]])


_SAMPLE = 400  # candidates compared against the centre per attempt
_ATTEMPTS = 16  # resample the centre this many times before giving up on a fair round


def make_round(
    pool: ClashPool,
    engine: DistanceEngine = DEFAULT_ENGINE,
    rng: random.Random | None = None,
) -> ClashRound | None:
    """Build one fair round, or None if the pool is too small/flat. Mirrors cladeClash.ts
    ``makeRound``: a near candidate at maximum closeness and a far one at least ``min_gap``
    less close, so the answer is unambiguous by construction. ``rng`` is injectable so a
    match can be seeded + replayed (the referee seeds per match)."""
    rng = rng or random
    tips = pool.tip_ids
    n_tips = len(tips)
    if n_tips < 8:
        return None

    for _ in range(_ATTEMPTS):
        center = tips[rng.randrange(n_tips)]
        near: tuple[str, Relatedness, float] | None = None
        candidates: list[tuple[str, Relatedness, float]] = []
        seen = {center}

        for _ in range(min(_SAMPLE, n_tips)):
            t = tips[rng.randrange(n_tips)]
            if t in seen:
                continue
            seen.add(t)
            r = pool.relate(center, t)
            if r.shared_depth == 0:
                continue  # unrelated (only the implicit root) — skip
            c = engine.closeness(r)
            candidates.append((t, r, c))
            if near is None or c > near[2]:
                near = (t, r, c)

        if near is None:
            continue

        fars = [x for x in candidates if x[0] != near[0] and near[2] - x[2] >= engine.min_gap]
        if not fars:
            continue
        far = fars[rng.randrange(len(fars))]

        correct_first = rng.random() < 0.5
        if correct_first:
            options = (near[0], far[0])
            ranks = (near[1].mrca_rank, far[1].mrca_rank)
            correct = 0
        else:
            options = (far[0], near[0])
            ranks = (far[1].mrca_rank, near[1].mrca_rank)
            correct = 1
        return ClashRound(
            center=center,
            options=options,
            correct=correct,
            mrca_rank=ranks,
            gap=near[2] - far[2],
        )
    return None
