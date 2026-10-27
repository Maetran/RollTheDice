"""Private head-to-head records use only validated fixed opposing sides."""
from app.database import session_scope
from app.models import User
from app.watten_account import build_watten_account
from tests import test_watten_runtime as runtime_tests
from tests.test_watten_account_merge import merge
from tests.test_watten_progression_store import game_for, written

server = runtime_tests.server


def test_threshold_reverse_record_rename_and_three_player_exclusion(server):
    own, opponent, third = [runtime_tests.account(name) for name in ("FanOwner", "FanOpponent", "FanThird")]
    two = game_for([own, opponent])
    with session_scope() as db:
        for index in range(10):
            written(db, {**two, "_id": f"duel-{index}"})
        three = game_for([own, opponent, third], count_players=3)
        for index in range(11):
            written(db, {**three, "_id": f"rotating-{index}"})
        computer = game_for([own], cpus=(1,))
        for index in range(11):
            written(db, {**computer, "_id": f"computer-{index}"})
    assert build_watten_account(own[0].user_id)["favorite_opponents"] == []
    with session_scope() as db:
        written(db, {**two, "_id": "duel-10"})
        db.get(User, opponent[0].user_id).username = "RenamedFan"
    own_record, = build_watten_account(own[0].user_id)["favorite_opponents"]
    other_record, = build_watten_account(opponent[0].user_id)["favorite_opponents"]
    assert own_record["name"] == "RenamedFan" and own_record["matches"] == 11
    assert own_record["wins"] == other_record["losses"]
    assert own_record["losses"] == other_record["wins"]
    assert own_record["draws"] == other_record["draws"]
    assert own_record["wins"] + own_record["losses"] == 11
    assert build_watten_account(third[0].user_id)["favorite_opponents"] == []


def test_fixed_teams_exclude_partner_and_deleted_accounts(server):
    owners = [runtime_tests.account(f"TeamFan{i}") for i in range(4)]
    game = game_for(owners, count_players=4)
    with session_scope() as db:
        for index in range(11):
            row, evidence, bindings = written(db, {**game, "_id": f"team-{index}"})
        own_binding = next(item for item in bindings if item.user_id == owners[0][0].user_id)
        own_group = next(score.members for score in evidence.scores if own_binding.player_id in score.members)
        expected = {owners[item.position][0].username for item in bindings if item.player_id not in own_group}
        removed = next(item.user_id for item in bindings if item.player_id not in own_group)
    result = build_watten_account(owners[0][0].user_id)["favorite_opponents"]
    assert {item["name"] for item in result} == expected
    assert all(item["matches"] == 11 for item in result)
    with session_scope() as db:
        db.delete(db.get(User, removed))
    result = build_watten_account(owners[0][0].user_id)["favorite_opponents"]
    assert len(result) == 1 and result[0]["name"] in expected


def test_merge_aggregates_opponents_and_owners_without_double_counting(server):
    own_old, own, opponent_old, opponent = [runtime_tests.account(name) for name in
        ("MergeFanOld", "MergeFanNew", "MergeRivalOld", "MergeRivalNew")]
    pairs = [(own_old, opponent_old), (own, opponent)]
    with session_scope() as db:
        for pair_index, pair in enumerate(pairs):
            game = game_for(list(pair))
            for index in range(6):
                written(db, {**game, "_id": f"merged-{pair_index}-{index}"})
        merge(db, own_old[0].user_id, own[0].user_id, operation="c" * 32)
        merge(db, opponent_old[0].user_id, opponent[0].user_id, operation="d" * 32)
    own_record, = build_watten_account(own[0].user_id)["favorite_opponents"]
    assert own_record["name"] == "MergeRivalNew" and own_record["matches"] == 12
    reciprocal, = build_watten_account(opponent[0].user_id)["favorite_opponents"]
    assert reciprocal["name"] == "MergeFanNew" and reciprocal["matches"] == 12
    assert own_record["wins"] == reciprocal["losses"]


def test_merged_accounts_that_were_on_opposite_teams_are_not_a_head_to_head(server):
    players = [runtime_tests.account(f"SplitFan{i}") for i in range(4)]
    game = game_for(players, count_players=4)
    with session_scope() as db:
        for index in range(11):
            _row, evidence, bindings = written(db, {**game, "_id": f"split-{index}"})
        own = bindings[0]
        own_side = next(score.members for score in evidence.scores if own.player_id in score.members)
        opposing = next(item for item in bindings if item.player_id not in own_side)
        unaffected = next(item for item in bindings if item.player_id not in own_side and item != opposing)
        merge(db, opposing.user_id, own.user_id, operation="e" * 32)
    assert build_watten_account(own.user_id)["favorite_opponents"] == []
    rival_names = {item["name"] for item in build_watten_account(unaffected.user_id)["favorite_opponents"]}
    assert players[0][0].username not in rival_names
