"""Private account reads, stable history, frozen prices and fail-closed sources."""

import base64
import json
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.database import session_scope
from app.models import CompletedGame, GameParticipant, User, WattenAchievementGrant, WattenMatchEvidence
from app.watten_account import WattenAccountError, build_watten_account
from app.watten_progression import DRAFT_ACHIEVEMENTS, DRAFT_CATALOG_VERSION, DRAFT_TITLES
from app.watten_progression_store import acknowledge_draft_progress, store_draft_match
from app.watten_surprises import SURPRISE_ACHIEVEMENTS
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_evidence import FINISHED
from tests.test_watten_progression_store import JOURNAL_MODELS, counts, game_for, written

server = runtime_tests.server


def test_empty_and_uncredited_account_reads_never_synchronize_or_award(server):
    owner = runtime_tests.account("ReadOnlyOwner")
    empty = build_watten_account(owner[0].user_id)
    assert empty["schema_version"] == 1 and empty["status"] == "draft" and empty["coverage"]["complete"]
    assert empty["statistics"]["all_matches"] == empty["statistics"]["credited_matches"] == 0
    assert empty["progress"]["total_xp"] == 0
    assert len(empty["progress"]["achievements"]) == len(DRAFT_ACHIEVEMENTS) + len(SURPRISE_ACHIEVEMENTS)
    assert empty["progress"]["titles"] == [
        {"level": title.level, "threshold": title.xp, "name": {"de": title.name.de, "en": title.name.en}}
        for title in DRAFT_TITLES]
    goals = {item["id"]: item for item in empty["progress"]["achievements"]}
    assert empty["progress"]["achievement_categories"] == ["persistence", "tables", "variants", "bidding", "wins", "surprises"]
    assert set(item["category"] for item in goals.values()) == set(empty["progress"]["achievement_categories"])
    assert goals["watten_matches_1"]["category"] == "persistence"
    assert goals["watten_team_first"]["category"] == "tables"
    assert goals["watten_blind"]["category"] == "variants"
    assert goals["watten_counter"]["category"] == "bidding"
    assert goals["watten_schneider_win"]["category"] == "wins"
    assert goals["watten_surprise_star_trigger"]["category"] == "surprises"
    with session_scope() as db:
        written(db, game_for([owner], cpus=(1,)))
        before = counts(db)
    result = build_watten_account(owner[0].user_id)
    assert result["statistics"]["all_matches"] == result["statistics"]["uncredited_matches"] == 1
    assert result["statistics"]["credited_matches"] == 0 and result["progress"]["counters"]["completed"] == 0
    assert result["progress"]["total_xp"] == 0 and result["history"]["matches"][0]["profile"] == "unknown"
    with session_scope() as db:
        assert counts(db) == before == (0, 0, 0, 0)


