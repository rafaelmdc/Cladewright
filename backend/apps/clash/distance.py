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
# Below this many drawable tips a pool can't form rounds at all (make_round bails), so the
# presentability filters give up rather than empty a small pack. Mirrors make_round's floor.
_MIN_POOL = 8


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
    the metric needs. Built once per match (see ``from_blob``) and reused every round.

    ``tip_ids`` is ordered by FAME, descending, and holds only the tips a round can actually
    show. Both are draw concerns, and doing them once at pool construction keeps the generator
    a pure sampler — the client does the same thing (``byFame`` + ``namedPool``).
    """

    tip_ids: tuple[str, ...]
    lineage: Mapping[str, tuple[str, ...]]
    rank_of: Mapping[str, str | None]
    # Display fields per tip id, so a generated round carries names without a second lookup.
    common: Mapping[str, str]
    sci: Mapping[str, str]

    @classmethod
    def from_blob(cls, blob: dict) -> "ClashPool":
        """Distill a ClashPool from one AssetVersion.blob (tips + nodes)."""
        return cls.from_blobs([blob])

    @classmethod
    def from_blobs(cls, blobs: list[dict]) -> "ClashPool":
        """Distill a ClashPool from one or more asset blobs — a mix of packs is one pool
        (#147). Ids are derived from taxon names, so the union needs no remapping and the
        shared backbone (``kng:Animalia``) coincides across packs, which is what lets a round
        span two of them. A tip present in two packs is simply the same tip."""
        rank_of: dict[str, str | None] = {}
        lineage: dict[str, tuple[str, ...]] = {}
        common: dict[str, str] = {}
        sci: dict[str, str] = {}
        fame: dict[str, int] = {}
        drawable: dict[str, int] = {}  # tip id -> fame (dict, so an overlap doesn't duplicate)
        for blob in blobs:
            for node in blob.get("nodes", []):
                rank_of.setdefault(node["id"], node.get("rank"))
            for tip in blob.get("tips", []):
                tid = tip["id"]
                lineage[tid] = tuple(tip.get("lineage", []))
                common[tid] = tip.get("common") or tip.get("sci") or tid
                sci[tid] = tip.get("sci") or ""
                fame[tid] = int(tip.get("fame") or 0)
                # A card is a picture with a name under it, so a species missing either can't
                # be dealt (#145, #146). Both flags are baked by builds from those issues
                # onward; a pack built before has no opinion on either, so every tip stays
                # drawable and versus looks exactly as it does today. Versus renders both
                # names, which is why a vernacular is required here — it matches the client's
                # default lens (see namedPool in cladeClash.ts).
                if tip.get("has_image") is False or tip.get("has_common") is False:
                    drawable.pop(tid, None)
                    continue
                drawable[tid] = fame[tid]
        # A pack can be small AND poorly covered — Wikipedia has a picture for well under half
        # of some groups. Rather than refuse to start a match on it, fall back to the whole
        # pool: an ugly duel beats no duel, and it is the same "never make a pack unplayable"
        # posture the fame bias takes when it relaxes across attempts.
        if len(drawable) < _MIN_POOL:
            drawable = fame
        # Fame descending, then id, so a rebuild at equal fame draws the same rounds.
        ordered = sorted(drawable.items(), key=lambda kv: (-kv[1], kv[0]))
        return cls(
            tip_ids=tuple(tid for tid, _ in ordered),
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
# How sharply the draw skews toward famous species. Mirrors FAME_SKEW in cladeClash.ts —
# see the tuning table there; the two must agree or a duel feels like a different game from
# the solo practice that taught you it.
_FAME_SKEW = 8


def make_round(
    pool: ClashPool,
    engine: DistanceEngine = DEFAULT_ENGINE,
    rng: random.Random | None = None,
    fame_bias: float = 0.0,
) -> ClashRound | None:
    """Build one fair round, or None if the pool is too small/flat. Mirrors cladeClash.ts
    ``makeRound``: a near candidate at maximum closeness and a far one at least ``min_gap``
    less close, so the answer is unambiguous by construction. ``rng`` is injectable so a
    match can be seeded + replayed (the referee seeds per match).

    ``fame_bias`` (0..1, admin-tunable via GameDefaults) skews the draw toward species people
    have heard of. Solo has had this since the fame work landed; versus did NOT, so a duel on
    a 37,000-species pack drew uniformly and asked players to compare two gobies nobody can
    recognise — the exact coin-flip problem the bias exists to solve. The skew decays across
    attempts, so it can never make a pack unplayable, only change which end we look at first.
    """
    rng = rng or random
    tips = pool.tip_ids
    n_tips = len(tips)
    if n_tips < 8:
        return None
    bias = max(0.0, min(1.0, fame_bias))

    for attempt in range(_ATTEMPTS):
        strength = bias * (1 - attempt / _ATTEMPTS)
        exp = 1 + strength * _FAME_SKEW

        def pick() -> str:
            # tip_ids is fame-ordered, so a >1 exponent pushes the index toward the front.
            return tips[min(n_tips - 1, int(n_tips * (rng.random() ** exp)))]

        center = pick()
        near: tuple[str, Relatedness, float] | None = None
        candidates: list[tuple[str, Relatedness, float]] = []
        seen = {center}

        for _ in range(min(_SAMPLE, n_tips)):
            t = pick()
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
