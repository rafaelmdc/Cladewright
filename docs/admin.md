# Admin

Cladewright's management surface is the **Django admin**, themed to the field-notebook look
(`backend/templates/admin/base_site.html` maps the palette onto Django's CSS variables — no
stock blue). It is **URL-only** (no signup, no link from the SPA) and lives on the Django
origin (dev: `http://localhost:8000/admin/`, NOT proxied through Vite). WhiteNoise serves the
admin static under gunicorn; "View site" points at `ADMIN_SITE_URL` (env).

## Becoming an admin

Players sign in with Google and have no usable password. Promote one to a superuser:

```
python manage.py make_admin you@example.com --password 's3cret'   # grant + set a password
python manage.py make_admin you@example.com --revoke              # demote
```

(`backend/apps/accounts/management/commands/make_admin.py`.) Dev superuser: `admin`/`admin`.

## What you can do

### Game data — scopes (`gamedata`)
- **Asset versions** — every built `(scope, version)`. Read-only (it's pipeline output);
  control which one is served with the **Set current** / **Deactivate** actions. One current
  build per scope.
- **Pipeline jobs** — the build queue (see below).

### Pipeline jobs (build data without a shell)
The web process only **enqueues**; a separate **worker** (the pipeline image, with Braidworks
+ the CoL dump) runs the job. Add a job (`/admin/gamedata/pipelinejob/add/`):
- **Build asset** — pick `scope_key`, `scope_filter` (CoL `rank=value[,value…]`, copy from
  [`pipeline-jobs.md`](pipeline-jobs.md)), `enrich=braidworks`, `include_extinct`. The worker
  runs `build_gamedata` (auto-bumps to the next version) → `load_gamedata`; stdout streams
  into the job log; status QUEUED→RUNNING→SUCCEEDED/FAILED. **Re-queue** action re-runs one.
- **Download CoL dump** — refreshes `data/coldp_col` (downloads ~1 GB, atomic swap, deletes
  the old dump + zip). Run before a batch of rebuilds when you want fresh data.

### Games + the daily (`scores`)
- **Game mode configs** — one row per mode (`marathon_free`, `marathon_daily`, `classic`).
  Toggle `enabled` straight from the list to launch/retire a game with no deploy; set
  label/blurb/route/sort. `*_daily` modes surface as the Hub's Daily strip, not a card.
- **Daily rotation entries** — the daily rotation pool: which `(mode, scope)` entries the
  daily cycles through by date (tune *game* + *clade* rotation). Empty pool → the daily falls
  back to rotating the currently-served scopes.
- **Daily pins** — a manual daily for a specific date (overrides the rotation that day),
  unique per `(date, mode)` so each game can have its own pinned daily.
- **Runs / Player stats / Streaks / Named species** — moderation. Runs are read-only but
  deletable (drop a cheating score); deleting cascades.

## How the daily resolves

`_daily_plan(date)` (in `apps/scores/views.py`): a **Daily pin** for that date wins → else the
active **rotation pool** cycles by date → else fallback to the served scopes. The daily is
**one shot per day** (the scope is pinned server-side; a second submit returns 409) and feeds
**one global day streak** (sentinel key `"daily"`). See [`games-model.md`](games-model.md).

## Safety notes

- The heavy build (Braidworks + the dump) **never** runs in the web/serving process — only on
  the worker. Keep it that way.
- The admin is staff-gated and URL-only; in prod, additionally fence it at the proxy (separate
  hostname / allowlist) — see [`deployment.md`](deployment.md).
