#!/usr/bin/env bash
# Fetch the Catalogue of Life bulk ColDP archive (the whole tree of life) ONCE, instead
# of paginating the ChecklistBank search API per clade (which risks rate limits). The
# pipeline ingests this normalized dump directly (parentID walk) — no preprocessing — so
# every scope (class=Aves, order=Carnivora, …) is sliced locally from this one download.
#
# Usage:  backend/scripts/fetch_col_dump.sh [out-dir]
# Default out-dir: data/coldp_col
#
# ~1 GB download. Resumable (curl -C -). Extracts only the tables the pipeline reads.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$(dirname "$here")")"
out="${1:-$repo_root/data/coldp_col}"
url="https://download.checklistbank.org/col/latest_coldp.zip"
zip="$repo_root/data/latest_coldp.zip"

mkdir -p "$(dirname "$zip")" "$out"
echo "downloading CoL ColDP dump (~1 GB, resumable)…"
curl -L -C - -o "$zip" "$url"

echo "extracting NameUsage / VernacularName / Distribution…"
# -j junk paths (the archive may nest the tables under a folder); -o overwrite.
unzip -o -j "$zip" '*NameUsage.tsv' '*VernacularName.tsv' '*Distribution.tsv' -d "$out"

echo "done -> $out"
ls -la "$out"
echo "next:  make build-asset SCOPE=class=Aves COLDP=data/coldp_col OUT=data/out/aves.json"
