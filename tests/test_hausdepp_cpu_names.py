"""Computer names are random per table, unique, and stable during a tournament."""

from copy import deepcopy
from unittest.mock import patch

from app.active_games import serializable_game_state
from app.hausdepp_state import HAUSDEPP_CPU_NAMES, configure_hausdepp_game, join_hausdepp_player, start_hausdepp_game


def configured_table():
    game = {"_id": "named-table", "_game_type": "hausdepp", "_expected": 6, "_players": [], "_started": False}
    configure_hausdepp_game(game, host_user_id=1, cpu_count=5, tournament=True)
    return game


def test_pool_has_exactly_fifty_distinct_names_including_the_requested_examples():
    assert len(HAUSDEPP_CPU_NAMES) == 50
    assert len({name.casefold() for name in HAUSDEPP_CPU_NAMES}) == 50
    assert {"Peppi", "Seppl", "Schorsch", "Resi", "Vroni", "Traudl"} <= set(HAUSDEPP_CPU_NAMES)


def test_maximum_computer_seats_are_unique_and_have_no_account_identity():
    for _ in range(20):
        computers = configured_table()["_participants"]
        assert len({player["name"].casefold() for player in computers}) == 5
        assert all(player["name"] in HAUSDEPP_CPU_NAMES and player["user_id"] is None for player in computers)
        assert [player["id"] for player in computers] == [f"cpu-{number}" for number in range(1, 6)]


def test_human_name_collision_is_resolved_before_the_round_and_remains_durable():
    with patch("app.hausdepp_state._CPU_RANDOM.sample", return_value=list(HAUSDEPP_CPU_NAMES[:5])):
        game = configured_table()
    join_hausdepp_player(game, {"id": "human", "name": "pEPPI", "user_id": 1, "ws": None})
    start_hausdepp_game(game)
    names = [player["name"] for player in game["_participants"]]
    assert len({name.casefold() for name in names}) == 6
    assert names[0] == "pEPPI"
    assert "Peppi" not in names[1:]
    assert [player["name"] for player in game["_hausdepp"]["players"]] == names
    restored = deepcopy(serializable_game_state(game))
    assert [player["name"] for player in restored["_participants"]] == names
    assert set(restored["_hausdepp_tournament"]["losses"]) == {player["id"] for player in game["_participants"]}
