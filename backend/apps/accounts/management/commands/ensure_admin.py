"""Bootstrap a first admin on a fresh deploy — idempotent and safe to run on every start.

Creates a superuser from env ONLY when the database has NO superuser yet (a truly fresh
install). Once any superuser exists — including after you change this one's password or
create your own — this is a no-op, so it never resets a live admin.

    DJANGO_BOOTSTRAP_ADMIN_USER=admin           (default: admin)
    DJANGO_BOOTSTRAP_ADMIN_PASSWORD=<pw>        (required; unset → does nothing)

Wired into the prod container start command. CHANGE the bootstrap password immediately
after first login.
"""
from __future__ import annotations

import os

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Create a superuser from env on a fresh DB (no-op if any superuser exists)."

    def handle(self, *args, **opts) -> None:
        password = os.environ.get("DJANGO_BOOTSTRAP_ADMIN_PASSWORD")
        if not password:
            self.stdout.write("No DJANGO_BOOTSTRAP_ADMIN_PASSWORD set — skipping.")
            return

        User = get_user_model()
        if User.objects.filter(is_superuser=True).exists():
            self.stdout.write("A superuser already exists — skipping bootstrap.")
            return

        username = os.environ.get("DJANGO_BOOTSTRAP_ADMIN_USER", "admin")
        User.objects.create_superuser(username=username, email="", password=password)
        self.stdout.write(self.style.SUCCESS(
            f"Bootstrapped superuser '{username}'. CHANGE THIS PASSWORD NOW."
        ))
