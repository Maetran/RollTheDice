"""Lossless SQLite audience rebuild and compiled PostgreSQL CHECK DDL."""

import importlib.util
import io
import sqlite3
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PREVIOUS = "20261018_0069"
REVISION = "20261018_0070"


def test_upgrade_downgrade_retains_all_old_messages_and_frozen_audience_with_live_foreign_keys(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    filename = tmp_path / "watten-chat.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{filename}")
    command.upgrade(config, PREVIOUS)
    with sqlite3.connect(filename, isolation_level=None) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        users = [connection.execute(
            "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,created_at,updated_at) "
            "VALUES (?,?,'unchanged','user',1,0,'2026-10-18','2026-10-18')", (name, name.lower()),
        ).lastrowid for name in ("AudienceOne", "AudienceTwo")]
        for number, game in enumerate(("zdwa", "zilch", "hausdepp"), start=1):
            connection.execute(
                "INSERT INTO lobby_chat_messages(id,kind,sender_username,game_type,text,created_at) "
                "VALUES (?,'message','Deleted historical player',?,'Preserved text','2026-10-18')", (number, game))
            for account in users[:number % 2 + 1]:
                connection.execute("INSERT INTO lobby_chat_message_recipients(message_id,user_id) VALUES (?,?)", (number, account))

        def snapshot():
            assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
            return {table: connection.execute(f"SELECT * FROM {table} ORDER BY 1,2").fetchall()
                    for table in ("lobby_chat_messages", "lobby_chat_message_recipients", "users")}

        before = snapshot()
        command.upgrade(config, REVISION)
        assert snapshot() == before
        command.downgrade(config, PREVIOUS)
        assert snapshot() == before
        command.upgrade(config, REVISION)
        assert snapshot() == before
        message = connection.execute(
            "INSERT INTO lobby_chat_messages(kind,sender_user_id,sender_username,game_type,text,created_at) "
            "VALUES ('message',?,'Preview player','watten','Native message','2026-10-18')", (users[0],)).lastrowid
        connection.execute("INSERT INTO lobby_chat_message_recipients(message_id,user_id) VALUES (?,?)", (message, users[1]))
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute("UPDATE lobby_chat_messages SET game_type='unknown' WHERE id=?", (message,))
        with pytest.raises(RuntimeError, match="Cannot downgrade while Watten chat messages exist"):
            command.downgrade(config, PREVIOUS)
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (REVISION,)
        connection.execute("DELETE FROM users WHERE id=?", (users[0],))
        assert connection.execute("SELECT sender_user_id FROM lobby_chat_messages WHERE id=?", (message,)).fetchone() == (None,)
        connection.execute("DELETE FROM lobby_chat_messages WHERE id=?", (message,))
        assert connection.execute("SELECT 1 FROM lobby_chat_message_recipients WHERE message_id=?", (message,)).fetchone() is None
        command.downgrade(config, PREVIOUS)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
            connection.execute(
                "INSERT INTO lobby_chat_messages(kind,sender_username,game_type,created_at) "
                "VALUES ('message','Unreleased','watten','2026-10-18')")


def test_postgresql_upgrade_and_legacy_replacement_compile_named_check_without_sqlite_backup():
    spec = importlib.util.spec_from_file_location("watten_chat_migration", BASE / "alembic/versions/20261018_0070_watten_lobby_chat.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    buffer = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer})
    with Operations.context(context):
        module.upgrade()
        module._replace_check("game_type IN ('zdwa', 'zilch', 'hausdepp')")
    sql = buffer.getvalue()
    assert sql.count("ALTER TABLE lobby_chat_messages DROP CONSTRAINT ck_lobby_chat_messages_game_type") == 2
    assert "CHECK (game_type IN ('zdwa', 'zilch', 'hausdepp', 'watten'))" in sql
    assert "CHECK (game_type IN ('zdwa', 'zilch', 'hausdepp'))" in sql
    assert "TEMP" not in sql and "audience_backup" not in sql
