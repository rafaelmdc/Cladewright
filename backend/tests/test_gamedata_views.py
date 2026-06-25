"""View tests for version-pinned, edge-cacheable serving (Phase 2).

A pinned (scope, version) URL (?v=) returns an immutable Cache-Control so Cloudflare can
edge-cache /resolve, /search, and the blob; an unpinned ("current") request must not.
"""
from __future__ import annotations

from django.test import TestCase
from django.urls import reverse

from apps.gamedata.models import Alias, AssetVersion, TaxonNode, TaxonTip

IMMUTABLE = "public, max-age=31536000, immutable"


class VersionedCachingTests(TestCase):
    @classmethod
    def setUpTestData(cls) -> None:
        # Two builds of one scope: v1 (old) + v2 (current). A request pinned to v1 must
        # still resolve against v1 even though v2 is current — that's what makes the
        # response immutable (a client keeps asking for its version after a rebuild).
        for version, current in ((1, False), (2, True)):
            av = AssetVersion.objects.create(
                scope="bugs", label="Bugs", version=version, is_current=current,
                pool_size=1, pool_size_extant=1, blob={"version": version, "scope": "bugs"},
            )
            TaxonNode.objects.create(
                asset=av, key="kng:Animalia", rank="kingdom", sci="Animalia",
                common="animals", parent_key=None, pool_count=1, pool_count_extant=1,
                depth=0, lineage=[],
            )
            TaxonTip.objects.create(
                asset=av, key="tip:Apis_mellifera", sci="Apis mellifera",
                common="western honey bee", parent_key="kng:Animalia",
                lineage=["kng:Animalia"], traits={}, fame=1000 * version,
            )
            Alias.objects.create(
                asset=av, norm="honey bee", target_key="tip:Apis_mellifera",
                target_kind=Alias.TIP, sci="Apis mellifera", common="western honey bee",
                fame=1000 * version,
            )

    def test_resolve_pinned_is_immutable(self) -> None:
        r = self.client.get(reverse("gamedata-resolve"),
                            {"scope": "bugs", "id": "tip:Apis_mellifera", "v": 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Cache-Control"], IMMUTABLE)
        self.assertEqual(r.json()["target"]["id"], "tip:Apis_mellifera")

    def test_resolve_current_is_not_cached(self) -> None:
        r = self.client.get(reverse("gamedata-resolve"),
                            {"scope": "bugs", "id": "tip:Apis_mellifera"})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Cache-Control", r)

    def test_resolve_unknown_version_falls_back_to_current(self) -> None:
        # A bogus ?v= must not 500 or pin — it serves current, uncached.
        r = self.client.get(reverse("gamedata-resolve"),
                            {"scope": "bugs", "id": "tip:Apis_mellifera", "v": 999})
        self.assertEqual(r.status_code, 200)
        self.assertNotIn("Cache-Control", r)

    def test_search_and_blob_pinned_are_immutable(self) -> None:
        s = self.client.get(reverse("gamedata-search"), {"scope": "bugs", "q": "honey bee", "v": 1})
        self.assertEqual(s.status_code, 200)
        self.assertEqual(s["Cache-Control"], IMMUTABLE)
        self.assertEqual(s.json()["results"][0]["id"], "tip:Apis_mellifera")

        b = self.client.get(reverse("gamedata-current"), {"scope": "bugs", "v": 1})
        self.assertEqual(b.status_code, 200)
        self.assertEqual(b["Cache-Control"], IMMUTABLE)
        self.assertEqual(b.json()["version"], 1)  # the pinned blob, not current (v2)
