"""View tests for version-pinned, edge-cacheable serving (Phase 2).

A pinned (scope, version) URL (?v=) returns an immutable Cache-Control so Cloudflare can
edge-cache /resolve, /search, and the blob; an unpinned ("current") request must not.
"""
from __future__ import annotations

import json
import tempfile
from pathlib import Path

from django.core.management import call_command
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


# Full asset (3 tips) with a cap of 1 → hybrid: blob ships the famous tip + complete
# coarse backbone; the relational mirror stays full so the tail (tip:rare) resolves.
HYBRID_ASSET = {
    "version": 5, "schema": "1.0", "scope": "ants", "label": "Ants", "pool_size": 3,
    "pool_size_extant": 3, "thresholds": {"hidden_label_max": 15}, "provenance": {},
    "notable_coverage": 0.9, "notable_min": 1, "notable_max": 1, "frontier_rank": "family",
    # The rare branch is extinct-only, so its extant denominator is 0 while pool_count is 1
    # — the tail-resolve must surface pool_count_extant so living-only "N remaining" excludes
    # the unnameable extinct species (#94).
    "nodes": [
        {"id": "kng:Animalia", "rank": "kingdom", "sci": "Animalia", "parent": None,
         "pool_count": 3, "pool_count_extant": 2},
        {"id": "fam:Aidae", "rank": "family", "sci": "Aidae", "parent": "kng:Animalia",
         "pool_count": 2, "pool_count_extant": 2},
        {"id": "gen:Apis", "rank": "genus", "sci": "Apis", "parent": "fam:Aidae",
         "pool_count": 2, "pool_count_extant": 2},
        {"id": "fam:Bidae", "rank": "family", "sci": "Bidae", "parent": "kng:Animalia",
         "pool_count": 1, "pool_count_extant": 0},
        {"id": "gen:Rarus", "rank": "genus", "sci": "Rarus", "parent": "fam:Bidae",
         "pool_count": 1, "pool_count_extant": 0},
    ],
    "tips": [
        {"id": "tip:famous", "sci": "Apis famous", "common": "famous ant", "parent": "gen:Apis",
         "fame": 1000, "lineage": ["kng:Animalia", "fam:Aidae", "gen:Apis"], "traits": {}},
        {"id": "tip:mid", "sci": "Apis mid", "common": "mid ant", "parent": "gen:Apis",
         "fame": 10, "lineage": ["kng:Animalia", "fam:Aidae", "gen:Apis"], "traits": {}},
        {"id": "tip:rare", "sci": "Rarus rare", "common": "rare ant", "parent": "gen:Rarus",
         "fame": 0, "lineage": ["kng:Animalia", "fam:Bidae", "gen:Rarus"], "traits": {}},
    ],
    "aliases": {"famous ant": ["tip:famous"], "rare ant": ["tip:rare"]},
}


