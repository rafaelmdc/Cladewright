"""Seed the tractable #113 difficulty modifiers for Marathon (sub-issues #123/#124/#125):

  * no_wiki   — hide the hover NodeCards (no Wikipedia peeking). Pure-UI, like no_tree.
  * blind     — every typo/no-match/duplicate/invalid taxon costs countdown time. Pins
                infiniteTime off (a timer penalty is meaningless with an infinite clock).
  * top_down  — a species is only accepted once a containing clade has been named first.

Multipliers are admin-tunable starting points. Idempotent; reversible (removes only these rows).
The deferred distance/vicinity modifiers (#126/#127) are NOT seeded here.
"""
from django.db import migrations

MODIFIERS = [
    {
        "key": "no_wiki",
        "label": "No Wikipedia",
        "blurb": "Hide the hover cards — no Wikipedia peeking, name it from memory.",
        "multiplier": 1.2,
        "incompatible_with": [],
        "hides_settings": [],
        "forces_settings": {},
        "sort_order": 1,
    },
    {
        "key": "blind",
        "label": "Blind guess",
        "blurb": "Every typo, miss, duplicate, or bad name costs you countdown time.",
        "multiplier": 1.4,
        "incompatible_with": [],
        "hides_settings": [],
        # A timer penalty needs a finite clock to bite.
        "forces_settings": {"infiniteTime": False},
        "sort_order": 2,
    },
    {
        "key": "top_down",
        "label": "Top-down",
        "blurb": "Anchor a parent clade before its species — no naming a species cold.",
        "multiplier": 1.5,
        "incompatible_with": [],
        "hides_settings": [],
        "forces_settings": {},
        "sort_order": 3,
    },
]


def add_modifiers(apps, schema_editor):
    GameModifier = apps.get_model("scores", "GameModifier")
    for m in MODIFIERS:
        GameModifier.objects.update_or_create(
            game="marathon", key=m["key"],
            defaults={
                "label": m["label"], "blurb": m["blurb"], "multiplier": m["multiplier"],
                "incompatible_with": m["incompatible_with"], "hides_settings": m["hides_settings"],
                "forces_settings": m["forces_settings"], "enabled": True,
                "sort_order": m["sort_order"],
            },
        )


def remove_modifiers(apps, schema_editor):
    GameModifier = apps.get_model("scores", "GameModifier")
    GameModifier.objects.filter(
        game="marathon", key__in=[m["key"] for m in MODIFIERS]
    ).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("scores", "0024_gamemodifier_forces_settings_and_more"),
    ]
    operations = [migrations.RunPython(add_modifiers, remove_modifiers)]
