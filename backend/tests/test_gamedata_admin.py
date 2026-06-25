"""Admin memory-safety: the relational-mirror changelists (TaxonTip/Node/Alias) and the
AssetVersion list must NEVER pull the multi-MB ``blob`` / ``membership_filter`` columns into
a page render. Doing so deserialized one copy of the blob PER ROW (100/page) and OOM-killed
the web pod (exit 137) even on the small scopes. These tests pin the deferral so the trap
can't return.
"""
from __future__ import annotations

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.test import RequestFactory, TestCase

from apps.gamedata.admin import AssetVersionAdmin
from apps.gamedata.models import Alias, AssetVersion, TaxonNode, TaxonTip

User = get_user_model()

# A deliberately chunky blob — if a test ever loads one-per-row, it shows up as time/memory.
_BIG_BLOB = {"tips": [{"k": f"tip:{i}", "v": "x" * 200} for i in range(2000)]}


class AdminDefersHeavyColumnsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.av = AssetVersion.objects.create(
            scope="bugs", label="Bugs", version=1, is_current=True,
            pool_size=50, pool_size_extant=50, blob=_BIG_BLOB, membership_filter=b"\x00" * 4096,
        )
        for i in range(50):
            TaxonTip.objects.create(
                asset=cls.av, key=f"tip:{i}", sci=f"Sci {i}", common=f"common {i}",
                parent_key="kng:A", lineage=["kng:A"], traits={}, fame=i,
            )
            Alias.objects.create(
                asset=cls.av, norm=f"common {i}", target_key=f"tip:{i}", target_kind="tip",
                sci=f"Sci {i}", fame=i,
            )
        TaxonNode.objects.create(
            asset=cls.av, key="kng:A", rank="kingdom", sci="Animalia", common="animals",
            parent_key=None, pool_count=50, pool_count_extant=50, depth=0, lineage=[],
        )

    def setUp(self):
        self.rf = RequestFactory()
        self.req = self.rf.get("/admin/")
        self.req.user = User.objects.create_superuser("root", password="x")

    def _admin(self, model):
        return admin.site._registry[model]

    def test_child_admins_defer_asset_blob_and_filter(self):
        # Every joined asset on a tip/node/alias page has the heavy columns deferred, so a
        # 100-row page never deserializes the blob even once.
        for model in (TaxonTip, TaxonNode, Alias):
            qs = self._admin(model).get_queryset(self.req)
            obj = qs.first()
            deferred = obj.asset.get_deferred_fields()
            self.assertIn("blob", deferred, model.__name__)
            self.assertIn("membership_filter", deferred, model.__name__)

    def test_listing_a_full_page_never_loads_a_blob(self):
        # Walk every tip the way the changelist renders the `asset` column (str(asset)) and
        # assert no blob was ever fetched — the regression that OOM-killed the pod.
        qs = self._admin(TaxonTip).get_queryset(self.req)
        for obj in qs:
            str(obj.asset)  # what list_display=("...","asset") renders per row
            self.assertIn("blob", obj.asset.get_deferred_fields())

    def test_assetversion_changelist_defers_blob_but_delivery_still_works(self):
        av_admin = AssetVersionAdmin(AssetVersion, admin.site)
        obj = av_admin.get_queryset(self.req).first()
        self.assertIn("blob", obj.get_deferred_fields())
        self.assertIn("membership_filter", obj.get_deferred_fields())
        # delivery() reads the SQL-computed _has_blob flag, not the (deferred) blob bytes.
        self.assertEqual(av_admin.delivery(obj), "blob")

    def test_changelist_pages_render_200(self):
        self.client.force_login(self.req.user)
        for url in (
            "/admin/gamedata/taxontip/", "/admin/gamedata/taxonnode/",
            "/admin/gamedata/alias/", "/admin/gamedata/assetversion/",
        ):
            self.assertEqual(self.client.get(url).status_code, 200, url)
