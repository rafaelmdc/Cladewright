"""
Score submission + leaderboard read.

The critical rule (docs/architecture.md): a submitted Marathon run is **re-scored
server-side** from its transcript before it counts — the posted score is never trusted.
Re-scoring reads the asset's denormalized lineages from the relational mirror
(TaxonTip/TaxonNode), so it works for blob *and* huge no-blob scopes alike.
"""
from __future__ import annotations

import datetime as dt
import re

from django.db import transaction
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip

from .models import (
    Difficulty,
    GameMode,
    DailyPin,
    DailyRotationEntry,
    GameModeConfig,
    NamedSpecies,
    PlayerStat,
    Run,
    Streak,
)
from .scoring import rescore

LEADERBOARD_LIMIT = 50


def _canonical_scope(scope: str) -> str:
    """Normalize a (possibly mixed) scope key to a stable form: components sorted and
    '+'-joined, so 'aves+mammalia' and 'mammalia+aves' are the SAME board. Mirrors the
    client's merge (frontend/src/lib/asset/merge.ts), which also sorts before joining.

    Splits on '+' OR whitespace: a literal '+' in a query string decodes to a space, so a
    board stays reachable whether the client sends %2B or a bare '+' (scope keys have no
    spaces, so this is unambiguous)."""
    parts = [p for p in re.split(r"[+\s]+", scope or "") if p]
    return "+".join(sorted(set(parts)))


def _scope_label(scope: str) -> str:
    """Display label for a (possibly mixed) scope: each component's current-build label,
    joined with ' + '. Falls back to the raw key for any component without a build."""
    parts = scope.split("+")
    labels = dict(
        AssetVersion.objects.filter(scope__in=parts, is_current=True).values_list("scope", "label")
    )
    return " + ".join(labels.get(p) or p for p in parts)


def _board_modes(mode: str) -> list[str]:
    """The modes whose ranked runs share a board. The all-time global board for a scope
    (marathon_free) ALSO counts every daily run on that scope (#46) — a daily is just a
    marathon under default/ranked settings, so daily-only players still rank globally. The
    daily board itself (mode=marathon_daily) stays its own date-indexed thing."""
    if mode == GameMode.MARATHON_FREE:
        return [GameMode.MARATHON_FREE, GameMode.MARATHON_DAILY]
    return [mode]


