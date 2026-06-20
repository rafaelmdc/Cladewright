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

The **playable pool** is the set of species nameable in-game and over which the "N
remaining" counts range.

**Decided: keep all non-extinct species in scope** (`select_pool(size=0)`) — the
rose.systems/animalist model. Real-data evaluation justified this: for a
well-covered clade the common-name coverage is excellent (Mammalia: **97.7%** CoL +
~90% Wikidata), so there's no need to curate down to a famous few. With the whole
clade in, the "N remaining" counts mean something all the way to the tips, and the
reveal threshold keeps near-root counts hidden — so hints concentrate on small
terminal clades, rewarding specificity (see
[`marathon-design.md`](marathon-design.md)).

- **Scope = a well-covered clade** (Mammalia, Aves, herps, fish, …), each also a
  potential per-clade game. The poorly-covered long tail of all-Animalia is left out
  by default (common-name coverage collapses there); open it later behind a
  scientific-only mode.
- **Extinct excluded (v1).** Fossil/extinct-only taxa are filtered out and not
  counted; the `extinct` flag is **preserved** for a later themed paleo scope.
- **Legacy curated mode** (`size>0`) remains in `select_pool`: fame-ranked top-N with
  a per-clade floor guarantee — kept for any future scope too sparse for an
  all-species pool. Not used for the well-covered clades.

Source for the dataset: a real ColDP can be fetched per-clade with no auth via
`backend/scripts/fetch_clb_coldp.py` (pages the ChecklistBank read API — used to pull
all 6,459 Mammalia species + vernacular names for the evaluation).

## Stage 4 — Braidworks enrichment (common names + fame)

ColDP's `VernacularName.tsv` (Stage 1) covers most species in a well-covered clade
but leaves gaps, and it gives us no popularity signal. Both are filled by
**Braidworks** weavers (Spec→Scaffold→Implement→Verify, not ad-hoc scripts). CoL
vernacular is the first pass; Braidworks fills missing names and supplies the fame
score. **Fame no longer gates inclusion** (the pool is all species) — pageviews now
only weight the Marathon **time bonus / difficulty** (obscure species are worth more
time; see [`marathon-design.md`](marathon-design.md#time-bonus-weighting)). So this
stage is enrichment, not a gate:

- **`wikidata_weaver`** — taxon → vernacular (common) names + Wikidata QID.
  Hangs off the existing organism/NCBI-taxid hub.
- **Wikipedia pageviews** — QID/title → pageview count = the objective fame score
  that drives pool ranking. (Its own weaver or a capability on the Wikidata one.)
- **`gbif_weaver`** *(optional)* — additional vernacular-name coverage / id
  crosswalk where Wikidata is sparse.

> **Status: built.** `wikidata_weaver` and `wikipedia_weaver` exist in the
> braidworks repo (branch `cladewright-weavers`) — both pass `verify --strict` and a
> live E2E, and the planner routes `organism.scientific_name → wikipedia.pageviews`.
> Cladewright consumes them through `enrich.BraidworksProvider` (one batched braid
> per build); `--enrich braidworks` on `build_gamedata` switches it on. The default
> stays `OfflineProvider` so the pipeline runs without the weavers installed.

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
