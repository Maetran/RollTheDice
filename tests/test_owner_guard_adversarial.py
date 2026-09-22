"""Independent bypass checks for founder persistence and credential boundaries."""

import os
from datetime import timedelta
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError

from app import main
from app.api_auth import AdminPasswordResetRequest, admin_reset_password
from app.auth import change_password, change_username, create_user, login, resolve_session
from app.database import configure_database, session_scope, upgrade_database
from app.models import AccountEmailToken, AccountOwnership, OwnershipAudit, PasskeyCredential, User
from app.ownership import bind_founder
from app.security import hash_session_token, utcnow
from tests.test_user_accounts import request_for


@pytest.fixture
def protected_accounts(tmp_path):
    try:
        with patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path / 'owner-adversarial.sqlite3'}",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        }):
            configure_database(tmp_path)
            upgrade_database(main.BASE)
            founder = create_user("FoundingAdmin", "founder-password-123", role="admin", must_change_password=False)
            staff = create_user("OtherStaff", "staff-password-123", role="admin", must_change_password=False)
            with session_scope() as db:
                bind_founder(db, founder.id)
            yield founder, staff
    finally:
        configure_database(main.DATA_DIR)


@pytest.mark.parametrize("invalid", [2, -1, 3.5, "true"])
def test_noncanonical_sql_booleans_cannot_create_an_additional_founder(protected_accounts, invalid):
    founder, staff = protected_accounts
    with pytest.raises(IntegrityError):
        with session_scope() as db:
            db.execute(text("INSERT INTO account_ownerships (user_id,is_founder,created_at) VALUES (:id,:flag,CURRENT_TIMESTAMP)"),
                       {"id": staff.id, "flag": invalid})
    with session_scope() as db:
        assert [owner.user_id for owner in db.scalars(select(AccountOwnership))] == [founder.id]


@pytest.mark.parametrize("replace_id", ["same", "different"])
def test_sql_replace_cannot_delete_founder_via_id_or_username_collision(protected_accounts, replace_id):
    founder, staff = protected_accounts
    with session_scope() as db:
        row = dict(db.execute(text("SELECT * FROM users WHERE id=:id"), {"id": founder.id}).mappings().one())
    row["id"] = founder.id if replace_id == "same" else staff.id
    row["role"] = "user"
    # Use every existing column so a NOT NULL failure cannot hide the actual
    # protection against SQLite REPLACE's implicit deletion of a conflicting row.
    columns = ",".join(row)
    placeholders = ",".join(f":{column}" for column in row)
    with pytest.raises(IntegrityError) as denied:
        with session_scope() as db:
            db.execute(text(f"INSERT OR REPLACE INTO users ({columns}) VALUES ({placeholders})"), row)
    assert "owner_protected" in str(denied.value) or "FOREIGN KEY" in str(denied.value)
    with session_scope() as db:
        assert db.get(User, founder.id).username == founder.username
        assert db.get(User, founder.id).role == "admin"
        assert db.get(AccountOwnership, founder.id).is_founder
        assert db.get(User, staff.id).username == staff.username


def test_sql_replace_cannot_rewrite_the_founder_audit_record(protected_accounts):
    founder, staff = protected_accounts
    with session_scope() as db:
        audit_id = db.scalar(select(OwnershipAudit.id))
    with pytest.raises(IntegrityError, match="ownership_audit_immutable"):
        with session_scope() as db:
            db.execute(text("INSERT OR REPLACE INTO ownership_audit (id,user_id,actor_user_id,action,created_at) "
                            "VALUES (:id,:user_id,:actor_id,'revoked',CURRENT_TIMESTAMP)"),
                       {"id": audit_id, "user_id": founder.id, "actor_id": staff.id})
    with session_scope() as db:
        assert db.get(OwnershipAudit, audit_id).action == "founder_bound"


def test_rejected_admin_reset_keeps_founder_passkeys_recovery_tokens_and_sessions(protected_accounts):
    founder, staff = protected_accounts
    identity, token = login(request_for(), founder.username, "founder-password-123")
    founder_request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
    staff_identity, staff_token = login(request_for(), staff.username, "staff-password-123")
    staff_request = request_for(cookie=f"rollthedice_session={staff_token}", csrf=staff_identity.csrf_token)
    with session_scope() as db:
        credential = PasskeyCredential(user_id=founder.id, credential_id=b"founder-key", credential_public_key=b"public",
                                       created_at=utcnow())
        recovery = AccountEmailToken(user_id=founder.id, purpose="password_reset", email="founder@example.test",
                                     email_normalized="founder@example.test", token_hash=hash_session_token("recovery-proof"),
                                     requested_at=utcnow(), expires_at=utcnow() + timedelta(minutes=10))
        db.add_all([credential, recovery])
        db.flush()
        credential_id, recovery_id = credential.id, recovery.id
        original_hash = db.get(User, founder.id).password_hash
    for request in [staff_request, founder_request]:
        with pytest.raises(HTTPException):
            admin_reset_password(founder.id, AdminPasswordResetRequest(temporary_password="intruder-password-123"), request)
    with session_scope() as db:
        assert db.get(PasskeyCredential, credential_id) is not None
        assert db.get(AccountEmailToken, recovery_id) is not None
        assert db.get(User, founder.id).password_hash == original_hash
    assert resolve_session(founder_request).is_founder


def test_founder_can_change_own_name_and_password_without_losing_ownership(protected_accounts):
    founder, _ = protected_accounts
    identity, token = login(request_for(), founder.username, "founder-password-123")
    request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
    change_username(identity, "RenamedFounder", "founder-password-123", request)
    change_password(identity, "founder-password-123", "new-founder-password-123")
    assert resolve_session(request) is None
    renewed, _ = login(request_for(), "RenamedFounder", "new-founder-password-123")
    assert renewed.user_id == founder.id
    assert renewed.is_founder and renewed.is_owner and renewed.is_admin
