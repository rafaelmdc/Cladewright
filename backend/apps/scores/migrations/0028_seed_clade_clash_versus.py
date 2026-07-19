"""Seed the Clade Clash Versus game mode (#36, Phase 1).

Realtime human-vs-human duel. Unlike solo (0027), Versus does its own pack pick +
matchmaking on its page, so it skips the generic /play/:mode lobby — the Hub card links
straight to ``route`` (/clash/versus). See docs/clade-clash-design.md.
"""
from __future__ import annotations

from django.db import migrations


def seed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.update_or_create(
        mode="clash_versus",
        defaults={
            "label": "Clade Clash · Versus",
            "blurb": "Duel a friend or a stranger in realtime — spot the closer relative faster, drain their health first.",
            "route": "/clash/versus",
            "enabled": True,
            "supports_difficulty": False,
            "sort_order": 3,
        },
    )


def unseed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="clash_versus").delete()


class Migration(migrations.Migration):
    dependencies = [("scores", "0027_seed_clade_clash")]
    operations = [migrations.RunPython(seed, unseed)]
