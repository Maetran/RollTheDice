"""Real SQLite writer serialization between native admission and account merge.

Each contender has its own spawned interpreter, engine and ORM session. Only
award hooks are empty: room CAS, exact identities, owner/session authorization,
merge preflight, map writes and source retirement execute production code.
"""
from __future__ import annotations

import json
import multiprocessing
import os
import traceback
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

WAIT_SECONDS = 20
PASSWORD = "ValidOwnerPassword9"
ROOM_ID = "process-race-room"


def _wait(signal, label):
    assert signal.wait(WAIT_SECONDS), f"Timed out waiting for {label}"


def _empty_prepare(_db, _context):
    return {}


def _empty_consolidate(_db, _context, _prepared):
    return {"public": {"after_points": 0}}


def _race_worker(kind, winner, directory, identity, fingerprint, signals, send):
    """Top-level spawn entry; initialize the schema before either writer runs."""
    try:
        from sqlalchemy import event, select
        from starlette.requests import Request

        from app import account_merge, game_lifecycle
        from app.account_progress import ProgressIdentityError
        from app.database import configure_database, get_engine, session_scope, upgrade_database
        from app.models import AccountMergeOperation, ActiveGame, GameAccountMembership

        os.environ["ROLLTHEDICE_DATABASE_URL"] = f"sqlite:///{directory}/race.sqlite3"
        configure_database(Path(directory))
        upgrade_database(Path(__file__).resolve().parents[1])
        engine = get_engine()
        # Opening the connection/PRAGMAs here also precedes the held writer.
        with engine.connect() as connection:
            assert connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one() == 30000
        expected = "UPDATE users SET" if kind == "merge" else "UPDATE active_games SET"
        first_statement = None

        def before_cursor(_connection, _cursor, statement, _parameters, context, _many):
            nonlocal first_statement
            if first_statement is None and statement.startswith(expected):
                first_statement = context
                signals["attempted"].set()

        def after_cursor(_connection, _cursor, _statement, _parameters, context, _many):
            if context is first_statement:
                signals["write_returned"].set()

        event.listen(engine, "before_cursor_execute", before_cursor)
        event.listen(engine, "after_cursor_execute", after_cursor)
        if kind == "admission":
            with session_scope() as db:
                row = db.scalar(select(ActiveGame).where(ActiveGame.game_id == ROOM_ID))
                room = json.loads(row.state_json)
                game_lifecycle.bind_room(room, ROOM_ID, row.admission_revision)
            if room.get("_game_type") == "hausdepp":
                # Exercise a real deferred transaction, independent of the
                # sqlite3 legacy mode that may run SELECT outside BEGIN.
                # A read-first contender would pin its old WAL snapshot and
                # fail its write upgrade after the winning merge commits.
                def explicit_begin(connection):
                    connection.exec_driver_sql("BEGIN")

                event.listen(engine, "begin", explicit_begin)
            original_memberships = game_lifecycle._add_memberships
            original_install = game_lifecycle.install_candidate
            installations = []

            def membership_barrier(db, game_id, user_ids, revision, now):
                original_memberships(db, game_id, user_ids, revision, now)
                db.flush()
                assert db.get(GameAccountMembership, (ROOM_ID, 3)) is not None
                signals["held"].set()
                _wait(signals["release"], "admission commit release")

            def install(game, candidate, revision):
                installations.append(revision)
                original_install(game, candidate, revision)

            with patch.object(game_lifecycle, "install_candidate", side_effect=install):
                with patch.object(game_lifecycle, "_add_memberships", side_effect=(
                    membership_barrier if winner else original_memberships
                )):
                    signals["ready"].set()
                    _wait(signals["start"], "admission start")
                    try:
                        game_lifecycle.admit_player(room, {
                            "id": "source-seat", "name": "Source", "user_id": 3,
                            "resume_token": "source-resume", "ws": None,
                        })
                        result = {"status": "admitted"}
                    except game_lifecycle.AdmissionError as exc:
                        result = {"status": "rejected", "code": exc.code}
            result.update(players=[player["user_id"] for player in room["_players"]],
                          revision=game_lifecycle.bound_revision(room), installations=installations)
        else:
            def prepare_barrier(db, context):
                assert db.get(AccountMergeOperation, context.operation_id) is not None
                signals["held"].set()
                _wait(signals["release"], "merge commit release")
                return {}

            hooks = (("zdwa", prepare_barrier if winner else _empty_prepare, _empty_consolidate),)
            request = Request({"type": "http", "method": "POST", "path": "/", "headers": [],
                               "scheme": "http", "server": ("testserver", 80)})
            with patch.object(account_merge, "_game_hooks", return_value=hooks):
                signals["ready"].set()
                _wait(signals["start"], "merge start")
                try:
                    with session_scope() as db:
                        applied = account_merge.apply_merge_in_session(
                            db, identity=identity, request=request, source_id=3, target_id=2,
                            fingerprint=fingerprint, idempotency_key="process-race-merge", current_password=PASSWORD,
                        )
                    result = {"status": "merged", "operation_id": applied["operation_id"]}
                except ProgressIdentityError as exc:
                    result = {"status": "rejected", "code": str(exc)}
        send.send(result)
    except BaseException:
        send.send({"unexpected": traceback.format_exc()})
        raise
    finally:
        signals["done"].set()
        send.close()


