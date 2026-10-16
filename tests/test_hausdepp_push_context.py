"""Installed Hausdepp devices keep their identity through shared settings."""

from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from alembic.config import Config
from pydantic import ValidationError
from sqlalchemy import select, text
from starlette.requests import Request

from alembic import command
from app import main
from app.api_auth import web_push_subscription_put
from app.auth import create_user, login
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.models import HausdeppPresentationReceipt, PushRelease, PushReleaseRecipient, User, WebPushSubscription
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
