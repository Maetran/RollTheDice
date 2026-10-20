"""Real result transactions, journal restarts and additive migration evidence."""

import importlib.util
import io
import json
import sqlite3
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import func, select
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import CreateTable

from alembic import command
from app import watten_progression_store as journal
from app.database import session_scope
from app.models import (
    CompletedGame,
    GameParticipant,
    HausdeppAchievementUnlock,
    HausdeppRoundCredit,
    User,
    UserAchievement,
    WattenAchievementGrant,
    WattenMatchCredit,
    WattenMatchEvidence,
    WattenProgressState,
)
from app.security import as_utc
from app.watten_bidding import retourschneider_candidate
from app.watten_engine import SeatBinding, next_deal, start_match
from app.watten_evidence import BidEvidence, PlayerBids, ProjectedBinding, adapt_result_v1, evidence_to_json
from app.watten_progression import DRAFT_CATALOG_VERSION
from app.watten_results import store_result_in_session
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_engine import dealt, finish, ready, recipe, step
from tests.test_watten_evidence import FINISHED, public_evidence
from tests.test_watten_results_migration import completed, snapshot, user

server = runtime_tests.server
BASE = Path(__file__).resolve().parents[1]
JOURNAL_MODELS = (WattenMatchEvidence, WattenProgressState, WattenMatchCredit, WattenAchievementGrant)


def game_for(owners, *, game_id="journal-match", count_players=2, cpus=()):
    humans = iter(owners)
    bindings, names = [], []
    for seat, player in enumerate("ABCD"[:count_players]):
        owner = None if seat in cpus else next(humans)
        bindings.append(SeatBinding(player, None if owner is None else owner[0].user_id))
        names.append((player, f"Seppl{seat}" if owner is None else owner[0].username))
    original = recipe(count_players, target_points=3)
    state = start_match(replace(original, bindings=tuple(bindings)), "proof-0", dealt(count_players), first_dealer="A")
    for number in range(20):
        state = finish(ready(state))
        if state.phase == "match_complete":
            break
        candidate = retourschneider_candidate(state.ledger)
        if candidate is not None:
            state = step(state, candidate[0], "retourschneider", "decline")
        state = next_deal(state, f"proof-{number + 1}", dealt(count_players))
    assert state.phase == "match_complete"
    return {"_id": game_id, "_name": "Private DRAFT table", "_mode": str(count_players),
            "_finished_at": FINISHED.isoformat(), "_watten": SimpleNamespace(engine=state, names=tuple(names))}


def written(db, game):
    payload = store_result_in_session(db, game)
    db.flush()
    row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
    evidence = adapt_result_v1(payload, finished_at=as_utc(row.finished_at))
    bindings = tuple(ProjectedBinding(row.game_id, item.position, item.player_key, item.display_name,
                                      item.user_id, item.points, item.team) for item in db.scalars(
        select(GameParticipant).where(GameParticipant.game_id == row.id).order_by(GameParticipant.position)))
    return row, evidence, bindings


def counts(db):
    return tuple(db.scalar(select(func.count()).select_from(model)) for model in JOURNAL_MODELS)


