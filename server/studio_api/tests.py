"""
API behaviour, with an eye on the things that would quietly lose someone's
work or leak it to the wrong person.
"""

import json

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from .models import FontProject, LibraryFont

User = get_user_model()


def font_file(name: str = "Test.ttf", size: int = 2048) -> SimpleUploadedFile:
    # The API does not parse fonts, so the bytes only have to be bytes.
    return SimpleUploadedFile(name, b"\x00\x01\x00\x00" + b"x" * size)


class SessionTests(TestCase):
    def test_anonymous_is_reported_not_errored(self):
        # Working without an account is normal, so this is a 200 saying no.
        response = self.client.get("/api/session/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["authenticated"])

    def test_session_reports_whether_uploads_survive_a_redeploy(self):
        # Silent data loss otherwise: local media on an ephemeral host works
        # perfectly right up until the next deploy erases it.
        with self.settings(DEBUG=False, MEDIA_BACKEND="local"):
            self.assertFalse(self.client.get("/api/session/").json()["mediaDurable"])
        with self.settings(DEBUG=False, MEDIA_BACKEND="s3"):
            self.assertTrue(self.client.get("/api/session/").json()["mediaDurable"])

    def test_sign_in_and_out(self):
        User.objects.create_user("ana", password="correct-horse")

        response = self.client.post(
            "/api/session/sign-in/",
            json.dumps({"username": "ana", "password": "correct-horse"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["username"], "ana")
        self.assertTrue(self.client.get("/api/session/").json()["authenticated"])

        self.client.post("/api/session/sign-out/")
        self.assertFalse(self.client.get("/api/session/").json()["authenticated"])

    def test_wrong_password_is_rejected(self):
        User.objects.create_user("ana", password="correct-horse")
        response = self.client.post(
            "/api/session/sign-in/",
            json.dumps({"username": "ana", "password": "wrong"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)


class ProjectTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", password="pw")
        self.ben = User.objects.create_user("ben", password="pw")
        self.client.force_login(self.ana)

    def create(self, name="Project", **extra):
        return self.client.post(
            "/api/projects/",
            {"name": name, "font": font_file(), "fontFamily": "Test", **extra},
        )

    def test_requires_a_session(self):
        self.client.logout()
        self.assertEqual(self.client.get("/api/projects/").status_code, 401)

    def test_create_then_load(self):
        created = self.create()
        self.assertEqual(created.status_code, 201)
        body = created.json()
        self.assertEqual(body["name"], "Project")
        self.assertIn("fontUrl", body)

        loaded = self.client.get(f"/api/projects/{body['id']}/")
        self.assertEqual(loaded.status_code, 200)
        self.assertEqual(loaded.json()["fontFileName"], "Test.ttf")

    def test_edits_round_trip(self):
        project_id = self.create().json()["id"]
        overlay = {"36": {"advanceWidth": 700}}

        saved = self.client.patch(
            f"/api/projects/{project_id}/",
            json.dumps({"edits": overlay, "kerningEdits": {"36,57": -40}}),
            content_type="application/json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["edits"], overlay)

        reloaded = self.client.get(f"/api/projects/{project_id}/").json()
        self.assertEqual(reloaded["edits"], overlay)
        self.assertEqual(reloaded["kerningEdits"], {"36,57": -40})

    def test_a_project_is_private_to_its_owner(self):
        project_id = self.create().json()["id"]

        self.client.force_login(self.ben)
        # Not 403: Ben should not learn that this project exists.
        self.assertEqual(
            self.client.get(f"/api/projects/{project_id}/").status_code, 404
        )
        self.assertEqual(
            self.client.delete(f"/api/projects/{project_id}/").status_code, 404
        )
        self.assertEqual(self.client.get("/api/projects/").json()["projects"], [])

    def test_versions_store_only_the_overlay(self):
        project_id = self.create().json()["id"]
        response = self.client.post(
            f"/api/projects/{project_id}/versions/",
            json.dumps({"label": "Before widening", "edits": {"1": {}}}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["label"], "Before widening")

        listed = self.client.get(f"/api/projects/{project_id}/versions/").json()
        self.assertEqual(len(listed["versions"]), 1)
        # The font is on the project; a snapshot must not duplicate it.
        self.assertNotIn("fontUrl", listed["versions"][0])

    def test_delete_removes_it(self):
        project_id = self.create().json()["id"]
        self.assertEqual(
            self.client.delete(f"/api/projects/{project_id}/").status_code, 200
        )
        self.assertEqual(FontProject.objects.count(), 0)

    def test_rejects_a_file_that_is_not_a_font(self):
        response = self.client.post(
            "/api/projects/",
            {"name": "x", "font": SimpleUploadedFile("notes.txt", b"hello")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("TTF", response.json()["error"])

    def test_rejects_a_malformed_overlay(self):
        project_id = self.create().json()["id"]
        response = self.client.patch(
            f"/api/projects/{project_id}/",
            json.dumps({"edits": "not an object"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)

    def test_rejects_malformed_json(self):
        project_id = self.create().json()["id"]
        response = self.client.patch(
            f"/api/projects/{project_id}/",
            "{not json",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 400)


class LibraryTests(TestCase):
    def setUp(self):
        self.ana = User.objects.create_user("ana", password="pw")
        self.ben = User.objects.create_user("ben", password="pw")
        self.client.force_login(self.ana)

    def add(self, family="Georgia", style="Regular", glyphs=1134):
        return self.client.post(
            "/api/library/",
            {
                "font": font_file(f"{family}.ttf"),
                "family": family,
                "style": style,
                "numGlyphs": str(glyphs),
                "unitsPerEm": "2048",
                "isItalic": "false",
                "outlineFormat": "truetype",
            },
        )

    def test_the_library_is_shared(self):
        self.assertEqual(self.add().status_code, 201)

        # Ben did not upload it, but he can see it: that is the point.
        self.client.force_login(self.ben)
        fonts = self.client.get("/api/library/").json()["fonts"]
        self.assertEqual(len(fonts), 1)
        self.assertEqual(fonts[0]["family"], "Georgia")
        self.assertEqual(fonts[0]["addedBy"], "ana")

    def test_the_same_face_twice_is_not_duplicated(self):
        first = self.add()
        second = self.add()
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["id"], second.json()["id"])
        self.assertEqual(LibraryFont.objects.count(), 1)

    def test_only_the_uploader_or_staff_can_remove(self):
        font_id = self.add().json()["id"]

        self.client.force_login(self.ben)
        self.assertEqual(
            self.client.delete(f"/api/library/{font_id}/").status_code, 403
        )

        self.client.force_login(self.ana)
        self.assertEqual(
            self.client.delete(f"/api/library/{font_id}/").status_code, 200
        )
        self.assertEqual(LibraryFont.objects.count(), 0)

    def test_staff_can_remove_anything(self):
        font_id = self.add().json()["id"]
        staff = User.objects.create_user("mod", password="pw", is_staff=True)
        self.client.force_login(staff)
        self.assertEqual(
            self.client.delete(f"/api/library/{font_id}/").status_code, 200
        )


class CsrfTests(TestCase):
    """
    The studio is a single page that never renders a Django form, so nothing
    would otherwise set the CSRF cookie -- and every mutating API call would
    be rejected. The page has to issue it.
    """

    def test_the_studio_page_sets_the_csrf_cookie(self):
        response = self.client.get("/studio/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("csrftoken", response.cookies)

    def test_the_page_tells_the_client_where_the_api_is(self):
        response = self.client.get("/studio/")
        self.assertContains(response, "__FONT_STUDIO__")
        self.assertContains(response, "/api/")

    def test_a_post_without_a_token_is_refused(self):
        from django.test import Client

        strict = Client(enforce_csrf_checks=True)
        response = strict.post(
            "/api/session/sign-in/",
            json.dumps({"username": "x", "password": "y"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 403)

    def test_a_post_with_the_token_is_accepted(self):
        from django.test import Client

        User.objects.create_user("ana", password="pw")
        strict = Client(enforce_csrf_checks=True)
        token = strict.get("/studio/").cookies["csrftoken"].value

        response = strict.post(
            "/api/session/sign-in/",
            json.dumps({"username": "ana", "password": "pw"}),
            content_type="application/json",
            headers={"x-csrftoken": token},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["authenticated"])
