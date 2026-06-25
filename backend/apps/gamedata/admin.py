"""Admin: scope/asset control + the pipeline job queue."""
from __future__ import annotations

from django.contrib import admin

from .models import Alias, AssetVersion, ManualAlias, PipelineJob, TaxonNode, TaxonTip


@admin.register(TaxonTip)
class TaxonTipAdmin(admin.ModelAdmin):
    """Browse an asset's playable species — search a name to find the id to alias. Read-only
    (the asset is pipeline output); aliasing is done via Manual aliases."""

    # Ordered by fame (enwiki pageviews / sitelink fallback): filter to a scope and the list
    # IS its popularity ranking — the most-famous species first, the obscure tail last.
    list_display = ("fame", "common", "sci", "key", "asset")
    list_filter = ("asset",)
    search_fields = ("sci", "common", "key")
    list_select_related = ("asset",)
    ordering = ("-fame", "key")

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False  # view-only

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(TaxonNode)
class TaxonNodeAdmin(admin.ModelAdmin):
    """Browse an asset's clade nodes (read-only)."""

    list_display = ("sci", "common", "rank", "key", "asset")
    list_filter = ("asset", "rank")
    search_fields = ("sci", "common", "key")
    list_select_related = ("asset",)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


@admin.register(ManualAlias)
class ManualAliasAdmin(admin.ModelAdmin):
    """Curate extra aliases CoL/enrichment miss (e.g. 'chicken' → tip:Gallus_gallus). Saved
    aliases apply immediately to the scope's current asset and survive rebuilds. Find the
    target id under Taxon tips / Taxon nodes."""

    list_display = ("name", "norm", "scope", "target_kind", "target_key", "note", "created_at")
    list_filter = ("scope", "target_kind")
    search_fields = ("name", "norm", "target_key")
    readonly_fields = ("norm", "created_at")


@admin.register(Alias)
class AliasAdmin(admin.ModelAdmin):
    """The live (baked + mirrored) alias index — read-only; handy to confirm a manual alias
    landed on the current asset."""

    list_display = ("norm", "target_kind", "target_key", "sci", "asset")
    list_filter = ("asset", "target_kind")
    search_fields = ("norm", "target_key", "sci")
    list_select_related = ("asset",)

    def has_add_permission(self, request) -> bool:
        return False

    def has_change_permission(self, request, obj=None) -> bool:
        return False

    def has_delete_permission(self, request, obj=None) -> bool:
        return False


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
    actions = ["make_current", "deactivate", "delete_superseded"]

    @admin.display(description="delivery")
    def delivery(self, obj: AssetVersion) -> str:
        return "blob" if obj.blob is not None else "incremental"

    @admin.action(description="Delete superseded — purge non-current versions of the selected scope(s)")
    def delete_superseded(self, request, queryset):
        # Bulk-delete every NON-current version of the touched scopes (cascades to
        # nodes/tips/aliases). Skips the stock delete-confirmation's per-row enumeration,
        # which can hang on a big asset; the current build is always safe (never selected).
        scopes = sorted(set(queryset.values_list("scope", flat=True)))
        removed, _ = AssetVersion.objects.filter(scope__in=scopes, is_current=False).delete()
        self.message_user(
            request,
            f"Purged superseded versions for {len(scopes)} scope(s) "
            f"({removed} rows incl. nodes/tips/aliases). Current builds kept.",
        )

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
                           "one). A separate worker runs the job — refresh to watch status. "
                           "Standard scope filters (mammalia/aves/reptilia/amphibia/fish) are "
                           "listed in docs/pipeline-jobs.md.",
        }),
        ("Build asset (ignored for a Download job)", {
            "fields": ("scope_key", "label", "scope_filter", "enrich", "include_extinct",
                       "load_current", "delete_old"),
        }),
        ("Notable blob (delivery)", {
            "fields": ("notable_max", "notable_coverage", "notable_min", "frontier_rank",
                       "fame_dump"),
            "description": "How much of the scope ships as the local client blob. Leave "
                           "notable_max=0 to ship the whole pool (fine up to ~20k tips). For a "
                           "huge scope, set notable_max (~20000) → hybrid: a top-fame blob + the "
                           "rest via search/resolve. fame_dump points fame at a Wikimedia "
                           "pageview dump for million-tip scopes.",
        }),
        ("Source / lifecycle", {
            "fields": ("coldp_dir", "status", "log", "requested_by", "created_at",
                       "started_at", "finished_at"),
        }),
    )
    actions = ["requeue", "force_rerun", "purge_jobs"]

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

    @admin.action(description="Force re-run — purge stale queue messages, then re-dispatch")
    def force_rerun(self, request, queryset):
        """Recovery for a jam: drain the broker queue of stale/duplicate messages, then
        reset + re-dispatch the selected job(s) fresh. Use when plain Re-queue didn't take
        because the queue was clogged. NOTE: this can't revive a worker stuck on a dead
        Redis connection — that needs the worker pod restarted (and the broker-resilience
        fix deployed). It clears the queue and re-dispatches; the worker must be alive to
        pick the jobs up."""
        from django.contrib import messages

        purged = 0
        try:
            # Drain the default Celery queue directly on the broker (doesn't depend on a
            # live worker, unlike app.control.purge()).
            from cladewright.celery import app
            with app.connection_for_write() as conn:
                purged = conn.default_channel.queue_purge("celery") or 0
        except Exception as exc:  # noqa: BLE001 - broker may be unreachable; still re-dispatch
            self.message_user(
                request, f"Couldn't purge the queue ({exc}); re-dispatching anyway.",
                level=messages.WARNING,
            )
        for job in queryset:
            job.status = PipelineJob.Status.QUEUED
            job.started_at = job.finished_at = None
            job.log = ""
            job.save(update_fields=["status", "started_at", "finished_at", "log"])
            self._enqueue(job)
        self.message_user(
            request,
            f"Purged {purged} stale message(s); re-dispatched {queryset.count()} job(s). "
            "If they stay Queued, the worker pod needs a restart.",
        )

    @admin.action(description="⚠ PURGE — drain the queue + delete these job records")
    def purge_jobs(self, request, queryset):
        """Hard reset for a cursed queue: when jobs are wedged in Queued/Running and even a
        Redis reload didn't clear them, the dead state is these DB rows. PURGE drains the
        broker queue AND deletes the selected job records, so you can start clean. Built
        game assets (Asset versions) live in a SEPARATE table and are NOT touched. Shows a
        confirmation page first."""
        from django.contrib import messages
        from django.contrib.admin import helpers
        from django.template.response import TemplateResponse

        if request.POST.get("_purge_confirm"):
            purged = 0
            try:
                from cladewright.celery import app
                with app.connection_for_write() as conn:
                    purged = conn.default_channel.queue_purge("celery") or 0
            except Exception as exc:  # noqa: BLE001 - broker may be down; still clear the rows
                self.message_user(request, f"Couldn't drain the queue ({exc}); clearing rows anyway.",
                                  level=messages.WARNING)
            n = queryset.count()
            queryset.delete()
            self.message_user(
                request,
                f"PURGED: drained {purged} queued message(s) and deleted {n} job record(s). "
                "Built assets were not touched.",
                level=messages.WARNING,
            )
            return None

        # First click → confirmation page listing exactly what will be purged.
        return TemplateResponse(request, "admin/pipelinejob_purge_confirm.html", {
            **self.admin_site.each_context(request),
            "title": "Purge pipeline jobs?",
            "queryset": queryset,
            "opts": self.model._meta,
            "action_checkbox_name": helpers.ACTION_CHECKBOX_NAME,
            "media": self.media,
        })
