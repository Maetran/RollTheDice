"""Native exact-account memberships are part of the accepted checkpoint TX."""
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select

from app.account_merge import ensure_no_pending_games
from app.account_progress import ProgressIdentityError
from app.database import session_scope
from app.models import AccountProgressOrigin, ActiveGame, CompletedGame, GameAccountMembership, User
from app.security import utcnow
from app.watten_recipe import WattenRecipe
from app.watten_runtime import (
    admit_account,
    configure_watten_game,
    expire_inactive_game,
    new_watten_game,
    persist_watten_game,
)
from tests import test_watten_runtime as native
from tests.test_account_progress import store as store
from tests.test_watten_match_evidence import NativeMatch

server = native.server


def waiting():
    game = new_watten_game("merge-native-admission", "Native admission", 2)
    configure_watten_game(game, WattenRecipe(2, "normal", False, False),
                          SimpleNamespace(user_id=2, username="Origin2"), None)
    return game


def checkpoint():
    with session_scope() as db:
        return db.scalar(select(ActiveGame.state_json)), set(db.scalars(select(GameAccountMembership.user_id)))


def test_native_create_join_and_failed_account_validation_share_one_commit(store):
    game = waiting()
    persist_watten_game(game, creating=True)
    before, members = checkpoint()
    assert members == {2}
    candidate, _player = admit_account(game, SimpleNamespace(user_id=3, username="Origin3"),
                                       game["_watten"].room.revision, None)
    with session_scope() as db:
        db.get(User, 3).is_active = False
    with pytest.raises(ProgressIdentityError, match="account_retired_or_inactive"):
        persist_watten_game(candidate)
    assert checkpoint() == (before, {2})
    assert {member.account_id for member in game["_watten"].room.members} == {2}
    with session_scope() as db:
        db.get(User, 3).is_active = True
    persist_watten_game(candidate)
    assert checkpoint()[1] == {2, 3}
    with session_scope() as db:
        with pytest.raises(ProgressIdentityError, match="merge_account_at_table"):
            ensure_no_pending_games(db, (3,))


def test_retired_native_admission_never_redirects_to_progress_owner(store):
    game = waiting()
    persist_watten_game(game, creating=True)
    before = checkpoint()
    candidate, _player = admit_account(game, SimpleNamespace(user_id=3, username="Origin3"),
                                       game["_watten"].room.revision, None)
    with session_scope() as db:
        db.get(User, 3).is_active = False
        db.add(AccountProgressOrigin(origin_user_id=3, owner_user_id=2, operation_id="a" * 32))
    with pytest.raises(ProgressIdentityError, match="account_retired_or_inactive"):
        persist_watten_game(candidate)
    assert checkpoint() == before


def test_missing_native_checkpoint_cannot_be_recreated_by_old_room(store):
    game = waiting()
    persist_watten_game(game, creating=True)
    with session_scope() as db:
        db.execute(delete(ActiveGame).where(ActiveGame.game_id == game["_id"]))
    with pytest.raises(ValueError, match="watten_checkpoint_missing"):
        persist_watten_game(game)
    assert checkpoint() == (None, set())


def test_existing_inactive_member_is_not_readmitted_by_unrelated_checkpoint(store):
    game = waiting()
    persist_watten_game(game, creating=True)
    with session_scope() as db:
        db.get(User, 2).is_active = False
    game["_name"] = "Existing moderated room"
    persist_watten_game(game)
    assert checkpoint()[1] == {2}


def test_completed_native_table_is_mergeable_only_with_matching_durable_typed_result(server):
    for index in range(2):
        native.account(f"TerminalMerge{index}")
    match = NativeMatch(2, target=3)
    match.ready()
    persist_watten_game(match.game, creating=True)
    assert checkpoint()[1] == {1, 2}
    match.finish()
    persist_watten_game(match.game)
    assert checkpoint()[1] == set()
    with session_scope() as db:
        ensure_no_pending_games(db, (1, 2))
        completed = db.scalar(select(CompletedGame).where(CompletedGame.game_id == match.game["_id"]))
        completed.snapshot_json = "{}"
    with session_scope() as db, pytest.raises(ProgressIdentityError, match="merge_recovery_state_unknown"):
        ensure_no_pending_games(db, (1, 2))


def test_validated_timeout_abort_has_no_pending_membership_even_with_internal_started_status(server):
    for index in range(2):
        native.account(f"AbortedMerge{index}")
    match = NativeMatch(2, target=3)
    match.ready()
    match.game["_last_activity"] = utcnow() - timedelta(hours=2)
    persist_watten_game(match.game, creating=True)
    assert expire_inactive_game(match.game)
    assert match.game["_watten"].room.status == "started"
    assert match.game["_aborted"]
    assert checkpoint()[1] == set()
    with session_scope() as db:
        ensure_no_pending_games(db, (1, 2))
