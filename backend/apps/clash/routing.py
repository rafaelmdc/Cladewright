"""Websocket URL routing for Clade Clash (#36 Phase 1). Mounted under /ws/ by asgi.py's
URLRouter. Match ids are random + unguessable (see matchmaking), so the path itself is not
an authorization boundary — the consumer authorizes every frame."""
from __future__ import annotations

from django.urls import re_path

from . import consumers

websocket_urlpatterns = [
    re_path(r"^ws/clash/health/$", consumers.HealthConsumer.as_asgi()),
    # Match ids are random + unguessable; the join token (not the path) authorizes the join.
    re_path(r"^ws/clash/match/(?P<match_id>[\w-]+)/$", consumers.MatchConsumer.as_asgi()),
]
