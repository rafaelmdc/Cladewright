"""
Postgres-only: enable pg_trgm and add a GIN trigram index on Alias.norm so the
huge-scope autocomplete (`ILIKE '%q%'` / similarity over millions of names) is fast.

Guarded by the connection vendor so the sqlite dev fallback still migrates cleanly —
there the same search query just does a scan, which is fine on small dev data.
"""
from __future__ import annotations

from django.db import migrations

INDEX = "alias_norm_trgm"
TABLE = "gamedata_alias"


def create_trigram(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    schema_editor.execute(
        f"CREATE INDEX IF NOT EXISTS {INDEX} ON {TABLE} USING gin (norm gin_trgm_ops)"
    )


def drop_trigram(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(f"DROP INDEX IF EXISTS {INDEX}")


class Migration(migrations.Migration):
    dependencies = [("gamedata", "0001_initial")]
    operations = [migrations.RunPython(create_trigram, drop_trigram)]
