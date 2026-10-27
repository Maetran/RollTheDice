"""Persistent release policy, real HTTP permissions and transactional history."""

import importlib.util
import io
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import delete, func, inspect, select, update
from sqlalchemy.exc import IntegrityError

from alembic import command
from app import main
from app.api_features import router
from app.auth import issue_session_for_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.feature_flags import (
    FEATURES,
    account_can_activate_feature,
    feature_catalog,
    feature_settings,
    feature_status,
    game_beta,
    is_feature_staff,
    lock_feature_policies,
    public_game_beta,
    set_feature_settings,
)
from app.models import AccountOwnership, Base, FeatureFlag, FeatureFlagAudit, FeaturePolicyLock, GamePresentation, User
from app.models import Session as LoginSession

BASE = Path(__file__).resolve().parents[1]
KEY = "watten.schoeneres"
REVISION = "20261026_0082"
PREVIOUS = "20261025_0081"


@pytest.fixture
def store(tmp_path):
    with patch.dict("os.environ", {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/features.sqlite"}):
        configure_database(tmp_path)
        upgrade_database(BASE)
        now = datetime.now(timezone.utc)
        with session_scope() as db:
            db.add_all(User(id=i, username=f"Feature{i}", username_normalized=f"feature{i}",
                            role="user" if i == 3 else "admin", password_hash="unused",
                            created_at=now, updated_at=now) for i in range(1, 5))
            db.flush()
            db.add_all([AccountOwnership(user_id=1, is_founder=True, created_at=now),
                        AccountOwnership(user_id=4, is_founder=False, granted_by_user_id=1, created_at=now)])
            db.flush()
            identities = {i: issue_session_for_user(db, db.get(User, i)) for i in range(1, 5)}
        yield identities
    configure_database(main.DATA_DIR)


@pytest.fixture
def client(store):
    application = FastAPI()
    application.include_router(router)
    with TestClient(application, base_url="http://testserver", headers={"Origin": "http://testserver"}) as client:
        sign_in(client, store, 1)
        yield client


def sign_in(client, identities, user_id):
    identity, token = identities[user_id]
    client.cookies.set("rollthedice_session", token)
    client.headers["X-CSRF-Token"] = identity.csrf_token
    client.headers["X-Account-Expected-Id"] = str(user_id)


def change(client, *, status="public", beta=False, version=0, key=KEY):
    return client.put(f"/api/admin/features/{key}", json={"status": status, "beta": beta, "version": version})


def test_defaults_are_explicit_and_reads_never_create_settings(store):
    with session_scope() as db:
        assert {feature_settings(db, definition.key)["status"] for definition in FEATURES} == {"internal"}
        assert {definition.key for definition in FEATURES} == {
            "hausdepp.four_of_a_kind_as_ten",
            "watten.schoeneres", "watten.schlagwechsel", "watten.critical", "watten.show_rechter",
            "watten.trick_history", "watten.open_partner_hand",
        }
        assert feature_settings(db, KEY)["version"] == 0
        assert feature_settings(db, KEY)["updated_at"] is None
        assert game_beta(db, "watten")
        assert not any(game_beta(db, game) for game in ("zdwa", "zilch", "hausdepp"))
        assert db.scalar(select(func.count()).select_from(FeatureFlag)) == 0
        assert db.scalar(select(func.count()).select_from(GamePresentation)) == 0
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 0
    assert public_game_beta("watten")


def test_public_capabilities_hide_activation_from_ordinary_users_and_bind_identity(client, store):
    admin = client.get("/api/features")
    assert admin.status_code == 200
    assert admin.json()["features"][KEY] == {"status": "internal", "beta": False, "can_select": True}
    assert admin.json()["viewer_id"] == 1
    assert "audit" not in admin.json()
    assert "actor" not in admin.text
    assert admin.headers["cache-control"] == "no-store"
    sign_in(client, store, 3)
    player = client.get("/api/features")
    assert not player.json()["features"][KEY]["can_select"]
    assert player.json()["viewer_id"] == 3
    assert client.get("/api/features", headers={"X-Watten-Expected-Account-Id": "1"}).status_code == 409
    assert client.get("/api/features", headers={"X-Watten-Expected-Account-Id": "03"}).status_code == 409
    client.headers.pop("X-Account-Expected-Id")
    client.cookies.clear()
    anonymous = client.get("/api/features")
    assert anonymous.status_code == 200
    assert anonymous.json()["viewer_id"] is None
    assert not anonymous.json()["features"][KEY]["can_select"]
    assert anonymous.json()["games"]["watten"]["beta"]


def test_owner_writes_are_persistent_and_admin_can_only_read(client, store):
    initial = client.get("/api/admin/features")
    assert initial.status_code == 200 and initial.json()["can_manage"]
    assert initial.json()["viewer_id"] == 1
    assert initial.headers["x-robots-tag"] == "noindex, nofollow"
    published = change(client, beta=True)
    assert published.status_code == 200, published.text
    assert published.json()["beta"] and published.json()["version"] == 1
    assert published.json()["updated_at"]
    sign_in(client, store, 2)
    admin = client.get("/api/admin/features")
    assert admin.status_code == 200 and not admin.json()["can_manage"]
    assert admin.json()["viewer_id"] == 2
    assert next(feature for feature in admin.json()["features"] if feature["key"] == KEY)["beta"]
    assert change(client, status="off", version=1).status_code == 403
    assert client.put("/api/admin/features/games/watten/beta", json={"beta": False, "version": 0}).status_code == 403
    sign_in(client, store, 3)
    assert client.get("/api/admin/features").status_code == 403
    assert change(client, status="off", version=1).status_code == 403
    assert client.get("/api/features").json()["features"][KEY]["can_select"]
    client.headers.pop("X-Account-Expected-Id")
    client.cookies.clear()
    assert client.get("/api/admin/features").status_code == 401
    with session_scope() as db:
        assert feature_settings(db, KEY)["status"] == "public"
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 1


@pytest.mark.parametrize("headers", [{"X-CSRF-Token": "wrong"}, {"Origin": "https://other.example"}])
def test_actual_csrf_and_origin_required_for_both_mutations(client, headers):
    result = client.put(f"/api/admin/features/{KEY}", headers=headers,
                        json={"status": "public", "beta": False, "version": 0})
    assert result.status_code == 403
    assert client.put("/api/admin/features/games/watten/beta", headers=headers,
                      json={"beta": False, "version": 0}).status_code == 403
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 0


@pytest.mark.parametrize("change_kind", ["owner", "role", "active", "session"])
def test_stale_authenticated_owner_cannot_write_after_current_authority_is_revoked(client, store, change_kind):
    sign_in(client, store, 4)
    identity = store[4][0]
    with session_scope() as db:
        if change_kind != "session":
            # Staff role/activation changes require prior owner revocation;
            # retain the real database protections, including the founder.
            db.execute(delete(AccountOwnership).where(AccountOwnership.user_id == 4))
        if change_kind == "role":
            db.get(User, 4).role = "user"
        elif change_kind == "active":
            db.get(User, 4).is_active = False
        elif change_kind == "session":
            db.execute(delete(LoginSession).where(LoginSession.id == identity.session_id))
    # Pin the identity at the HTTP precheck to exercise the later locked check.
    with patch("app.api_features.require_admin", return_value=identity):
        response = change(client)
    assert response.status_code in (401, 403), response.text
    with session_scope() as db:
        assert feature_status(db, KEY) == "internal"
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 0


def test_version_conflict_never_overwrites_or_records_a_second_change(client):
    assert change(client, beta=True).status_code == 200
    stale = change(client, status="off", version=0)
    assert stale.status_code == 409 and stale.json()["detail"] == "feature_settings_changed"
    assert change(client, status="internal", version=1).status_code == 200
    data = client.get("/api/admin/features").json()
    item = next(feature for feature in data["features"] if feature["key"] == KEY)
    assert item["status"] == "internal" and not item["beta"] and item["version"] == 2
    assert len(data["audit"]) == 2
    newest = data["audit"][0]
    assert newest["actor_user_id"] == 1 and newest["actor_username"] == "Feature1"
    assert newest["before"] == {"status": "public", "beta": True}
    assert newest["after"] == {"status": "internal", "beta": False}


@pytest.mark.parametrize("body", [
    {"status": "internal", "beta": True, "version": 0},
    {"status": "off", "beta": True, "version": 0},
    {"status": "unknown", "beta": False, "version": 0},
    {"status": "public", "beta": "yes", "version": 0},
    {"status": "public", "beta": False, "version": -1},
    {"status": "public", "beta": False, "version": True},
    {"status": "public", "beta": False, "version": 0, "arbitrary": "flag"},
])
def test_invalid_settings_cannot_change_release_policy(client, body):
    assert client.put(f"/api/admin/features/{KEY}", json=body).status_code == 422
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(FeatureFlag)) == 0
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 0


def test_unknown_features_and_games_are_rejected_not_invented(client):
    assert change(client, key="suite.invented").status_code == 404
    assert client.put("/api/admin/features/games/unknown/beta", json={"beta": True, "version": 0}).status_code == 404
    with session_scope() as db:
        with pytest.raises(HTTPException, match="feature_not_found"):
            feature_status(db, "watten.unknown")


def test_game_beta_is_independent_of_feature_availability_and_audited(client):
    assert change(client, status="off").status_code == 200
    result = client.put("/api/admin/features/games/watten/beta", json={"beta": False, "version": 0})
    assert result.status_code == 200 and result.json()["version"] == 1 and not result.json()["beta"]
    assert client.put("/api/admin/features/games/watten/beta", json={"beta": True, "version": 0}).status_code == 409
    assert client.put("/api/admin/features/games/zilch/beta", json={"beta": True, "version": 0}).status_code == 200
    with session_scope() as db:
        assert not game_beta(db, "watten") and game_beta(db, "zilch")
        assert feature_status(db, KEY) == "off"
    assert not public_game_beta("watten")
    changes = client.get("/api/admin/features").json()["audit"]
    assert changes[0]["key"] == "zilch" and changes[0]["target_type"] == "game"
    assert changes[0]["before"] == {"beta": False} and changes[0]["after"] == {"beta": True}


def test_settings_and_audit_rollback_together_on_audit_failure(store):
    with pytest.raises(RuntimeError, match="audit failed"), session_scope() as db:
        with patch("app.feature_flags.FeatureFlagAudit", side_effect=RuntimeError("audit failed")):
            set_feature_settings(db, actor_user_id=1, key=KEY, status="public", beta=True, version=0)
    with session_scope() as db:
        assert feature_status(db, KEY) == "internal"
        assert db.scalar(select(func.count()).select_from(FeatureFlag)) == 0
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 0


def test_long_lived_orm_rows_do_not_cache_policy_or_account_authority(store):
    with session_scope() as db:
        set_feature_settings(db, actor_user_id=1, key=KEY, status="internal", beta=False, version=0)
    with session_scope() as reader:
        cached_flag = reader.get(FeatureFlag, KEY)
        cached_account = reader.get(User, 2)
        assert cached_flag.status == "internal" and account_can_activate_feature(reader, cached_account, KEY)
        with session_scope() as writer:
            set_feature_settings(writer, actor_user_id=1, key=KEY, status="off", beta=False, version=1)
            writer.execute(update(User).where(User.id == 2).values(role="user"))
        assert feature_status(reader, KEY) == "off"
        assert not is_feature_staff(reader, cached_account)
        assert not account_can_activate_feature(reader, cached_account, KEY)
        assert not feature_catalog(reader, cached_account)["features"][KEY]["can_select"]
        assert not is_feature_staff(reader, 2)


def test_cached_owner_membership_cannot_outlive_revocation(store):
    with session_scope() as reader:
        membership = reader.get(AccountOwnership, 4)
        assert membership is not None
        with session_scope() as writer:
            writer.execute(delete(AccountOwnership).where(AccountOwnership.user_id == 4))
        with pytest.raises(HTTPException, match="owner_required"):
            set_feature_settings(reader, actor_user_id=4, key=KEY, status="public", beta=False, version=0)


def test_stale_admin_identity_cannot_read_after_staff_revocation(client, store):
    sign_in(client, store, 2)
    with session_scope() as db:
        db.get(User, 2).role = "user"
    with patch("app.api_features.require_admin", return_value=store[2][0]):
        result = client.get("/api/admin/features")
    assert result.status_code == 403
    assert result.json()["detail"] == "admin_required"


def test_concurrent_owner_changes_use_one_version_and_one_audit(store):
    ready = Barrier(2)

    def write(actor_id, status):
        ready.wait(timeout=10)
        try:
            with session_scope() as db:
                return set_feature_settings(db, actor_user_id=actor_id, key=KEY,
                                            status=status, beta=False, version=0)["status"]
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(write, 1, "public"), executor.submit(write, 4, "off")]
        results = [future.result(timeout=15) for future in futures]
    assert results.count(409) == 1
    with session_scope() as db:
        assert feature_settings(db, KEY)["version"] == 1
        assert db.scalar(select(func.count()).select_from(FeatureFlagAudit)) == 1


