"""Atomic coordinator boundaries, separate from game-specific proof tests."""
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app import account_merge as merge
from app.account_progress import ProgressIdentityError
from app.auth import issue_session_for_user
from app.database import session_scope
from app.models import (
    AccountMergeOperation,
    AccountOwnership,
    AccountProgressOrigin,
    ActiveGame,
    User,
    WebAuthnCeremony,
)
from app.models import Session as LoginSession
from app.security import hash_password
from tests.test_account_progress import store as store
from tests.test_user_accounts import request_for


@pytest.fixture
def actor(store):
    with session_scope() as db:
        user = db.get(User, 4)
        user.role = "admin"
        user.password_hash = hash_password("ValidOwnerPassword9")
        db.flush()
        db.add(AccountOwnership(user_id=4, is_founder=True, created_at=datetime.now(timezone.utc)))
        db.flush()
        identity, raw_token = issue_session_for_user(db, user)
        source_identity, _ = issue_session_for_user(db, db.get(User, 3))
    with patch.object(merge, "_game_hooks", return_value=(("zdwa", lambda db, context: {"before_points": 0},
                                                         lambda db, context, prepared: {"public": {"after_points": 10}}),)):
        yield identity, source_identity, raw_token


def preview(actor):
    with session_scope() as db:
        return merge.preview_merge_in_session(db, actor_id=4, source_id=3, target_id=2)


def apply(db, actor, fingerprint, *, key="real-merge", password="ValidOwnerPassword9"):
    return merge.apply_merge_in_session(db, identity=actor[0], request=request_for(), source_id=3, target_id=2,
                                        fingerprint=fingerprint, idempotency_key=key, current_password=password)


def test_preview_rolls_its_simulation_back_even_if_caller_commits(actor):
    result = preview(actor)
    assert result["games"] == {"zdwa": {"after_points": 10}}
    assert len(result["fingerprint"]) == 64
    with session_scope() as db:
        assert db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3) is None
        assert db.scalar(select(func.count()).select_from(AccountMergeOperation)) == 1
        assert db.get(LoginSession, actor[1].session_id) is not None


def test_actor_target_passkey_challenge_does_not_stale_progress_preview(actor):
    with session_scope() as db:
        result = merge.preview_merge_in_session(db, actor_id=4, source_id=3, target_id=4)
    with session_scope() as db:
        now = datetime.now(timezone.utc)
        # The real cryptographic action/target binding is separately exercised
        # by the passkey suite; this pins the coordinator's transient boundary.
        db.add(WebAuthnCeremony(state_token_hash="c" * 64, purpose="reauthentication", challenge=b"c" * 32,
                               user_id=4, session_id=actor[0].session_id, action="merge_accounts",
                               target_hash="d" * 64, request_origin="http://testserver",
                               created_at=now, expires_at=now + timedelta(minutes=5)))
    with session_scope() as db:
        assert merge.source_fingerprint(db, (3, 4)) == result["fingerprint"]
        applied = merge.apply_merge_in_session(db, identity=actor[0], request=request_for(), source_id=3, target_id=4,
                                               fingerprint=result["fingerprint"], idempotency_key="self-target",
                                               current_password="ValidOwnerPassword9")
        assert applied["target_user_id"] == 4


def test_apply_retires_source_and_replay_does_not_consume_confirmation_again(actor):
    result = preview(actor)
    with session_scope() as db:
        applied = apply(db, actor, result["fingerprint"])
    assert applied["replayed"] is False
    with session_scope() as db:
        assert not db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3).owner_user_id == 2
        assert db.get(LoginSession, actor[1].session_id) is None
        assert db.get(LoginSession, actor[0].session_id) is not None
        replay = apply(db, actor, result["fingerprint"], password="wrong-proof-on-replay")
    assert replay["operation_id"] == applied["operation_id"]
    assert replay["replayed"] is True
    with pytest.raises(ProgressIdentityError, match="merge_idempotency_conflict"), session_scope() as db:
        apply(db, actor, "f" * 64)


def test_stale_preview_and_wrong_password_preserve_every_original(actor):
    fingerprint = preview(actor)["fingerprint"]
    with session_scope() as db:
        db.get(User, 3).username = "Changed after preview"
    with pytest.raises(ProgressIdentityError, match="merge_preview_stale"), session_scope() as db:
        apply(db, actor, fingerprint)
    fresh = preview(actor)["fingerprint"]
    with pytest.raises(HTTPException, match="current_password_invalid"), session_scope() as db:
        apply(db, actor, fresh, password="wrong")
    with session_scope() as db:
        assert db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3) is None
        assert db.get(LoginSession, actor[1].session_id) is not None


def test_late_game_failure_rolls_back_mapping_credentials_and_operation(actor):
    fingerprint = preview(actor)["fingerprint"]

    def fail_after_retirement(db, context, prepared):
        assert not db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3).owner_user_id == 2
        raise ValueError("controlled-game-validation-failure")

    with patch.object(merge, "_game_hooks", return_value=(("zdwa", lambda db, context: {}, fail_after_retirement),)):
        with pytest.raises(ValueError, match="controlled-game-validation-failure"), session_scope() as db:
            apply(db, actor, fingerprint)
    with session_scope() as db:
        assert db.get(User, 3).is_active
        assert db.get(AccountProgressOrigin, 3) is None
        assert db.get(LoginSession, actor[1].session_id) is not None
        assert db.scalar(select(func.count()).select_from(AccountMergeOperation)) == 1


def test_existing_legacy_checkpoint_blocks_before_any_capture(actor):
    with session_scope() as db:
        now = datetime.now(timezone.utc)
        db.add(ActiveGame(game_id="older-live-room", state_json=json.dumps({"_players": [{"user_id": 3}]}),
                          created_at=now, updated_at=now))
    with pytest.raises(ProgressIdentityError, match="merge_account_at_table"):
        preview(actor)
    with session_scope() as db:
        assert db.get(User, 3).is_active


@pytest.mark.parametrize("host_key", ["_hausdepp_host_user_id", "_zilch_cpu_host_user_id", "_zilch_solo_host_user_id"])
def test_legacy_bound_host_blocks_even_before_first_seat(actor, host_key):
    with session_scope() as db:
        now = datetime.now(timezone.utc)
        db.add(ActiveGame(game_id="older-host-room", state_json=json.dumps({host_key: 3, "_players": []}),
                          created_at=now, updated_at=now))
    with pytest.raises(ProgressIdentityError, match="merge_account_at_table"):
        preview(actor)


def test_old_summary_ack_cannot_ack_a_later_operation_or_other_users_record(actor):
    result = preview(actor)
    with session_scope() as db:
        applied = apply(db, actor, result["fingerprint"])
        target_identity, _ = issue_session_for_user(db, db.get(User, 2))
    with session_scope() as db:
        merge.acknowledge_merge_in_session(db, identity=target_identity, operation_id=applied["operation_id"])
        assert db.get(AccountMergeOperation, "a" * 32).acknowledged_at is None
    with pytest.raises(HTTPException, match="merge_operation_not_found"), session_scope() as db:
        merge.acknowledge_merge_in_session(db, identity=actor[0], operation_id=applied["operation_id"])