def test_own_frozen_amounts_catalog_and_pending_use_only_credited_evidence(server):
    owner, foreign = runtime_tests.account("PrivateJournal"), runtime_tests.account("ForeignJournal")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_matches_1"))
        grant.xp = 73  # an immutable historical price, not today's catalog reward
        grant.catalog_version = 1  # an older known ID remains unlocked in the additive catalogue
        row, evidence, bindings = written(db, game_for([foreign], game_id="foreign-only-match", cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        written(db, game_for([owner], game_id="not-credited-yet", cpus=(1,)))
        before = tuple(tuple(db.execute(select(model.__table__))) for model in JOURNAL_MODELS)
    result = build_watten_account(owner[0].user_id)
    progress = result["progress"]
    assert result["statistics"]["all_matches"] == 2 and result["statistics"]["credited_matches"] == 1
    assert progress["match_xp"] == 10 and progress["achievement_xp"] == 73 + 20 + 20
    assert progress["total_xp"] == 123 and progress["title"]["threshold"] == 90
    assert progress["next_title"]["threshold"] == 150 and progress["xp_to_next"] == 27
    assert progress["counters"]["completed"] == 1 and progress["counters"]["normal"] == 0
    first = next(item for item in progress["achievements"] if item["id"] == "watten_matches_1")
    assert first["draft_xp"] == 10 and first["granted_xp"] == 73 and first["earned_at"]
    assert {item["game_id"] for item in progress["pending"]["credits"]} == {"journal-match"}
    assert all(item["source_game_id"] == "journal-match" for item in progress["pending"]["achievements"])
    encoded = json.dumps(result)
    assert "foreign-only-match" not in encoded and "ForeignJournal" not in encoded and '"user_id"' not in encoded
    assert all(key not in encoded for key in ('"hands"', '"stock"', '"inspection"', '"bindings_json"', '"snapshot_json"'))
    with session_scope() as db:
        assert tuple(tuple(db.execute(select(model.__table__))) for model in JOURNAL_MODELS) == before
        acknowledge_draft_progress(db, user_id=owner[0].user_id, generation=1, through_sequence=1)
    pending = build_watten_account(owner[0].user_id)["progress"]["pending"]
    assert pending["credits"] == [] and pending["achievements"]


def test_membership_filter_precedes_decode_and_other_game_types_are_never_read(server):
    owner, foreign = runtime_tests.account("SqlMember"), runtime_tests.account("NotSqlMember")
    with session_scope() as db:
        written(db, game_for([owner], game_id="mine", cpus=(1,)))
        row, _evidence, _bindings = written(db, game_for([foreign], game_id="foreign-invalid", cpus=(1,)))
        row.snapshot_json = "PRIVATE FOREIGN MALFORMED JSON"
        row, _evidence, _bindings = written(db, game_for([owner], game_id="other-game-invalid", cpus=(1,)))
        row.game_type, row.snapshot_json = "zdwa", "OTHER GAME MALFORMED JSON"
    result = build_watten_account(owner[0].user_id)
    assert [item["game_id"] for item in result["history"]["matches"]] == ["mine"]
    assert result["statistics"]["all_matches"] == 1


def test_deleted_other_human_keeps_historical_name_without_becoming_a_cpu(server):
    owner, gone = runtime_tests.account("HistoryKeep"), runtime_tests.account("HistoryGone")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner, gone]))
        store_draft_match(db, row, evidence, bindings)
        db.delete(db.get(User, gone[0].user_id))
    result = build_watten_account(owner[0].user_id)
    match = result["history"]["matches"][0]
    assert match["cpu_count"] == 0 and match["participants"][1]["is_cpu"] is False
    assert match["participants"][1]["name"] == "HistoryGone"
    assert result["progress"]["counters"]["cpu_matches"] == 0


@pytest.mark.parametrize("damage", ("json", "binding", "freeze", "rebind", "journal_source", "journal_sequence"))
def test_own_malformed_or_rebound_rows_fail_closed_without_legacy_fallback(server, damage):
    owner, foreign = runtime_tests.account("BadOwnSource"), runtime_tests.account("NewBinding")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        if damage == "json":
            row.snapshot_json = "not JSON"
        elif damage == "binding":
            db.scalar(select(GameParticipant).where(GameParticipant.game_id == row.id, GameParticipant.position == 1)).display_name = "Changed historical name"
        elif damage == "freeze":
            db.get(WattenMatchEvidence, row.game_id).evidence_json = '{"kind":"corrupt"}'
        elif damage == "rebind":
            db.scalar(select(GameParticipant).where(GameParticipant.game_id == row.id, GameParticipant.position == 0)).user_id = foreign[0].user_id
        elif damage == "journal_source":
            grant = db.scalar(select(WattenAchievementGrant))
            second, _evidence, _bindings = written(db, game_for([foreign], game_id="not-my-source", cpus=(1,)))
            db.add(WattenMatchEvidence(game_id=second.game_id, result_v1_json="{}", evidence_json="{}", bindings_json="{}", frozen_at=FINISHED))
            db.flush()
            grant.source_game_id = second.game_id
        else:
            grant = db.scalar(select(WattenAchievementGrant))
            grant.grant_sequence = 1  # duplicate across credit/grant tables
    with pytest.raises(WattenAccountError):
        build_watten_account(owner[0].user_id)
    if damage == "rebind":
        with pytest.raises(WattenAccountError):
            build_watten_account(foreign[0].user_id)