def test_missing_policy_guard_fails_closed(store):
    with session_scope() as db:
        db.execute(delete(FeaturePolicyLock))
    with pytest.raises(HTTPException, match="feature_settings_unavailable"), session_scope() as db:
        lock_feature_policies(db)


def test_database_enforces_status_beta_version_and_game_constraints(store):
    now = datetime.now(timezone.utc)
    invalid = [
        FeatureFlag(key=KEY, status="internal", beta=True, version=1, updated_at=now),
        FeatureFlag(key=KEY, status="unexpected", beta=False, version=1, updated_at=now),
        FeatureFlag(key=KEY, status="public", beta=False, version=0, updated_at=now),
        GamePresentation(game="unknown", beta=False, version=1, updated_at=now),
    ]
    for row in invalid:
        with pytest.raises(IntegrityError), session_scope() as db:
            db.add(row)


def test_bootstrap_game_labels_use_explicit_defaults_without_hiding_database_errors():
    with patch("app.feature_flags.database_schema_ready", return_value=False), \
            patch("app.feature_flags.session_scope", side_effect=AssertionError("no startup database")):
        assert public_game_beta("watten")
        assert not public_game_beta("hausdepp")
    with patch("app.feature_flags.database_schema_ready", return_value=True), \
            patch("app.feature_flags.session_scope", side_effect=RuntimeError("database failed")), \
            pytest.raises(RuntimeError, match="database failed"):
        public_game_beta("watten")


