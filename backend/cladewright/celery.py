"""Celery app for the pipeline job queue.

The web process only ever *enqueues* (``run_pipeline_job.delay(id)``) — it never imports
the heavy pipeline deps. A SEPARATE worker container (built from Dockerfile.pipeline, with
Braidworks + the CoL dump) consumes the queue and runs the build. Broker + result backend
are Redis. See docs/data-pipeline.md and apps/gamedata/tasks.py.
"""
from __future__ import annotations

import os

from celery import Celery

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "cladewright.settings")

app = Celery("cladewright")
# All CELERY_* settings come from Django settings (which read them from env).
app.config_from_object("django.conf:settings", namespace="CELERY")
# Import each app's tasks.py. Safe on the web image: tasks.py keeps the pipeline imports
# lazy (inside the task body), so autodiscovery never pulls in Braidworks just to enqueue.
app.autodiscover_tasks()
