"""Refresh the marathon_free blurb to the full Hub copy (now that the field fits it).

0006 seeded a shortened blurb because the field was capped at 160; 0007 widened it. This
sets the existing row to the rich copy so the DB matches the SPA's built-in fallback —
otherwise the Hub card flashes the fallback text, then swaps to the shorter DB text on
load. Only touches the row if it still holds the old seeded text (won't clobber an admin
edit).
"""
from __future__ import annotations

from django.db import migrations

OLD = "Name every branch of the tree of life, against the clock."
NEW = (
    "Name as many organisms as you can against the clock — each one lands on a living tree "
    "you build. Empty branches show how many sisters stay hidden. Zoom in to hunt them."
)


def forward(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="marathon_free", blurb=OLD).update(blurb=NEW)


def backward(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    GameModeConfig.objects.filter(mode="marathon_free", blurb=NEW).update(blurb=OLD)


class Migration(migrations.Migration):
    dependencies = [("scores", "0007_alter_gamemodeconfig_blurb")]
    operations = [migrations.RunPython(forward, backward)]