def test_real_writer_same_transaction_rollback_then_retry_and_new_session_are_exact_once(server):
    owners = [runtime_tests.account("JournalA"), runtime_tests.account("JournalB")]
    game = game_for(owners)
    unrelated_models = (UserAchievement, HausdeppAchievementUnlock, HausdeppRoundCredit)
    with session_scope() as db:
        unrelated_before = tuple(tuple(db.execute(select(model.__table__))) for model in unrelated_models)
    with pytest.raises(RuntimeError, match="outer transaction"):
        with session_scope() as db:
            row, evidence, bindings = written(db, game)
            result = journal.store_draft_match(db, row, evidence, bindings)
            assert len(result) == 2 and all(item.new_credit for item in result)
            assert counts(db) == (1, 2, 2, 4)
            raise RuntimeError("outer transaction failed")
    with session_scope() as db:
        assert counts(db) == (0, 0, 0, 0)
        assert db.scalar(select(func.count(CompletedGame.id))) == 0
        row, evidence, bindings = written(db, game)
        original = deepcopy(json.loads(row.snapshot_json))
        first = journal.store_draft_match(db, row, evidence, bindings)
        again = journal.store_draft_match(db, row, evidence, tuple(reversed(bindings)))
        assert all(not item.new_credit and not item.new_achievement_ids for item in again)
        assert [item.grant_sequence for item in first] == [item.grant_sequence for item in again]
        assert json.loads(row.snapshot_json) == original
    with session_scope() as db:
        row, evidence, bindings = written(db, game)  # actual v1 writer retry is unchanged
        restarted = journal.store_draft_match(db, row, evidence, bindings)
        assert counts(db) == (1, 2, 2, 4)
        assert all(not item.new_credit and not item.new_achievement_ids for item in restarted)
        assert evidence_to_json(evidence) == db.get(WattenMatchEvidence, row.game_id).evidence_json
        assert json.loads(db.scalars(select(WattenMatchCredit)).first().cohort_json)["profile"] == "unknown"
        assert tuple(tuple(db.execute(select(model.__table__))) for model in unrelated_models) == unrelated_before


@pytest.mark.parametrize("fail", (False, True))
def test_native_retourschneider_unlocks_only_successful_team_once_in_its_result_transaction(server, fail):
    from tests.test_watten_progression import retourschneider_state

    owners = [runtime_tests.account(f"NativeRetour{seat}") for seat in range(4)]
    state = retourschneider_state(fail=fail)
    state = replace(state, recipe=replace(state.recipe, bindings=tuple(
        SeatBinding(player, owner[0].user_id) for player, owner in zip(state.recipe.seats, owners))), ack_cache=())
    game = {"_id": "native-retour-result", "_name": "Verified comeback", "_mode": "4",
            "_finished_at": FINISHED.isoformat(), "_watten": SimpleNamespace(
                engine=state, names=tuple((player, owner[0].username) for player, owner in zip(state.recipe.seats, owners)))}
    with session_scope() as db:
        row, _legacy, bindings = written(db, game)
        evidence = public_evidence(json.loads(row.snapshot_json))
        first = journal.store_draft_match(db, row, evidence, bindings)
        grants = tuple(db.scalars(select(WattenAchievementGrant).where(
            WattenAchievementGrant.achievement_id == "watten_retourschneider_win")))
        assert {grant.user_id for grant in grants} == (set() if fail else {owners[1][0].user_id, owners[3][0].user_id})
        assert all(grant.xp == 120 and grant.catalog_version == 2 and grant.source_game_id == game["_id"] for grant in grants)
        assert db.scalar(select(func.count()).select_from(WattenAchievementGrant).where(
            WattenAchievementGrant.achievement_id == "watten_schneider_win")) == 0
        repeated = journal.store_draft_match(db, row, evidence, bindings)
        assert all(not status.new_credit and not status.new_achievement_ids for status in repeated)
        assert [status.grant_sequence for status in repeated] == [status.grant_sequence for status in first]


@pytest.mark.parametrize("damage", ("foreign_type", "detached", "forged_bindings", "changed_evidence", "changed_snapshot"))
def test_untrusted_or_conflicting_completed_source_cannot_mint_journal_rows(server, damage):
    owner = runtime_tests.account("SourceOwner")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        if damage == "foreign_type":
            row.game_type = "zdwa"
        elif damage == "detached":
            db.expunge(row)
        elif damage == "forged_bindings":
            bindings = (replace(bindings[0], display_name="Forged name"), bindings[1])
        elif damage == "changed_evidence":
            evidence = replace(evidence, finished_at=FINISHED + timedelta(seconds=1))
        else:
            row.snapshot_json = row.snapshot_json.replace('"schema_version":1', '"schema_version":1,"schema_version":1')
        with pytest.raises(ValueError):
            journal.store_draft_match(db, row, evidence, bindings)
        assert counts(db) == (0, 0, 0, 0)


