"""Explicit forfeitures stay separate from round XP and recoverable delivery."""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from alembic.config import Config
from sqlalchemy import event, func, select
from sqlalchemy.exc import SQLAlchemyError

from alembic import command
from app import main
from app.auth import create_user
from app.database import configure_database, get_engine, session_scope, upgrade_database
from app.game_history import persist_completed_game_result
from app.hausdepp_account import build_hausdepp_account_for_user
from app.hausdepp_achievement_feed import list_hausdepp_achievement_feed
from app.hausdepp_achievements import acknowledge_hausdepp_presentation, synchronize_hausdepp_progress
from app.hausdepp_departure_store import persist_hausdepp_departure
from app.hausdepp_leaderboard import build_hausdepp_leaderboard
from app.hausdepp_notices import acknowledge_hausdepp_notice, pending_hausdepp_notices
from app.hausdepp_results import validate_hausdepp_result, validated_hausdepp_membership
from app.hausdepp_round_summary import build_round_summary
from app.models import ActiveGame, CompletedGame, HausdeppAchievementUnlock, HausdeppRoundCredit, HausdeppWithdrawal

AT = datetime(2026, 10, 16, 18, 30, tzinfo=timezone.utc)


@pytest.fixture
def owners(tmp_path):
    url = f"sqlite:///{tmp_path}/departures.sqlite3"
    with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": url}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        first = create_user("DepartureOwner", "test-password-123", must_change_password=False)
        second = create_user("DepartureFriend", "test-password-123", must_change_password=False)
        yield SimpleNamespace(first=first, second=second, url=url)
    configure_database(main.DATA_DIR)


def proposed(owners, game_id="departure-1", *, forfeited=True, guest=False, at=AT):
    return {
        "_id": game_id, "_name": "Private departure", "_game_type": "hausdepp", "_mode": "2",
        "_started": True, "_finished": False, "_aborted": False, "_players": [],
        "_participants": [
            {"id": "self", "name": owners.first.username, "is_cpu": False,
             "user_id": None if guest else owners.first.id},
            {"id": "friend", "name": owners.second.username, "is_cpu": False, "user_id": owners.second.id},
        ],
        "_hausdepp": {"version": 2, "withdrawn_ids": ["self"] if forfeited else [],
                       "finished_order": [] if forfeited else ["self"]},
        "_hausdepp_departures": {"self": {"round_number": 1, "departed_at": at.isoformat(),
                                            "forfeited_round": forfeited}},
    }


def depart(owners, game=None, *, forfeited=True, guest=False, at=AT):
    game = game or proposed(owners, forfeited=forfeited, guest=guest, at=at)
    return persist_hausdepp_departure(game, user_id=None if guest else owners.first.id, player_id="self",
                                     result_id=game["_id"], departed_at=at, forfeited_round=forfeited)


def store_round(owners, game_id, *, schema=1, remaining=False):
    participants = [{"id": "self", "name": owners.first.username, "is_cpu": False},
                    {"id": "friend", "name": owners.second.username, "is_cpu": False}]
    payload = {"schema_version": schema, "payload_kind": "hausdepp_result", "game_type": "hausdepp",
               "game_id": game_id, "name": "Saved round", "finished_at": AT.isoformat(),
               "participants": participants, "finished_order": [] if remaining else ["self"],
               "loser_id": None if remaining else "friend"}
    if schema == 4:
        payload.update(withdrawn_ids=["self"], round_end_reason="insufficient_players", remaining_player_id="friend")
        payload["achievement_evidence"] = {"schema_version": 1, "complete": True,
            "players": {p["id"]: {"flags": [], "ten_clears": 0} for p in participants}}
    assert persist_completed_game_result(
        game_id=game_id, game_name=payload["name"], game_type="hausdepp", mode="2", hardcore=False,
        finished_at=AT, snapshot=payload,
        participants=[{"player_key": p["id"], "display_name": p["name"],
                       "user_id": owners.first.id if p["id"] == "self" else owners.second.id} for p in participants],
    ).succeeded
    return payload


