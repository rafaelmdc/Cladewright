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


class Difficulty(models.TextChoices):
    """How names are shown in play — and a separate leaderboard per choice. 'common' shows
    vernacular names; 'scientific' shows Latin only (harder to recognise what you've placed
    and what's missing)."""

    COMMON = "common", "Common names"
    SCIENTIFIC = "scientific", "Scientific only"


class GameModeConfig(models.Model):
    """Admin-controlled on/off (and presentation) for each game mode. The Hub and the
    leaderboard read the ENABLED rows from /api/scores/games/, so an admin can launch or
    retire a game without a deploy. v1 ships only Marathon (free play) enabled; the daily
    + classic modes exist as disabled rows, ready to flip on."""

    mode = models.CharField(max_length=32, choices=GameMode.choices, unique=True)
    label = models.CharField(max_length=64, help_text="Card title, e.g. 'Marathon'.")
    blurb = models.CharField(max_length=160, blank=True, help_text="Card subtitle.")
    # SPA route the card links to (difficulty is appended as ?difficulty=). Kept in config
    # so a new mode is data, not a frontend special-case.
    route = models.CharField(max_length=64, default="/marathon")
    enabled = models.BooleanField(default=False)
    supports_difficulty = models.BooleanField(
        default=True, help_text="Whether Common/Scientific (and split boards) apply."
    )
    sort_order = models.IntegerField(default=0, help_text="Lower sorts first on the Hub.")

    class Meta:
        ordering = ["sort_order", "label"]

    def __str__(self) -> str:
        return f"{self.label} ({self.mode}){'' if self.enabled else ' — disabled'}"


class Run(models.Model):
    """One completed game. For Marathon, ``score`` = tips placed."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="runs"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    # Which scope this run was played on (e.g. "mammalia", "fish") — leaderboards are
    # per-scope since the pools differ. Blank for scope-agnostic modes.
    scope = models.CharField(max_length=128, blank=True, default="")
    # Difficulty (Common vs Scientific) — its own leaderboard, since the two play
    # differently.
    difficulty = models.CharField(
        max_length=16, choices=Difficulty.choices, default=Difficulty.COMMON
    )
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
            # Leaderboard reads: a mode+scope+difficulty(+day) ordered by score.
            models.Index(fields=["mode", "scope", "difficulty", "puzzle_date", "-score"]),
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


class PlayerStat(models.Model):
    """Per-(user, mode) aggregate, updated on each run submit — the account page reads
    these directly (no scanning of Runs). One row per game a player has touched, so
    adding a game mode is data, not schema. Marathon-only at launch, by design extensible."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="mode_stats"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    games_played = models.IntegerField(default=0)
    # Cumulative species placements across sessions (a species named in two runs counts
    # twice) — "total animals named".
    total_named = models.IntegerField(default=0)
    # Distinct species ever named (mirrors NamedSpecies count) — "unique animals named".
    unique_named = models.IntegerField(default=0)
    best_score = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "mode")


class NamedSpecies(models.Model):
    """Every distinct species a user has ever named, per mode — the unique-animals set and
    the foundation for future 'collection' features. Small indexed rows; the account page
    never scans this (it reads PlayerStat.unique_named), so it stays cheap."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="named_species"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    species_key = models.CharField(max_length=128)  # tip id, e.g. "tip:Panthera_leo"
    first_named_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "mode", "species_key"], name="uniq_user_mode_species"
            ),
        ]
        indexes = [models.Index(fields=["user", "mode"])]
