FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# psycopg[binary], cryptography, etc. all ship manylinux wheels for cp312, so no system
# build toolchain is needed — keeps the image small and the build fast.
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

ENV DJANGO_SETTINGS_MODULE=cladewright.settings \
    APP_PORT=8000

EXPOSE 8000

# Default (prod-ish) command; the dev compose overrides this to add --reload + a code
# mount. Migrations run on start so a fresh DB is ready.
CMD ["sh", "-lc", "python manage.py migrate && exec gunicorn cladewright.wsgi:application --bind 0.0.0.0:${APP_PORT:-8000}"]
