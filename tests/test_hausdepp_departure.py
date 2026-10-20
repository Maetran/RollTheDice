"""A departure changes one seat, conserves cards and survives transport races."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.game_state import _offline_players, multiplayer_pause_reason
from app.game_ws_session import GameSocketSession, disconnect_session, handle_session_action
from app.hausdepp_cpu_runner import cpu_action_is_due
from app.hausdepp_departure import _propose_departure, departure_permissions
from app.hausdepp_engine import HausdeppRuleError, apply_action, make_deck, new_round, project_state, withdraw_player
from app.hausdepp_state import new_hausdepp_game
from app.hausdepp_tournament import new_tournament, record_finished_round, start_next_round, validate_tournament
from tests.test_hausdepp_engine import scenario
from tests.test_hausdepp_integration import RecordingSocket


def table(*, count=3, tournament=False, accounts=False):
    game = new_hausdepp_game("departure-table", "Ausstieg", str(count), register=False)
    game["_participants"] = [{"id": f"p{index}", "name": f"Person{index}", "type": "human", "is_cpu": False,
                               "user_id": index + 1 if accounts else None} for index in range(count)]
    game["_players"] = [{**person, "ws": RecordingSocket(), "resume_token": f"token-{person['id']}"}
                         for person in game["_participants"]]
    game["_hausdepp"] = scenario([[f"{suit}-6"] for suit in ("hearts", "bells", "leaves", "acorns")[:count]],
                                  discard=["hearts-7"], deck=["bells-8", "bells-9", "bells-U"])
    game.update(_started=True, _hausdepp_host_user_id=1 if accounts else None)
    if tournament:
        game["_hausdepp_tournament"] = new_tournament(game["_id"], game["_participants"])
    return game


def conserved(state):
    cards = [*state["deck"], *state["discard"], *state["burned"],
             *(card for player in state["players"] for card in player["hand"])]
    assert len(cards) == len(set(cards)) == 36
    assert set(cards) == set(make_deck())


def test_current_departure_burns_private_hand_and_passes_turn_without_an_earned_finish():
    state = table()["_hausdepp"]
    before = deepcopy(state)
    after = withdraw_player(state, "p0", version=state["version"])
    assert state == before
    assert after["current_player_id"] == "p1"
    assert after["withdrawn_ids"] == ["p0"]
    assert after["finished_order"] == []
    assert after["discard"] == state["discard"]
    assert "hearts-6" in after["burned"]
    assert not after["players"][0]["finished"]
    assert project_state(after, "p0")["available_actions"] == []
    assert "hearts-6" not in str(project_state(after, "p1"))
    assert project_state(after, "p1")["players"][0]["outcome"] == "withdrawn"
    conserved(after)
    with pytest.raises(HausdeppRuleError, match="hausdepp_invalid_player"):
        apply_action(after, "p0", "gamble", version=after["version"])


def test_departure_releases_only_own_refill_debt_and_keeps_foreign_afterthrow():
    state = table()["_hausdepp"]
    state["pending_refills"] = {
        "p2": {"player_id": "p2", "remaining": 2, "continuation": "advance", "rank": "6"},
        "p1": {"player_id": "p1", "remaining": 2, "continuation": "advance", "rank": "6"},
    }
    state["pending_refill"] = state["pending_refills"]["p2"]
    state["afterthrow"] = {"player_id": "p1", "rank": "6"}
    after = withdraw_player(state, "p2", version=state["version"])
    assert list(after["pending_refills"]) == ["p1"]
    assert after["pending_refill"]["player_id"] == "p1"
    assert after["afterthrow"] == state["afterthrow"]
    assert after["current_player_id"] == "p0"
    conserved(after)


def test_two_player_departure_finishes_without_hausdepp_or_fake_empty_hand():
    state = table(count=2)["_hausdepp"]
    after = withdraw_player(state, "p0", version=state["version"])
    assert after["phase"] == "finished"
    assert after["loser_id"] is None
    assert after["remaining_player_id"] == "p1"
    assert after["round_end_reason"] == "insufficient_players"
    assert after["finished_order"] == []
    assert not after["players"][1]["finished"]
    assert project_state(after, "p1")["players"][1]["outcome"] == "remaining"
    assert project_state(after, "p1")["available_actions"] == []
    conserved(after)


def test_departure_does_not_turn_finished_hand_into_a_forfeit():
    state = scenario([[], ["bells-6"], ["leaves-6"]], discard=["hearts-7"], deck=[])
    after = withdraw_player(state, "p0", version=state["version"])
    assert after["withdrawn_ids"] == []
    assert after["finished_order"] == ["p0"]
    assert after["phase"] == "playing"
    conserved(after)


def test_peeker_departure_reassigns_private_inspection_and_deals_only_to_remaining_seats():
    state = new_round(["p0", "p1", "p2"], dealer_index=0, deck=make_deck())
    state["peek_information"]["cards"] = [state["deck"][-1]]
    after = withdraw_player(state, "p2", version=state["version"])
    assert after["peek_information"]["player_id"] == "p1"
    assert after["peek_information"]["cards"] == []
    while after["phase"] == "peeking":
        after = apply_action(after, after["current_player_id"], "peek", version=after["version"])
    assert after["players"][2]["hand"] == []
    assert len(after["players"][0]["hand"]) >= 3
    assert len(after["players"][1]["hand"]) == 3
    conserved(after)


def test_stale_departure_does_not_mutate_the_table():
    state = table()["_hausdepp"]
    before = deepcopy(state)
    for bad in (None, True, state["version"] - 1, state["version"] + 1):
        with pytest.raises(HausdeppRuleError, match="hausdepp_stale_version"):
            withdraw_player(state, "p0", version=bad)
        assert state == before


def test_tournament_continues_without_reintroducing_the_departed_seat_or_erasing_losses():
    game = table(tournament=True, accounts=True)
    proposed, forfeited = _propose_departure(game, "p2", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert forfeited
    assert len(game["_players"]) == 3
    assert proposed["_hausdepp_tournament"]["departed_ids"] == ["p2"]
    assert len(proposed["_participants"]) == 3
    state = proposed["_hausdepp"]
    # Complete the two remaining active hands using the actual engine.
    state.update(deck=[], discard=[], pending_refills={}, pending_refill=None, afterthrow=None, current_player_id="p0")
    state["players"][0]["hand"] = ["hearts-6"]
    state["players"][1]["hand"] = ["bells-6"]
    state["burned"] = [card for card in make_deck() if card not in {"hearts-6", "bells-6"}]
    state = apply_action(state, "p0", "play", cards=["hearts-6"], version=state["version"])
    proposed.update(_hausdepp=state, _finished=True, _completion_persisted=True)
    record_finished_round(proposed)
    assert proposed["_hausdepp_tournament"]["losses"] == {"p0": 0, "p1": 1, "p2": 0}
    start_next_round(proposed, "p0", state["version"])
    assert {player["id"] for player in proposed["_hausdepp"]["players"]} == {"p0", "p1"}
    assert proposed["_hausdepp_tournament"]["round_number"] == 2
    assert validate_tournament(proposed["_hausdepp_tournament"], {"p0", "p1", "p2"})


def test_finished_hand_departure_can_end_current_round_without_preventing_another_turnier_round():
    game = table(tournament=True, accounts=True)
    game["_hausdepp"] = scenario([[], ["bells-6"], ["leaves-6"]], deck=[])
    proposed, forfeited = _propose_departure(game, "p2", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert forfeited
    assert proposed["_finished"]
    assert proposed["_hausdepp_tournament"]["round_losers"] == [None]
    assert not proposed["_hausdepp_tournament"]["completed"]
    proposed["_completion_persisted"] = True
    start_next_round(proposed, "p0", proposed["_hausdepp"]["version"])
    assert {player["id"] for player in proposed["_hausdepp"]["players"]} == {"p0", "p1"}


def test_finished_regular_participant_keeps_rewards_when_departing_and_transfers_host():
    game = table(tournament=True, accounts=True)
    game["_hausdepp"] = scenario([[], ["bells-6"], ["leaves-6"]], deck=[])
    assert departure_permissions(game, "p0") == {"can_leave": True, "forfeits_round": False,
                                               "ends_tournament_participation": True}
    proposed, forfeited = _propose_departure(game, "p0", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert not forfeited
    assert proposed["_hausdepp_host_user_id"] == 2
    assert proposed["_hausdepp"]["finished_order"] == ["p0"]
    assert proposed["_hausdepp"]["withdrawn_ids"] == []
    assert proposed["_hausdepp_departures"]["p0"]["forfeited_round"] is False


def test_cpu_remainder_is_due_without_a_human_socket_after_deliberate_departure():
    game = table(tournament=True, accounts=True)
    game["_hausdepp"] = scenario([[], ["bells-6"], ["leaves-6"]], deck=[])
    for player in game["_participants"][1:]:
        player.update(is_cpu=True, type="cpu", user_id=None)
    for player in game["_hausdepp"]["players"][1:]:
        player["is_cpu"] = True
    game["_players"] = game["_players"][:1]
    game["_hausdepp"]["current_player_id"] = "p1"
    proposed, forfeited = _propose_departure(game, "p0", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert not forfeited
    assert proposed["_players"] == []
    assert not multiplayer_pause_reason(proposed)
    assert cpu_action_is_due(proposed)
    state = proposed["_hausdepp"]
    state["current_player_id"] = "p1"
    state = apply_action(state, "p1", "play", cards=["bells-6"], version=state["version"])
    proposed.update(_hausdepp=state, _finished=True)
    record_finished_round(proposed)
    tournament = proposed["_hausdepp_tournament"]
    assert tournament["completed"]
    assert tournament["end_reason"] == "no_human_players"
    assert tournament["tages_hausdepp_id"] is None
    assert validate_tournament(tournament, {"p0", "p1", "p2"}, finished_round=True)


def test_waiting_spectators_and_terminal_quick_round_have_no_active_exit():
    game = table()
    assert not departure_permissions(game, None)["can_leave"]
    game["_started"] = False
    assert not departure_permissions(game, "p0")["can_leave"]
    game.update(_started=True, _finished=True)
    assert not departure_permissions(game, "p0")["can_leave"]


def test_guest_exit_commits_before_acknowledgement_and_disconnect_cannot_pause_the_others():
    async def run():
        game = table()
        socket = game["_players"][0]["ws"]
        session = GameSocketSession(socket, game, None, player_id="p0")
        observed = []

        def persist(proposed, **kwargs):
            assert len(game["_players"]) == 3
            assert socket.messages == []
            observed.append((proposed, kwargs))
            return {"departure_persisted": True}

        with patch("app.hausdepp_departure_store.persist_hausdepp_departure", side_effect=persist), \
                patch("app.hausdepp_gameplay.publish_hausdepp_transition", new_callable=AsyncMock), \
                patch("app.hausdepp_voice.voice_socket_disconnected", new_callable=AsyncMock) as revoke, \
                patch("app.hausdepp_voice.refresh_voice_game", new_callable=AsyncMock):
            assert await handle_session_action(session, "hausdepp_leave_game", {"version": game["_hausdepp"]["version"]})
            assert observed[0][1]["user_id"] is None
            assert observed[0][1]["forfeited_round"] is True
            assert socket.messages == [{"left_hausdepp_game": True, "table_continues": True, "redirect": "/hausdepp"}]
            assert socket.closed
            assert session.player_id is None
            revoke.assert_awaited_once_with(session, revoke=True)
            await disconnect_session(session)
            assert _offline_players(game) == []
            assert not multiplayer_pause_reason(game)

    asyncio.run(run())


@pytest.mark.parametrize("reason", ["stale_socket", "revoked_account", "spectator", "stale_version", "storage_failure"])
def test_security_and_storage_rejections_preserve_the_whole_live_state(reason):
    async def run():
        game = table(accounts=True)
        socket = game["_players"][0]["ws"] if reason != "stale_socket" else RecordingSocket()
        identity = SimpleNamespace(user_id=1)
        session = GameSocketSession(socket, game, identity, player_id="p0", is_spectator=reason == "spectator")
        before = deepcopy(game["_hausdepp"])
        live_players = list(game["_players"])
        with patch("app.auth.resolve_session", return_value=None if reason == "revoked_account" else identity), \
                patch("app.hausdepp_departure_store.persist_hausdepp_departure", side_effect=RuntimeError("DB down")) as store:
            version = game["_hausdepp"]["version"] - (reason == "stale_version")
            assert not await handle_session_action(session, "hausdepp_leave_game", {"version": version})
            assert game["_hausdepp"] == before
            assert game["_players"] == live_players
            assert "_hausdepp_departures" not in game
            assert session.player_id == "p0"
            assert not socket.closed
            if reason != "storage_failure":
                store.assert_not_called()

    asyncio.run(run())


def test_finished_offline_person_does_not_block_computers_after_last_active_human_leaves():
    game = table(count=4, tournament=True, accounts=True)
    game["_hausdepp"] = scenario([[], ["bells-6"], ["leaves-6"], ["acorns-6"]], deck=[], current="p1")
    for player in game["_participants"][2:]:
        player.update(is_cpu=True, type="cpu", user_id=None)
    for player in game["_hausdepp"]["players"][2:]:
        player["is_cpu"] = True
    game["_players"] = game["_players"][:2]
    game["_players"][0]["ws"] = None
    proposed, forfeited = _propose_departure(game, "p1", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert forfeited
    assert [person["id"] for person in proposed["_players"]] == ["p0"]
    assert _offline_players(proposed) == []
    assert not multiplayer_pause_reason(proposed)
    assert cpu_action_is_due(proposed)
    assert not proposed["_hausdepp_tournament"]["completed"]


def test_host_transfer_prefers_an_account_over_a_connected_guest():
    game = table(tournament=True, accounts=True)
    game["_players"][1]["user_id"] = None
    game["_participants"][1]["user_id"] = None
    proposed, _ = _propose_departure(game, "p0", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert proposed["_hausdepp_host_user_id"] == 3
    assert proposed["_hausdepp_host_player_id"] == "p2"


def test_guest_host_transfer_grants_authority_to_one_exact_seat():
    from app.hausdepp_state import hausdepp_is_host

    game = table(tournament=True, accounts=True)
    for person in [*game["_players"][1:], *game["_participants"][1:]]:
        person["user_id"] = None
    proposed, _ = _propose_departure(game, "p0", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    assert proposed["_hausdepp_host_user_id"] is None
    assert hausdepp_is_host(proposed, proposed["_participants"][1])
    assert not hausdepp_is_host(proposed, proposed["_participants"][2])


def test_dealt_dealer_departure_rotates_the_next_round_exactly_once():
    game = table(tournament=True, accounts=True)
    game["_hausdepp"]["dealer_id"] = "p0"
    proposed, _ = _propose_departure(game, "p0", game["_hausdepp"]["version"], datetime.now(timezone.utc))
    state = proposed["_hausdepp"]
    assert state["dealer_id"] == "p0"
    state.update(deck=[], discard=[], pending_refills={}, pending_refill=None, afterthrow=None, current_player_id="p1")
    state["players"][1]["hand"], state["players"][2]["hand"] = ["bells-6"], ["leaves-6"]
    state["burned"] = [card for card in make_deck() if card not in {"bells-6", "leaves-6"}]
    state = apply_action(state, "p1", "play", cards=["bells-6"], version=state["version"])
    assert state["phase"] == "finished"
    proposed.update(_hausdepp=state, _finished=True, _completion_persisted=True)
    record_finished_round(proposed)
    start_next_round(proposed, "p1", state["version"])
    assert proposed["_hausdepp"]["dealer_id"] == "p1"
    assert {person["id"] for person in proposed["_hausdepp"]["players"]} == {"p1", "p2"}


def test_undealt_dealer_departure_still_assigns_the_actual_replacement_dealer():
    state = new_round(["p0", "p1", "p2"], dealer_index=0, deck=make_deck())
    state = withdraw_player(state, "p0", version=state["version"])
    assert state["dealer_id"] == "p1"
    while state["phase"] == "peeking":
        state = apply_action(state, state["current_player_id"], "peek", version=state["version"])
    assert state["dealer_id"] == "p1"
    assert state["deal"]["sequence"][0]["player_id"] == "p2"
    assert state["players"][0]["hand"] == []
    conserved(state)
