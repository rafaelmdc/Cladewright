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
    """Per-GAME default tuning a fresh run starts from — one row per game (Marathon's free +
    daily cadences are the same game, so they share a row, keyed by the game base e.g.
    ``marathon``). The SPA fetches these from ``GET /api/scores/game-defaults/?mode=`` and
    overlays them on its hardcoded fallbacks, so an admin can retune a game (start clock,
    time-per-organism, combo feel, …) without a deploy. Per-player tweaks in the in-game panel
    still ride on top, in localStorage. Mirrors the frontend GameSettings shape (see
    frontend/src/lib/game/settings.ts)."""

    # The game these defaults apply to (a base mode key like "marathon"). One row per game.
    game = models.CharField(
        max_length=32, unique=True, default="marathon",
        help_text="Game key these defaults apply to, e.g. 'marathon'.",
    )

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
    combo_score_multiplier = models.FloatField(
        default=1.0, help_text="Bonus points per combo step (× the combo level); capped per placement."
    )
    clade_score_multiplier = models.FloatField(
        default=2.0,
        help_text="Clade-completion bonus strength: points ≈ this × √(clade size). 0 disables.",
    )
    clade_min_size = models.IntegerField(
        default=3, help_text="Smallest clade size that earns a completion bonus."
    )

    # Score multiplier for score-EASING settings (#101). Every run is on the board, ranked by
    # base × multiplier; a relaxed setting (infinite time, a longer clock) derates the run
    # rather than hard-banning it. Per-setting rules, admin-tunable; empty/absent → no derate
    # (only modifiers apply). See apps/scores/multipliers.py for the rule shapes + the default.
    setting_multipliers = models.JSONField(
        default=dict, blank=True,
        help_text="Per-setting score derates: {settingKey: {kind: 'bool'|'linear', ...}}. "
                  "Empty uses the built-in default ruleset (see multipliers.py).",
    )

    class Meta:
        verbose_name = "Game defaults"
        verbose_name_plural = "Game defaults"

    def __str__(self) -> str:
        return f"Game defaults ({self.game})"

    @classmethod
    def load(cls, game: str = "marathon") -> "GameDefaults":
        obj, _ = cls.objects.get_or_create(game=game)
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
            "comboScoreMultiplier": self.combo_score_multiplier,
            "cladeScoreMultiplier": self.clade_score_multiplier,
            "cladeMinSize": self.clade_min_size,
        }


class GameModifier(models.Model):
    """An admin-tunable gameplay MODIFIER for a game (#101) — a mutator the player opts into in
    the lobby (e.g. "blind", "no tree") that changes the challenge and so the score. Every run is
    on one board, ranked by ``base × multiplier``; a modifier *declares its own multiplier* (a
    harder one >1.0, an easier one <1.0) and the run's multiplier is the product of its actives
    (× any setting derates). The server resolves the multiplier from the submitted config against
    THESE rows — never a client number. The SPA reads enabled rows from
    ``GET /api/scores/modifiers/?mode=``; adding/retuning a modifier is data, not a deploy."""

    # The game these apply to (a base mode key like "marathon"), matching GameDefaults.game.
    game = models.CharField(max_length=32, default="marathon",
                            help_text="Game key, e.g. 'marathon'.")
    key = models.CharField(max_length=32, help_text="Stable id, e.g. 'blind'. Sent in the config.")
    label = models.CharField(max_length=64, help_text="Lobby chip title, e.g. 'Blind'.")
    blurb = models.CharField(max_length=200, blank=True, help_text="One-line description.")
    multiplier = models.FloatField(
        default=1.0, help_text="Score multiplier when active. >1 harder/bonus, <1 easier."
    )
    # Other modifier KEYS (same game) this one can't combine with — the lobby greys them out and
    # the server rejects a config that posts an incompatible pair.
    incompatible_with = models.JSONField(
        default=list, blank=True, help_text="List of modifier keys incompatible with this one."
    )
    # Settings this modifier interacts with (admin-tunable, so a modifier's UI/gameplay coupling
    # is data, not code — see lib/game/modifierEffects.ts). HIDES: setting keys made irrelevant
    # (removed from the lobby/gear). FORCES: settings pinned to a value when active — shown locked
    # in the UI AND applied server-side in the multiplier resolution, so the client can't dodge
    # an eased setting's derate. Setting keys are the camelCase GameSettings names.
    hides_settings = models.JSONField(
        default=list, blank=True, help_text="Setting keys hidden when active, e.g. ['treeLayout']."
    )
    forces_settings = models.JSONField(
        default=dict, blank=True, help_text="Settings pinned when active, e.g. {'infiniteTime': true}."
    )
    enabled = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0, help_text="Lower sorts first in the lobby.")

    class Meta:
        ordering = ["sort_order", "key"]
        unique_together = ("game", "key")

    def __str__(self) -> str:
        return f"{self.label} ({self.game}:{self.key}) ×{self.multiplier}{'' if self.enabled else ' — off'}"


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


