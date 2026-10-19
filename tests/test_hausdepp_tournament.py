"""The eight-letter tournament survives retries, devices, rounds and restarts."""

from __future__ import annotations

import asyncio
import json
import os
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from random import Random
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app import main
from app.active_games import load_active_games, save_active_game, serializable_game_state
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_registry import create_game_state
from app.game_state import check_timeout_and_abort, games, multiplayer_pause_reason
from app.game_ws_session import GameSocketSession, handle_session_action
from app.game_ws_social import handle_social_action
from app.hausdepp_account import build_hausdepp_account_for_user
from app.hausdepp_cpu_strategy import CpuMemory, choose_cpu_action
from app.hausdepp_engine import HausdeppRuleError, make_deck, new_round, project_state
from app.hausdepp_gameplay import apply_hausdepp_command, handle_hausdepp_gameplay_action, publish_hausdepp_transition
from app.hausdepp_results import finalize_hausdepp_result, validate_hausdepp_result
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, start_hausdepp_game
from app.hausdepp_tournament import (
    new_tournament,
    project_hausdepp_tournament,
    record_finished_round,
    round_result_id,
    start_next_round,
    validate_tournament,
)
from app.models import CompletedGame


class Socket:
    def __init__(self):
        self.messages = []

    async def send_json(self, message):
        self.messages.append(message)


@pytest.fixture
def database(tmp_path):
    with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/tournament.sqlite3"}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        owner = create_user("TourHost", "test-password-123", must_change_password=False)
        other = create_user("TourGuest", "test-password-123", must_change_password=False)
        yield owner, other
    games.clear()
    configure_database(main.DATA_DIR)


def table(database, *, count=2, dealer=None):
    owner, other = database
    game = create_game_state("stable-table", "Acht Buchstaben", str(count), "hausdepp")
    configure_hausdepp_game(game, host_user_id=owner.id, cpu_count=count - 2, tournament=True)
    for key, account in (("p0", owner), ("p1", other)):
        join_hausdepp_player(game, {"id": key, "name": account.username, "user_id": account.id,
                                   "ws": Socket(), "resume_token": f"resume-{key}"})
    with patch("app.hausdepp_state._DEALER_RANDOM.randrange", return_value=count - 1 if dealer is None else dealer):
        start_hausdepp_game(game)
    return game


def finish_round(game, loser="p1"):
    """Arrange a complete, conserved endgame, then use a real accepted action."""
    state = game["_hausdepp"]
    winner = next(player["id"] for player in state["players"] if player["id"] != loser)
    state["phase"] = "playing"
    state["deck"] = []
    state["discard"] = []
    state["pending_refills"] = {}
    state["pending_refill"] = None
    state["afterthrow"] = None
    state["finished_order"] = []
    for player in state["players"]:
        player["hand"] = ["hearts-6"] if player["id"] == winner else ["bells-7"] if player["id"] == loser else []
        player["finished"] = player["id"] not in {winner, loser}
        if player["finished"]:
            state["finished_order"].append(player["id"])
    state["burned"] = [card for card in make_deck() if card not in {"hearts-6", "bells-7"}]
    state["current_player_id"] = winner
    apply_hausdepp_command(game, winner, {"action": "play", "cards": ["hearts-6"], "version": state["version"]},
                           trusted_cpu=winner.startswith("cpu-"))
    assert game["_finished"]


def test_configure_rotating_dealer_and_active_peek_without_replacing_seats(database):
    game = table(database, count=3)
    assert game["_hausdepp"]["dealer_id"] == "cpu-1"
    sockets = [player["ws"] for player in game["_players"]]
    participants = deepcopy(game["_participants"])
    game["_chat_history"] = [{"text": "Unser Tisch bleibt."}]
    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", version)
    assert game["_id"] == "stable-table"
    assert game["_hausdepp"]["phase"] == "peeking"
    assert game["_hausdepp"]["dealer_id"] == "p0"
    assert game["_hausdepp"]["version"] > version
    assert game["_hausdepp_tournament"]["round_number"] == 2
    assert game["_participants"] == participants
    assert [player["ws"] for player in game["_players"]] == sockets
    assert game["_chat_history"] == [{"text": "Unser Tisch bleibt."}]
    assert not game["_finished"]
    assert not game.get("_completion_persisted")


