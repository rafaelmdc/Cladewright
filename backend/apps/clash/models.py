"""Durable Clade Clash outcomes (#36 Phase 1).

The live match lives in Redis (ephemeral); when it ends we write ONE ``MatchResult`` row —
the way a finished Marathon run persists. This is the record leaderboards / head-to-head
history read from. In-flight state never touches Postgres.
"""
from __future__ import annotations

from django.conf import settings
from django.db import models


class MatchResult(models.Model):
    """The settled outcome of one versus duel."""

    # The ephemeral match id (random, unguessable). Unique so settle is idempotent.
    match_id = models.CharField(max_length=64, unique=True)
    scope = models.CharField(max_length=512)
    engine_id = models.CharField(max_length=32, default="rank-depth")

    # The two participants (seat 0 / seat 1). Human vs human only for now.
    player0 = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="clash_as_p0"
    )
    player1 = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="clash_as_p1"
    )
    # The winner, or null for a dead heat.
    winner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="clash_wins",
    )
    hp0 = models.IntegerField(default=0)
    hp1 = models.IntegerField(default=0)
    rounds = models.IntegerField(default=0)

    # Was this intended as a ranked match (human vs human)? Bot/solo never persist here.
    ranked = models.BooleanField(default=False)
    # Timing looked implausible (a superhuman-fast picker) — still a real result, but excluded
    # from ranking. Integrity is plausibility, not secrecy (see referee.REACTION_FLOOR).
    flagged = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["-created_at"])]

    @property
    def counts_for_ranking(self) -> bool:
        return self.ranked and not self.flagged

    def __str__(self) -> str:
        return f"clash {self.match_id} [{'ranked' if self.counts_for_ranking else 'unranked'}]"
