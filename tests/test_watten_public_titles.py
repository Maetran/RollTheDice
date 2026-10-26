"""Persistent public titles, bounded private caches and non-blocking decoration."""

import json
from contextlib import ExitStack

import pytest
from sqlalchemy import event, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import watten_public_titles as titles
from app.database import get_engine, session_scope
from app.models import ActiveGame, CompletedGame, WattenAchievementGrant, WattenMatchCredit
from app.watten_progression_store import store_draft_match
from app.watten_runtime import (
    copy_game,
    persist_watten_game,
    restore_watten_json,
    serialize_watten_game,
    snapshot_watten,
)
from tests import test_watten_runtime as native
from tests.test_watten_match_evidence import NativeMatch
from tests.test_watten_progression_store import game_for, written

server = native.server


def owners_for(number=2):
    return [native.account(f"PublicTitle{index}") for index in range(number)]


def credit(owners, game_id):
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for(owners, game_id=game_id))
        store_draft_match(db, row, evidence, bindings)


def seat_titles(game):
    return [seat["public_title"] for seat in snapshot_watten(game)["room"]["seats"]]


def test_native_admission_and_persisted_seat_action_show_validated_newcomer_title(server):
    owner = owners_for(1)[0]
    game_id = native.create_game(server, owner)
    with ExitStack() as stack:
        socket, _player = native.join(server, stack, game_id, owner)
        assert seat_titles(native.games[game_id]) == [None, None]
        socket.send_json(native.room_command(game_id, "watten_take_seat", "title-seat", seat=0, team=None))
        board = native.receive(socket, "scoreboard")["scoreboard"]
        native.receive(socket, "watten_command")
        assert board["room"]["seats"][0]["public_title"] == {"level": 1, "name": {
            "de": "Türgucker", "en": "Peeking through the door"}, "threshold": 0}
        assert board["room"]["seats"][1]["public_title"] is None
        from app.models import WattenProgressState

        with session_scope() as db:
            assert db.get(WattenProgressState, owner[0].user_id) is None
            assert not list(db.scalars(select(WattenMatchCredit))) and not list(db.scalars(select(WattenAchievementGrant)))


def test_changed_journal_refreshes_other_room_on_next_persist_and_restart_reads_fresh(server, monkeypatch):
    owners = owners_for()
    credit(owners, "title-first-match")
    match = NativeMatch(target=3)
    persist_watten_game(match.game, creating=True)
    first = seat_titles(match.game)
    assert titles.public_title(match.game, "p1", owners[1][0].user_id) is None
    assert all(title["threshold"] == 20 for title in first)
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json))
    real = titles._progress
    reads = []

    def observed(db, account, matches):
        reads.append(account)
        return real(db, account, matches)

    monkeypatch.setattr(titles, "_progress", observed)
    persist_watten_game(match.game)
    assert not reads  # unchanged generation/sequence: no historical JSON read
    credit(owners, "title-second-match")
    assert seat_titles(match.game) == first  # no hidden global room mutation
    persist_watten_game(match.game)
    assert len(reads) == 2 and all(title["threshold"] == 50 for title in seat_titles(match.game))
    reads.clear()
    restored = restore_watten_json(raw)
    assert len(reads) == 2 and seat_titles(restored) == seat_titles(match.game)
    stored = serialize_watten_game(match.game)
    assert titles.CACHE_KEY not in stored and "public_title" not in json.dumps(stored)
    monkeypatch.setattr(titles, "session_scope", lambda: pytest.fail("pure snapshot opened a database session"))
    projection = snapshot_watten(match.game)
    assert all(set(seat["public_title"]) == {"level", "name", "threshold"} for seat in projection["room"]["seats"])
    assert all(text not in json.dumps(projection) for text in ('"user_id"', '"account_id"', '"xp"', '"grant_sequence"', "title-first-match", "title-second-match"))
    projection["room"]["seats"][0]["public_title"]["name"]["de"] = "client mutation"
    assert seat_titles(match.game)[0]["name"]["de"] != "client mutation"


@pytest.mark.parametrize("players,cpus", ((2, (1,)), (3, (1, 2)), (4, (1, 2, 3))))
def test_cpu_seats_never_receive_account_titles(players, cpus, server):
    owners_for(1)
    match = NativeMatch(players, cpus=cpus)
    persist_watten_game(match.game, creating=True)
    assert seat_titles(match.game)[0]["level"] == 1
    assert all(seat_titles(match.game)[seat] is None for seat in cpus)
    assert len(match.game[titles.CACHE_KEY].entries) == 1