def test_first_dealer_is_random_and_the_deal_then_passes_clockwise(database):
    seen = set()
    for dealer in range(3):
        game = table(database, count=3, dealer=dealer)
        participants = [player["id"] for player in game["_participants"]]
        state = game["_hausdepp"]
        assert state["dealer_id"] == participants[dealer]
        # The player before the dealer looks at the bottom card.
        assert state["peek_information"]["player_id"] == participants[(dealer - 1) % 3]
        seen.add(state["peek_information"]["player_id"])
        games.pop(game["_id"], None)
    assert seen == {"p0", "p1", "cpu-1"}
    game = table(database, count=3, dealer=0)
    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", version)
    assert game["_hausdepp"]["dealer_id"] == "p1"
    assert game["_hausdepp"]["peek_information"]["player_id"] == "p0"


@pytest.mark.parametrize("stopper", ["bells-10", "bells-K"])
def test_next_round_clears_previous_successful_and_private_cut_cards(database, stopper):
    game = table(database, count=3, dealer=1)
    cards = ["hearts-A", stopper]
    deck = [card for card in make_deck() if card not in cards]
    game["_hausdepp"] = new_round(game["_participants"], dealer_index=1, deck=[*deck, *reversed(cards)])
    for _ in cards:
        apply_hausdepp_command(game, "p0", {"action": "peek", "version": game["_hausdepp"]["version"]})
    assert project_state(game["_hausdepp"], "p0")["private_peek"] == cards
    assert game["_hausdepp"]["peek_information"]["success"] is (stopper == "bells-10")

    finish_round(game)
    version = game["_hausdepp"]["version"]
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", version)

    state = game["_hausdepp"]
    assert state["peek_information"] == {
        "player_id": "p1", "cards": [], "success": None, "complete": False,
    }
    for viewer in ("p0", "p1", "cpu-1", None):
        projection = project_state(state, viewer)
        assert projection["private_peek"] == []
        assert projection["private_peek_in_stock"] == []
        assert "cards" not in projection["peek"]
        assert projection["peek_information"] == state["peek_information"]


def test_next_round_requires_host_finished_persisted_round_and_fresh_version(database):
    game = table(database)
    with pytest.raises(HausdeppRuleError, match="hausdepp_tournament_round_not_finished"):
        start_next_round(game, "p0", game["_hausdepp"]["version"])
    finish_round(game)
    version = game["_hausdepp"]["version"]
    before = serializable_game_state(game)
    for key, expected in (("p1", "hausdepp_host_required"), ("cpu-1", "hausdepp_host_required"),
                          ("p0", "hausdepp_result_persistence_pending")):
        with pytest.raises(HausdeppRuleError, match=expected):
            start_next_round(game, key, version)
        assert serializable_game_state(game) == before
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", version)
    before = serializable_game_state(game)
    with pytest.raises(HausdeppRuleError, match="hausdepp_stale_version"):
        start_next_round(game, "p0", version)
    assert serializable_game_state(game) == before


