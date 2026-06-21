"""
Score / streak persistence.

Scope (Phase 4): a Marathon run result, a Classic daily result, and per-user
streaks. Leaderboard scores are validated server-side at submit time — never trust
a posted number (see docs/architecture.md). Schema below is a starting point;
refine when Phase 3/5 game state is concrete.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class GameMode(models.TextChoices):
    MARATHON_DAILY = "marathon_daily", "Marathon (daily)"
    MARATHON_FREE = "marathon_free", "Marathon (free play)"
    CLASSIC = "classic", "Classic (daily)"


class Run(models.Model):
    """One completed game. For Marathon, ``score`` = tips placed."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="runs"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    # Which scope this run was played on (e.g. "mammalia", "fish") — leaderboards are
    # per-scope since the pools differ. Blank for scope-agnostic modes.
    scope = models.CharField(max_length=128, blank=True, default="")
    # Canonical, server-re-scored result (never the client's posted number).
    score = models.IntegerField(default=0)
    asset_version = models.IntegerField()
    # Daily modes: the puzzle date this run belongs to (null for free play).
    puzzle_date = models.DateField(null=True, blank=True)
    # The validated run transcript (ordered placed target ids) the server re-scored from,
    # kept so a run is reproducible/auditable.
    transcript = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            # Leaderboard reads: a mode+scope(+day) ordered by score.
            models.Index(fields=["mode", "scope", "puzzle_date", "-score"]),
            models.Index(fields=["user", "mode"]),
        ]


class Streak(models.Model):
    """Per-user, per-daily-mode current/best streak."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="streaks"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    current = models.IntegerField(default=0)
    best = models.IntegerField(default=0)
    last_played = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = ("user", "mode")
