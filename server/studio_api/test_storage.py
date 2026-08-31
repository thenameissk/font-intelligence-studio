"""
Uploads through S3-compatible storage.

This is the path that either works or silently loses every font anyone
uploads, and it only runs in production — so it is worth exercising against
a real S3 implementation rather than trusting that the settings parse.

Uses moto, which is a development dependency. The tests skip if it is absent
so the suite still runs from requirements.txt alone.
"""

import json
import unittest

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings

try:
    import boto3
    from moto import mock_aws

    HAS_MOTO = True
except ImportError:  # pragma: no cover
    HAS_MOTO = False

User = get_user_model()

BUCKET = "font-studio-media"

S3_STORAGE = {
    "default": {
        "BACKEND": "storages.backends.s3.S3Storage",
        "OPTIONS": {
            "bucket_name": BUCKET,
            "access_key": "testing",
            "secret_key": "testing",
            "region_name": "us-east-1",
            "default_acl": None,
            "querystring_auth": True,
            "file_overwrite": False,
            "signature_version": "s3v4",
        },
    },
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


@unittest.skipUnless(HAS_MOTO, "moto is not installed")
@override_settings(STORAGES=S3_STORAGE)
class S3UploadTests(TestCase):
    def setUp(self):
        self.mock = mock_aws()
        self.mock.start()
        boto3.client(
            "s3",
            region_name="us-east-1",
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        ).create_bucket(Bucket=BUCKET)

        self.user = User.objects.create_user("ana", password="pw")
        self.client.force_login(self.user)

    def tearDown(self):
        self.mock.stop()

    def keys(self):
        s3 = boto3.client(
            "s3",
            region_name="us-east-1",
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
        return [
            item["Key"]
            for item in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])
        ]

    def body(self, key):
        s3 = boto3.client(
            "s3",
            region_name="us-east-1",
            aws_access_key_id="testing",
            aws_secret_access_key="testing",
        )
        return s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()

    def test_a_project_font_reaches_the_bucket_intact(self):
        font = b"\x00\x01\x00\x00" + b"FONTDATA" * 512
        response = self.client.post(
            "/api/projects/",
            {"name": "P", "font": SimpleUploadedFile("Test.ttf", font)},
        )
        self.assertEqual(response.status_code, 201)

        keys = self.keys()
        self.assertEqual(len(keys), 1)
        self.assertTrue(keys[0].startswith("projects/"))
        # The whole point: the bytes that come back are the bytes sent.
        self.assertEqual(self.body(keys[0]), font)

    def test_the_font_url_is_signed_not_public(self):
        response = self.client.post(
            "/api/projects/",
            {"name": "P", "font": SimpleUploadedFile("Test.ttf", b"\x00\x01\x00\x00ab")},
        )
        url = response.json()["fontUrl"]
        # Private bucket plus a signed, expiring URL, so a leaked link does
        # not stay usable. SigV4 is pinned because R2 accepts nothing else.
        self.assertIn("X-Amz-Signature", url)
        self.assertIn("X-Amz-Expires", url)

    def test_a_library_font_reaches_the_bucket(self):
        response = self.client.post(
            "/api/library/",
            {
                "font": SimpleUploadedFile("Georgia.ttf", b"\x00\x01\x00\x00xy"),
                "family": "Georgia",
                "style": "Regular",
                "numGlyphs": "1134",
            },
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(any(k.startswith("library/") for k in self.keys()))

    def test_two_projects_do_not_overwrite_each_other(self):
        # file_overwrite=False, so a second upload of the same filename gets
        # its own key rather than clobbering the first project's font.
        for _ in range(2):
            self.client.post(
                "/api/projects/",
                {"name": "P", "font": SimpleUploadedFile("Same.ttf", b"\x00\x01\x00\x00z")},
            )
        self.assertEqual(len(self.keys()), 2)

    def test_the_overlay_still_saves_when_media_is_remote(self):
        created = self.client.post(
            "/api/projects/",
            {"name": "P", "font": SimpleUploadedFile("Test.ttf", b"\x00\x01\x00\x00q")},
        ).json()
        saved = self.client.patch(
            f"/api/projects/{created['id']}/",
            json.dumps({"edits": {"36": {"advanceWidth": 700}}}),
            content_type="application/json",
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.json()["edits"], {"36": {"advanceWidth": 700}})
