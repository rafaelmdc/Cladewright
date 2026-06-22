"""Give every pre-existing user a Profile with a unique default display name, so accounts
created before this feature (e.g. the bootstrap admin) appear correctly on leaderboards
without first visiting their profile page. New users get one via the post_save signal."""
from __future__ import annotations

import re

from django.db import migrations

MAX = 24
MIN = 3


def _default_name(username: str, pk: int, taken: set[str]) -> str:
    base = re.sub(r"\s+", " ", (username or "").strip())[:MAX]
    if len(base) < MIN:
        base = f"player{pk}"[:MAX]
    candidate = base
    n = 1
    while candidate.lower() in taken:
        suffix = str(n)
        candidate = f"{base[: MAX - len(suffix)]}{suffix}"
        n += 1
    taken.add(candidate.lower())
    return candidate


def backfill(apps, schema_editor):
    User = apps.get_model("auth", "User")
    Profile = apps.get_model("accounts", "Profile")
    taken = {dn.lower() for dn in Profile.objects.values_list("display_name", flat=True)}
    have = set(Profile.objects.values_list("user_id", flat=True))
    new = [
        Profile(user_id=u.id, display_name=_default_name(u.username, u.id, taken), name_chosen=False)
        for u in User.objects.exclude(id__in=have).order_by("id")
    ]
    Profile.objects.bulk_create(new)


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):
    dependencies = [("accounts", "0002_initial")]
    operations = [migrations.RunPython(backfill, noop)]
