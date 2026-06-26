"""Admin: leaderboard / player moderation. Runs are read-only but deletable (remove a
cheating run); users are managed via the built-in auth admin (deactivate / delete)."""
from __future__ import annotations

from django.contrib import admin

from .models import (
    DailyPin,
    DailyRotationEntry,
    FrozenDaily,
    GameDefaults,
    GameModeConfig,
    GameModifier,
    NamedSpeciesSet,
    PlayerStat,
    Run,
    Streak,
)


@admin.register(GameDefaults)
class GameDefaultsAdmin(admin.ModelAdmin):
    """The default tuning values a fresh run starts from (start clock, time-per-organism,
    combo feel, visuals) — one row per GAME (Marathon's free + daily share one). The SPA reads
    these from /api/scores/game-defaults/?mode=. Per-player tweaks still ride on top in
    localStorage."""

    list_display = ("game",)

    fieldsets = (
        (None, {"fields": ("game",)}),
        ("Visual (never affect score)", {
            "fields": ("tree_layout", "show_scientific", "falling_leaves", "flash_fade_seconds"),
        }),
        ("Time + pool (easing these derates a run via setting_multipliers)", {
            "fields": ("start_seconds", "infinite_time", "time_per_new", "novelty_bonus",
                       "time_per_refinement", "extant_only"),
        }),
        ("Combos", {
            "fields": ("combo_window_seconds", "combo_time_multiplier", "combo_score_multiplier"),
        }),
        ("Clade-completion bonus", {
            "fields": ("clade_score_multiplier", "clade_min_size"),
        }),
        ("Score multipliers (#101)", {
            "fields": ("setting_multipliers",),
            "description": "Per-setting score derates for score-easing settings. Leave empty to "
                           "use the built-in default ruleset (multipliers.py).",
        }),
    )

    def has_delete_permission(self, request, obj=None) -> bool:
        return False  # a game's defaults are edited, never deleted


@admin.register(GameModifier)
class GameModifierAdmin(admin.ModelAdmin):
    """Gameplay modifiers a player opts into in the lobby (#101): each declares a score
    multiplier (harder >1, easier <1) and any incompatible siblings. The SPA reads enabled rows
    from /api/scores/modifiers/?mode=; the server resolves a run's multiplier against them."""

    list_display = ("label", "game", "key", "multiplier", "enabled", "sort_order")
    list_editable = ("multiplier", "enabled", "sort_order")
    list_filter = ("game", "enabled")
    fields = ("game", "key", "label", "blurb", "multiplier", "incompatible_with",
              "hides_settings", "forces_settings", "enabled", "sort_order")


@admin.register(DailyRotationEntry)
class DailyRotationEntryAdmin(admin.ModelAdmin):
    """The daily rotation pool — which (game, clade) entries the daily cycles through. Tune
    game + clade rotation here; the daily for a date with no pin = pool[ordinal % len]."""

    list_display = ("order", "scope", "mode", "active")
    list_editable = ("order", "scope", "mode", "active")
    list_display_links = None
    ordering = ("order", "scope")


@admin.register(DailyPin)
class DailyPinAdmin(admin.ModelAdmin):
    """Manually set the daily for a specific date — overrides the rotation that day."""

    list_display = ("date", "scope", "mode", "note")
    list_editable = ("scope", "mode", "note")
    ordering = ("-date",)


@admin.register(FrozenDaily)
class FrozenDailyAdmin(admin.ModelAdmin):
    """The RESOLVED daily for a date, frozen the first time it went live. Immutable by design
    so a build promote / rotation edit can't orphan that day's runs. Read-only: to change a
    FUTURE daily use a Daily pin; deleting a frozen row (only safe before anyone has played it)
    lets that date re-resolve from the rotation."""

    list_display = ("date", "scope", "mode", "created_at")
    ordering = ("-date",)
    readonly_fields = ("date", "mode", "scope", "created_at")

    def has_add_permission(self, request) -> bool:
        return False  # written only when a day goes live (/daily or a submit)


@admin.register(GameModeConfig)
class GameModeConfigAdmin(admin.ModelAdmin):
    """Turn a game mode on/off and set how its Hub card reads. The SPA shows only enabled
    modes — toggle one here to launch or retire a game without a deploy."""

    list_display = ("label", "mode", "enabled", "supports_difficulty", "sort_order", "route")
    list_editable = ("enabled", "sort_order")  # flip games on/off straight from the list
    list_filter = ("enabled",)
    fields = ("mode", "label", "blurb", "route", "enabled", "supports_difficulty", "sort_order")


@admin.register(Run)
class RunAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "scope", "difficulty", "score", "base_score",
                    "score_multiplier", "ranked", "puzzle_date", "created_at")
    list_filter = ("mode", "difficulty", "scope", "ranked")
    search_fields = ("user__username",)
    readonly_fields = (
        "user", "mode", "scope", "difficulty", "score", "base_score", "score_multiplier",
        "config", "ranked", "asset_version", "puzzle_date", "transcript", "created_at",
    )  # immutable record; delete to moderate, never edit


@admin.register(PlayerStat)
class PlayerStatAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "games_played", "total_named", "unique_named", "best_score",
                    "updated_at")
    search_fields = ("user__username",)
    list_filter = ("mode",)


@admin.register(Streak)
class StreakAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "current", "best", "last_played")
    search_fields = ("user__username",)


@admin.register(NamedSpeciesSet)
class NamedSpeciesSetAdmin(admin.ModelAdmin):
    """A player's unique-named-species set, stored as one roaring-bitmap blob (#55). Read-
    only: the count is the unique-animals total; the blob itself is opaque (decode via
    named_set.named_keys for a collection view)."""

    list_display = ("user", "mode", "difficulty", "count", "updated_at")
    search_fields = ("user__username",)
    list_filter = ("mode", "difficulty")
    readonly_fields = ("user", "mode", "difficulty", "count", "updated_at")
    exclude = ("bitmap",)  # opaque binary; never edited by hand

    def has_add_permission(self, request) -> bool:
        return False  # written only by run submission
