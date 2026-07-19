from django.contrib import admin

from .models import MatchResult


@admin.register(MatchResult)
class MatchResultAdmin(admin.ModelAdmin):
    list_display = ("match_id", "scope", "player0", "player1", "winner", "rounds",
                    "ranked", "flagged", "created_at")
    list_filter = ("ranked", "flagged", "scope", "engine_id")
    search_fields = ("match_id", "player0__username", "player1__username")
    readonly_fields = [f.name for f in MatchResult._meta.fields]  # settled record, view-only

    def has_add_permission(self, request):
        return False
