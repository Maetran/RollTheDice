"""Optional clearing rule: choices persist; live authority never comes from a recipe."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from starlette.testclient import TestClient

from app import main
from app.active_games import save_active_game
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_lifecycle import AdmissionError, admit_player, clone_candidate, commit_admission
from app.game_snapshot import snapshot
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.hausdepp_cpu_runner import stop_cpu_runners
from app.hausdepp_features import FEATURE_KEY
from app.hausdepp_gameplay import handle_hausdepp_gameplay_action
from app.hausdepp_rematch import RematchError, create_rematch, retain_rematch_source
from app.hausdepp_state import start_hausdepp_game
from app.hausdepp_waiting import leave_waiting_session
from app.models import ActiveGame, FeatureFlag, HausdeppRematch, HausdeppRematchSource, User
from app.security import utcnow
from tests.test_hausdepp_integration import RecordingSocket
from tests.test_user_accounts import request_for


@pytest.fixture
def server(tmp_path):
    with patch.dict("os.environ", {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/hausdepp-features.sqlite3",
        "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
        "ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": "60",
        "ROLLTHEDICE_GAME_CREATE_BURST_MAX": "100",
    }), patch.dict(games, clear=True):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        accounts = [create_user(name, "secure-password-123", role=role, must_change_password=False)
                    for name, role in (("RuleStaff", "admin"), ("RulePlayer", "user"), ("RuleOther", "user"))]
        identities = [login(request_for(), person.username, "secure-password-123") for person in accounts]
        client = TestClient(main.app)
        yield SimpleNamespace(accounts=accounts, identities=identities, client=client)
        client.close()
        asyncio.run(stop_cpu_runners())
    configure_database(main.DATA_DIR)


def headers(server, index=0):
    identity, token = server.identities[index]
    return {"cookie": f"rollthedice_session={token}", "x-csrf-token": identity.csrf_token}


def create(server, index=0, **extra):
    payload = {"name": "Optional four", "game_type": "hausdepp", "mode": "2", "cpu_count": 1,
               "play_mode": "cpu", "manual_start": True, "four_of_a_kind_as_ten": True, **extra}
    return server.client.post("/api/games", json=payload, headers=headers(server, index))


def policy(status):
    with session_scope() as db:
        row = db.get(FeatureFlag, FEATURE_KEY)
        if row:
            row.status = status
        else:
            db.add(FeatureFlag(key=FEATURE_KEY, status=status, beta=False, version=1, updated_at=utcnow()))


def join(server, game, index=0):
    account = server.accounts[index]
    player = {"id": f"rule-human-{index}", "name": account.username, "user_id": account.id,
              "ws": RecordingSocket(), "resume_token": f"rule-resume-{index}"}
    admit_player(game, player)
    return player


def session(server, game, player):
    index = next(index for index, person in enumerate(server.accounts) if person.id == player["user_id"])
    return GameSocketSession(player["ws"], game, server.identities[index][0], player_id=player["id"])


def start(server, game, player):
    asyncio.run(handle_hausdepp_gameplay_action(session(server, game, player), "hausdepp_start_game", {}))
    return player["ws"].messages[-1]


def test_default_and_strict_game_scoped_option(server):
    assert main.CreateReq(name="Old", mode="2", game_type="hausdepp").four_of_a_kind_as_ten is False
    for value in (1, "true", None):
        with pytest.raises(ValidationError):
            main.CreateReq(name="Bad", mode="2", game_type="hausdepp", four_of_a_kind_as_ten=value)
    for game in ("zdwa", "zilch"):
        with pytest.raises(ValidationError):
            main.CreateReq(name="Other", mode="2", game_type=game, four_of_a_kind_as_ten=True)
    response = create(server, 1, four_of_a_kind_as_ten=False)
    assert response.status_code == 200
    game = games[response.json()["game_id"]]
    player = join(server, game, 1)
    start(server, game, player)
    assert game["_hausdepp"]["four_of_a_kind_as_ten"] is False


def test_internal_creation_denies_regular_and_off_denies_staff_without_partial_room(server):
    before = set(games)
    response = create(server, 1)
    assert response.status_code == 403
    assert response.json()["detail"] == "hausdepp_feature_staff_required"
    assert set(games) == before
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(ActiveGame)) == 0
    policy("off")
    response = create(server)
    assert response.status_code == 403
    assert response.json()["detail"] == "hausdepp_feature_disabled"
    assert set(games) == before


@pytest.mark.parametrize("change", ["off", "demote", "inactive"])
def test_manual_start_rechecks_authority_and_rolls_back_waiting_state(server, change):
    response = create(server)
    assert response.status_code == 200
    game = games[response.json()["game_id"]]
    player = join(server, game)
    with session_scope() as db:
        before = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    if change == "off":
        policy("off")
    else:
        with session_scope() as db:
            account = db.get(User, server.accounts[0].id)
            if change == "demote":
                account.role = "user"
            else:
                account.is_active = False
    message = start(server, game, player)
    assert message["error_code"] == {"off": "hausdepp_feature_disabled", "demote": "hausdepp_feature_staff_required",
                                      "inactive": "hausdepp_feature_creator_inactive"}[change]
    assert game["_started"] is False and game["_hausdepp"] is None
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])) == before


def test_automatic_start_rechecks_flag_and_does_not_install_rejected_join(server):
    response = create(server, manual_start=False)
    game = games[response.json()["game_id"]]
    policy("off")
    with pytest.raises(AdmissionError, match="hausdepp_feature_disabled"):
        join(server, game)
    assert game["_players"] == [] and game["_started"] is False
    assert game["_hausdepp"] is None


def test_internal_creator_must_still_be_seated_after_host_transfer(server):
    response = create(server, mode="3", waiting_mode="open", cpu_count=1)
    game = games[response.json()["game_id"]]
    creator, friend = join(server, game), join(server, game, 1)
    asyncio.run(leave_waiting_session(session(server, game, creator)))
    assert game["_hausdepp_host_user_id"] == server.accounts[1].id
    assert start(server, game, friend)["error_code"] == "hausdepp_feature_creator_not_seated"
    assert game["_started"] is False


def test_public_creation_allows_regular_creator_and_private_authority_is_not_projected(server):
    policy("public")
    response = create(server, 1)
    assert response.status_code == 200
    game = games[response.json()["game_id"]]
    player = join(server, game, 1)
    board = snapshot(game, player["id"])
    assert board["_hausdepp_four_of_a_kind_as_ten"] is True
    assert "_hausdepp_feature_creator_user_id" not in board
    start(server, game, player)
    assert game["_hausdepp"]["four_of_a_kind_as_ten"] is True


def test_started_rule_stays_frozen_after_off_and_demotion_but_new_rematch_rechecks(server):
    response = create(server)
    game = games[response.json()["game_id"]]
    player = join(server, game)
    start(server, game, player)
    assert game["_hausdepp"]["four_of_a_kind_as_ten"] is True
    policy("off")
    with session_scope() as db:
        db.get(User, player["user_id"]).role = "user"
    game["_hausdepp"]["version"] += 1
    save_active_game(game)
    with session_scope() as db:
        stored = json.loads(db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"])))
    assert stored["_hausdepp"]["four_of_a_kind_as_ten"] is True
    game["_finished"] = True
    game["_hausdepp"]["phase"] = "finished"
    assert retain_rematch_source(game)
    with session_scope() as db:
        recipe = json.loads(db.get(HausdeppRematchSource, game["_id"]).settings_json)
        assert recipe["_hausdepp_four_of_a_kind_as_ten"] is True
    with pytest.raises(RematchError, match="hausdepp_feature_disabled"):
        create_rematch(game["_id"], player["user_id"])
    with session_scope() as db:
        assert db.scalar(select(func.count()).select_from(HausdeppRematch)) == 0


def test_saved_true_favourite_preserves_choice_without_granting_activation(server):
    preset = {"waiting_mode": "fixed", "players": 2, "cpu_count": 1, "four_of_a_kind_as_ten": True}
    saved = server.client.put("/api/hausdepp/favourite", json=preset, headers=headers(server, 1))
    assert saved.status_code == 200 and saved.json()["favourite"]["four_of_a_kind_as_ten"] is True
    assert create(server, 1).status_code == 403
    legacy = {key: value for key, value in preset.items() if key != "four_of_a_kind_as_ten"}
    saved = server.client.put("/api/hausdepp/favourite", json=legacy, headers=headers(server, 1))
    assert saved.json()["favourite"]["four_of_a_kind_as_ten"] is False


def test_direct_durable_start_is_also_checked_and_rule_cannot_change_after_start(server):
    response = create(server)
    game = games[response.json()["game_id"]]
    join(server, game)
    policy("off")
    candidate = clone_candidate(game)
    start_hausdepp_game(candidate, manual=True)
    with pytest.raises(AdmissionError, match="hausdepp_feature_disabled"):
        commit_admission(game, candidate, [])
    assert game["_hausdepp"] is None
    policy("internal")
    start(server, game, game["_players"][0])
    candidate = clone_candidate(game)
    candidate["_hausdepp_four_of_a_kind_as_ten"] = False
    with pytest.raises(AdmissionError, match="hausdepp_rule_frozen"):
        commit_admission(game, candidate, [])
    assert game["_hausdepp_four_of_a_kind_as_ten"] is True


def test_policy_change_after_autostart_candidate_is_built_still_blocks_commit(server):
    response = create(server, manual_start=False)
    game = games[response.json()["game_id"]]
    with patch("app.game_lifecycle._before_admission_commit", side_effect=lambda _game: policy("off")):
        with pytest.raises(AdmissionError, match="hausdepp_feature_disabled"):
            join(server, game)
    assert game["_hausdepp"] is None and game["_players"] == []


def test_authorized_fresh_rematch_retains_selected_rule_in_recipe_and_new_engine(server):
    response = create(server)
    source = games[response.json()["game_id"]]
    creator = join(server, source)
    start(server, source, creator)
    source["_finished"] = True
    source["_hausdepp"]["phase"] = "finished"
    assert retain_rematch_source(source)
    # Recreate from the retained password-free recipe, not the old live board.
    games.pop(source["_id"])
    result = create_rematch(source["_id"], creator["user_id"])
    target = games[result["game_id"]]
    assert target["_hausdepp_four_of_a_kind_as_ten"] is True
    assert target["_hausdepp_feature_creator_user_id"] == creator["user_id"]
    joined = join(server, target)
    assert joined["user_id"] == creator["user_id"]
    assert target["_hausdepp"]["four_of_a_kind_as_ten"] is True
