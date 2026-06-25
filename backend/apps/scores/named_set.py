"""Compact unique-named-species storage (#55).

A player's "unique animals named" set used to be one ``NamedSpecies`` row per
(user, mode, difficulty, species) — verbose: a 128-char tip id plus FKs and index
entries for *every* distinct species, growing without bound as a player explores a
million-species scope. Here that whole set becomes a single **roaring bitmap** blob
on one ``NamedSpeciesSet`` row.

The bitmap addresses species by a small integer **token**, not the string id. A
global ``SpeciesToken`` table interns each ``species_key`` → a stable, never-reused
``uint32`` (the row pk). Tokens are shared across all users, so the dictionary is
bounded by the number of distinct species *ever named on the site* (≤ the total
taxa in the catalog, a few million — comfortably inside uint32), not by users ×
species.

Why roaring: a player's set is exactly "which of N species have I named" — roaring
gives O(1) membership, free set-union (each run ORs its placements into the set),
and cardinality, and its serialized form is a few KB even for thousands of species.

The set is server-internal (the account page reads the cached cardinality off
``PlayerStat.unique_named``; the decoded membership is the foundation for a future
"collection" view). ``named_keys`` decodes a stored set back to ``species_key``\\ s.
"""
from __future__ import annotations

from django.db import transaction
from pyroaring import BitMap

from .models import NamedSpeciesSet, SpeciesToken


def _decode(blob: bytes | memoryview | None) -> BitMap:
    """A stored bitmap blob → BitMap. Empty/None → an empty set."""
    if not blob:
        return BitMap()
    return BitMap.deserialize(bytes(blob))


def intern_tokens(species_keys: list[str]) -> dict[str, int]:
    """Map each ``species_key`` to its global integer token, creating any that are new.

    Idempotent and concurrency-safe: ``get_or_create`` (unique ``species_key``) collapses
    a race to the existing row. Returns ``{species_key: token_id}`` for the input keys."""
    keys = list(dict.fromkeys(k for k in species_keys if k))  # de-dup, keep order, drop blanks
    if not keys:
        return {}
    existing = dict(
        SpeciesToken.objects.filter(species_key__in=keys).values_list("species_key", "id")
    )
    missing = [k for k in keys if k not in existing]
    if missing:
        SpeciesToken.objects.bulk_create(
            [SpeciesToken(species_key=k) for k in missing], ignore_conflicts=True
        )
        # Re-read: bulk_create with ignore_conflicts doesn't populate pks reliably across
        # backends, and a concurrent writer may have created some of ours.
        existing.update(
            dict(
                SpeciesToken.objects.filter(species_key__in=missing).values_list(
                    "species_key", "id"
                )
            )
        )
    return {k: existing[k] for k in keys if k in existing}


def add_named(user, mode: str, difficulty: str, species_keys: list[str]) -> int:
    """Union ``species_keys`` into the user's (mode, difficulty) named-set; return its
    new cardinality.

    Read-modify-write of the bitmap is guarded by ``select_for_update`` so two runs
    submitted concurrently can't lose each other's additions. Call inside the submit
    transaction (it already is — see ``SubmitRunView``)."""
    tokens = intern_tokens(species_keys)
    with transaction.atomic():
        row = (
            NamedSpeciesSet.objects.select_for_update()
            .filter(user=user, mode=mode, difficulty=difficulty)
            .first()
        )
        if row is None:
            row = NamedSpeciesSet(user=user, mode=mode, difficulty=difficulty)
        bitmap = _decode(row.bitmap)
        if tokens:
            bitmap |= BitMap(tokens.values())
        row.bitmap = bitmap.serialize()
        row.count = len(bitmap)
        row.save()
        return row.count


def named_count(user, mode: str, difficulty: str) -> int:
    """The cardinality of the user's (mode, difficulty) named-set (0 if none)."""
    row = NamedSpeciesSet.objects.filter(
        user=user, mode=mode, difficulty=difficulty
    ).only("count").first()
    return row.count if row else 0


def named_keys(user, mode: str, difficulty: str) -> list[str]:
    """Decode the user's named-set back to ``species_key``\\ s (sorted by token id).

    The foundation for a future "collection" view; not on any hot path."""
    row = NamedSpeciesSet.objects.filter(
        user=user, mode=mode, difficulty=difficulty
    ).only("bitmap").first()
    if row is None:
        return []
    ids = list(_decode(row.bitmap))
    if not ids:
        return []
    by_id = dict(
        SpeciesToken.objects.filter(id__in=ids).values_list("id", "species_key")
    )
    return [by_id[i] for i in ids if i in by_id]
