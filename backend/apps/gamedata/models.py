"""
Game-data storage. The pipeline builds an immutable asset per (scope, version); this is
where a built asset lives as the source of truth.

Two representations of the SAME build, populated together by ``load_gamedata``:

  * ``AssetVersion.blob`` — the whole asset JSON. Small scopes (Mammalia, Aves…) ship
    this entire blob to the client, which plays 100% in-memory (the current design).
  * ``TaxonNode`` / ``TaxonTip`` / ``Alias`` — a relational mirror. For a huge scope
    (all-Animalia) the blob is too big to ship, so the client instead resolves names via
    the trigram-indexed ``Alias`` table and lazily fetches each placed organism's
    denormalized ``lineage``. Gameplay logic stays client-side either way; only the
    *delivery* differs. See docs/data-pipeline.md and docs/architecture.md.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class PipelineJob(models.Model):
    """A queued asset-build request. The admin enqueues one; a SEPARATE worker (with the
    pipeline deps — Braidworks + the CoL dump) claims it and runs build_gamedata +
    load_gamedata, updating status/log. The web process never runs the heavy build. See
    docs/data-pipeline.md."""

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        RUNNING = "running", "Running"
        SUCCEEDED = "succeeded", "Succeeded"
        FAILED = "failed", "Failed"

    # What to build.
    scope_key = models.CharField(max_length=128, help_text="Asset scope id, e.g. 'fish'.")
    label = models.CharField(max_length=128, blank=True, help_text="Display name, e.g. 'Fish'.")
    scope_filter = models.CharField(
        max_length=512, help_text="CoL filter rank=value[,value…], e.g. 'class=Aves'."
    )
    coldp_dir = models.CharField(max_length=256, default="data/coldp_col")
    enrich = models.CharField(max_length=16, default="braidworks")
    include_extinct = models.BooleanField(default=True)
    load_current = models.BooleanField(
        default=True, help_text="After building, load the asset and mark it current."
    )

    # Lifecycle.
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED)
    log = models.TextField(blank=True, default="")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="pipeline_jobs",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "created_at"])]

    def __str__(self) -> str:
        return f"{self.scope_key} [{self.status}] {self.created_at:%Y-%m-%d %H:%M}"


class AssetVersion(models.Model):
    """One built game-data asset: a scope at a monotonically increasing version."""

    scope = models.CharField(max_length=128)  # stable scope KEY, e.g. "mammalia", "fish"
    label = models.CharField(max_length=128, blank=True, default="")  # display, e.g. "Birds"
    version = models.IntegerField()
    schema = models.CharField(max_length=16, default="1.0")
    pool_size = models.IntegerField(default=0)  # all pool tips (incl. extinct)
    pool_size_extant = models.IntegerField(default=0)  # excluding extinct (toggle denom)
    hidden_label_max = models.IntegerField(default=15)
    provenance = models.JSONField(default=dict, blank=True)
    # Whole-asset payload for blob-mode scopes; null for huge scopes served incrementally.
    blob = models.JSONField(null=True, blank=True)
    is_current = models.BooleanField(default=False)
    built_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["scope", "version"], name="uniq_scope_version"),
            # At most one current build per scope.
            models.UniqueConstraint(
                fields=["scope"],
                condition=models.Q(is_current=True),
                name="one_current_per_scope",
            ),
        ]
        indexes = [models.Index(fields=["is_current"])]
        ordering = ["scope", "-version"]

    def __str__(self) -> str:
        return f"{self.scope} v{self.version}{' (current)' if self.is_current else ''}"


class TaxonNode(models.Model):
    """Internal clade node of a built asset (relational mirror of one ``nodes`` entry)."""

    asset = models.ForeignKey(AssetVersion, on_delete=models.CASCADE, related_name="tnodes")
    key = models.CharField(max_length=128)  # the asset node id, e.g. "ord:Carnivora"
    rank = models.CharField(max_length=32)
    sci = models.CharField(max_length=255)
    common = models.CharField(max_length=255, null=True, blank=True)
    parent_key = models.CharField(max_length=128, null=True, blank=True)  # parent node id
    pool_count = models.IntegerField(default=0)  # denominator of "N remaining"
    depth = models.IntegerField(default=0)  # distance from root
    # Denormalized root→parent ancestor ids, so resolving a placement is a single-row
    # read — never a recursive parent walk at request time.
    lineage = models.JSONField(default=list)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "key"], name="uniq_asset_node"),
        ]
        indexes = [models.Index(fields=["asset", "key"])]

    def __str__(self) -> str:
        return f"{self.sci} ({self.key})"


class TaxonTip(models.Model):
    """Playable pool species of a built asset (relational mirror of one ``tips`` entry)."""

    asset = models.ForeignKey(AssetVersion, on_delete=models.CASCADE, related_name="ttips")
    key = models.CharField(max_length=128)  # the asset tip id, e.g. "tip:Ursus_arctos"
    sci = models.CharField(max_length=255)
    common = models.CharField(max_length=255)
    parent_key = models.CharField(max_length=128)
    lineage = models.JSONField(default=list)  # ordered root→parent ancestor node ids
    traits = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["asset", "key"], name="uniq_asset_tip"),
        ]
        indexes = [models.Index(fields=["asset", "key"])]

    def __str__(self) -> str:
        return f"{self.common} ({self.sci})"


class Alias(models.Model):
    """One searchable name → its target (tip or clade node). The huge-scope autocomplete
    index. A Postgres GIN trigram index on ``norm`` (added in a follow-up, Postgres-only
    migration) makes ``ILIKE '%q%'`` search fast over millions of rows; on sqlite the
    same query falls back to a scan (fine for small dev data)."""

    TIP = "tip"
    NODE = "node"
    KIND_CHOICES = [(TIP, "tip"), (NODE, "node")]

    asset = models.ForeignKey(AssetVersion, on_delete=models.CASCADE, related_name="alias_rows")
    norm = models.CharField(max_length=255)  # normalized search key (lowercased, etc.)
    target_key = models.CharField(max_length=128)  # tip or node id
    target_kind = models.CharField(max_length=8, choices=KIND_CHOICES)
    # Denormalized for display in autocomplete results without a second lookup.
    sci = models.CharField(max_length=255)
    common = models.CharField(max_length=255, null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["asset", "norm"]),  # btree: exact + prefix lookups
        ]

    def __str__(self) -> str:
        return f"{self.norm} → {self.target_key}"
