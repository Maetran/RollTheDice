"""Installed Hausdepp devices keep their identity through shared settings."""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from alembic.config import Config
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import select, text
from starlette.requests import Request

from alembic import command
from app import api_auth, main, release_push
from app.api_auth import web_push_subscription_put
from app.auth import create_user, login
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.models import HausdeppPresentationReceipt, PushRelease, PushReleaseRecipient, User, WebPushSubscription
from app.release_manifest import ReleaseNotice
from app.security import utcnow
from app.web_push import WebPushSubscriptionRequest, save_web_push_subscription
from tests import test_web_push as push_fixtures


@pytest.fixture
def device_store(tmp_path):
    url = f"sqlite:///{tmp_path}/house-device.sqlite3"
    with patch.dict(os.environ, {
        "ROLLTHEDICE_DATABASE_URL": url,
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        "ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY": push_fixtures.TEST_VAPID_PUBLIC_KEY,
        "ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY": "isolated-test-key",
        "ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT": "mailto:test@example.com",
    }):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        user = create_user("HouseDevice", "test-password-123", must_change_password=False)
        identity, token = login(push_fixtures.request_for(token="none", csrf="none"), user.username, "test-password-123")
        yield SimpleNamespace(user=user, identity=identity, token=token, url=url)
    configure_database(main.DATA_DIR)


def request_for_device(store, host):
    return Request({
        "type": "http", "method": "PUT", "scheme": "https", "path": "/api/web-push/subscription",
        "headers": [(b"host", host.encode()), (b"cookie", f"rollthedice_session={store.token}".encode()),
                    (b"x-csrf-token", store.identity.csrf_token.encode())],
        "client": ("127.0.0.1", 1234), "server": (host, 443),
    })


@asynccontextmanager
async def quiet_device_lifespan(_app):
    yield


@pytest.fixture
def device_client(device_store, monkeypatch):
    monkeypatch.setattr(main.app.router, "lifespan_context", quiet_device_lifespan)
    with TestClient(main.app, base_url="https://hausdepp.zockdiewandan.online") as client:
        client.headers.update({
            "Cookie": f"rollthedice_session={device_store.token}",
            "Origin": "https://hausdepp.zockdiewandan.online",
            "X-CSRF-Token": device_store.identity.csrf_token,
            "X-Push-Expected-Account-Id": str(device_store.user.id),
        })
        yield client


def house_subscription():
    return push_fixtures.WebPushTestCase.subscription().model_copy(update={"product_context": "hausdepp"})


def device_rows():
    with get_engine().connect() as connection:
        return {table: connection.execute(text(f"SELECT * FROM {table}")).fetchall()
                for table in ("users", "web_push_subscriptions", "push_releases", "push_release_recipients")}


@pytest.mark.parametrize("mismatch", (None, "user", "context", "endpoint", "p256dh", "auth"))
def test_device_probe_matches_only_this_accounts_exact_registration_without_writes(device_store, device_client, monkeypatch, mismatch):
    payload = house_subscription()
    owner = device_store.user.id
    context = "hausdepp"
    if mismatch == "user":
        owner = create_user("OtherProbeOwner", "test-password-123", must_change_password=False).id
    if mismatch == "context":
        context = "zdwa"
    registered = payload.model_copy(update={"product_context": context})
    save_web_push_subscription(user_id=owner, payload=registered, product_context=context)
    with session_scope() as db:
        db.get(User, device_store.user.id).release_push_enabled = True
    body = payload.model_dump()
    if mismatch == "endpoint":
        body["endpoint"] += "-missing"
    if mismatch in {"p256dh", "auth"}:
        body["keys"][mismatch] = push_fixtures._base64url(
            b"\x04" + b"\x09" * 64 if mismatch == "p256dh" else b"\x09" * 16)
    before = device_rows()
    monkeypatch.setattr(api_auth, "record_engagement_safely", lambda *_args: pytest.fail("probe recorded engagement"))
    response = device_client.post("/api/web-push/subscription/check", json=body)
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    result = response.json()
    assert result["viewer_id"] == device_store.user.id
    assert result["device_subscribed"] is (mismatch is None)
    assert result["subscribed"] is (mismatch != "user")
    assert result["release_notifications_enabled"] is (mismatch != "user")
    assert not ({"endpoint", "keys", "p256dh", "auth", "product_context", "user_id"} & result.keys())
    assert device_rows() == before


