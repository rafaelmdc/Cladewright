"""
Signed run sessions — the anti-cheat plumbing behind combo scoring (#77).

Combos multiply a run's score, and the multiplier is derived from per-placement TIMINGS
the client supplies. Untrusted timings are forgeable (claim every placement 1ms apart →
max combo), so we anchor them to a server-issued, signed run token:

  * ``POST /api/scores/runs/start/`` issues a token at run start — a signed, timestamped
    blob (django.core.signing, keyed by SECRET_KEY) carrying the user id + server start
    time. It is STATELESS (no DB row): the signature is what we trust.
  * At submit, the server verifies the signature + age + that it belongs to this user, then
    uses the embedded start time to bound the claimed run: you can't have placed more
    organisms than is humanly possible in the real wall-clock elapsed, and the supplied
    timings can't exceed that elapsed.

This stops the casual/devtools cheats (hand-crafted or replayed POSTs, dump-the-whole-tree
"instant" runs, all-timings-equal combo forges) without a per-keystroke round-trip. A
determined scripter who starts a run, waits the real duration, then submits carefully
spread fake timings is the accepted <10% tail — tighten later if it ever shows up.
"""
from __future__ import annotations

import secrets
import time

from django.core import signing

# Salt namespaces the signature so a run token can't be swapped in for another signed blob.
_SALT = "cladewright.scores.run"
# A run session is valid for this long after start — generous enough to cover a long run
# plus the post-game OAuth sign-in round-trip (the #78 stash re-submits with this token).
RUN_TOKEN_MAX_AGE = 3 * 60 * 60  # 3h


def issue_run_token(user_id: int) -> str:
    """A signed token marking the start of a run for ``user_id``. Embeds the server start
    time (epoch seconds) so submit can measure real elapsed wall-clock, and a nonce so two
    runs started in the same second still get distinct tokens."""
    return signing.dumps(
        {"u": user_id, "t": int(time.time()), "n": secrets.token_hex(8)},
        salt=_SALT,
    )


def verify_run_token(token: str | None, user_id: int) -> dict | None:
    """Decode + verify a run token. Returns the payload (``{"u", "t", "n"}``) when the
    signature is valid, unexpired, and belongs to ``user_id``; else ``None`` (forged,
    tampered, stale, or another user's token)."""
    if not token or not isinstance(token, str):
        return None
    try:
        payload = signing.loads(token, salt=_SALT, max_age=RUN_TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    if not isinstance(payload, dict) or payload.get("u") != user_id:
        return None
    return payload
