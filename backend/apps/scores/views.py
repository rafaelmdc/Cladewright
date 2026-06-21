"""
Score submission + leaderboard read.

The critical rule (docs/architecture.md): a submitted Marathon run is **re-scored
server-side** from its transcript before it counts — the posted score is never trusted.
Re-scoring reads the asset's denormalized lineages from the relational mirror
(TaxonTip/TaxonNode), so it works for blob *and* huge no-blob scopes alike.
"""
from __future__ import annotations

import datetime as dt

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip

from .models import GameMode, NamedSpecies, PlayerStat, Run, Streak
from .scoring import rescore

LEADERBOARD_LIMIT = 50


def _asset_for(scope: str, version: int | None) -> AssetVersion | None:
    qs = AssetVersion.objects.filter(scope=scope)
    if version:
        return qs.filter(version=version).first()
    return qs.filter(is_current=True).first()


class SubmitRunView(APIView):
    """POST /api/scores/runs/ -> re-score a transcript, persist the run, return the
    canonical score + the player's rank. Auth required."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        data = request.data
        mode = data.get("mode")
        if mode not in GameMode.values:
            return Response({"error": "invalid mode"}, status=400)

        scope = (data.get("scope") or "").strip()
        transcript = data.get("transcript") or []
        if not isinstance(transcript, list):
            return Response({"error": "transcript must be a list of ids"}, status=400)

        version = data.get("asset_version")
        av = _asset_for(scope, int(version) if version else None)
        if av is None:
            return Response({"error": f"no asset for scope {scope!r}"}, status=400)

        # Pull only the lineages we need (the placed ids) from the relational mirror.
        ids = [t for t in transcript if isinstance(t, str)]
        tip_lineages = {
            r["key"]: r["lineage"]
            for r in TaxonTip.objects.filter(asset=av, key__in=ids).values("key", "lineage")
        }
        node_lineages = {
            r["key"]: r["lineage"]
            for r in TaxonNode.objects.filter(asset=av, key__in=ids).values("key", "lineage")
        }
        result = rescore(ids, tip_lineages, node_lineages)

        is_daily = mode in (GameMode.MARATHON_DAILY, GameMode.CLASSIC)
        puzzle_date = dt.date.today() if is_daily else None

        with transaction.atomic():
            run = Run.objects.create(
                user=request.user,
                mode=mode,
                scope=scope,
                score=result.score,
                asset_version=av.version,
                puzzle_date=puzzle_date,
                transcript=ids,
            )
            if is_daily:
                _bump_streak(request.user, mode, puzzle_date)
            _update_player_stats(request.user, mode, result.score, result.placed_tips)

        # Rank among distinct users with a strictly better run for this mode/scope/day.
        rank = (
            Run.objects.filter(
                mode=mode, scope=scope, puzzle_date=puzzle_date, score__gt=result.score
            )
            .values("user")
            .distinct()
            .count()
            + 1
        )
        return Response({**result.as_dict(), "run_id": run.id, "rank": rank}, status=201)


class LeaderboardView(APIView):
    """GET /api/scores/leaderboard/?mode=&scope=&date= -> top runs (best per user)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        mode = request.query_params.get("mode", GameMode.MARATHON_FREE)
        if mode not in GameMode.values:
            return Response({"error": "invalid mode"}, status=400)
        scope = (request.query_params.get("scope") or "").strip()

        qs = Run.objects.filter(mode=mode, scope=scope)
        if mode in (GameMode.MARATHON_DAILY, GameMode.CLASSIC):
            day = _parse_date(request.query_params.get("date")) or dt.date.today()
            qs = qs.filter(puzzle_date=day)

        # Best run per user, highest first. Pull a generous slice then dedupe in Python
        # (per-user best); cheap for a leaderboard page.
        seen: set[int] = set()
        rows = []
        for r in qs.order_by("-score", "created_at").values(
            "user_id", "user__username", "score", "created_at"
        )[: LEADERBOARD_LIMIT * 4]:
            if r["user_id"] in seen:
                continue
            seen.add(r["user_id"])
            rows.append(
                {
                    "rank": len(rows) + 1,
                    "user": r["user__username"],
                    "score": r["score"],
                    "at": r["created_at"].isoformat(),
                }
            )
            if len(rows) >= LEADERBOARD_LIMIT:
                break
        return Response({"mode": mode, "scope": scope, "entries": rows})


def _parse_date(s: str | None) -> dt.date | None:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def _update_player_stats(user, mode: str, score: int, placed_tips) -> None:
    """Fold one run into the per-(user, mode) aggregate + the unique-species set. Called
    inside the submit transaction so stats never drift from the runs."""
    if placed_tips:
        NamedSpecies.objects.bulk_create(
            [NamedSpecies(user=user, mode=mode, species_key=k) for k in placed_tips],
            ignore_conflicts=True,  # only species new to this user actually insert
        )
    unique = NamedSpecies.objects.filter(user=user, mode=mode).count()
    stat, created = PlayerStat.objects.get_or_create(user=user, mode=mode)
    stat.games_played += 1
    stat.total_named += len(placed_tips)
    stat.unique_named = unique
    stat.best_score = max(stat.best_score, score)
    stat.save()


def _bump_streak(user, mode: str, day: dt.date) -> None:
    """Advance the user's streak for a daily mode: +1 if they played yesterday, else reset
    to 1. Idempotent for replays on the same day."""
    streak, _ = Streak.objects.get_or_create(user=user, mode=mode)
    if streak.last_played == day:
        return
    yesterday = day - dt.timedelta(days=1)
    streak.current = streak.current + 1 if streak.last_played == yesterday else 1
    streak.best = max(streak.best, streak.current)
    streak.last_played = day
    streak.save(update_fields=["current", "best", "last_played"])
