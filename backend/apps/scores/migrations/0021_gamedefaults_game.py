from django.db import migrations, models


class Migration(migrations.Migration):
    """GameDefaults stops being a singleton — it's now one row per GAME (keyed by `game`, a
    base mode like 'marathon'). The existing singleton row becomes Marathon's defaults."""

    dependencies = [
        ("scores", "0020_frozendaily"),
    ]

    operations = [
        migrations.AddField(
            model_name="gamedefaults",
            name="game",
            field=models.CharField(
                default="marathon",
                help_text="Game key these defaults apply to, e.g. 'marathon'.",
                max_length=32,
                unique=True,
            ),
        ),
    ]
