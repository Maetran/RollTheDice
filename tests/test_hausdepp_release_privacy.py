"""Public release metadata keeps account acknowledgements and push consent private.

Every account, release row and subscription below lives in a temporary SQLite
fixture. External push sending is mocked and no real account is used.
"""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException, Response
from sqlalchemy import select

from app import main, release_push
from app.api_releases import AcknowledgeReleaseRequest, acknowledge_release, release_history
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.models import PushRelease, PushReleaseRecipient, User, WebPushSubscription
from app.ownership import bind_founder, grant_ownership
from app.release_manifest import ReleaseNotice
from app.release_push import dispatch_release_notifications, publish_release_notice
from tests.test_user_accounts import request_for

NOTES = {
    "revision": "a" * 40, "version": "2.53.0", "kind": "usability", "games": ["hausdepp"],
    "summary_de": "Hausdepp wird am privaten Testtisch spielbar.",
    "summary_en": "Hausdepp becomes playable at the private test table.",
    "player_notes": {
        "de": {"title": "Hausdepp am Testtisch", "changes": ["Spiele eine private Testrunde gegen den Computer."]},
        "en": {"title": "Hausdepp at the test table", "changes": ["Play a private test round against the computer."]},
    },
}


class HausdeppReleasePrivacyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/private-release.sqlite3",
            "ROLLTHEDICE_ZILCH_ACCESS_MODE": "public", "ROLLTHEDICE_COOKIE_DOMAIN": "",
            "ROLLTHEDICE_COOKIE_SECURE": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("Founder", "secure-password-123", role="admin", must_change_password=False)
        self.owner = create_user("Owner", "secure-password-123", role="admin", must_change_password=False)
        self.admin = create_user("Mani", "secure-password-123", role="admin", must_change_password=False)
        self.player = create_user("Player", "secure-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
            grant_ownership(db, self.owner.id, self.founder.id)
        self.requests = {}
        for user in (self.founder, self.owner, self.admin, self.player):
            identity, token = login(request_for(), user.username, "secure-password-123")
            self.requests[user.id] = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
        self.now = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
        self.notice = ReleaseNotice.from_payload(NOTES)

    def tearDown(self):
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def history(self, request, game="hausdepp", language="de"):
        return release_history(request, Response(), game_type=game, language=language)

    def test_manifest_accepts_hausdepp_and_shared_public_suite_announcements(self):
        self.assertEqual(self.notice.games, ("hausdepp",))
        self.assertEqual(self.notice.payload()["games"], ["hausdepp"])
        for games in (["hausdepp", "zdwa"], ["zilch", "hausdepp"], ["hausdepp", "zdwa", "zilch"]):
            self.assertEqual(set(ReleaseNotice.from_payload({**NOTES, "games": games}).games), set(games))

    def test_public_release_history_is_readable_but_acknowledgement_is_account_owned(self):
        self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
        for user in (self.founder, self.owner, self.admin, self.player):
            request = self.requests[user.id]
            history = self.history(request, language="en")
            self.assertEqual(history["viewer_id"], user.id)
            self.assertEqual(history["releases"][0]["title"], NOTES["player_notes"]["en"]["title"])
            self.assertTrue(acknowledge_release(self.notice.revision, AcknowledgeReleaseRequest(viewer_id=user.id),
                                               request, Response(), game_type="hausdepp")["ok"])
            self.assertTrue(self.history(request)["releases"][0]["acknowledged"])
        anonymous = self.history(request_for())
        self.assertIsNone(anonymous["viewer_id"])
        self.assertFalse(anonymous["releases"][0]["acknowledged"])
        with self.assertRaises(HTTPException) as denied:
            acknowledge_release(self.notice.revision, AcknowledgeReleaseRequest(viewer_id=self.player.id),
                                request_for(), Response(), game_type="hausdepp")
        self.assertEqual(denied.exception.status_code, 401)

    def test_private_notice_is_absent_from_both_existing_game_histories_and_ack_paths(self):
        publish_release_notice(self.notice, now=self.now)
        for request in (request_for(), *self.requests.values()):
            for game in ("zdwa", "zilch"):
                self.assertEqual(self.history(request, game=game)["releases"], [])
        for user in (self.founder, self.owner, self.admin, self.player):
            for game in ("zdwa", "zilch"):
                with self.assertRaises(HTTPException) as denied:
                    acknowledge_release(self.notice.revision, AcknowledgeReleaseRequest(viewer_id=user.id),
                                        self.requests[user.id], Response(), game_type=game)
                self.assertEqual(denied.exception.status_code, 404)

    def test_public_mixed_notice_is_available_in_each_target_product_without_private_account_receipts(self):
        # Defend readers even if an older/manual writer bypassed the manifest.
        with session_scope() as db:
            db.add(PushRelease(
                revision="b" * 40, version="2.53.0", kind="usability", summary_de=NOTES["summary_de"],
                summary_en=NOTES["summary_en"], game_types_json=json.dumps(["hausdepp", "zdwa", "zilch"]),
                published_at=self.now, player_notes_json=json.dumps(NOTES["player_notes"]),
            ))
        for request in (request_for(), *(self.requests[user.id] for user in (self.owner, self.admin, self.player))):
            for game in ("zdwa", "zilch"):
                self.assertEqual(len(self.history(request, game=game)["releases"]), 1)
        for game in ("zdwa", "zilch"):
            self.assertTrue(acknowledge_release("b" * 40, AcknowledgeReleaseRequest(viewer_id=self.player.id),
                                               self.requests[self.player.id], Response(), game_type=game)["ok"])

    def test_house_only_notice_does_not_target_devices_registered_only_for_other_products(self):
        with session_scope() as db:
            for user in (self.founder, self.owner, self.admin, self.player):
                db.get(User, user.id).release_push_enabled = True
                for context in ("zdwa", "zilch"):
                    db.add(WebPushSubscription(
                        user_id=user.id, endpoint=f"https://fixture.invalid/{user.id}/{context}",
                        p256dh="fixture-public-key", auth="fixture-auth", product_context=context,
                        created_at=self.now, updated_at=self.now,
                    ))
        with patch.object(release_push, "_send_web_push") as send, patch.object(
            release_push, "web_push_available", return_value=True,
        ):
            self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
            send.assert_not_called()
        with session_scope() as db:
            self.assertEqual(list(db.scalars(select(PushReleaseRecipient))), [])
            self.assertIsNotNone(db.get(PushRelease, self.notice.revision))

    def test_shared_v3_fanfare_reaches_each_opted_in_account_once_with_its_house_device(self):
        notes = {"de": {"title": "Töröö! Der Hausdepp ist da.", "changes": ["Hausdepp ist für alle Konten da."]},
                 "en": {"title": "Ta-da! Hausdepp has arrived.", "changes": ["Hausdepp is open to every account."]}}
        notice = ReleaseNotice.from_payload({**NOTES, "games": ["zdwa", "zilch", "hausdepp"], "player_notes": notes})
        with session_scope() as db:
            for user in (self.founder, self.owner, self.admin, self.player):
                db.get(User, user.id).release_push_enabled = True
                db.get(User, user.id).preferred_language = "en" if user.id == self.player.id else "de"
                for context in ("zdwa", "zilch", "hausdepp"):
                    db.add(WebPushSubscription(user_id=user.id, endpoint=f"https://fixture.invalid/{user.id}/{context}",
                                              p256dh="fixture-key", auth="fixture-auth", product_context=context,
                                              created_at=self.now, updated_at=self.now))
        with patch.object(release_push, "_send_web_push", return_value=(True, False)) as send, patch.object(
                release_push, "web_push_available", return_value=True):
            self.assertEqual(publish_release_notice(notice, now=self.now), 4)
            self.assertEqual(publish_release_notice(notice, now=self.now), 0)
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 4)
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
            self.assertEqual(send.call_count, 4)
            accounts = set()
            for call in send.call_args_list:
                subscription, payload = call.args
                accounts.add(subscription.user_id)
                self.assertEqual(subscription.product_context, "hausdepp")
                self.assertEqual(payload["url"], "/hausdepp")
                self.assertEqual(payload["icon"], "/static/icons/hausdepp-icon-192-v2.png")
                self.assertEqual(payload["title"], notes[subscription.preferred_language]["title"])
            self.assertEqual(accounts, {self.founder.id, self.owner.id, self.admin.id, self.player.id})

    def test_legacy_notification_title_falls_back_without_inventing_player_notes(self):
        release = PushRelease(revision="f" * 40, summary_de="Stabiler", summary_en="More stable")
        for invalid in (None, "broken-json", "[]", '{"en":{"title":false}}', '{"en":{"title":"bad\\ntext"}}'):
            release.player_notes_json = invalid
            payload = release_push.release_notification_payload(release, "hausdepp", "en")
            self.assertEqual(payload["title"], "Hausdepp: Update available")
            self.assertEqual(payload["body"], "More stable")


if __name__ == "__main__":
    unittest.main()