def test_missing_device_probe_neither_registers_nor_needs_delivery_configuration(device_client):
    before = device_rows()
    with patch("app.web_push.web_push_config", return_value=SimpleNamespace(enabled=False, public_key="")):
        response = device_client.post("/api/web-push/subscription/check", json=house_subscription().model_dump())
    assert response.status_code == 200, response.text
    assert response.json()["device_subscribed"] is False
    assert response.json()["available"] is False
    assert device_rows() == before


@pytest.mark.parametrize("failure,expected", (("guest", 401), ("csrf", 403), ("origin", 403),
    ("account", 409), ("duplicate_account", 409), ("missing_context", 400), ("invalid_keys", 400), ("watten", 404)))
def test_device_probe_enforces_access_and_explicit_context(device_store, device_client, monkeypatch, failure, expected):
    body = house_subscription().model_dump()
    if failure == "guest":
        device_client.headers["Cookie"] = "rollthedice_session=missing"
    elif failure == "csrf":
        device_client.headers["X-CSRF-Token"] = "wrong"
    elif failure == "origin":
        device_client.headers["Origin"] = "https://untrusted.invalid"
    elif failure == "account":
        device_client.headers["X-Push-Expected-Account-Id"] = str(device_store.user.id + 1)
    elif failure == "duplicate_account":
        del device_client.headers["X-Push-Expected-Account-Id"]
    elif failure == "missing_context":
        del body["product_context"]
    elif failure == "invalid_keys":
        body["keys"]["auth"] = "invalid"
    elif failure == "watten":
        body["product_context"] = "watten"
        monkeypatch.setattr("app.watten_access.watten_request_enabled", lambda *_args: False)
        monkeypatch.setattr(api_auth, "require_user", lambda *_args: pytest.fail("closed Watten resolved auth"))
    headers = ([('X-Push-Expected-Account-Id', str(device_store.user.id))] * 2
               if failure == "duplicate_account" else None)
    before = device_rows()
    response = device_client.post("/api/web-push/subscription/check", json=body, headers=headers)
    assert response.status_code == expected, response.text
    assert response.headers["cache-control"] == "no-store"
    assert device_rows() == before


@pytest.mark.parametrize("header", ("wrong", "duplicate"))
def test_explicit_registration_rejects_a_switched_or_ambiguous_account(device_store, device_client, header):
    del device_client.headers["X-Push-Expected-Account-Id"]
    expected = str(device_store.user.id + 1) if header == "wrong" else str(device_store.user.id)
    headers = [("X-Push-Expected-Account-Id", expected)] * (2 if header == "duplicate" else 1)
    response = device_client.put("/api/web-push/subscription", json=house_subscription().model_dump(), headers=headers)
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "web_push_account_changed"
    assert response.headers["cache-control"] == "no-store"
    with session_scope() as db:
        assert db.scalars(select(WebPushSubscription)).first() is None


@pytest.mark.parametrize("legacy_root", (False, True))
def test_identical_registration_preserves_timestamps_and_frozen_pending_release(device_store, device_client, legacy_root):
    payload = house_subscription()
    registered = device_client.put("/api/web-push/subscription", json=payload.model_dump())
    assert registered.status_code == 200, registered.text
    assert registered.json()["device_subscribed"] is True
    with session_scope() as db:
        db.get(User, device_store.user.id).release_push_enabled = True
    notice = ReleaseNotice.from_payload({
        "revision": "c" * 40, "kind": "backend", "games": ["hausdepp"],
    })
    assert release_push.publish_release_notice(notice) == 1
    before = device_rows()
    body = payload.model_dump()
    target = "/api/web-push/subscription"
    headers = {}
    if legacy_root:
        del body["product_context"]
        target = "https://zockdiewandan.online/api/web-push/subscription"
        headers["Origin"] = "https://zockdiewandan.online"
    with patch("app.web_push.utcnow", return_value=utcnow() + timedelta(minutes=2)):
        registered = device_client.put(target, json=body, headers=headers)
    assert registered.status_code == 200, registered.text
    assert device_rows() == before
    with patch.object(release_push, "_send_web_push", return_value=(True, False)) as send:
        assert asyncio.run(release_push.dispatch_release_notifications()) == 1
        send.assert_called_once()


