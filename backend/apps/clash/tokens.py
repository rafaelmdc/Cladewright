"""Signed match-join tokens (#36 Phase 1) — the websocket authorization anchor.

Match ids are random + unguessable, but that alone isn't authorization: we mint a SIGNED
token, per (match, user, seat), when two players are paired. The ws consumer verifies it on
connect, so even someone who learns a match id can't join a match they weren't paired into
(IDOR). Stateless like the run token (sessions.py): the signature is the trust, no DB row.
"""
from __future__ import annotations

from django.core import signing

_SALT = "cladewright.clash.join"
# A player must open their websocket within this window of being paired; short, because
# pairing immediately hands the client the token and it connects at once.
JOIN_TOKEN_MAX_AGE = 10 * 60  # 10 minutes


def issue_join_token(match_id: str, user_id: int, seat: int) -> str:
    """A signed token authorizing ``user_id`` to occupy ``seat`` (0|1) of ``match_id``."""
    return signing.dumps({"m": match_id, "u": user_id, "s": seat}, salt=_SALT)


def verify_join_token(token: str | None, user_id: int) -> dict | None:
    """Decode + verify a join token. Returns ``{"m", "u", "s"}`` when the signature is valid,
    unexpired, and belongs to ``user_id``; else None (forged, tampered, stale, another user)."""
    if not token or not isinstance(token, str):
        return None
    try:
        payload = signing.loads(token, salt=_SALT, max_age=JOIN_TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    if not isinstance(payload, dict) or payload.get("u") != user_id:
        return None
    if payload.get("s") not in (0, 1) or not payload.get("m"):
        return None
    return payload
