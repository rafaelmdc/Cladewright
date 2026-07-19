FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# psycopg[binary], cryptography, etc. all ship manylinux wheels for cp312, so no system
# build toolchain is needed — keeps the image small and the build fast.
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

# Build stamp (CI passes the git version + UTC build time). Surfaced at /api/version/ and
# in the admin so you can confirm which build is actually running.
ARG APP_VERSION=dev
ARG BUILD_TIME=
ENV DJANGO_SETTINGS_MODULE=cladewright.settings \
    APP_PORT=8000 \
    APP_VERSION=$APP_VERSION \
    BUILD_TIME=$BUILD_TIME

EXPOSE 8000

# Default (prod-ish) command; the dev compose overrides this to add --reload + a code
# mount. Migrations run on start so a fresh DB is ready.
#
# ASGI (not WSGI): one stack serves HTTP *and* the Clade Clash versus websockets (#36
# Phase 1) — gunicorn with a uvicorn worker. Django's sync surface (DRF/admin/allauth) runs
# in a threadpool. WEB_CONCURRENCY stays 1 by default: a live match is serialized by a
# PROCESS-LOCAL lock (apps/clash/runtime.py), so one async worker per pod is correct and
# handles ~50 players easily; scaling to multiple workers/pods needs the cross-process Redis
# lock (the documented follow-up) first. One async worker still serves plenty of HTTP.
CMD ["sh", "-lc", "python manage.py migrate && python manage.py collectstatic --noinput && python manage.py ensure_admin && exec gunicorn cladewright.asgi:application -k uvicorn.workers.UvicornWorker --workers ${WEB_CONCURRENCY:-1} --bind 0.0.0.0:${APP_PORT:-8000}"]
