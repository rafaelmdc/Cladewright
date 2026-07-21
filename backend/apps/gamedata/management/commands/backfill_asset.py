"""Fill in fields a served asset is missing — without rebuilding it.

    manage.py backfill_asset --scope fish
    manage.py backfill_asset --all
    manage.py backfill_asset --all --only has_common --dry-run

A rebuild redoes ingest, backbone, the Wikidata name harvest and fame — hours per pack, and
the path that OOM-kills the worker on big scopes (#131). Adding a derived per-tip field needs
none of that: see pipeline/backfill.py for the registry and the invariant that makes skipping
it safe (a backfiller only ever ADDS a missing value, never a name, id, lineage or pool
member, so the relational mirror stays valid and is not rebuilt).

The version is bumped so clients re-download: the asset URL is cache-keyed on it. That is the
whole reason this writes a version at all — the tips are the same tips.
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.gamedata.models import AssetVersion
from pipeline.backfill import backfill_blob, default_backfillers


class Command(BaseCommand):
    help = "Add missing derived fields to already-built assets (no rebuild)."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--scope", help="Scope key to backfill, e.g. 'fish'.")
        parser.add_argument("--all", action="store_true",
                            help="Backfill every scope that has a current blob build.")
        parser.add_argument("--only", action="append", default=[], metavar="KEY",
                            help="Run only these backfillers (repeatable). Default: all of them.")
        parser.add_argument("--force", action="store_true",
                            help="Recompute even where the field is already present — for a "
                                 "backfiller whose RULE changed, not just its coverage.")
        parser.add_argument("--dry-run", action="store_true",
                            help="Report what would change; write nothing.")

    def handle(self, *args, **opts) -> None:
        available = {bf.key: bf for bf in default_backfillers()}
        keys = opts["only"] or list(available)
        unknown = [k for k in keys if k not in available]
        if unknown:
            raise CommandError(
                f"unknown backfiller(s): {', '.join(unknown)}. Available: {', '.join(available)}"
            )
        chosen = [available[k] for k in keys]

        if not opts["scope"] and not opts["all"]:
            raise CommandError("pass --scope <key> or --all")

        assets = AssetVersion.objects.filter(is_current=True, blob__isnull=False)
        if opts["scope"]:
            assets = assets.filter(scope=opts["scope"])
        assets = list(assets.order_by("scope"))
        if not assets:
            raise CommandError(
                "no current blob build to backfill"
                + (f" for scope '{opts['scope']}'" if opts["scope"] else "")
            )

        for asset in assets:
            self._backfill(asset, chosen, force=opts["force"], dry_run=opts["dry_run"])

    def _backfill(self, asset: AssetVersion, backfillers, *, force: bool, dry_run: bool) -> None:
        blob = asset.blob or {}
        tips = blob.get("tips", [])
        self.stdout.write(f"{asset.scope} v{asset.version} — {len(tips):,} tips")

        filled = backfill_blob(
            blob, backfillers, lambda line: self.stdout.write(line), force=force
        )
        if not filled:
            self.stdout.write("      nothing missing — unchanged")
            return
        summary = ", ".join(f"{k} ×{n:,}" for k, n in filled.items())
        if dry_run:
            self.stdout.write(f"      DRY RUN — would fill {summary} and bump the version")
            return

        with transaction.atomic():
            # Bump so clients re-download: the served asset is cache-keyed on the version.
            # The tips are the SAME tips (a backfiller only adds a missing value), so the
            # node/tip/alias mirror is untouched and correct as it stands.
            latest = (
                AssetVersion.objects.filter(scope=asset.scope)
                .order_by("-version")
                .values_list("version", flat=True)
                .first()
            ) or asset.version
            asset.version = latest + 1
            blob["version"] = asset.version
            asset.blob = blob
            # Provenance is the audit trail: which fields were added to this pack, when, and
            # by what — so "why does this pack have has_image but that one doesn't" is answerable.
            history = list((asset.provenance or {}).get("backfills", []))
            history.append({
                "at": timezone.now().isoformat(timespec="seconds"),
                "filled": filled,
                "forced": force,
            })
            asset.provenance = {**(asset.provenance or {}), "backfills": history}
            asset.save(update_fields=["version", "blob", "provenance"])

        self.stdout.write(f"      filled {summary} → {asset.scope} v{asset.version}")
