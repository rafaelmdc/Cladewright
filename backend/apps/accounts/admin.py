from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    """Display-name moderation: search/sort handles, see who has chosen one."""

    list_display = ("display_name", "user", "name_chosen", "created_at")
    list_filter = ("name_chosen",)
    search_fields = ("display_name", "user__username", "user__email")
    readonly_fields = ("created_at",)
    autocomplete_fields = ()
