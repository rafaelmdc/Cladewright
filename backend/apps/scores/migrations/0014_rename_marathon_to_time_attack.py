"""Rename the displayed game label Marathon -> "Time attack" (#50).

Only the human label changes; the mode KEYS (marathon_free / marathon_daily) stay put — they
key runs, leaderboards, the daily, and the /marathon route, so renaming them would orphan
data. Reversible.
"""
from django.db import migrations

RENAMES = {
    "marathon_free": ("Marathon", "Time attack"),
    "marathon_daily": ("Marathon (daily)", "Time attack (daily)"),
}


def rename(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    for mode, (_old, new) in RENAMES.items():
        GameModeConfig.objects.filter(mode=mode).update(label=new)


def unrename(apps, schema_editor):
    GameModeConfig = apps.get_model("scores", "GameModeConfig")
    for mode, (old, _new) in RENAMES.items():
        GameModeConfig.objects.filter(mode=mode).update(label=old)


class Migration(migrations.Migration):
    dependencies = [
        ("scores", "0013_alter_dailypin_date_alter_dailypin_unique_together"),
    ]
    operations = [migrations.RunPython(rename, unrename)]
