"""
Serve the game-data asset.

The asset is immutable per ``version`` (see docs/game-asset-format.md), so it can be
served with long-lived cache headers and is fully CDN-cacheable. The client caches
by version and only refetches on a bump. This is the entire "data" surface of the
backend — there is no per-guess endpoint; gameplay runs client-side.
"""
from __future__ import annotations

import json
from functools import lru_cache

from django.conf import settings
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


@lru_cache(maxsize=1)
def _load_asset() -> dict:
    # TODO(phase-1): cache-bust on version change / file mtime; consider serving the
    # raw gzipped bytes instead of re-encoding JSON.
    with open(settings.GAMEDATA_ASSET_PATH, encoding="utf-8") as fh:
        return json.load(fh)


class CurrentAssetView(APIView):
    """GET /api/gamedata/current/ -> the full current game-data asset."""

    permission_classes: list = []  # public

    def get(self, request: Request) -> Response:
        asset = _load_asset()
        resp = Response(asset)
        # TODO(phase-1): set ETag = version and Cache-Control: immutable.
        resp["X-Asset-Version"] = str(asset.get("version", "0"))
        return resp


class AssetVersionView(APIView):
    """GET /api/gamedata/version/ -> just the version, for cheap freshness checks."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        asset = _load_asset()
        return Response({"version": asset.get("version"), "schema": asset.get("schema")})