class GamesView(APIView):
    """GET /api/scores/games/ -> the ENABLED game modes (admin-toggled), for the Hub and
    the leaderboard game selector. Public, tiny, and cache-friendly so the SPA can poll it
    cheaply. If no config rows exist yet (fresh DB), the SPA falls back to its built-in
    Marathon card — so the game is never dark just because the table is empty."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        games = [
            {
                "mode": g.mode,
                "label": g.label,
                "blurb": g.blurb,
                "route": g.route,
                "supports_difficulty": g.supports_difficulty,
                "is_daily": g.mode.endswith("_daily"),  # the Hub shows these as the Daily strip
            }
            for g in GameModeConfig.objects.filter(enabled=True)
        ]
        return Response({"games": games})


DAILY_MODE = GameMode.MARATHON_DAILY
# The day streak is GLOBAL — one per user, advanced by playing ANY game's daily that day
# (not per game). Stored on the Streak row under this sentinel key so it survives game
# rotation. See docs/games-model.md.
DAILY_STREAK_KEY = "daily"


def _daily_plan(day: dt.date) -> tuple[str, str, str] | None:
    """The daily for `day` as (mode, scope, scope_label) — admin-driven:

      1. a manual DailyPin for that exact date wins;
      2. else the active DailyRotationEntry pool cycles by date (game + clade rotation,
         both admin-tunable);
      3. else fall back to rotating the currently-served scopes (so the daily works before
         the admin configures a pool).

    None if nothing is served yet.
    """
    def label_for(scope: str) -> str:
        lbl = (
            AssetVersion.objects.filter(scope=scope, is_current=True)
            .values_list("label", flat=True)
            .first()
        )
        return lbl or scope

    pin = DailyPin.objects.filter(date=day).first()
    if pin:
        return pin.mode, pin.scope, label_for(pin.scope)

    pool = list(DailyRotationEntry.objects.filter(active=True).values_list("mode", "scope"))
    if not pool:
        scopes = list(
            AssetVersion.objects.filter(is_current=True).order_by("scope").values_list("scope", flat=True)
        )
        if not scopes:
            return None
        pool = [(DAILY_MODE, s) for s in scopes]

    mode, scope = pool[day.toordinal() % len(pool)]
    return mode, scope, label_for(scope)


class DailyView(APIView):
    """GET /api/scores/daily/ -> today's single site-wide daily (the Hub strip reads this).
    One shared puzzle a day: a fixed scope + default settings, ranked. Carries the signed-in
    player's streak and whether they've already played today. See docs/games-model.md."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        today = dt.date.today()
        plan = _daily_plan(today)
        mode = plan[0] if plan else DAILY_MODE
        enabled = GameModeConfig.objects.filter(mode=mode, enabled=True).exists()
        data: dict = {
            "date": today.isoformat(),
            "mode": mode,
            "available": enabled and plan is not None,
            "scope": plan[1] if plan else None,
            "scope_label": plan[2] if plan else None,
        }
        if request.user.is_authenticated:
            streak = Streak.objects.filter(user=request.user, mode=DAILY_STREAK_KEY).first()
            data["streak"] = {
                "current": streak.current if streak else 0,
                "best": streak.best if streak else 0,
            }
            today_run = (
                Run.objects.filter(user=request.user, mode=mode, puzzle_date=today)
                .order_by("-score")
                .first()
            )
            data["played_today"] = today_run is not None
            data["today_score"] = today_run.score if today_run else None
        return Response(data)


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
        # Reject runs for a mode an admin has disabled (or never enabled). A missing config
        # row counts as disabled here — submitting is gated, even though reads fall back.
        if not GameModeConfig.objects.filter(mode=mode, enabled=True).exists():
            return Response({"error": "mode not enabled"}, status=400)

        # Scope may be a single key or a mix ("aves+mammalia"); canonicalize so order never
        # fragments a board (matches the client's sorted merge).
        scope = _canonical_scope(data.get("scope") or "")
        # For the daily, the scope is server-decided (today's rotation) — pin it so every
        # daily run lands on the same board regardless of what the client posts.
        is_daily = mode in (GameMode.MARATHON_DAILY, GameMode.CLASSIC)
        if is_daily:
            plan = _daily_plan(dt.date.today())
            if plan is None:
                return Response({"error": "no daily available"}, status=400)
            scope = plan[1]
            # One shot per day: the daily locks after a single play (no grinding a better
            # number). The card then shows the result instead of Play.
            if Run.objects.filter(
                user=request.user, mode=mode, puzzle_date=dt.date.today()
            ).exists():
                return Response({"error": "already played today"}, status=409)
        difficulty = data.get("difficulty") or Difficulty.COMMON
        if difficulty not in Difficulty.values:
            return Response({"error": "invalid difficulty"}, status=400)
        transcript = data.get("transcript") or []
        if not isinstance(transcript, list):
            return Response({"error": "transcript must be a list of ids"}, status=400)
        # Default ("ranked") settings → eligible for the leaderboard. A custom run still
        # records + counts toward stats, but never appears on the board.
        ranked = bool(data.get("ranked", True))

        # A mix re-scores against the UNION of each component scope's current build; the
        # shared backbone node ids are deterministic across scopes, so the merged lineage
        # maps reproduce the same induced tree the client merged client-side. A single
        # explicit asset_version only applies to a single scope (a mix always uses current).
        components = scope.split("+")
        version = data.get("asset_version")
        pin_version = int(version) if (version and len(components) == 1) else None
        assets = []
        for comp in components:
            av = _asset_for(comp, pin_version)
            if av is None:
                return Response({"error": f"no asset for scope {comp!r}"}, status=400)
            assets.append(av)

        # Pull only the lineages we need (the placed ids) from the relational mirror, across
        # every component asset.
        ids = [t for t in transcript if isinstance(t, str)]
        tip_lineages: dict[str, list[str]] = {}
        node_lineages: dict[str, list[str]] = {}
        for av in assets:
            for r in TaxonTip.objects.filter(asset=av, key__in=ids).values("key", "lineage"):
                tip_lineages[r["key"]] = r["lineage"]
            for r in TaxonNode.objects.filter(asset=av, key__in=ids).values("key", "lineage"):
                node_lineages[r["key"]] = r["lineage"]
        result = rescore(ids, tip_lineages, node_lineages)

        is_daily = mode in (GameMode.MARATHON_DAILY, GameMode.CLASSIC)
        puzzle_date = dt.date.today() if is_daily else None

        with transaction.atomic():
            run = Run.objects.create(
                user=request.user,
                mode=mode,
                scope=scope,
                difficulty=difficulty,
                score=result.score,
                asset_version=max(a.version for a in assets),
                puzzle_date=puzzle_date,
                transcript=ids,
                ranked=ranked,
            )
            if is_daily and puzzle_date is not None:
                # Global day streak — any game's daily advances the one streak.
                _bump_streak(request.user, DAILY_STREAK_KEY, puzzle_date)
            # Stats fold in EVERY finished run, ranked or not.
            _update_player_stats(request.user, mode, difficulty, result.score, result.placed_tips)

        # Rank only for ranked runs (the leaderboard ignores custom-settings runs). Among
        # distinct users with a strictly better RANKED run for this board.
        rank = None
        if ranked:
            rank_qs = Run.objects.filter(
                mode__in=_board_modes(mode), scope=scope, difficulty=difficulty, ranked=True,
                score__gt=result.score,
            )
            # The global free board is all-time across free + daily; the daily board is the
            # one specific day. (#46)
            if mode != GameMode.MARATHON_FREE:
                rank_qs = rank_qs.filter(puzzle_date=puzzle_date)
            rank = rank_qs.values("user").distinct().count() + 1
        return Response(
            {**result.as_dict(), "run_id": run.id, "rank": rank, "ranked": ranked},
            status=201,
        )


