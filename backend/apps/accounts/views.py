"""
Auth + account surface for the SPA. Login is allauth's Google flow at
``/accounts/google/login/`` (a top-level redirect); these endpoints let the SPA ask "who
am I?", read per-game stats for the account page, log out, and delete the account.
"""
from __future__ import annotations

from django.contrib.auth import logout
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.scores.models import GameMode, PlayerStat, Run

RECENT_RUNS = 30


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    """GET /api/auth/me/ -> the current user (and set the csrftoken cookie)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        u = request.user
        if not u.is_authenticated:
            return Response({"authenticated": False})
        return Response(
            {"authenticated": True, "username": u.get_username(), "email": getattr(u, "email", "")}
        )


class LogoutView(APIView):
    """POST /api/auth/logout/ -> end the session."""

    permission_classes: list = []

    def post(self, request: Request) -> Response:
        logout(request)
        return Response({"authenticated": False})


class AccountStatsView(APIView):
    """GET /api/auth/stats/ -> per-game-mode stats + recent runs (for the account page).
    Reads the PlayerStat aggregates directly — no scanning of runs or the species set."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        u = request.user
        labels = dict(GameMode.choices)
        modes = [
            {**s, "label": labels.get(s["mode"], s["mode"])}
            for s in PlayerStat.objects.filter(user=u).values(
                "mode", "games_played", "total_named", "unique_named", "best_score"
            )
        ]
        totals = {
            "games_played": sum(m["games_played"] for m in modes),
            "total_named": sum(m["total_named"] for m in modes),
            # Cross-mode sum; a species named in two modes counts once per mode. Fine while
            # Marathon is the only mode — revisit if a true cross-game unique is wanted.
            "unique_named": sum(m["unique_named"] for m in modes),
        }
        recent_runs = [
            {"mode": r["mode"], "scope": r["scope"], "score": r["score"], "at": r["created_at"].isoformat()}
            for r in Run.objects.filter(user=u)
            .order_by("-created_at")
            .values("mode", "scope", "score", "created_at")[:RECENT_RUNS]
        ]
        return Response(
            {
                "user": {
                    "username": u.get_username(),
                    "email": getattr(u, "email", ""),
                    "joined": u.date_joined.date().isoformat(),
                },
                "modes": modes,
                "totals": totals,
                "recent_runs": recent_runs,
            }
        )


class DeleteAccountView(APIView):
    """DELETE /api/auth/account/ -> permanently delete the account and all its data
    (runs, stats, named-species, streaks, the linked social account all cascade)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request: Request) -> Response:
        user = request.user
        logout(request)  # end the session before the row vanishes
        user.delete()
        return Response(status=204)
