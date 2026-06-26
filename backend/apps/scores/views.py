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
import time

from django.db import transaction
from django.utils import timezone
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
    FrozenDaily,
    GameDefaults,
    GameModeConfig,
    PlayerStat,
    Run,
    Streak,
)
from .named_set import add_named
from .scoring import rescore
from .sessions import issue_run_token, verify_run_token

LEADERBOARD_LIMIT = 50

# Anti-cheat bound on a ranked run: the most placements a human could plausibly make per
# second of real wall-clock. A fast typist sustains ~2/s; 5 leaves generous headroom while
# still rejecting an "instant" dump-the-whole-tree submission. See #77 / sessions.py.
MAX_PLACEMENTS_PER_SECOND = 5
# Slack (seconds) added to the measured elapsed when checking timings/placement rate, to
# absorb clock skew and the request's own latency.
RATE_SLACK_SECONDS = 3


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


def _defaults_game(mode: str | None) -> str:
    """The GAME a mode's defaults belong to. Marathon's free + daily cadences are one game, so
    they share a GameDefaults row keyed by the base ("marathon_free"/"marathon_daily" →
    "marathon"; "classic" → "classic")."""
    return (mode or "marathon").split("_")[0]


class GameDefaultsView(APIView):
    """GET /api/scores/game-defaults/?mode= -> a game's admin-configured default tuning values,
    in the frontend GameSettings shape. Public; the SPA overlays them on its hardcoded
    fallbacks so a fresh run starts from whatever the admin set (see docs/admin.md)."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        game = _defaults_game(request.query_params.get("mode"))
        return Response(GameDefaults.load(game).as_settings())


DAILY_MODE = GameMode.MARATHON_DAILY
# The day streak is GLOBAL — one per user, advanced by playing ANY game's daily that day
# (not per game). Stored on the Streak row under this sentinel key so it survives game
# rotation. See docs/games-model.md.
DAILY_STREAK_KEY = "daily"


def _scope_display(scope: str) -> str:
    lbl = (
        AssetVersion.objects.filter(scope=scope, is_current=True)
        .values_list("label", flat=True)
        .first()
    )
    return lbl or scope


def _daily_plan(day: dt.date) -> tuple[str, str, str] | None:
    """The daily for `day` as (mode, scope, scope_label) — resolved in precedence order:

      0. a FrozenDaily for that date wins, ALWAYS. Once a day has gone live it's immutable,
         so promoting a build / editing the rotation can't re-bucket it and orphan its runs;
      1. else a manual DailyPin for that exact date (admin intent);
      2. else the active DailyRotationEntry pool cycles by date (game + clade rotation);
      3. else fall back to rotating the currently-served scopes (so the daily works before
         the admin configures a pool).

    This is a pure READ — steps 1–3 are only *generators* for a not-yet-frozen day. Call
    freeze_daily() to pin the result the moment a day becomes real. None if nothing is served.
    """
    frozen = FrozenDaily.objects.filter(date=day).values_list("mode", "scope").first()
    if frozen:
        return frozen[0], frozen[1], _scope_display(frozen[1])

    pin = DailyPin.objects.filter(date=day).first()
    if pin:
        return pin.mode, pin.scope, _scope_display(pin.scope)

    pool = list(DailyRotationEntry.objects.filter(active=True).values_list("mode", "scope"))
    if not pool:
        scopes = list(
            AssetVersion.objects.filter(is_current=True).order_by("scope").values_list("scope", flat=True)
        )
        if not scopes:
            return None
        pool = [(DAILY_MODE, s) for s in scopes]

    mode, scope = pool[day.toordinal() % len(pool)]
    return mode, scope, _scope_display(scope)


def freeze_daily(day: dt.date) -> tuple[str, str, str] | None:
    """Resolve `day`'s daily and FREEZE it (idempotent). The first caller for a date writes
    the FrozenDaily row from the live rotation/pin; every later call — and every _daily_plan
    read, for any purpose — returns that same frozen value. Called at the two moments a day
    becomes real: served as today's daily (/daily) and a run submitted for it. Bounded to the
    day in question, so a public read can never freeze an arbitrary browsed date."""
    plan = _daily_plan(day)
    if plan is None:
        return None
    # _daily_plan already returns the frozen row if it exists; otherwise create from the plan.
    # get_or_create on the unique date settles concurrent first-hits to one winner.
    FrozenDaily.objects.get_or_create(
        date=day, defaults={"mode": plan[0], "scope": plan[1]}
    )
    return plan


class DailyView(APIView):
    """GET /api/scores/daily/ -> today's single site-wide daily (the Hub strip reads this).
    One shared puzzle a day: a fixed scope + default settings, ranked. Carries the signed-in
    player's streak and whether they've already played today. See docs/games-model.md."""

    permission_classes: list = []

    def get(self, request: Request) -> Response:
        today = timezone.localdate()
        # Serving today's daily is the moment it becomes real → freeze it. Every later
        # read (submit, leaderboard) then matches this exact (mode, scope) forever.
        plan = freeze_daily(today)
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


class StartRunView(APIView):
    """POST /api/scores/runs/start/ -> a signed run-session token (see sessions.py). The
    client fetches one when a run begins and returns it at submit; it anchors the run's
    timings to a real server start time so the combo score can't be forged (#77). Auth
    required (a token is bound to the user)."""

    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        return Response({"token": issue_run_token(request.user.id)}, status=201)


def _combo_bonus_args(timings, transcript, token_payload, defaults) -> dict:
    """Decide whether a run's client-supplied ``timings`` are trustworthy enough to score
    combos from, and return the kwargs for ``rescore`` (combo params only when they are).

    Trust requires a valid signed run session AND timings that are internally consistent
    (right length, monotonic, non-negative) AND bounded by the real wall-clock elapsed since
    the session started — both the latest timing and the overall placement rate. Anything
    off → no combo bonus (base placements still score). Returns ``{}`` (no combo) or the
    combo kwargs; ranking plausibility is judged separately by the caller."""
    if token_payload is None or not isinstance(timings, list) or len(timings) != len(transcript):
        return {}
    if any(not isinstance(t, (int, float)) for t in timings):
        return {}
    # Monotonic non-decreasing, starting at/after 0.
    if timings and (timings[0] < 0 or any(b < a for a, b in zip(timings, timings[1:]))):
        return {}
    elapsed = time.time() - token_payload["t"] + RATE_SLACK_SECONDS
    # The last placement can't be after the run's real elapsed time.
    if timings and timings[-1] / 1000 > elapsed:
        return {}
    return {
        "timings": timings,
        "combo_window_seconds": defaults.combo_window_seconds,
        "combo_multiplier": defaults.combo_score_multiplier,
    }


def _rate_plausible(token_payload, placements: int) -> bool:
    """A ranked run must not claim more placements than a human could make in the real
    elapsed wall-clock (catches an instant dump-the-whole-tree submission). Without a valid
    session we can't measure elapsed, so the run can't be ranked."""
    if token_payload is None:
        return False
    elapsed = time.time() - token_payload["t"] + RATE_SLACK_SECONDS
    return placements <= elapsed * MAX_PLACEMENTS_PER_SECOND


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
        today = timezone.localdate()
        if is_daily:
            # freeze_daily pins (mode, scope) for today if /daily hasn't already — so a run is
            # ALWAYS stored under the same scope the board will read, immune to a build promote
            # or rotation edit between now and the read.
            plan = freeze_daily(today)
            if plan is None:
                return Response({"error": "no daily available"}, status=400)
            scope = plan[1]
            # One shot per day: the daily locks after a single play (no grinding a better
            # number). The card then shows the result instead of Play.
            if Run.objects.filter(
                user=request.user, mode=mode, puzzle_date=today
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

        # Signed run session (#77): verifies this run was started via the server and gives a
        # trusted start time. Combos only score from timings when the session is valid AND
        # the timings are consistent + within the real elapsed wall-clock; a ranked run also
        # has to pass the placement-rate sanity check, else it drops to unranked (still
        # recorded to stats, just off the board).
        token_payload = verify_run_token(data.get("run_token"), request.user.id)
        timings = data.get("timings")

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

        defaults = GameDefaults.load(_defaults_game(mode))
        combo_kwargs = _combo_bonus_args(timings, ids, token_payload, defaults)

        # Clade-completion bonus: pull the species denominator for every ANCESTOR clade of a
        # placed tip (not just the named ids), so the server can detect a clade going fully
        # named. A ranked run is default settings → use the admin's extant_only; a custom run
        # may differ, so honour its claim (it's off-board anyway, this only matches the HUD).
        extant_only = defaults.extant_only if ranked else bool(data.get("extant_only", defaults.extant_only))
        ancestor_ids = {a for lin in tip_lineages.values() for a in lin}
        node_pool_counts: dict[str, int] = {}
        if ancestor_ids and defaults.clade_score_multiplier > 0:
            count_field = "pool_count_extant" if extant_only else "pool_count"
            for av in assets:
                for r in TaxonNode.objects.filter(asset=av, key__in=ancestor_ids).values("key", count_field):
                    # Across a mix, a shared backbone node's denominator is the union pool;
                    # sum the components (disjoint species sets) so completion needs them all.
                    node_pool_counts[r["key"]] = node_pool_counts.get(r["key"], 0) + r[count_field]
        result = rescore(
            ids, tip_lineages, node_lineages,
            node_pool_counts=node_pool_counts,
            clade_multiplier=defaults.clade_score_multiplier,
            clade_min_size=defaults.clade_min_size,
            **combo_kwargs,
        )

        # A ranked run must come from a valid session at a humanly-plausible pace; otherwise
        # it still records (stats) but doesn't reach the leaderboard.
        if ranked and not _rate_plausible(token_payload, result.base):
            ranked = False

        puzzle_date = today if is_daily else None

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
            day = _parse_date(request.query_params.get("date")) or timezone.localdate()
            plan = _daily_plan(day)  # read-only: never freezes a browsed/empty date
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
            "user_id", "user__username", "user__profile__display_name", "score", "created_at"
        )[: LEADERBOARD_LIMIT * 4]:
            if r["user_id"] in seen:
                continue
            seen.add(r["user_id"])
            rows.append(
                {
                    "rank": len(rows) + 1,
                    "user": r["user__profile__display_name"] or r["user__username"],
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
    # The unique-species set is a single roaring-bitmap row (#55): OR this run's placements
    # in and read back the new cardinality (no per-species rows to insert or count).
    unique = add_named(user, mode, difficulty, list(placed_tips))
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
