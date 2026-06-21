"""Enable the daily game mode + give it a clean label.

The daily is presented as the Hub's single site-wide strip (not a card); enabling the
marathon_daily GameModeConfig lets daily runs submit and the /daily/ endpoint report
``available``. The rotation pool starts empty → the resolver falls back to rotating the
currently-served scopes until an admin configures DailyRotationEntry / DailyPin.
"""
from __future__ import annotations

from django.db import migrations


def enable(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.update_or_create(
        mode="marathon_daily",
        defaults={
            "label": "Daily",
            "blurb": "One shared puzzle a day.",
            "route": "/marathon",
            "enabled": True,
            "supports_difficulty": True,
            "sort_order": 1,
        },
    )


def disable(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="marathon_daily").update(enabled=False)


class Migration(migrations.Migration):
    dependencies = [("scores", "0011_dailypin_dailyrotationentry")]
    operations = [migrations.RunPython(enable, disable)]
