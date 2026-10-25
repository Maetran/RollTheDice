"""Identity retirement remains caller-transactional and preserves provenance."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.account_merge_identity import retire_source_identity_in_session
from app.account_progress import ProgressIdentityError, lock_account_rows
from app.auth import create_user, login, resolve_session
from app.database import session_scope
from app.models import (
    AccountEmailToken,
    AccountMergeOperation,
    AccountProgressOrigin,
    AdminHelpRecipient,
    AdminHelpRequest,
    PasskeyCredential,
    PushRelease,
    PushReleaseRecipient,
    Session,
    User,
    UserBan,
    WebAuthnCeremony,
    WebPushSubscription,
)
from app.moderation import active_bans, revoke_bans
from app.security import PASSWORDLESS_HASH, as_utc
from tests import test_push_account_retirement as push_fixtures

NOW = datetime(2026, 10, 25, 16, tzinfo=timezone.utc)
store = push_fixtures.store
actor_request = push_fixtures.actor_request


def mapped(db, source_id, target_id, operation_id="c" * 32):
    accounts = lock_account_rows(db, [source_id, target_id])
    db.add(AccountMergeOperation(id=operation_id, actor_user_id=target_id, source_user_id=source_id,
                                target_user_id=target_id, idempotency_key=operation_id,
                                preview_fingerprint="f" * 64, created_at=NOW, summary_json="{}"))
    db.flush()
    db.add(AccountProgressOrigin(origin_user_id=source_id, owner_user_id=target_id, operation_id=operation_id))
    db.flush()
    return accounts[source_id], accounts[target_id]


def invoke(db, source, target, operation_id="c" * 32):
    return retire_source_identity_in_session(db, source, target, operation_id=operation_id, now=NOW)


def credentials(db, user_id):
    user = db.get(User, user_id)
    return (user.username, user.username_normalized, user.password_hash, user.email, user.email_normalized,
            user.email_confirmed_at, user.webauthn_user_handle, user.voice_listening_default,
            user.release_push_enabled, user.game_invite_push_enabled, user.preferred_language,
            user.created_at, user.updated_at)


def test_retirement_revokes_source_only_and_keeps_target_credentials_and_original_restrictions(store):
    with session_scope() as db:
        source = db.get(User, store.source.id)
        source.email = source.email_normalized = "old@example.com"
        source.email_confirmed_at = NOW
        source.webauthn_user_handle = b"s" * 32
        source.lobby_chat_muted = True
        db.get(User, store.target.id).webauthn_user_handle = b"t" * 32
        for user_id in (store.source.id, store.target.id):
            db.add(PasskeyCredential(user_id=user_id, credential_id=f"credential-{user_id}".encode(),
                                    credential_public_key=b"public-key", created_at=NOW))
            db.add(AccountEmailToken(user_id=user_id, purpose="password_reset", email="old@example.com",
                                     email_normalized="old@example.com", token_hash=str(user_id) * 64,
                                     requested_at=NOW, expires_at=NOW + timedelta(hours=1)))
        db.add(WebAuthnCeremony(state_token_hash="e" * 64, purpose="registration", challenge=b"q" * 32,
                               user_id=source.id, session_id=store.identity.session_id,
                               created_at=NOW, expires_at=NOW + timedelta(minutes=5)))
        db.add_all(UserBan(user_id=source.id, scope="help", reason=reason, created_at=NOW - timedelta(days=2),
                           expires_at=expiry, revoked_at=revoked, created_by_user_id=store.target.id)
                   for reason, expiry, revoked in (("live", NOW + timedelta(days=3), None),
                                                   ("expired", NOW - timedelta(seconds=1), None),
                                                   ("revoked", None, NOW)))
        db.add(UserBan(user_id=store.target.id, scope="play", reason="existing-target", created_at=NOW))
        db.add(PushRelease(revision="d" * 40, kind="usability", summary_de="Test", summary_en="Test",
                           game_types_json='["zdwa"]', published_at=NOW))
        db.add(AdminHelpRequest(id="h" * 32, requester_user_id=store.target.id, game_id="historic",
                                game_type="zdwa", game_name="Historic help", created_at=NOW,
                                resolved_at=NOW, outcome="resolved"))
        db.flush()
        db.add(PushReleaseRecipient(revision="d" * 40, user_id=source.id, product_context="zdwa",
                                   subscription_snapshot_json='[{"id":1,"identity":"old"}]'))
        db.add(AdminHelpRecipient(request_id="h" * 32, user_id=source.id,
                                 subscription_snapshot_json='[{"id":1,"identity":"old"}]'))
        target_before = credentials(db, store.target.id)
    with session_scope() as db:
        source, target = mapped(db, store.source.id, store.target.id)
        report = invoke(db, source, target)
        assert credentials(db, target.id) == target_before
        assert source.username == store.source.username and not source.is_active
        assert source.password_hash == PASSWORDLESS_HASH
        assert source.email is source.email_normalized is source.email_confirmed_at is source.webauthn_user_handle is None
        assert report["revoked"] == {"sessions": 1, "passkeys": 1, "email_tokens": 1, "ceremonies": 1,
                                     "push_devices": 1, "release_snapshots": 1, "help_snapshots": 1}
        assert len(report["bans"]) == 1
        original = db.get(UserBan, report["bans"][0]["source_ban_id"])
        clone = db.get(UserBan, report["bans"][0]["target_ban_id"])
        assert original.user_id == source.id and original.revoked_at is None
        assert clone.user_id == target.id and clone.reason == original.reason
        assert clone.created_at == original.created_at and clone.expires_at == original.expires_at
        assert clone.created_by_user_id == original.created_by_user_id
        assert report["chat"]["lobby_chat_muted"] == {"before": False, "source": True, "after": True}
        assert db.get(PushReleaseRecipient, ("d" * 40, source.id)).subscription_snapshot_json == "[]"
        assert db.get(AdminHelpRecipient, ("h" * 32, source.id)).subscription_snapshot_json == "[]"
        assert {ban.reason for ban in active_bans(db, target.id)} == {"live", "existing-target"}
        assert len(json.dumps(report)) < 1024 and "old@example.com" not in json.dumps(report)
    assert resolve_session(actor_request(store, "zdwa")) is None
    with pytest.raises(HTTPException, match="401"):
        login(actor_request(store, "zdwa"), store.source.username, "test-password-123")
    identity, _token = login(actor_request(store, "zdwa"), store.target.username, "test-password-123")
    assert identity.user_id == store.target.id
    with pytest.raises(ValueError):
        create_user(store.source.username, "another-test-password")


def test_identity_retirement_rolls_back_with_the_callers_failure(store):
    with session_scope() as db:
        source_before, target_before = credentials(db, store.source.id), credentials(db, store.target.id)
    with pytest.raises(RuntimeError, match="later adapter failed"):
        with session_scope() as db:
            source, target = mapped(db, store.source.id, store.target.id)
            invoke(db, source, target)
            raise RuntimeError("later adapter failed")
    with session_scope() as db:
        assert credentials(db, store.source.id) == source_before
        assert credentials(db, store.target.id) == target_before
        assert db.get(AccountProgressOrigin, store.source.id) is None
        assert db.get(Session, store.identity.session_id) is not None
        assert db.scalar(select(WebPushSubscription).where(WebPushSubscription.user_id == store.source.id)) is not None


def test_restrictive_transfer_respects_target_privileges_and_normal_inactive_sources(store):
    with session_scope() as db:
        db.get(User, store.source.id).is_active = False
    with session_scope() as db:
        source, target = mapped(db, store.source.id, store.target.id)
        invoke(db, source, target)
        assert not source.is_active
    # A protected target must not receive a ban through direct copying.
    with session_scope() as db:
        extra = create_user("RestrictedExtra", "test-password-123", must_change_password=False)
        db.add(UserBan(user_id=extra.id, scope="help", reason="must-not-discard", created_at=NOW))
        db.get(User, store.target.id).role = "admin"
    with pytest.raises(ProgressIdentityError, match="merge_identity_restricted_target_protected"):
        with session_scope() as db:
            source, target = mapped(db, extra.id, store.target.id, "e" * 32)
            invoke(db, source, target, "e" * 32)


def test_explicit_target_unban_and_unmute_survive_a_later_chained_merge(store):
    admin = create_user("MergeModerator", "test-password-123", role="admin", must_change_password=False)
    third = create_user("MergeThird", "test-password-123", must_change_password=False)
    with session_scope() as db:
        db.add(UserBan(user_id=store.source.id, scope="help", reason="original", created_at=NOW,
                       created_by_user_id=admin.id, expires_at=NOW + timedelta(days=3)))
        db.get(User, store.source.id).lobby_chat_excluded = True
    with session_scope() as db:
        source, target = mapped(db, store.source.id, store.target.id)
        invoke(db, source, target)
    with session_scope() as db:
        revoke_bans(db, store.target.id, "help", admin.id)
        db.get(User, store.target.id).lobby_chat_excluded = False
    with session_scope() as db:
        source, target = mapped(db, store.target.id, third.id, "d" * 32)
        report = invoke(db, source, target, "d" * 32)
        assert report["bans"] == [] and not target.lobby_chat_excluded
        assert not active_bans(db, target.id)
        original = db.scalar(select(UserBan).where(UserBan.user_id == store.source.id))
        assert original.revoked_at is None and as_utc(original.expires_at) == NOW + timedelta(days=3)
