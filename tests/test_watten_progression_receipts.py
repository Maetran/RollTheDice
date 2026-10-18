"""Per-match DRAFT presentation receipts, independent of global journal ACKs."""

import importlib.util
import io
import sqlite3
from datetime import timedelta
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import event, func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateTable

from alembic import command
from app import watten_progression_receipts as receipts
from app.database import get_engine, session_scope
from app.models import (
    User,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
    WattenMatchPresentationAck,
    WattenProgressState,
)
from app.watten_progression_store import acknowledge_draft_progress, store_draft_match
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_evidence import FINISHED
from tests.test_watten_progression_store import JOURNAL_MODELS, game_for, written
from tests.test_watten_results_migration import snapshot, user

server = runtime_tests.server
BASE = Path(__file__).resolve().parents[1]


def sequences(db, user_id, game_id):
    credit = db.scalar(select(WattenMatchCredit.grant_sequence).where(
        WattenMatchCredit.user_id == user_id, WattenMatchCredit.generation == 1, WattenMatchCredit.game_id == game_id))
    grants = tuple(db.scalars(select(WattenAchievementGrant.grant_sequence).where(
        WattenAchievementGrant.user_id == user_id, WattenAchievementGrant.generation == 1,
        WattenAchievementGrant.source_game_id == game_id)))
    return tuple(sorted((credit, *grants)))


@pytest.fixture
def two_matches(server):
    owner = runtime_tests.account("PresentationOwner")
    foreign = runtime_tests.account("PresentationOther")
    with session_scope() as db:
        for game_id, account, days in (("receipt-old", owner, 0), ("receipt-new", owner, 1), ("receipt-foreign", foreign, 0)):
            game = game_for([account], game_id=game_id, cpus=(1,))
            game["_finished_at"] = (FINISHED + timedelta(days=days)).isoformat()
            row, evidence, bindings = written(db, game)
            store_draft_match(db, row, evidence, bindings)
        own = owner[0].user_id
        old, new = sequences(db, own, "receipt-old"), sequences(db, own, "receipt-new")
    return own, foreign[0].user_id, old, new


def journal_snapshot(db):
    return tuple(tuple(db.execute(select(model.__table__))) for model in JOURNAL_MODELS)


def test_new_match_ack_never_hides_older_unshown_events_or_changes_global_cursor(two_matches):
    own, foreign, old, new = two_matches
    with session_scope() as db:
        before = journal_snapshot(db)
        result = receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-new", through_sequence=max(new))
        assert result.status == "draft" and result.through_sequence == max(new)
        boundaries = receipts.read_match_presentation_boundaries(db, user_id=own, generation=1,
                                                                game_ids=("receipt-new", "receipt-old", "receipt-foreign", "missing"))
        assert boundaries == {"receipt-new": max(new), "receipt-old": 0}
        assert all(sequence > boundaries["receipt-old"] for sequence in old)
        assert not any(sequence > boundaries["receipt-new"] for sequence in new)
        assert journal_snapshot(db) == before
        assert receipts.read_match_presentation_boundaries(db, user_id=foreign, generation=1,
                                                           game_ids=("receipt-old", "receipt-new")) == {}
        with pytest.raises(TypeError):
            boundaries["receipt-old"] = 999
    with session_scope() as db:
        assert receipts.read_match_presentation_boundaries(db, user_id=own, generation=1,
                                                           game_ids=("receipt-old", "receipt-new")) == {"receipt-old": 0, "receipt-new": max(new)}


def test_same_session_retry_and_stale_second_tab_cannot_lower_a_boundary(two_matches):
    own, _foreign, old, _new = two_matches
    with Session(get_engine()) as first, Session(get_engine()) as second:
        receipts.acknowledge_match_presentation(first, user_id=own, generation=1, game_id="receipt-old", through_sequence=min(old))
        first.commit()
        cached = first.get(WattenMatchPresentationAck, (own, 1, "receipt-old"))
        assert cached.through_sequence == min(old)
        receipts.acknowledge_match_presentation(second, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
        second.commit()
        for sequence in (min(old), max(old), 0, min(old)):
            boundary = receipts.acknowledge_match_presentation(first, user_id=own, generation=1, game_id="receipt-old", through_sequence=sequence)
            assert boundary.through_sequence == max(old)
        first.commit()
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 1


def test_later_valid_source_grant_remains_visible_above_the_receipt(two_matches):
    own, _foreign, old, new = two_matches
    with session_scope() as db:
        receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
    # Fixture for a later legitimate catalog unlock; this service never creates it.
    with session_scope() as db:
        state = db.get(WattenProgressState, own)
        state.grant_sequence += 1
        late_sequence = state.grant_sequence
        assert late_sequence > max(new)
        db.add(WattenAchievementGrant(user_id=own, generation=1, achievement_id="watten_later_catalog_goal",
                                      catalog_version=2, source_game_id="receipt-old", reached_at=FINISHED,
                                      xp=47, policy_version=2, grant_sequence=late_sequence))
    with session_scope() as db:
        boundaries = receipts.read_match_presentation_boundaries(db, user_id=own, generation=1, game_ids=("receipt-old", "receipt-new"))
        assert boundaries == {"receipt-old": max(old), "receipt-new": 0}
        assert [item for item in sequences(db, own, "receipt-old") if item > boundaries["receipt-old"]] == [late_sequence]
        receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=late_sequence)
        assert receipts.read_match_presentation_boundaries(db, user_id=own, generation=1,
                                                           game_ids=("receipt-old",))["receipt-old"] == late_sequence
        assert db.get(WattenProgressState, own).acknowledged_sequence == 0


