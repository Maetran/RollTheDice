"""Real native continuations retain original-account authority until released."""
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import delete, select

from app import account_merge, watten_admissions, watten_runtime
from app.account_merge import ensure_no_pending_games
from app.account_progress import ProgressIdentityError
from app.database import session_scope
from app.models import CompletedGame, GameAccountMembership
from app.security import utcnow
from app.watten_rematch import create_follow_up
from app.watten_room import admit
from app.watten_runtime import _sync, admit_account, apply_runtime_action, expire_inactive_game, persist_watten_game
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch

server = native.server


@pytest.fixture(autouse=True)
def original_accounts_and_deterministic_deal(server, monkeypatch):
    for index in range(3):
        native.account(f"SeriesMerge{index}")
    monkeypatch.setattr(watten_runtime, "_RANDOM", SimpleNamespace(randrange=lambda _n: 0, shuffle=lambda _d: None))


def completed_match(target):
    match = NativeMatch(2, target=3, start=False, game_id="merge-series-source")
    runtime = match.runtime
    room = replace(runtime.room, recipe=replace(runtime.room.recipe, tournament_nockerl_target=target),
                   members=tuple(replace(member, account_id=3) if member.account_id == 2 else member
                                 for member in runtime.room.members))
    _sync(match.game, replace(runtime, room=room, acks=()), public=False)
    for player in match.game["_players"]:
        if player.get("user_id") == 2:
            player["user_id"] = 3
    match.room("watten_start")
    match.ready()
    persist_watten_game(match.game, creating=True)
    match.finish()
    persist_watten_game(match.game)
    assert match.runtime.room.status == "finished" and match.game["_completion_persisted"]
    return match


def members(game):
    with session_scope() as db:
        return set(db.scalars(select(GameAccountMembership.user_id).where(
            GameAccountMembership.game_id == game["_id"])))


def assert_pending(account=3):
    with session_scope() as db, pytest.raises(ProgressIdentityError, match="merge_account_at_table"):
        ensure_no_pending_games(db, (account,))


def assert_free():
    with session_scope() as db:
        ensure_no_pending_games(db, (2, 3))


def follow_up(match):
    return create_follow_up(match.game["_id"], SimpleNamespace(user_id=1, username="SeriesMerge0"),
                            {"command_id": "next-series", "revision": match.runtime.room.revision})


@pytest.mark.parametrize("target", (20, None))
def test_finished_tail_keeps_existing_durable_history_merge_policy(target):
    match = completed_match(target)
    assert not match.runtime.room.series.finished
    assert members(match.game) == set()
    assert_free()
    # A broken result never becomes mergeable historical evidence.
    with session_scope() as db:
        db.scalar(select(CompletedGame).where(CompletedGame.game_id == match.game["_id"])).snapshot_json = "{}"
    with session_scope() as db, pytest.raises(ProgressIdentityError, match="merge_recovery_state_unknown"):
        ensure_no_pending_games(db, (3,))


@pytest.mark.parametrize("target", (20, None))
def test_live_fixed_followup_keeps_all_originals_after_reservation_expiry(target, monkeypatch):
    match = completed_match(target)
    continuation = follow_up(match)
    waiting = continuation.target
    assert waiting["_watten"].room.series.roster_locked
    assert members(continuation.source) == set()  # linked predecessor is history
    assert members(waiting) == {1, 3}
    expired = waiting["_watten"].room.reservations[0].expires_at + timedelta(seconds=1)
    assert expired < waiting["_watten"].room.wait_expires_at
    monkeypatch.setattr(account_merge, "utcnow", lambda: expired)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: expired)
    locked = []
    original_lock = watten_admissions.lock_account_rows

    def record_lock(db, accounts):
        locked.append(set(accounts))
        return original_lock(db, accounts)

    monkeypatch.setattr(watten_admissions, "lock_account_rows", record_lock)
    waiting["_name"] = "Unrelated waiting checkpoint"
    persist_watten_game(waiting)
    assert locked == [{1, 3}]
    assert members(waiting) == {1, 3}
    # Admission itself still refuses to substitute the merge target's identity.
    room = waiting["_watten"].room
    with pytest.raises(ValueError, match="watten_tournament_roster_locked"):
        admit(room, revision=room.revision, account_id=2, now=expired)
    # Old installations may lack the new ledger; validated recovery owns policy.
    with session_scope() as db:
        db.execute(delete(GameAccountMembership))
    assert_pending()
    with session_scope() as db:
        ensure_no_pending_games(db, (2,))


@pytest.mark.parametrize("target", (20, None))
def test_closed_waiting_tail_releases_linked_history_even_with_unfinished_series(target):
    match = completed_match(target)
    continuation = follow_up(match)
    match.game = continuation.target
    assert_pending()
    candidate, *_ = apply_runtime_action(match.game, 1, match.runtime.room.host_participant_id,
        {"action": "leave_waiting_game", "command_id": "close-waiting-series",
         "revision": match.runtime.room.revision, "lifecycle_revision": match.runtime.lifecycle_revision},
        eligible_accounts=frozenset({1, 3}))
    match.install(candidate)
    assert match.runtime.room.status == "closed" and not match.runtime.room.series.finished
    persist_watten_game(match.game)
    assert members(match.game) == set()
    assert_free()


def test_completed_finite_series_releases_older_unfinished_linked_predecessor():
    match = completed_match(2)
    assert not match.runtime.room.series.finished
    continuation = follow_up(match)
    candidate, _ = admit_account(continuation.target, SimpleNamespace(user_id=3, username="SeriesMerge2"),
                                 continuation.target["_watten"].room.revision, None)
    persist_watten_game(candidate)
    match.game = candidate
    match.room("watten_start")
    match.ready()
    match.finish()
    persist_watten_game(match.game)
    assert match.runtime.room.series.finished
    assert not continuation.source["_watten"].room.series.finished
    assert members(match.game) == set()
    assert_free()


@pytest.mark.parametrize("target", (20, None))
def test_validated_started_tail_timeout_releases_all_series_bindings(target):
    match = completed_match(target)
    continuation = follow_up(match)
    candidate, _ = admit_account(continuation.target, SimpleNamespace(user_id=3, username="SeriesMerge2"),
                                 continuation.target["_watten"].room.revision, None)
    persist_watten_game(candidate)
    match.game = candidate
    match.room("watten_start")
    match.ready()
    match.game["_last_activity"] = utcnow() - timedelta(hours=2)
    persist_watten_game(match.game)
    assert_pending()
    assert expire_inactive_game(match.game)
    assert match.runtime.room.status == "started" and match.game["_aborted"]
    assert members(match.game) == set()
    assert_free()
