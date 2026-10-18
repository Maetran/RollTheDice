"""Stored-only Watten device metadata; no worker or delivery activation."""

import asyncio
import json
from dataclasses import replace
from datetime import datetime, timezone
from unittest.mock import Mock

import pytest
from sqlalchemy import func, select

from app import admin_help, api_auth, push_reminders, release_push, web_push
from app.database import session_scope
from app.models import (
    AdminHelpRecipient,
    AdminHelpRequest,
    PushRelease,
    PushReleaseRecipient,
    User,
    WebPushSubscription,
)
from app.push_reminder_copy import REMINDER_COPY
from app.release_manifest import ReleaseNotice
from tests import test_watten_runtime as native
from tests import test_web_push as fixtures

server = native.server
NOW = datetime(2026, 10, 18, 18, 59, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def configuration(monkeypatch):
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY", fixtures.TEST_VAPID_PUBLIC_KEY)
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY", "isolated-test-only")
    monkeypatch.setenv("ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT", "mailto:isolated@example.com")


def subscription(context="watten", suffix="native"):
    return fixtures.WebPushTestCase.subscription(f"https://fcm.googleapis.com/fcm/send/{suffix}").model_copy(update={"product_context": context})


def headers(owner):
    return {"Cookie": owner[1], "Origin": native.LOCAL, "X-CSRF-Token": owner[0].csrf_token,
            "X-Watten-Expected-Account-Id": str(owner[0].user_id)}


def register(server, owner, context="watten", suffix="native"):
    response = server.put("/api/web-push/subscription", headers=headers(owner), json=subscription(context, suffix).model_dump())
    assert response.status_code == 200, response.text
    return response.json()


def test_local_device_metadata_preserves_consent_reassignment_and_no_private_return(server):
    owner, other = native.account("NativeDeviceOwner"), native.account("NativeDeviceOther")
    status = register(server, owner)
    assert status["subscribed"] and not status["game_invites_enabled"] and not status["daily_reminder_enabled"]
    assert not status["release_notifications_enabled"] and "endpoint" not in status
    with session_scope() as db:
        first = db.scalars(select(WebPushSubscription)).one()
        original_id = first.id
        assert first.product_context == "watten" and first.user_id == owner[0].user_id
        user = db.get(User, owner[0].user_id)
        user.game_invite_push_enabled = user.daily_reminder_push_enabled = user.release_push_enabled = True
    status = register(server, owner)
    assert status["game_invites_enabled"] and status["daily_reminder_enabled"] and status["release_notifications_enabled"]
    register(server, other)
    with session_scope() as db:
        device = db.scalars(select(WebPushSubscription)).one()
        assert device.id == original_id and device.product_context == "watten" and device.user_id == other[0].user_id
        assert db.get(User, owner[0].user_id).daily_reminder_push_enabled  # No implicit preference transfer/reset.
        assert not db.get(User, other[0].user_id).daily_reminder_push_enabled
        db.delete(db.get(User, other[0].user_id))
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WebPushSubscription)) == 0


@pytest.mark.parametrize(("site", "host", "flag"), (
    (native.LOCAL, "localhost:8127", "0"), ("https://zockdiewandan.online", "localhost:8127", "1"),
    (native.LOCAL, "zockdiewandan.online", "1"), (native.LOCAL, "watten.zockdiewandan.online", "1"),
    (native.LOCAL, "localhost.evil.invalid", "1"), (native.LOCAL, "localhost:8127, evil.invalid", "1"),
))
def test_closed_context_rejected_before_auth_and_subscription_db(server, monkeypatch, site, host, flag):
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", site)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", flag)
    monkeypatch.setattr(api_auth, "require_user", lambda *_args: pytest.fail("closed native device resolved auth"))
    response = server.put("/api/web-push/subscription", headers={"Host": host, "X-Forwarded-Host": "localhost:8127"},
                          json=subscription().model_dump())
    assert response.status_code in {404, 503}