def test_forfeit_creates_only_zero_xp_zonk_with_revision_delivery_and_ack(owners):
    assert depart(owners) == {"departure_persisted": True, "already_persisted": False}
    progress = synchronize_hausdepp_progress(owners.first.id)
    assert progress["scoring"]["points"] == progress["scoring"]["round_points"] == 0
    assert progress["achievements"]["unlocked_count"] == 1
    zonk = next(item for item in progress["achievements"]["items"] if item["unlocked"])
    assert (zonk["id"], zonk["points"], zonk["category"]) == ("hausdepp_136", 0, "zonk")
    assert set(zonk["name"]) == set(zonk["description"]) == {"de", "en"}
    assert progress["presentation"]["pending"]["points_earned"] == 0
    assert progress["presentation"]["revision"] == 1
    queue = pending_hausdepp_notices(owners.first.id)
    assert len(queue["notices"]) == 1
    notice = queue["notices"][0]
    assert notice["points"] == 0 and notice["source"] is None
    assert notice["evidence"]["current_condition_proven"] is True
    assert "0 EP" in notice["reason"]["de"]
    acknowledge_hausdepp_notice(owners.first.id, notice["key"])
    acknowledge_hausdepp_presentation(owners.first.id, 1)
    assert pending_hausdepp_notices(owners.first.id)["notices"] == []
    assert synchronize_hausdepp_progress(owners.first.id)["presentation"]["pending"] is None
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(CompletedGame)) == 0
        assert db.scalar(select(func.count()).select_from(HausdeppRoundCredit)) == 0
        assert db.scalar(select(func.count()).select_from(HausdeppWithdrawal)) == 1
    feed = list_hausdepp_achievement_feed(owners.second.id)
    assert feed["items"][0]["achievement"]["points"] == 0
    assert "departure-1" not in json.dumps(feed)


def test_sync_failure_after_commit_is_recovered_without_reverting_departure(owners):
    with patch("app.hausdepp_achievements.synchronize_hausdepp_progress", side_effect=RuntimeError("retry")):
        assert depart(owners)["departure_persisted"]
    with session_scope() as db:
        assert db.scalar(select(ActiveGame).where(ActiveGame.game_id == "departure-1")) is not None
        assert db.get(HausdeppWithdrawal, (owners.first.id, "departure-1")) is not None
        assert db.get(HausdeppAchievementUnlock, (owners.first.id, "hausdepp_136")) is None
    assert synchronize_hausdepp_progress(owners.first.id)["achievements"]["unlocked_count"] == 1


@pytest.mark.parametrize("guest,forfeited", [(True, True), (False, False), (True, False)])
def test_guests_and_normal_finished_departures_get_checkpoint_without_zonk(owners, guest, forfeited):
    assert depart(owners, guest=guest, forfeited=forfeited)["departure_persisted"]
    with session_scope() as db:
        assert db.scalar(select(ActiveGame).where(ActiveGame.game_id == "departure-1")) is not None
        assert db.scalar(select(func.count()).select_from(HausdeppWithdrawal)) == 0
        assert db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)) == 0