def test_existing_freeze_rejects_evidence_upgrade_or_seat_reassignment_to_a_new_account(server):
    owner, other = runtime_tests.account("FrozenOwner"), runtime_tests.account("UnrelatedNewOwner")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        journal.store_draft_match(db, row, evidence, bindings)
    with pytest.raises(journal.WattenJournalError, match="conflicting_evidence"):
        with session_scope() as db:
            row, _evidence, bindings = written(db, game)
            richer = public_evidence(json.loads(row.snapshot_json))
            journal.store_draft_match(db, row, richer, bindings)
    with pytest.raises(journal.WattenJournalError, match="conflicting_binding"):
        with session_scope() as db:
            row, evidence, bindings = written(db, game)
            seat = db.scalar(select(GameParticipant).where(GameParticipant.game_id == row.id, GameParticipant.position == 0))
            seat.user_id = other[0].user_id
            db.flush()
            bindings = (replace(bindings[0], user_id=other[0].user_id), bindings[1])
            journal.store_draft_match(db, row, evidence, bindings)
    with session_scope() as db:
        assert counts(db) == (1, 1, 1, 3)  # first match + 2-player + CPU participation
        assert journal.read_draft_progress(db, user_id=other[0].user_id) is None


def test_future_public_profile_and_complete_bids_freeze_without_changing_result_v1(server):
    owner = runtime_tests.account("RichEvidenceOwner")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        row, _legacy, bindings = written(db, game)
        original = row.snapshot_json
        rich = public_evidence(json.loads(row.snapshot_json))
        rich = replace(rich, bids=BidEvidence(True, tuple(PlayerBids(player.player_id, 0, 0, 0, 0) for player in rich.roster)))
        journal.store_draft_match(db, row, rich, bindings)
        frozen = db.get(WattenMatchEvidence, row.game_id)
        assert frozen.evidence_json == evidence_to_json(rich)
        assert row.snapshot_json == original and json.loads(frozen.result_v1_json) == json.loads(original)
        credit = db.scalar(select(WattenMatchCredit))
        assert json.loads(credit.cohort_json)["profile"]["determination"] == "normal"
        assert db.scalar(select(func.count(WattenAchievementGrant.achievement_id)).where(
            WattenAchievementGrant.achievement_id == "watten_normal")) == 1


def test_deleted_human_never_becomes_cpu_or_gets_recredited_to_another_account(server):
    owners = [runtime_tests.account("DeleteKeep"), runtime_tests.account("DeleteGone")]
    game = game_for(owners)
    with session_scope() as db:
        db.delete(db.get(User, owners[1][0].user_id))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        assert not evidence.roster[1].is_cpu and bindings[1].user_id is None
        result = journal.store_draft_match(db, row, evidence, bindings)
        assert len(result) == 1 and result[0].user_id == owners[0][0].user_id
    with session_scope() as db:
        db.delete(db.get(User, owners[0][0].user_id))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        assert journal.store_draft_match(db, row, evidence, bindings) == ()
        assert counts(db) == (1, 0, 0, 0)  # private proof retained, account-bound grants cascade


def test_ack_is_generation_bound_monotonic_and_new_grants_stay_pending(server):
    owner = runtime_tests.account("AckOwner")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        status = journal.store_draft_match(db, row, evidence, bindings)[0]
        acknowledged = journal.acknowledge_draft_progress(db, user_id=owner[0].user_id, generation=1,
                                                         through_sequence=status.grant_sequence)
        assert acknowledged.acknowledged_sequence == status.grant_sequence
        assert journal.acknowledge_draft_progress(db, user_id=owner[0].user_id, generation=1,
                                                 through_sequence=0).acknowledged_sequence == status.grant_sequence
        for generation, sequence in ((2, 0), (1, status.grant_sequence + 1), (True, 0), (1, True)):
            with pytest.raises(journal.WattenJournalError):
                journal.acknowledge_draft_progress(db, user_id=owner[0].user_id, generation=generation, through_sequence=sequence)
    with session_scope() as db:
        second = {**game, "_id": "ack-next", "_finished_at": (FINISHED + timedelta(days=1)).isoformat()}
        row, evidence, bindings = written(db, second)
        added = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert added.grant_sequence > added.acknowledged_sequence == status.grant_sequence
        assert journal.read_draft_progress(db, user_id=owner[0].user_id).total_xp == added.total_xp
        # A fixture representing a future epoch has no reset API here. An
        # old mounted page must still fail its generation check after a restart.
        state = db.get(WattenProgressState, owner[0].user_id)
        state.generation = 2
        db.flush()
    with session_scope() as db:
        with pytest.raises(journal.WattenJournalError, match="stale_ack"):
            journal.acknowledge_draft_progress(db, user_id=owner[0].user_id, generation=1,
                                             through_sequence=status.grant_sequence)


