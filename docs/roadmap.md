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

## Phase 1 — Data pipeline

- **Braidworks weavers** for enrichment, via that repo's Spec→Scaffold→Implement→
  Verify loop: `wikidata_weaver` (vernacular names + QID), Wikipedia pageviews
  (fame score), optionally `gbif_weaver`. `verify --strict` green + live E2E.
- `manage.py build_gamedata`: BICHO ingest (ColDP, `kingdom=Animalia`) → backbone
  build → pool select (top ~2,500 by fame) → Braidworks enrich → emit asset.
- Asset **validation** (the conformance checks in the format doc) wired into the
  build so a bad asset can't ship.

## Phase 2 — TreeRenderer (shared)

The riskiest UI work; do it early and deliberately.

- SVG radial layout via `d3-hierarchy`, rendering the **induced tree** only.
- **Layout stability** from day one: animated transitions, focus anchoring,
  zoom-to-densify, fit button (see [`marathon-design.md`](marathon-design.md#layout-stability)).
- Node types: found tip (common bold + scientific italic), internal clade node,
  hidden-sister label (both A/B styles). Pan/zoom/fit.
- Rectangular layout as a secondary mode (preferences toggle).

## Phase 3 — Marathon (primary)

- HUD: timer, single name input with pool-restricted autocomplete, live count.
- Naming → route tip onto induced tree; grow incrementally.
- **"N remaining"** labels with the three anti-clutter rules; tunable threshold.
  Implement the `O(L)` incremental design from [`performance.md`](performance.md)
  (interned indices, typed `found_count`, monotonic threshold crossing) — not a
  per-name node scan.
- Timer + **novelty time bonus**; game-over; score = tips placed.
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
