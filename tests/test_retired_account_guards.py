"""Retirement cannot be undone through login or existing administration."""
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app import api_auth, auth
from app.api_auth import AdminPasswordResetRequest, AdminUserUpdateRequest
from app.database import session_scope
from app.models import Session, User
from app.security import hash_password, hash_session_token, utcnow
from tests import test_account_merge_identity as identity_fixtures
from tests import test_push_account_retirement as push_fixtures

store = push_fixtures.store


def retire(store):
    with session_scope() as db:
        source, target = identity_fixtures.mapped(db, store.source.id, store.target.id)
        identity_fixtures.invoke(db, source, target)


def test_password_verified_before_retirement_cannot_issue_a_new_session(store, monkeypatch):
    verify = auth.verify_password

    def verified_then_retired(password, encoded):
        result = verify(password, encoded)
        retire(store)
        return result

    monkeypatch.setattr(auth, "verify_password", verified_then_retired)
    with pytest.raises(HTTPException) as denied:
        auth.login(push_fixtures.actor_request(store, "zdwa"), store.source.username, "test-password-123")
    assert denied.value.detail == "invalid_credentials"
    with session_scope() as db:
        assert db.scalar(select(Session).where(Session.user_id == store.source.id)) is None
        assert not db.get(User, store.source.id).is_active


def test_final_session_guard_keeps_stale_dirty_user_from_overwriting_retirement(store):
    with session_scope() as db:
        stale = db.get(User, store.source.id)
        retire(store)
        stale.password_hash = hash_password("stale-uncommitted-password")
        with pytest.raises(HTTPException) as denied:
            auth.issue_session_for_user(db, stale)
        assert denied.value.status_code == 401
        db.rollback()
    with session_scope() as db:
        assert db.get(User, store.source.id).password_hash == identity_fixtures.PASSWORDLESS_HASH
        assert db.scalar(select(Session).where(Session.user_id == store.source.id)) is None


def test_new_uncommitted_signup_keeps_intentional_handle_and_can_create_its_first_session(store):
    with session_scope() as db:
        user = auth.create_user_in_session(db, "NewAtomicSignup", None, must_change_password=False)
        user.webauthn_user_handle = b"n" * 32
        user.preferred_language = "en"
        identity, _token = auth.issue_session_for_user(db, user)
        assert identity.user_id == user.id and identity.preferred_language == "en"
    with session_scope() as db:
        assert db.get(User, identity.user_id).webauthn_user_handle == b"n" * 32
        assert db.scalar(select(Session).where(Session.user_id == identity.user_id)) is not None


def test_admin_mutations_and_private_capabilities_keep_source_permanently_retired(store):
    moderator = auth.create_user("RetirementModerator", "test-password-123", role="admin", must_change_password=False)
    identity, token = auth.login(push_fixtures.actor_request(store, "zdwa"), moderator.username, "test-password-123")
    admin_request = push_fixtures.actor_request(SimpleNamespace(source=moderator, identity=identity, token=token), "zdwa")
    retire(store)
    for payload in (AdminUserUpdateRequest(is_active=True), AdminUserUpdateRequest(role="admin"),
                    AdminUserUpdateRequest(lobby_chat_muted=False), AdminUserUpdateRequest(lobby_chat_excluded=False)):
        with pytest.raises(HTTPException) as denied:
            api_auth.admin_update_user(store.source.id, payload, admin_request)
        assert denied.value.status_code == 409 and denied.value.detail == "account_merged"
    with pytest.raises(HTTPException) as denied:
        api_auth.admin_reset_password(store.source.id,
                                     AdminPasswordResetRequest(temporary_password="reset-after-retirement"), admin_request)
    assert denied.value.detail == "account_merged"
    with pytest.raises(HTTPException) as denied:
        api_auth.admin_grant_ownership(store.source.id, admin_request)
    assert denied.value.detail == "account_merged"
    users = api_auth.admin_list_users(admin_request)["users"]
    source = next(user for user in users if user["id"] == store.source.id)
    assert source["is_merged"] and not source["is_active"]
    assert all(value is False for key, value in source.items() if key.startswith("can_"))


def test_retired_marker_blocks_session_resolution_even_after_an_incorrect_raw_restore(store):
    retire(store)
    with session_scope() as db:
        user = db.get(User, store.source.id)
        user.is_active = True
        db.add(Session(user_id=user.id, token_hash=hash_session_token(store.token), csrf_token=store.identity.csrf_token,
                       created_at=utcnow(), last_seen_at=utcnow(), expires_at=utcnow() + timedelta(days=30)))
    with session_scope() as db:
        user = db.get(User, store.source.id)
        assert user.is_active
        with pytest.raises(HTTPException) as denied:
            auth.issue_session_for_user(db, user)
        assert denied.value.status_code == 401
        db.rollback()
    assert auth.resolve_session(push_fixtures.actor_request(store, "zdwa")) is None
