"""Listening is private account state; microphone state is never accepted."""

import sqlite3
from contextlib import closing

import pytest
from alembic.config import Config
from starlette.testclient import TestClient

from alembic import command
from app import main
from app.auth import auth_identity_payload, create_user, login, resolve_session
from app.database import session_scope
from app.models import User
from tests import test_game_tours as legacy
from tests.test_user_accounts import request_for

account = legacy.account
tour_store = legacy.tour_store
PATH = "/api/auth/preferences/voice"


def test_listening_default_is_private_and_returns_in_http_and_socket_identity(account, tour_store):
    response = account.client.get("/api/auth/me")
    assert response.json()["user"]["preferences"]["voice_listening_default"] is False
    assert response.headers["cache-control"] == "no-store"
    with TestClient(tour_store) as guest:
        assert guest.get("/api/auth/me").json()["user"] is None
    for enabled in (True, False, True):
        saved = account.client.put(PATH, json={"voice_listening_default": enabled})
        assert saved.status_code == 200
        assert saved.headers["cache-control"] == "no-store"
        assert saved.json() == {"voice_listening_default": enabled}
        assert account.client.get("/api/auth/me").json()["user"]["preferences"]["voice_listening_default"] is enabled
    cookie = account.client.cookies.get("rollthedice_session")
    identity = resolve_session(request_for(cookie=f"rollthedice_session={cookie}"))
    assert auth_identity_payload(identity)["preferences"]["voice_listening_default"] is True
    with session_scope() as db:
        assert db.get(User, account.user_id).voice_listening_default is True


def test_requires_an_account(tour_store):
    with TestClient(tour_store) as client:
        assert client.put(PATH, json={"voice_listening_default": True}).status_code == 401


@pytest.mark.parametrize("headers", [
    {"x-csrf-token": ""}, {"x-csrf-token": "wrong"}, {"origin": "https://foreign.test"},
])
def test_csrf_and_origin_fail_without_changing_preference(account, headers):
    assert account.client.put(PATH, json={"voice_listening_default": True}, headers=headers).status_code == 403
    assert account.client.get("/api/auth/me").json()["user"]["preferences"]["voice_listening_default"] is False


@pytest.mark.parametrize("value", [None, 0, 1, 0.0, "true", "false", "on", [], {}])
def test_boolean_is_strict(account, value):
    assert account.client.put(PATH, json={"voice_listening_default": value}).status_code == 422
    assert account.client.get("/api/auth/me").json()["user"]["preferences"]["voice_listening_default"] is False


@pytest.mark.parametrize("body", [{}, {"voice_listening_default": False, "microphone": True}])
def test_missing_or_unrelated_state_is_rejected(account, body):
    assert account.client.put(PATH, json=body).status_code == 422


def test_stale_account_token_cannot_save_for_new_viewer_and_legacy_settings_preserve_choice(account):
    assert account.client.put(PATH, json={"voice_listening_default": True}).status_code == 200
    old = account.client.put("/api/auth/preferences", json={
        "announce_selection_mode": "table", "auto_write_announced": False, "mobile_row_quick_entry": False,
    })
    assert old.status_code == 200
    assert old.json()["preferences"]["voice_listening_default"] is True
    other = create_user("VoiceOtherAccount", "voice-test-password", must_change_password=False)
    identity, token = login(request_for(), other.username, "voice-test-password")
    account.client.cookies.set("rollthedice_session", token)
    assert account.client.put(PATH, json={"voice_listening_default": True}).status_code == 403
    account.client.headers["x-csrf-token"] = identity.csrf_token
    assert account.client.get("/api/auth/me").json()["user"]["preferences"]["voice_listening_default"] is False
    with session_scope() as db:
        assert db.get(User, account.user_id).voice_listening_default is True
        assert db.get(User, other.id).voice_listening_default is False