@pytest.fixture(params=("zdwa", "hausdepp"))
def race_store(tmp_path, request):
    from app import account_merge, main
    from app.auth import issue_session_for_user
    from app.database import configure_database, session_scope, upgrade_database
    from app.game_state import games, new_game
    from app.models import AccountOwnership, User
    from app.security import hash_password

    try:
        with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/race.sqlite3"}):
            with patch.dict(games, clear=True):
                configure_database(tmp_path)
                upgrade_database(main.BASE)
                now = datetime.now(timezone.utc)
                with session_scope() as db:
                    db.add_all(User(id=value, username=f"Race{value}", username_normalized=f"race{value}",
                                    password_hash=hash_password(PASSWORD), created_at=now, updated_at=now,
                                    role="admin" if value == 4 else "user") for value in (2, 3, 4))
                    db.flush()
                    db.add(AccountOwnership(user_id=4, is_founder=True, created_at=now))
                    db.flush()
                    identities = {value: issue_session_for_user(db, db.get(User, value))[0] for value in (2, 3, 4)}
                if request.param == "hausdepp":
                    from app.game_lifecycle import commit_room_binding
                    from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, new_hausdepp_game

                    # A real prepared internal-rule room exercises the
                    # checkpoint read needed for fresh Hausdepp validation.
                    # Its seated staff host is not either merging account.
                    room = new_hausdepp_game(ROOM_ID, "Process race", "3", register=False)
                    configure_hausdepp_game(room, host_user_id=4, cpu_count=0, manual_start=True,
                                            four_of_a_kind_as_ten=True)
                    join_hausdepp_player(room, {"id": "staff-seat", "name": "Race4", "user_id": 4,
                                               "resume_token": "staff-resume", "ws": None})
                    commit_room_binding(room, [4])
                    games[ROOM_ID] = room
                else:
                    new_game(ROOM_ID, "Process race", 2)
                with patch.object(account_merge, "_game_hooks", return_value=(
                    ("zdwa", _empty_prepare, _empty_consolidate),
                )):
                    with session_scope() as db:
                        fingerprint = account_merge.preview_merge_in_session(
                            db, actor_id=4, source_id=3, target_id=2,
                        )["fingerprint"]
                yield str(tmp_path), identities, fingerprint, request.param
    finally:
        configure_database(main.DATA_DIR)


def _signals(context):
    return {name: context.Event() for name in (
        "ready", "start", "attempted", "write_returned", "held", "release", "done",
    )}


