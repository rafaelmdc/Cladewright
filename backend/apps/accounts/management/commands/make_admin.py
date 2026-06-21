"""Promote (or demote) a user to staff+superuser so they can use /admin/.

Players sign in with Google and have no usable password; an admin needs one to log into
the URL-only admin. So promoting typically also sets a password:

    python manage.py make_admin you@example.com --password 's3cret'
    python manage.py make_admin you@example.com --revoke
"""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Grant or revoke admin (staff+superuser) access for a user by email or username."

    def add_arguments(self, parser) -> None:
        parser.add_argument("identifier", help="The user's email or username.")
        parser.add_argument("--password", help="Set/replace the admin login password.")
        parser.add_argument("--revoke", action="store_true", help="Demote instead of promote.")

    def handle(self, *args, **opts) -> None:
        User = get_user_model()
        ident = opts["identifier"]
        user = (
            User.objects.filter(email__iexact=ident).first()
            or User.objects.filter(username__iexact=ident).first()
        )
        if user is None:
            raise CommandError(f"No user with email or username {ident!r}.")

        if opts["revoke"]:
            user.is_staff = user.is_superuser = False
        else:
            user.is_staff = user.is_superuser = True
            if opts["password"]:
                user.set_password(opts["password"])

        user.save()
        verb = "Revoked admin from" if opts["revoke"] else "Promoted to admin"
        self.stdout.write(self.style.SUCCESS(f"{verb}: {user.get_username()} <{user.email}>"))
        if not opts["revoke"] and not opts["password"] and not user.has_usable_password():
            self.stdout.write(self.style.WARNING(
                "This user has no password (Google-only) — pass --password so they can log "
                "into /admin/."
            ))
