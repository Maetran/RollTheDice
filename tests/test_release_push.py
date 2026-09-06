"""Release consent, deploy classification and durable, audience-scoped delivery."""

from __future__ import annotations

import asyncio
import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from app import release_push
from app.auth import create_user
from app.database import configure_database, session_scope
from app.models import PushRelease, PushReleaseRecipient, User, WebPushSubscription
from app.release_manifest import STABILITY_DE, STABILITY_EN, ReleaseNotice
from app.release_push import dispatch_release_notifications, publish_release_notice
from app.web_push import (
    WebPushPreferencesRequest,
    remove_web_push_subscriptions,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)
from scripts.prepare_release_notice import prepare_notice
from tests import test_web_push as fixtures

REVISION = "a" * 40
NOTES = {"kind": "usability", "games": ["zdwa", "zilch"], "summary_de": "Jetzt neu: Lobby-Chat", "summary_en": "New: lobby chat",
         "player_notes": {"de": {"title": "Zusammen spielen", "changes": ["Schreibe anderen Spielern im Lobby-Chat."]},
                          "en": {"title": "Play together", "changes": ["Talk to other players in the lobby chat."]}}}


class ReleaseMetadataTestCase(unittest.TestCase):
    def test_backend_always_uses_stability_copy_and_never_reuses_a_feature(self) -> None:
        notice = prepare_notice(revision=REVISION, changed=["app/main.py"], notes=NOTES)
        self.assertEqual(notice["kind"], "backend")
        self.assertEqual(notice["summary_de"], STABILITY_DE)
        self.assertEqual(notice["summary_en"], STABILITY_EN)
        self.assertEqual(ReleaseNotice.from_payload({**notice, "summary_de": "Old feature"}).summary_de, STABILITY_DE)

    def test_visible_release_requires_fresh_reviewed_bilingual_copy(self) -> None:
        for path in ("frontend/zilch/index.js", "app/static/account.html", "zilch-manifest.webmanifest"):
            with self.subTest(path=path), self.assertRaisesRegex(ValueError, "fresh"):
                prepare_notice(revision=REVISION, changed=[path], notes=NOTES)
        self.assertEqual(prepare_notice(revision=REVISION, changed=["frontend/zilch/index.js", "app/release-notice.json"], notes=NOTES), {**NOTES, "revision": REVISION})
        with self.assertRaisesRegex(ValueError, "usability"):
            prepare_notice(revision=REVISION, changed=["app/static/account.html", "app/release-notice.json"], notes={**NOTES, "kind": "backend"})

    def test_documentation_tests_and_deploy_script_alone_do_not_notify_players(self) -> None:
        self.assertEqual(prepare_notice(revision=REVISION, changed=["README.md", "docs/DEPLOYMENT.md", "tests/test_release_push.py", "scripts/deploy_zdwa.sh"], notes=NOTES), {"skip": True})

    def test_invalid_or_untranslated_metadata_is_rejected(self) -> None:
        valid = {**NOTES, "revision": REVISION}
        for changes in ({"revision": "master"}, {"games": []}, {"games": ["other"]}, {"kind": "auto"}, {"summary_en": ""}, {"summary_de": "x" * 141}, {"summary_de": "two\nlines"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                ReleaseNotice.from_payload({**valid, **changes})


class ReleasePushTestCase(unittest.TestCase):
    tearDown = fixtures.WebPushTestCase.tearDown

    def setUp(self) -> None:
        fixtures.WebPushTestCase.setUp(self)
        self.settings_patch = patch.dict(os.environ, {"ROLLTHEDICE_ZILCH_ACCESS_MODE": "public"})
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.player = create_user("ReleasePlayer", "a-secure-password-123", must_change_password=False)
        self.now = datetime(2026, 9, 6, 10, tzinfo=timezone.utc)
        self.notice = ReleaseNotice.from_payload({**NOTES, "revision": REVISION})

    def subscribe(self, *, user_id: int | None = None, suffix: str = "one", context: str = "zdwa") -> None:
        save_web_push_subscription(user_id=user_id or self.player.id, payload=fixtures.WebPushTestCase.subscription(f"https://fcm.googleapis.com/fcm/send/{suffix}"), product_context=context)

    def enable(self, *, user_id: int | None = None) -> None:
        update_web_push_preferences(user_id or self.player.id, WebPushPreferencesRequest(
            game_invites_enabled=False, daily_reminder_enabled=False, release_notifications_enabled=True,
        ))

    def test_release_is_separate_opt_in_and_old_clients_preserve_it(self) -> None:
        with self.assertRaisesRegex(ValueError, "device_required"):
            self.enable()
        self.subscribe()
        self.assertFalse(web_push_subscription_status(self.player.id)["release_notifications_enabled"])
        self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
        self.enable()
        self.subscribe(suffix="two")
        result = update_web_push_preferences(self.player.id, WebPushPreferencesRequest(game_invites_enabled=False, daily_reminder_enabled=False))
        self.assertTrue(result["enabled"])
        self.assertTrue(result["release_notifications_enabled"])
        self.assertFalse(result["game_invites_enabled"])
        # Enabling after publication does not add a recipient to this revision.
        self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
        with patch.object(release_push, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
            send.assert_not_called()
        removed = remove_web_push_subscriptions(self.player.id)
        self.assertFalse(removed["release_notifications_enabled"])
        self.assertFalse(removed["enabled"])

    def test_once_per_revision_across_parallel_publication_dispatch_and_restart(self) -> None:
        self.subscribe()
        self.enable()
        with ThreadPoolExecutor(max_workers=4) as pool:
            counts = list(pool.map(lambda _: publish_release_notice(self.notice, now=self.now), range(4)))
        self.assertEqual(sum(counts), 1)
        self.subscribe(suffix="late-device")
        with patch.object(release_push, "_send_web_push", return_value=(True, False)) as send:
            with ThreadPoolExecutor(max_workers=4) as pool:
                claims = list(pool.map(lambda _: asyncio.run(dispatch_release_notifications(now=self.now)), range(4)))
            self.assertEqual(sum(claims), 1)
            send.assert_called_once()
            self.assertTrue(send.call_args.args[0].endpoint.endswith("/one"))
            self.assertEqual(send.call_args.kwargs["ttl"], 24 * 60 * 60)
            configure_database(Path(self.temporary_directory.name))
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
            self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
        with session_scope() as db:
            self.assertEqual(db.query(PushRelease).count(), 1)
            self.assertIsNotNone(db.query(PushReleaseRecipient).one().claimed_at)

    def test_new_revision_has_its_own_claim_and_failures_do_not_repeat(self) -> None:
        self.subscribe()
        self.enable()
        publish_release_notice(self.notice, now=self.now)
        with patch.object(release_push, "_send_web_push", return_value=(False, False)) as send:
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 1)
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
            publish_release_notice(ReleaseNotice.from_payload({**NOTES, "revision": "b" * 40}), now=self.now)
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 1)
            self.assertEqual(send.call_count, 2)

    def test_each_device_rechecks_consent_and_uses_current_language(self) -> None:
        self.subscribe()
        self.subscribe(suffix="two")
        self.enable()
        publish_release_notice(self.notice, now=self.now)
        with session_scope() as db:
            db.get(User, self.player.id).preferred_language = "en"
        def stop_after_first(*_args, **_kwargs):
            remove_web_push_subscriptions(self.player.id)
            return True, False
        with patch.object(release_push, "_send_web_push", side_effect=stop_after_first) as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            send.assert_called_once()
            payload = send.call_args.args[1]
            self.assertEqual(payload["body"], NOTES["summary_en"])
            self.assertEqual(payload["title"], "ZDWA: Update available")
            self.assertTrue(payload["url"].endswith("/"))
            self.assertNotIn("/spiel/", payload["url"])
            self.assertEqual(payload["tag"], f"app-release-{REVISION}")

    def test_expired_subscriptions_are_removed_and_old_releases_are_not_sent(self) -> None:
        self.subscribe()
        self.enable()
        publish_release_notice(self.notice, now=self.now)
        with patch.object(release_push, "_send_web_push", return_value=(False, True)) as send:
            asyncio.run(dispatch_release_notifications(now=self.now + timedelta(hours=23)))
            self.assertEqual(send.call_args.kwargs["ttl"], 3600)
        with session_scope() as db:
            self.assertEqual(db.query(WebPushSubscription).count(), 0)
        self.subscribe(suffix="again")
        publish_release_notice(ReleaseNotice.from_payload({**NOTES, "revision": "c" * 40}), now=self.now)
        with patch.object(release_push, "_send_web_push") as send:
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now + timedelta(days=1))), 1)
            send.assert_not_called()

    def test_recipient_disabled_opted_out_or_device_reassigned_before_delivery_is_skipped(self) -> None:
        other = create_user("OtherPlayer", "another-password-123", must_change_password=False)
        for index, mutation in enumerate(("disabled", "opted-out", "reassigned")):
            with self.subTest(mutation=mutation):
                with session_scope() as db:
                    db.get(User, self.player.id).is_active = True
                self.subscribe()
                self.enable()
                notice = ReleaseNotice.from_payload({**NOTES, "revision": str(index) * 40})
                publish_release_notice(notice, now=self.now)
                with session_scope() as db:
                    if mutation == "disabled":
                        db.get(User, self.player.id).is_active = False
                    elif mutation == "opted-out":
                        db.get(User, self.player.id).release_push_enabled = False
                    else:
                        db.query(WebPushSubscription).one().user_id = other.id
                        db.get(User, other.id).release_push_enabled = True
                with patch.object(release_push, "_send_web_push") as send:
                    asyncio.run(dispatch_release_notifications(now=self.now))
                    send.assert_not_called()

    def test_product_scope_and_shared_releases_choose_one_product_not_both(self) -> None:
        self.subscribe()
        self.subscribe(suffix="zilch", context="zilch")
        self.subscribe(suffix="zilch-two", context="zilch")
        self.enable()
        zdwa_only = ReleaseNotice.from_payload({**NOTES, "games": ["zdwa"], "revision": "d" * 40})
        publish_release_notice(zdwa_only, now=self.now)
        with patch.object(release_push, "_send_web_push", return_value=(True, False)) as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            send.assert_called_once()
            self.assertEqual(send.call_args.args[0].product_context, "zdwa")
        publish_release_notice(self.notice, now=self.now)
        with patch.object(release_push, "_send_web_push", return_value=(True, False)) as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            self.assertEqual(send.call_count, 2)
            self.assertTrue(all(call.args[0].product_context == "zilch" for call in send.call_args_list))
            self.assertEqual(send.call_args.args[1]["body"], NOTES["summary_de"])

    def test_game_access_rechecked_at_publication_and_dispatch(self) -> None:
        self.subscribe(context="zilch")
        self.enable()
        with patch.object(release_push, "can_account_access_zilch", return_value=False):
            self.assertEqual(publish_release_notice(self.notice, now=self.now), 0)
        publish_release_notice(ReleaseNotice.from_payload({**NOTES, "revision": "e" * 40}), now=self.now)
        with patch.object(release_push, "can_account_access_zilch", return_value=False), patch.object(release_push, "_send_web_push") as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            send.assert_not_called()

    def test_unconfigured_delivery_leaves_claims_pending(self) -> None:
        self.subscribe()
        self.enable()
        publish_release_notice(self.notice, now=self.now)
        with patch.object(release_push, "web_push_available", return_value=False):
            self.assertEqual(asyncio.run(dispatch_release_notifications(now=self.now)), 0)
        with session_scope() as db:
            self.assertIsNone(db.query(PushReleaseRecipient).one().claimed_at)

    def test_deleted_subscription_id_reuse_and_reregistration_never_backfill_a_release(self) -> None:
        self.subscribe()
        self.enable()
        publish_release_notice(self.notice, now=self.now)
        with session_scope() as db:
            original_id = db.query(WebPushSubscription).one().id
        remove_web_push_subscriptions(self.player.id)
        self.subscribe(suffix="replacement")
        self.enable()
        with session_scope() as db:
            self.assertEqual(db.query(WebPushSubscription).one().id, original_id)
        with patch.object(release_push, "_send_web_push") as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            send.assert_not_called()
        publish_release_notice(ReleaseNotice.from_payload({**NOTES, "revision": "f" * 40}), now=self.now)
        # Same device explicitly registered again: still no old release.
        self.subscribe(suffix="replacement")
        with patch.object(release_push, "_send_web_push") as send:
            asyncio.run(dispatch_release_notifications(now=self.now))
            send.assert_not_called()
