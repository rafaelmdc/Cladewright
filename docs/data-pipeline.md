# Data pipeline

How a Catalogue of Life dump becomes the game-data asset the app ships. Output
schema is the separate contract in [`game-asset-format.md`](game-asset-format.md);
this doc is the *process*.

The pipeline is offline and deterministic. It lives in the in-repo `backend/pipeline/`
package (`ingest` → `backbone` → `pool` → `enrich` → `asset` → `validate`) and is driven by
a Django management command (`manage.py build_gamedata`). Enrichment imports **Braidworks**;
nothing else is an external pipeline dependency. Normal request handling never runs it.

```
ColDP dump ──▶ [1] ColDP ingest ──▶ [2] backbone build ──▶ [3] pool select
                                                                  │
              [5] asset build ◀── [4] Braidworks enrich ◀────────┘
```

## Inputs

- A **Catalogue of Life Data Package (ColDP)** directory. At minimum `NameUsage.tsv`;
  `Distribution.tsv` (biomes/ranges, ~100% coverage on Animalia) and `TypeMaterial.tsv`
  (type-locality, sparse) are used when present.
- The pinned **Braidworks** version and the ColDP release date — both go into the asset's
  provenance so a build is reproducible.

## Stage 1 — ColDP ingest (tips, lineage, metadata)

`pipeline/ingest.py` reads the ColDP dump directly, scoped to `kingdom=Animalia` for v1. Why
ColDP rather than NCBI: ColDP is a curated Linnaean checklist, where NCBI carries 10–30%
placeholder sequencing names ("'Axial Seamount' polynoid polychaete") that make worthless tips.

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
  often not). Read it here; fill the gaps in Stage 4.

### Getting the ColDP dump (bulk, not the API)

`pipeline/ingest.py` reads **two ColDP shapes**, picked automatically from the header,
so the pipeline never needs a separate denormalize step:

- **normalized** — the standard CoL archive (`latest_coldp.zip`): a `parentID` chain.
  Ingest indexes the accepted backbone once, then walks each species' parents into a
  ranked lineage. **This is the source for any scope** — `make col-dump` downloads the
  ~1 GB archive once and every clade (`--scope class=Aves`, `order=Carnivora`, …) is
  sliced locally from it. Prefer this over the ChecklistBank *search API*, which would
  have to be paginated per clade and risks rate-limiting.
- **denormalized** — `scripts/fetch_clb_coldp.py` output (each row carries its lineage
  columns). Kept for small, targeted API pulls; fine for a single clade but don't fan it
  out over the whole kingdom.

Wikidata enrichment (Stage 4) is rate-safe by construction: the weaver batches 200
names per SPARQL POST and caches by month, so a full clade is tens of cached queries.

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
- **Legacy capped mode** (`size>0`) remains in `select_pool`: deterministic top-N (by
  `source_id`) with a per-clade floor guarantee — kept for any future scope too sparse
  for an all-species pool. Not used for the well-covered clades. (It once ranked by
  fame; that popularity ranking is post-MVP, so selection is now purely by id.)

Source for the dataset: a real ColDP can be fetched per-clade with no auth via
`backend/scripts/fetch_clb_coldp.py` (pages the ChecklistBank read API — used to pull
all 6,459 Mammalia species + vernacular names for the evaluation).

## Stage 4 — Braidworks enrichment (common names)

ColDP's `VernacularName.tsv` (Stage 1) covers most species in a well-covered clade
but leaves gaps. Those are filled by a **Braidworks** weaver
(Spec→Scaffold→Implement→Verify, not ad-hoc scripts). CoL vernacular is the first
pass; Braidworks fills the missing names that make natural-name resolution feel
right. This stage is pure enrichment — it never gates inclusion (the pool is all
species):

- **`wikidata_weaver`** — taxon scientific name (`P225`) → QID + **names for the alias
  index**, UNIONed into one English-name stream: `rdfs:label`, `skos:altLabel`
  ("the lion", variants, synonyms), `P1843` vernaculars, the **enwiki sitelink title**
  (the *primary* common-name source — "Hyena" for Hyaenidae, "Bear" for Ursidae), and
  the label of any separate **common-name item** linked via `P13176` ("seal",
  "monkey", "kangaroo" live there, not on the family). Hangs off
  `organism.scientific_name`; the whole batch resolves in chunked SPARQL `POST`s.

