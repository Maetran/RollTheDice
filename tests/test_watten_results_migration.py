"""Real SQLite constraint/foreign-key preservation and PostgreSQL DDL contract."""

import importlib.util
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PREVIOUS = "20261018_0065"
REVISION = "20261018_0066"
STAMP = "2026-10-18T12:00:00+00:00"


@pytest.fixture
def migration(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{tmp_path / 'watten-migration.sqlite3'}")
    command.upgrade(config, PREVIOUS)
    connection = sqlite3.connect(tmp_path / "watten-migration.sqlite3", isolation_level=None)
    connection.execute("PRAGMA foreign_keys=ON")
    try:
        yield config, connection
    finally:
        connection.close()


def user(connection):
    return connection.execute(
        "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,created_at,updated_at) "
        "VALUES ('Migration player','migrationplayer','unchanged','user',1,0,?,?)", (STAMP, STAMP),
    ).lastrowid


def completed(connection, identifier, kind):
    return connection.execute(
        "INSERT INTO completed_games(game_id,game_type,game_name,finished_at,mode,hardcore,snapshot_json,imported_from_legacy,created_at) "
        "VALUES (?,?, 'Historical result',?,'2',0,'{}',0,?)", (identifier, kind, STAMP, STAMP),
    ).lastrowid


def deleted(connection, identifier, kind, account):
    return connection.execute(
        "INSERT INTO deleted_games(game_id,game_type,game_name,finished_at,mode,hardcore,deleted_at,deleted_by_user_id,reason) "
        "VALUES (?,?, 'Historical deletion',?,'2',0,?,?,'Preserved reason')", (identifier, kind, STAMP, STAMP, account),
    ).lastrowid


def abandoned(connection, identifier, kind, account):
    result = connection.execute(
        "INSERT INTO abandoned_games(game_id,game_type,game_name,mode,hardcore,started_at,abandoned_at,reason,aborted_by_user_id,created_at) "
        "VALUES (?,?, 'Historical abandonment','2',0,?,?,'manual',?,?)", (identifier, kind, STAMP, STAMP, account, STAMP),
    ).lastrowid
    connection.execute("INSERT INTO abandoned_game_participants(abandoned_game_id,user_id,was_abort_initiator) VALUES (?,?,1)",
                       (result, account))
    return result


def snapshot(connection):
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
    return {table: connection.execute(f"SELECT * FROM {table} ORDER BY id").fetchall()
            for table in ("users", "completed_games", "game_participants", "deleted_games", "abandoned_games", "abandoned_game_participants")}


def test_sqlite_upgrade_downgrade_preserves_actual_parent_children_and_existing_products(migration):
    config, connection = migration
    account = user(connection)
    for kind in ("zdwa", "zilch", "hausdepp"):
        row = completed(connection, f"finished-{kind}", kind)
        connection.execute("INSERT INTO game_participants(game_id,position,player_key,display_name,points,user_id) "
                           "VALUES (?,0,'p1','Historical player',8,?)", (row, account))
        deleted(connection, f"deleted-{kind}", kind, account)
    for kind in ("zdwa", "zilch"):
        abandoned(connection, f"abandoned-{kind}", kind, account)
    before = snapshot(connection)
    command.upgrade(config, REVISION)
    assert snapshot(connection) == before
    command.downgrade(config, PREVIOUS)
    assert snapshot(connection) == before
    command.upgrade(config, REVISION)
    assert snapshot(connection) == before
    # Real INSERT and UPDATE enforcement, rather than ORM-only validation.
    for insert in (
        lambda kind: completed(connection, f"new-completed-{kind}", kind),
        lambda kind: deleted(connection, f"new-deleted-{kind}", kind, account),
        lambda kind: abandoned(connection, f"new-abandoned-{kind}", kind, account),
    ):
        insert("watten")
        with pytest.raises(sqlite3.IntegrityError):
            insert("unknown")
    for table in ("completed_games", "deleted_games", "abandoned_games"):
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute(f"UPDATE {table} SET game_type='unknown' WHERE game_type='watten'")
    assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


@pytest.mark.parametrize("kind", ("completed", "deleted", "abandoned"))
def test_downgrade_rejects_each_real_watten_record_kind_without_mutating_old_data(migration, kind):
    config, connection = migration
    account = user(connection)
    command.upgrade(config, REVISION)
    if kind == "completed":
        completed(connection, "retained-watten", "watten")
    elif kind == "deleted":
        deleted(connection, "retained-watten", "watten", account)
    else:
        abandoned(connection, "retained-watten", "watten", account)
    before = snapshot(connection)
    with pytest.raises(RuntimeError, match="Cannot downgrade"):
        command.downgrade(config, PREVIOUS)
    assert snapshot(connection) == before
    assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (REVISION,)


def test_postgresql_branch_replaces_all_three_named_constraints_without_sqlite_triggers(monkeypatch):
    spec = importlib.util.spec_from_file_location("watten_result_migration", BASE / "alembic/versions/20261018_0066_watten_results.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    operations = []

    class Batch:
        def drop_constraint(self, name, **options):
            operations.append(("drop", "abandoned_games", name, options))

        def create_check_constraint(self, name, condition):
            operations.append(("create", "abandoned_games", name, condition))

    @contextmanager
    def batch(table):
        assert table == "abandoned_games"
        yield Batch()

    bind = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"),
                           execute=lambda _sql: SimpleNamespace(scalar_one=lambda: 0))
    monkeypatch.setattr(module, "op", SimpleNamespace(
        get_bind=lambda: bind, batch_alter_table=batch,
        drop_constraint=lambda name, table, **options: operations.append(("drop", table, name, options)),
        create_check_constraint=lambda name, table, condition: operations.append(("create", table, name, condition)),
    ))
    module.upgrade()
    creates = [item for item in operations if item[0] == "create"]
    assert {item[1] for item in creates} == {"completed_games", "deleted_games", "abandoned_games"}
    assert all("'watten'" in item[3] for item in creates)
    assert "'hausdepp'" not in next(item[3] for item in creates if item[1] == "abandoned_games")
    operations.clear()
    module.downgrade()
    assert all("'watten'" not in item[3] for item in operations if item[0] == "create")