def test_legacy_hausdepp_host_keeps_known_root_context_until_explicit_repair(device_store, device_client):
    payload = house_subscription().model_copy(update={"product_context": "zdwa"})
    root = "https://zockdiewandan.online/api/web-push/subscription"
    result = device_client.put(root, json=payload.model_dump(), headers={"Origin": "https://zockdiewandan.online"})
    assert result.status_code == 200, result.text
    before = device_rows()
    legacy = payload.model_dump(exclude={"product_context"})
    result = device_client.put("/api/web-push/subscription", json=legacy)
    assert result.status_code == 200, result.text
    assert device_rows() == before
    result = device_client.put("/api/web-push/subscription", json=house_subscription().model_dump())
    assert result.status_code == 200, result.text
    with session_scope() as db:
        assert db.scalars(select(WebPushSubscription)).one().product_context == "hausdepp"


def test_legacy_account_change_does_not_inherit_the_previous_owners_context(device_store, device_client):
    other = create_user("LegacyDeviceOwner", "test-password-123", must_change_password=False)
    payload = house_subscription()
    save_web_push_subscription(user_id=other.id, payload=payload, product_context="hausdepp")
    result = device_client.put("https://zockdiewandan.online/api/web-push/subscription",
        json=payload.model_dump(exclude={"product_context"}), headers={"Origin": "https://zockdiewandan.online"})
    assert result.status_code == 200, result.text
    with session_scope() as db:
        device = db.scalars(select(WebPushSubscription)).one()
        assert (device.user_id, device.product_context) == (device_store.user.id, "zdwa")


def test_legacy_root_context_cannot_reclassify_a_stored_watten_device(device_store, device_client):
    payload = house_subscription()
    save_web_push_subscription(user_id=device_store.user.id, payload=payload, product_context="hausdepp")
    with session_scope() as db:
        db.scalars(select(WebPushSubscription)).one().product_context = "watten"
    before = device_rows()
    result = device_client.put("https://zockdiewandan.online/api/web-push/subscription",
        json=payload.model_dump(exclude={"product_context"}), headers={"Origin": "https://zockdiewandan.online"})
    assert result.status_code == 400, result.text
    assert result.json()["detail"] == "web_push_context_unavailable"
    assert device_rows() == before


def test_consentless_identical_put_keeps_prompt_and_user_timestamps(device_store, device_client):
    payload = house_subscription()
    assert device_client.put("/api/web-push/subscription", json=payload.model_dump()).status_code == 200
    before = device_rows()
    with patch("app.web_push.utcnow", return_value=utcnow() + timedelta(minutes=2)):
        assert device_client.put("/api/web-push/subscription", json=payload.model_dump()).status_code == 200
    assert device_rows() == before


def test_explicit_put_still_repairs_context_and_keys(device_store, device_client):
    payload = house_subscription()
    original = payload.model_copy(update={"product_context": "zdwa"}, deep=True)
    original.keys.auth = push_fixtures._base64url(b"\x09" * 16)
    save_web_push_subscription(user_id=device_store.user.id, payload=original, product_context="zdwa")
    with session_scope() as db:
        previous = db.scalars(select(WebPushSubscription)).one()
        previous_id, previous_time = previous.id, previous.updated_at
    response = device_client.put("/api/web-push/subscription", json=payload.model_dump())
    assert response.status_code == 200, response.text
    with session_scope() as db:
        current = db.scalars(select(WebPushSubscription)).one()
        assert current.id == previous_id
        assert current.product_context == "hausdepp" and current.auth == payload.keys.auth
        assert current.updated_at > previous_time


