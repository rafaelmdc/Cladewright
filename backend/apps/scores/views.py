"""
Score submission + leaderboard read.

Phase 4. The critical rule (docs/architecture.md): a submitted Marathon run is
**re-scored server-side** from its transcript before it counts — the posted score
is never trusted.
"""
from __future__ import annotations

from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView


class SubmitRunView(APIView):
    """POST /api/scores/runs/ -> validate transcript, persist, return canonical score."""

    def post(self, request: Request) -> Response:
        # TODO(phase-4): require auth; re-score transcript against the asset version;
        # reject mismatch; update Run + Streak atomically.
        raise NotImplementedError


class LeaderboardView(APIView):
    """GET /api/scores/leaderboard/?mode=&date= -> top runs."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        # TODO(phase-4): per-day for daily modes, all-time best for free play.
        raise NotImplementedError
