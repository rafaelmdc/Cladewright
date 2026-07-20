"""Un-seed the separate Clade Clash Versus game mode (#36).

Versus is not a second game — it is one of the ways to play Clade Clash, exactly as the
daily is a way to play Time Attack rather than a game of its own. Seeding it as its own
``GameModeConfig`` row made the Hub render TWO cards for one game, which read as two
different things to play.

The mode row goes; the feature does not. ``/clash/versus`` stays a live route, reachable
from inside Clade Clash (and from any existing link or bookmark) — see CladeClash.tsx.

Reversing this restores the row, so the old two-card Hub comes back with the migration.
"""
from __future__ import annotations

from django.db import migrations


def unseed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="clash_versus").delete()
    # The surviving card now stands for the whole game, so its blurb has to cover the duel
    # too — 0027's copy only promised a bot, which would read as a missing feature.
    GameModeConfig.objects.filter(mode="clash_solo").update(
        blurb=(
            "Spot the closer relative. A specimen, two neighbours, one call — "
            "race a bot, or duel another player in realtime."
        ),
    )


def reseed(apps, schema_editor):
    """Restore both rows exactly as 0027/0028 wrote them, so this migration is reversible."""
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="clash_solo").update(
        blurb=(
            "Spot the closer relative. A specimen, two neighbours, one call — "
            "race a bot to pick the nearer branch."
        ),
    )
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


class Migration(migrations.Migration):
    dependencies = [("scores", "0028_seed_clade_clash_versus")]
    operations = [migrations.RunPython(unseed, reseed)]
