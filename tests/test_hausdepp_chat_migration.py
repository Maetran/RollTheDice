"""Adding the third chat label must preserve historical recipient boundaries."""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command

BASE = Path(__file__).resolve().parents[1]


def test_upgrade_and_downgrade_preserve_chat_messages_and_fixed_audiences(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    url = f"sqlite:///{tmp_path}/chat.sqlite3"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "20261016_0059")
    engine = create_engine(url)
    try:
        with engine.begin() as connection:
            # Nullable sender is a deliberately deleted historical account.
            # No fake account or account-private fields are needed.
            connection.exec_driver_sql(
                "INSERT INTO lobby_chat_messages(id,kind,sender_username,game_type,text,created_at) "
                "VALUES (4,'message','Old player','zilch','Old message','2026-10-16 12:00:00')"
            )
            # Use the actual pre-existing bootstrap account from this database,
            # or create a minimal audience through the historical table defaults.
            connection.exec_driver_sql(
                "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,created_at,updated_at) "
                "VALUES ('Audience','audience','unchanged','user',1,0,'2026-10-16','2026-10-16')"
            )
            account = connection.exec_driver_sql("SELECT id FROM users WHERE username='Audience'").scalar_one()
            connection.exec_driver_sql("INSERT INTO lobby_chat_message_recipients(message_id,user_id) VALUES (4,?)", (account,))
        def snapshot():
            with engine.connect() as connection:
                assert connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall() == []
                return {table: connection.exec_driver_sql(f"SELECT * FROM {table} ORDER BY 1").fetchall()
                        for table in ("lobby_chat_messages", "lobby_chat_message_recipients", "users")}
        before = snapshot()
        command.upgrade(config, "20261016_0061")
        assert snapshot() == before
        command.downgrade(config, "20261016_0059")
        assert snapshot() == before
        command.upgrade(config, "20261016_0061")
        assert snapshot() == before
        with engine.begin() as connection:
            connection.exec_driver_sql(
                "INSERT INTO lobby_chat_messages(kind,sender_username,game_type,text,created_at) "
                "VALUES ('message','House player','hausdepp','New message','2026-10-16 12:01:00')"
            )
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261016_0059")
    finally:
        engine.dispose()