@pytest.mark.parametrize("winner", ["admission", "merge"])
def test_separate_process_admission_and_merge_serialize_both_orders(race_store, winner):
    from sqlalchemy import select

    from app.database import session_scope
    from app.models import AccountMergeOperation, AccountProgressOrigin, ActiveGame, GameAccountMembership, User
    from app.models import Session as LoginSession
    from app.security import PASSWORDLESS_HASH

    directory, identities, fingerprint, game_type = race_store
    with session_scope() as db:
        before = db.scalar(select(ActiveGame).where(ActiveGame.game_id == ROOM_ID))
        original_room = before.state_json
        original_players = [player["user_id"] for player in json.loads(original_room)["_players"]]
        original_memberships = sorted((row.game_id, row.user_id, row.admission_revision)
                                      for row in db.scalars(select(GameAccountMembership)))
        original_sessions = {row.id: (row.user_id, row.token_hash, row.csrf_token)
                             for row in db.scalars(select(LoginSession))}
    context = multiprocessing.get_context("spawn")
    owned = {}
    try:
        for kind in ("admission", "merge"):
            receive, send = context.Pipe(duplex=False)
            signals = _signals(context)
            process = context.Process(target=_race_worker, name=f"merge-race-{kind}", args=(
                kind, kind == winner, directory, identities[4], fingerprint, signals, send,
            ))
            owned[kind] = (process, signals, receive)
            process.start()
            send.close()
        for kind, (_process, signals, _receive) in owned.items():
            _wait(signals["ready"], f"{kind} schema and connection initialization")
        first, held, _ = owned[winner]
        contender = "merge" if winner == "admission" else "admission"
        second, blocked, _ = owned[contender]
        held["start"].set()
        _wait(held["held"], f"{winner} uncommitted writer")
        assert held["write_returned"].is_set()
        blocked["start"].set()
        _wait(blocked["attempted"], f"{contender} competing SQL write")
        # The concrete competing UPDATE has reached the DBAPI boundary. The
        # writer's held transaction must prevent its return/completion.
        assert not blocked["write_returned"].is_set()
        assert not blocked["done"].is_set()
        assert first.is_alive() and second.is_alive()
        held["release"].set()
        results = {}
        for kind, (process, signals, receive) in owned.items():
            assert receive.poll(WAIT_SECONDS), f"No {kind} result"
            results[kind] = receive.recv()
            process.join(WAIT_SECONDS)
            assert process.exitcode == 0, results[kind]
            assert signals["done"].is_set()
            assert "unexpected" not in results[kind], results[kind]
        # Both real writes eventually returned: the losing admission therefore
        # exercised and rolled back its room CAS, rather than failing early.
        assert all(signals["write_returned"].is_set() for _process, signals, _receive in owned.values())
    finally:
        for process, signals, receive in owned.values():
            signals["start"].set()
            signals["release"].set()
            if process.is_alive():
                process.terminate()
            process.join(WAIT_SECONDS)
            receive.close()

    with session_scope() as db:
        room = db.scalar(select(ActiveGame).where(ActiveGame.game_id == ROOM_ID))
        memberships = sorted((row.game_id, row.user_id, row.admission_revision)
                             for row in db.scalars(select(GameAccountMembership)))
        mapping = db.get(AccountProgressOrigin, 3)
        operations = list(db.scalars(select(AccountMergeOperation)))
        sessions = {row.id: (row.user_id, row.token_hash, row.csrf_token)
                    for row in db.scalars(select(LoginSession))}
        assert sessions[identities[4].session_id] == original_sessions[identities[4].session_id]
        assert sessions[identities[2].session_id] == original_sessions[identities[2].session_id]
        assert db.get(User, 2).is_active
        if winner == "admission":
            assert results["admission"] == {"status": "admitted", "players": [*original_players, 3], "revision": 1, "installations": [1]}
            assert results["merge"] == {"status": "rejected", "code": "merge_account_at_table"}
            assert db.get(User, 3).is_active and mapping is None and not operations
            assert sessions == original_sessions
            assert room.admission_revision == 1
            assert [seat["user_id"] for seat in json.loads(room.state_json)["_players"]] == [*original_players, 3]
            assert memberships == sorted([*original_memberships, (ROOM_ID, 3, 1)])
        else:
            assert results["merge"]["status"] == "merged"
            assert results["admission"] == {"status": "rejected", "code": "account_retired_or_inactive",
                                            "players": original_players, "revision": 0, "installations": []}
            assert not db.get(User, 3).is_active
            assert db.get(User, 3).password_hash == PASSWORDLESS_HASH
            assert mapping.owner_user_id == 2
            assert len(operations) == 1 and operations[0].id == results["merge"]["operation_id"]
            assert identities[3].session_id not in sessions
            assert room.state_json == original_room and room.admission_revision == 0
            assert memberships == original_memberships
        if game_type == "hausdepp":
            assert json.loads(room.state_json)["_hausdepp_four_of_a_kind_as_ten"] is True
