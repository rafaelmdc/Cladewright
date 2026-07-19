"""
Django settings for Cladewright — Phase 0 scaffold.

Intentionally minimal and dev-oriented. Secrets, DB, and OAuth credentials move
to environment variables before any real deployment. See docs/architecture.md for
the backend's (deliberately small) responsibilities.
"""
from __future__ import annotations

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# TODO(deploy): load from env; never ship this default.
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1").split(",")

INSTALLED_APPS = [
    # daphne MUST lead: it swaps `runserver` for the ASGI dev server so websockets work in
    # dev too (Channels serves both HTTP + ws from one app). See cladewright/asgi.py.
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    # third-party
    "channels",  # websocket substrate for Clade Clash realtime versus (#36 Phase 1)
    "rest_framework",
    "corsheaders",
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",  # TODO(phase-4): configure credentials
    # local
    "apps.gamedata",
    "apps.scores",
    "apps.accounts",
    "apps.content",
    "apps.clash",  # Clade Clash realtime versus (#36 Phase 1)
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise must sit right after SecurityMiddleware to serve /static/ itself.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cladewright.urls"
WSGI_APPLICATION = "cladewright.wsgi.application"
ASGI_APPLICATION = "cladewright.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        # Project templates take precedence over app templates — lets us override the
        # admin's base_site.html to brand the admin (see templates/admin/).
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "cladewright.context_processors.app_version",
            ],
        },
    },
]

# Postgres in every real environment (deployment target). Config comes from the
# environment: a single DATABASE_URL (prod/Render/Heroku style) takes precedence, else
# discrete POSTGRES_* vars for local Postgres. Falls back to sqlite ONLY when nothing is
# configured, so a fresh clone still boots — but Postgres is the supported path and the
# pg_trgm autocomplete index (huge-scope search) only exists there.
import dj_database_url  # noqa: E402  (deliberately late — DB config is its own section)

if os.environ.get("DATABASE_URL"):
    DATABASES = {
        "default": dj_database_url.config(conn_max_age=600, ssl_require=not DEBUG),
    }
elif os.environ.get("POSTGRES_DB"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.environ["POSTGRES_DB"],
            "USER": os.environ.get("POSTGRES_USER", "postgres"),
            "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
            "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
            "PORT": os.environ.get("POSTGRES_PORT", "5432"),
            "CONN_MAX_AGE": 600,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

SITE_ID = 1

# Frontend is a separate SPA in dev; tighten before deploy.
CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173"
).split(",")

# Where the API serves the game-data asset from. Defaults to the shared dev fixture
# (also served by the Vite dev server from frontend/public/). build_gamedata --out
# points at a real generated asset for prod.
GAMEDATA_ASSET_PATH = Path(
    os.environ.get(
        "GAMEDATA_ASSET_PATH",
        BASE_DIR.parent / "frontend" / "public" / "sample_asset.json",
    )
)

STATIC_URL = "static/"
# WhiteNoise serves static (the admin's own CSS/JS) straight from the app/gunicorn — no
# nginx, no runserver. In DEBUG we serve from the static *finders* so the admin is styled
# without a collectstatic step; in prod the image runs collectstatic into STATIC_ROOT and
# WhiteNoise serves the compressed, hashed files from there.
STATIC_ROOT = BASE_DIR / "staticfiles"
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
if not DEBUG:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {
            "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
        },
    }
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# ── Auth: DRF + allauth Google OAuth ─────────────────────────────────────────────
# The SPA authenticates by session cookie (allauth logs the user in, DRF reads the
# session). In dev the Vite server proxies BOTH /api and /accounts to :8000, so the
# browser sees one origin (localhost:5173) and the session/CSRF cookies just work.
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    # Throttling is OPT-IN per view (via ScopedRateThrottle + throttle_scope). No global
    # throttle so existing endpoints are unchanged; the clash matchmaking endpoints set the
    # "clash_matchmaking" scope to cap queue/room spam (#36 security). Rate is per-user
    # (authenticated) / per-IP; generous enough for real play, tight enough to deter abuse.
    "DEFAULT_THROTTLE_RATES": {
        "clash_matchmaking": "60/min",
    },
}

# Google is configured entirely from env — no admin SocialApp row needed. Until the
# credentials are set the provider is simply unusable (login returns an error), but the
# rest of the app runs fine.
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": os.environ.get("GOOGLE_OAUTH_CLIENT_ID", ""),
            "secret": os.environ.get("GOOGLE_OAUTH_SECRET", ""),
            "key": "",
        },
        "SCOPE": ["profile", "email"],
        "AUTH_PARAMS": {"access_type": "online"},
    }
}
# Skip allauth's intermediate "continue with Google?" page — go straight to the provider,
# which is what an SPA "Sign in" button expects.
SOCIALACCOUNT_LOGIN_ON_GET = True
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*"]
# Google-first login: if a Google account's (provider-verified) email matches an existing
# user, log in as — and auto-link to — that user instead of dead-ending on allauth's
# "an account already exists, connect it first" page. Safe because Google verifies emails.
SOCIALACCOUNT_EMAIL_AUTHENTICATION = True
SOCIALACCOUNT_EMAIL_AUTHENTICATION_AUTO_CONNECT = True

# After login/logout, bounce back to the SPA hub (same-origin in dev via the proxy).
LOGIN_REDIRECT_URL = os.environ.get("LOGIN_REDIRECT_URL", "/")
ACCOUNT_LOGOUT_REDIRECT_URL = "/"

