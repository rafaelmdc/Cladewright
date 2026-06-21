"""Replace the default 'example.com' Site with Cladewright's, so allauth flows + emails
show the right name/domain. Env-overridable for prod (SITE_DOMAIN / SITE_NAME)."""
from __future__ import annotations

import os

from django.conf import settings
from django.db import migrations


def set_site(apps, schema_editor):
    Site = apps.get_model("sites", "Site")
    Site.objects.update_or_create(
        pk=getattr(settings, "SITE_ID", 1),
        defaults={
            "domain": os.environ.get("SITE_DOMAIN", "localhost:5173"),
            "name": os.environ.get("SITE_NAME", "Cladewright"),
        },
    )


class Migration(migrations.Migration):
    dependencies = [("sites", "0002_alter_domain_unique")]
    operations = [migrations.RunPython(set_site, migrations.RunPython.noop)]
