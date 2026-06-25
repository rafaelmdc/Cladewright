"""
Serve the game-data asset.

Two delivery modes over the SAME stored build:
  * blob mode (small scopes) — GET /current/ returns the whole asset; the client plays
    in-memory. Immutable per version, so CDN-cacheable; the client caches by version.
  * incremental mode (huge scopes) — GET /search/ does trigram autocomplete and
    GET /resolve/ returns one organism's denormalized lineage, so the client never
    downloads the whole (GB-scale) tree. Gameplay still runs client-side either way.

There is no per-guess endpoint; resolve responses are immutable and cacheable too.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache

from django.conf import settings
from django.db.utils import DatabaseError
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Alias, AssetVersion, TaxonNode, TaxonTip


def _normalize(name: str) -> str:
    """Mirror the pipeline/frontend normalize so a typed query matches stored alias keys."""
    s = name.lower().replace("_", " ")
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


@lru_cache(maxsize=1)
def _file_asset() -> dict:
    """Dev fallback: the on-disk asset, used only when no current AssetVersion exists."""
    with open(settings.GAMEDATA_ASSET_PATH, encoding="utf-8") as fh:
        return json.load(fh)


def _current(scope: str | None) -> AssetVersion | None:
    qs = AssetVersion.objects.filter(is_current=True)
    if scope:
        qs = qs.filter(scope=scope)
    return qs.first()


# A pinned (scope, version) build never changes, so its responses are immutable forever.
# Serving them at a versioned URL (?v=) lets Cloudflare edge-cache them: the origin is hit
# once globally per id, then ~0 — the latency lever for the huge-scope remote tail. Unpinned
# ("current") responses can change on a rebuild, so they stay uncached.
_IMMUTABLE = "public, max-age=31536000, immutable"


def _pinned_or_current(scope: str | None, v: str | None) -> tuple[AssetVersion | None, bool]:
    """(asset, pinned). When ``v`` names an existing (scope, version) build, serve that exact
    version (immutable → cacheable); otherwise fall back to the current build (uncacheable)."""
    if v:
        try:
            av = AssetVersion.objects.filter(scope=scope, version=int(v)).first()
        except (TypeError, ValueError):
            av = None
        if av is not None:
            return av, True
    return _current(scope), False


class ScopesView(APIView):
    """GET /api/gamedata/scopes/ -> the catalog the picker renders.

    One row per current AssetVersion: its stable key, display label, tip counts (all +
    extant, for the extinct toggle's "N remaining" denominator), and delivery `mode`
    (blob = download whole; remote = play incrementally via /search + /resolve). Cheap:
    one indexed query over the small set of current builds, no blobs read.
    """

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        try:
            rows = list(
                AssetVersion.objects.filter(is_current=True)
                .values("scope", "label", "pool_size", "pool_size_extant", "version",
                        "notable_count")
                .order_by("label", "scope")
            )
            # `blob__isnull` without pulling the (possibly huge) blob into Python.
            blob_scopes = set(
                AssetVersion.objects.filter(is_current=True, blob__isnull=False)
                .values_list("scope", flat=True)
            )
        except DatabaseError:
            return Response({"scopes": []})

        def mode_of(r: dict) -> str:
            # No blob → legacy pure-remote. Capped blob (notable_count>0) → hybrid: the
            # client plays the local blob and resolves the tail via /search + /resolve.
            # Whole-pool blob → blob (no tail).
            if r["scope"] not in blob_scopes:
                return "remote"
            return "hybrid" if r["notable_count"] else "blob"

        scopes = [
            {
                "key": r["scope"],
                "label": r["label"] or r["scope"],
                "tip_count": r["pool_size"],
                "extant_count": r["pool_size_extant"],
                "version": r["version"],
                "mode": mode_of(r),
                # In hybrid mode, how many tips ship locally (the rest are the remote tail).
                "notable_count": r["notable_count"],
            }
            for r in rows
        ]
        return Response({"scopes": scopes})


class CurrentAssetView(APIView):
    """GET /api/gamedata/current/?scope= -> the full current asset (blob mode)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        scope = request.query_params.get("scope")
        try:
            av, pinned = _pinned_or_current(scope, request.query_params.get("v"))
        except DatabaseError:
            av, pinned = None, False
        if av is not None and av.blob is not None:
            resp = Response(av.blob)
            resp["X-Asset-Version"] = str(av.version)
            if pinned:  # ?v=<version> → the blob is immutable, let the edge cache it.
                resp["Cache-Control"] = _IMMUTABLE
            return resp
        # No DB build (or this scope is incremental-only) -> dev file fallback.
        asset = _file_asset()
        resp = Response(asset)
        resp["X-Asset-Version"] = str(asset.get("version", "0"))
        return resp


class AssetVersionView(APIView):
    """GET /api/gamedata/version/?scope= -> version/schema for a cheap freshness check."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        scope = request.query_params.get("scope")
        try:
            av = _current(scope)
        except DatabaseError:
            av = None
        if av is not None:
            return Response({"version": av.version, "schema": av.schema, "scope": av.scope})
        asset = _file_asset()
        return Response({"version": asset.get("version"), "schema": asset.get("schema")})


class ResolveNameView(APIView):
    """GET /api/gamedata/resolve-name/?scope=&q= -> the EXACT alias match for ``q`` in a
    scope's current asset: ``{key, kind, sci, common}`` or 404. Blob clients call this as a
    FALLBACK when a typed name isn't in their baked index — e.g. an admin-added manual alias
    that hasn't been baked into a rebuild yet (the target tip is already in the client's blob,
    so it only needs the key). Exact match only; no fuzzy search."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        q = _normalize(request.query_params.get("q", ""))
        if not q:
            return Response({"error": "empty query"}, status=400)
        av = _current(request.query_params.get("scope") or None)
        if av is None:
            return Response({"error": "no current asset"}, status=404)
        row = (
            Alias.objects.filter(asset=av, norm=q)
            .values("target_key", "target_kind", "sci", "common")
            .first()
        )
        if not row:
            return Response({"error": "no match"}, status=404)
        return Response(
            {"key": row["target_key"], "kind": row["target_kind"],
             "sci": row["sci"], "common": row["common"]}
        )


