# Cladewright

A daily phylogenetics guessing site. Two games share one tree-of-life renderer.
Aesthetic: clean and museum-like; both common and scientific names shown
everywhere. Responsive (desktop + mobile). Built animal-first, expandable to all
organisms later.

> Guess your way across the tree of life.

## The two games

- **Classic** — Metazooa-style daily. One mystery animal; each guess places the
  most-recent common ancestor (MRCA) of guess + answer on the tree and warms a
  proximity bar. Limited guesses. (Intentionally close to Metazooa; iterate later.)
- **Marathon** — the novel one, and the **primary focus**. Name as many organisms
  as you can against a clock. Each valid organism sprouts on a shared tree you
  build live. As a clade nears completion, the count of **species still hidden
  under that branch** appears next to it ("2 hidden") — a carrot that pulls you
  deeper without ever revealing a name. Everything happens on the tree canvas;
  no side panels.

See [`docs/marathon-design.md`](docs/marathon-design.md) for the Marathon mechanic
in full, and [`docs/examples/`](docs/examples) for the low-fi wireframes this
design is built from.

## Stack

| Layer | Choice |
|---|---|
| Frontend | React + Tailwind, SVG tree via `d3-hierarchy`, Framer Motion for layout transitions, a few Radix primitives |
| Backend | Django + Django REST Framework, `django-allauth` (Google OAuth) |
| Data pipeline | Python: [BICHO](../BICHOv2) (ColDP ingest) + [Braidworks](../braidworks) (common-name / popularity enrichment), imported as deps and driven by a Django management command |
| Game data | One versioned static asset (tree + playable pool + precomputed counts + hint metadata) the client loads once and plays offline |

Rationale and trade-offs: [`docs/architecture.md`](docs/architecture.md). How it
stays lightweight (the `O(L)` "N remaining" design, caching, no per-guess server
work): [`docs/performance.md`](docs/performance.md).

## Where the data comes from

Tips, topology, ranks, and biome/trait metadata come from a **Catalogue of Life
Data Package (ColDP)**, ingested with **BICHO** — every accepted species row
already carries its full ranked lineage, so the tree builds itself. Common names
and a "fame" score (Wikipedia pageviews) come from **Braidworks** weavers, and
are used to pick the ~2,500-animal *playable pool*. Full pipeline and the
pipeline→app contract: [`docs/data-pipeline.md`](docs/data-pipeline.md) and
[`docs/game-asset-format.md`](docs/game-asset-format.md).

## Status

Planning / initial-documentation phase. Nothing is built yet. Start with
[`docs/roadmap.md`](docs/roadmap.md) for the build sequence and
[`AGENTS.md`](AGENTS.md) for how to work in this repo.