@pytest.mark.parametrize("game_id", ("missing", "receipt-foreign"))
def test_unknown_or_foreign_match_cannot_get_a_receipt(two_matches, game_id):
    own, _foreign, _old, _new = two_matches
    with session_scope() as db:
        before = journal_snapshot(db)
        with pytest.raises(receipts.WattenPresentationError, match="not_owned"):
            receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id=game_id, through_sequence=1)
        assert journal_snapshot(db) == before
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0


def test_foreign_match_sequence_and_too_high_boundaries_are_rejected(two_matches):
    own, _foreign, old, new = two_matches
    with session_scope() as db:
        for game_id, sequence in (("receipt-old", max(new)), ("receipt-new", max(old)), ("receipt-new", max(new) + 100)):
            with pytest.raises(receipts.WattenPresentationError, match="invalid_boundary"):
                receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id=game_id, through_sequence=sequence)
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0


@pytest.mark.parametrize("field,value", (
    ("user_id", True), ("user_id", None), ("user_id", 0), ("generation", True), ("generation", 0),
    ("through_sequence", True), ("through_sequence", -1), ("through_sequence", 1.0),
    ("game_id", True), ("game_id", ""), ("game_id", " receipt-old"),
))
def test_ack_input_counters_are_strict_and_rejections_write_nothing(two_matches, field, value):
    own, _foreign, old, _new = two_matches
    values = {"user_id": own, "generation": 1, "game_id": "receipt-old", "through_sequence": max(old), field: value}
    with session_scope() as db:
        before = journal_snapshot(db)
        with pytest.raises(receipts.WattenPresentationError):
            receipts.acknowledge_match_presentation(db, **values)
        assert journal_snapshot(db) == before
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0


def test_zero_is_a_noop_and_outer_rollback_does_not_commit_a_receipt(two_matches):
    own, _foreign, old, _new = two_matches
    with session_scope() as db:
        assert receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=0).through_sequence == 0
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0
    with pytest.raises(RuntimeError, match="caller rollback"):
        with session_scope() as db:
            receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
            assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 1
            raise RuntimeError("caller rollback")
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0


def test_generation_change_rejects_old_tabs_and_account_or_credit_deletion_cascades(two_matches):
    own, foreign, old, _new = two_matches
    with session_scope() as db:
        receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
        foreign_sequence = max(sequences(db, foreign, "receipt-foreign"))
        receipts.acknowledge_match_presentation(db, user_id=foreign, generation=1, game_id="receipt-foreign", through_sequence=foreign_sequence)
    with session_scope() as db:
        # Future epoch fixture only; no reset/backfill operation is added here.
        db.get(WattenProgressState, own).generation = 2
    with session_scope() as db:
        with pytest.raises(receipts.WattenPresentationError, match="stale_generation"):
            receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
        with pytest.raises(receipts.WattenPresentationError, match="stale_generation"):
            receipts.read_match_presentation_boundaries(db, user_id=own, generation=1, game_ids=("receipt-old",))
        assert receipts.read_match_presentation_boundaries(db, user_id=own, generation=2, game_ids=("receipt-old",)) == {}
        db.delete(db.get(WattenMatchCredit, (own, 1, "receipt-old")))
        db.flush()
        assert db.get(WattenMatchPresentationAck, (own, 1, "receipt-old")) is None
        db.delete(db.get(User, foreign))
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0
        assert db.get(WattenMatchEvidence, "receipt-foreign") is not None