def test_binding_csrf_duplicate_hosts_and_strict_internal_context_never_fall_back(server):
    owner, other = native.account("PushMountedA"), native.account("PushCookieB")
    body = subscription().model_dump()
    assert server.put("/api/web-push/subscription", headers={**headers(other),
        "X-Watten-Expected-Account-Id": str(owner[0].user_id)}, json=body).status_code == 409
    assert server.put("/api/web-push/subscription", headers={**headers(owner), "X-CSRF-Token": "bad"}, json=body).status_code == 403
    duplicate = list(headers(owner).items()) + [("X-Watten-Expected-Account-Id", str(owner[0].user_id))]
    assert server.put("/api/web-push/subscription", headers=duplicate, json=body).status_code == 409
    duplicate = list(headers(owner).items()) + [("Host", "localhost:8127"), ("Host", "evil.invalid")]
    assert server.put("/api/web-push/subscription", headers=duplicate, json=body).status_code == 404
    assert server.put("/api/web-push/subscription", headers=headers(owner), json={**body, "product_context": "unknown"}).status_code == 422
    for context, connection, error in (("watten", None, "unavailable"), ("unknown", None, "invalid"), ("zdwa", None, "invalid")):
        with pytest.raises(ValueError, match=error):
            web_push.save_web_push_subscription(user_id=owner[0].user_id, payload=subscription(),
                                                product_context=context, connection=connection)
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WebPushSubscription)) == 0


def test_staged_devices_never_enter_invites_daily_claims_or_the_central_transport(server, monkeypatch):
    owner = native.account("StoredOnlyPush")
    register(server, owner)
    with session_scope() as db:
        user = db.get(User, owner[0].user_id)
        user.game_invite_push_enabled = user.daily_reminder_push_enabled = user.release_push_enabled = True
        device = db.scalars(select(WebPushSubscription)).one()
        stored = web_push.StoredSubscription(device.id, user.id, device.endpoint, device.p256dh, device.auth, "watten", "de")
    assert "watten" in web_push.PUSH_DEVICE_CONTEXTS and "watten" not in web_push.PUSH_DELIVERY_CONTEXTS
    assert web_push.game_invite_push_recipients({"_game_type": "zdwa", "_players": []}) == []
    assert web_push.game_invite_push_recipients({"_game_type": "watten", "_players": []}) == []
    assert push_reminders.claim_daily_reminder(owner[0].user_id, NOW) is None
    send = Mock(side_effect=AssertionError("No external delivery in this stage"))
    monkeypatch.setattr(push_reminders, "_send_web_push", send)
    assert asyncio.run(push_reminders.dispatch_daily_reminders(now=NOW)) == 0
    send.assert_not_called()
    import pywebpush

    monkeypatch.setattr(pywebpush, "webpush", send)
    assert web_push._send_web_push(stored, {"title": "Never sent"}) == (False, False)
    send.assert_not_called()
    with session_scope() as db:
        user = db.get(User, owner[0].user_id)
        assert user.daily_reminder_push_last_sent_on is None and user.daily_reminder_push_sequence == 0