class LeaderboardView(APIView):
    """GET /api/scores/leaderboard/?mode=&scope=&date= -> top runs (best per user)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        mode = request.query_params.get("mode", GameMode.MARATHON_FREE)
        if mode not in GameMode.values:
            return Response({"error": "invalid mode"}, status=400)
        # Canonicalize so a mix matches its stored board regardless of the order the client
        # lists the clades in.
        scope = _canonical_scope(request.query_params.get("scope") or "")
        difficulty = request.query_params.get("difficulty", Difficulty.COMMON)
        if difficulty not in Difficulty.values:
            return Response({"error": "invalid difficulty"}, status=400)

        # Daily boards are date-indexed (history is kept): the scope is DERIVED from that
        # day's daily plan, not the client — and free-play boards are a single all-time
        # board per (scope, difficulty); a scope may be a mix ("aves+mammalia"). See
        # docs/games-model.md.
        is_daily = mode in (GameMode.MARATHON_DAILY, GameMode.CLASSIC)
        day = None
        scope_label = _scope_label(scope) if scope else ""
        if is_daily:
            day = _parse_date(request.query_params.get("date")) or dt.date.today()
            plan = _daily_plan(day)
            if plan is None:
                return Response({
                    "mode": mode, "scope": "", "scope_label": "", "difficulty": difficulty,
                    "date": day.isoformat(), "entries": [],
                })
            scope, scope_label = plan[1], plan[2]

        # Only ranked (default-settings) runs are comparable on a board. The global free
        # board also folds in dailies on the same scope (#46); the daily board stays the one
        # day.
        qs = Run.objects.filter(mode__in=_board_modes(mode), scope=scope, difficulty=difficulty, ranked=True)
        if day is not None:
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
        return Response({
            "mode": mode,
            "scope": scope,
            "scope_label": scope_label,
            "difficulty": difficulty,
            "date": day.isoformat() if day else None,
            "entries": rows,
        })


def _parse_date(s: str | None) -> dt.date | None:
    if not s:
        return None
    try:
        return dt.date.fromisoformat(s)
    except ValueError:
        return None


def _update_player_stats(user, mode: str, difficulty: str, score: int, placed_tips) -> None:
    """Fold one run into the per-(user, mode, difficulty) aggregate + that game's unique-
    species set. Called inside the submit transaction so stats never drift from the runs.
    The scoring unit is (mode, difficulty) — see docs/games-model.md."""
    if placed_tips:
        NamedSpecies.objects.bulk_create(
            [NamedSpecies(user=user, mode=mode, difficulty=difficulty, species_key=k)
             for k in placed_tips],
            ignore_conflicts=True,  # only species new to this (game) actually insert
        )
    unique = NamedSpecies.objects.filter(user=user, mode=mode, difficulty=difficulty).count()
    stat, _ = PlayerStat.objects.get_or_create(user=user, mode=mode, difficulty=difficulty)
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