def test_keyset_pages_and_all_time_statistics_do_not_stop_at_250_or_shift_on_insert(server):
    owner = runtime_tests.account("LongHistory")
    game = game_for([owner], cpus=(1,))
    with session_scope() as db:
        for index in range(253):
            row, evidence, bindings = written(db, {**game, "_id": f"history-{index:03}"})
            if index in (0, 252):
                store_draft_match(db, row, evidence, bindings)
    page = build_watten_account(owner[0].user_id, limit=30)
    assert page["statistics"]["all_matches"] == 253 and page["statistics"]["credited_matches"] == 2
    identifiers = [item["game_id"] for item in page["history"]["matches"]]
    assert identifiers == [f"history-{index:03}" for index in range(252, 222, -1)]
    with session_scope() as db:
        written(db, {**game, "_id": "arrived-after-page-one", "_finished_at": (FINISHED + timedelta(seconds=1)).isoformat()})
    while page["history"]["next_cursor"]:
        page = build_watten_account(owner[0].user_id, before=page["history"]["next_cursor"], limit=30)
        assert page["statistics"]["all_matches"] == 254
        identifiers.extend(item["game_id"] for item in page["history"]["matches"])
    assert len(identifiers) == len(set(identifiers)) == 253
    assert "arrived-after-page-one" not in identifiers
    with session_scope() as db:
        assert db.scalar(select(func.count(CompletedGame.id))) == 254


@pytest.mark.parametrize("cursor", ("", "[]", "====", "bad!", 1,
    base64.urlsafe_b64encode(b'{"v":1,"at":"2026-10-18T00:00:00+00:00","id":true}').decode().rstrip("="),
    base64.urlsafe_b64encode(b'{"v":1,"v":1,"at":"2026-10-18T00:00:00+00:00","id":1}').decode().rstrip("=")))
def test_strict_cursor_rejects_wrong_types_duplicates_and_noncanonical_encoding(cursor):
    with pytest.raises(WattenAccountError, match="cursor"):
        build_watten_account(1, before=cursor)


@pytest.mark.parametrize("limit", (0, 31, True, "12"))
def test_history_limit_is_strict_and_bounded(limit):
    with pytest.raises(WattenAccountError, match="limit"):
        build_watten_account(1, limit=limit)


def test_known_grant_requires_proven_eligibility_not_unknown_legacy_bids(server):
    owner = runtime_tests.account("ForgedQuietWinner")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        _extra_grant(db, owner[0].user_id, row.game_id, "watten_quiet_win")
    with pytest.raises(WattenAccountError, match="invalid_journal"):
        build_watten_account(owner[0].user_id)


def _extra_grant(db, user_id, source, achievement_id, *, catalog=1, xp=40):
    from app.models import WattenProgressState

    state = db.get(WattenProgressState, user_id)
    state.grant_sequence += 1
    db.add(WattenAchievementGrant(user_id=user_id, generation=state.generation, catalog_version=catalog,
                                 achievement_id=achievement_id, source_game_id=source, reached_at=FINISHED,
                                 xp=xp, policy_version=1, grant_sequence=state.grant_sequence))


def test_known_grant_timestamp_must_equal_its_proven_source_finish(server):
    owner = runtime_tests.account("WrongGrantTime")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_matches_1"))
        grant.reached_at = FINISHED + timedelta(seconds=1)
    with pytest.raises(WattenAccountError, match="invalid_journal"):
        build_watten_account(owner[0].user_id)


