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
    the web process never does the heavy build. Create a job: it enqueues onto Redis and a
    worker picks it up; watch status/log refresh here. Re-queue a finished/stuck job with
    the action below."""

    list_display = ("kind", "scope_key", "label", "status_badge", "enrich", "include_extinct",
                    "created_at", "finished_at", "requested_by")
    list_filter = ("kind", "status", "enrich", "include_extinct")
    search_fields = ("scope_key", "label", "scope_filter")
    readonly_fields = ("status", "log", "requested_by", "created_at", "started_at", "finished_at")
    fieldsets = (
        (None, {
            "fields": ("kind",),
            "description": "Build an asset, or download a fresh CoL dump (replaces the old "
                           "one). A separate worker runs the job — refresh to watch status.",
        }),
        ("Build asset (ignored for a Download job)", {
            "fields": ("scope_key", "label", "scope_filter", "enrich", "include_extinct",
                       "load_current"),
        }),
        ("Source / lifecycle", {
            "fields": ("coldp_dir", "status", "log", "requested_by", "created_at",
                       "started_at", "finished_at"),
        }),
    )
    actions = ["requeue"]

    @admin.display(description="status", ordering="status")
    def status_badge(self, obj: PipelineJob) -> str:
        from django.utils.html import format_html
        color = {
            obj.Status.QUEUED: "#8a7e5e", obj.Status.RUNNING: "#3f6b4c",
            obj.Status.SUCCEEDED: "#2e7d32", obj.Status.FAILED: "#b03030",
        }.get(obj.status, "#555")
        return format_html(
            '<b style="color:{}">{}</b>', color, obj.get_status_display()
        )

    def _enqueue(self, job: PipelineJob) -> None:
        # Lazy import: keeps the admin module importable even if Celery isn't configured in
        # some odd context, and matches the web-never-builds boundary.
        from .tasks import run_pipeline_job
        run_pipeline_job.delay(job.id)

    def save_model(self, request, obj, form, change):
        first_time = not change
        if first_time:
            obj.requested_by = request.user  # stamp who queued it
        super().save_model(request, obj, form, change)
        if first_time:
            self._enqueue(obj)
            self.message_user(request, f"Queued build for '{obj.scope_key}' — a worker will "
                                       "pick it up; refresh to watch status.")

    @admin.action(description="Re-queue — run this build again on a worker")
    def requeue(self, request, queryset):
        for job in queryset:
            job.status = PipelineJob.Status.QUEUED
            job.started_at = job.finished_at = None
            job.log = ""
            job.save(update_fields=["status", "started_at", "finished_at", "log"])
            self._enqueue(job)
        self.message_user(request, f"Re-queued {queryset.count()} job(s).")
