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

import re

from django.conf import settings
from django.db import models


def normalize_alias(name: str) -> str:
    """Normalized alias key — mirrors the pipeline/frontend/resolver normalize so a typed
    query matches. Lowercase, fold underscores, drop punctuation, collapse whitespace."""
    s = name.lower().replace("_", " ")
    s = re.sub(r"[^\w\s]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


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

    class Kind(models.TextChoices):
        BUILD = "build", "Build asset"
        FETCH_DUMP = "fetch_dump", "Download CoL dump"

    kind = models.CharField(
        max_length=16, choices=Kind.choices, default=Kind.BUILD,
        help_text="Build an asset, or download a fresh CoL dump (replaces the old one). "
                  "Download jobs ignore the scope fields.",
    )

    # What to build. (scope_key/scope_filter are unused for a Download-dump job.)
    scope_key = models.CharField(
        max_length=128, blank=True, help_text="Asset scope id, e.g. 'fish'."
    )
    label = models.CharField(max_length=128, blank=True, help_text="Display name, e.g. 'Fish'.")
    scope_filter = models.CharField(
        max_length=512, blank=True, help_text="CoL filter rank=value[,value…], e.g. 'class=Aves'."
    )
    coldp_dir = models.CharField(max_length=256, default="data/coldp_col")
    enrich = models.CharField(max_length=16, default="braidworks")
    include_extinct = models.BooleanField(default=True)
    load_current = models.BooleanField(
        default=True, help_text="After building, load the asset and mark it current."
    )
    delete_old = models.BooleanField(
        default=False,
        help_text="After this build becomes current, delete the scope's now-superseded "
                  "(non-current) versions to reclaim DB space. Requires 'load current'; "
                  "the new build is always kept.",
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
    # Living-only denominator — used to detect clade completion in extant-only runs, so the
    # server re-scores the completion bonus the same way the client shows it (#77).
    pool_count_extant = models.IntegerField(default=0)
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


class ManualAlias(models.Model):
    """Admin-curated alias → target, keyed by SCOPE so it survives asset rebuilds. It's
    mirrored into the live ``Alias`` table of the scope's current asset on save (so it
    resolves immediately) and re-applied by ``load_gamedata`` to every new build (so it
    sticks). Use for names CoL/enrichment miss entirely — e.g. "chicken" → Gallus gallus,
    which isn't in CoL at all (the domestic chicken is an unlisted subspecies)."""

    scope = models.CharField(max_length=128, help_text="Scope key the target lives in, e.g. 'aves'.")
    name = models.CharField(max_length=255, help_text="What a player types, e.g. 'chicken'.")
    norm = models.CharField(max_length=255, editable=False, db_index=True)
    target_key = models.CharField(
        max_length=128, help_text="Target id, e.g. 'tip:Gallus_gallus' (browse Taxon tips to find it)."
    )
    target_kind = models.CharField(
        max_length=8, choices=[("tip", "tip"), ("node", "node")], default="tip"
    )
    note = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name_plural = "Manual aliases"
        constraints = [
            models.UniqueConstraint(fields=["scope", "norm"], name="uniq_manual_alias"),
        ]

    def save(self, *args, **kwargs):
        self.norm = normalize_alias(self.name)
        super().save(*args, **kwargs)

    def __str__(self) -> str:
        return f"{self.scope}: {self.norm} → {self.target_key}"

    def apply_to_asset(self, asset: "AssetVersion") -> None:
        """Upsert this alias into ``asset``'s live Alias table (so /resolve + /search and the
        blob-miss fallback see it). Pulls display sci/common off the target if present."""
        sci, common = self.target_key, None
        if self.target_kind == Alias.TIP:
            t = TaxonTip.objects.filter(asset=asset, key=self.target_key).first()
            if t:
                sci, common = t.sci, t.common
        else:
            n = TaxonNode.objects.filter(asset=asset, key=self.target_key).first()
            if n:
                sci, common = n.sci, n.common
        Alias.objects.get_or_create(
            asset=asset,
            norm=self.norm,
            target_key=self.target_key,
            defaults={"target_kind": self.target_kind, "sci": sci, "common": common},
        )

    def remove_from_asset(self, asset: "AssetVersion") -> None:
        Alias.objects.filter(
            asset=asset, norm=self.norm, target_key=self.target_key
        ).delete()


# Keep the scope's current asset's live Alias table in sync with manual aliases, so an
# admin add/remove takes effect immediately (no rebuild).
from django.db.models.signals import post_delete, post_save  # noqa: E402
from django.dispatch import receiver  # noqa: E402


@receiver(post_save, sender=ManualAlias)
def _mirror_manual_alias(sender, instance: ManualAlias, **kwargs) -> None:
    asset = AssetVersion.objects.filter(scope=instance.scope, is_current=True).first()
    if asset:
        instance.apply_to_asset(asset)


@receiver(post_delete, sender=ManualAlias)
def _unmirror_manual_alias(sender, instance: ManualAlias, **kwargs) -> None:
    asset = AssetVersion.objects.filter(scope=instance.scope, is_current=True).first()
    if asset:
        instance.remove_from_asset(asset)
