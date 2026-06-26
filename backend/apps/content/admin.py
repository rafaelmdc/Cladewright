from django.contrib import admin

from .models import FaqEntry


@admin.register(FaqEntry)
class FaqEntryAdmin(admin.ModelAdmin):
    """Curate the FAQ — add/edit Q&A, reorder, and publish/hide without a deploy. The SPA's
    /faq page reads the published rows in `order`."""

    list_display = ("question", "order", "published", "updated_at")
    list_editable = ("order", "published")
    list_filter = ("published",)
    search_fields = ("question", "answer")
    fields = ("question", "answer", "order", "published")