def test_each_loss_adds_one_prefix_and_eighth_immediately_ends_tournament(database):
    game = table(database)
    for number in range(1, 9):
        finish_round(game)
        before = deepcopy(game["_hausdepp_tournament"])
        record_finished_round(game)
        assert game["_hausdepp_tournament"] == before
        projection = project_hausdepp_tournament(game, "p0")
        assert projection["letters"]["p1"] == "HAUSDEPP"[:number]
        assert projection["losses"]["p1"] == number
        assert projection["completed"] is (number == 8)
        assert finalize_hausdepp_result(game)["result_persisted"]
        if number < 8:
            assert project_hausdepp_tournament(game, "p0")["can_start_next_round"]
            start_next_round(game, "p0", game["_hausdepp"]["version"])
    assert game["_hausdepp_tournament"]["tages_hausdepp_id"] == "p1"
    assert not project_hausdepp_tournament(game, "p0")["can_start_next_round"]
    with pytest.raises(HausdeppRuleError, match="hausdepp_tournament_finished"):
        start_next_round(game, "p0", game["_hausdepp"]["version"])
    with session_scope() as db:
        rows = list(db.scalars(select(CompletedGame).where(CompletedGame.game_type == "hausdepp")))
        assert len(rows) == 8
        assert {row.game_id for row in rows} == {round_result_id("stable-table", number) for number in range(1, 9)}
    account = build_hausdepp_account_for_user(database[0].id)
    assert account["scoring"]["round_points"] == 80
    assert account["statistics"]["rounds_played"] == 8
    assert account["statistics"]["finished_rounds"] == 8
    assert "stable-table" not in load_active_games()