class FrozenDaily(models.Model):
    """The RESOLVED daily for a date, frozen the first time that day goes live (served by
    /daily, or a run submitted for it). Once written it is immutable: the rotation and admin
    pins are only ever *generators* for a not-yet-seen day — so promoting a build or editing
    the rotation can never re-bucket a day that's already been played and orphan its runs.

    Distinct from DailyPin (admin INTENT) on purpose: this is system RESOLUTION, and it must
    win over a later pin edit for an already-live date. _daily_plan consults this first."""

    date = models.DateField(unique=True, help_text="The day this resolution applies to.")
    mode = models.CharField(max_length=32, choices=GameMode.choices, default=GameMode.MARATHON_DAILY)
    scope = models.CharField(max_length=128, help_text="The scope key this day was frozen to.")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date"]
        verbose_name_plural = "Frozen dailies"

    def __str__(self) -> str:
        return f"{self.date}: {self.scope} [{self.mode}] (frozen)"


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
    # Canonical leaderboard score = base × multiplier, server-computed (never the client's
    # posted number). This is what the board orders by, so a default run and a modified run
    # are directly comparable on one board (#101).
    score = models.IntegerField(default=0)
    # The server-re-scored result BEFORE the multiplier (placements + combo/clade bonuses),
    # kept for audit/replay alongside the resolved multiplier.
    base_score = models.IntegerField(default=0)
    # Multiplier the server resolved from this run's config (∏ active modifiers × ∏ setting
    # derates). 1.0 = default setup. score = round(base_score × score_multiplier).
    score_multiplier = models.FloatField(default=1.0)
    # The resolved GameConfig this run was played + scored under (mode, difficulty, scopes,
    # settings delta, modifiers) — the audit/replay seed. See docs/lobby-and-config.md.
    config = models.JSONField(default=dict, blank=True)
    asset_version = models.IntegerField()
    # Daily modes: the puzzle date this run belongs to (null for free play).
    puzzle_date = models.DateField(null=True, blank=True)
    # The validated run transcript (ordered placed target ids) the server re-scored from,
    # kept so a run is reproducible/auditable.
    transcript = models.JSONField(default=list, blank=True)
    # ANTI-CHEAT eligibility (#101: no longer "used default settings"). A run reaches the
    # leaderboard only if it came from a valid signed session at a humanly-plausible pace;
    # a failed check still records to stats but stays off the board. Custom settings/modifiers
    # NO LONGER un-rank a run — they resolve to a multiplier instead.
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
    # Distinct species ever named (mirrors NamedSpeciesSet.count) — "unique animals named".
    unique_named = models.IntegerField(default=0)
    best_score = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("user", "mode", "difficulty")


class SpeciesToken(models.Model):
    """Global intern dictionary: a species tip id -> a stable, never-reused integer token
    (the row pk). Named-set membership bitmaps address species by this token instead of the
    128-char string, so the dictionary is stored ONCE site-wide rather than per user.

    The pk is a 32-bit AutoField on purpose: roaring bitmaps (NamedSpeciesSet) index by
    uint32, and the token space is bounded by the distinct species ever named across the
    whole site (≤ the catalog's few-million taxa) — far inside 2**31. Tokens are interned
    once and never recycled, so a stored bitmap stays valid for the life of the species. See
    apps/scores/named_set.py."""

    id = models.AutoField(primary_key=True)
    species_key = models.CharField(max_length=128, unique=True)  # tip id, e.g. "tip:Panthera_leo"

    def __str__(self) -> str:
        return f"{self.id}:{self.species_key}"


class NamedSpeciesSet(models.Model):
    """A player's whole unique-named-species set for one (mode, difficulty), as a single
    roaring-bitmap blob over SpeciesToken ids — the compact replacement for the old one-row-
    per-species table (#55). Each run ORs its placements in (see named_set.add_named); the
    account page reads the cached cardinality off PlayerStat.unique_named, so this is never
    scanned on a hot path. Decode it with named_set.named_keys for a future collection view."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="named_species_sets"
    )
    mode = models.CharField(max_length=32, choices=GameMode.choices)
    # Per (mode, difficulty), matching PlayerStat — a species named in Common and in
    # Scientific belongs to each game's collection separately.
    difficulty = models.CharField(
        max_length=16, choices=Difficulty.choices, default=Difficulty.COMMON
    )
    # Serialized pyroaring BitMap (portable CRoaring format) of SpeciesToken ids.
    bitmap = models.BinaryField(default=bytes, blank=True)
    # Cached cardinality (len of the bitmap) so a count never deserializes the blob; mirrors
    # PlayerStat.unique_named.
    count = models.IntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "mode", "difficulty"], name="uniq_named_set_user_mode_difficulty"
            ),
        ]