def test_migration_backfills_existing_accounts_preserves_fields_and_defaults_new_accounts(tmp_path):
    path = tmp_path / "voice.sqlite3"
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261021_0078")
    with closing(sqlite3.connect(path)) as db, db:
        user = legacy.migration_support.TypedCompletedResultsMigrationTest()._insert_user(db)
        db.execute("UPDATE users SET preferred_language='en',lobby_chat_enabled=0 WHERE id=?", (user,))
    command.upgrade(config, "head")
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute("SELECT voice_listening_default,preferred_language,lobby_chat_enabled FROM users WHERE id=?", (user,)).fetchone() == (0, "en", 0)
        db.execute("UPDATE users SET voice_listening_default=1 WHERE id=?", (user,))
        # A raw insert exercises the database default independently of ORM defaults.
        columns = [row[1] for row in db.execute("PRAGMA table_info(users)")
                   if row[1] not in {"id", "username", "username_normalized", "voice_listening_default"}]
        names = ",".join(columns)
        db.execute(f"INSERT INTO users (username,username_normalized,{names}) "
                   f"SELECT 'Voice New','voicenew',{names} FROM users WHERE id=?", (user,))
        assert db.execute("SELECT voice_listening_default FROM users WHERE username='Voice New'").fetchone() == (0,)
    command.upgrade(config, "head")
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("SELECT voice_listening_default FROM users WHERE id=?", (user,)).fetchone() == (1,)


@pytest.mark.parametrize("has_owner", [False, True])
def test_migration_roundtrip_preserves_ownership_guards_and_durable_events(tmp_path, has_owner):
    path = tmp_path / "voice-ownership-roundtrip.sqlite3"
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261021_0078")
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        user = legacy.migration_support.TypedCompletedResultsMigrationTest()._insert_user(db)
        if has_owner:
            db.execute("INSERT INTO account_ownerships(user_id,is_founder,created_at) VALUES (?,1,'2026-10-25')", (user,))
        action = "founder_bound" if has_owner else "revoked"
        db.execute("INSERT INTO ownership_audit(user_id,action,created_at) VALUES (?,?,'2026-10-25')", (user, action))
        db.execute("INSERT INTO user_engagement_events(user_id,event_key,first_seen_at,last_seen_at,count) "
                   "VALUES (?,'settings_saved','2026-10-25','2026-10-25',3)", (user,))
        tables = ("account_ownerships", "ownership_audit", "user_engagement_events")
        rows = {table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() for table in tables}
        account_fields = "id,username,password_hash,role,is_active,preferred_language"
        accounts = db.execute(f"SELECT {account_fields} FROM users ORDER BY id").fetchall()
        triggers = db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'ownership_%' ORDER BY name").fetchall()
        assert any(name == "ownership_eligible" and "FROM users" in sql for name, sql in triggers)
    command.upgrade(config, "head")
    command.downgrade(config, "20261021_0078")
    with closing(sqlite3.connect(path)) as db:
        assert "voice_listening_default" not in {row[1] for row in db.execute("PRAGMA table_info(users)")}
    command.upgrade(config, "head")
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        assert db.execute(f"SELECT {account_fields} FROM users ORDER BY id").fetchall() == accounts
        assert {table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() for table in tables} == rows
        assert db.execute("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'ownership_%' ORDER BY name").fetchall() == triggers
        assert db.execute("SELECT voice_listening_default FROM users WHERE id=?", (user,)).fetchone() == (0,)
        if has_owner:
            with pytest.raises(sqlite3.IntegrityError, match="owner_protected"):
                db.execute("UPDATE users SET role='user' WHERE id=?", (user,))
        with pytest.raises(sqlite3.IntegrityError, match="ownership_requires_eligible_admin"):
            db.execute("INSERT INTO account_ownerships(user_id,is_founder,created_at) VALUES (999999,0,'2026-10-25')")
        with pytest.raises(sqlite3.IntegrityError, match="ownership_audit_immutable"):
            db.execute("UPDATE ownership_audit SET action='revoked' WHERE user_id=?", (user,))
