"""Leaf CHECK rebuilds retain device ownership, frozen audiences and choices."""

import importlib.util
import io
import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations

from alembic import command

BASE = Path(__file__).resolve().parents[1]
PREVIOUS = "20261018_0071"
REVISION = "20261018_0072"


def test_sqlite_leaf_upgrade_preserves_devices_audiences_tour_choices_and_refuses_each_native_downgrade(tmp_path):
    filename = tmp_path / "watten-device-migration.sqlite3"
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{filename}")
    command.upgrade(config, PREVIOUS)
    with closing(sqlite3.connect(filename, isolation_level=None)) as db, db:
        db.execute("PRAGMA foreign_keys=ON")
        account = db.execute(
            "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,created_at,updated_at) "
            "VALUES ('Device migration','devicemigration','unchanged','user',1,0,'2026-10-18','2026-10-18')").lastrowid
        db.execute("INSERT INTO game_tour_preferences(user_id,enabled,zdwa_state,watten_state) VALUES (?,0,'completed','started')", (account,))
        for number, product in enumerate(("zdwa", "zilch", "hausdepp"), 1):
            db.execute(
                "INSERT INTO web_push_subscriptions(id,user_id,endpoint,p256dh,auth,product_context,created_at,updated_at) "
                "VALUES (?,?,?,'preserved-key','preserved-auth',?,'2026-10-18','2026-10-18')",
                (number, account, f"https://fcm.googleapis.com/fcm/send/preserved-{product}", product))
            revision = str(number) * 40
            db.execute(
                "INSERT INTO push_releases(revision,kind,summary_de,summary_en,game_types_json,published_at) "
                "VALUES (?,'backend','Alt','Old',?,'2026-10-18')", (revision, json_product(product)))
            db.execute("INSERT INTO push_release_recipients(revision,user_id,product_context,subscription_snapshot_json) VALUES (?,?,?,?)",
                       (revision, account, product, f'[{{"id":{number},"identity":"frozen-{product}"}}]'))

        def snapshot():
            assert db.execute("PRAGMA foreign_key_check").fetchall() == []
            return {table: db.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() for table in (
                "users", "web_push_subscriptions", "push_releases", "push_release_recipients", "game_tour_preferences")}

        before = snapshot()
        command.upgrade(config, REVISION)
        assert snapshot() == before
        command.downgrade(config, PREVIOUS)
        assert snapshot() == before
        command.upgrade(config, REVISION)
        assert snapshot() == before
        for table in ("web_push_subscriptions", "push_release_recipients"):
            with pytest.raises(sqlite3.IntegrityError, match="CHECK"):
                db.execute(f"UPDATE {table} SET product_context='unknown'")
        native = db.execute(
            "INSERT INTO web_push_subscriptions(user_id,endpoint,p256dh,auth,product_context,created_at,updated_at) "
            "VALUES (?,'https://fcm.googleapis.com/fcm/send/native','key','auth','watten','2026-10-18','2026-10-18')", (account,)).lastrowid
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, PREVIOUS)
        assert db.execute("SELECT product_context FROM web_push_subscriptions WHERE id=?", (native,)).fetchone() == ("watten",)
        db.execute("DELETE FROM web_push_subscriptions WHERE id=?", (native,))
        db.execute("UPDATE push_release_recipients SET product_context='watten' WHERE revision=?", ("1" * 40,))
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, PREVIOUS)
        assert db.execute("SELECT version_num FROM alembic_version").fetchone() == (REVISION,)
        db.execute("UPDATE push_release_recipients SET product_context='zdwa' WHERE revision=?", ("1" * 40,))
        assert snapshot() == before
        command.downgrade(config, PREVIOUS)
        assert snapshot() == before
        command.upgrade(config, REVISION)
        db.execute("DELETE FROM users WHERE id=?", (account,))
        assert db.execute("SELECT COUNT(*) FROM web_push_subscriptions").fetchone() == (0,)
        assert db.execute("SELECT COUNT(*) FROM push_release_recipients").fetchone() == (0,)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


def json_product(product):
    return f'["{product}"]'


def test_postgresql_replacements_compile_named_checks_without_sqlite_rebuild():
    spec = importlib.util.spec_from_file_location("watten_push_migration", BASE / "alembic/versions/20261018_0072_watten_push_context.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    buffer = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer})
    with Operations.context(context):
        module.upgrade()
        module._replace_context_checks("product_context IN ('zdwa', 'zilch', 'hausdepp')")
    sql = buffer.getvalue()
    for table, check in (("web_push_subscriptions", "ck_web_push_subscriptions_product_context"),
                         ("push_release_recipients", "ck_push_release_recipient_context")):
        assert sql.count(f"ALTER TABLE {table} DROP CONSTRAINT {check}") == 2
        assert f"ALTER TABLE {table} ADD CONSTRAINT {check} CHECK (product_context IN ('zdwa', 'zilch', 'hausdepp', 'watten'))" in sql
    assert "_alembic_tmp" not in sql