def test_newest_staged_device_does_not_displace_legacy_release_or_admin_help_audiences(server, monkeypatch):
    admin, requester = native.account("ExistingPushAdmin", role="admin"), native.account("ExistingHelpRequester")
    register(server, admin, "zdwa", "working-device")
    register(server, admin, "watten", "newer-staged-device")
    with session_scope() as db:
        db.get(User, admin[0].user_id).release_push_enabled = True
        legacy = db.scalar(select(WebPushSubscription).where(WebPushSubscription.product_context == "zdwa"))
        legacy_id = legacy.id
        request = AdminHelpRequest(id="a" * 32, requester_user_id=requester[0].user_id,
                                   game_id="unchanged-help", game_type="zdwa", game_name="Existing table", created_at=NOW)
        db.add(request)
        db.flush()
        admin_help._freeze_recipients(db, request)
        receipt = db.get(AdminHelpRecipient, (request.id, admin[0].user_id))
        assert [item["id"] for item in json.loads(receipt.subscription_snapshot_json)] == [legacy_id]
    notice = ReleaseNotice.from_payload({"revision": "b" * 40, "kind": "backend", "games": ["zdwa"]})
    assert release_push.publish_release_notice(replace(notice, games=("zdwa", "watten")), now=NOW) == 1
    with session_scope() as db:
        receipt = db.get(PushReleaseRecipient, (notice.revision, admin[0].user_id))
        assert receipt.product_context == "zdwa"
        assert [item["id"] for item in json.loads(receipt.subscription_snapshot_json)] == [legacy_id]
        # Even a pre-existing future/native outbox row is retained unclaimed.
        db.add(PushRelease(revision="c" * 40, kind="backend", game_types_json='["watten"]',
                           summary_de="Nicht senden", summary_en="Do not send", published_at=NOW))
        db.flush()
        db.add(PushReleaseRecipient(revision="c" * 40, user_id=admin[0].user_id, product_context="watten", subscription_snapshot_json="[]"))
    send = Mock(return_value=(True, False))
    monkeypatch.setattr(release_push, "_send_web_push", send)
    assert asyncio.run(release_push.dispatch_release_notifications(now=NOW)) == 1
    assert send.call_count == 1 and send.call_args.args[0].product_context == "zdwa"
    with session_scope() as db:
        assert db.get(PushReleaseRecipient, ("c" * 40, admin[0].user_id)).claimed_at is None


def test_pure_four_product_rotation_and_all_watten_payloads_have_own_bilingual_copy_and_targets():
    contexts = ("watten", "hausdepp", "zdwa", "zilch")
    for user in (1, 8):
        choices = [push_reminders.reminder_choice(user, sequence, contexts) for sequence in range(128)]
        assert all({game for game, _variant in choices[offset:offset + 4]} == set(contexts) for offset in range(0, 128, 4))
        assert {variant for game, variant in choices if game == "watten"} == set(range(32))
    assert len(REMINDER_COPY["watten"]) == 32
    assert len({de for de, _en in REMINDER_COPY["watten"]}) == len({en for _de, en in REMINDER_COPY["watten"]}) == 32
    for number, (de, en) in enumerate(REMINDER_COPY["watten"]):
        assert de and en and de != en and max(len(de), len(en)) <= 160
        for language, copy in (("de", de), ("en", en)):
            payload = push_reminders.reminder_payload(push_reminders.DailyReminder(1, NOW.date(), "watten", language, number, ()))
            assert payload["url"] == "/watten" and payload["body"] == copy
            assert payload["icon"] == payload["badge"] == "/static/watten/icons/watten-icon-192.png"
            assert "Watten" in payload["title"]
    for invalid in ((), ("unknown",), "watten", iter(("watten",))):
        with pytest.raises(ValueError, match="invalid"):
            push_reminders.reminder_choice(1, 0, invalid)
    game = {"_id": "d" * 16, "_game_type": "watten", "_players": [{"name": "Selected human"}]}
    stored = web_push.StoredSubscription(1, 1, "unused", "unused", "unused", "watten", "de")
    assert web_push.game_invite_destinations(game, [stored]) == [(stored, f"/watten/spiel/{game['_id']}")]
    for language in ("de", "en"):
        invitation = web_push.game_invite_notification_payload(game=game, destination=f"/watten/spiel/{game['_id']}", language=language, product_context="watten")
        assert "Watten" in invitation["title"] and invitation["icon"] == "/static/watten/icons/watten-icon-192.png"
        release = PushRelease(revision="e" * 40, summary_de="Neu", summary_en="New", player_notes_json="{}")
        payload = release_push.release_notification_payload(release, "watten", language)
        assert "Watten" in payload["title"] and payload["url"] == "/watten" and payload["icon"] == invitation["icon"]
