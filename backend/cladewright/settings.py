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
        "DIRS": [],
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
