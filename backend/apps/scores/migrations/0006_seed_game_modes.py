"""Seed the game-mode config rows.

v1 launches with Marathon (free play) ENABLED; the daily + classic modes are seeded
DISABLED so an admin can flip them on later. Idempotent via the unique ``mode`` key —
``update_or_create`` refreshes presentation but leaves ``enabled`` to the seeded value
(admins manage on/off after launch through the admin, not here).
"""
from __future__ import annotations

from django.db import migrations

# mode, label, blurb, route, enabled, supports_difficulty, sort_order
SEED = [
    ("marathon_free", "Marathon", "Name every branch of the tree of life, against the clock.",
     "/marathon", True, True, 0),
    ("marathon_daily", "Marathon (daily)", "One shared puzzle a day — compete on today's board.",
     "/marathon", False, True, 1),
    ("classic", "Classic", "The original one-shot guessing game.",
     "/classic", False, True, 2),
]


def seed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    for mode, label, blurb, route, enabled, supports_diff, order in SEED:
        GameModeConfig.objects.update_or_create(
            mode=mode,
            defaults={
                "label": label, "blurb": blurb, "route": route, "enabled": enabled,
                "supports_difficulty": supports_diff, "sort_order": order,
            },
        )


def unseed(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode__in=[m[0] for m in SEED]).delete()


class Migration(migrations.Migration):
    dependencies = [("scores", "0005_gamemodeconfig")]
    operations = [migrations.RunPython(seed, unseed)]
