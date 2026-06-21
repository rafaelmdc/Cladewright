"""Admin: leaderboard / player moderation. Runs are read-only but deletable (remove a
cheating run); users are managed via the built-in auth admin (deactivate / delete)."""
from __future__ import annotations

from django.contrib import admin

from .models import NamedSpecies, PlayerStat, Run, Streak


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