def test_atomic_failure_rolls_back_checkpoint_and_account_receipt(owners):
    engine = get_engine()
    def fail(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.startswith("INSERT INTO hausdepp_withdrawals"):
            raise SQLAlchemyError("forced receipt failure")
    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(SQLAlchemyError, match="forced receipt"):
            depart(owners)
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    with session_scope() as db:
        assert db.scalar(select(ActiveGame).where(ActiveGame.game_id == "departure-1")) is None
        assert db.scalar(select(func.count()).select_from(HausdeppWithdrawal)) == 0


def test_retry_preserves_newer_checkpoint_and_grants_zonk_once(owners):
    game = proposed(owners)
    depart(owners, game)
    with session_scope() as db:
        stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == "departure-1"))
        raw = json.loads(stored.state_json)
        raw["_hausdepp"]["version"] = 99
        stored.state_json = json.dumps(raw)
    assert depart(owners, game)["already_persisted"]
    with session_scope() as db:
        assert json.loads(db.scalar(select(ActiveGame).where(ActiveGame.game_id == "departure-1")).state_json)["_hausdepp"]["version"] == 99
        assert db.scalar(select(func.count()).select_from(HausdeppAchievementUnlock)) == 1
    depart(owners, proposed(owners, "departure-2", at=AT + timedelta(minutes=1)), at=AT + timedelta(minutes=1))
    assert synchronize_hausdepp_progress(owners.first.id)["presentation"]["revision"] == 1


def test_invalid_identity_timestamp_round_and_forfeit_marker_fail_closed(owners):
    game = proposed(owners)
    for kwargs in ({"user_id": owners.second.id}, {"result_id": "different"},
                   {"departed_at": AT.replace(tzinfo=None)}, {"forfeited_round": False}):
        params = {"user_id": owners.first.id, "player_id": "self", "result_id": game["_id"],
                  "departed_at": AT, "forfeited_round": True, **kwargs}
        with pytest.raises(ValueError, match="invalid_departure"):
            persist_hausdepp_departure(game, **params)


def test_legacy_result_cannot_recover_credit_stats_or_normal_badges_for_withdrawal(owners):
    depart(owners)
    store_round(owners, "departure-1")  # Deliberately lacks the new JSON marker.
    account = build_hausdepp_account_for_user(owners.first.id)
    assert account["statistics"]["rounds_played"] == 0
    assert account["history"]["rounds"] == []
    assert account["scoring"]["points"] == 0
    assert [item["id"] for item in account["achievements"]["items"] if item["unlocked"]] == ["hausdepp_136"]
    assert all(not item["is_self"] for item in build_hausdepp_leaderboard(owners.first.id)["entries"])
    with session_scope() as db:
        assert db.get(HausdeppRoundCredit, (owners.first.id, "departure-1")) is None
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == "departure-1"))
        assert validated_hausdepp_membership(row, owners.first.id, db=db) is None


def test_remaining_player_gets_round_xp_without_fake_finish_win_or_hausdepp(owners):
    depart(owners)
    payload = store_round(owners, "departure-1", schema=4, remaining=True)
    assert validate_hausdepp_result(payload)["loser_id"] is None
    remaining = build_hausdepp_account_for_user(owners.second.id)
    assert remaining["scoring"]["round_points"] == 10
    assert remaining["statistics"]["rounds_played"] == 1
    assert remaining["statistics"]["finished_rounds"] == remaining["statistics"]["hausdepp_rounds"] == 0
    assert remaining["history"]["rounds"][0]["outcome"] == "remaining"
    assert next(item for item in remaining["achievements"]["items"] if item["id"] == "hausdepp_57")["progress"]["current"] == 0
    own = next(item for item in build_hausdepp_leaderboard(owners.second.id)["entries"] if item["is_self"])
    assert own["wins"] == 0
    summary = build_round_summary("departure-1", proposed(owners)["_participants"])
    assert summary["players"]["self"]["round_xp"] == 0
    assert summary["players"]["friend"]["round_xp"] == 10
    payload["achievement_evidence"]["players"]["friend"]["flags"] = ["hausdepp_62"]
    with pytest.raises(ValueError, match="invalid_evidence"):
        validate_hausdepp_result(payload)


