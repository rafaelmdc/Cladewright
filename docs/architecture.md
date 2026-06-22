# Architecture

How Cladewright is put together and *why*. This is the design rationale; forward work
is tracked in [GitHub issues](https://github.com/rafaelmdc/Cladewright/issues).

> See [`README.md`](README.md) for the full doc index and routing.

## The one big idea: gameplay is client-side, data is precomputed

The taxonomy is large and static. A game session — the tree, the timer, the
guesses, the MRCA math, the "N remaining" counts — is small and fast. So we split
hard along that line:

- An **offline pipeline** turns a multi-million-row taxonomy into one compact,
  versioned **game-data asset** (see [`game-asset-format.md`](game-asset-format.md)).
- The **client** loads that asset once and runs the entire game locally. No
  per-guess server round-trip, no latency, no way to lag.
- The **server** (Django + DRF over **Postgres**) does only what a server must:
  store + serve the right asset version, identity, and persistence. It is
  deliberately thin — but Postgres also lets the *huge* scope (all-Animalia) serve
  the tree incrementally when the blob would be too big to ship (see
  [Scaling](#scaling-to-huge-scope)).

This keeps the fun part instant and the backend boring — which is exactly what
you want for a game.

## Three subsystems

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA PIPELINE (offline, Python)                                  │
│    ColDP ──ingest────────▶ tips + ranked lineage + biomes         │
│         ──Braidworks──────▶ common names (Wikidata + enwiki)      │
│         ──build──────────▶ game-data asset (versioned JSON)       │
│         ──load_gamedata──▶ Postgres (blob + relational mirror)    │
│    Runs on a separate Celery worker (admin-queued); web never     │
│    builds. See data-pipeline.md + admin.md                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │  game-data asset (the contract)
┌───────────────────────────────▼─────────────────────────────────┐
│  BACKEND (Django + DRF + Postgres)                                │
│    • blob mode:  serves the current whole asset (small scopes)    │
│    • incr. mode: /search (trigram) + /resolve (huge scopes)       │
│    • accounts: django-allauth, Google OAuth                       │
│    • persistence: scores, streaks, leaderboards                   │
│    • daily: admin-tunable rotation/pins, one-shot, global streak  │
│    • admin: themed Django admin — scopes, games, pipeline jobs     │
└───────────────────────────────┬─────────────────────────────────┘
                                │  REST (JSON)
┌───────────────────────────────▼─────────────────────────────────┐
│  FRONTEND (React + Tailwind, SPA)                                 │
│    • TreeRenderer  — shared radial/rectangular tree (SVG)         │
│    • NodeCard      — hover/click a node → Wikipedia learn-card    │
│    • Marathon      — timed tree-builder (primary)                 │
│    • Classic       — daily MRCA guesser                           │
│    • all game logic local against the loaded asset                │
└─────────────────────────────────────────────────────────────────┘
```

## Frontend

- **React + Tailwind.** Tailwind for the clean, museum-like look without a
  component-library aesthetic. No full headless/UI kit — pull in **Radix
  primitives** only for the genuinely fiddly accessible bits (combobox for
  autocomplete, tooltip, dialog).
- **TreeRenderer is the centerpiece** and is shared by both games. SVG, not
  canvas: you are in the hundreds-of-visible-nodes range, and SVG gives free
  interactivity and accessibility. Use **`d3-hierarchy`** for the radial/cluster
  layout math and render the result with React.
- **Layout stability is a first-class requirement, not a polish item.** A radial
  layout reflows globally every time a node is added; if nodes teleport, the game
  feels broken. Animate every position change (**Framer Motion** / d3 transitions)
  and anchor the player's focused clade so distant branches absorb the reflow. See
  [`marathon-design.md`](marathon-design.md#layout-stability).
- **Progressive disclosure.** Never render the full backbone. Only draw the
  *induced tree*: the minimal subtree connecting the tips the player has reached,
  through their MRCAs. This is what keeps the canvas from flooding with 400+ tips.
- **Local game logic.** MRCA, proximity, and "N remaining" all compute on the
  client from the precomputed asset, `O(lineage-length)` per op over interned
  integer indices + typed arrays — nothing in the play loop scales with the pool or
  backbone. Full strategy: [`performance.md`](performance.md).
- **NodeCard — the learn/deduce surface.** Hovering or clicking any node (species
  *or* clade) opens a card: names, rank, lineage trail, traits (from the asset) plus
  a Wikipedia image + lead paragraph and a link out (lazy-fetched, cached in
  `localStorage` — at most one Wikipedia request per name, ever). Cards pin
  (multiple), drag, and self-place to stay on-screen. This is where the scientific
  structure pays off as something the reference can't do.
- **Settings (persisted).** A panel exposes tree layout (radial / rectangular
  phylogram), a scientific-names toggle, and the Marathon time dials — all saved to
  `localStorage`.

## Backend (Django + DRF)

Python is chosen on both ends on purpose: the data pipeline is heavily
Python-shaped (the in-repo `pipeline` package + Braidworks are Python), so the backend
that *regenerates* the dataset shares that language and can import it directly.

**Postgres is the store of record** (prod and dev — the dev stack runs the same
Postgres in Docker, see [`development.md`](development.md)). A built asset is loaded
into the DB **twice over**, from one build, by `manage.py load_gamedata`:

- `AssetVersion.blob` — the whole asset JSON in a `JSONB` column, one row per
  `(scope, version)`, with an `is_current` flag.
- `TaxonNode` / `TaxonTip` / `Alias` — a **relational mirror** of the same build.
  Lineages are **denormalized onto the rows** (array columns) so a lookup is a
  single-row read, never a recursive walk. `Alias.norm` carries a Postgres **GIN
  trigram index** for fast autocomplete.

Responsibilities, and nothing more:

- **Serve the asset — two delivery modes over the same stored build:**
  - *Blob mode* (small scopes: Mammalia, Aves…) — `GET /api/gamedata/current/`
    returns the whole `blob`; the client downloads it once and plays in-memory.
    Immutable per version → CDN-cacheable; the client caches by version (cheap
    freshness check at `/version/`).
  - *Incremental mode* (huge scopes: all-Animalia, where the blob would be GB-scale)
    — `GET /search/` does trigram autocomplete over `Alias`, and `GET /resolve/`
    returns one organism's denormalized lineage + counts. The client fetches only
    what the player actually places (a few hundred tiny, cacheable reads/game)
    instead of the whole tree. **Gameplay stays client-side in both modes** — only
    the *delivery* differs; see [Scaling](#scaling-to-huge-scope).
- **Accounts.** `django-allauth` with the Google provider. OAuth only to start.
- **Persistence.** Scores, best-runs, streaks, leaderboards.
- **Daily seed.** Both the Classic mystery-of-the-day and the daily-seeded Marathon
  run must be server-authoritative (deterministic per date, not guessable from the
  client) so the daily is fair and scores are comparable. Marathon also offers
  unlimited free play; see [`marathon-design.md`](marathon-design.md#decisions).
- **Dataset regeneration.** `manage.py build_gamedata` runs the in-repo `pipeline`
  package (importing Braidworks for enrichment) and writes a versioned asset JSON;
  `manage.py load_gamedata` then ingests that JSON into Postgres. The two are
  **decoupled on purpose** —
  loading needs no pipeline deps, so a built asset can be promoted to any
  environment by shipping the JSON. Pipeline deps are the *one* place the heavy
  Python is touched; normal request serving never imports them.

Marathon is leaderboard-bearing, so its scoring is validated server-side at
submit time (replay or re-score the run) rather than trusting a posted number.
Anti-cheat depth is a later concern, not an MVP blocker.

### Scaling to huge scope

The decomposition that makes all-Animalia feasible without a giant download: split
data by **how it scales**, not by what it is.

- **O(all-species)** data — the alias/autocomplete index — is the *only* unavoidably
  huge piece. It lives **server-side**, trigram-indexed, queried on demand (`/search`).
- **O(placed)** data — a placed organism's lineage + node counts — is **fetched
  lazily and cached client-side** (`/resolve`); immutable, so cacheable forever.
- **Gameplay** (induced tree, MRCA, "N remaining", rendering) is **always
  client-side**, operating only on what's been placed — unchanged by scope size.

So small scopes keep shipping a blob (fast, offline), and the huge scope adds a
frontend **remote-resolver mode** that swaps the in-memory alias lookup for the
`/search` + `/resolve` API. The render/induced-tree code doesn't change. Start
search on Postgres `pg_trgm`; reach for a dedicated search engine only if
autocomplete quality/latency ever demands it.

## Data pipeline (offline / management command)

Covered in full in [`data-pipeline.md`](data-pipeline.md). The key architectural
point: **Braidworks stays an independent tool** with its own contract, and Cladewright
depends on its *outputs*, not its internals. New enrichment (common names; pageviews are
post-MVP) is added as **Braidworks weavers**, built through that project's
Spec→Scaffold→Implement→Verify loop — not as throwaway scripts here. (ColDP ingest itself
lives in the in-repo `pipeline` package, not an external dependency.)

## Why not the alternatives

- **Next.js full-stack** — one language/deploy and great DX, but the ETL is Python
  regardless (the pipeline package + Braidworks), so a JS backend would still shell out to Python.
  Django keeps one language across pipeline + server and gives a free admin for
  pool curation.
- **Server-side game logic** — would add latency to every guess for no gain; the
  asset is small enough to ship whole.
- **Canvas / WebGL tree** — overkill at hundreds of nodes and costs you easy
  interactivity/accessibility. Revisit only if a "whole tree" view is ever added.
- **Open Tree of Life backbone** — phylogenetically truer, but bushy, uses its own
  IDs, and is weak on the *rank names* our hint labels depend on. ColDP's Linnaean
  ranks are a feature for this UI. OTT stays a possible "nerd mode" later.