> **Status: built + wired.** `wikidata_weaver` exists, passes `verify --strict` + live
> E2E; the planner routes `organism.scientific_name → {organism.vernacular_names,
> wikipedia.title}`. Cladewright consumes it via `enrich.BraidworksProvider`, which
> harvests names for **species *and* clade nodes** (so "bear" → Ursidae, "sloth" →
> Folivora resolve). Run a real build with `--enrich braidworks`; the default stays
> `OfflineProvider` so the pipeline still runs without it.
>
> **Packaging:** Braidworks (`braidworks-core` + `wikidata_weaver`) is installed straight
> from its **public GitHub repo** (`rafaelmdc/braidworks`), pinned to an immutable tag in
> `backend/requirements-pipeline.txt` (`git+https://…@wikidata_weaver-v0.1.0#subdirectory=…`).
> The same file feeds the local build venv and the pipeline worker image, so they're
> identical. It is deliberately **not** in the serving image — only asset builds need it.
> To bump: tag a new release in the Braidworks repo and change the `@ref` on both lines.
>
> **Post-MVP (deferred):** the popularity/obscurity "fame" system — a
> `wikipedia_weaver` pageview score that would weight the Marathon time bonus by
> obscurity. Dropped for the MVP; the time bonus is novelty-only. Optional future
> sources: `prop=redirects` for the long tail, `gbif_weaver` for sparse vernaculars.

Enrichment runs over the pool *candidates* (a few thousand), not all 3.2M animals,
so it is cheap and Braidworks' caching makes re-runs near-free.

Name handling produced here:

- A **display common name** per tip, by precedence (mirrors the reference, which makes
  the enwiki article title the canonical name): **enwiki title** → CoL `VernacularName`
  → first clean harvested name → scientific name. Two filters keep it clean: a title
  that is merely the **binomial** (obscure species whose article is the Latin name)
  yields to a real vernacular, and **authority strings** ("Vulpes Frisch, 1775") are
  dropped via `enrich.is_junk_name` — they still make fine alias keys, just not display
  names. (This is why "Vulpes vulpes" shows *Red fox*, not the "Silver Fox" altLabel.)
- An **alias/autocomplete table**: every harvested name + variants, mapping to tip OR
  clade ids. Built-time (not play-time) is where ambiguity is resolved.

### Stage 3.5 — virtual paraphyletic groups

Some common names are **paraphyletic**: "fox" spans *Vulpes*, *Urocyon*, *Lycalopex*,
*Cerdocyon*, *Atelocynus*, *Otocyon* — scattered across Canidae, with no single clade to
point at. Resolving "fox" to any one genus is arbitrary. Following the reference (which
hand-builds a `VFOX` node), `pipeline/paraphyletic.py` inserts a curated **virtual clade
node** (`grp:Fox`, parent Canidae) and re-parents the member genera under it; the asset
then gives that node **exclusive ownership** of the group's alias keys, so "fox" →
`grp:Fox` (a real, placeable "Fox" clade) while "vulpes" still → genus *Vulpes*. The
list is curated for now (Wikipedia's 241 `{{Paraphyletic group}}` defs could automate
the long tail later).

## Stage 5 — Asset build

Emit the single versioned game-data asset described in
[`game-asset-format.md`](game-asset-format.md). Precompute everything the client
needs so play is O(lineage length):

- The **pool-induced backbone**: only nodes on a path from the root to some pool
  tip, with every degree-2 link kept only where a rank label or hint can attach.
- Per node: `pool_count` (number of pool tips beneath it) — the denominator of
  "N remaining".
- Per tip: ordered ancestor-id path (for O(L) MRCA), common+scientific names, and
  biome/trait flags. (No fame/time_weight — the Marathon time bonus is novelty-only,
  computed live; the pageview-based weighting is post-MVP.)
- The alias/autocomplete index.
- A **provenance block**: ColDP release, Braidworks version, pool config, build
  timestamp, asset `version`.

## Stage 6 — load into Postgres (serving)

The build above writes a JSON file; `manage.py load_gamedata --asset <file> --current`
ingests it into Postgres, the store of record. Decoupled from `build_gamedata` on
purpose: loading needs **no** pipeline deps, so a built asset is promoted to any
environment by shipping the JSON. One load writes both representations of the same build:

- **`AssetVersion.blob`** — the whole asset JSON in a `JSONB` column (one row per
  `(scope, version)`, `is_current` flag). This is what *blob mode* serves: small scopes
  download it whole and play in-memory.
- **Relational mirror** — `TaxonNode` / `TaxonTip` / `Alias`. Lineages are denormalized
  onto the rows (array columns) so `/resolve` is a single-row read, and `Alias.norm`
  gets a **GIN trigram index** (a Postgres-only, vendor-guarded migration) so `/search`
  autocomplete is fast over millions of names. This is what *incremental mode* serves for
  the huge scope (all-Animalia), where the blob would be too big to ship. See
  [`architecture.md`](architecture.md#scaling-to-huge-scope).

`load_gamedata` is idempotent per `(scope, version)` and computes node depth + lineage
from the asset's parent pointers at load time.

## Reproducibility & versioning

- A build is a pure function of (ColDP dump, pinned dep versions, pool config). Same
  inputs → byte-identical asset.
- The asset carries a monotonic `version`; the client caches by it and the backend
  serves the current one. Bumping the pool size or refreshing ColDP = new version,
  not an in-place edit.
- Never commit ColDP dumps or intermediate multi-GB artifacts — they're git-ignored. The
  built asset lives in Postgres (loaded by `load_gamedata`), not the repo.
