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
    blurb = models.CharField(max_length=240, blank=True, help_text="Card subtitle.")
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


class GameDefaults(models.Model):
    """Singleton: the default tuning values a fresh run starts from. The SPA fetches these
    from ``GET /api/scores/game-defaults/`` and overlays them on its hardcoded fallbacks, so an
    admin can retune the game (start clock, time-per-organism, combo feel, …) without a deploy.
    Per-player tweaks in the in-game panel still ride on top, in localStorage. Mirrors the
    frontend GameSettings shape (see frontend/src/lib/game/settings.ts)."""

    LAYOUT_CHOICES = [("radial", "Radial"), ("rectangular", "Phylogram")]

    # Visual (never affects ranked status).
    tree_layout = models.CharField(max_length=16, choices=LAYOUT_CHOICES, default="radial")
    show_scientific = models.BooleanField(default=True)
    falling_leaves = models.BooleanField(default=True)
    flash_fade_seconds = models.FloatField(
        default=2, help_text="How long a '+seconds' / 'no match' card lingers before fading."
    )
    # Score-affecting (changing these off-default un-ranks a run).
    extant_only = models.BooleanField(default=True)
    infinite_time = models.BooleanField(default=False)
    start_seconds = models.IntegerField(default=60)
    time_per_new = models.IntegerField(default=10)
    novelty_bonus = models.IntegerField(default=8)
    time_per_refinement = models.IntegerField(default=5)
    combo_window_seconds = models.FloatField(
        default=6, help_text="Max gap (seconds) between placements to keep a combo alive."
    )
    combo_time_multiplier = models.FloatField(
        default=1.5, help_text="Bonus seconds per combo step (× the combo level)."
    )

    class Meta:
        verbose_name = "Game defaults"
        verbose_name_plural = "Game defaults"

    def __str__(self) -> str:
        return "Game defaults"

    def save(self, *args, **kwargs):
        self.pk = 1  # singleton — there is only ever one row
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "GameDefaults":
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def as_settings(self) -> dict:
        """camelCase payload matching the frontend GameSettings."""
        return {
            "treeLayout": self.tree_layout,
            "showScientific": self.show_scientific,
            "fallingLeaves": self.falling_leaves,
            "flashFadeSeconds": self.flash_fade_seconds,
            "extantOnly": self.extant_only,
            "infiniteTime": self.infinite_time,
            "startSeconds": self.start_seconds,
            "timePerNew": self.time_per_new,
            "noveltyBonus": self.novelty_bonus,
            "timePerRefinement": self.time_per_refinement,
            "comboWindowSeconds": self.combo_window_seconds,
            "comboTimeMultiplier": self.combo_time_multiplier,
        }


class DailyRotationEntry(models.Model):
    """One (game, clade) entry in the daily rotation pool. The daily for a date with no
    manual pin cycles deterministically through the ACTIVE entries by date — so the admin
    tunes both the GAME rotation (mode) and the CLADE rotation (scope) here, no deploy. If
    the pool is empty, the daily falls back to rotating the currently-served scopes. See
    docs/games-model.md."""

    mode = models.CharField(
        max_length=32, choices=GameMode.choices, default=GameMode.MARATHON_DAILY,
        help_text="The daily game for this entry (e.g. Marathon daily).",
    )
    scope = models.CharField(max_length=128, help_text="AssetVersion scope key, e.g. 'mammalia'.")
    order = models.IntegerField(default=0, help_text="Rotation position (lower cycles first).")
    active = models.BooleanField(default=True)

    class Meta:
        ordering = ["order", "scope"]
        unique_together = ("mode", "scope")
        verbose_name_plural = "Daily rotation entries"

    def __str__(self) -> str:
        return f"{self.scope} [{self.mode}]{'' if self.active else ' — off'}"


class DailyPin(models.Model):
    """A manual daily for a specific date — overrides the rotation that day. Admin-set, so a
    specific date can feature a hand-picked game + clade."""

    date = models.DateField(help_text="The day this daily applies to.")
    mode = models.CharField(max_length=32, choices=GameMode.choices, default=GameMode.MARATHON_DAILY)
    scope = models.CharField(max_length=128, help_text="AssetVersion scope key, e.g. 'aves'.")
    note = models.CharField(max_length=200, blank=True, help_text="Optional admin note.")

    class Meta:
        ordering = ["-date"]
        # Per (date, mode): each game can have its own pinned daily on a given day.
        unique_together = ("date", "mode")

    def __str__(self) -> str:
        return f"{self.date}: {self.scope} [{self.mode}]"


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
    # Whether this run used the default ("ranked") settings. EVERY finished run counts
    # toward the player's stats, but only ranked runs appear on the leaderboard — a custom
    # run (more time, infinite clock, …) isn't comparable to others.
    ranked = models.BooleanField(default=True)
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
    # The scoring unit is (mode, difficulty): "Marathon · Common" and "Marathon · Scientific"
    # are separate games with separate stat rows. See docs/games-model.md.
    difficulty = models.CharField(
        max_length=16, choices=Difficulty.choices, default=Difficulty.COMMON
    )
    games_played = models.IntegerField(default=0)
    # Cumulative species placements across sessions (a species named in two runs counts
    # twice) — "total animals named".
    total_named = models.IntegerField(default=0)
    # Distinct species ever named (mirrors NamedSpecies count) — "unique animals named".
    unique_named = models.IntegerField(default=0)
    best_score = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "mode", "difficulty")


class NamedSpecies(models.Model):
    """Every distinct species a user has ever named, per mode — the unique-animals set and
    the foundation for future 'collection' features. Small indexed rows; the account page
    never scans this (it reads PlayerStat.unique_named), so it stays cheap."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="named_species"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    # Per (mode, difficulty), matching PlayerStat — a species named in Common and in
    # Scientific is a distinct entry in each game's collection.
    difficulty = models.CharField(
        max_length=16, choices=Difficulty.choices, default=Difficulty.COMMON
    )
    species_key = models.CharField(max_length=128)  # tip id, e.g. "tip:Panthera_leo"
    first_named_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "mode", "difficulty", "species_key"],
                name="uniq_user_mode_difficulty_species",
            ),
        ]
        indexes = [models.Index(fields=["user", "mode", "difficulty"])]