def test_unknown_inactive_and_deleted_accounts_never_receive_a_false_title(server):
    from app.models import User

    owner = owners_for(1)[0]
    match = NativeMatch()
    # Decoration tolerates unknown historical identities; live admission must
    # not persist the fixture's nonexistent second account.
    match.game[titles.CACHE_KEY] = titles.restored_public_titles(match.game)
    assert seat_titles(match.game)[0]["level"] == 1 and seat_titles(match.game)[1] is None
    match = NativeMatch(cpus=(1,))
    persist_watten_game(match.game, creating=True)
    with session_scope() as db:
        db.get(User, owner[0].user_id).is_active = False
    persist_watten_game(match.game)
    assert seat_titles(match.game) == [None, None]
    with session_scope() as db:
        # Retire the table before deleting its exact account. A retained stale
        # snapshot can still ask for decoration but may not recreate the table.
        db.delete(db.scalar(select(ActiveGame).where(ActiveGame.game_id == match.game["_id"])))
        db.flush()
        db.delete(db.get(User, owner[0].user_id))
    match.game[titles.CACHE_KEY] = titles.restored_public_titles(match.game)
    assert seat_titles(match.game) == [None, None]
    with pytest.raises(ValueError, match="watten_checkpoint_missing"):
        persist_watten_game(match.game)


def test_corrupt_journal_or_missing_state_is_null_not_a_successful_default(server):
    from app.models import WattenProgressState

    owners = owners_for()
    credit(owners, "corrupt-title-source")
    with session_scope() as db:
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == owners[0][0].user_id))
        grant.grant_sequence = 1
    match = NativeMatch()
    persist_watten_game(match.game, creating=True)
    assert seat_titles(match.game)[0] is None and seat_titles(match.game)[1]["threshold"] == 20
    with session_scope() as db:
        db.delete(db.get(WattenProgressState, owners[1][0].user_id))
    persist_watten_game(match.game)
    assert seat_titles(match.game) == [None, None]
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.game_id)) == match.game["_id"]


def test_title_read_failure_uses_savepoint_and_does_not_block_terminal_result_or_retry(server):
    owners_for()
    match = NativeMatch(target=3)
    match.ready()
    persist_watten_game(match.game, creating=True)
    match.finish()

    def fail_read(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.startswith("SELECT") and "users.is_active" in statement and "watten_progress_states" in statement:
            raise SQLAlchemyError("injected title-only database read failure")

    engine = get_engine()
    event.listen(engine, "before_cursor_execute", fail_read)
    try:
        persist_watten_game(match.game)
    finally:
        event.remove(engine, "before_cursor_execute", fail_read)
    assert match.game["_completion_persisted"] and seat_titles(match.game) == [None, None]
    with session_scope() as db:
        assert db.scalar(select(CompletedGame.game_id)) == match.game["_id"]
        assert len(list(db.scalars(select(WattenMatchCredit)))) == 2
    persist_watten_game(match.game)
    assert all(title is not None and title["threshold"] >= 50 for title in seat_titles(match.game))
    with session_scope() as db:
        assert len(list(db.scalars(select(WattenMatchCredit)))) == 2


def test_new_title_cache_is_not_installed_when_game_commit_fails(server, monkeypatch):
    owners = owners_for()
    credit(owners, "committed-before-failure")
    match = NativeMatch()
    persist_watten_game(match.game, creating=True)
    before = match.game[titles.CACHE_KEY]
    credit(owners, "level-up-before-failure")
    candidate = copy_game(match.game)
    candidate["_name"] = "Uncommitted room name"

    def fail_commit(_db):
        raise SQLAlchemyError("injected actual checkpoint commit failure")

    with monkeypatch.context() as fault:
        fault.setattr(Session, "commit", fail_commit)
        with pytest.raises(SQLAlchemyError, match="actual checkpoint commit"):
            persist_watten_game(candidate)
    assert candidate[titles.CACHE_KEY] is before and match.game[titles.CACHE_KEY] is before
    assert all(title["threshold"] == 20 for title in seat_titles(match.game))
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json))
    assert json.loads(raw)["_name"] != candidate["_name"]
    assert all(title["threshold"] == 50 for title in seat_titles(restore_watten_json(raw)))


def test_pure_restore_and_projection_need_no_configured_database(monkeypatch):
    match = NativeMatch()
    monkeypatch.setattr(titles, "database_schema_ready", lambda: False)
    monkeypatch.setattr(titles, "session_scope", lambda: pytest.fail("pure fixture required a DB"))
    restored = restore_watten_json(json.dumps(serialize_watten_game(match.game)))
    assert seat_titles(restored) == [None, None]