class HybridLoadTests(TestCase):
    def _load(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "ants.json"
            p.write_text(json.dumps(HYBRID_ASSET))
            call_command("load_gamedata", asset=p, current=True)

    def test_blob_is_capped_but_mirror_is_full(self) -> None:
        self._load()
        av = AssetVersion.objects.get(scope="ants", version=5)
        # Blob ships only the notable tip; the relational mirror keeps all three.
        self.assertEqual([t["id"] for t in av.blob["tips"]], ["tip:famous"])
        self.assertEqual(av.notable_count, 1)
        self.assertEqual(TaxonTip.objects.filter(asset=av).count(), 3)

    def test_scopes_reports_hybrid(self) -> None:
        self._load()
        r = self.client.get(reverse("gamedata-scopes"))
        ants = next(s for s in r.json()["scopes"] if s["key"] == "ants")
        self.assertEqual(ants["mode"], "hybrid")
        self.assertEqual(ants["notable_count"], 1)
        self.assertTrue(ants["has_filter"])

    def test_membership_filter_built_and_served(self) -> None:
        self._load()
        from apps.gamedata.membership import filter_contains

        av = AssetVersion.objects.get(scope="ants", version=5)
        self.assertIsNotNone(av.membership_filter)
        blob = bytes(av.membership_filter)
        # Every real name (incl. the tail "rare ant") is present; a typo is rejected.
        self.assertTrue(filter_contains(blob, "rare ant"))
        self.assertTrue(filter_contains(blob, "famous ant"))
        self.assertFalse(filter_contains(blob, "zzzz not a real name"))

        r = self.client.get(reverse("gamedata-filter"), {"scope": "ants", "v": 5})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "application/octet-stream")
        self.assertEqual(r["Cache-Control"], IMMUTABLE)
        self.assertEqual(r.content, blob)

    def test_resolve_by_exact_name(self) -> None:
        self._load()
        # The tail name "rare ant" (not in the client blob) resolves in ONE call via exact
        # btree equality → the full trimmed placement payload (anchor + lineage), immutable.
        r = self.client.get(reverse("gamedata-resolve"),
                            {"scope": "ants", "v": 5, "q": "rare ant"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Cache-Control"], IMMUTABLE)
        self.assertEqual(r.json()["target"]["id"], "tip:rare")
        self.assertEqual(r.json()["anchor"], "fam:Bidae")
        self.assertEqual([n["id"] for n in r.json()["lineage"]], ["fam:Bidae", "gen:Rarus"])
        # A name that isn't an exact key (no fuzzy match) → 404.
        self.assertEqual(self.client.get(reverse("gamedata-resolve"),
                         {"scope": "ants", "q": "rare a"}).status_code, 404)

    def test_tail_tip_resolves_trimmed_to_frontier(self) -> None:
        self._load()
        # tip:rare is NOT in the client blob, but the relational mirror resolves it — and
        # since this is a hybrid scope (frontier=family), the lineage is TRIMMED to start at
        # the deepest family ancestor (fam:Bidae), which the client already holds. The
        # kingdom above it is dropped; the client rebuilds it from the anchor's blob parents.
        r = self.client.get(reverse("gamedata-resolve"), {"scope": "ants", "id": "tip:rare"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["target"]["id"], "tip:rare")
        self.assertEqual(r.json()["anchor"], "fam:Bidae")
        lineage = r.json()["lineage"]
        self.assertEqual([n["id"] for n in lineage], ["fam:Bidae", "gen:Rarus"])
        # Each tail node carries the living-only denominator so extinct (unnameable in
        # living-only mode) species don't inflate the clade's "N remaining" count (#94).
        self.assertEqual([n["pool_count_extant"] for n in lineage], [0, 0])
        self.assertEqual([n["pool_count"] for n in lineage], [1, 1])


class SetsViewTests(TestCase):
    """Admin-curated pack sets (#120): enabled sets list their served members + derived totals."""

    @classmethod
    def setUpTestData(cls) -> None:
        from apps.gamedata.models import PackSet

        for scope, label, pool in (("mammalia", "Mammals", 100), ("aves", "Birds", 60)):
            AssetVersion.objects.create(scope=scope, label=label, version=1, is_current=True,
                                        pool_size=pool, pool_size_extant=pool, blob={"v": 1})
        # A set referencing a served pack + one retired pack (filtered out client-side).
        PackSet.objects.create(key="verts", label="Vertebrates", blurb="land + air",
                               scopes=["mammalia", "aves", "gone"], sort_order=1)
        PackSet.objects.create(key="off", label="Disabled", scopes=["mammalia"], enabled=False)
        # A set whose every member is gone → dropped from the payload entirely.
        PackSet.objects.create(key="empty", label="Empty", scopes=["gone"], sort_order=2)

    def test_sets_lists_enabled_with_served_members(self) -> None:
        r = self.client.get(reverse("gamedata-sets"))
        self.assertEqual(r.status_code, 200)
        sets = r.json()["sets"]
        self.assertEqual([s["key"] for s in sets], ["verts"])     # off=disabled, empty=no members
        s = sets[0]
        self.assertEqual(s["scopes"], ["mammalia", "aves"])       # "gone" filtered out
        self.assertEqual(s["pack_count"], 2)
        self.assertEqual(s["tip_count"], 160)                     # 100 + 60


class DumpTaskTests(TestCase):
    """The worker-side dump inventory/delete helpers (#116)."""

    def _make_dumps(self, root: Path) -> None:
        (root / "coldp_col").mkdir(parents=True)
        (root / "coldp_col" / "Taxon.tsv").write_text("x" * 2048)
        braid = root / "braidworks"
        braid.mkdir()
        (braid / "pageviews-202606.db").write_text("y" * 4096)
        (braid / "notes.txt").write_text("ignored")  # not a dump extension

    def test_discover_dumps_finds_coldp_and_pageviews(self) -> None:
        from apps.gamedata.tasks import _discover_dumps

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self._make_dumps(root)
            found = {kind: (path.name, size) for kind, path, size in _discover_dumps(root)}
            self.assertEqual(found["coldp"], ("coldp_col", 2048))
            self.assertEqual(found["pageviews"], ("pageviews-202606.db", 4096))
            self.assertNotIn("other", found)  # notes.txt ignored

    def test_delete_dump_refuses_path_outside_root(self) -> None:
        import os

        from apps.gamedata.models import PipelineJob
        from apps.gamedata.tasks import _run_delete_dump

        with tempfile.TemporaryDirectory() as tmp:
            os.environ["BRAIDWORKS_DATA_DIR"] = str(Path(tmp) / "braidworks")
            job = PipelineJob(kind=PipelineJob.Kind.DELETE_DUMP, dump_path="/etc/passwd")
            with self.assertRaises(ValueError):
                _run_delete_dump(job, None, lambda _m: None)
            os.environ.pop("BRAIDWORKS_DATA_DIR", None)
