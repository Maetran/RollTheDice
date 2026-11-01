"""Opt-in real PostgreSQL races for the private rare-surprise journal.

The URL must name the throwaway ``rare_concurrency_test`` database through a
private Unix socket. Each test creates and drops only its own random schema.
"""
from __future__ import annotations

import importlib.util
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier, Event

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.models import Base, RareSurpriseCounter, RareSurpriseOffer, User
from app.rare_surprise_probability import activate, start_game
from app.security import utcnow


@pytest.fixture
def postgres_schema():
    url = os.environ.get("ROLLTHEDICE_RARE_TEST_POSTGRES_URL")
    if not url:
        pytest.skip("Set ROLLTHEDICE_RARE_TEST_POSTGRES_URL for isolated PostgreSQL races")
    parsed = make_url(url)
    socket = parsed.query.get("host", "")
    if (parsed.get_backend_name() != "postgresql" or parsed.database != "rare_concurrency_test"
            or not Path(socket).is_absolute() or not Path(socket).name.startswith("rtd-rare-pg.")):
        pytest.fail("PostgreSQL race tests require the throwaway rare_concurrency_test DB on a private rtd-rare-pg.* Unix socket")
    admin = sa.create_engine(url)
    schema = "rare_test_" + uuid.uuid4().hex
    with admin.begin() as connection:
        connection.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    engine = sa.create_engine(url, connect_args={"options": f"-csearch_path={schema} -clock_timeout=5000 -cstatement_timeout=10000"})
    try:
        yield engine
    finally:
        engine.dispose()
        with admin.begin() as connection:
            connection.exec_driver_sql(f'DROP SCHEMA "{schema}" CASCADE')
        admin.dispose()


@pytest.fixture
def postgres(postgres_schema):
    Base.metadata.create_all(postgres_schema)
    factory = sessionmaker(postgres_schema, expire_on_commit=False)
    with factory.begin() as db:
        db.add_all([User(username=f"Race{index}", username_normalized=f"race{index}", password_hash="fixture",
                         created_at=utcnow(), updated_at=utcnow())
                    for index in range(1, 4)])
        db.flush()
        ids = list(db.scalars(sa.select(User.id).order_by(User.id)))
    return factory, ids


def run_simultaneously(count, operation):
    gate = Barrier(count)

    def worker(index):
        gate.wait(timeout=5)
        return operation(index)

    with ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(worker, range(count)))


def test_many_duplicate_starts_count_one_game_on_real_postgres(postgres, monkeypatch):
    factory, (first, second, _) = postgres
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)

    def start(index):
        with factory.begin() as db:
            start_game(db, "hausdepp", "shared:1", (first, second) if index % 2 else (second, first))

    run_simultaneously(8, start)
    with factory() as db:
        assert db.get(RareSurpriseCounter, ("hausdepp", first)).games == 1
        assert db.get(RareSurpriseCounter, ("hausdepp", second)).games == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(RareSurpriseOffer)) == 1


def test_many_overlapping_different_tables_count_every_game_without_deadlock(postgres, monkeypatch):
    factory, (first, second, third) = postgres
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda limit: limit - 1)

    def start(index):
        accounts = [(first, second), (second, first), (third, second), (second, third)][index % 4]
        with factory.begin() as db:
            start_game(db, "watten", f"table-{index}", accounts)

    run_simultaneously(12, start)
    with factory() as db:
        assert [db.get(RareSurpriseCounter, ("watten", user)).games for user in (first, second, third)] == [6, 12, 6]
        assert db.scalar(sa.select(sa.func.count()).select_from(RareSurpriseOffer)) == 12


def test_competing_activation_resets_once(postgres, monkeypatch):
    factory, (first, second, _) = postgres
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)
    with factory.begin() as db:
        start_game(db, "hausdepp", "claim:1", [first, second])

    def claim(index):
        with factory.begin() as db:
            return activate(db, "hausdepp", "claim:1", "star", (first, second) if index % 2 else (second, first))

    results = run_simultaneously(8, claim)
    assert results.count(True) == 1 and results.count(False) == 7
    with factory() as db:
        assert [db.get(RareSurpriseCounter, ("hausdepp", user)).games for user in (first, second)] == [0, 0]
        assert db.get(RareSurpriseOffer, ("hausdepp", "claim:1")).activated


def _wait_until_blocked(engine, pid, timeout=3):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with engine.connect() as connection:
            if connection.scalar(sa.text("SELECT cardinality(pg_blocking_pids(:pid)) > 0"), {"pid": pid}):
                return
        time.sleep(.01)
    pytest.fail("The competing transaction never reached a PostgreSQL row lock")


