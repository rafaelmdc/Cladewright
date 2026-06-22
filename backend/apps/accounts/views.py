"""
Auth + account surface for the SPA. Login is allauth's Google flow at
``/accounts/google/login/`` (a top-level redirect); these endpoints let the SPA ask "who
am I?", read per-game stats for the account page, log out, and delete the account.
"""
from __future__ import annotations

import datetime as dt

from django.contrib.auth import logout
from django.core.exceptions import ValidationError
from django.db.models import Count, Max
from django.db.models.functions import TruncDate
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.scores.models import GameMode, GameModeConfig, PlayerStat, Run

from .models import (
    DISPLAY_NAME_MAX,
    DISPLAY_NAME_MIN,
    get_or_create_profile,
    validate_display_name,
)

RECENT_RUNS = 30
HEATMAP_DAYS = 7 * 13  # ~13 weeks, GitHub-style


def _game_labeler():
    """A function (mode, difficulty) -> 'Marathon · Common'. Base name comes from the admin
    GameModeConfig (falling back to the GameMode label); difficulty is the lens, shortened
    (Common / Sci) so composed labels don't truncate on cards. The scoring unit is
    (mode, difficulty) — see docs/games-model.md."""
    cfg = dict(GameModeConfig.objects.values_list("mode", "label"))
    base = dict(GameMode.choices)
    short_diff = {"common": "Common", "scientific": "Sci"}

    def label(mode: str, difficulty: str) -> str:
        return f"{cfg.get(mode) or base.get(mode, mode)} · {short_diff.get(difficulty, difficulty)}"

    return label


@method_decorator(ensure_csrf_cookie, name="dispatch")
class MeView(APIView):
    """GET /api/auth/me/ -> the current user (and set the csrftoken cookie)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        u = request.user
        if not u.is_authenticated:
            return Response({"authenticated": False})
        profile = get_or_create_profile(u)
        return Response(
            {
                "authenticated": True,
                "username": u.get_username(),
                "email": getattr(u, "email", ""),
                "display_name": profile.display_name,
                # Drives the one-time "set your display name" card after sign-up.
                "name_chosen": profile.name_chosen,
            }
        )


class ProfileView(APIView):
    """PATCH /api/auth/profile/ {display_name} -> set the public display name (validated,
    case-insensitively unique). Marks the name as chosen so the set-name card stops showing."""

    permission_classes = [IsAuthenticated]

    def patch(self, request: Request) -> Response:
        u = request.user
        profile = get_or_create_profile(u)
        raw = request.data.get("display_name", "")
        try:
            name = validate_display_name(raw, exclude_user_id=u.pk)
        except ValidationError as e:
            return Response({"error": e.messages[0]}, status=400)
        profile.display_name = name
        profile.name_chosen = True
        profile.save(update_fields=["display_name", "name_chosen"])
        return Response({"display_name": profile.display_name, "name_chosen": True})


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
        label = _game_labeler()
        # One stat row per game = (mode, difficulty). `game` is the stable chip/card id.
        modes = [
            {
                **s,
                "game": f"{s['mode']}|{s['difficulty']}",
                "label": label(s["mode"], s["difficulty"]),
            }
            for s in PlayerStat.objects.filter(user=u).values(
                "mode", "difficulty", "games_played", "total_named", "unique_named", "best_score"
            )
        ]
        totals = {
            "games_played": sum(m["games_played"] for m in modes),
            "total_named": sum(m["total_named"] for m in modes),
            "unique_named": sum(m["unique_named"] for m in modes),
        }
        recent_runs = [
            {"mode": r["mode"], "scope": r["scope"], "score": r["score"], "at": r["created_at"].isoformat()}
            for r in Run.objects.filter(user=u)
            .order_by("-created_at")
            .values("mode", "scope", "score", "created_at")[:RECENT_RUNS]
        ]
        # Day-bucketed activity for the heatmap, split per game = (mode, difficulty), so the
        # client's game-toggle chips filter and the shading adapts (plays across all games;
        # best score when one game is selected). Only (day, game) cells with runs are sent.
        since = timezone.now() - dt.timedelta(days=HEATMAP_DAYS - 1)
        activity = [
            {
                "date": d["day"].isoformat(),
                "game": f"{d['mode']}|{d['difficulty']}",
                "best": d["best"],
                "games": d["games"],
            }
            for d in Run.objects.filter(user=u, created_at__gte=since)
            .annotate(day=TruncDate("created_at"))
            .values("day", "mode", "difficulty")
            .annotate(best=Max("score"), games=Count("id"))
            .order_by("day")
        ]
        return Response(
            {
                "user": {
                    "username": u.get_username(),
                    "display_name": get_or_create_profile(u).display_name,
                    "email": getattr(u, "email", ""),
                    "joined": u.date_joined.date().isoformat(),
                },
                "display_name_rules": {"min": DISPLAY_NAME_MIN, "max": DISPLAY_NAME_MAX},
                "modes": modes,
                "totals": totals,
                "recent_runs": recent_runs,
                "activity": activity,
                "heatmap_days": HEATMAP_DAYS,
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
