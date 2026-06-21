# Development

How the repo is laid out and how to run it. The data pipeline, Marathon, the
TreeRenderer, the NodeCard learn-cards, and the Postgres-backed backend are all
implemented; build order and what's left live in [`roadmap.md`](roadmap.md).

## Layout

```
Cladewright/
├── docs/                      design of record (architecture, pipeline, marathon, performance, …)
├── docker-compose.dev.yml     dev stack: Postgres + Django API (mirrors the prod shape)
├── .env.example               copy to .env for the dev stack
├── Makefile                   make dev / seed / gui-* / be-* targets
├── backend/                   Django + DRF + Postgres
│   ├── Dockerfile, requirements.txt
│   ├── cladewright/           project (settings, urls, wsgi/asgi)
│   ├── apps/
│   │   ├── gamedata/          models (AssetVersion + TaxonNode/Tip/Alias), views
│   │   │   └── management/commands/  build_gamedata, load_gamedata
│   │   ├── accounts/          Google OAuth via django-allauth
│   │   └── scores/            scores, streaks, leaderboards
│   └── pipeline/              offline ETL: ingest → backbone → pool → enrich → asset → validate
├── frontend/                  React + TS + Vite + Tailwind SPA
│   ├── vite.config.ts         proxies /api → :8000 in dev
│   └── src/
│       ├── lib/asset/         asset types + loader (API first, static fallback)
│       ├── lib/tree/          MRCA, induced display tree, render-tree builder
│       ├── lib/game/          resolve, "N remaining", settings
│       ├── lib/wiki.ts        Wikipedia summary fetch (localStorage-cached)
│       ├── components/        TreeRenderer, NodeCard, SettingsPanel
│       └── pages/             Hub, Marathon, Classic
└── data/                      ColDP dumps + built assets — git-ignored, never committed
```

## Quickstart (Docker — dev on the same Postgres as prod)

The dev stack runs Postgres + the Django API in Docker; the Vite frontend stays a
host dev server (HMR) and proxies `/api` to it. One command:

```bash
cp .env.example .env          # tweak POSTGRES_PASSWORD etc.
make dev                      # db + API (docker) + GUI (vite on :5173)
make seed                     # one-time: load a built asset into Postgres
```

- GUI: `http://localhost:5173/` (proxies `/api` → `:8000`)
- API: `http://localhost:8000/api/gamedata/current/`
- `make dev-down` tears it all down. `make help` lists every target
  (`be-up/down/logs/shell`, `migrate`, `seed`, `dbshell`, `gui-*`).

`make seed` runs `load_gamedata --asset /data/out/mammalia.json --current` inside the
web container (`./data` is mounted). Build that asset first (below) or drop a prebuilt
JSON at `data/out/`.

## Backend without Docker (optional)

Requires Python 3.12+ and a Postgres reachable via `DATABASE_URL` or `POSTGRES_*`
env vars (no env → sqlite fallback, which skips the trigram index). From `backend/`:

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver           # :8000
```

The data pipeline additionally imports **Braidworks** (sibling repo) for real
common-name enrichment; it's *only* needed to regenerate the asset, never to serve.
Braidworks ships as **vendored wheels** under `backend/vendor/` (built from the sibling
repo by `backend/scripts/build_braidworks_wheels.sh`) and is installed into a separate
build venv via `backend/requirements-pipeline.txt` — kept out of the serving image.

```bash
make wheels            # rebuild backend/vendor/*.whl from ../../braidworks (uv)
make pipeline-venv     # backend/.venv-pipeline with serving deps + Braidworks wheels
make build-asset SCOPE=family=Felidae COLDP=data/coldp_mammalia OUT=data/out/felidae.json
make seed ASSET=/data/out/felidae.json   # load into Postgres, mark current for its scope
```

> **TODO (deployment):** the vendored wheels are a *local-build* convenience — they're
> built from the developer's checkout of `../../braidworks`. Before deploying, publish
> Braidworks properly as a **GitHub release wheel** (or a tag the build can `pip install`
> from a Git URL / index), so CI/CD installs it from a pinned published artifact rather
> than from a local path. Then `requirements-pipeline.txt` points at that pinned release
> instead of `./vendor/*.whl`. See [`data-pipeline.md`](data-pipeline.md#stage-4--braidworks-enrichment-common-names).

> **TODO (deployment, a phase of its own — not now):** run the asset build as a
> **dedicated Docker worker / batch job**, not a host venv. The pieces already favour
> this: `build_gamedata` (needs Braidworks + the ~2 GB dump) is fully decoupled from
> `load_gamedata` (needs only Django + the output JSON), so the build can run anywhere
> and just hand a JSON asset to the serving side. Shape: a `backend/Dockerfile.pipeline`
> (`FROM python:3.12-slim`, `COPY vendor/*.whl` + `requirements-pipeline.txt`, `pip install`,
> `ENTRYPOINT manage.py build_gamedata`) run as a one-off Job/CronJob. This (a) keeps the
> serving image lean — no Braidworks, no dump tooling, no `.venv-pipeline`; (b) gives the
> build the fat, short-lived resource profile it wants (dump on disk + backbone index in
> RAM) instead of loading the web container; and (c) makes the image self-contained via
> `COPY vendor/*.whl`, so it works before the release-wheel TODO above lands (the dump
> itself stays out of the image, mounted/fetched at job runtime). It quarantines the
> pipeline deps into an image nobody ships to the web tier, rather than making them vanish.

## Frontend

Requires Node 20+. `make gui` (or `cd frontend && npm run dev`) runs Vite on `:5173`.
The SPA loads the asset from `/api/gamedata/current/` (DB-backed) first, falling back
to a static `public/mammalia.json` then the committed `sample_asset.json` if the
backend is down — so `make gui` alone still boots. Override the source with
`VITE_GAMEDATA_URL`. Asset contract: [`game-asset-format.md`](game-asset-format.md).
