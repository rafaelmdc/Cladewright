"""Admin: leaderboard / player moderation. Runs are read-only but deletable (remove a
cheating run); users are managed via the built-in auth admin (deactivate / delete)."""
from __future__ import annotations

from django.contrib import admin

from .models import (
    DailyPin,
    DailyRotationEntry,
    GameDefaults,
    GameModeConfig,
    NamedSpecies,
    PlayerStat,
    Run,
    Streak,
)


@admin.register(GameDefaults)
class GameDefaultsAdmin(admin.ModelAdmin):
    """The default tuning values a fresh run starts from (start clock, time-per-organism,
    combo feel, visuals). Singleton: edit the one row; the SPA reads it from
    /api/scores/game-defaults/. Per-player tweaks still ride on top in localStorage."""

    fieldsets = (
        ("Visual (don't affect ranked)", {
            "fields": ("tree_layout", "show_scientific", "falling_leaves", "flash_fade_seconds"),
        }),
        ("Time + pool (changing off-default un-ranks a run)", {
            "fields": ("start_seconds", "infinite_time", "time_per_new", "novelty_bonus",
                       "time_per_refinement", "extant_only"),
        }),
        ("Combos", {"fields": ("combo_window_seconds", "combo_time_multiplier")}),
    )

    def has_add_permission(self, request) -> bool:
        return not GameDefaults.objects.exists()  # singleton — only ever one row

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


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
    list_display = ("user", "mode", "scope", "difficulty", "score", "puzzle_date", "created_at")
    list_filter = ("mode", "difficulty", "scope")
    search_fields = ("user__username",)
    readonly_fields = (
        "user", "mode", "scope", "difficulty", "score", "asset_version", "puzzle_date",
        "transcript", "created_at",
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


@admin.register(NamedSpecies)
class NamedSpeciesAdmin(admin.ModelAdmin):
    list_display = ("user", "mode", "species_key", "first_named_at")
    search_fields = ("user__username", "species_key")
    list_filter = ("mode",)
