# Pipeline jobs — standard asset reference

Copy-paste values for the admin **Pipeline jobs → Add** form (`/admin/gamedata/pipelinejob/add/`).
A worker runs each job; watch its status/log on the change page. This list mirrors the build
manifest in [`backend/scripts/build_starter_scopes.sh`](../backend/scripts/build_starter_scopes.sh)
— that script is the source of truth; keep them in sync.

All builds use **enrich = `braidworks`** (real Wikidata common names) and **include extinct =
on** (the asset bakes both `pool_count` and `pool_count_extant`; the client toggles
extant-only). **coldp_dir** stays the default **`data/coldp_col`** (the full ~1 GB dump) for
every build below — they're all sliced from the one dump.

## 0. Refresh the dump first (when CoL releases a new version)

| field | value |
|---|---|
| kind | **Download CoL dump** |
| coldp_dir | `data/coldp_col` |

Downloads the latest archive, atomically replaces the old dump, deletes the old zip. Run this
before a batch of rebuilds when you want fresh data; skip it to rebuild from the dump already
on disk.

## 1. Standard "Build asset" jobs

For each row: **kind = Build asset**, **enrich = braidworks**, **include extinct = on**,
**load current = on** (serve it immediately), **coldp_dir = `data/coldp_col`**.

| scope_key | label | scope_filter |
|---|---|---|
| `mammalia` | Mammals | `class=Mammalia` |
| `aves` | Birds | `class=Aves` |
| `reptilia` | Reptiles | `class=Reptilia` |
| `amphibia` | Amphibians | `class=Amphibia` |
| `fish` | Fish | `class=Teleostei,Elasmobranchii,Myxini,Holocephali,Petromyzonti,Chondrostei,Cladistii,Holostei,Dipneusti,Coelacanthi` |

Notes:
- **`scope_filter`** is the CoL `rank=value[,value…]` slice. A comma list is a **union** (for
  paraphyletic groups with no single CoL node).
- **Reptiles** are paraphyletic in CoL (`class=Reptilia` excludes birds) — by design.
- **Fish** is the union of all 10 living fish classes — there is no single "fish" node in CoL.
- Each build auto-bumps to the next **version** for its scope; the previous version stays
  browsable in **Asset versions** and can be re-served with the **Set current** action.

## Adding a new standard scope

1. Add the `key|label|scope` line to `build_starter_scopes.sh` (keep it the source of truth).
2. Add a row here.
3. Queue the Build-asset job in the admin (or run `make starter-scopes` locally).

> CLI equivalent (local build venv) for any of the above:
> ```
> make build-asset SCOPE="class=Aves" COLDP=data/coldp_col OUT=data/out/aves.json
> make seed ASSET=/data/out/aves.json
> ```
