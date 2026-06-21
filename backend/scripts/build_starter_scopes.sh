#!/usr/bin/env bash
# Build every Cladewright "starter scope" game-data asset from one CoL ColDP dump, so a
# fresh machine can reproduce the full playable set with a single command. Each scope is a
# monophyletic CoL clade we ship as a downloadable blob; the manifest below is the single
# source of truth (the Makefile `starter-scopes` rule and docs/development.md both point
# here).
#
# Prereqs (see docs/development.md):
#   make col-dump        # one ~1 GB download -> data/coldp_col  (or pass COLDP=)
#   make pipeline-venv   # backend/.venv-pipeline with Braidworks
#
# Usage:
#   backend/scripts/build_starter_scopes.sh            # build all, skip ones already built
#   FORCE=1 backend/scripts/build_starter_scopes.sh    # rebuild even if the .json exists
#   COLDP=data/coldp_col OUT=data/out backend/scripts/build_starter_scopes.sh
#   backend/scripts/build_starter_scopes.sh aves reptilia   # only the named scopes
#
# Each build runs `manage.py build_gamedata --enrich braidworks --include-extinct`; load a
# result with `make seed ASSET=/data/out/<key>.json` (the extinct flag is baked, the client
# toggles it — see the extant/extinct dual counts).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(dirname "$(dirname "$here")")"
cd "$repo_root"

COLDP="${COLDP:-data/coldp_col}"
OUT="${OUT:-data/out}"
PPY="${PPY:-backend/.venv-pipeline/bin/python}"

# Manifest: key -> CoL scope (rank=value). One line per shippable starter scope. Note CoL has
# no Dinosauria/Actinopterygii nodes — non-avian dinosaurs aren't in CoL at all, and the
# bony-fish bulk is class=Teleostei. Keep keys filename-safe.
SCOPES=(
  "mammalia=class=Mammalia"     # Mammals
  "aves=class=Aves"             # Birds
  "reptilia=class=Reptilia"     # Reptiles (paraphyletic in CoL — excludes birds, by design)
  "amphibia=class=Amphibia"     # Amphibians
  "teleostei=class=Teleostei"   # Bony fish (~99% of fish species; sharks are a separate class)
  "carnivora=order=Carnivora"   # Carnivorans
)

if [ ! -x "$PPY" ]; then
  echo "ERROR: pipeline venv missing ($PPY). Run: make pipeline-venv" >&2; exit 1
fi
if [ ! -f "$COLDP/NameUsage.tsv" ]; then
  echo "ERROR: ColDP dump missing ($COLDP/NameUsage.tsv). Run: make col-dump" >&2; exit 1
fi

mkdir -p "$OUT"
want=("$@")  # optional subset of keys

is_wanted() { [ ${#want[@]} -eq 0 ] && return 0; for w in "${want[@]}"; do [ "$w" = "$1" ] && return 0; done; return 1; }

built=()
for entry in "${SCOPES[@]}"; do
  key="${entry%%=*}"
  scope="${entry#*=}"
  is_wanted "$key" || continue
  out="$OUT/$key.json"
  if [ -f "$out" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "skip $key  (exists; FORCE=1 to rebuild) -> $out"; built+=("$key"); continue
  fi
  echo "=== build $key  ($scope) ==="
  ( cd backend && "$repo_root/$PPY" manage.py build_gamedata \
      --coldp-dir "$repo_root/$COLDP" --scope "$scope" \
      --out "$repo_root/$out" --enrich braidworks --include-extinct )
  built+=("$key")
done

echo
echo "done. built/kept: ${built[*]:-(none matched)}"
echo "load one with:  make seed ASSET=/$OUT/<key>.json"
