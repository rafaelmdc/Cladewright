"""Account profile: a public **display name** decoupled from the internal allauth username.

The username allauth mints from Google is an opaque internal handle; the display name is what
shows on leaderboards and the profile page, is user-chosen, editable any time, and unique
(case-insensitively) so leaderboard rows are unambiguous. See GitHub issue #62.
"""
from __future__ import annotations

import re

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models

DISPLAY_NAME_MIN = 3
DISPLAY_NAME_MAX = 24
# Letters (incl. accents), digits, spaces, and a few separators. No leading/trailing space
# (callers strip first); no runs are special-cased — kept deliberately permissive but tame.
_DISPLAY_NAME_RE = re.compile(r"^[\w \-.']+$", re.UNICODE)


def normalize_display_name(raw: str) -> str:
    """Trim and collapse internal whitespace; the canonical form we store and compare."""
    return re.sub(r"\s+", " ", (raw or "").strip())


def validate_display_name(name: str, *, exclude_user_id: int | None = None) -> str:
    """Return the normalized name or raise ValidationError. Enforces length, charset, and
    case-insensitive uniqueness (ignoring ``exclude_user_id`` so a user can re-save their own)."""
    name = normalize_display_name(name)
    if len(name) < DISPLAY_NAME_MIN:
        raise ValidationError(f"Display name must be at least {DISPLAY_NAME_MIN} characters.")
    if len(name) > DISPLAY_NAME_MAX:
        raise ValidationError(f"Display name must be at most {DISPLAY_NAME_MAX} characters.")
    if not _DISPLAY_NAME_RE.match(name):
        raise ValidationError("Use letters, numbers, spaces, and - . ' _ only.")
    taken = Profile.objects.filter(display_name__iexact=name)
    if exclude_user_id is not None:
        taken = taken.exclude(user_id=exclude_user_id)
    if taken.exists():
        raise ValidationError("That display name is already taken.")
    return name


class Profile(models.Model):
    """One per user. ``display_name`` is the public handle; ``name_chosen`` is False while it
    still holds the auto-generated default, which is what triggers the one-time set-name card
    after account creation."""

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    display_name = models.CharField(max_length=DISPLAY_NAME_MAX, unique=True)
    name_chosen = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.display_name


def _default_display_name(user) -> str:
    """A unique, length-bounded starting display name derived from the username. Falls back to
    ``player<id>`` and de-dupes with a numeric suffix so the unique constraint never trips."""
    base = normalize_display_name(user.get_username()) or f"player{user.pk}"
    base = base[:DISPLAY_NAME_MAX]
    if len(base) < DISPLAY_NAME_MIN:
        base = f"player{user.pk}"[:DISPLAY_NAME_MAX]
    candidate = base
    n = 1
    while Profile.objects.filter(display_name__iexact=candidate).exists():
        suffix = str(n)
        candidate = f"{base[: DISPLAY_NAME_MAX - len(suffix)]}{suffix}"
        n += 1
    return candidate


def get_or_create_profile(user) -> Profile:
    """Fetch (or lazily create) the profile — covers users that predate this model."""
    try:
        return user.profile
    except Profile.DoesNotExist:
        return Profile.objects.create(user=user, display_name=_default_display_name(user))
