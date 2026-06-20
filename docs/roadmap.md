# Roadmap

Build order. The guiding principle: **Marathon is the goal, and ~80% of what
Marathon needs (data layer + TreeRenderer) is also everything Classic needs** — so
building Marathon well gets Classic almost for free afterward.

Sequence is dependency-ordered. Each phase should leave something runnable.

## Phase 0 — Foundations

- Repo scaffold: Django + DRF project, React + Tailwind SPA, shared dev tooling.
- Pin BICHO and Braidworks as Python deps.
- Lock the **game-asset schema** ([`game-asset-format.md`](game-asset-format.md))
  first — it's the contract every other phase depends on. Hand-author a tiny fixture
  asset (a few dozen tips) so frontend work can start before the real pipeline does.

## Phase 1 — Data pipeline ✅ (done)

- **Braidworks weaver** built + verified: `wikidata_weaver` (vernacular names + QID +
  enwiki title + `skos:altLabel` + `P13176` common-name stitch), `verify --strict` +
  live E2E.
- `manage.py build_gamedata`: ColDP ingest → backbone → pool select (**all species
  in scope**; legacy capped floor mode kept) → Braidworks enrich → validated asset.
  Clades are nameable (node aliases); names matched underscore-free.
- Real-data evaluation done on **all 6,459 Catalogue of Life Mammalia** (fetched via
  `scripts/fetch_clb_coldp.py`): 97.7% common-name coverage, valid 6,360-tip asset.
- Remaining polish: per-clade dataset configs; fill clade common names from
  higher-taxon vernacular.
- **Deferred to post-MVP:** the "fame" system — `wikipedia_weaver` pageviews →
  `time_weight` obscurity weighting. Dropped from the MVP; time bonus is novelty-only.

## Phase 2 — TreeRenderer (shared)

The riskiest UI work; do it early and deliberately.

- SVG radial layout via `d3-hierarchy`, rendering the **induced tree** only.
- **Layout stability** from day one: animated transitions, focus anchoring,
  zoom-to-densify, fit button (see [`marathon-design.md`](marathon-design.md#layout-stability)).
- Node types: found tip (common bold + scientific italic), internal clade node,
  hidden-sister label (both A/B styles). Pan/zoom/fit.
- Rectangular layout as a secondary mode (preferences toggle).

## Phase 3 — Marathon (primary)

- HUD: timer, single name input with scope-restricted autocomplete, live count.
- Naming **species or clades** → route onto induced tree; grow incrementally.
- **Specificity reward rule**: time + score only when a name places a NEW node;
  naming a duplicate or an already-implied ancestor gives nothing. (Reuses the
  induced tree's `present` set — see [`marathon-design.md`](marathon-design.md).)
- **"N remaining"** labels with the three anti-clutter rules; tunable threshold.
  Implement the `O(L)` incremental design from [`performance.md`](performance.md)
  (interned indices, typed `found_count`, monotonic threshold crossing).
- Timer + bonus weighted by **novelty** (MRCA depth); game-over. (Obscurity weighting
  from pageviews is post-MVP.)
- Optional "trait?" reveal.
- **Both modes**: free play + daily-seeded run (server-authoritative seed).
- Client-side scoring; server-side re-validation stub.

## Phase 4 — Accounts & persistence

- `django-allauth` + Google OAuth.
- Scores, best runs, streaks; Marathon leaderboard with server-side score
  validation.

## Phase 5 — Classic (rides on 1–2)

- Server-authoritative daily mystery seed.
- Guess → place MRCA node; proximity bar + rank label; guess history; limited
  guesses; win state. Reuses the asset, TreeRenderer, and autocomplete wholesale.

## Later / stretch

- Expand pool beyond animals (plants, fungi, all life) — same pipeline, wider scope.
- Difficulty modes (casual common-names / nerd scientific-only).
- Themed Marathons via biome/environment metadata (marine run, Neotropical run).
- Open Tree of Life "truer topology" mode.
- Deeper anti-cheat on the leaderboard.

## Cross-cutting, every phase

- Keep gameplay client-side and the backend thin; honor the lightweight play-loop
  rules in [`performance.md`](performance.md).
- Responsive + mobile is a primary target, not a final pass.
- Both common and scientific names visible everywhere.
