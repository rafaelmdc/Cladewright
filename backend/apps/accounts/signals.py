"""Create a Profile (with a default display name) the moment a user is created, so every
account has a public handle from the start."""
from __future__ import annotations

from django.conf import settings
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Profile, _default_display_name


@receiver(post_save, sender=settings.AUTH_USER_MODEL)
def ensure_profile(sender, instance, created, **kwargs):
    if created and not Profile.objects.filter(user=instance).exists():
        Profile.objects.create(user=instance, display_name=_default_display_name(instance))
