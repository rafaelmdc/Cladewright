# Architecture

How Cladewright is put together and *why*. This is the design rationale; the
build order lives in [`roadmap.md`](roadmap.md).

## The one big idea: gameplay is client-side, data is precomputed

The taxonomy is large and static. A game session — the tree, the timer, the
guesses, the MRCA math, the "N remaining" counts — is small and fast. So we split
hard along that line:

- An **offline pipeline** turns a multi-million-row taxonomy into one compact,
  versioned **game-data asset** (see [`game-asset-format.md`](game-asset-format.md)).
- The **client** loads that asset once and runs the entire game locally. No
  per-guess server round-trip, no latency, no way to lag.
- The **server** does only what a server must: identity, persistence, and serving
  the right asset version. It is deliberately thin.

This keeps the fun part instant and the backend boring — which is exactly what
you want for a game.

## Three subsystems

```
┌─────────────────────────────────────────────────────────────────┐
│  DATA PIPELINE (offline, Python)                                  │
│    ColDP ──BICHO ingest──▶ tips + ranked lineage + biomes         │
│         ──Braidworks──────▶ common names + Wikipedia pageviews    │
│         ──build──────────▶ game-data asset (versioned static file)│
│    Driven by a Django management command; see data-pipeline.md    │
└───────────────────────────────┬─────────────────────────────────┘
                                │  game-data asset (the contract)
┌───────────────────────────────▼─────────────────────────────────┐
│  BACKEND (Django + DRF)                                           │
│    • serves the current game-data asset (+ version)               │
│    • accounts: django-allauth, Google OAuth                       │
│    • persistence: scores, streaks, leaderboards                   │
│    • daily seed: server-authoritative mystery-of-the-day (Classic)│
└───────────────────────────────┬─────────────────────────────────┘
                                │  REST (JSON)
┌───────────────────────────────▼─────────────────────────────────┐
│  FRONTEND (React + Tailwind, SPA)                                 │
│    • TreeRenderer  — shared radial/rectangular tree (SVG)         │
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

## Backend (Django + DRF)

Python is chosen on both ends on purpose: the data pipeline is heavily
Python-shaped (BICHO and Braidworks are Python), so the backend that *regenerates*
the dataset shares that language and can import them directly.

Responsibilities, and nothing more:

- **Serve the asset.** Expose the current game-data asset and its version; the
  client caches by version.
- **Accounts.** `django-allauth` with the Google provider. OAuth only to start.
- **Persistence.** Scores, best-runs, streaks, leaderboards.
- **Daily seed.** Both the Classic mystery-of-the-day and the daily-seeded Marathon
  run must be server-authoritative (deterministic per date, not guessable from the
  client) so the daily is fair and scores are comparable. Marathon also offers
  unlimited free play; see [`marathon-design.md`](marathon-design.md#decisions).
- **Dataset regeneration.** A management command (`manage.py build_gamedata`)
  imports BICHO + Braidworks, runs the pipeline, and writes a new versioned asset.
  This is the *one* place the heavy Python deps are touched at "runtime"; normal
  request serving never imports them.

Marathon is leaderboard-bearing, so its scoring is validated server-side at
submit time (replay or re-score the run) rather than trusting a posted number.
Anti-cheat depth is a later concern, not an MVP blocker.

## Data pipeline (offline / management command)

Covered in full in [`data-pipeline.md`](data-pipeline.md). The key architectural
point: **BICHO and Braidworks stay independent tools** with their own contracts,
and Cladewright depends on their *outputs*, not their internals. New enrichment
(common names, pageviews) is added as **Braidworks weavers**, built through that
project's Spec→Scaffold→Implement→Verify loop — not as throwaway scripts here.

## Why not the alternatives

- **Next.js full-stack** — one language/deploy and great DX, but the ETL is Python
  regardless (BICHO/Braidworks), so a JS backend would still shell out to Python.
  Django keeps one language across pipeline + server and gives a free admin for
  pool curation.
- **Server-side game logic** — would add latency to every guess for no gain; the
  asset is small enough to ship whole.
- **Canvas / WebGL tree** — overkill at hundreds of nodes and costs you easy
  interactivity/accessibility. Revisit only if a "whole tree" view is ever added.
- **Open Tree of Life backbone** — phylogenetically truer, but bushy, uses its own
  IDs, and is weak on the *rank names* our hint labels depend on. ColDP's Linnaean
  ranks are a feature for this UI. OTT stays a possible "nerd mode" later.