def test_zero_xp_unlock_advances_existing_revision_and_stale_ack_cannot_hide_it(owners):
    store_round(owners, "earlier-finish")
    previous = synchronize_hausdepp_progress(owners.first.id)
    revision, points = previous["presentation"]["revision"], previous["scoring"]["points"]
    acknowledge_hausdepp_presentation(owners.first.id, revision)
    depart(owners)
    current = synchronize_hausdepp_progress(owners.first.id)
    assert current["scoring"]["points"] == points
    assert current["presentation"]["revision"] == revision + 1
    acknowledge_hausdepp_presentation(owners.first.id, revision)
    pending = synchronize_hausdepp_progress(owners.first.id)["presentation"]["pending"]
    assert pending["achievement_ids"] == ["hausdepp_136"] and pending["points_earned"] == 0


def test_migration_refuses_dropping_live_forfeiture_evidence(owners):
    depart(owners)
    config = Config(str(main.BASE / "alembic.ini"))
    config.set_main_option("script_location", str(main.BASE / "alembic"))
    config.set_main_option("sqlalchemy.url", owners.url)
    with pytest.raises(RuntimeError, match="withdrawal evidence"):
        command.downgrade(config, "20261020_0075")


def _domain_table(owners, *, count=2, tournament=True):
    from tests.test_hausdepp_departure import table

    game = table(count=count, tournament=tournament, accounts=True)
    for index, person in enumerate(game["_participants"]):
        person["user_id"] = owners.first.id if index == 0 else owners.second.id if index == 1 else None
        game["_players"][index]["user_id"] = person["user_id"]
    game["_hausdepp_host_user_id"] = owners.first.id
    return game


def test_terminal_departure_checkpoint_recovers_result_without_inventing_a_loser(owners):
    from app.active_games import load_active_games
    from app.hausdepp_departure import _propose_departure
    from app.hausdepp_results import finalize_hausdepp_result

    game = _domain_table(owners)
    changed, forfeited = _propose_departure(game, "p0", game["_hausdepp"]["version"], AT)
    persist_hausdepp_departure(changed, user_id=owners.first.id, player_id="p0", result_id=game["_id"],
                               departed_at=AT, forfeited_round=forfeited)
    restored = load_active_games()[game["_id"]]
    assert restored["_hausdepp"]["loser_id"] is None
    assert finalize_hausdepp_result(restored)["result_persisted"]
    with session_scope() as db:
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
        saved = validate_hausdepp_result(json.loads(row.snapshot_json))
        assert saved["schema_version"] == 4
        assert saved["withdrawn_ids"] == ["p0"] and saved["remaining_player_id"] == "p1"
        assert saved["tournament"]["round_losers"] == [None]
        assert saved["tournament"]["tages_hausdepp_id"] is None
    account = build_hausdepp_account_for_user(owners.second.id)
    assert account["scoring"]["round_points"] == 10
    assert account["statistics"]["finished_rounds"] == account["statistics"]["hausdepp_rounds"] == 0
    assert not any(item["unlocked"] for item in account["achievements"]["items"] if item["category"] == "tournament")


def test_finished_human_keeps_current_round_xp_after_cpu_only_completion(owners):
    from app.hausdepp_departure import _propose_departure
    from app.hausdepp_engine import apply_action
    from app.hausdepp_results import finalize_hausdepp_result
    from app.hausdepp_tournament import record_finished_round
    from tests.test_hausdepp_engine import scenario

    game = _domain_table(owners, count=3)
    game["_hausdepp"] = scenario([[], ["bells-6"], ["leaves-6"]], deck=[])
    for person in game["_participants"][1:]:
        person.update(is_cpu=True, type="cpu", user_id=None)
    for person in game["_hausdepp"]["players"][1:]:
        person["is_cpu"] = True
    game["_players"] = game["_players"][:1]
    changed, forfeited = _propose_departure(game, "p0", game["_hausdepp"]["version"], AT)
    assert forfeited is False
    persist_hausdepp_departure(changed, user_id=owners.first.id, player_id="p0", result_id=game["_id"],
                               departed_at=AT, forfeited_round=False)
    state = changed["_hausdepp"]
    state["current_player_id"] = "p1"
    state = apply_action(state, "p1", "play", cards=["bells-6"], version=state["version"])
    changed.update(_hausdepp=state, _finished=True, _finished_at=(AT + timedelta(seconds=1)).isoformat())
    record_finished_round(changed)
    assert finalize_hausdepp_result(changed)["result_persisted"]
    account = build_hausdepp_account_for_user(owners.first.id)
    assert account["statistics"]["finished_rounds"] == 1
    assert account["scoring"]["round_points"] == 2
    assert account["history"]["rounds"][0]["outcome"] == "finished"
    assert not next(item for item in account["achievements"]["items"] if item["id"] == "hausdepp_136")["unlocked"]
    assert not any(item["unlocked"] for item in account["achievements"]["items"] if item["category"] == "tournament")
    with session_scope() as db:
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
        saved = validate_hausdepp_result(json.loads(row.snapshot_json))
        assert saved["tournament"]["end_reason"] == "no_human_players"
        assert saved["tournament"]["tages_hausdepp_id"] is None