def test_policy_price_change_does_not_reprice_old_credits_or_achievements(server, monkeypatch):
    owner = runtime_tests.account("FrozenPrices")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        original = journal.store_draft_match(db, row, evidence, bindings)[0]
    real_evaluate = journal.evaluate_draft

    def later_server_policy(*args, **kwargs):
        proposal = real_evaluate(*args, **kwargs)
        return replace(proposal, credits=tuple(replace(item, xp=23, policy_version=2) for item in proposal.credits),
                       achievements=tuple(replace(item, xp=item.xp + 100, policy_version=2) for item in proposal.achievements))

    monkeypatch.setattr(journal, "evaluate_draft", later_server_policy)
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        retried = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert retried.total_xp == original.total_xp and retried.grant_sequence == original.grant_sequence
        second = {**game, "_id": "new-price-next"}
        row, evidence, bindings = written(db, second)
        journal.store_draft_match(db, row, evidence, bindings)
        credits = list(db.scalars(select(WattenMatchCredit).order_by(WattenMatchCredit.grant_sequence)))
        assert [(item.xp, item.policy_version) for item in credits] == [(10, 1), (23, 2)]
        assert all(item.policy_version == 1 for item in db.scalars(select(WattenAchievementGrant)))


def test_catalog_change_preserves_unlock_identity_price_source_and_sequence_but_allows_new_ids(server, monkeypatch):
    owner = runtime_tests.account("CatalogIdentity")
    game = game_for([owner], cpus=(1,))

    def existing(db):
        return {item.achievement_id: (item.catalog_version, item.xp, item.policy_version, item.source_game_id,
                                      as_utc(item.reached_at), item.grant_sequence)
                for item in db.scalars(select(WattenAchievementGrant))}

    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        first = journal.store_draft_match(db, row, evidence, bindings)[0]
        frozen = existing(db)
    real_evaluate = journal.evaluate_draft

    def later_catalog(*args, **kwargs):
        proposal = real_evaluate(*args, **kwargs)
        grants = tuple(replace(item, catalog_version=DRAFT_CATALOG_VERSION + 1, policy_version=2, xp=item.xp + 100)
                       for item in proposal.achievements)
        if proposal.counters.completed >= 2:
            grants += (replace(grants[0], achievement_id="watten_new_catalog_goal", xp=47,
                               source_game_id="new-catalog-next", reached_at=FINISHED),)
        return replace(proposal, catalog_version=DRAFT_CATALOG_VERSION + 1, policy_version=2, achievements=grants)

    monkeypatch.setattr(journal, "evaluate_draft", later_catalog)
    with session_scope() as db:
        row, evidence, bindings = written(db, game)
        replay = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert replay.total_xp == first.total_xp and replay.grant_sequence == first.grant_sequence
        assert existing(db) == frozen
        second = {**game, "_id": "new-catalog-next"}
        row, evidence, bindings = written(db, second)
        added = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert {key: value for key, value in existing(db).items() if key in frozen} == frozen
        assert added.new_achievement_ids == ("watten_new_catalog_goal",)
        assert added.total_xp == first.total_xp + 10 + 47
        assert added.grant_sequence == first.grant_sequence + 2
        again = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert again.total_xp == added.total_xp and again.grant_sequence == added.grant_sequence
        assert not again.new_achievement_ids
        # The actual migrated SQLite PK also forbids a duplicate across
        # catalog versions; the application set is not the only protection.
        old_id = next(iter(frozen))
        with pytest.raises(IntegrityError):
            with db.begin_nested():
                db.add(WattenAchievementGrant(user_id=owner[0].user_id, generation=1, achievement_id=old_id,
                                              catalog_version=3, source_game_id=game["_id"], reached_at=FINISHED,
                                              xp=999, policy_version=3, grant_sequence=added.grant_sequence + 1))
                db.flush()


