"""Caller-owned recipe storage, strict private codecs and additive schema."""

import importlib.util
import io
import json
import sqlite3
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, delete, event, func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from alembic import command
from app.models import User, WattenFavorite
from app.watten_favorites import (
    WattenFavoriteError,
    delete_watten_favorite,
    read_watten_favorite,
    save_watten_favorite,
)
from app.watten_recipe import WattenRecipe, recipe_to_json, recipe_to_payload
from tests.test_watten_results_migration import snapshot, user

BASE = Path(__file__).resolve().parents[1]
PROTECTED = WattenRecipe(4, "ladinisch", True, True, cpu_seats=(2, 0), password_required=True)


@pytest.fixture
def storage(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'favorites.sqlite3'}")

    @event.listens_for(engine, "connect")
    def foreign_keys(connection, _record):
        connection.execute("PRAGMA foreign_keys=ON")

    User.__table__.create(engine)
    WattenFavorite.__table__.create(engine)
    with Session(engine) as db:
        stamp = datetime(2026, 10, 18, tzinfo=timezone.utc)
        db.add_all(User(username=name, username_normalized=name.lower(), password_hash="unused",
                        created_at=stamp, updated_at=stamp, zdwa_design_prompted_at=stamp)
                   for name in ("FavoriteOwner", "FavoriteOther", "InactiveOwner"))
        db.flush()
        db.get(User, 3).is_active = False
        db.commit()
    try:
        yield engine
    finally:
        engine.dispose()


def test_replace_reload_account_isolation_and_protection_are_explicit(storage):
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=1) is None
        saved = save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        assert saved == PROTECTED and saved is not PROTECTED and saved.password_required
        assert read_watten_favorite(db, user_id=2) is None
        other = WattenRecipe(2, "normal", False, False)
        save_watten_favorite(db, user_id=2, recipe=other)
        db.commit()
    replacement = replace(PROTECTED, target_points=21, show_rechter=True)
    with Session(storage) as db:
        db.get(User, 1).username = "RenamedFavoriteOwner"
        assert save_watten_favorite(db, user_id=1, recipe=replacement) == replacement
        db.commit()
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=1) == replacement
        assert read_watten_favorite(db, user_id=1).password_required is True
        assert read_watten_favorite(db, user_id=2) == other
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 2
        delete_watten_favorite(db, user_id=2)
        delete_watten_favorite(db, user_id=2)
        assert read_watten_favorite(db, user_id=1) == replacement
        db.commit()
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=2) is None
        # Protection changes only through an explicit replacement recipe.
        unprotected = replace(replacement, password_required=False)
        save_watten_favorite(db, user_id=1, recipe=unprotected)
        db.commit()
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=1) == unprotected


def test_only_canonical_allowlist_json_is_stored_and_account_delete_cascades(storage):
    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        row = db.get(WattenFavorite, 1)
        assert row.recipe_json == recipe_to_json(PROTECTED)
        assert json.loads(row.recipe_json) == recipe_to_payload(PROTECTED)
        assert set(WattenFavorite.__table__.columns.keys()) == {"user_id", "recipe_json"}
        assert not set(json.loads(row.recipe_json)) & {
            "password", "passphrase", "verifier", "reservation", "account_id", "user_id", "participant_id",
            "hand", "hands", "stock", "call", "invite", "invitation", "session", "game_id",
        }
        db.execute(delete(User).where(User.id == 1))
        db.commit()
    with Session(storage) as db:
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 0


def test_save_and_delete_never_commit_the_callers_transaction(storage):
    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.rollback()
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=1) is None
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        delete_watten_favorite(db, user_id=1)
        db.rollback()
    with Session(storage) as db:
        assert read_watten_favorite(db, user_id=1) == PROTECTED