def test_later_round_uses_current_roster_while_tournament_keeps_original_participants(owners):
    from app.hausdepp_departure import _propose_departure
    from app.hausdepp_engine import apply_action, make_deck
    from app.hausdepp_results import finalize_hausdepp_result
    from app.hausdepp_tournament import start_next_round
    from tests.test_hausdepp_tournament import finish_round

    game = _domain_table(owners, count=3)
    changed, forfeited = _propose_departure(game, "p2", game["_hausdepp"]["version"], AT)
    persist_hausdepp_departure(changed, user_id=None, player_id="p2", result_id=game["_id"],
                               departed_at=AT, forfeited_round=forfeited)
    state = changed["_hausdepp"]
    state.update(deck=[], discard=[], pending_refills={}, pending_refill=None, afterthrow=None, current_player_id="p0")
    state["players"][0]["hand"], state["players"][1]["hand"] = ["hearts-6"], ["bells-6"]
    state["burned"] = [card for card in make_deck() if card not in {"hearts-6", "bells-6"}]
    state = apply_action(state, "p0", "play", cards=["hearts-6"], version=state["version"])
    changed.update(_hausdepp=state, _finished=True, _finished_at=AT.isoformat())
    assert finalize_hausdepp_result(changed)["result_persisted"]
    start_next_round(changed, "p0", state["version"])
    finish_round(changed, "p1")
    assert finalize_hausdepp_result(changed)["result_persisted"]
    with session_scope() as db:
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == f"{game['_id']}-r02"))
        saved = validate_hausdepp_result(json.loads(row.snapshot_json))
        assert {person["id"] for person in saved["participants"]} == {"p0", "p1"}
        assert set(saved["tournament"]["participant_ids"]) == {"p0", "p1", "p2"}
    assert build_hausdepp_account_for_user(owners.first.id)["statistics"]["rounds_played"] == 2


@pytest.mark.parametrize("field,value", [("round_end_reason", []), ("round_end_reason", {}),
                                         ("withdrawn_ids", {}), ("withdrawn_ids", [[]]),
                                         ("remaining_player_id", []), ("finished_order", [{}])])
def test_result_v4_malformed_terminal_fields_have_stable_validation_errors(owners, field, value):
    payload = store_round(owners, "bad-shape", schema=4, remaining=True)
    payload[field] = value
    with pytest.raises(ValueError, match="invalid_outcome"):
        validate_hausdepp_result(payload)


def test_public_compatibility_result_keeps_new_outcome_schema_without_private_evidence(owners):
    from app.hausdepp_results import list_hausdepp_results_for_user

    store_round(owners, "new-terminal", schema=4, remaining=True)
    results = list_hausdepp_results_for_user(owners.second.id)
    assert len(results) == 1 and results[0]["schema_version"] == 4
    assert results[0]["loser_id"] is None and results[0]["remaining_player_id"] == "friend"
    assert "achievement_evidence" not in results[0] and "tournament" not in results[0]
