"""Editable site content. Currently just the FAQ: question/answer pairs an admin curates
(no deploy), served read-only to the SPA's /faq page."""
from __future__ import annotations

from django.db import models


class FaqEntry(models.Model):
    """One frequently-asked question + its answer. Ordered + toggleable from the admin so the
    FAQ page is data, not a code change. `answer` may contain a few newlines (rendered as
    paragraphs); keep it short and plain."""

    question = models.CharField(max_length=200)
    answer = models.TextField(help_text="Plain text; blank lines separate paragraphs.")
    order = models.IntegerField(default=0, help_text="Lower shows first.")
    published = models.BooleanField(default=True, help_text="Untick to hide without deleting.")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["order", "id"]
        verbose_name = "FAQ entry"
        verbose_name_plural = "FAQ entries"

    def __str__(self) -> str:
        return self.question
