# Data pipeline

How a Catalogue of Life dump becomes the game-data asset the app ships. Output
schema is the separate contract in [`game-asset-format.md`](game-asset-format.md);
this doc is the *process*.

The pipeline is offline and deterministic. It is driven by a Django management
command (`manage.py build_gamedata`) that imports BICHO and Braidworks as Python
dependencies. Normal request handling never runs it.

```
ColDP dump ──▶ [1] BICHO ingest ──▶ [2] backbone build ──▶ [3] pool select
                                                                  │
              [5] asset build ◀── [4] Braidworks enrich ◀────────┘
```

## Inputs

- A **Catalogue of Life Data Package (ColDP)** directory — the same input BICHO
  already consumes. At minimum `NameUsage.tsv`; `Distribution.tsv` (biomes/ranges,
  ~100% coverage on Animalia) and `TypeMaterial.tsv` (type-locality, sparse) are
  used when present.
- Pinned versions of BICHO and Braidworks, and a record of the ColDP release date
  — all three go into the asset's provenance so a build is reproducible.

## Stage 1 — BICHO ingest (tips, lineage, metadata)

Reuse BICHO's `taxa ingest` over the ColDP dump, scoped to `kingdom=Animalia` for
v1. Why ColDP rather than NCBI: ColDP is a curated Linnaean checklist, where NCBI
carries 10–30% placeholder sequencing names ("'Axial Seamount' polynoid
polychaete") that make worthless tips — see `BICHOv2/docs/inputs.md`.

What each accepted species row gives us, denormalized, with no tree-walk:

- **Full ranked lineage** (`kingdom → phylum → … → genus → species`, plus
  sub-ranks). This *is* the tree topology and the source of MRCA computation.
- `scientificName`, authorship, `combinationAuthorshipYear`.
- `environment`, `extinct` — hint/trait flags.
- From `Distribution.tsv`: biogeographic ranges / biomes (near-total coverage) —
  the richest source of *nameless* hints ("this hidden one is marine /
  Neotropical").
- From `VernacularName.tsv` (ColDP side table): **common names**, where present.
  This is a free first pass — CoL has scientific names always, but vernacular
  coverage is **patchy and English-skewed** (famous animals yes, the long tail
  often not). Read it here; fill the gaps in Stage 4. BICHO doesn't currently ingest
  this file, so either extend its `taxa ingest` or read the side table directly.

## Stage 2 — Backbone build

Turn the denormalized lineages into a single rooted tree:

- One internal node per distinct (rank, name) lineage cell; one tip per accepted
  species. Parent links come straight from adjacent lineage cells.
- Collapse empty/duplicate rank cells (not every species fills every sub-rank) so
  the backbone has no degenerate chains.
- This backbone covers **all** ingested animals (~millions). It is the routing
  structure: any organism a player names lands somewhere on it. It is *not* shipped
  whole — only the pool-induced portion plus counts is (Stage 5).

## Stage 3 — Pool selection (what's playable and counted)

The **playable pool** is the curated subset of species that are nameable in-game
and that the "N remaining" counts range over. Bounding the counts to the pool is
what makes "8/10 bears, 2 hidden" meaningful instead of a five-digit number over
every sequenced subspecies.

Selection = **rank pool-eligible animals by fame, keep the top N, with a per-clade
floor** (`POOL_SIZE ≈ 2,500` for v1, expandable — it is just a threshold). Fame
score comes from Stage 4. The rules:

- **Per-clade floor (decided).** Guarantee a minimum number of tips from each major
  group (e.g. each class/order) so no big clade is starved — pure fame ranking
  otherwise over-fills mammals/birds and leaves reptiles/insects nearly empty. Fill
  by fame *within* each group up to the floor, then fill remaining slots globally by
  fame. (No per-clade *ceiling* in v1 — famous animals are never dropped to even out
  a group.)
- **Extinct excluded (v1).** Fossil/extinct-only taxa are filtered out of the
  nameable pool and not counted. The `extinct` flag is **preserved** through the
  pipeline so a later themed "paleo" Marathon can build its own pool from it — see
  [`marathon-design.md`](marathon-design.md#decisions). v1 simply excludes them.
- The pool size, the floor, and the group level it applies at are **config**,
  re-runnable without code changes.

## Stage 4 — Braidworks enrichment (common names + fame)

ColDP's `VernacularName.tsv` (Stage 1) covers the famous animals but leaves gaps,
and it gives us **no popularity signal** for Stage 3. Both gaps are closed by
**Braidworks**, added as proper **weavers** via its Spec→Scaffold→Implement→Verify
loop (not ad-hoc scripts). CoL vernacular is the first pass; Braidworks fills
missing names and supplies the fame score:

- **`wikidata_weaver`** — taxon → vernacular (common) names + Wikidata QID.
  Hangs off the existing organism/NCBI-taxid hub.
- **Wikipedia pageviews** — QID/title → pageview count = the objective fame score
  that drives pool ranking. (Its own weaver or a capability on the Wikidata one.)
- **`gbif_weaver`** *(optional)* — additional vernacular-name coverage / id
  crosswalk where Wikidata is sparse.

> Building these weavers is itself tracked work — see [`roadmap.md`](roadmap.md).
> Follow `braidworks/AGENTS.md`: real `source_sample`, provenance fields filled,
> `verify --strict` green, live E2E run after touching any API backend.

Enrichment runs over the pool *candidates* (a few thousand), not all 3.2M animals,
so it is cheap and Braidworks' caching makes re-runs near-free.

Name handling produced here:

- A **display common name** per tip, by precedence: CoL `VernacularName` →
  Wikidata vernacular → scientific name as last resort (the UI always shows both
  anyway).
- An **alias/autocomplete table**: every accepted common name, plus obvious
  variants, mapping many↔one to tip ids. This is the backbone of typo-free
  autocomplete and is where common-name ambiguity ("cat", "bear") gets resolved
  deliberately rather than at play time.

## Stage 5 — Asset build

Emit the single versioned game-data asset described in
[`game-asset-format.md`](game-asset-format.md). Precompute everything the client
needs so play is O(lineage length):

- The **pool-induced backbone**: only nodes on a path from the root to some pool
  tip, with every degree-2 link kept only where a rank label or hint can attach.
- Per node: `pool_count` (number of pool tips beneath it) — the denominator of
  "N remaining".
- Per tip: ordered ancestor-id path (for O(L) MRCA), common+scientific names,
  biome/trait flags, fame, and a Marathon time-bonus weight.
- The alias/autocomplete index.
- A **provenance block**: ColDP release, BICHO/Braidworks versions, pool config,
  build timestamp, asset `version`.

## Reproducibility & versioning

- A build is a pure function of (ColDP dump, pinned dep versions, pool config). Same
  inputs → byte-identical asset.
- The asset carries a monotonic `version`; the client caches by it and the backend
  serves the current one. Bumping the pool size or refreshing ColDP = new version,
  not an in-place edit.
- Never commit ColDP dumps or intermediate multi-GB artifacts (mirror BICHO's
  "never commit data artifacts" rule). The shipped *asset* is small and may be
  committed or stored as a release artifact — decide once it has a real size.
