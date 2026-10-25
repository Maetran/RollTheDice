"""An already authenticated Push request cannot write a retired account."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import delete, select
from starlette.requests import Request

from app import api_auth, main, web_push
from app.auth import create_user, login, resolve_session
from app.database import configure_database, session_scope, upgrade_database
from app.models import (
    AccountMergeOperation,
    AccountProgressOrigin,
    PushInviteAllowedSender,
    Session,
    User,
    WebPushSubscription,
)
from tests import test_web_push as push_fixtures

PRODUCTS = ("zdwa", "zilch", "hausdepp", "watten")
MUTATIONS = ("save", "preferences", "remove", "prompt")


@pytest.fixture
def store(tmp_path):
    with patch.dict("os.environ", {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/push-retirement.sqlite",
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        "ROLLTHEDICE_SITE_ORIGIN": "https://zockdiewandan.online",
        "ROLLTHEDICE_WATTEN_PUBLIC_BETA": "1",
        "ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY": push_fixtures.TEST_VAPID_PUBLIC_KEY,
        "ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY": "isolated-test-only",
        "ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT": "mailto:isolated@example.com",
    }):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        source = create_user("RetiringPush", "test-password-123", must_change_password=False)
        target = create_user("KeepingPush", "test-password-123", must_change_password=False)
        identity, token = login(push_fixtures.request_for(token="none", csrf="none"),
                                source.username, "test-password-123")
        for user in (source, target):
            web_push.save_web_push_subscription(user_id=user.id, payload=subscription(user.id), product_context="zdwa")
        with session_scope() as db:
            user = db.get(User, target.id)
            user.release_push_enabled = True
            user.voice_listening_default = True
            db.add(PushInviteAllowedSender(recipient_user_id=target.id, sender_user_id=source.id,
                                          created_at=datetime.now(timezone.utc)))
        try:
            yield SimpleNamespace(source=source, target=target, identity=identity, token=token)
        finally:
            configure_database(main.DATA_DIR)


def subscription(user_id, product="zdwa"):
    return push_fixtures.WebPushTestCase.subscription(f"https://fcm.googleapis.com/fcm/send/retirement-{user_id}").model_copy(
        update={"product_context": product})


def retire(store):
    """Commit only the identity/device part of the future merge contract."""
    now = datetime.now(timezone.utc)
    with session_scope() as db:
        db.add(AccountMergeOperation(id="a" * 32, actor_user_id=store.target.id,
                                    source_user_id=store.source.id, target_user_id=store.target.id,
                                    idempotency_key="push-race", preview_fingerprint="b" * 64,
                                    created_at=now, summary_json="{}"))
        db.flush()
        db.get(User, store.source.id).is_active = False
        db.add(AccountProgressOrigin(origin_user_id=store.source.id, owner_user_id=store.target.id,
                                     operation_id="a" * 32))
        db.execute(delete(Session).where(Session.user_id == store.source.id))
        db.execute(delete(WebPushSubscription).where(WebPushSubscription.user_id == store.source.id))


def state():
    with session_scope() as db:
        users = [(user.id, user.is_active, user.game_invite_push_enabled, user.daily_reminder_push_enabled,
                  user.release_push_enabled, user.game_invite_push_audience, user.push_opt_in_prompted_at,
                  user.voice_listening_default, user.updated_at)
                 for user in db.scalars(select(User).order_by(User.id))]
        devices = [(device.id, device.user_id, device.endpoint, device.product_context, device.updated_at)
                   for device in db.scalars(select(WebPushSubscription).order_by(WebPushSubscription.id))]
        senders = [(row.recipient_user_id, row.sender_user_id, row.created_at)
                   for row in db.scalars(select(PushInviteAllowedSender))]
        return users, devices, senders


def actor_request(store, product):
    host = {"zdwa": "zockdiewandan.online", "zilch": "zilch.zockdiewandan.online",
            "hausdepp": "hausdepp.zockdiewandan.online", "watten": "watten.zockdiewandan.online"}[product]
    return Request({
        "type": "http", "method": "PUT", "scheme": "https", "path": "/api/web-push/subscription",
        "headers": [(b"host", host.encode()), (b"origin", f"https://{host}".encode()),
                    (b"cookie", f"rollthedice_session={store.token}".encode()),
                    (b"x-csrf-token", store.identity.csrf_token.encode()),
                    (b"x-push-expected-account-id", str(store.source.id).encode())],
        "client": ("127.0.0.1", 1234), "server": (host, 443),
    })


def invoke_api(store, operation, request, product):
    if operation == "save":
        return api_auth.web_push_subscription_put(subscription(store.source.id, product), request)
    if operation == "preferences":
        return api_auth.web_push_preferences_put(web_push.WebPushPreferencesRequest(
            game_invites_enabled=True, daily_reminder_enabled=True, release_notifications_enabled=True,
            game_invite_audience="allowlist", allowed_sender_usernames=[store.target.username]), request)
    if operation == "remove":
        return api_auth.web_push_subscription_delete(request)
    return api_auth.web_push_opt_in_prompt_post(request, Response())


@pytest.mark.parametrize("product", PRODUCTS)
@pytest.mark.parametrize("operation", MUTATIONS)
def test_preauthenticated_request_cannot_write_after_committed_retirement(store, monkeypatch, product, operation):
    request = actor_request(store, product)
    retained = []
    actual_require = api_auth.require_user

    def authenticated(connection):
        identity = actual_require(connection)
        retained.append(identity)
        return identity

    monkeypatch.setattr(api_auth, "require_user", authenticated)
    name = {"save": "save_web_push_subscription", "preferences": "update_web_push_preferences",
            "remove": "remove_web_push_subscriptions", "prompt": "claim_web_push_opt_in_prompt"}[operation]
    mutation = getattr(api_auth, name)
    after_retirement = []

    def delayed(*args, **kwargs):
        assert retained and retained[0].user_id == store.source.id
        retire(store)
        assert resolve_session(request) is None
        # The already returned AuthIdentity still names the source. It must
        # never redirect this delayed mutation to the progress beneficiary.
        assert retained[0].user_id == store.source.id
        after_retirement.append(state())
        return mutation(*args, **kwargs)

    monkeypatch.setattr(api_auth, name, delayed)
    if operation == "prompt":
        # Prompt suppression retains its existing inactive-account response;
        # it must not reserve a new timestamp using the retained identity.
        assert invoke_api(store, operation, request, product) == {"show": False, "interval_days": 14}
    else:
        with pytest.raises(HTTPException) as rejected:
            invoke_api(store, operation, request, product)
        assert rejected.value.status_code == 404
        assert rejected.value.detail == "user_not_found"
    assert len(retained) == 1 and len(after_retirement) == 1
    assert state() == after_retirement[0]


@pytest.mark.parametrize("product", PRODUCTS)
def test_write_committed_before_retirement_is_revoked_without_transferring_target_consent(store, product):
    request = actor_request(store, product)
    original_target = state()[0][1], state()[1][1], state()[2]
    invoke_api(store, "save", request, product)
    with session_scope() as db:
        device = db.scalar(select(WebPushSubscription).where(WebPushSubscription.user_id == store.source.id))
        assert device.product_context == product
    retire(store)
    current = state()
    assert [device[1] for device in current[1]] == [store.target.id]
    assert (current[0][1], current[1][0], current[2]) == original_target
    assert resolve_session(request) is None


@pytest.mark.parametrize("operation", MUTATIONS)
def test_retired_origin_marker_blocks_writes_even_if_active_flag_is_incorrectly_restored(store, operation):
    retire(store)
    with session_scope() as db:
        db.get(User, store.source.id).is_active = True
    before = state()
    with pytest.raises(HTTPException) as rejected:
        invoke_api(store, operation, actor_request(store, "zdwa"), "zdwa")
    # Session revocation is the normal outer boundary. Exercise the independent
    # write guard with the retained, previously authenticated actor as well.
    assert rejected.value.status_code == 401
    if operation == "prompt":
        assert web_push.claim_web_push_opt_in_prompt(store.source.id) == {"show": False, "interval_days": 14}
    else:
        with pytest.raises(LookupError, match="user_not_found"):
            if operation == "save":
                web_push.save_web_push_subscription(user_id=store.source.id, payload=subscription(store.source.id),
                                                    product_context="zdwa")
            elif operation == "preferences":
                web_push.update_web_push_preferences(store.source.id, web_push.WebPushPreferencesRequest(
                    game_invites_enabled=False, daily_reminder_enabled=False))
            else:
                web_push.remove_web_push_subscriptions(store.source.id)
    assert state() == before
