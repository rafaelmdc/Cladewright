"""Display-name profile: auto-creation, validation, the PATCH endpoint, and that the
leaderboard shows the chosen name. See GitHub issue #62."""
from __future__ import annotations

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from rest_framework.test import APIClient

from apps.gamedata.models import AssetVersion, TaxonNode, TaxonTip
from apps.scores.models import GameMode, Run

from .models import (
    Profile,
    _default_display_name,
    validate_display_name,
)

User = get_user_model()


class ProfileModelTests(TestCase):
    def test_profile_auto_created_with_default_name(self):
        u = User.objects.create_user(username="darwin", email="d@x.io")
        self.assertEqual(u.profile.display_name, "darwin")
        self.assertFalse(u.profile.name_chosen)

    def test_default_name_dedupes_on_collision(self):
        # A pre-existing profile occupying "finch" forces the next "finch" to take a suffix.
        first = User.objects.create_user(username="finch")
        Profile.objects.filter(user=first).update(display_name="finch")
        clash = User.objects.create_user(username="finch_clone")
        clash.username = "finch"  # not saved; we only probe the helper's de-dup logic
        self.assertEqual(_default_display_name(clash), "finch1")

    def test_validate_rejects_short_long_and_bad_chars(self):
        with self.assertRaises(ValidationError):
            validate_display_name("ab")
        with self.assertRaises(ValidationError):
            validate_display_name("x" * 25)
        with self.assertRaises(ValidationError):
            validate_display_name("bad/name!")

    def test_validate_normalizes_whitespace(self):
        self.assertEqual(validate_display_name("  Red   Fox  "), "Red Fox")

    def test_validate_uniqueness_case_insensitive(self):
        u = User.objects.create_user(username="a")
        Profile.objects.filter(user=u).update(display_name="Naturalist")
        with self.assertRaises(ValidationError):
            validate_display_name("naturalist")
        # The owner may re-save their own (excluded by id).
        self.assertEqual(
            validate_display_name("naturalist", exclude_user_id=u.pk), "naturalist"
        )


class ProfileEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = User.objects.create_user(username="user1", email="u1@x.io")
        self.client.force_authenticate(self.user)

    def test_me_reports_display_name_and_chosen_flag(self):
        r = self.client.get("/api/auth/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["display_name"], "user1")
        self.assertFalse(r.data["name_chosen"])

    def test_patch_sets_name_and_marks_chosen(self):
        r = self.client.patch("/api/auth/profile/", {"display_name": "Field Notes"}, format="json")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["display_name"], "Field Notes")
        self.user.profile.refresh_from_db()
        self.assertTrue(self.user.profile.name_chosen)

    def test_patch_rejects_taken_name(self):
        other = User.objects.create_user(username="user2")
        Profile.objects.filter(user=other).update(display_name="Taken")
        r = self.client.patch("/api/auth/profile/", {"display_name": "taken"}, format="json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("taken", r.data["error"].lower())

    def test_patch_requires_auth(self):
        self.client.force_authenticate(None)
        r = self.client.patch("/api/auth/profile/", {"display_name": "Nope"}, format="json")
        self.assertEqual(r.status_code, 403)


class LeaderboardDisplayNameTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.av = AssetVersion.objects.create(scope="", version=1, pool_size=1, is_current=True)
        TaxonNode.objects.create(asset=self.av, key="kng:A", rank="kingdom", sci="A", lineage=[])
        TaxonTip.objects.create(asset=self.av, key="tip:1", sci="t", common="t",
                                parent_key="kng:A", lineage=["kng:A"])

    def test_leaderboard_shows_display_name(self):
        u = User.objects.create_user(username="internal_handle")
        Profile.objects.filter(user=u).update(display_name="Jane Goodall")
        Run.objects.create(user=u, mode=GameMode.MARATHON_FREE, scope="", difficulty="common",
                           score=5, ranked=True, transcript=["tip:1"], asset_version=1)
        r = self.client.get("/api/scores/leaderboard/", {"mode": GameMode.MARATHON_FREE})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["entries"][0]["user"], "Jane Goodall")