def test_all_history_beyond_250_is_evaluated_without_a_silent_limit_or_per_result_query(server, monkeypatch):
    owner = runtime_tests.account("HistoryOwner")
    game = game_for([owner], cpus=(1,))
    real_evaluate, lengths = journal.evaluate_draft, []

    def observed(matches, **kwargs):
        lengths.append(len(matches))
        return real_evaluate(matches, **kwargs)

    monkeypatch.setattr(journal, "evaluate_draft", observed)
    with session_scope() as db:
        for index in range(252):
            current = {**game, "_id": f"history-{index:03}", "_finished_at": (FINISHED + timedelta(minutes=index)).isoformat()}
            row, evidence, bindings = written(db, current)
            result = journal.store_draft_match(db, row, evidence, bindings)[0]
        assert lengths == list(range(1, 253))
        assert db.scalar(select(func.count(WattenMatchCredit.game_id))) == 252
        assert result.match_xp == 2520
        assert db.scalar(select(func.count(WattenAchievementGrant.achievement_id)).where(
            WattenAchievementGrant.achievement_id == "watten_matches_250")) == 1


def migration_module():
    spec = importlib.util.spec_from_file_location("watten_journal_migration", BASE / "alembic/versions/20261018_0067_watten_progression_journal.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_additive_sqlite_migration_preserves_old_rows_and_downgrade_refuses_existing_journal(tmp_path):
    config = Config(str(BASE / "alembic.ini"))
    config.set_main_option("script_location", str(BASE / "alembic"))
    path = tmp_path / "migration.sqlite3"
    config.set_main_option("sqlalchemy.url", f"sqlite:///{path}")
    command.upgrade(config, "20261018_0066")
    with sqlite3.connect(path, isolation_level=None) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        account = user(connection)
        for kind in ("zdwa", "zilch", "hausdepp", "watten"):
            result = completed(connection, f"unchanged-{kind}", kind)
            connection.execute("INSERT INTO game_participants(game_id,position,player_key,display_name,points,user_id) "
                               "VALUES (?,0,'p','Historical',8,?)", (result, account))
        before = snapshot(connection)
        command.upgrade(config, "20261018_0067")
        assert snapshot(connection) == before
        command.downgrade(config, "20261018_0066")
        assert snapshot(connection) == before
        command.upgrade(config, "20261018_0067")
        connection.execute("INSERT INTO watten_progress_states VALUES (?,1,0,0)", (account,))
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE watten_progress_states SET acknowledged_sequence=1")
        with pytest.raises(RuntimeError, match="Cannot downgrade"):
            command.downgrade(config, "20261018_0066")
        assert snapshot(connection) == before
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone()[0] == "20261018_0067"


def test_postgresql_and_sqlite_journal_ddl_compile_without_claiming_a_live_postgres_server():
    output = io.StringIO()
    context = MigrationContext.configure(dialect_name="postgresql", opts={"as_sql": True, "output_buffer": output})
    with Operations.context(context):
        migration_module().upgrade()
    sql = output.getvalue()
    for model in JOURNAL_MODELS:
        assert f"CREATE TABLE {model.__tablename__}" in sql
        assert "CREATE TABLE" in str(CreateTable(model.__table__).compile(dialect=postgresql.dialect()))
        assert "CREATE TABLE" in str(CreateTable(model.__table__).compile(dialect=sqlite.dialect()))
    assert "FOREIGN KEY" in sql and "acknowledged_sequence <= grant_sequence" in sql
