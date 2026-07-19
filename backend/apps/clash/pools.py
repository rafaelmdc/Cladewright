"""Load a playable ClashPool from the current asset blob (#36 Phase 1).

The referee draws rounds server-side, so it needs the same tips + lineages the client plays.
Those live in ``AssetVersion.blob`` (the whole-asset JSON for blob-mode scopes). Building a
ClashPool walks every tip once, so we cache it per (scope, version): a rebuild bumps the
version and invalidates the entry automatically. ~50 concurrent players share one pool
object per scope, so this is cheap.
"""
from __future__ import annotations

from typing import Optional

from apps.gamedata.models import AssetVersion

from .distance import ClashPool

# (scope, version) -> ClashPool. Small: one entry per distinct current scope.
_CACHE: dict[tuple[str, int], ClashPool] = {}


def load_pool(scope: str) -> Optional[ClashPool]:
    """The current blob-mode pool for ``scope``, or None if there's no current blob build
    (a huge remote-only scope has no whole-pool blob and can't host a versus match yet)."""
    av = (
        AssetVersion.objects.filter(is_current=True, scope=scope, blob__isnull=False)
        .only("scope", "version", "blob")
        .first()
    )
    if av is None:
        return None
    key = (scope, av.version)
    pool = _CACHE.get(key)
    if pool is None:
        pool = ClashPool.from_blob(av.blob)
        _CACHE[key] = pool
    return pool
