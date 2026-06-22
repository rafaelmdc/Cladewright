"""Create the singleton GameDefaults row (pk=1) with field defaults, so the admin shows it
immediately and the API has something to serve before anyone touches it."""
from django.db import migrations


def seed(apps, schema_editor):
    GameDefaults = apps.get_model("scores", "GameDefaults")
    GameDefaults.objects.get_or_create(pk=1)


def unseed(apps, schema_editor):
    apps.get_model("scores", "GameDefaults").objects.filter(pk=1).delete()


class Migration(migrations.Migration):
    dependencies = [("scores", "0015_gamedefaults")]
    operations = [migrations.RunPython(seed, unseed)]
