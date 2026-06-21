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

## Phase 2 — TreeRenderer (shared) ✅ (done)

- SVG radial layout via `d3-hierarchy`, rendering the **induced tree** only, grown
  (never rebuilt) with a `present` set.
- **Layout stability**: Framer-Motion animated positions + edges, keyed by stable id.
  **Radial elbow links** (tangent-out, radial-in) keep solo runs straight and branches
  tidy; deterministic sibling ordering so the tree is a function of *what's placed*, not
  typing order. Pan/zoom/fit (pan converts px→viewBox units, clamped).
- Node types: found tip (common bold + scientific italic, toggleable), clade node,
  "N hidden" sister label (deepest-branch roll-up, suppressed at 0).
- Rectangular phylogram as a secondary mode (Visual setting).
- **Density control ("too many" fix)**: `d3.cluster` (all tips on the rim, not by graph
  depth); horizontal side-anchored labels; a zoom threshold that sheds scientific/clade
  detail when zoomed out; **adaptive clade collapse** (`collapse.ts`) that folds the
  densest subtrees into expandable wedges to cap rendered glyphs (~`COLLAPSE_BUDGET`);
  greedy **label collision culling**. Wedges toggle open/shut on click; cards are
  hover-then-pin. No-op on small trees. *Manual* fold/unfold only — see Explorer below
  for the zoom-driven variant.

## Phase 3 — Marathon (primary) ✅ (playable)

- HUD: timer, single name input, live count. (Resolution is the in-memory alias
  index; a scope-restricted autocomplete *combobox UI* is still to add.)
- Naming **species or clades** → routes onto the induced tree; grows incrementally.
- **Specificity reward rule**: new / refinement / duplicate tiers via the induced
  tree's `present` + `namedNodes` sets.
- **"N remaining"** labels, `O(L)` incremental (`RemainingTracker`); tunable threshold.
- Timer + **novelty** bonus (MRCA depth); game-over + replay. Settings panel tunes
  start time / per-organism time / infinite-time, persisted to `localStorage`.
- **Still to do:** the "trait?" reveal; daily-seeded server-authoritative run (free
  play works today); the autocomplete combobox.

## Phase 3.5 — Learn-cards + Postgres serving ✅ (done)

- **NodeCard**: hover/click any node → Wikipedia image + lead paragraph + link, with
  asset metadata (rank, lineage, traits). Multiple pinnable, draggable, self-placing;
  Wikipedia results cached in `localStorage`. The learn/deduce surface.
- **Backend on Postgres** (dev = prod via Docker, see [`development.md`](development.md)):
  `AssetVersion` (JSONB blob) + relational `TaxonNode/Tip/Alias` mirror loaded by
  `load_gamedata`. Endpoints: `/current`, `/version`, plus `/search` (trigram) +
  `/resolve` for the huge-scope path. Frontend loads from `/api/gamedata/current/`.

## Phase 4 — Accounts & persistence

- `django-allauth` + Google OAuth (configured; credentials TODO).
- `Run` / `Streak` models + migrations exist; submit + leaderboard endpoints are
  scaffolded (`NotImplementedError`). Build score submission with server-side
  re-validation, then the leaderboard.

## Phase 5 — Classic (rides on 1–2)

- Server-authoritative daily mystery seed.
- Guess → place MRCA node; proximity bar + rank label; guess history; limited
  guesses; win state. Reuses the asset, TreeRenderer, and autocomplete wholesale.

## Later / stretch

- **Design pass**: modernize the UI toward the mocks in `docs/examples/` (homepage
  hub, Marathon HUD) — animated pages, distinctive type, museum-clean look.
- **Huge-scope frontend (all-Animalia)**: a *remote-resolver mode* that uses the
  backend `/search` + `/resolve` endpoints (already built) instead of the in-memory
  alias index, so the client never downloads the GB-scale blob. Render/induced-tree
  code is unchanged; see [`architecture.md`](architecture.md#scaling-to-huge-scope).
- **Explorer / Zen mode** (home for the "Tier 3" tree interaction): a lean-back, no-clock
  way to roam the whole tree of life. This is where **zoom-driven auto-expand** belongs —
  clades bloom open as you zoom into them and fold as you pull back, instead of the manual
  wedge-click used in the game. The collapse engine (`collapse.ts`) already supports it:
  drive the `expanded` set from `view.scale` + the visible viewport each frame rather than
  from clicks; pair with viewport culling. Deliberately **kept out of Marathon** — during a
  timed run your hands are on the keyboard, continuous layout reflow fights layout-stability
  and the Framer-Motion animations, and you rarely zoom mid-race. Automatic collapse +
  culling already keep the timed tree legible without interaction. (A cheap middle ground if
  click-drilling ever feels fiddly: auto-open a wedge only once you've zoomed far enough
  *into* it — stable, no continuous recompute.)
- Difficulty modes (casual common-names / nerd scientific-only).
- Themed Marathons via biome/environment metadata (marine run, Neotropical run).
- Open Tree of Life "truer topology" mode.
- Deeper anti-cheat on the leaderboard.

## Cross-cutting, every phase

- Keep gameplay client-side and the backend thin; honor the lightweight play-loop
  rules in [`performance.md`](performance.md).
- Responsive + mobile is a primary target, not a final pass.
- Both common and scientific names visible everywhere.
