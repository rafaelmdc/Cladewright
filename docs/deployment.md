# Deployment

Cladewright runs on a private Kubernetes cluster via **Argo CD**. This doc is the app-side
contract — the shape of the deployment, the env it reads, and operational runbooks. The
**concrete manifests, secret wiring, and first-deploy steps live in the private
infrastructure repo, not here** (this repo is public).

> Status: **live** at `cladewright.duarte-correia.pt`. Everything app-side is **env-driven**
> (see `backend/cladewright/settings.py`), so changes are config + manifests, not code. CI
> builds the three images on push to `main` and on `v*` tags
> (`.github/workflows/build-images.yml`); the cluster's image-updater rolls them out.

## Topology

Five pieces, one namespace:

| Piece | Kind | Image (`backend/Dockerfile*`, `frontend/Dockerfile`) | Notes |
|---|---|---|---|
| Django API | Deployment `cladewright-web` | `cladewright` | gunicorn; runs `migrate` + `collectstatic` on start; WhiteNoise serves admin static |
| Pipeline worker | Deployment `cladewright-worker` | `cladewright-pipeline` | `celery -A cladewright worker`; mounts the CoL-dump volume; the ONLY thing with Braidworks + the dump |
| Broker | Deployment `cladewright-redis` | `redis:7-alpine` | Celery broker; cluster-internal only |
| Database | CNPG `Cluster` | — | Postgres, in-cluster |
| Frontend SPA | Deployment `cladewright-frontend` | `cladewright-frontend` | nginx serving the Vite build; reverse-proxies `/api` + `/accounts` to the web Service (`BACKEND_UPSTREAM`). The public entrypoint |

**Image delivery:** the three images are built + pushed to a container registry by CI; the
cluster's argocd-image-updater watches them (digest strategy) and rolls the Deployments.

## Hosts + routing

Two public hosts, both reached over a Cloudflare tunnel that points straight at the in-cluster
Services (TLS terminates at the tunnel/gateway):

| host | → Service | serves |
|---|---|---|
| `cladewright.duarte-correia.pt` | `cladewright-frontend` | SPA; nginx proxies `/api` + `/accounts` to the web Service |
| `cladewright-admin.duarte-correia.pt` | `cladewright-web` | the Django admin (`/admin`) + its WhiteNoise `/static` |

The admin host is reachable but **staff-gated by Django auth**. The frontend proxies with
`Host = $host`, so Django sees the real public domain (first-party OAuth/CSRF).

## Environment

The app is fully env-driven. Non-secret values (public hosts etc.) are set on the Deployments;
**secrets come from the cluster's secret manager** (External Secrets) — never from git, and not
enumerated here. The variables the app reads (see `settings.py`):

```
# non-secret (set on the Deployments)
DJANGO_DEBUG=0
DJANGO_ALLOWED_HOSTS=cladewright.duarte-correia.pt,cladewright-admin.duarte-correia.pt
CSRF_TRUSTED_ORIGINS=https://cladewright.duarte-correia.pt,https://cladewright-admin.duarte-correia.pt
CORS_ALLOWED_ORIGINS=https://cladewright.duarte-correia.pt
SITE_DOMAIN=cladewright.duarte-correia.pt        # feeds the allauth Site
ADMIN_SITE_URL=https://cladewright.duarte-correia.pt/   # admin "View site" link
DJANGO_SECURE_COOKIES=1                            # default when DEBUG=0
CELERY_BROKER_URL=redis://cladewright-redis:6379/0 # web + worker
BACKEND_UPSTREAM=cladewright-web:8000              # frontend only

# from the secret manager
DJANGO_SECRET_KEY · POSTGRES_USER / POSTGRES_PASSWORD · GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_SECRET
```

> Health probes hit the pod by IP, which `ALLOWED_HOSTS` would reject — use a TCP probe (or set
> the probe `Host` header), not the pod IP in `ALLOWED_HOSTS`.

## Google OAuth

Register the prod redirect URI in the Google console:
`https://cladewright.duarte-correia.pt/accounts/google/login/callback/`. Client id/secret come
from the secret manager. Publish the consent screen at launch.

## The CoL dump

The worker needs the ColDP dump at `/app/data/coldp_col` (~1 GB) to build assets. Seed the
volume by running the admin **Download CoL dump** pipeline job once after the worker is up (it
downloads + extracts in place), or a one-off job running `manage.py fetch_col_dump`. The dump
stays out of the image and out of git.

## Bootstrap admin

On a fresh DB the web pod can create a one-time superuser whose password is supplied via the
`DJANGO_BOOTSTRAP_ADMIN_PASSWORD` env. **Change it on first login** (or promote your Google
account with `make_admin`, see [`admin.md`](admin.md)), then **remove that env**. It never
resets an existing admin.

## Releasing

Push to `main` builds images stamped with the commit SHA; **`git tag vX.Y.Z && git push origin
vX.Y.Z`** builds images stamped with that version. The version is baked into all three images
(`APP_VERSION` build-arg) and surfaced so you can confirm a deploy landed:

- **Site footer** — the frontend build; shows the API build in amber if they differ (a
  half-applied deploy).
- **Admin header** — the web build.
- **`GET /api/version/`** → `{version, built}`.

After a sync, glance at the footer/admin: if it shows the version you just tagged, it's live.

## Operational runbooks

**Compression.** nginx serves **Brotli** (≈50% smaller than gzip on the JSON/JS) with a gzip
fallback, negotiated per request. Transport-only — stored assets are unchanged, so no rebuild
is needed when it ships. Static assets are precompressed (`.br`/`.gz`); the proxied game JSON
is compressed dynamically.

**Pipeline worker not consuming jobs** (jobs sit `QUEUED`):
1. The common cause — a half-open Redis `BRPOP` after a Redis blip — is mitigated by the broker
   `transport_options` in `settings.py` (the worker reconnects instead of hanging).
2. **Restart the `cladewright-worker` pod.** It reconnects to Redis and drains the queue.
   Re-queueing won't help a *deaf* worker — only a restart does.
3. Jobs enqueued while Redis was down are lost (Redis is ephemeral) — **Re-queue** them after.

**Cursed jobs (stuck even after a Redis restart).** The dead state is the `PipelineJob` rows:
Admin → Pipeline jobs → select → **⚠ PURGE** (drains the queue + deletes the job records;
built **Asset versions are never touched**). Then restart the worker and re-create the build.

**Old asset versions piling up.** Build with **delete old** ✓, or use the **Delete superseded**
action on Asset versions. See [`admin.md`](admin.md).

## Security

- **TLS everywhere** (Cloudflare tunnel + gateway certs). `DJANGO_SECURE_COOKIES` defaults on in
  prod; `SECURE_PROXY_SSL_HEADER` trusts the proxy's `X-Forwarded-Proto`; HSTS + `nosniff` +
  `Referrer-Policy` + `X-Frame-Options: DENY` are set when `DEBUG=0` (`settings.py`).
- **Secrets come from the cluster secret manager, never git** — `SECRET_KEY`, DB creds, OAuth
  creds. Rotate by updating the secret store; nothing secret lives in this repo.
- **Admin** is staff-gated; the bootstrap superuser is changed on first login and its env
  dropped (above). Consider login throttling (e.g. django-axes) as a follow-up.
- The heavy pipeline build runs only on the worker; the web tier has no Braidworks/dump.
