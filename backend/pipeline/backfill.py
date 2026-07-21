"""Fill in fields a built asset is missing, without rebuilding it.

A build is expensive and getting more so: ingest the ColDP dump, induce the backbone, harvest
names from Wikidata, harvest pageviews. When we add a per-tip field — `has_common` and
`has_image` for Clade Clash (#145, #146) — every pack in production is suddenly missing it,
and redoing all of that to add two booleans is hours of work and the path that OOM-kills the
worker on big scopes (#131). Most new fields are **derivable from what the blob already
holds**, or cost one cheap network pass.

So: a registry of backfillers, each of which knows what it fills, which tips still need it,
and how to compute it in bulk. Adding a future one — fame for a pack built before fame
existed, a trait, a per-node age for a dated pack — is an entry in ``BACKFILLERS`` and
nothing else.

**The invariant that makes this safe: a backfiller may only ADD a value that is missing.**
Never a name, an id, a lineage, a parent, or the membership of the pool. Those are what the
relational mirror (TaxonNode/TaxonTip/Alias) and the alias index are built from, so leaving
them alone is exactly what lets a backfill update the blob and bump the version *without*
rebuilding the mirror — the difference between minutes and hours. A backfiller that needs to
change one of them is not a backfill; it is a build.
"""
from __future__ import annotations

from typing import Callable, Iterable, Protocol

from .enrich import BraidworksProvider, has_vernacular

Progress = Callable[[str], None]


class Backfiller(Protocol):
    """Fills one missing field across a blob's tips."""

    #: cli/job name, e.g. "has_image"
    key: str
    #: one line for the admin form + the job log
    describe: str

    def needs(self, tip: dict) -> bool:
        """Is this tip missing the field?"""

    def fill(self, tips: list[dict], emit: Progress) -> None:
        """Fill every tip in ``tips`` (all of which `needs`), in place."""


class HasCommonBackfill:
    """Whether `common` is a real vernacular or the binomial the build fell back to (#145).

    Pure: everything it needs — `common` and `sci` — is already in the blob, so this costs no
    network and no dump. It is the cheap half of the Clade Clash fix.
    """

    key = "has_common"
    describe = "Does this species have a real common name? (no network — derived from the blob)"

    def needs(self, tip: dict) -> bool:
        return "has_common" not in tip

    def fill(self, tips: list[dict], emit: Progress) -> None:
        real = 0
        for tip in tips:
            value = has_vernacular(tip.get("common"), tip.get("sci", ""))
            tip["has_common"] = value
            real += value
        emit(f"      has_common: {real:,}/{len(tips):,} have a real vernacular")


class HasImageBackfill:
    """Whether the species has a picture on Wikipedia (#146).

    One bulk pass over the MediaWiki action API — 50 titles a request, ~0.26s each, so a
    37,000-tip pack is a few minutes. Uses the same harvester a build does, so a backfilled
    pack and a rebuilt one agree.
    """

    key = "has_image"
    describe = "Does this species have a picture on Wikipedia? (~1 request per 50 species)"

    def __init__(self, provider=None) -> None:
        # Injected for tests; the real one talks to Wikipedia.
        self._provider = provider or BraidworksProvider()

    def needs(self, tip: dict) -> bool:
        return "has_image" not in tip

    def fill(self, tips: list[dict], emit: Progress) -> None:
        names = [t.get("sci", "") for t in tips]
        total = len(names)
        emit(f"      has_image: asking Wikipedia about {total:,} species…")
        self._provider.harvest_images(names)
        pictured = 0
        unknown = 0
        for tip in tips:
            value = self._provider.has_image(tip.get("sci", ""))
            if value is None:
                # The lookup failed (network, a batch that errored). Leave the field ABSENT
                # rather than writing False: absent means "ask at draw time", False means
                # "never draw this", and guessing the second would silently shrink the pack.
                unknown += 1
                continue
            tip["has_image"] = value
            pictured += value
        emit(f"      has_image: {pictured:,}/{total:,} have a picture" +
             (f" ({unknown:,} unresolved, left for the client)" if unknown else ""))


def default_backfillers() -> list[Backfiller]:
    """Everything that can be backfilled, in the order it should run (cheap first, so a run
    that dies on the network half still lands the free half)."""
    return [HasCommonBackfill(), HasImageBackfill()]


def backfill_blob(
    blob: dict,
    backfillers: Iterable[Backfiller],
    emit: Progress = lambda _line: None,
    *,
    force: bool = False,
) -> dict[str, int]:
    """Run ``backfillers`` over a blob's tips, in place.

    Returns {key: tips filled}, counting only the tips that actually needed it — so an empty
    result means the asset was already complete and the caller can skip writing it back.
    ``force`` re-computes even where the field is already present (for a backfiller whose rule
    has changed, e.g. `has_common` learning about non-Latin scripts).
    """
    tips = blob.get("tips", [])
    filled: dict[str, int] = {}
    for bf in backfillers:
        todo = tips if force else [t for t in tips if bf.needs(t)]
        if not todo:
            emit(f"      {bf.key}: already complete")
            continue
        bf.fill(todo, emit)
        filled[bf.key] = len(todo)
    return filled