def test_read_is_select_only_and_never_autoflushes_pending_caller_work(storage):
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        db.get(User, 1).username = "PendingRename"
        event.listen(storage, "before_cursor_execute", observed)
        try:
            assert read_watten_favorite(db, user_id=1) == PROTECTED
            assert read_watten_favorite(db, user_id=2) is None
        finally:
            event.remove(storage, "before_cursor_execute", observed)
        assert statements and all(sql.lstrip().upper().startswith("SELECT") for sql in statements)
        assert db.dirty
        db.rollback()


@pytest.mark.parametrize("identifier", (True, False, 0, -1, "1", 1.0, None, 3, 999))
def test_invalid_inactive_and_missing_accounts_cannot_read_save_or_delete(storage, identifier):
    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        for method in (read_watten_favorite, save_watten_favorite, delete_watten_favorite):
            with pytest.raises(WattenFavoriteError, match="invalid_account"):
                method(db, user_id=identifier, **({"recipe": PROTECTED} if method is save_watten_favorite else {}))
            assert read_watten_favorite(db, user_id=1) == PROTECTED
        assert db.scalar(select(func.count()).select_from(WattenFavorite)) == 1


@pytest.mark.parametrize("damage", ("wrong_type", "target", "ruleset", "cpu_seats", "flag", "profile"))
def test_invalid_recipe_rejected_before_any_write_or_autoflush(storage, damage):
    bad = replace(PROTECTED)
    if damage == "wrong_type":
        bad = {**recipe_to_payload(PROTECTED), "passphrase": "must-never-be-stored"}
    else:
        field, value = {"target": ("target_points", True), "ruleset": ("ruleset_version", 2),
                        "cpu_seats": ("cpu_seats", (0, 1, 2, 3)), "flag": ("password_required", 1),
                        "profile": ("player_count", 3)}[damage]
        object.__setattr__(bad, field, value)
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        db.get(User, 1).username = "PendingInvalidSave"
        event.listen(storage, "before_cursor_execute", observed)
        try:
            with pytest.raises(WattenFavoriteError, match="invalid_recipe"):
                save_watten_favorite(db, user_id=1, recipe=bad)
        finally:
            event.remove(storage, "before_cursor_execute", observed)
        assert statements == [] and db.dirty
        assert read_watten_favorite(db, user_id=1) == PROTECTED
        db.rollback()


@pytest.mark.parametrize("damage", ("malformed", "unknown_schema", "unknown_ruleset", "secret", "duplicate", "missing"))
def test_invalid_stored_recipe_fails_closed_without_repair_or_default(storage, damage):
    payload = recipe_to_payload(PROTECTED)
    if damage == "malformed":
        raw = "not json"
    elif damage == "duplicate":
        raw = recipe_to_json(PROTECTED)[:-1] + ',"password_required":false}'
    else:
        if damage == "unknown_schema":
            payload["schema_version"] = 2
        elif damage == "unknown_ruleset":
            payload["ruleset_version"] = 2
        elif damage == "secret":
            payload["password"] = "must-never-be-returned"
        else:
            payload.pop("password_required")
        raw = json.dumps(payload)
    with Session(storage) as db:
        db.add(WattenFavorite(user_id=1, recipe_json=raw))
        db.commit()
        with pytest.raises(WattenFavoriteError, match="invalid_recipe"):
            read_watten_favorite(db, user_id=1)
        assert db.scalar(select(WattenFavorite.recipe_json)) == raw
        assert read_watten_favorite(db, user_id=2) is None


def test_pending_account_deactivation_is_seen_before_mutation(storage):
    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()
        db.get(User, 1).is_active = False
        with pytest.raises(WattenFavoriteError, match="invalid_account"):
            save_watten_favorite(db, user_id=1, recipe=replace(PROTECTED, target_points=99))
        db.rollback()
        assert read_watten_favorite(db, user_id=1) == PROTECTED