def test_upgrade_downgrade_preserves_users_and_matches_model_tables(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    filename = tmp_path / "feature-migration.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{filename}")
    command.upgrade(config, PREVIOUS)
    with closing(sqlite3.connect(filename, isolation_level=None)) as connection, connection:
        connection.execute("PRAGMA foreign_keys=ON")
        account_id = connection.execute(
            "INSERT INTO users(username,username_normalized,password_hash,role,is_active,must_change_password,"
            "created_at,updated_at) VALUES ('Retained','retained','unchanged','admin',1,0,'2026-10-26','2026-10-26')",
        ).lastrowid
        before = connection.execute("SELECT * FROM users").fetchall()
        command.upgrade(config, REVISION)
        assert connection.execute("SELECT * FROM users").fetchall() == before
        assert connection.execute("SELECT id FROM feature_policy_lock").fetchall() == [(1,)]
        connection.execute(
            "INSERT INTO feature_flags VALUES (?, 'public', 1, 1, '2026-10-26', ?)", (KEY, account_id))
        connection.execute("INSERT INTO feature_flag_audit(target_type,target_key,actor_user_id,actor_username,"
                           "before_json,after_json,created_at) VALUES ('feature',?,?, 'Retained', '{}', ?, '2026-10-26')",
                           (KEY, account_id, json.dumps({"beta": True})))
        connection.execute("DELETE FROM users WHERE id=?", (account_id,))
        assert connection.execute("SELECT updated_by_user_id FROM feature_flags").fetchone() == (None,)
        assert connection.execute("SELECT actor_user_id FROM feature_flag_audit").fetchone() == (account_id,)
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        command.downgrade(config, PREVIOUS)
        assert connection.execute("SELECT name FROM sqlite_master WHERE name='feature_flags'").fetchone() is None
        command.upgrade(config, REVISION)
        assert connection.execute("SELECT id FROM feature_policy_lock").fetchall() == [(1,)]


def test_migration_tables_match_orm_and_postgresql_ddl_compiles(store):
    inspector = inspect(get_engine())
    for name in ("feature_flags", "feature_flag_audit", "game_presentations", "feature_policy_lock"):
        assert {column["name"] for column in inspector.get_columns(name)} == set(Base.metadata.tables[name].c.keys())
        assert {constraint["name"] for constraint in inspector.get_check_constraints(name)} == {
            constraint.name for constraint in Base.metadata.tables[name].constraints
            if constraint.__class__.__name__ == "CheckConstraint"
        }
    spec = importlib.util.spec_from_file_location("feature_migration", BASE / "alembic/versions/20261026_0082_game_feature_settings.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    buffer = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": buffer})
    with Operations.context(context):
        module.upgrade()
        module.downgrade()
    sql = buffer.getvalue()
    assert "CREATE TABLE feature_flags" in sql
    assert "INSERT INTO feature_policy_lock (id) VALUES (1)" in sql
    assert "status = 'public' OR beta = false" in sql
    assert "DROP TABLE feature_policy_lock" in sql
