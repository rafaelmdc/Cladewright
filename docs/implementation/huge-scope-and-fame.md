# Huge-scope delivery + popularity ranking — implementation plan

> **Status: planned, not built.** Actionable plan for issue #42's Track B; the original
> design note is [`../huge-scope-hybrid.md`](../huge-scope-hybrid.md). Track A
> (compression/brotli) shipped in PR #51.

## Context

Some scopes are too big to ship as one blob even brotli'd — Arthropoda (~1.25 M species)
≈ 95 MB gzip. Plan: **capped "notable" blob + client-side membership filter + remote
tail**. Bundle the most *popular* species so ~99% of guesses resolve locally; fall
through to the network only for genuine long-tail guesses; reject typos client-side so
they never hit it at all.

Two problems gate this, both resolved below:

1. **Rank taxa by popularity, viably** — to choose which N to bundle (and to weight the
   Marathon time-bonus).
2. **Serve the tail fast (0.5–1 s)** — a rare guess resolves with no perceptible wait.

## Guiding principle

A taxonomy is an **immutable tree**. Immutability means every answer can be precomputed;
treeness means traversal is trivial. So the target is **a hot path with zero backend
compute** — every player-facing read is an immutable, versioned, CDN-cached artifact.
The database becomes a build-time + admin tool plus a cold-miss fallback, never the
steady-state serving path. We optimize *serving*, not the storage engine (see D1).

### Target hot path (steady state, fully built out)

| Player action | Served by | Backend hit |
|---|---|---|
| Load a scope | Notable blob — static immutable file, versioned URL | none (CDN) |
| Is this a real name? | Binary-fuse membership filter, bundled in the blob | none (local) |
| Famous-name → id | Blob's baked alias index | none (local) |
| Tail name → id | Prefix-sharded alias file, static | none (CDN) |
| id → placement lineage | Trimmed `/resolve`, immutable + versioned | none after first global hit (CDN pull-through) |

Backend (Django/Postgres) on the hot path after cache warm: **nothing.** It runs the
build pipeline, admin, and a cold-`/resolve` fallback.

## What's already built (don't rebuild)

- **Remote endpoints** — `backend/apps/gamedata/views.py`: `ResolveView` (one organism's
  denormalized lineage), `SearchView` (trigram alias match), `ScopesView` (tags scopes
  `blob` vs `remote`).
- **Relational mirror** — `backend/apps/gamedata/models.py`: `TaxonNode`/`TaxonTip` carry
  a **denormalized `lineage` array** (root→parent ids) → resolve is point-reads, never a
  recursive walk. `Alias` has a `pg_trgm` GIN index (migration `0002`).
- **Growable client asset** — `frontend/src/lib/asset/growable.ts` (`createEmptyAsset` +
  `foldResolved`, dedups nodes by id); `remote.ts` (`resolveRemote` cached per
  `(scope,id)`).