def test_read_only_helper_never_autoflushes_pending_changes_and_selects_no_hidden_json(two_matches):
    own, _foreign, _old, _new = two_matches
    statements = []

    def observed(_connection, _cursor, statement, _parameters, _context, _many):
        statements.append(statement)

    with session_scope() as db:
        state = db.get(WattenProgressState, own)
        original = state.acknowledged_sequence
        state.acknowledged_sequence = state.grant_sequence  # unflushed caller work
        event.listen(get_engine(), "before_cursor_execute", observed)
        try:
            assert receipts.read_match_presentation_boundaries(db, user_id=own, generation=1,
                                                               game_ids=("receipt-old", "receipt-foreign", "missing")) == {"receipt-old": 0}
        finally:
            event.remove(get_engine(), "before_cursor_execute", observed)
        assert statements and all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
        assert all("_json" not in statement for statement in statements)
        state.acknowledged_sequence = original


def test_global_ack_does_not_fabricate_a_match_receipt(two_matches):
    own, _foreign, _old, new = two_matches
    with session_scope() as db:
        acknowledge_draft_progress(db, user_id=own, generation=1, through_sequence=max(new))
        assert receipts.read_match_presentation_boundaries(db, user_id=own, generation=1,
                                                           game_ids=("receipt-old", "receipt-new")) == {"receipt-old": 0, "receipt-new": 0}


@pytest.mark.parametrize("pending_change", ("generation", "credit_deleted"))
def test_ack_sees_pending_generation_or_credit_changes_in_its_caller_transaction(two_matches, pending_change):
    own, _foreign, old, _new = two_matches
    with pytest.raises(receipts.WattenPresentationError):
        with session_scope() as db:
            if pending_change == "generation":
                db.get(WattenProgressState, own).generation = 2
            else:
                db.delete(db.get(WattenMatchCredit, (own, 1, "receipt-old")))
            receipts.acknowledge_match_presentation(db, user_id=own, generation=1, game_id="receipt-old", through_sequence=max(old))
    with session_scope() as db:
        assert db.get(WattenProgressState, own).generation == 1
        assert db.get(WattenMatchCredit, (own, 1, "receipt-old")) is not None
        assert db.scalar(select(func.count()).select_from(WattenMatchPresentationAck)) == 0


def test_additive_sqlite_upgrade_preserves_existing_journal_and_enforces_own_credit_fk(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    path = tmp_path / "match-receipts.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261018_0067")
    with sqlite3.connect(path, isolation_level=None) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        own = user(connection)
        connection.execute("INSERT INTO watten_match_evidence VALUES ('retained','{}','{}','{}',?)", (FINISHED.isoformat(),))
        connection.execute("INSERT INTO watten_progress_states VALUES (?,1,1,0)", (own,))
        connection.execute("INSERT INTO watten_match_credits VALUES (?,1,'retained','p1',?,1,'{}',10,1,1,1)", (own, FINISHED.isoformat()))
        tables = ("watten_match_evidence", "watten_progress_states", "watten_match_credits", "watten_achievement_grants")
        before = {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables}
        old_rows = snapshot(connection)
        command.upgrade(config, "20261018_0068")
        assert snapshot(connection) == old_rows
        assert {table: connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables} == before
        command.downgrade(config, "20261018_0067")
        command.upgrade(config, "20261018_0068")
        for values in ((own, 2, "retained", 1), (own, 1, "missing", 1), (own, 1, "retained", 0)):
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute("INSERT INTO watten_match_presentation_acks VALUES (?,?,?,?)", values)
        connection.execute("INSERT INTO watten_match_presentation_acks VALUES (?,1,'retained',1)", (own,))
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261018_0067")
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "20261018_0068"
        connection.execute("DELETE FROM watten_match_credits WHERE user_id=?", (own,))
        assert connection.execute("SELECT * FROM watten_match_presentation_acks").fetchall() == []
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []


def test_postgresql_and_sqlite_ddl_compile_without_claiming_a_postgresql_server():
    path = BASE / "alembic/versions/20261018_0068_watten_match_presentation_receipts.py"
    spec = importlib.util.spec_from_file_location("watten_match_receipts_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        module.upgrade()
    sql = output.getvalue()
    assert "CREATE TABLE watten_match_presentation_acks" in sql
    assert "REFERENCES watten_match_credits (user_id, generation, game_id) ON DELETE CASCADE" in sql
    assert "through_sequence >= 1" in sql
    for dialect in (postgresql.dialect(), sqlite.dialect()):
        assert "PRIMARY KEY (user_id, generation, game_id)" in str(CreateTable(WattenMatchPresentationAck.__table__).compile(dialect=dialect))
