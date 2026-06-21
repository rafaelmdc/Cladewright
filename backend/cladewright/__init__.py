"""Cladewright project package.

Importing the Celery app here ensures the shared ``app`` is created when Django starts, so
``@shared_task`` registration and ``.delay()`` enqueue work in both web and worker.
"""
from __future__ import annotations

from .celery import app as celery_app

__all__ = ("celery_app",)
