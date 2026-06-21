# AGENTS.md — working in Cladewright

Instructions for an AI agent (or human) contributing to this repository. Read this
before making changes. It is intentionally short and prescriptive; the "why" lives
in [`docs/`](docs).

## What this repo is

Cladewright is a daily phylogenetics guessing site: two games (**Marathon**, the
primary novel one, and **Classic**, a Metazooa-style daily) sharing one
tree-of-life renderer. A **Django + DRF** backend serves a precomputed game-data
asset and handles accounts/scores; a **React + Tailwind** SPA runs all gameplay
client-side. The data comes from a Catalogue of Life dump via **BICHO**, enriched
with common names + fame via **Braidworks**.

Start with [`README.md`](README.md), then [`docs/architecture.md`](docs/architecture.md)
and [`docs/roadmap.md`](docs/roadmap.md).

## The load-bearing ideas (do not erode these)

1. **Gameplay is client-side; data is precomputed.** The client loads the game-data
   asset and runs MRCA / proximity / "N remaining" locally. Do **not** add a
   per-guess *scoring/judging* round-trip — the play loop is local. The **one**
   sanctioned server interaction during play is **huge-scope incremental delivery**
   (`/search` + `/resolve`) for scopes too big to ship as a blob (all-Animalia): the
   client lazily fetches names + one organism's lineage and **grows its asset**, still
   judging locally. Those endpoints must stay **single-indexed-read + immutable/cacheable**,
   the client **debounces search and caches every resolve**, so the server load is
   minimal. Everything else (identity, scores, daily seed) is the only other backend
   surface. See `docs/architecture.md#scaling-to-huge-scope`.
2. **The game-asset format is a contract.** [`docs/game-asset-format.md`](docs/game-asset-format.md)
   is the interface between the pipeline and the app. Both sides depend on its
   shape. Change it deliberately, keep its validation green, and bump `version`.
3. **Ship only the induced tree, never the full backbone.** The frontend renders
   only the minimal subtree connecting reached tips through their MRCAs. The
   asset carries only the pool-induced backbone + counts.
4. **"N remaining" stays uncluttered by rule, not by luck.** The three anti-clutter
   rules in [`docs/marathon-design.md`](docs/marathon-design.md#why-this-doesnt-clutter)
   (induced-tree-only, threshold gating, deepest-branch roll-up) are the design,
   not suggestions. Hidden labels are **count only, never a name**.
5. **Layout stability is a feature.** Tree nodes animate to new positions and never
   teleport on reflow. Build this into the TreeRenderer from its first commit.
6. **Stay lightweight; keep the play loop local.** Every per-name operation
   (`found_count`, labels, tree growth) is `O(L)` along one lineage path over
   interned integer indices + typed arrays. Nothing in the play loop may iterate the
   pool or backbone, re-scan all nodes, or re-layout on a non-topology change. See
   [`docs/performance.md`](docs/performance.md) before touching the game loop.

## Boundaries (do not cross these)

- **BICHO and Braidworks are dependencies, not internals to fork.** Depend on their
  *outputs* and public APIs. Do not vendor or patch their code from inside
  Cladewright.
- **New data enrichment is a Braidworks weaver, not a script here.** Common names,
  pageviews, GBIF crosswalks, etc. are added in the Braidworks repo through its
  Spec→Scaffold→Implement→Verify loop (see `braidworks/AGENTS.md`): real
  `source_sample`, provenance/license fields filled, `verify --strict` green, live
  E2E run after touching any API backend. Cladewright then consumes the weaver.
- **Never commit data artifacts.** ColDP dumps and multi-GB intermediates are
  git-ignored. The shipped game-data asset is small; how it's stored (committed vs
  release artifact) is decided once it has a real size — until then, don't commit
  dumps.
- **The daily seed is server-authoritative.** The Classic mystery-of-the-day and
  any daily-seeded Marathon must come from the server deterministically, never be
  guessable or settable from the client.
- **Leaderboard scores are validated server-side.** Re-score/replay a submitted
  Marathon run at submit time; never trust a posted number.
- **Both names, always.** Common *and* scientific names are shown everywhere in the
  UI. Don't ship a surface that drops one.
- **Asset builds are reproducible.** A build is a pure function of (ColDP dump,
  pinned dep versions, pool config). Don't introduce nondeterminism (unseeded
  randomness, wall-clock-dependent ordering) into the pipeline.

## Conventions

- **Backend:** Python (Django + DRF). The pipeline runs only via
  `manage.py build_gamedata`; request handlers never import BICHO/Braidworks.
- **Frontend:** React + Tailwind, SVG tree via `d3-hierarchy`, Framer Motion for
  transitions. Reach for **Radix primitives** only for accessible combobox /
  tooltip / dialog — no full UI kit.
- **Responsive + mobile is a primary target**, evaluated each phase, not a final pass.
- Keep `docs/` truthful: when a decision changes, update the doc it lives in rather
  than leaving it stale. These docs are the design of record.

## Git workflow

Treat this like a real open-source project — don't let work pile up uncommitted on one
branch.

- **Commit in logical units, continuously.** Each commit is one coherent change with a
  clear message (what + why); don't batch unrelated edits. End commit messages with the
  `Co-Authored-By: Claude …` trailer.
- **Branch per feature/phase.** Cut a feature branch off the active phase branch for a
  new unit of work (e.g. `feat/remote-resolver`); don't stack unrelated features on one
  branch. Never commit straight to a release/default branch.
- **Open PRs over time, not in one dump.** When a feature branch reaches a reviewable
  milestone, push it and open a PR (`gh pr create`) with a short summary + test notes —
  even if work continues after. Small, frequent PRs over one giant one.
- **Never commit data artifacts or secrets** (see Boundaries): `/data/`, dumps,
  `.env`, pasted screenshots. (Braidworks is installed from a pinned GitHub tag in
  `requirements-pipeline.txt` — no vendored wheels to commit.)
- **Keep builds green before a PR**: `tsc`/lint on the frontend, the pipeline's
  `validate_asset`, and any touched tests.

## Status

Phase 1+ — actively built. Backend (Postgres asset store, blob + incremental serving,
`build_gamedata` pipeline with Braidworks enrichment, starter clade scopes) and the
Marathon vertical slice exist. See [`docs/roadmap.md`](docs/roadmap.md) and the project
memory for the current frontier (scope picker, extinct toggle, remote-resolver).