@pytest.mark.parametrize("first_action", ["start", "activate"])
def test_start_and_activation_serialize_in_both_orders(postgres, postgres_schema, monkeypatch, first_action):
    factory, (first, second, _) = postgres
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)
    with factory.begin() as db:
        start_game(db, "watten", "existing", [first, second])
    locked, release, second_started = Event(), Event(), Event()
    waiting_pid = []

    def apply(db, action):
        if action == "start":
            start_game(db, "watten", "next", [second, first])
        else:
            assert activate(db, "watten", "existing", "star", [first, second]) is True

    def holder():
        with factory.begin() as db:
            apply(db, first_action)
            locked.set()
            assert release.wait(5)

    def waiter():
        assert locked.wait(5)
        with factory.begin() as db:
            waiting_pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            second_started.set()
            apply(db, "activate" if first_action == "start" else "start")

    with ThreadPoolExecutor(max_workers=2) as pool:
        a, b = pool.submit(holder), pool.submit(waiter)
        try:
            assert second_started.wait(5)
            _wait_until_blocked(postgres_schema, waiting_pid[0])
        finally:
            release.set()
        a.result(timeout=8)
        b.result(timeout=8)
    expected = 0 if first_action == "start" else 1
    with factory() as db:
        assert [db.get(RareSurpriseCounter, ("watten", user)).games for user in (first, second)] == [expected, expected]
        assert db.get(RareSurpriseOffer, ("watten", "existing")).activated
        assert db.get(RareSurpriseOffer, ("watten", "next")) is not None


def test_start_and_activation_rollbacks_leave_no_partial_state(postgres, monkeypatch):
    factory, (first, second, _) = postgres
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)
    with pytest.raises(RuntimeError, match="rollback"):
        with factory.begin() as db:
            start_game(db, "watten", "rolled-back", [first, second])
            raise RuntimeError("rollback")
    with factory() as db:
        assert db.get(RareSurpriseOffer, ("watten", "rolled-back")) is None
        assert db.get(RareSurpriseCounter, ("watten", first)) is None
    with factory.begin() as db:
        start_game(db, "watten", "committed", [first, second])
    with pytest.raises(RuntimeError, match="rollback"):
        with factory.begin() as db:
            assert activate(db, "watten", "committed", "star", [first, second]) is True
            raise RuntimeError("rollback")
    with factory() as db:
        assert not db.get(RareSurpriseOffer, ("watten", "committed")).activated
        assert [db.get(RareSurpriseCounter, ("watten", user)).games for user in (first, second)] == [1, 1]


