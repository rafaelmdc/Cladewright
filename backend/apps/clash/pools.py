"""Load a playable ClashPool from the current asset blob(s) (#36 Phase 1).

The referee draws rounds server-side, so it needs the same tips + lineages the client plays.
Those live in ``AssetVersion.blob`` (the whole-asset JSON for blob-mode scopes). Building a
ClashPool walks every tip once, so we cache it per (scope, version): a rebuild bumps the
version and invalidates the entry automatically. ~50 concurrent players share one pool
object per scope, so this is cheap.

A "scope" here may be a MIX of packs (#147). Time Attack has always let a run combine packs —
"All Vertebrates" is one click in the lobby — and a duel had no reason to be the exception
beyond the fact that nothing merged the pools server-side. A mix is written as its member
keys joined by ``+`` in sorted order (``aves+fish+mammalia``), which makes the string both the
cache key and the matchmaking queue key: two players who picked the same set are queued
together, and one who picked a different mix is not, which is the correct behaviour rather
than a limitation.

Merging is a plain dict union because node and tip ids are derived from taxon NAMES, not from
per-pack counters — ``fam:Felidae`` is ``fam:Felidae`` in every pack that contains it. Shared
backbone above the packs (``kng:Animalia``) simply coincides, which is what makes a round
spanning two packs work at all: a bird and a fish share Chordata in both blobs.
"""
from __future__ import annotations

from typing import Optional

from apps.gamedata.models import AssetVersion

from .distance import ClashPool

SCOPE_SEP = "+"

# key -> ClashPool, where key carries every member scope's version. Small: one entry per
# distinct mix in play.
_CACHE: dict[tuple, ClashPool] = {}


def scope_key(scopes) -> str:
    """The canonical key for one or more packs. Sorted, so the order they were clicked in
    never splits the matchmaking queue."""
    return SCOPE_SEP.join(sorted({s for s in scopes if s}))


def scope_members(scope: str) -> list[str]:
    """The member packs of a scope key — one for a plain pack, several for a mix."""
    return [s for s in scope.split(SCOPE_SEP) if s]


def load_pool(scope: str) -> Optional[ClashPool]:
    """The current blob-mode pool for ``scope``, or None if any member has no current blob
    build (a huge remote-only scope has no whole-pool blob and can't host a versus match)."""
    members = scope_members(scope)
    if not members:
        return None

    versions = (
        AssetVersion.objects.filter(is_current=True, scope__in=members, blob__isnull=False)
        .only("scope", "version")
        .values_list("scope", "version")
    )
    by_scope = dict(versions)
    # All or nothing: silently dropping a member would pair two players on pools that only
    # LOOK like the same mix.
    if any(m not in by_scope for m in members):
        return None

    key = tuple(sorted(by_scope.items()))
    pool = _CACHE.get(key)
    if pool is None:
        blobs = (
            AssetVersion.objects.filter(is_current=True, scope__in=members, blob__isnull=False)
            .only("scope", "blob")
            .values_list("blob", flat=True)
        )
        pool = ClashPool.from_blobs(list(blobs))
        _CACHE[key] = pool
    return pool
