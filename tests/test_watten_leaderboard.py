"""Rank definitions, shared places, co-winners and explicit cohort selection."""

import json
from dataclasses import replace
from types import SimpleNamespace

import pytest

from app import watten_leaderboard as leaderboard
from app.database import session_scope
from app.models import User
from app.watten_engine import SeatBinding, next_deal, start_match
from app.watten_leaderboard import WattenLeaderboardError, build_watten_leaderboard
from app.watten_progression_store import store_draft_match
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_engine import dealt, recipe
from tests.test_watten_evidence import FINISHED, scored_go
from tests.test_watten_progression_store import counts, game_for, written

server = runtime_tests.server


def test_xp_ranks_stored_values_with_shared_places_current_names_and_own_entry_beyond_limit(server):
    first, second, third = [runtime_tests.account(name) for name in ("AlphaHistorical", "BravoHistorical", "CharlieHistorical")]
    with session_scope() as db:
        row, evidence, bindings = written(db, game_for([first, second], game_id="shared"))
        store_draft_match(db, row, evidence, bindings)
        row, evidence, bindings = written(db, game_for([third], game_id="private-third", cpus=(1,)))
        store_draft_match(db, row, evidence, bindings)
        db.get(User, first[0].user_id).username = "ZuluCurrent"
        before = counts(db)
    board = build_watten_leaderboard(first[0].user_id, limit=1)
    assert board["metric"] == "xp" and board["population"] == "credited_matches_and_grants"
    assert board["entries"][0]["display_name"] == "CharlieHistorical"  # 50 XP including CPU goal
    assert board["own_entry"]["display_name"] == "ZuluCurrent" and board["own_entry"]["place"] == 2
    all_entries = build_watten_leaderboard(first[0].user_id)["entries"]
    assert [item["place"] for item in all_entries] == [1, 2, 2]
    assert sum(item["is_self"] for item in all_entries) == 1
    encoded = json.dumps(board)
    assert all(value not in encoded for value in ('"user_id"', '"game_id"', "private-third", "shared", "achievement_id"))
    assert "endurance" in board["definition"]["en"]
    with session_scope() as db:
        assert counts(db) == before


def test_outcome_rankings_use_all_valid_matches_and_explicit_cpu_human_cohorts(server):
    first, second = runtime_tests.account("AllModesA"), runtime_tests.account("AllModesB")
    with session_scope() as db:
        written(db, game_for([first, second], game_id="human-table"))
        written(db, game_for([first], game_id="cpu-table", cpus=(1,)))
    all_matches = build_watten_leaderboard(first[0].user_id, metric="wins")
    assert all_matches["population"] == "all_completed_matches" and all_matches["own_entry"]["matches"] == 2
    human = build_watten_leaderboard(first[0].user_id, metric="wins", players=2, opponents="human")
    cpu = build_watten_leaderboard(first[0].user_id, metric="wins", opponents="cpu")
    assert human["own_entry"]["matches"] == cpu["own_entry"]["matches"] == 1
    assert human["cohort"] == {"players": 2, "opponents": "human"}
    assert build_watten_leaderboard(first[0].user_id, metric="wins", players=3)["entries"] == []
    assert build_watten_leaderboard(first[0].user_id)["entries"] == []  # GET never grants missing XP


def test_real_three_player_co_winners_and_four_player_team_members_each_count_as_winners(server):
    owners = [runtime_tests.account(f"CoWinner{index}") for index in range(4)]
    original = recipe(3, target_points=6)
    bindings = tuple(SeatBinding(player, owners[index][0].user_id) for index, player in enumerate("ABC"))
    state = start_match(replace(original, bindings=bindings), "co-0", dealt(3), first_dealer="A")
    for index, points in enumerate((2, 3, 4)):
        state = scored_go(state, 0, points)
        if index < 2:
            state = next_deal(state, f"co-{index + 1}", dealt(3))
    game = {"_id": "co-winners", "_name": "Private", "_mode": "3", "_finished_at": FINISHED.isoformat(),
            "_watten": SimpleNamespace(engine=state, names=tuple((player, owners[index][0].username) for index, player in enumerate("ABC")))}
    with session_scope() as db:
        written(db, game)
        _row, four, _bindings = written(db, game_for(owners, game_id="four-team", count_players=4))
    three = build_watten_leaderboard(owners[0][0].user_id, metric="wins", players=3)
    assert [(item["display_name"], item["wins"]) for item in three["entries"]] == [("CoWinner1", 1), ("CoWinner2", 1), ("CoWinner0", 0)]
    four_board = build_watten_leaderboard(owners[0][0].user_id, metric="wins", players=4)
    assert sum(item["wins"] for item in four_board["entries"]) == len(four.winners[0]) == 2


def test_win_rate_exposes_minimum_and_below_threshold_own_entry(server):
    first, second = runtime_tests.account("RateA"), runtime_tests.account("RateB")
    game = game_for([first, second])
    with session_scope() as db:
        for index in range(9):
            written(db, {**game, "_id": f"rate-{index}"})
    below = build_watten_leaderboard(first[0].user_id, metric="win_rate")
    assert below["minimum_matches"] == 10 and below["entries"] == []
    assert below["own_entry"]["matches"] == 9 and not below["own_entry"]["eligible"]
    assert below["own_entry"]["place"] is None
    with session_scope() as db:
        written(db, {**game, "_id": "rate-10"})
        db.get(User, second[0].user_id).is_active = False
    board = build_watten_leaderboard(first[0].user_id, metric="win_rate")
    assert len(board["entries"]) == 1 and board["own_entry"]["eligible"]
    assert board["own_entry"]["value"] in {0.0, 100.0}


def test_equal_exact_ratios_share_places_but_rounded_display_does_not_define_a_tie(server, monkeypatch):
    owners = [runtime_tests.account(name) for name in ("ExactA", "ExactB", "ExactC")]
    totals = {owners[0][0].user_id: {"wins": 1, "matches": 10},
              owners[1][0].user_id: {"wins": 2, "matches": 20},
              owners[2][0].user_id: {"wins": 1000, "matches": 10001}}
    # Arithmetic isolation only; real source/role tests above exercise the
    # independent accepted-result reader without thousands of fixture writes.
    monkeypatch.setattr(leaderboard, "_outcomes", lambda *_args, **_kwargs: totals)
    board = build_watten_leaderboard(owners[0][0].user_id, metric="win_rate")
    assert [item["place"] for item in board["entries"]] == [1, 1, 3]
    assert [item["win_rate"] for item in board["entries"]] == [10.0, 10.0, 10.0]
    assert board["entries"][2]["value"] < board["entries"][0]["value"]
    assert board["entries"][2]["exact_ratio"] == {"wins": 1000, "matches": 10001}


@pytest.mark.parametrize("options", ({"players": 2}, {"opponents": "human"}, {"opponents": "cpu"}))
def test_global_achievement_xp_cannot_be_mislabelled_as_a_filtered_cohort(options):
    with pytest.raises(WattenLeaderboardError, match="xp_filter_unsupported"):
        build_watten_leaderboard(1, **options)


@pytest.mark.parametrize("options", ({"metric": "elo"}, {"players": True}, {"players": 5}, {"opponents": "unknown"}, {"limit": True}))
def test_unknown_rank_parameters_are_rejected(options):
    with pytest.raises(WattenLeaderboardError):
        build_watten_leaderboard(1, **options)
