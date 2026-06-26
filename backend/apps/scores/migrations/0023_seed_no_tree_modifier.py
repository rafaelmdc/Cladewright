"""Seed the first gameplay modifier (#101): 'No tree' for Marathon — play without the
cladogram, just a scrollable list of what you've named. A genuine memory challenge, so it
scores at 1.3×. Idempotent; reversible (removes only this row)."""
from django.db import migrations


def add_no_tree(apps, schema_editor):
    GameModifier = apps.get_model("scores", "GameModifier")
    GameModifier.objects.get_or_create(
        game="marathon",
        key="no_tree",
        defaults={
            "label": "No tree",
            "blurb": "Hide the cladogram — track what you've named from a plain list.",
            "multiplier": 1.3,
            "incompatible_with": [],
            "enabled": True,
            "sort_order": 0,
        },
    )


def remove_no_tree(apps, schema_editor):
    GameModifier = apps.get_model("scores", "GameModifier")
    GameModifier.objects.filter(game="marathon", key="no_tree").delete()


class Migration(migrations.Migration):
    dependencies = [
        ("scores", "0022_gamedefaults_setting_multipliers_run_base_score_and_more"),
    ]
    operations = [migrations.RunPython(add_no_tree, remove_no_tree)]