def test_interround_state_survives_database_reload_and_preserves_results(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    restored = load_active_games()["stable-table"]
    assert restored["_finished"]
    assert restored["_completion_persisted"]
    assert restored["_hausdepp_tournament"]["losses"] == {"p0": 0, "p1": 1}
    assert all(player["ws"] is None for player in restored["_players"])
    assert finalize_hausdepp_result(restored)["result_persisted"]
    assert restored["_hausdepp_tournament"]["losses"]["p1"] == 1
    start_next_round(restored, "p0", restored["_hausdepp"]["version"])
    save_active_game(restored)
    again = load_active_games()["stable-table"]
    assert again["_hausdepp_tournament"]["round_number"] == 2
    assert again["_hausdepp"]["phase"] == "peeking"
    assert again["_hausdepp"]["dealer_id"] == "p0"


def test_failed_result_write_retains_round_and_prevents_starting_next(database):
    game = table(database)
    finish_round(game)
    with patch("app.hausdepp_results.persist_completed_game_result",
               return_value=SimpleNamespace(succeeded=False, reason="database_error")):
        assert not finalize_hausdepp_result(game)["result_persisted"]
    assert "stable-table" in load_active_games()
    with pytest.raises(HausdeppRuleError, match="hausdepp_result_persistence_pending"):
        start_next_round(game, "p0", game["_hausdepp"]["version"])
    assert finalize_hausdepp_result(game)["result_persisted"]
    assert game["_hausdepp_tournament"]["losses"]["p1"] == 1


def test_finished_broadcast_waits_for_round_persistence(database):
    game = table(database)
    finish_round(game)
    order = []

    async def publish(_game, _payload):
        order.append("broadcast")
        assert _game["_completion_persisted"]

    def finalize(_game):
        order.append("persist")
        return finalize_hausdepp_result(_game)

    with patch("app.hausdepp_gameplay.broadcast", side_effect=publish):
        asyncio.run(publish_hausdepp_transition(game, finalize_game=finalize))
    assert order == ["persist", "broadcast"]


def test_next_round_socket_ack_and_replaced_socket_protection(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    socket = game["_players"][0]["ws"]
    session = SimpleNamespace(game=game, is_spectator=False, player_id="p0", websocket=socket)
    version = game["_hausdepp"]["version"]
    with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"), patch("app.game_activity.record_gameplay"):
        asyncio.run(handle_hausdepp_gameplay_action(session, "hausdepp_next_round",
                    {"version": version, "command_id": "next-1"}, finalize_game=finalize_hausdepp_result))
    assert socket.messages[-1]["hausdepp_command"]["accepted"]
    assert socket.messages[-1]["hausdepp_command"]["version"] > version
    stale_socket = Socket()
    session.websocket = stale_socket
    asyncio.run(handle_hausdepp_gameplay_action(session, "hausdepp_next_round",
                {"version": game["_hausdepp"]["version"], "command_id": "next-stale"}))
    assert stale_socket.messages[-1]["error_code"] == "hausdepp_invalid_actor"


def test_participant_and_spectator_tournament_projection_is_explicit(database):
    game = table(database)
    finish_round(game)
    finalize_hausdepp_result(game)
    assert project_hausdepp_tournament(game, "p0")["can_start_next_round"]
    assert not project_hausdepp_tournament(game, "p1")["can_start_next_round"]
    assert not project_hausdepp_tournament(game, None)["can_start_next_round"]
    public = json.dumps(project_hausdepp_tournament(game, None))
    for private in ("user_id", "resume_token", "achievement_evidence", "hand", "deck"):
        assert private not in public


@pytest.mark.parametrize("change", [
    {"round_number": True}, {"round_number": 44}, {"losses": {"p0": 0, "p1": 8}},
    {"round_losers": ["outsider"]}, {"completed": True}, {"tages_hausdepp_id": "p1"},
])
def test_contradictory_restored_scores_fail_closed(database, change):
    game = table(database)
    tournament = deepcopy(game["_hausdepp_tournament"])
    tournament.update(change)
    with pytest.raises(ValueError, match="hausdepp_invalid_tournament"):
        validate_tournament(tournament, {"p0", "p1"})
    game["_hausdepp_tournament"] = tournament
    assert project_hausdepp_tournament(game) is None


def test_tournament_result_schema_rejects_wrong_round_id_score_and_nonfinal_awards(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    with session_scope() as db:
        row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
        payload = json.loads(row.snapshot_json)
    assert payload["schema_version"] == 3
    assert validate_hausdepp_result(payload)["tournament"]["round_number"] == 1
    for mutation in ("round_id", "unknown_seat", "nonfinal_award"):
        invalid = deepcopy(payload)
        if mutation == "round_id":
            invalid["game_id"] = "different-round"
        elif mutation == "unknown_seat":
            invalid["tournament"]["losses"]["stranger"] = 1
        else:
            invalid["achievement_evidence"]["players"]["p0"]["flags"].append("hausdepp_100")
        with pytest.raises(ValueError):
            validate_hausdepp_result(invalid)


def test_unique_round_ids_remain_bounded_for_long_room_ids():
    first, second = "a" * 63 + "x", "a" * 63 + "y"
    assert len(round_result_id(first, 43)) <= 64
    assert round_result_id(first, 43) != round_result_id(second, 43)
    assert round_result_id(first, 1) == first


def test_interround_timeout_aborts_only_tournament_and_preserves_earned_round_credit(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    last = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)
    game["_last_activity"] = last
    assert not check_timeout_and_abort(game, now=last + timedelta(minutes=59, seconds=59))
    assert check_timeout_and_abort(game, now=last + timedelta(hours=1))
    assert game["_aborted"]
    assert game["_abort_reason"] == "inactivity_timeout"
    assert not game["_hausdepp_tournament"]["completed"]
    assert "stable-table" not in load_active_games()
    account = build_hausdepp_account_for_user(database[0].id)
    assert account["scoring"]["round_points"] == 10
    assert account["statistics"]["rounds_played"] == 1
    assert not next(item for item in account["achievements"]["items"] if item["id"] == "hausdepp_85")["unlocked"]


def tournament_finale(losers, participant_count=3):
    participants = [{"id": f"p{index}", "name": f"P{index}", "is_cpu": False}
                    for index in range(participant_count)]
    tournament = new_tournament("finale", participants)
    tournament.update(round_number=len(losers), round_losers=list(losers[:-1]))
    tournament["losses"] = {player["id"]: losers[:-1].count(player["id"]) for player in participants}
    state = new_round(participants, deck=make_deck())
    state.update(phase="finished", loser_id=losers[-1],
                 finished_order=[player["id"] for player in participants if player["id"] != losers[-1]])
    game = {"_hausdepp": state, "_participants": participants, "_hausdepp_tournament": tournament}
    record_finished_round(game)
    return {key: set(facts["flags"]) for key, facts in state["achievement_evidence"]["players"].items()}


@pytest.mark.parametrize("quiet_player", [False, True])
def test_final_tournament_only_awards_feasible_return_streak_and_letter_achievements(quiet_player):
    awarded = tournament_finale(["p1"] * 7 + ["p2"] * 7 + ["p0"] * 8, 4 if quiet_player else 3)
    assert {"hausdepp_85", "hausdepp_88", "hausdepp_89", "hausdepp_97", "hausdepp_100"} <= awarded["p0"]
    assert {"hausdepp_85", "hausdepp_88", "hausdepp_92", "hausdepp_93", "hausdepp_94", "hausdepp_95",
            "hausdepp_96", "hausdepp_97", "hausdepp_98"} <= awarded["p1"]
    assert ("hausdepp_99" in awarded["p1"]) is (not quiet_player)
    assert not {"hausdepp_86", "hausdepp_87"} & set.union(*awarded.values())
    if quiet_player:
        assert "hausdepp_90" in awarded["p3"]


def test_completed_tournament_exactly_one_loss_is_distinct_from_the_final_loser():
    awarded = tournament_finale(["p0"] * 7 + ["p1", "p0"], 2)
    assert "hausdepp_91" in awarded["p1"]
    assert "hausdepp_89" not in awarded["p1"]
    assert "hausdepp_92" not in awarded["p1"]


def test_real_interround_rejoin_then_host_start_waits_only_for_missing_human(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    restored = load_active_games()["stable-table"]
    host_identity = SimpleNamespace(user_id=database[0].id, achievement_rank=None)
    guest_identity = SimpleNamespace(user_id=database[1].id, achievement_rank=None)
    host = GameSocketSession(Socket(), restored, host_identity)
    guest = GameSocketSession(Socket(), restored, guest_identity)

    async def reconnect():
        assert not await handle_session_action(host, "rejoin_game", {"player_id": "p0"})
        assert host.player_id == "p0"
        version = restored["_hausdepp"]["version"]
        await handle_hausdepp_gameplay_action(host, "hausdepp_next_round", {"version": version},
                                             finalize_game=finalize_hausdepp_result)
        assert restored["_resume_required"]
        assert multiplayer_pause_reason(restored)
        assert not await handle_session_action(guest, "rejoin_game", {"player_id": "p1"})
        assert not restored["_resume_required"]
        assert multiplayer_pause_reason(restored) is None
        assert not restored["_manual_pause"]

    with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"), patch("app.game_activity.record_gameplay"):
        asyncio.run(reconnect())


def test_own_socket_can_abort_between_rounds_without_changing_letters_or_earned_points(database):
    game = table(database)
    finish_round(game)
    assert finalize_hausdepp_result(game)["result_persisted"]
    session = GameSocketSession(game["_players"][0]["ws"], game,
                                SimpleNamespace(user_id=database[0].id), player_id="p0")
    before = build_hausdepp_account_for_user(database[0].id)
    letters = deepcopy(game["_hausdepp_tournament"]["losses"])
    asyncio.run(handle_social_action(session, "end_game", {}))
    assert game["_aborted"]
    assert game["_abort_reason"] == "manual"
    assert not game["_hausdepp_tournament"]["completed"]
    asyncio.run(handle_social_action(session, "end_game", {}))
    after = build_hausdepp_account_for_user(database[0].id)
    assert game["_hausdepp_tournament"]["losses"] == letters
    assert after["statistics"] == before["statistics"]
    assert after["scoring"] == before["scoring"]
    assert after["scoring"]["round_points"] == 10
    assert not next(item for item in after["achievements"]["items"] if item["id"] == "hausdepp_89")["unlocked"]


def test_restore_rejects_malformed_tournament_participant_instead_of_crashing_startup(database):
    game = table(database)
    del game["_participants"][0]["id"]
    save_active_game(game)
    assert "stable-table" not in load_active_games()


@pytest.mark.parametrize("count", range(2, 7))
def test_seeded_full_tournament_for_each_table_size_rotates_restores_and_credits_once(database, count):
    random = Random(47000 + count)
    completed_rounds = 0
    with patch("app.hausdepp_engine.SystemRandom", return_value=random):
        game = table(database, count=count)
        while not game["_hausdepp_tournament"]["completed"]:
            dealer_id = game["_hausdepp"]["dealer_id"]
            memories = {player["id"]: CpuMemory() for player in game["_participants"]}
            for _ in range(1000):
                state = game["_hausdepp"]
                if state["phase"] == "finished":
                    break
                debt = next(iter(state["pending_refills"]), None)
                follower = (state.get("afterthrow") or {}).get("player_id")
                actor = debt or follower or state["current_player_id"]
                view = project_state(state, actor)
                decision = choose_cpu_action(view, memory=memories[actor])
                if decision is None:
                    actor = state["current_player_id"]
                    view = project_state(state, actor)
                    decision = choose_cpu_action(view, memory=memories[actor])
                assert decision is not None
                player = next(player for player in game["_participants"] if player["id"] == actor)
                apply_hausdepp_command(game, actor, decision, trusted_cpu=bool(player["is_cpu"]))
                memories[actor].remember(view, decision)
                state = game["_hausdepp"]
                physical = state["deck"] + state["discard"] + state["burned"]
                physical += [card for seat in state["players"] for card in seat["hand"]]
                assert sorted(physical) == sorted(make_deck())
            else:
                pytest.fail(f"Tournament round stalled: {count} seats, round {completed_rounds + 1}")
            completed_rounds += 1
            assert completed_rounds <= 7 * count + 1
            assert sum(game["_hausdepp_tournament"]["losses"].values()) == completed_rounds
            before_letters = deepcopy(game["_hausdepp_tournament"]["losses"])
            for _ in range(2):
                assert finalize_hausdepp_result(game)["result_persisted"]
            assert game["_hausdepp_tournament"]["losses"] == before_letters
            if game["_hausdepp_tournament"]["completed"]:
                break
            assert max(before_letters.values()) < 8
            # A real persisted interround reload must retain the host and all
            # CPU seats; reconnecting humans supply their fresh socket objects.
            game = load_active_games()["stable-table"]
            for player in game["_players"]:
                player["ws"] = Socket()
            version = game["_hausdepp"]["version"]
            start_next_round(game, "p0", version)
            ids = [player["id"] for player in game["_participants"]]
            assert game["_hausdepp"]["dealer_id"] == ids[(ids.index(dealer_id) + 1) % count]
            assert game["_hausdepp"]["version"] > version
            assert game["_hausdepp"]["phase"] == "peeking"
            assert not game["_resume_required"]
        assert max(game["_hausdepp_tournament"]["losses"].values()) == 8
        with session_scope() as db:
            rows = list(db.scalars(select(CompletedGame).where(CompletedGame.game_type == "hausdepp")))
            assert len(rows) == completed_rounds
            assert len({row.game_id for row in rows}) == completed_rounds
        for account in database:
            account_state = build_hausdepp_account_for_user(account.id)
            assert account_state["scoring"]["round_points"] == completed_rounds * (10 if count == 2 else 2)
            assert account_state["statistics"]["rounds_played"] == completed_rounds


def test_round_duration_uses_each_round_start_instead_of_whole_tournament_age(database):
    game = table(database)
    start = datetime(2026, 10, 16, 12, tzinfo=timezone.utc)
    game["_started_at"] = start.isoformat()
    finish_round(game)
    game["_finished_at"] = (start + timedelta(seconds=60)).isoformat()
    assert finalize_hausdepp_result(game)["result_persisted"]
    start_next_round(game, "p0", game["_hausdepp"]["version"])
    game["_hausdepp_round_started_at"] = (start + timedelta(minutes=3)).isoformat()
    finish_round(game)
    game["_finished_at"] = (start + timedelta(minutes=3, seconds=45)).isoformat()
    assert finalize_hausdepp_result(game)["result_persisted"]
    with session_scope() as db:
        rows = list(db.scalars(select(CompletedGame).order_by(CompletedGame.id)))
        payloads = [json.loads(row.snapshot_json) for row in rows]
    assert [payload["duration_seconds"] for payload in payloads] == [60, 45]
    assert payloads[1]["started_at"] == (start + timedelta(minutes=3)).isoformat()