def test_migration_0083_preserves_preexisting_claims_and_defaults_on_postgres(postgres_schema):
    """Use a minimal 0082-shaped schema, including a real witness FK."""
    path = Path(__file__).resolve().parents[1] / "alembic/versions/20261101_0083_rare_surprise_probability.py"
    spec = importlib.util.spec_from_file_location("rare_surprise_0083", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    with postgres_schema.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE users (id integer PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE active_games (game_id varchar(64) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE watten_table_surprise_claims (game_id varchar(16), deal_id varchar(160), PRIMARY KEY (game_id, deal_id))")
        connection.exec_driver_sql("CREATE TABLE watten_table_surprise_witnesses (game_id varchar(16), deal_id varchar(160), user_id integer REFERENCES users(id), FOREIGN KEY (game_id, deal_id) REFERENCES watten_table_surprise_claims(game_id, deal_id))")
        connection.exec_driver_sql("INSERT INTO users VALUES (1)")
        connection.exec_driver_sql("INSERT INTO active_games VALUES ('existing')")
        connection.exec_driver_sql("INSERT INTO watten_table_surprise_claims VALUES ('existing', 'deal')")
        connection.exec_driver_sql("INSERT INTO watten_table_surprise_witnesses VALUES ('existing', 'deal', 1)")
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
        assert connection.exec_driver_sql("SELECT rare_surprise_policy FROM active_games").scalar_one() == 1
        assert connection.exec_driver_sql("SELECT policy_version FROM watten_table_surprise_claims").scalar_one() == 1
        assert connection.exec_driver_sql("SELECT count(*) FROM watten_table_surprise_witnesses").scalar_one() == 1
        assert connection.exec_driver_sql("SELECT id FROM rare_surprise_lock").scalar_one() == 1
        connection.exec_driver_sql("INSERT INTO active_games (game_id) VALUES ('later')")
        assert connection.exec_driver_sql("SELECT rare_surprise_policy FROM active_games WHERE game_id = 'later'").scalar_one() == 1
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
        assert connection.exec_driver_sql("SELECT count(*) FROM watten_table_surprise_witnesses").scalar_one() == 1


def _use_postgres_runtime(monkeypatch, factory, engine):
    from app import database
    from app.game_state import games

    monkeypatch.setattr(database, "_session_factory", factory)
    monkeypatch.setattr(database, "_engine", engine)
    monkeypatch.setattr(database, "_schema_ready", True)
    monkeypatch.setattr("app.rare_surprise_probability.secrets.randbelow", lambda _limit: 0)
    monkeypatch.setattr("app.hausdepp_experience.record_table_experience", lambda _game: None)
    monkeypatch.setattr("app.hausdepp_state.games", {})
    monkeypatch.setattr("app.game_state.games", {})
    return games


def _waiting_hausdepp(game_id, first, second):
    from app.game_lifecycle import admit_player, commit_room_binding
    from app.hausdepp_state import configure_hausdepp_game, new_hausdepp_game

    game = new_hausdepp_game(game_id, "PostgreSQL test", 2, register=False)
    configure_hausdepp_game(game, host_user_id=first, cpu_count=0)
    commit_room_binding(game, [first])
    admit_player(game, {"id": "p1", "name": "Host", "user_id": first, "ws": object()})
    guest = {"id": "p2", "name": "Guest", "user_id": second, "ws": object()}
    return game, guest


def test_concurrent_real_hausdepp_admission_starts_on_postgres(postgres, postgres_schema, monkeypatch):
    from app.game_lifecycle import admit_player

    factory, (first, second, _) = postgres
    _use_postgres_runtime(monkeypatch, factory, postgres_schema)
    tables = [_waiting_hausdepp(f"admission-{index}", first, second) for index in range(6)]

    def start(index):
        game, guest = tables[index]
        admit_player(game, guest)
        return game["_started"]

    assert all(run_simultaneously(len(tables), start))
    with factory() as db:
        assert [db.get(RareSurpriseCounter, ("hausdepp", user)).games for user in (first, second)] == [6, 6]
        assert db.scalar(sa.select(sa.func.count()).select_from(RareSurpriseOffer)) == 6


def test_real_hausdepp_claim_and_admission_start_do_not_deadlock(postgres, postgres_schema, monkeypatch):
    from app.active_games import save_active_game
    from app.game_lifecycle import admit_player
    from app.hausdepp_engine import apply_action
    from app.hausdepp_table_surprises import _persist_new_policy_claim

    factory, (first, second, _) = postgres
    _use_postgres_runtime(monkeypatch, factory, postgres_schema)
    game, guest = _waiting_hausdepp("claim-first", first, second)
    admit_player(game, guest)
    while game["_hausdepp"]["phase"] == "peeking":
        state = game["_hausdepp"]
        game["_hausdepp"] = apply_action(state, state["current_player_id"], "peek", version=state["version"])
    save_active_game(game)
    next_game, next_guest = _waiting_hausdepp("claim-second", first, second)

    def operation(index):
        if index == 0:
            return _persist_new_policy_claim(game, "p1", "star", 1)
        admit_player(next_game, next_guest)
        return next_game["_started"]

    assert run_simultaneously(2, operation) == [True, True]
    with factory() as db:
        counts = [db.get(RareSurpriseCounter, ("hausdepp", user)).games for user in (first, second)]
        assert counts in ([0, 0], [1, 1])
        assert db.get(RareSurpriseOffer, ("hausdepp", "claim-first:1")).activated
        assert db.get(RareSurpriseOffer, ("hausdepp", "claim-second:1")) is not None


def _waiting_watten(game_id, first, second):
    from types import SimpleNamespace

    from app.watten_recipe import WattenRecipe
    from app.watten_runtime import (
        admit_account,
        apply_runtime_action,
        configure_watten_game,
        new_watten_game,
        persist_watten_game,
    )

    game = new_watten_game(game_id, "PostgreSQL test", 2)
    configure_watten_game(game, WattenRecipe(2, "normal", False, False),
                          SimpleNamespace(user_id=first, username="Host"), None)
    persist_watten_game(game, creating=True)
    players = []
    for seat, account in enumerate((first, second)):
        identity = SimpleNamespace(user_id=account, username=f"Player {seat}")
        candidate, player = admit_account(game, identity, game["_watten"].room.revision, None)
        persist_watten_game(candidate)
        game = candidate
        players.append(player)
        runtime = game["_watten"]
        command = {"action": "watten_take_seat", "command_id": f"seat-{seat}",
                   "revision": runtime.room.revision, "lifecycle_revision": runtime.lifecycle_revision,
                   "seat": seat, "team": None}
        candidate, *_ = apply_runtime_action(game, account, player, command)
        persist_watten_game(candidate)
        game = candidate
    runtime = game["_watten"]
    command = {"action": "watten_start", "command_id": "start", "revision": runtime.room.revision,
               "lifecycle_revision": runtime.lifecycle_revision}
    candidate, *_ = apply_runtime_action(game, first, players[0], command)
    return candidate


def test_concurrent_real_watten_starts_commit_checkpoints_and_counters(postgres, postgres_schema, monkeypatch):
    from app.models import ActiveGame
    from app.watten_runtime import persist_watten_game

    factory, (first, second, _) = postgres
    _use_postgres_runtime(monkeypatch, factory, postgres_schema)
    candidates = [_waiting_watten(f"watten-{index}", first, second) for index in range(6)]

    def start(index):
        persist_watten_game(candidates[index])

    run_simultaneously(len(candidates), start)
    with factory() as db:
        assert [db.get(RareSurpriseCounter, ("watten", user)).games for user in (first, second)] == [6, 6]
        assert db.scalar(sa.select(sa.func.count()).select_from(RareSurpriseOffer)) == 6
        assert all(db.scalar(sa.select(ActiveGame.rare_surprise_policy).where(
            ActiveGame.game_id == candidate["_id"])) == 2 for candidate in candidates)
