# AGENTS.md — working in Cladewright

Instructions for an AI agent (or human) contributing to this repository. Read this
before making changes. It is intentionally short and prescriptive; the "why" lives
in [`docs/`](docs/README.md).

## What this repo is

Cladewright is a daily phylogenetics guessing game. The primary game is **Time attack**
(internally `marathon_free`, route `/marathon`): name organisms against a clock and they
sprout on a tree-of-life you build live. A **Django + DRF** backend serves a precomputed,
versioned game-data asset and handles accounts/scores; a **React + TypeScript + Tailwind**
SPA runs all gameplay client-side. The asset is built offline from a **Catalogue of Life**
dump by the in-repo `backend/pipeline/`, with common names enriched via **Braidworks**.

Orientation: [`README.md`](README.md) → [`docs/architecture.md`](docs/architecture.md). To
find the right doc for a task, use the index: [`docs/README.md`](docs/README.md).

## Find the right doc before you edit

| Editing… | Read first |
|---|---|
| the game-data asset shape | [`docs/game-asset-format.md`](docs/game-asset-format.md) (it's a contract — bump `version`) |
| anything in the play loop (tree, counts, scoring, input) | [`docs/performance.md`](docs/performance.md) + [`docs/marathon-design.md`](docs/marathon-design.md) |
| the build pipeline / enrichment | [`docs/data-pipeline.md`](docs/data-pipeline.md) |
| modes / daily / leaderboards / scoring | [`docs/games-model.md`](docs/games-model.md) |
| deploy, CI, or recovering a stuck worker | [`docs/deployment.md`](docs/deployment.md) |
| the admin (builds, prune/purge, moderation) | [`docs/admin.md`](docs/admin.md) |

## The load-bearing ideas (do not erode these)

1. **Gameplay is client-side; data is precomputed.** The client loads the game-data
   asset and runs MRCA / proximity / "N remaining" locally. Do **not** add a
   per-guess *scoring/judging* round-trip — the play loop is local. The **one**
   sanctioned in-play server interaction is **huge-scope incremental delivery**
   (`/search` + `/resolve`) for scopes too big to ship as a blob: the client lazily
   fetches names + one organism's lineage and **grows its asset**, still judging locally.
   Those endpoints stay **single-indexed-read + immutable/cacheable**; the client
   **debounces search and caches every resolve**. Everything else (identity, scores,
   daily seed) is the only other backend surface. See `docs/architecture.md`.
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
   teleport on reflow.
6. **Stay lightweight; keep the play loop local.** Every per-name operation
   (`found_count`, labels, tree growth) is `O(L)` along one lineage path over
   interned integer indices + typed arrays. Nothing in the play loop may iterate the
   pool or backbone, re-scan all nodes, or re-layout on a non-topology change. See
   [`docs/performance.md`](docs/performance.md) before touching the game loop.

## Boundaries (do not cross these)

- **Braidworks is a dependency, not an internal to fork.** Depend on its *outputs* and
  public API; don't vendor or patch it from inside Cladewright. (BICHO is **not** a
  dependency — ColDP ingest lives in `backend/pipeline/`.)
- **New data enrichment is a Braidworks weaver, not a script here.** Common names,
  pageviews, GBIF crosswalks, etc. are added in the Braidworks repo through its
  Spec→Scaffold→Implement→Verify loop (see `braidworks/AGENTS.md`): real
  `source_sample`, provenance/license filled, `verify --strict` green, live E2E after
  touching any API backend. Cladewright then consumes the weaver via a pinned tag.
- **Never commit data artifacts.** ColDP dumps and multi-GB intermediates are
  git-ignored; the shipped asset lives in Postgres, not the repo.
- **The daily seed is server-authoritative.** Any daily-seeded run comes from the server
  deterministically — never guessable or settable from the client.
- **Leaderboard scores are validated server-side.** `SubmitRunView` re-scores a run's
  transcript from the relational mirror; never trust a posted number. A run is *ranked*
  only under default settings (the run is tainted-unranked once a scoring modifier changes).
- **Both names, always.** Common *and* scientific names are available everywhere; don't
  ship a surface that drops one.
- **Asset builds are reproducible.** A build is a pure function of (ColDP dump, pinned dep
  versions, pool config). No unseeded randomness or wall-clock-dependent ordering.

## Conventions

- **Backend:** Python (Django + DRF). The pipeline runs only on the Celery worker via
  `manage.py build_gamedata`; web request handlers never import the pipeline or Braidworks.
- **Frontend:** React + TypeScript + Tailwind, SVG tree via `d3-hierarchy`, Framer Motion
  for transitions. No full UI kit.
- **Responsive + mobile is a primary target.**
- **Keep `docs/` truthful:** when a decision changes, update its doc in the same PR. Each
  fact has one home (see [`docs/README.md`](docs/README.md) conventions); link, don't repeat.

## Git workflow

Treat this like a real open-source project — don't let work pile up uncommitted.

- **Commit in logical units.** Each commit is one coherent change (what + why). End commit
  messages with the `Co-Authored-By: Claude …` trailer.
- **Branch per feature; never commit straight to `main`** (it's prod). Cut `feat/…` or
  `fix/…` off `main`, PR it (`gh pr create`) with a short summary + test notes, squash-merge.
- **Releases are git tags.** `git tag vX.Y.Z && git push --tags` builds an image stamped with
  that version (shown in the footer / admin / `GET /api/version/`). See `docs/deployment.md`.
- **Never commit data artifacts or secrets** (`/data/`, dumps, `.env`, screenshots).
- **Keep builds green before a PR:** `tsc`/lint (frontend), `validate_asset` + touched tests
  (backend).

## Status

Live and versioned (see `GET /api/version/`). Built: the full pipeline + Braidworks
enrichment, the Time-attack game (scope mixing, themes, difficulty, refresh recovery),
server-authoritative scores + per-scope and daily leaderboards, accounts, the admin +
Celery build worker, brotli + IndexedDB-cached asset delivery, and Kubernetes/Argo
deployment. Deferred/forward work lives in [GitHub issues](https://github.com/rafaelmdc/Cladewright/issues)
(notably #42 optimization and the huge-scope path).