- **IndexedDB version cache** (#43) — `frontend/src/lib/asset/cache.ts`.
- **Wikidata enrichment hook** — `enrich.py` `BraidworksProvider.harvest()` already
  batches Wikidata; the asset format reserves the `fame` slot.

## Decisions

**D1 — Keep Postgres; no graph DB.** A tree with single-parent, acyclic, "to-root /
to-descendants" traversal is already solved by the materialized `lineage` array; a graph
engine (Neo4j/Memgraph/Dgraph) would be slower *and* add a stateful service. Immutability
means the real win is precompute+cache, not a faster query engine. Postgres stays as
origin + build store.

**D2 — Hot path = immutable CDN artifacts (pull-through).** Serve `/resolve`, the blob,
and the alias shards at **versioned URLs** with `Cache-Control: public, max-age=31536000,
immutable`. The long tail is rarely guessed, so origin load → ~0 after the first global
hit. **No pre-generating millions of files** — the CDN fills itself. (Optional later: an
in-memory packed `Int32` parent array on origin — tens of MB for 1.25 M tips — if cold
point-reads ever profile hot.)

**D3 — Trimmed resolve payload** ("+1 layer, never whole orders"). Return only the
lineage the client lacks, by a rule identical for all clients (so it stays cacheable).
See [Resolve payload redesign](#resolve-payload-redesign).

**D4 — Popularity = Wikipedia pageview dumps, sitelink count fallback.** Over the live
pageview REST API (rate-limited, non-deterministic, doesn't scale to 1 M+ taxa) and over
sitelink-count-only (coarser). See [Fame foundation](#fame-foundation).

**D5 — Tail name→id resolution is static, not a live query.** The game uses **exact-match
input, no fuzzy autocomplete** (existing project decision), so the tail never needs
trigram fuzzy search — only exact normalized lookup. Build **prefix-sharded alias files**
(`/idx/<scope>/<v>/<prefix>.json`, sorted `[norm, id, kind, fame]`) keyed on the
**real Braidworks alias set** — exactly the `index_keys()` output already used to build
the blob's alias index (full normalized names + baked plural/singular forms), nothing
synthetic. **No per-word tokenization** — splitting names into words would let "african"
match a pile of unrelated taxa and manufacture ambiguity; a multi-word key like
"honey bee" only resolves to a bare word if Braidworks actually emitted that word as an
alias. Shard by the key's leading chars (1–2; 3-char sub-shard for hot buckets to keep
files small). The client fetches one shard (CDN-cached) and does a local exact lookup.
This **removes the last live query from the hot path** and retires the trigram scaling
risk; `SearchView` survives only as an admin/fallback tool.

**D6 — Wire-format size levers** (raise the effective cap). (a) **Drop `lineage` from the
wire** — rebuild it from parent pointers at intern time (same routine the trimmed-resolve
fold uses); ~5% gzip + parse/memory win. (b) **Alias audit** — aliases are ~half the raw
asset and mostly derivable from `tip.common/sci` + `node.common/sci`; derive those at
intern time, ship only true synonyms. (c) **Columnar / int-id encoding** (parallel
arrays, ids interned to ints) — 2–4× density, mainly a parse-time win; measure before
adopting (gzip already dedups strings). Levers, not blockers — apply if a cap needs more
coverage per MB.

## Resolve payload redesign

**Today:** `ResolveView` returns the full root→parent lineage every call. In hybrid mode
the client already holds the upper backbone from the blob, so most of that is redundant —
and we don't want to unwrap a whole order on one species guess.

**Design — backbone frontier + anchor:**

- The build defines a **frontier**: a fixed cut, default **rank ≥ family** (tunable; or
  adaptive `pool_count ≥ K`, valid because `pool_count` is monotonic up-tree). **Every
  frontier node ships in the blob for the whole scope**, not just families with a famous
  species. *(Build change: blob backbone = famous pool-induced backbone ∪ all frontier
  nodes — guarantees every tail species has a present anchor.)*
- `/resolve(id)` returns the target + the lineage **trimmed to start at the deepest
  frontier ancestor** (the *anchor*, included so the client can connect) down to the
  parent — typically just **species → genus**, anchored at an already-present family.
- `foldResolved` rebuilds the full `tip.lineage` (needed for MRCA) by walking parent
  pointers **up from the anchor** through the loaded backbone — local, O(depth), no extra
  fetch. Correct because the frontier is monotonic: the anchor's whole ancestor chain is
  already in the blob. This reuses the D6(a) "rebuild lineage from parents" routine.

```jsonc
{
  "target": { "id": "tip:Apis_mellifera", "kind": "tip", "sci": "Apis mellifera",
              "common": "western honey bee", "traits": { } },
  "anchor": "fam:Apidae",          // deepest node the client already has
  "lineage": [                      // anchor (inclusive) → parent only — NOT from root
    { "id": "fam:Apidae", "rank": "family", "sci": "Apidae", "common": "bees",
      "pool_count": 5800, "pool_count_extant": 5780 },
    { "id": "gen:Apis", "rank": "genus", "sci": "Apis", "common": null,
      "pool_count": 11, "pool_count_extant": 8 }
  ]
}
```

If `anchor` is absent from the client (pure-remote empty-asset mode), the server sets the
frontier to root and sends the full chain — current behavior, unchanged.

*Deferred (not v1):* a bounded sibling slice for local context on placement — it enlarges
and de-uniqueifies the payload (worse caching). Revisit after measuring.

## Fame foundation

The chosen **first slice**. Adds a `fame` score and ships value on today's blob scopes
immediately, independent of huge scopes; later it ranks the notable top-N.

- **New weaver** (Braidworks-style, offline/deterministic, mirrors `enrich.py`
  providers): stream the **monthly Wikimedia pageview dump** (`pageviews-YYYYMM-user`, a
  few GB) once → `{enwiki_title → views}`. No live API, no rate limits, reproducible.
- **Join taxon → enwiki title** via Wikidata sitelinks (already reachable through
  `BraidworksProvider`); **fallback** to **Wikidata sitelink count** where no enwiki
  article exists (the issue's "sitelinks as alt").
- **Store** `fame` (int) on each tip in the asset + `TaxonTip` (slot reserved; bump
  `schema` minor); persist the join so rebuilds stay deterministic.
- **Immediate payoffs** on current scopes: ambiguity tiebreak in name resolution
  (`frontend/src/lib/game/resolve.ts`, `SearchView`) so famous "robin" wins; the deferred
  Marathon obscurity time-bonus (`docs/marathon-design.md`).

## Phased plan

1. **Fame foundation** *(first slice)* — pageview-dump weaver + sitelink fallback →
   `fame` on tips; wire into resolve/search tiebreak. *Touch:* `pipeline/enrich.py`
   (weaver), `pipeline/types.py`, `pipeline/asset.py`, `apps/gamedata/models.py`
   (`TaxonTip.fame`), `apps/gamedata/views.py`, `frontend/src/lib/game/resolve.ts`,
   `frontend/src/lib/asset/types.ts`.
2. **Latency hardening** — immutable `Cache-Control` + versioned URLs on `/resolve` +
   blob; trim the resolve payload (D3); add the shared "rebuild lineage from parents"
   routine (D6a) and use it in `foldResolved`. *Touch:* `apps/gamedata/views.py`,
   `frontend/default.conf.template`, `frontend/src/lib/asset/{growable,remote}.ts`.
3. **Notable cap + complete coarse backbone** — fame-ranked `--pool-size` cap and
   "all frontier nodes" in `build_gamedata`/`pool.py`/`asset.py`; `ScopesView` `hybrid`
   mode; seed `growable.ts` from the blob instead of empty.
4. **Membership filter** — build a **binary-fuse8** filter over the full `index_keys` set
   (~1 byte/key, ~0.4% FP — a FP only wastes one static lookup that returns nothing),
   ship as a blob artifact (bump `schema`); client checks it before any network +
   negative-result cache.
5. **Static tail name-resolution** (D5) — emit prefix-sharded alias files at build;
   client resolves tail names from the shard. Removes remote `/search` from the hot path.
6. **Prove Arthropoda end-to-end**, measure (below), and apply D6 size levers only if the
   cap needs more coverage.

## What to measure (decide on field numbers, per the issue)

- `/resolve` cold vs edge-cached latency; origin point-read time at 1 M+ rows.
- Notable-blob size vs coverage (% of guesses served locally) across several caps.
- Alias-shard sizes per prefix bucket (which need 3-char sub-sharding).
- Binary-fuse FP rate vs size; **key-coverage gaps** (synonyms/plurals/vernaculars) — the
  only real risk, since a missing key would wrongly reject a real species.

## Verification

- **Fame** — rebuild a small scope; assert `fame` populated and deterministic across two
  runs; an ambiguous common name resolves to the higher-fame taxon (`resolve.ts` +
  `SearchView` tests).
- **Trimmed resolve** — `ResolveView` test: `lineage[0]` is the frontier anchor, nothing
  coarser than the cut is returned; `foldResolved` test: MRCA between two tail tips
  sharing an above-cut ancestor stays correct.
- **Static path** — given a tail name, the prefix shard yields the right id with zero
  backend calls; the binary-fuse rejects a known-fake name locally.
- **Caching** — `curl -I` the versioned `/resolve` URL shows `immutable`; Cloudflare
  `cf-cache-status: HIT` on the second fetch.
- **End-to-end** — on a capped hybrid scope, a famous guess places instantly (local) and
  a tail guess places in a single round-trip < 1 s and edge-caches on repeat.
- Run `backend/pipeline/validate.py` on every rebuilt asset.