@pytest.mark.parametrize("host,hint,expected", [
    ("hausdepp.zockdiewandan.online", None, "hausdepp"),
    ("zockdiewandan.online", None, "zdwa"),
    ("zilch.zockdiewandan.online", None, "zilch"),
    ("zockdiewandan.online", "hausdepp", "hausdepp"),
    ("zilch.zockdiewandan.online", "hausdepp", "hausdepp"),
])
def test_device_context_uses_installed_identity_without_enabling_message_categories(device_store, host, hint, expected):
    payload = push_fixtures.WebPushTestCase.subscription()
    if hint:
        payload.product_context = hint
    status = web_push_subscription_put(payload, request_for_device(device_store, host))
    assert status["subscribed"] is True
    assert status["game_invites_enabled"] is False
    assert status["daily_reminder_enabled"] is False
    assert status["release_notifications_enabled"] is False
    assert "endpoint" not in status
    with session_scope() as db:
        device = db.scalars(select(WebPushSubscription)).one()
        assert device.product_context == expected
        assert device.user_id == device_store.user.id


def test_endpoint_reassignment_moves_context_and_owner_without_a_duplicate(device_store):
    payload = push_fixtures.WebPushTestCase.subscription()
    save_web_push_subscription(user_id=device_store.user.id, payload=payload, product_context="hausdepp")
    other = create_user("OtherDeviceOwner", "test-password-123", must_change_password=False)
    save_web_push_subscription(user_id=other.id, payload=payload, product_context="zilch")
    with session_scope() as db:
        device = db.scalars(select(WebPushSubscription)).one()
        assert (device.user_id, device.product_context) == (other.id, "zilch")


def test_unknown_client_product_context_is_rejected_before_storage():
    payload = push_fixtures.WebPushTestCase.subscription().model_dump()
    with pytest.raises(ValidationError):
        WebPushSubscriptionRequest(**{**payload, "product_context": "external"})


def migration_config(url):
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", url)
    return config


def test_upgrade_preserves_existing_devices_frozen_release_receipts_and_account_progress(device_store):
    config = migration_config(device_store.url)
    command.downgrade(config, "20261016_0058")
    payload = push_fixtures.WebPushTestCase.subscription()
    save_web_push_subscription(user_id=device_store.user.id, payload=payload, product_context="zdwa")
    with session_scope() as db:
        device_id = db.scalars(select(WebPushSubscription.id)).one()
        db.add(PushRelease(revision="a" * 40, version="2.52.0", kind="usability", summary_de="Alt", summary_en="Old",
                           game_types_json='["zdwa"]', published_at=utcnow(), player_notes_json="{}"))
        db.flush()
        db.add(PushReleaseRecipient(revision="a" * 40, user_id=device_store.user.id, product_context="zdwa",
                                   subscription_snapshot_json=f'[{{"id":{device_id},"identity":"kept"}}]'))
        db.add(HausdeppPresentationReceipt(user_id=device_store.user.id, acknowledged_points=20,
                                          acknowledged_score_points=12, presentation_scores_json='{"20":12}'))
    tables = ("users", "sessions", "web_push_subscriptions", "push_releases", "push_release_recipients",
              "hausdepp_presentation_receipts")
    with get_engine().connect() as connection:
        before = {table: connection.execute(text(f"SELECT * FROM {table}")).fetchall() for table in tables}
    command.upgrade(config, "head")
    with get_engine().connect() as connection:
        after = {table: connection.execute(text(f"SELECT * FROM {table}")).fetchall() for table in tables}
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
    assert before == after
    save_web_push_subscription(user_id=device_store.user.id, payload=payload, product_context="hausdepp")
    with session_scope() as db:
        assert db.get(WebPushSubscription, device_id).product_context == "hausdepp"
        receipt = db.get(PushReleaseRecipient, ("a" * 40, device_store.user.id))
        receipt.product_context = "hausdepp"
        assert db.get(User, device_store.user.id).username == "HouseDevice"


def test_downgrade_refuses_to_discard_hausdepp_device_identity(device_store):
    payload = push_fixtures.WebPushTestCase.subscription()
    save_web_push_subscription(user_id=device_store.user.id, payload=payload, product_context="hausdepp")
    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        command.downgrade(migration_config(device_store.url), "20261016_0058")
    with session_scope() as db:
        assert db.scalars(select(WebPushSubscription.product_context)).one() == "hausdepp"
