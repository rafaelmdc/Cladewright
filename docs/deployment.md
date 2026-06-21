# Deployment

Cladewright deploys to the homelab Kubernetes cluster via **Argo CD**, matching the patterns
in `../Rafael-Homelab/kubernetes/deployments/` (use the **`portfolio`** deployment as the
reference — it's the closest analog: Django + React + CNPG Postgres). This doc is the plan +
the contract (env, secrets, hosts); the manifests live in the homelab repo, not here.

> Status: not yet deployed. Everything in the app is already **env-driven** (see
> `backend/cladewright/settings.py`), so deployment is config + manifests, not code.

## Topology

| Cladewright piece | k8s object | image | notes |
|---|---|---|---|
| Django API | Deployment `cladewright-web` | `hydrodog11/cladewright` (`backend/Dockerfile`) | gunicorn; runs `migrate` + `collectstatic` on start; WhiteNoise serves admin static |
| Pipeline worker | Deployment `cladewright-worker` | `hydrodog11/cladewright-pipeline` (`backend/Dockerfile.pipeline`) | `celery -A cladewright worker`; mounts the CoL-dump PVC; the ONLY thing with Braidworks + the dump |
| Broker | Deployment/StatefulSet `cladewright-redis` | `redis:7-alpine` | Celery broker; cluster-internal only |
| Database | CNPG `Cluster` `cladewright-postgres` | — | service `cladewright-postgres-rw` |
| Frontend SPA | Deployment `cladewright-frontend` | `hydrodog11/cladewright-frontend` (`frontend/Dockerfile`, nginx + the Vite build) | serves the SPA and reverse-proxies `/api` + `/accounts` to the web Service (`BACKEND_UPSTREAM` env). The public component; the tunnel points here |
| Dump storage | PVC (RWO/RWX) | — | mounted at `/app/data` on the worker; seeded once (see below) |

**Image delivery:** argocd-image-updater watches the Docker Hub images (latest tag, digest
strategy, git write-back) exactly like portfolio. CI builds + pushes `hydrodog11/cladewright`,
`-pipeline`, `-frontend`.

## Hosts + routing

**Two public hosts**, both reached over the Cloudflare `TunnelBinding` (the homelab has DNS
issues, so the admin is public over the tunnel too — exactly portfolio's two-subject pattern).
Each has a cert-manager `Certificate` + a Gateway listener for the LAN/TLS path; WAN traffic
goes through the tunnel, which points **straight at the Services**:

| host | tunnel → Service | serves |
|---|---|---|
| `cladewright.duarte-correia.pt` | `cladewright-frontend` | SPA; nginx proxies `/api` + `/accounts` to the web Service |
| `cladewright-admin.duarte-correia.pt` | `cladewright-web` | the Django admin (`/admin`) + its WhiteNoise `/static` |

The admin is **public** but staff-gated by Django auth. The frontend proxies with `Host =
$host`, so Django sees the real public domain (first-party OAuth/CSRF). `ADMIN_SITE_URL` =
`https://cladewright.duarte-correia.pt/` (the admin's "View site" link).

## Secrets (Bitwarden → ExternalSecrets)

ClusterSecretStore `bitwarden-secretstore`, namespace `rafael-homelab`. Create Bitwarden items
named `cladewright-rafael-*` and an `ExternalSecret` per the portfolio template:

| Bitwarden item | becomes env |
|---|---|
| `cladewright-rafael-django-secret-key` | `DJANGO_SECRET_KEY` |
| `cladewright-rafael-db-username` / `-db-password` | CNPG bootstrap + `POSTGRES_USER/PASSWORD` |
| `cladewright-rafael-google-oauth-client-id` | `GOOGLE_OAUTH_CLIENT_ID` |
| `cladewright-rafael-google-oauth-secret` | `GOOGLE_OAUTH_SECRET` |

## Prod env (all already env-driven)

Web + worker share most of these (worker doesn't need the OAuth/host vars):

```
DJANGO_SETTINGS_MODULE=cladewright.settings
DJANGO_DEBUG=0
DJANGO_SECRET_KEY=<secret>
DJANGO_ALLOWED_HOSTS=cladewright.duarte-correia.pt,cladewright-admin.duarte-correia.pt
CSRF_TRUSTED_ORIGINS=https://cladewright.duarte-correia.pt,https://cladewright-admin.duarte-correia.pt
CORS_ALLOWED_ORIGINS=https://cladewright.duarte-correia.pt
SITE_DOMAIN=cladewright.duarte-correia.pt
SITE_NAME=Cladewright
ADMIN_SITE_URL=https://cladewright.duarte-correia.pt/
DJANGO_SECURE_COOKIES=1            # default when DEBUG=0
LOGIN_REDIRECT_URL=/
POSTGRES_DB=cladewright
POSTGRES_HOST=cladewright-postgres-rw
POSTGRES_USER / POSTGRES_PASSWORD  # from db secret
GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_SECRET   # web only
CELERY_BROKER_URL=redis://cladewright-redis:6379/0   # web + worker
```

The **frontend** Deployment needs only `BACKEND_UPSTREAM=cladewright-web:8000` (the web
Service the SPA's nginx proxies `/api`+`/accounts` to).

> Health probes hit the web pod by IP, which Django's `ALLOWED_HOSTS` would reject — set the
> probe's `httpHeaders` `Host: cladewright.duarte-correia.pt` (or use a TCP probe) rather than
> adding the pod IP to `ALLOWED_HOSTS`.

`SITE_DOMAIN`/`SITE_NAME` feed the allauth Site (migration `accounts/0001`).

## Google OAuth

Register the prod redirect URI in the Google console:
`https://cladewright.duarte-correia.pt/accounts/google/login/callback/`. The consent screen is
in Testing (owner is a test user) — **Publish** at launch. Same client id/secret as dev, fed
via Bitwarden.

## The CoL dump

The worker needs the dump at `/app/data/coldp_col` (~1 GB) to build assets. Options to seed
the PVC: (a) run the admin **Download CoL dump** pipeline job once after the worker is up
(simplest — it downloads + extracts in place), or (b) a one-off k8s `Job`/`initContainer`
running `manage.py fetch_col_dump`. The dump stays out of the image.

## First-deploy checklist

1. Build + push the three images; create the Argo `Application` → `manifests/`.
2. ExternalSecrets sync from Bitwarden; CNPG cluster comes up.
3. Web pod runs `migrate` (+ seeds GameModeConfig/daily via data migrations) and
   `collectstatic`.
4. Log into `/admin` as **`admin` / `cladewright`** (the one-time bootstrap superuser, created
   only on the fresh DB) and **change the password immediately** — or `make_admin <you@gmail>`
   to promote your Google account, then remove the `DJANGO_BOOTSTRAP_ADMIN_PASSWORD` env.
5. Queue a **Download CoL dump** job, then **Build asset** jobs for the starter scopes
   (see [`pipeline-jobs.md`](pipeline-jobs.md)); **Set current** each.
6. Configure the **daily rotation** (admin → Daily rotation entries).
7. Register the prod OAuth redirect URI + publish the consent screen.

## Security

- **TLS everywhere** (Cloudflare tunnel + gateway certs). `DJANGO_SECURE_COOKIES` defaults on
  in prod (secure session + CSRF cookies); `SECURE_PROXY_SSL_HEADER` trusts the proxy's
  `X-Forwarded-Proto` so Django knows it's HTTPS. HSTS + `nosniff` + `Referrer-Policy` +
  `X-Frame-Options: DENY` are set when `DEBUG=0` (`settings.py`).
- **Secrets** never in git — Bitwarden → ExternalSecrets. The Django `SECRET_KEY`, DB creds,
  and OAuth creds all come from secrets.
- **Admin** is staff-gated and on its own host. The **bootstrap admin** (`admin`/`cladewright`)
  exists only until you change it / make your own — see step 4. After that, drop the bootstrap
  env. Consider login throttling (e.g. django-axes) as a follow-up.
- The heavy pipeline build runs only on the worker; the web tier has no Braidworks/dump.

## Still to build before deploy

- `frontend/Dockerfile` (nginx static build + `/api` `/accounts` proxy) — doesn't exist yet.
- The homelab manifests (Deployments, Services, CNPG, Gateway/HTTPRoute, Certificate,
  TunnelBinding, ExternalSecrets, PVC) under `kubernetes/deployments/cladewright/`.
- CI to build/push the three images to Docker Hub.
