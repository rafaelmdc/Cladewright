"""Celery tasks for the pipeline job queue.

ONE task, two job kinds: download a fresh CoL dump, or build+load a game-data asset. This
runs only on the pipeline worker (Dockerfile.pipeline — Braidworks + the CoL dump). The
web image imports this module only to *enqueue* (``run_pipeline_job.delay(id)``), so every
heavy import (call_command → pipeline → Braidworks) stays lazy, inside the task body.

Status lifecycle: QUEUED ──claim──▶ RUNNING ──ok──▶ SUCCEEDED / ──err──▶ FAILED. The
command stdout is streamed into ``PipelineJob.log`` so the admin shows live progress.
"""
from __future__ import annotations

import asyncio
import io
import tempfile
import threading
import traceback
from pathlib import Path

from celery import shared_task
from django.utils import timezone


class _JobLog(io.TextIOBase):
    """A writable stream that appends to a PipelineJob's ``log`` and persists on each write,
    so the admin's job page reflects build progress without waiting for completion."""

    def __init__(self, job):
        self._job = job
        self._buf: list[str] = []

    def write(self, s: str) -> int:
        if s:
            self._buf.append(s)
            self.flush()
        return len(s)

    def flush(self) -> None:  # noqa: D401 - stream contract
        self._job.log = "".join(self._buf)
        self._persist()

    def _persist(self) -> None:
        """Write ``log`` back to the row. The enrich harvest pumps progress ticks through
        here from inside ``asyncio.run`` (build_gamedata's progress callback -> stdout.write),
        and Django's guard forbids a synchronous ORM call from a running event loop. When we
        detect one, do the save on a short-lived thread: that thread has no event loop (the
        guard passes) and opens its own connection, so the loop isn't blocked on the DB."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            self._job.save(update_fields=["log"])
            return

        def _save() -> None:
            from django.db import connection

            try:
                self._job.save(update_fields=["log"])
            finally:
                connection.close()  # don't leak this thread's connection across ticks

        t = threading.Thread(target=_save)
        t.start()
        t.join()


def _parse_scope_filter(scope_filter: str) -> str:
    """The admin form stores a single ``rank=value[,value]`` string; build_gamedata's
    --scope takes exactly that, so this is a pass-through guard against blanks."""
    sf = (scope_filter or "").strip()
    if "=" not in sf:
        raise ValueError(f"scope_filter must be rank=value[,value…]; got {sf!r}")
    return sf


@shared_task(bind=True)
def run_pipeline_job(self, job_id: int) -> str:
    from .models import PipelineJob

    job = PipelineJob.objects.get(pk=job_id)
    job.status = PipelineJob.Status.RUNNING
    job.started_at = timezone.now()
    job.log = ""
    job.save(update_fields=["status", "started_at", "log"])

    stream = _JobLog(job)

    def emit(line: str) -> None:
        stream.write(line if line.endswith("\n") else line + "\n")

    try:
        if job.kind == PipelineJob.Kind.FETCH_DUMP:
            result = _run_fetch_dump(job, stream, emit)
        elif job.kind == PipelineJob.Kind.FETCH_PAGEVIEWS:
            result = _run_fetch_pageviews(job, stream, emit)
        else:
            result = _run_build(job, stream, emit)
    except Exception:  # noqa: BLE001 - record any failure on the job, then re-raise
        job.refresh_from_db(fields=["log"])
        job.status = PipelineJob.Status.FAILED
        job.finished_at = timezone.now()
        job.log += "\n== FAILED ==\n" + traceback.format_exc()
        job.save(update_fields=["status", "finished_at", "log"])
        raise

    job.refresh_from_db(fields=["log"])
    job.status = PipelineJob.Status.SUCCEEDED
    job.finished_at = timezone.now()
    job.log += f"\n== done: {result} =="
    job.save(update_fields=["status", "finished_at", "log"])
    return result


def _run_fetch_dump(job, stream, emit) -> str:
    # Imported lazily so the web image can enqueue without these on the import path.
    from django.core.management import call_command

    emit(f"== download CoL dump -> {job.coldp_dir} (replaces the old one) ==")
    call_command("fetch_col_dump", "--out", job.coldp_dir, stdout=stream, stderr=stream)
    return f"dump refreshed at {job.coldp_dir}"


def _run_fetch_pageviews(job, stream, emit) -> str:
    from django.core.management import call_command

    if not (job.fame_year and job.fame_month):
        raise ValueError(
            "a Download-pageview-dump job needs fame_year + fame_month (which month to fetch)."
        )
    emit(f"== download + build pageview DB for {job.fame_year}-{job.fame_month:02d} "
         "(one-time; future fame builds reuse it) ==")
    args = ["--year", str(job.fame_year), "--month", str(job.fame_month)]
    if job.fame_dump:  # an already-downloaded bz2 on the PVC → skip the network fetch
        args += ["--dump", job.fame_dump]
    call_command("fetch_pageviews_dump", *args, stdout=stream, stderr=stream)
    return f"pageview DB ready for {job.fame_year}-{job.fame_month:02d}"


def _run_build(job, stream, emit) -> str:
    from django.core.management import call_command

    from .models import AssetVersion

    scope_filter = _parse_scope_filter(job.scope_filter)
    if not job.scope_key:
        raise ValueError("a Build job needs a scope_key.")

    # Each build gets the next version for its scope, so prior builds stay browsable in the
    # admin and remain promotable via "Set current".
    last = AssetVersion.objects.filter(scope=job.scope_key).order_by("-version").first()
    version = (last.version + 1) if last else 1

    emit(f"== build {job.scope_key} v{version} (filter {scope_filter!r}, "
         f"enrich={job.enrich}, include_extinct={job.include_extinct}) ==")

    with tempfile.TemporaryDirectory(prefix="cladewright-build-") as tmp:
        out = Path(tmp) / f"{job.scope_key}.json"
        build_args = [
            "--coldp-dir", job.coldp_dir,
            "--out", str(out),
            "--scope", scope_filter,
            "--scope-key", job.scope_key,
            "--enrich", job.enrich,
            "--asset-version", str(version),
        ]
        if job.label:
            build_args += ["--label", job.label]
        if job.include_extinct:
            build_args += ["--include-extinct"]
        # Notable-blob delivery + fame source (all admin-tunable on the job).
        build_args += [
            "--notable-max", str(job.notable_max),
            "--notable-coverage", str(job.notable_coverage),
            "--notable-min", str(job.notable_min),
            "--frontier-rank", job.frontier_rank,
        ]
        if job.fame_dump:
            build_args += ["--fame-dump", job.fame_dump]
        if job.fame_year and job.fame_month:
            build_args += ["--fame-year", str(job.fame_year), "--fame-month", str(job.fame_month)]
        build_args += ["--fame-source", job.fame_source]
        call_command("build_gamedata", *build_args, stdout=stream, stderr=stream)

        load_args = ["--asset", str(out)]
        if job.load_current:
            load_args += ["--current"]
        emit(f"== load {out.name} (current={job.load_current}) ==")
        call_command("load_gamedata", *load_args, stdout=stream, stderr=stream)

    # Opt-in cleanup: once this build is the current one, drop the scope's superseded
    # versions (and their cascaded nodes/tips/aliases) so old builds don't pile up. Gated on
    # load_current so we never delete everything and leave the scope dark.
    if job.load_current and job.delete_old:
        superseded = AssetVersion.objects.filter(scope=job.scope_key, is_current=False)
        removed, _ = superseded.delete()
        emit(f"== pruned superseded {job.scope_key} versions "
             f"({removed} rows incl. nodes/tips/aliases) ==")

    return f"{job.scope_key} v{version}"