class SearchView(APIView):
    """GET /api/gamedata/search/?q=&scope=&limit= -> autocomplete candidates.

    The huge-scope name resolver: trigram-indexed substring match over the alias table,
    prefix/length-ranked. The client uses this instead of shipping the whole alias index.
    """

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        q = _normalize(request.query_params.get("q", ""))
        if not q:
            return Response({"results": []})
        scope = request.query_params.get("scope")
        try:
            limit = min(int(request.query_params.get("limit", 20)), 50)
        except ValueError:
            limit = 20

        av, pinned = _pinned_or_current(scope, request.query_params.get("v"))
        if av is None:
            return Response({"results": []})

        rows = list(
            Alias.objects.filter(asset=av, norm__icontains=q)
            .values("norm", "target_key", "target_kind", "sci", "common", "fame")[: limit * 4]
        )
        # Rank: exact, then prefix, then most-famous, then shortest — cheap + deterministic.
        # Fame (enwiki pageviews) breaks ties so a shared name surfaces the famous taxon.
        rows.sort(key=lambda r: (r["norm"] != q, not r["norm"].startswith(q),
                                 -r.get("fame", 0), len(r["norm"])))
        seen: set[str] = set()
        results = []
        for r in rows:
            if r["target_key"] in seen:
                continue
            seen.add(r["target_key"])
            results.append({
                "name": r["norm"], "id": r["target_key"], "kind": r["target_kind"],
                "sci": r["sci"], "common": r["common"],
            })
            if len(results) >= limit:
                break
        resp = Response({"results": results})
        if pinned:  # results are immutable per (version, q, limit) → edge-cacheable.
            resp["Cache-Control"] = _IMMUTABLE
        return resp


class ResolveView(APIView):
    """GET /api/gamedata/resolve/?id=&scope= -> everything needed to place one organism:
    its target record plus its denormalized lineage (ancestor nodes with pool_count). One
    immutable, cacheable read per placed organism — the lazy half of huge-scope serving.
    """

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        target_id = request.query_params.get("id")
        if not target_id:
            return Response({"error": "id required"}, status=400)
        scope = request.query_params.get("scope")
        av, pinned = _pinned_or_current(scope, request.query_params.get("v"))
        if av is None:
            return Response({"error": "no current asset"}, status=404)

        kind = "tip" if target_id.startswith("tip:") else "node"
        if kind == "tip":
            tip = TaxonTip.objects.filter(asset=av, key=target_id).first()
            if tip is None:
                return Response({"error": "not found"}, status=404)
            lineage_ids = tip.lineage
            target = {"id": tip.key, "kind": "tip", "sci": tip.sci, "common": tip.common,
                      "traits": tip.traits}
        else:
            node = TaxonNode.objects.filter(asset=av, key=target_id).first()
            if node is None:
                return Response({"error": "not found"}, status=404)
            lineage_ids = node.lineage + [node.key]  # include itself as the placement point
            target = {"id": node.key, "kind": "node", "sci": node.sci, "common": node.common,
                      "rank": node.rank, "pool_count": node.pool_count}

        nodes = {
            n.key: n
            for n in TaxonNode.objects.filter(asset=av, key__in=lineage_ids)
        }
        lineage = [
            {"id": nid, "rank": nodes[nid].rank, "sci": nodes[nid].sci,
             "common": nodes[nid].common, "pool_count": nodes[nid].pool_count}
            for nid in lineage_ids
            if nid in nodes
        ]
        resp = Response({"target": target, "lineage": lineage})
        if pinned:  # one placed organism's lineage is immutable → edge-cacheable forever.
            resp["Cache-Control"] = _IMMUTABLE
        return resp
