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
| `basal_chordata` | Basal chordates | `subphylum=Tunicata,Cephalochordata` |

Notes:
- **`scope_filter`** is the CoL `rank=value[,value…]` slice. A comma list is a **union** (for
  paraphyletic groups with no single CoL node).
- **Reptiles** are paraphyletic in CoL (`class=Reptilia` excludes birds) — by design.
- **Fish** is the union of all 10 living fish classes — there is no single "fish" node in CoL.
- **Basal chordates** are the non-vertebrate chordates the vertebrate scopes above miss:
  sea squirts/salps (Tunicata) + lancelets (Cephalochordata). Small (~3 k) → plain blob.
  (If CoL labels Tunicata as "Urochordata", use that.)
- Each build auto-bumps to the next **version** for its scope; the previous version stays
  browsable in **Asset versions** and can be re-served with the **Set current** action.

## 2. Huge scopes (hybrid delivery)

Scopes too big to ship whole (Arthropoda ≈1.2 M species) are served **hybrid**: the client
downloads a capped "notable" blob (top-fame species + the complete coarse backbone) and
resolves the long tail on demand via `/resolve`. Same **Build asset** job, but set the
**Notable blob** fields (all admin-tunable):

| scope_key | label | scope_filter | notable_max | notable_coverage | notable_min | frontier_rank |
|---|---|---|--:|--:|--:|---|
| `arthropoda` | Arthropoda | `phylum=Arthropoda` | `20000` | `0.9` | `5000` | `family` |
| `invertebrata_other` | Other invertebrates | `phylum=Mollusca,Annelida,Cnidaria,Echinodermata,Platyhelminthes,Nematoda,Porifera,Bryozoa,Nemertea,Rotifera,Tardigrada,Onychophora,Acanthocephala,Brachiopoda,Phoronida,Ctenophora,Placozoa,Chaetognatha,Nematomorpha,Gastrotricha,Kinorhyncha,Priapulida,Loricifera,Hemichordata,Xenacoelomorpha,Gnathostomulida,Micrognathozoa,Cycliophora,Entoprocta,Dicyemida,Orthonectida` | `20000` | `0.9` | `5000` | `family` |

Notes:
- **notable_max = 0** (the default, used by every scope in §1) ships the **whole** pool — no
  tail. Set it >0 only when a scope is too big to ship whole; `~20000` is a good ceiling.
- **notable_coverage** = fraction of total fame (≈pageview) mass to cover; **notable_min** is
  the floor so a popularity-concentrated scope still ships a meaty offline pool. The blob
  ships `clamp(coverage-of-mass, min, max)` tips.
- **frontier_rank** (`family`) is the coarse backbone always shipped + the deepest rank
  `/resolve` trims a tail guess to. Every node at/above it ships, so any tail species attaches.
- **"Other invertebrates"** is a pragmatic union of the non-arthropod, non-chordate animal
  phyla (extend/trim the list to taste — it's just a `scope_filter`). It overlaps nothing
  with `arthropoda` or the chordate scopes.
- **fame at scale** — see §3: run the **Download pageview dump** job ONCE; every fame build
  then reuses the local pageview DB automatically (no per-job `fame_dump` needed). Without a
  prebuilt DB, fame falls back to the per-title pageviews REST API — fine for the small scopes
  in §1, but **one HTTP request per species**, so unusable for a million-species build.

## 3. Fame at scale — download the pageview DB once

The popularity ("fame") signal is enwiki pageviews. The keyless pageviews REST API is **one
request per article**, so it's fine for a few-thousand-species scope but impossible for
Arthropoda (≈1.2 M). The fix is a one-time job that downloads a monthly Wikimedia pageview
dump and builds a local `title → views` SQLite on the worker's PVC; afterwards every fame
build does a fast local lookup (plus the already-batched Wikidata title/sitelink resolve).

Run this **before** a huge-scope build (and refresh monthly if you want fresher numbers):

| field | value |
|---|---|
| kind | **Download pageview dump** |
| fame_year | e.g. `2026` |
| fame_month | e.g. `6` (1–12) |
| fame_dump | *(blank — fetched from Wikimedia; set only if you pre-downloaded the `.bz2`)* |

Notes:
- One-time + cached: it streams a ~3 GB dump and builds a ~0.4 GB SQLite at
  `$BRAIDWORKS_DATA_DIR/wikipedia/` on the dump PVC (the worker sets
  `BRAIDWORKS_DATA_DIR=/app/data/braidworks`). It is **not** re-downloaded on pod restarts,
  and **every later Build job reuses it with no extra fields** — the job log prints
  `fame source: prebuilt pageview DB …`. Re-run the job (or a build with `fame_year/month`)
  to refresh to a newer month.
- The build job's **fame_year/fame_month** only need setting if you want a build's fame dated
  to a specific month; normally leave them blank and the one prebuilt DB is used as-is.
- There is **one** pageview DB, downloaded once (like the CoL dump) and auto-reused by every
  build. When a build can't find it and falls back to REST, the log now names the **exact path
  it checked**, e.g. `fame source: REST api (no prebuilt DB at /app/data/braidworks/wikipedia/…)`.
  If you ran a dump job but a build still says REST, the build pod isn't seeing the dump job's
  volume — they must share `$BRAIDWORKS_DATA_DIR` (same PVC / same replica).
- The build log now reports fame progress and coverage, e.g.
  `fame: 4,810/6,500 tips scored (74%) — top 1,838,000 (lion)`, so you can see it working.

## Adding a new standard scope

1. Add the `key|label|scope` line to `build_starter_scopes.sh` (keep it the source of truth).
2. Add a row here.
3. Queue the Build-asset job in the admin (or run `make starter-scopes` locally).

> CLI equivalent (local build venv) for any of the above:
> ```
> make build-asset SCOPE="class=Aves" COLDP=data/coldp_col OUT=data/out/aves.json
> make seed ASSET=/data/out/aves.json
> ```