@pytest.mark.parametrize("operation", ("save", "delete"))
def test_sqlite_deactivation_between_account_check_and_write_cannot_change_favorite(storage, operation):
    with Session(storage) as db:
        save_watten_favorite(db, user_id=1, recipe=PROTECTED)
        db.commit()

        def deactivate(connection, _cursor, statement, _parameters, _context, _many):
            prefix = "INSERT INTO watten_favorites" if operation == "save" else "DELETE FROM watten_favorites"
            if statement.startswith(prefix):
                connection.exec_driver_sql("UPDATE users SET is_active=0 WHERE id=1")

        event.listen(storage, "before_cursor_execute", deactivate)
        try:
            with pytest.raises(WattenFavoriteError, match="invalid_account"):
                if operation == "save":
                    save_watten_favorite(db, user_id=1, recipe=replace(PROTECTED, target_points=99))
                else:
                    delete_watten_favorite(db, user_id=1)
        finally:
            event.remove(storage, "before_cursor_execute", deactivate)
        assert db.scalar(select(WattenFavorite.recipe_json)) == recipe_to_json(PROTECTED)
        db.rollback()
        assert read_watten_favorite(db, user_id=1) == PROTECTED


def test_additive_migration_preserves_existing_rows_and_enforces_account_fk(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    path = tmp_path / "favorite-migration.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261018_0068")
    with sqlite3.connect(path, isolation_level=None) as db:
        db.execute("PRAGMA foreign_keys=ON")
        owner = user(db)
        db.execute("INSERT INTO hausdepp_preferences(user_id,auto_refill,favourite_preset_json) VALUES (?,1,'{}')", (owner,))
        db.execute("INSERT INTO watten_progress_states VALUES (?,1,0,0)", (owner,))
        before = snapshot(db)
        journal = db.execute("SELECT * FROM watten_progress_states").fetchall()
        hausdepp = db.execute("SELECT * FROM hausdepp_preferences").fetchall()
        command.upgrade(config, "20261018_0069")
        assert snapshot(db) == before
        assert db.execute("SELECT * FROM watten_progress_states").fetchall() == journal
        assert db.execute("SELECT * FROM hausdepp_preferences").fetchall() == hausdepp
        command.downgrade(config, "20261018_0068")
        command.upgrade(config, "20261018_0069")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO watten_favorites VALUES (?,?)", (owner + 999, recipe_to_json(PROTECTED)))
        db.execute("INSERT INTO watten_favorites VALUES (?,?)", (owner, recipe_to_json(PROTECTED)))
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261018_0068")
        assert db.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "20261018_0069"
        db.execute("DELETE FROM users WHERE id=?", (owner,))
        assert db.execute("SELECT * FROM watten_favorites").fetchall() == []
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def test_postgresql_sqlite_ddl_and_upsert_contract_without_claiming_server_execution():
    path = BASE / "alembic/versions/20261018_0069_watten_favorites.py"
    spec = importlib.util.spec_from_file_location("watten_favorites_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        module.upgrade()
    assert "REFERENCES users (id) ON DELETE CASCADE" in output.getvalue()
    for dialect in (postgresql.dialect(), sqlite.dialect()):
        ddl = str(CreateTable(WattenFavorite.__table__).compile(dialect=dialect))
        assert "PRIMARY KEY (user_id)" in ddl and "recipe_json TEXT NOT NULL" in ddl


def test_postgresql_save_builds_the_atomic_canonical_upsert(storage):
    statements = []
    with Session(storage) as db:
        # Real account checks; capture only the PostgreSQL write for compilation.
        caller = SimpleNamespace(no_autoflush=db.no_autoflush, scalar=db.scalar, flush=db.flush,
                                 get_bind=lambda: SimpleNamespace(dialect=postgresql.dialect()), execute=statements.append)
        assert save_watten_favorite(caller, user_id=1, recipe=PROTECTED) == PROTECTED
    assert len(statements) == 1
    compiled = statements[0].compile(dialect=postgresql.dialect())
    assert "ON CONFLICT (user_id) DO UPDATE SET recipe_json = excluded.recipe_json" in str(compiled)
    assert set(compiled.params.values()) == {1, recipe_to_json(PROTECTED)}
    assert "users.is_active IS true" in str(compiled)
