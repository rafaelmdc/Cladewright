# Development

How the repo is laid out and how to run the two halves. This is the **Phase 0
scaffold** — most modules are stubs with `TODO(phase-N)` markers tied to
[`roadmap.md`](roadmap.md). Nothing is implemented yet.

## Layout

```
Cladewright/
├── AGENTS.md                  contributor contract
├── README.md
├── docs/                      design of record (architecture, pipeline, marathon, performance, …)
├── backend/                   Django + DRF
│   ├── pyproject.toml
│   ├── manage.py
│   ├── cladewright/           project (settings, urls, wsgi/asgi)
│   ├── apps/
│   │   ├── gamedata/          serves the game-data asset; build_gamedata command
│   │   ├── accounts/          Google OAuth via django-allauth
│   │   └── scores/            scores, streaks, leaderboards
│   └── pipeline/              offline ETL: ingest → backbone → pool → enrich → asset → validate
├── frontend/                  React + TS + Vite + Tailwind SPA
│   ├── package.json
│   ├── public/
│   │   └── sample_asset.json  tiny hand-authored game-data asset (shared dev fixture)
│   └── src/
│       ├── lib/asset/         asset types + loader (intern to typed arrays)
│       ├── lib/tree/          MRCA, induced display tree
│       ├── lib/game/          found_count + "N remaining" labels
│       ├── components/        TreeRenderer
│       └── pages/             Hub, Marathon, Classic
└── data/                      ColDP dumps etc. — git-ignored, never committed
```

## Backend

Requires Python 3.12+. From `backend/`:

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .                 # web deps (django, DRF, allauth)
python manage.py migrate
python manage.py runserver
```

The data pipeline imports **BICHO** and **Braidworks** (sibling repos
`../BICHOv2`, `../braidworks`). Those are *only* needed to regenerate the asset and
are wired in Phase 1 — see `backend/pipeline/README.md`. Normal request serving
never imports them.

Regenerate the game-data asset (Phase 1; currently a stub):

```bash
python manage.py build_gamedata --coldp-dir /path/to/coldp \
    --out ../frontend/public/sample_asset.json
```

## Frontend

Requires Node 20+. From `frontend/`:

```bash
npm install
npm run dev                      # Vite dev server
```

In dev the SPA loads `public/sample_asset.json` (override with `VITE_GAMEDATA_URL`,
e.g. point it at the backend's `/api/gamedata/current/`) so the UI can be built
before the real pipeline exists — see the asset contract in
[`game-asset-format.md`](game-asset-format.md).

## Where to start implementing

Follow [`roadmap.md`](roadmap.md). Phase 0 is this scaffold; Phase 1 is the
pipeline (`backend/pipeline/`), Phase 2 is `TreeRenderer`, Phase 3 is Marathon.
