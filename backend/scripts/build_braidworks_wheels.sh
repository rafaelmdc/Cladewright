#!/usr/bin/env bash
# Rebuild the vendored Braidworks wheels that power real common-name enrichment
# (manage.py build_gamedata --enrich braidworks). We vendor wheels rather than depend on
# the sibling repo path so an asset build is self-contained and reproducible.
#
# Usage:  backend/scripts/build_braidworks_wheels.sh [path-to-braidworks-repo]
# Default braidworks path: ../../braidworks relative to this repo root.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
backend="$(dirname "$here")"
repo_root="$(dirname "$backend")"
braidworks="${1:-$(dirname "$repo_root")/braidworks}"
vendor="$backend/vendor"

if [[ ! -d "$braidworks/braidworks-core" ]]; then
  echo "braidworks repo not found at: $braidworks" >&2
  echo "pass its path: $0 /path/to/braidworks" >&2
  exit 1
fi

mkdir -p "$vendor"
echo "building braidworks-core + wikidata_weaver wheels -> $vendor"
( cd "$braidworks" \
  && uv build --package braidworks-core --wheel -o "$vendor" \
  && uv build --package wikidata_weaver --wheel -o "$vendor" )

# uv drops a .gitignore in the output dir; we WANT these wheels tracked.
rm -f "$vendor/.gitignore"
ls -1 "$vendor"/*.whl
echo "done. requirements-pipeline.txt installs these wheels."
