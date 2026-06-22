# Cladewright

A daily phylogenetics guessing game. Name organisms and watch them sprout on a
living tree of life you build in real time. Museum-clean aesthetic, both common and
scientific names everywhere, desktop + mobile.

> Guess your way across the tree of life.

**Live:** [cladewright.duarte-correia.pt](https://cladewright.duarte-correia.pt)

## The game

**Time attack** (the primary, novel game) — name as many organisms as you can
against a clock. Each valid one lands on a shared tree, routed to its place by
lineage. As a clade nears completion, the count of **species still hidden under
that branch** appears beside it ("2 hidden") — a pull deeper that never reveals a
name. Everything happens on the tree canvas; no side panels. Pick one clade or
**mix several**; play **Common** or **Scientific** names; compete on per-scope
**leaderboards** and a shared **daily**.

(*Classic*, a Metazooa-style daily, is a placeholder for later — see the design
docs. The renderer and asset are built to serve it when it lands.)

Full mechanic: [`docs/marathon-design.md`](docs/marathon-design.md). Wireframes:
[`docs/examples/`](docs/examples).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Tailwind SPA; SVG tree via `d3-hierarchy`; Framer Motion for layout transitions |
| Backend | Django + Django REST Framework; `django-allauth` (Google OAuth); Postgres |
| Data pipeline | In-repo `backend/pipeline/` (ColDP ingest → backbone → pool → asset), enriched via [Braidworks](../braidworks) weavers; run from a Django management command |
| Delivery | One versioned game-data asset per scope, served from Postgres, cached client-side (IndexedDB); a Celery/Redis worker builds assets |
| Infra | Kubernetes + Argo CD, CNPG Postgres, Gateway API, Cloudflare tunnel |

## Where the data comes from

Tips, topology, ranks, and biome/trait metadata come from a **Catalogue of Life
Data Package (ColDP)** dump — every accepted species row carries its full ranked
lineage, so the tree builds itself. Common names come from **Braidworks** weavers
(Wikidata/Wikipedia). The pipeline slices a scope, induces its backbone, selects
the playable pool, and writes a validated asset. Full process and the pipeline→app
contract: [`docs/data-pipeline.md`](docs/data-pipeline.md) and
[`docs/game-asset-format.md`](docs/game-asset-format.md).

## Docs & contributing

- **[`docs/`](docs/README.md)** — the design of record. Start at the index, which
  routes you to the one doc you need.
- **[`AGENTS.md`](AGENTS.md)** — how to work in this repo (load-bearing invariants,
  boundaries, git workflow, doc routing). Read before changing anything.
- Run it locally: [`docs/development.md`](docs/development.md).
- Roadmap / open work lives in [GitHub issues](https://github.com/rafaelmdc/Cladewright/issues).
