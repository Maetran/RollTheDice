"""Rare claim persistence is atomic with the live Hausdepp checkpoint."""
import json
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.active_games import save_active_game
from app.database import session_scope
from app.game_state import games
from app.hausdepp_engine import apply_action
from app.hausdepp_table_surprises import _persist_new_policy_claim
from app.models import ActiveGame, RareSurpriseCounter, RareSurpriseOffer
from tests import test_hausdepp_feature_policy as hd

server = hd.server


def test_start_and_claim_rollback_leave_no_candidate_or_reset(server):
    response = hd.create(server, 1, four_of_a_kind_as_ten=False)
    game = games[response.json()["game_id"]]
    player = hd.join(server, game, 1)
    with patch("app.rare_surprise_probability.secrets.randbelow", return_value=0):
        hd.start(server, game, player)
    account = player["user_id"]
    key = f'{game["_id"]}:1'
    with session_scope() as db:
        assert db.get(RareSurpriseOffer, ("hausdepp", key)).effect == "star"
        assert db.get(RareSurpriseCounter, ("hausdepp", account)).games == 1
    while game["_hausdepp"]["phase"] == "peeking":
        state = game["_hausdepp"]
        game["_hausdepp"] = apply_action(state, state["current_player_id"], "peek", version=state["version"])
    save_active_game(game)
    with patch("sqlalchemy.orm.Session.commit", side_effect=RuntimeError("commit failure")):
        with pytest.raises(RuntimeError, match="commit failure"):
            _persist_new_policy_claim(game, player["id"], "star", 1)
    assert "_hausdepp_table_surprise_claim" not in game
    with session_scope() as db:
        assert db.get(RareSurpriseCounter, ("hausdepp", account)).games == 1
        assert db.get(RareSurpriseOffer, ("hausdepp", key)).activated is False
        state = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])))
        assert "_hausdepp_table_surprise_claim" not in state
    assert _persist_new_policy_claim(game, player["id"], "star", 1) is True
    assert _persist_new_policy_claim(game, player["id"], "star", 1) is False
    with session_scope() as db:
        assert db.get(RareSurpriseCounter, ("hausdepp", account)).games == 0
        assert db.get(RareSurpriseOffer, ("hausdepp", key)).activated is True
        state = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])))
        assert state["_hausdepp_table_surprise_claim"] == {"round_number": 1, "activated": True}


def started_with_star(server):
    response = hd.create(server, 1, four_of_a_kind_as_ten=False)
    game = games[response.json()["game_id"]]
    player = hd.join(server, game, 1)
    with patch("app.rare_surprise_probability.secrets.randbelow", return_value=0):
        hd.start(server, game, player)
    while game["_hausdepp"]["phase"] == "peeking":
        state = game["_hausdepp"]
        game["_hausdepp"] = apply_action(state, state["current_player_id"], "peek", version=state["version"])
    save_active_game(game)
    player["ws"].messages.clear()
    return game, player


def test_offer_database_failure_hides_effect_without_breaking_snapshot(server):
    from sqlalchemy.exc import OperationalError

    from app.game_snapshot import snapshot
    from app.hausdepp_table_surprises import table_surprise_offer

    game, player = started_with_star(server)
    failure = OperationalError("SELECT", {}, Exception("unavailable"))
    with patch("app.rare_surprise_probability.read_offer", side_effect=failure), \
            patch("app.hausdepp_table_surprises._eligible_effect", side_effect=AssertionError("legacy fallback")):
        assert table_surprise_offer(game, player["id"])["effect"] is None
        assert snapshot(game, player["id"])["_hausdepp_table_surprises"]["effect"] is None
    assert table_surprise_offer(game, player["id"])["effect"] == "star"


def test_claim_database_failure_answers_and_rolls_back_then_can_retry(server):
    import asyncio

    from sqlalchemy.exc import OperationalError

    from app.hausdepp_table_surprises import handle_table_surprise

    game, player = started_with_star(server)
    account, key = player["user_id"], f'{game["_id"]}:1'
    data = {"effect": "star", "round_number": 1}
    failure = OperationalError("UPDATE", {}, Exception("unavailable"))
    with patch("app.rare_surprise_probability.activate", side_effect=failure):
        asyncio.run(handle_table_surprise(hd.session(server, game, player), data))
    assert player["ws"].messages[-1]["error_code"] == "hausdepp_table_surprise_unavailable"
    assert "_hausdepp_table_surprise_claim" not in game
    with session_scope() as db:
        assert db.get(RareSurpriseCounter, ("hausdepp", account)).games == 1
        assert db.get(RareSurpriseOffer, ("hausdepp", key)).activated is False
    asyncio.run(handle_table_surprise(hd.session(server, game, player), data))
    assert player["ws"].messages[-1]["hausdepp_table_surprise"]["effect"] == "star"


def test_missing_new_offer_does_not_use_legacy_lottery(server):
    from app.hausdepp_table_surprises import table_surprise_offer

    game, player = started_with_star(server)
    key = f'{game["_id"]}:1'
    with session_scope() as db:
        db.delete(db.get(RareSurpriseOffer, ("hausdepp", key)))
    with patch("app.hausdepp_table_surprises._eligible_effect", side_effect=AssertionError("legacy fallback")):
        assert table_surprise_offer(game, player["id"])["effect"] is None
        with patch("app.database.database_schema_ready", return_value=False):
            assert table_surprise_offer(game, player["id"])["effect"] is None
