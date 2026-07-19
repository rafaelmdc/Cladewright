"""Seed the Clade Clash game mode (#36, Phase 0).

Clade Clash is the distance-guessing mode: given a specimen, pick the closer relative of
two candidates. Phase 0 is SOLO vs a bot and UNRANKED, on the same packs + lobby as Time
Attack — so it's a GameModeConfig row like any other (route ``/clash``), and the Hub +
lobby pick it up with no code changes. See docs/clade-clash-design.md.
"""
from __future__ import annotations

from django.db import migrations


def seed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.update_or_create(
        mode="clash_solo",
        defaults={
            "label": "Clade Clash",
            "blurb": "Spot the closer relative. A specimen, two neighbours, one call — race a bot to pick the nearer branch.",
            "route": "/clash",
            "enabled": True,
            "supports_difficulty": False,  # common names only for now
            "sort_order": 2,
        },
    )


def unseed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="clash_solo").delete()


class Migration(migrations.Migration):
    dependencies = [("scores", "0026_alter_run_scope")]
    operations = [migrations.RunPython(seed, unseed)]