def test_late_older_credit_does_not_rewrite_or_revoke_valid_existing_grant(server):
    owner = runtime_tests.account("LateOlderHistory")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], game_id="original-source", cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_matches_1"))
        grant.xp = 73
        game = game_for([owner], game_id="late-older", cpus=(1,))
        game["_finished_at"] = (FINISHED - timedelta(days=1)).isoformat()
        row, evidence, bindings = written(db, game)
        store_draft_match(db, row, evidence, bindings)
    progress = build_watten_account(owner[0].user_id)["progress"]
    goal = next(item for item in progress["achievements"] if item["id"] == "watten_matches_1")
    assert goal["unlocked"] and goal["granted_xp"] == 73 and goal["earned_at"] == FINISHED.isoformat()
    with session_scope() as db:
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.achievement_id == "watten_matches_1"))
        assert grant.source_game_id == "original-source" and grant.grant_sequence == 2


def test_future_catalog_known_id_is_archived_without_inventing_current_eligibility(server):
    owner = runtime_tests.account("FutureCatalogOwner")
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([owner], cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        _extra_grant(db, owner[0].user_id, row.game_id, "watten_quiet_win", catalog=DRAFT_CATALOG_VERSION + 1, xp=73)
    progress = build_watten_account(owner[0].user_id)["progress"]
    goal = next(item for item in progress["achievements"] if item["id"] == "watten_quiet_win")
    assert not goal["unlocked"] and goal["granted_xp"] == 0 and goal["earned_at"] is None
    assert progress["total_xp"] == 133
    assert progress["archived_achievements"] == [{"id": "watten_quiet_win", "name": {
        "de": "Gespeicherter Watten-Erfolg", "en": "Stored Watten achievement"}, "granted_xp": 73,
        "earned_at": FINISHED.isoformat(), "catalog_version": DRAFT_CATALOG_VERSION + 1}]


@pytest.mark.parametrize("goal", ("watten_quiet_win", "watten_normal", "watten_two"))
def test_known_grant_source_must_itself_contribute_after_an_earlier_qualified_match(server, goal):
    from dataclasses import replace

    from app.watten_evidence import BidEvidence, PlayerBids
    from tests.test_watten_evidence import public_evidence

    owners = [runtime_tests.account(f"Contribution{index}") for index in range(3)]
    first = game_for(owners[:2], game_id="qualified-earlier")
    winner = first["_watten"].engine.ledger.winners[0][0]
    viewer = owners["AB".index(winner)][0].user_id
    with session_scope() as db:
        row, _legacy, bindings = written(db, first)
        # This real engine fixture accepts only call/inspection/card commands:
        # complete zero public bids are observed, not inferred from legacy data.
        evidence = public_evidence(json.loads(row.snapshot_json))
        evidence = replace(evidence, bids=BidEvidence(True, tuple(PlayerBids(player, 0, 0, 0, 0) for player in "AB")))
        store_draft_match(db, row, evidence, bindings)
    later = game_for(owners, game_id="later-unknown-three", count_players=3)
    later["_finished_at"] = (FINISHED + timedelta(seconds=1)).isoformat()
    with session_scope() as db:
        row, evidence, bindings = written(db, later)
        store_draft_match(db, row, evidence, bindings)
    valid = build_watten_account(viewer)["progress"]
    assert next(item for item in valid["achievements"] if item["id"] == goal)["unlocked"]
    with session_scope() as db:
        grant = db.scalar(select(WattenAchievementGrant).where(WattenAchievementGrant.user_id == viewer,
                                                               WattenAchievementGrant.achievement_id == goal))
        assert grant.source_game_id == "qualified-earlier"
        grant.source_game_id, grant.reached_at = later["_id"], FINISHED + timedelta(seconds=1)
    with pytest.raises(WattenAccountError, match="invalid_journal"):
        build_watten_account(viewer)
