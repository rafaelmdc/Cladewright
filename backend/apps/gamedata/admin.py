"""Admin: scope/asset control + the pipeline job queue."""
from __future__ import annotations

from django.contrib import admin

from .models import AssetVersion, PipelineJob


@admin.register(AssetVersion)
class AssetVersionAdmin(admin.ModelAdmin):
    """Browse built scopes and activate/deactivate which one is served. The asset itself
    is pipeline output — read-only here; serving is toggled via the actions."""

    list_display = ("scope", "label", "version", "is_current", "delivery", "pool_size", "built_at")
    list_filter = ("is_current", "scope")
    search_fields = ("scope", "label")
    ordering = ("scope", "-version")
    exclude = ("blob",)  # the whole-asset JSONB can be tens of MB — never render it
    readonly_fields = (
        "scope", "label", "version", "schema", "pool_size", "pool_size_extant",
        "hidden_label_max", "provenance", "built_at", "is_current",
    )
    actions = ["make_current", "deactivate"]

    @admin.display(description="delivery")
    def delivery(self, obj: AssetVersion) -> str:
        return "blob" if obj.blob is not None else "incremental"

    @admin.action(description="Set current — serve this build for its scope")
    def make_current(self, request, queryset):
        for av in queryset.order_by("scope", "-version"):
            AssetVersion.objects.filter(scope=av.scope, is_current=True).exclude(pk=av.pk).update(
                is_current=False
            )
            if not av.is_current:
                av.is_current = True
                av.save(update_fields=["is_current"])
        self.message_user(request, f"Set {queryset.count()} build(s) current.")

    @admin.action(description="Deactivate — stop serving (scope goes dark)")
    def deactivate(self, request, queryset):
        n = queryset.update(is_current=False)
        self.message_user(request, f"Deactivated {n} build(s).")


@admin.register(PipelineJob)
class PipelineJobAdmin(admin.ModelAdmin):
    """Queue an asset build. A separate pipeline worker (Braidworks + CoL dump) runs it —
    the web process never does the heavy build. Create a job, then watch its status/log."""

    list_display = ("scope_key", "label", "status", "enrich", "include_extinct", "created_at",
                    "finished_at", "requested_by")
    list_filter = ("status", "enrich", "include_extinct")
    search_fields = ("scope_key", "label", "scope_filter")
    readonly_fields = ("status", "log", "requested_by", "created_at", "started_at", "finished_at")
    fields = (
        "scope_key", "label", "scope_filter", "coldp_dir", "enrich", "include_extinct",
        "load_current", "status", "log", "requested_by", "created_at", "started_at", "finished_at",
    )

    def save_model(self, request, obj, form, change):
        if not change:
            obj.requested_by = request.user  # stamp who queued it
        super().save_model(request, obj, form, change)
