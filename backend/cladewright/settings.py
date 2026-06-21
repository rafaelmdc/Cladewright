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
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",
    # third-party
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
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
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
            ],
        },
    },
]

# Postgres in every real environment (deployment target). Config comes from the
# environment: a single DATABASE_URL (prod/Render/Heroku style) takes precedence, else
# discrete POSTGRES_* vars for local Postgres. Falls back to sqlite ONLY when nothing is
# configured, so a fresh clone still boots — but Postgres is the supported path and the
# pg_trgm autocomplete index (huge-scope search) only exists there.
import dj_database_url

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
