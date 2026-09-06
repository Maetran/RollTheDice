"""Release history and acknowledgements have no dependency on push consent."""

from __future__ import annotations

import json
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Response

from app.api_releases import AcknowledgeReleaseRequest, acknowledge_release, release_history
from app.auth import create_user, login
from app.database import configure_database, session_scope
from app.models import PushRelease, PushReleaseRecipient, ReleaseAcknowledgement, User
from app.release_manifest import ReleaseNotice, validate_player_notes
from app.release_push import publish_release_notice
from tests import test_web_push as fixtures
from tests.test_release_push import NOTES


class PlayerReleaseNotesTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.settings_patch = patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"})
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.player = create_user("NotesPlayer", "notes-password-123", must_change_password=False)
        self.identity, token = login(fixtures.request_for(token="missing", csrf="missing"), "NotesPlayer", "notes-password-123")
        self.request = fixtures.request_for(token=token, csrf=self.identity.csrf_token)
        self.guest = fixtures.request_for(token="missing", csrf="missing")
        self.now = datetime(2026, 9, 6, 12, tzinfo=timezone.utc)

    def publish(self, index=1, games=None):
        notice = ReleaseNotice.from_payload({**NOTES, "revision": f"{index:040x}", "games": games or ["zdwa", "zilch"]})
        publish_release_notice(notice, now=self.now + timedelta(minutes=index))
        return notice

    def history(self, request=None, context="zdwa", language="de"):
        return release_history(request or self.request, Response(), game_type=context, language=language)

    def acknowledge(self, revision):
        return acknowledge_release(revision, AcknowledgeReleaseRequest(viewer_id=self.player.id), self.request, Response(), game_type="zdwa")

    def test_published_notes_visible_without_push_and_guests_cannot_write_acknowledgements(self):
        notice = self.publish()
        result = self.history()
        self.assertEqual(result["viewer_id"], self.player.id)
        self.assertTrue(result["can_prompt"])
        self.assertEqual(result["releases"][0]["changes"], NOTES["player_notes"]["de"]["changes"])
        self.assertFalse(result["releases"][0]["acknowledged"])
        self.assertEqual(self.history(self.guest)["viewer_id"], None)
        self.assertEqual(self.history(self.guest, language="en")["releases"][0]["title"], NOTES["player_notes"]["en"]["title"])
        with session_scope() as db:
            self.assertFalse(db.get(User, self.player.id).release_push_enabled)
            self.assertEqual(db.query(PushReleaseRecipient).count(), 0)
        with self.assertRaises(HTTPException) as denied:
            acknowledge_release(notice.revision, AcknowledgeReleaseRequest(viewer_id=self.player.id), self.guest, Response(), game_type="zdwa")
        self.assertEqual(denied.exception.status_code, 401)

    def test_only_ten_latest_relevant_releases_with_no_push_audience_or_device_information(self):
        for index in range(12):
            self.publish(index)
        self.publish(99, games=["zilch"])
        response = Response()
        data = release_history(self.request, response, game_type="zdwa", language="de")
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        self.assertEqual([int(item["revision"], 16) for item in data["releases"]], list(range(11, 1, -1)))
        self.assertEqual(int(self.history(context="zilch")["releases"][0]["revision"], 16), 99)
        self.assertNotIn("subscription", json.dumps(data))
        self.assertNotIn("recipients", json.dumps(data))
        self.assertNotIn("csrf", json.dumps(data))

    def test_acknowledgement_is_atomic_account_wide_survives_restart_and_does_not_hide_history(self):
        notice = self.publish()
        with ThreadPoolExecutor(max_workers=4) as pool:
            result = list(pool.map(lambda _: self.acknowledge(notice.revision), range(4)))
        self.assertTrue(all(item["ok"] for item in result))
        with session_scope() as db:
            self.assertEqual(db.query(ReleaseAcknowledgement).count(), 1)
            timestamp = db.query(ReleaseAcknowledgement).one().acknowledged_at
        self.acknowledge(notice.revision)
        with session_scope() as db:
            self.assertEqual(db.query(ReleaseAcknowledgement).one().acknowledged_at, timestamp)
        configure_database(Path(self.temporary_directory.name))
        self.assertTrue(self.history(context="zilch")["releases"][0]["acknowledged"])
        self.assertEqual(len(self.history()["releases"]), 1)
        self.assertFalse(self.history(self.guest)["releases"][0]["acknowledged"])
        newer = self.publish(2)
        self.assertFalse(self.history()["releases"][0]["acknowledged"])
        self.assertEqual(self.history()["releases"][0]["revision"], newer.revision)

    def test_acknowledgement_requires_csrf_and_matching_current_account(self):
        notice = self.publish()
        payload = AcknowledgeReleaseRequest(viewer_id=self.player.id)
        bad_csrf = fixtures.request_for(token=self.request.cookies["rollthedice_session"], csrf="wrong")
        with self.assertRaises(HTTPException) as denied:
            acknowledge_release(notice.revision, payload, bad_csrf, Response(), game_type="zdwa")
        self.assertEqual(denied.exception.status_code, 403)
        with self.assertRaises(HTTPException) as denied:
            acknowledge_release(notice.revision, AcknowledgeReleaseRequest(viewer_id=self.player.id + 1), self.request, Response(), game_type="zdwa")
        self.assertEqual(denied.exception.status_code, 409)
        with session_scope() as db:
            self.assertEqual(db.query(ReleaseAcknowledgement).count(), 0)

    def test_unknown_or_wrong_product_cannot_be_acknowledged(self):
        notice = self.publish(games=["zilch"])
        for revision in ("f" * 40, notice.revision, "not-a-release"):
            with self.assertRaises(HTTPException) as denied:
                self.acknowledge(revision)
            self.assertEqual(denied.exception.status_code, 404)
        with patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "preview"}):
            for request in (self.request, self.guest):
                with self.assertRaises(HTTPException) as denied:
                    self.history(request, context="zilch")
                self.assertEqual(denied.exception.status_code, 403)

    def test_historic_push_only_releases_are_readable_but_not_announced(self):
        notice = self.publish()
        with session_scope() as db:
            db.get(PushRelease, notice.revision).player_notes_json = None
        item = self.history()["releases"][0]
        self.assertFalse(item["can_announce"])
        self.assertEqual(item["changes"], [NOTES["summary_de"]])

    def test_required_password_change_takes_priority_and_invalidated_login_cannot_ack(self):
        notice = self.publish()
        with session_scope() as db:
            db.get(User, self.player.id).must_change_password = True
        self.assertFalse(self.history()["can_prompt"])
        with session_scope() as db:
            db.get(User, self.player.id).is_active = False
        with self.assertRaises(HTTPException) as denied:
            self.acknowledge(notice.revision)
        self.assertEqual(denied.exception.status_code, 401)


class PlayerReleaseCopyTestCase(unittest.TestCase):
    def test_every_note_needs_a_short_translation_and_bounded_plain_text(self):
        valid = NOTES["player_notes"]
        for invalid in (None, {}, {"de": valid["de"]}, {**valid, "en": {"title": "x", "changes": []}},
                        {**valid, "en": {"title": "x" * 101, "changes": ["ok"]}},
                        {**valid, "en": {"title": "ok", "changes": ["x" * 301]}},
                        {**valid, "en": {"title": "ok", "changes": ["a"] * 9}},
                        {**valid, "en": {"title": "ok", "changes": ["a", "b"]}},
                        {**valid, "en": {"title": "ok", "changes": ["two\nlines"]}}):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_player_notes(invalid)

    def test_current_recap_is_valid_bilingual_and_explains_recent_player_features(self):
        path = Path(__file__).resolve().parents[1] / "app" / "release-notice.json"
        notice = ReleaseNotice.from_payload({**json.loads(path.read_text(encoding="utf-8")), "revision": "a" * 40})
        self.assertTrue(notice.player_notes["de"]["changes"])
        self.assertGreater(len(" ".join(notice.player_notes["de"]["changes"])), len(notice.summary_de))
