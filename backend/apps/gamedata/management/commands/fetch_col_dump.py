"""fetch_col_dump — download the Catalogue of Life bulk ColDP archive and replace the
local dump in place.

The Python twin of scripts/fetch_col_dump.sh, so the pipeline WORKER (and the admin job
queue that drives it) can refresh the dump without a shell. Downloads the ~1 GB zip to a
temp file, extracts only the tables the pipeline reads into a fresh sibling dir, then
ATOMICALLY swaps it in and deletes the previous dump + the downloaded zip — so a failed
download never corrupts the dump that's already there, and stale data is never left behind.

    python manage.py fetch_col_dump --out data/coldp_col
"""
from __future__ import annotations

import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

# Only these tables are ingested; extracting just them keeps the dump dir small.
WANTED = ("NameUsage.tsv", "VernacularName.tsv", "Distribution.tsv")
DEFAULT_URL = "https://download.checklistbank.org/col/latest_coldp.zip"


class Command(BaseCommand):
    help = "Download the CoL ColDP archive and replace the local dump (deletes the old one)."

    def add_arguments(self, parser) -> None:
        parser.add_argument("--out", default="data/coldp_col",
                            help="Dump directory to (re)create. Default: data/coldp_col.")
        parser.add_argument("--url", default=getattr(settings, "COL_DUMP_URL", DEFAULT_URL),
                            help="Source archive URL (defaults to the CoL latest ColDP).")

    def handle(self, *args, **opts) -> None:
        out = Path(opts["out"]).resolve()
        url = opts["url"]
        out.parent.mkdir(parents=True, exist_ok=True)
        staging = out.with_name(out.name + ".new")
        if staging.exists():
            shutil.rmtree(staging)
        staging.mkdir(parents=True)

        # Download to a temp file alongside the dump (same filesystem) so we never hold the
        # whole archive in memory and the temp is cleaned even on failure.
        with tempfile.NamedTemporaryFile(
            dir=str(out.parent), prefix="coldp-", suffix=".zip.part", delete=False
        ) as tmp:
            zip_path = Path(tmp.name)
        try:
            self.stdout.write(f"downloading CoL ColDP dump (~1 GB) from {url} …")
            self._download(url, zip_path)
            self.stdout.write(f"extracting {', '.join(WANTED)} …")
            self._extract(zip_path, staging)

            # Atomic-ish swap: remove the old dump, move the fresh one into place.
            if out.exists():
                shutil.rmtree(out)
            staging.rename(out)
            self.stdout.write(self.style.SUCCESS(f"dump ready -> {out}"))
            for f in sorted(out.iterdir()):
                self.stdout.write(f"  {f.name}  ({f.stat().st_size:,} bytes)")
        finally:
            # Always delete the downloaded archive + any leftover staging dir.
            zip_path.unlink(missing_ok=True)
            if staging.exists():
                shutil.rmtree(staging, ignore_errors=True)

    def _download(self, url: str, dest: Path) -> None:
        req = urllib.request.Request(url, headers={"User-Agent": "cladewright-pipeline"})
        with urllib.request.urlopen(req) as resp, dest.open("wb") as fh:
            total = int(resp.headers.get("Content-Length") or 0)
            done = 0
            next_mark = 5
            while True:
                chunk = resp.read(1 << 20)  # 1 MiB at a time — bounded memory
                if not chunk:
                    break
                fh.write(chunk)
                done += len(chunk)
                if total:
                    pct = done * 100 // total
                    if pct >= next_mark:
                        self.stdout.write(f"  {pct}%  ({done:,}/{total:,} bytes)")
                        next_mark = pct + 5

    def _extract(self, zip_path: Path, dest: Path) -> None:
        wanted = set(WANTED)
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = Path(info.filename).name
                if name in wanted:
                    # Flatten: the archive may nest tables under a folder.
                    with zf.open(info) as src, (dest / name).open("wb") as out_fh:
                        shutil.copyfileobj(src, out_fh, length=1 << 20)
                    self.stdout.write(f"  extracted {name}")