# Session cookie must survive the OAuth redirect round-trip; Lax is correct for a
# top-level redirect flow.
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
# Keep sessions short: 30 minutes, as a SLIDING window (each request refreshes the clock),
# so a logged-in cookie expires after 30 min of inactivity.
SESSION_COOKIE_AGE = 30 * 60
SESSION_SAVE_EVERY_REQUEST = True
# Secure cookies over HTTPS — on by default in prod (DEBUG off), overridable by env.
_secure_cookies = os.environ.get("DJANGO_SECURE_COOKIES", "0" if DEBUG else "1") == "1"
SESSION_COOKIE_SECURE = _secure_cookies
CSRF_COOKIE_SECURE = _secure_cookies
# Origins allowed to send the CSRF cookie back (the SPA's origin). Prod sets this to the
# real domain; dev uses the Vite/Django localhost pair.
CSRF_TRUSTED_ORIGINS = os.environ.get(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://localhost:8000"
).split(",")

# ── Production security hardening ─────────────────────────────────────────────────────
# Only in prod (DEBUG off). TLS terminates at the Cloudflare tunnel / gateway, so the app
# sees plain HTTP with X-Forwarded-Proto — trust that header so Django treats requests as
# secure (drives secure-cookie + redirect logic). No SECURE_SSL_REDIRECT: the proxy already
# serves HTTPS, and redirecting here would loop.
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    SESSION_COOKIE_HTTPONLY = True
    X_FRAME_OPTIONS = "DENY"
    # HSTS: tell browsers to stick to HTTPS. Modest window to start; raise once verified.
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", str(60 * 60 * 24 * 7)))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True

# ── Celery / pipeline job queue ──────────────────────────────────────────────────────
# The web process enqueues PipelineJobs onto Redis; a separate pipeline worker consumes
# them (see cladewright/celery.py, apps/gamedata/tasks.py). Default points at the compose
# ``redis`` service; prod overrides via env.
CELERY_BROKER_URL = os.environ.get("CELERY_BROKER_URL", "redis://redis:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("CELERY_RESULT_BACKEND", CELERY_BROKER_URL)
CELERY_TASK_ACKS_LATE = True  # a build is long; redeliver if a worker dies mid-job
CELERY_WORKER_PREFETCH_MULTIPLIER = 1  # one heavy build at a time per worker process
CELERY_TASK_TIME_LIMIT = int(os.environ.get("CELERY_TASK_TIME_LIMIT", str(6 * 60 * 60)))
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True
# Broker resilience. Redis here is tiny + ephemeral (no persistence, no maxmemory policy),
# so it can be OOM-killed/restarted or blip. The failure we hit: the worker sits in a
# blocking BRPOP, Redis restarts under it, the TCP connection goes half-open, and with NO
# socket timeout / keepalive / health check the worker stays parked on that dead socket
# forever — alive and "ready" but consuming nothing, so every newly-queued job starves.
# These options let the transport notice a dead/idle connection and reconnect instead:
#   * socket_timeout / socket_connect_timeout — a hung read/connect raises instead of
#     blocking indefinitely, which surfaces as a reconnect.
#   * socket_keepalive — TCP keepalives so a silently-dropped peer is detected.
#   * health_check_interval — redis-py pings idle connections and recycles dead ones.
#   * retry_on_timeout — transient timeouts retry rather than bubble up as hard errors.
# visibility_timeout: with acks_late, a task still running when the (default 3600s) timeout
# elapses is REDELIVERED and re-run; a long build could loop forever and (with prefetch=1)
# starve newer jobs. Keep it safely above the task time limit. (Not the cause of the
# 4-minute incident above, but the right ceiling for future long builds.)
_BROKER_TRANSPORT_OPTIONS = {
    "visibility_timeout": CELERY_TASK_TIME_LIMIT + 3600,
    "socket_timeout": 60,
    "socket_connect_timeout": 30,
    "socket_keepalive": True,
    "health_check_interval": 30,
    "retry_on_timeout": True,
}
CELERY_BROKER_TRANSPORT_OPTIONS = _BROKER_TRANSPORT_OPTIONS
# The result backend is the same Redis; give it the same self-healing connection options.
CELERY_RESULT_BACKEND_TRANSPORT_OPTIONS = _BROKER_TRANSPORT_OPTIONS

# ── Channels / realtime (Clade Clash versus, #36 Phase 1) ────────────────────────────
# Websocket consumers fan out match-room messages through a Redis channel layer, so any
# ASGI pod can hold either player and Redis relays between them (no sticky sessions). The
# same Redis service backs Celery, so we ISOLATE this layer two ways: a distinct DB index
# (default /1 vs Celery's /0) AND a key prefix, so the two never collide. Override the URL
# in prod via CHANNEL_LAYERS_REDIS_URL (falls back to CELERY_BROKER_URL's host on db 1).
def _channel_redis_url() -> str:
    explicit = os.environ.get("CHANNEL_LAYERS_REDIS_URL")
    if explicit:
        return explicit
    # Reuse the broker's host/port but a different logical DB, so Celery keys and channel
    # layer keys never share a keyspace even on one shared Redis.
    base = CELERY_BROKER_URL.rsplit("/", 1)[0]
    return f"{base}/1"


CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [_channel_redis_url()],
            # Namespace every channel-layer key (shared Redis with Celery, #36 security note).
            "prefix": "cladewright:clash",
            # Abandoned group memberships must not linger; a match is short-lived.
            "group_expiry": int(os.environ.get("CLASH_GROUP_EXPIRY", "1800")),
        },
    },
}
# Tests + local single-process runs don't need Redis running; opt into the in-memory layer
# with CHANNEL_LAYERS_IN_MEMORY=1 (the WebsocketCommunicator tests set this).
if os.environ.get("CHANNEL_LAYERS_IN_MEMORY") == "1":
    CHANNEL_LAYERS = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
