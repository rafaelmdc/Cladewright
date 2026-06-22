# Development

How the repo is laid out and how to run it. The whole app is implemented and live;
forward work is tracked in [GitHub issues](https://github.com/rafaelmdc/Cladewright/issues).

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

The data pipeline additionally imports **Braidworks** for real common-name enrichment;
it's *only* needed to regenerate the asset, never to serve. Braidworks is installed
**straight from its public GitHub repo** (`rafaelmdc/braidworks`), pinned to an immutable
tag in `backend/requirements-pipeline.txt`, and kept out of the serving image. The same
file installs into the build venv (local dev) and into the pipeline worker image (CI/prod),
so the two are byte-for-byte the same.

```bash
make pipeline-venv     # backend/.venv-pipeline with serving deps + Braidworks (from GitHub)
make build-asset SCOPE=family=Felidae COLDP=data/coldp_mammalia OUT=data/out/felidae.json
make seed ASSET=/data/out/felidae.json   # load into Postgres, mark current for its scope
```

To bump Braidworks: tag a new release in `rafaelmdc/braidworks` and change the `@ref` on
both lines of `requirements-pipeline.txt`.

### Starter scopes (reproduce the full playable set)

The shippable game scopes are defined once in
[`backend/scripts/build_starter_scopes.sh`](../backend/scripts/build_starter_scopes.sh)
(the manifest is the single source of truth) so any machine can rebuild them from one CoL
dump:

```bash
make col-dump          # one ~1 GB download -> data/coldp_col  (skip if you have it)
make pipeline-venv     # build venv with Braidworks (skip if you have it)
make starter-scopes    # build them all -> data/out/*.json  (FORCE=1 to rebuild existing)
# or a subset:  backend/scripts/build_starter_scopes.sh aves reptilia
```

| key | CoL scope | game label |
|---|---|---|
| `mammalia` | `class=Mammalia` | Mammals |
| `aves`     | `class=Aves`     | Birds |
| `reptilia` | `class=Reptilia` | Reptiles *(paraphyletic in CoL — excludes birds, by design)* |
| `amphibia` | `class=Amphibia` | Amphibians |
| `fish`     | `class=Teleostei,Elasmobranchii,Myxini,Holocephali,Petromyzonti,Chondrostei,Cladistii,Holostei,Dipneusti,Coelacanthi` | Fish *(union of all 10 living fish classes — no single CoL node)* |

Each is built with `--enrich braidworks --include-extinct` (the `extinct` flag is baked so
the client can toggle extant-only; counts carry both `pool_count` and `pool_count_extant`).
Load one with `make seed ASSET=/data/out/<key>.json`.

> **Building from the admin instead?** [`pipeline-jobs.md`](pipeline-jobs.md) is a copy-paste
> reference of the standard scopes (key, label, CoL filter, enrich) for the admin's
> *Pipeline jobs → Add* form — same manifest, no shell needed.

> **Dinosaurs:** not buildable from CoL — `Dinosauria` and the famous non-avian genera
> (*Tyrannosaurus*, *Triceratops*, …) aren't in the checklist at all. A dinosaur scope
> needs a separate source (Paleobiology Database, or Wikidata); deferred until the rest is
> done. (The only dinosaurs CoL knows are the birds in Aves.)

> **Done — Braidworks is installed from a pinned GitHub tag** (`requirements-pipeline.txt`),
> so CI/CD and the worker image install it from an immutable published ref, not a local
> path. No vendored wheels.

> **Done — the asset build runs as a dedicated worker, not a host venv.** `build_gamedata`
> (Braidworks + the ~2 GB dump) is decoupled from `load_gamedata` (Django + the output
> JSON), so the build runs in the pipeline worker (`backend/Dockerfile.pipeline`: slim
> Python + `git` + `requirements-pipeline.txt`) and hands a loaded asset to the serving
> side. The worker is a long-running Celery consumer driven by the admin job queue (see
> [`data-pipeline.md`](data-pipeline.md) and the admin's *Pipeline jobs*). It maps 1:1 onto
> a Kubernetes Deployment: same image + `celery -A cladewright worker`, broker URL and the
> dump volume from env / a PVC. The serving image stays lean — no Braidworks, no dump
> tooling. Scale builds with worker replicas (`--scale worker=N` / k8s `replicas`).

## Frontend

Requires Node 20+. `make gui` (or `cd frontend && npm run dev`) runs Vite on `:5173`.
The SPA loads the asset from `/api/gamedata/current/` (DB-backed) first, falling back
to a static `public/mammalia.json` then the committed `sample_asset.json` if the
backend is down — so `make gui` alone still boots. Override the source with
`VITE_GAMEDATA_URL`. Asset contract: [`game-asset-format.md`](game-asset-format.md).
