"""Real local HTTP/WS, transaction/restart and recipient privacy boundaries."""

import asyncio
import json
from contextlib import ExitStack, asynccontextmanager, contextmanager
from copy import deepcopy
from dataclasses import replace
from datetime import timedelta
from itertools import count
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import Response
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.active_games import load_active_games, serializable_game_state
from app.auth import create_user, login, logout, set_session_cookie
from app.database import configure_database, session_scope, upgrade_database
from app.game_registry import adapter_for_game_type
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.models import ActiveGame, CompletedGame, DeletedGame, GameParticipant, User, UserAchievement
from app.security import utcnow
from app.watten_bidding import DealResult, ScoreAccount, ScoreLedger
from app.watten_play import legal_cards
from app.watten_recipe import WattenRecipe, recipe_to_payload
from app.watten_rules import round_roles
from app.watten_runtime import (
    admit_account,
    apply_runtime_action,
    persist_watten_game,
    restore_watten_json,
    snapshot_watten,
)
from app.watten_websocket import _handle_locked
from tests.test_user_accounts import request_for

LOCAL = "http://localhost:8127"


@asynccontextmanager
async def quiet_lifespan(_app):
    # Migrate the isolated real database explicitly; unrelated background
    # reminder/legacy import tasks are not part of these focused route tests.
    yield


@pytest.fixture
def server(tmp_path, monkeypatch):
    for key, value in {
        "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path / 'watten.sqlite3'}",
        "ROLLTHEDICE_SITE_ORIGIN": LOCAL, "ROLLTHEDICE_ZILCH_ORIGIN": "http://zilch.localhost:8127",
        "ROLLTHEDICE_WATTEN_GAME_PREVIEW": "1", "ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW": "0",
        "ROLLTHEDICE_COOKIE_SECURE": "0", "ROLLTHEDICE_COOKIE_DOMAIN": "",
        "ROLLTHEDICE_TURNSTILE_SITE_KEY": "", "ROLLTHEDICE_TURNSTILE_SECRET": "",
    }.items():
        monkeypatch.setenv(key, value)
    previous = dict(games)
    games.clear()
    configure_database(tmp_path)
    upgrade_database(main.BASE)
    monkeypatch.setattr(main.app.router, "lifespan_context", quiet_lifespan)
    with TestClient(main.app, base_url=LOCAL) as client:
        yield client
    games.clear()
    games.update(previous)
    # Dispose the temporary SQLite connection before pytest removes its files.
    monkeypatch.undo()
    configure_database(main.DATA_DIR)


def account(name, role="user"):
    create_user(name, "runtime-account-password-123", must_change_password=False, role=role)
    identity, token = login(request_for(host="localhost:8127", origin=LOCAL), name, "runtime-account-password-123")
    response = Response()
    set_session_cookie(response, token)
    return identity, response.headers["set-cookie"].split(";", 1)[0]


def create_game(client, owner, *, count=2, blind=False, target=3, password=None, cpus=()):
    identity, cookie = owner
    recipe = WattenRecipe(count, "ladinisch" if blind else "normal", blind, False,
                          target_points=target, cpu_seats=cpus, password_required=bool(password))
    response = client.post("/api/games", headers={"Cookie": cookie, "Origin": LOCAL, "X-CSRF-Token": identity.csrf_token},
                           json={"name": "Local Watten", "game_type": "watten", "mode": str(count),
                                 "pass": password, "watten_recipe": recipe_to_payload(recipe)})
    assert response.status_code == 200, response.text
    return response.json()["game_id"]


def receive(ws, key, predicate=lambda _value: True):
    for _ in range(100):
        value = ws.receive_json()
        assert "error_code" not in value, value
        if key in value and predicate(value[key]):
            return value
    raise AssertionError(f"No {key} response")


def join(client, stack, game_id, owner, *, spectate=False, password=None):
    _identity, cookie = owner
    ws = stack.enter_context(client.websocket_connect(f"{LOCAL.replace('http:', 'ws:')}/ws/{game_id}", headers={"Cookie": cookie, "Origin": LOCAL}))
    hello = ws.receive_json()
    assert hello["game_type"] == "watten"
    if spectate:
        ws.send_json({"action": "spectate_game", "pass": password})
        return ws, receive(ws, "spectator_id")["spectator_id"]
    ws.send_json({"action": "join_game", "revision": hello["room_revision"], "pass": password})
    player = receive(ws, "player_id")["player_id"]
    receive(ws, "scoreboard", lambda view: view["viewer"] and view["viewer"]["participant_id"] == player)
    return ws, player


def room_command(game_id, action, number, **values):
    runtime = games[game_id]["_watten"]
    return {"action": action, "command_id": f"room-{number}", "revision": runtime.room.revision,
            "lifecycle_revision": runtime.lifecycle_revision, **values}


def engine_command(game_id, kind, number, value=None, player=None):
    engine = games[game_id]["_watten"].engine
    private = next((item.sequence for item in engine.feedback if item.sender == player), 0) if kind == "partner_feedback" else None
    return {"action": "watten_command", "command_id": f"engine-{number}", "deal_id": engine.deal_id,
            "opportunity": engine.opportunity, "phase": engine.phase, "kind": kind, "value": value,
            "private_opportunity": private, "lifecycle_revision": games[game_id]["_watten"].lifecycle_revision}


def send(ws, data):
    ws.send_json(data)
    return receive(ws, "watten_command", lambda ack: ack["command_id"] == data["command_id"])["watten_command"]


def seat_and_start(game_id, sockets, host, numbers):
    count_players = games[game_id]["_expected"]
    for seat, (ws, _player) in enumerate(sockets):
        send(ws, room_command(game_id, "watten_take_seat", next(numbers), seat=seat, team=seat % 2 if count_players == 4 else None))
    send(host, room_command(game_id, "watten_start", next(numbers)))


def next_move(game_id, numbers):
    state = games[game_id]["_watten"].engine
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    if state.phase == "strike":
        return state.recipe.seats[roles.strike_announcer], engine_command(game_id, "announce_strike", next(numbers), "7")
    if state.phase == "colour":
        return state.recipe.seats[roles.suit_announcer], engine_command(game_id, "announce_colour", next(numbers), "bells")
    if state.phase == "show_ready":
        seat = min(state.inspectors - state.shown)
        return state.recipe.seats[seat], engine_command(game_id, "show_ready", next(numbers))
    if state.phase == "inspection":
        seat = min(state.inspectors - state.acknowledged)
        return state.recipe.seats[seat], engine_command(game_id, "inspection_ack", next(numbers))
    assert state.phase == "play"
    player = state.play.current_player_id
    return player, engine_command(game_id, "play_card", next(numbers), legal_cards(state.play, state.bid_state, player)[0])


class CapturingSocket:
    """Same real account resolution, deterministic bounded in-process frames."""

    def __init__(self, owner):
        self.request = request_for(host="localhost:8127", origin=LOCAL,
                                   cookie=owner[1])
        self.messages = []
        self.closes = []

    def __getattr__(self, name):
        return getattr(self.request, name)

    async def send_json(self, message):
        self.messages.append(deepcopy(message))

    async def close(self, code=1000, reason=None):
        self.closes.append((code, reason))


def local_started(server, count_players=4, blind=False, password=None, cpus=(), target=3):
    owners = [account(f"RuntimePrivate{index}") for index in range(count_players - len(cpus))]
    game_id = create_game(server, owners[0], count=count_players, blind=blind, password=password, cpus=cpus, target=target)
    game = games[game_id]
    participants = []
    sessions = []
    for seat, owner in enumerate(owners):
        candidate, player = admit_account(game, owner[0], game["_watten"].room.revision, password)
        game.update(candidate)
        socket = CapturingSocket(owner)
        next(item for item in game["_players"] if item["id"] == player)["ws"] = socket
        sessions.append(GameSocketSession(socket, game, owner[0], player_id=player))
        participants.append(player)
        candidate, *_ = apply_runtime_action(game, owner[0].user_id, player,
                                             room_command(game_id, "watten_take_seat", seat, seat=seat,
                                                          team=seat % 2 if count_players == 4 else None))
        game.update(candidate)
    candidate, *_ = apply_runtime_action(game, owners[0][0].user_id, participants[0],
                                         room_command(game_id, "watten_start", "start"))
    persist_watten_game(candidate)
    game.update(candidate)
    return game_id, owners, sessions


def advance_to_play(game_id, sessions, numbers):
    by_player = {session.player_id: session for session in sessions}
    for _ in range(5):
        if games[game_id]["_watten"].engine.phase == "play":
            return
        player, command = next_move(game_id, numbers)
        asyncio.run(_handle_locked(by_player[player], command["action"], command))
    raise AssertionError("No play phase")


def test_strict_local_gate_covers_generic_create_list_detail_websocket_and_host_confusion(server, monkeypatch):
    owner = account("RuntimeGate")
    game_id = create_game(server, owner)
    cookie = owner[1]
    payload = {"name": "Guarded creation", "game_type": "watten", "mode": "2",
               "watten_recipe": recipe_to_payload(WattenRecipe(2, "normal", False, False, target_points=3))}
    assert server.get("/api/games?game_type=watten", headers={"Cookie": cookie}).json()["games"][0]["id"] == game_id
    assert server.get(f"/api/games/{game_id}", headers={"Cookie": cookie}).json()["engine"] is None
    assert server.get("/api/games?game_type=watten").status_code == 401
    assert server.post("/api/games", headers={"Origin": LOCAL}, json=payload).status_code == 401
    assert server.post("/api/games", headers={"Cookie": cookie, "Origin": LOCAL}, json=payload).status_code == 403
    for host in ("zockdiewandan.online", "watten.zockdiewandan.online", "localhost.evil.test", "127.0.0.1.evil.test", "localhost, evil.test"):
        headers = {"Cookie": cookie, "Host": host, "X-Forwarded-Host": "localhost:8127", "Origin": LOCAL}
        assert server.get("/api/games?game_type=watten", headers=headers).status_code in {404, 503}
        assert server.get(f"/api/games/{game_id}", headers=headers).status_code in {404, 503}
        assert server.post("/api/games", headers={**headers, "X-CSRF-Token": owner[0].csrf_token}, json=payload).status_code in {404, 503}
        with pytest.raises(WebSocketDisconnect):
            with server.websocket_connect(f"/ws/{game_id}", headers=headers):
                pass
    duplicate = [("Cookie", cookie), ("Host", "localhost:8127"), ("Host", "evil.test")]
    assert server.get(f"/api/games/{game_id}", headers=duplicate).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", "https://zockdiewandan.online")
    assert server.get(f"/api/games/{game_id}", headers={"Cookie": cookie}).status_code == 404
    assert server.post("/api/games", headers={"Cookie": cookie, "Origin": LOCAL, "X-CSRF-Token": owner[0].csrf_token}, json=payload).status_code == 404
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", LOCAL)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    assert server.get(f"/api/games/{game_id}", headers={"Cookie": cookie}).status_code == 404
    assert server.post("/api/games", headers={"Cookie": cookie, "Origin": LOCAL, "X-CSRF-Token": owner[0].csrf_token}, json=payload).status_code == 404
    assert adapter_for_game_type("watten").game_type == "watten"


@pytest.mark.parametrize("count_players,blind", ((2, False), (3, False), (4, True)))
def test_real_humans_finish_match_restart_and_replay_without_duplicate_results(server, count_players, blind):
    owners = [account(f"RuntimeFull{index}") for index in range(count_players)]
    with session_scope() as db:
        prior_achievements = db.scalar(select(func.count(UserAchievement.id)))
    game_id = create_game(server, owners[0], count=count_players, blind=blind)
    numbers = count()
    with ExitStack() as stack:
        sockets = [join(server, stack, game_id, owner) for owner in owners]
        seat_and_start(game_id, sockets, sockets[0][0], numbers)
        # Restart at a real pre-call/inspection boundary. No hands, roles or
        # cryptographic deal are redrawn when sockets reconnect by account.
        saved = serializable_game_state(games[game_id])
        assert saved["_watten"]["absent"] == []
    restored = load_active_games()[game_id]
    assert serializable_game_state(restored) == saved
    assert all(item["ws"] is None for item in restored["_players"])
    games[game_id] = restored
    with ExitStack() as stack:
        sockets = [join(server, stack, game_id, owner) for owner in owners]
        by_player = {player: ws for ws, player in sockets}
        host = sockets[0][0]
        final = None
        for _ in range(300):
            state = games[game_id]["_watten"].engine
            if state.phase == "match_complete":
                break
            if state.phase == "deal_complete":
                send(host, room_command(game_id, "watten_next_deal", next(numbers), deal_id=state.deal_id, opportunity=state.opportunity))
                continue
            player, data = next_move(game_id, numbers)
            send(by_player[player], data)
            final = (by_player[player], data)
        else:
            raise AssertionError("Match did not finish")
        assert games[game_id]["_completion_persisted"]
        send(*final)
        with session_scope() as db:
            assert db.scalar(select(func.count(CompletedGame.id))) == 1
            assert db.scalar(select(CompletedGame.game_type)) == "watten"
            assert db.scalar(select(func.count(GameParticipant.id))) == count_players
            assert db.scalar(select(func.count(UserAchievement.id))) == prior_achievements
            raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
        assert restore_watten_json(raw)["_watten"].engine.phase == "match_complete"
        assert "stock" not in json.dumps(games[game_id]["_watten_result"])


def test_failed_final_transaction_keeps_previous_state_and_checkpoint_until_same_command_commits(server):
    owners = [account("RuntimeAtomicA"), account("RuntimeAtomicB")]
    game_id = create_game(server, owners[0])
    numbers = count()
    with ExitStack() as stack:
        sockets = [join(server, stack, game_id, owner) for owner in owners]
        seat_and_start(game_id, sockets, sockets[0][0], numbers)
        by_player = {player: (ws, owner) for (ws, player), owner in zip(sockets, owners)}
        for _ in range(100):
            state = games[game_id]["_watten"].engine
            if state.phase == "deal_complete":
                send(sockets[0][0], room_command(game_id, "watten_next_deal", next(numbers), deal_id=state.deal_id, opportunity=state.opportunity))
                continue
            player, data = next_move(game_id, numbers)
            ws, owner = by_player[player]
            candidate, _ack, _replayed, _private = apply_runtime_action(games[game_id], owner[0].user_id, player, data)
            if not candidate["_finished"]:
                send(ws, data)
                continue
            from app import watten_runtime

            real_scope = watten_runtime.session_scope

            @contextmanager
            def failed_commit():
                with real_scope() as db:
                    yield db
                    raise SQLAlchemyError("deliberate final-commit failure")

            previous = games[game_id]["_watten"]
            with patch.object(watten_runtime, "session_scope", failed_commit):
                ws.send_json(data)
                error = ws.receive_json()
                while "error_code" not in error:
                    error = ws.receive_json()
                assert error["error_code"] == "watten_storage_unavailable"
            assert games[game_id]["_watten"] == previous
            with session_scope() as db:
                assert db.scalar(select(func.count(CompletedGame.id))) == 0
                raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
                assert restore_watten_json(raw)["_watten"] == previous
            send(ws, data)
            assert games[game_id]["_completion_persisted"]
            break
        else:
            raise AssertionError("No terminal command reached")


def test_every_broadcast_reprojects_members_and_founder_spectator_without_raw_state(server):
    game_id, _owners, sessions = local_started(server, blind=True)
    founder = account("RuntimeSpectatorFounder", role="admin")
    spectator = CapturingSocket(founder)
    game = games[game_id]
    game["_spectators"].append({"id": "spectator", "user_id": founder[0].user_id, "ws": spectator})
    advance_to_play(game_id, sessions, count())
    for session in sessions:
        session.websocket.messages.clear()
    spectator.messages.clear()
    from app.game_realtime import broadcast

    asyncio.run(broadcast(game, {"scoreboard": game["_watten"], "stock": "unsafe caller payload"}))
    for session in sessions:
        assert session.websocket.messages == [{"scoreboard": snapshot_watten(game, session.player_id)}]
        payload = session.websocket.messages[0]["scoreboard"]
        assert "inspection" in payload["engine"] and payload["engine"]["inspection"] is None
        assert len(payload["engine"]["hand"]) == 5
    assert spectator.messages == [{"scoreboard": snapshot_watten(game)}]
    public = spectator.messages[0]["scoreboard"]["engine"]
    assert not {"hand", "inspection", "feedback", "legal_cards", "call", "stock"} & public.keys()
    for forbidden in ("account_id", "bottom_cards", "_watten", "unsafe caller payload"):
        assert forbidden not in json.dumps([session.websocket.messages for session in sessions] + spectator.messages)


def test_private_feedback_changes_only_partner_frames_and_no_public_projection_or_timestamp(server):
    game_id, _owners, sessions = local_started(server)
    game = games[game_id]
    numbers = count()
    advance_to_play(game_id, sessions, numbers)
    for session in sessions:
        session.websocket.messages.clear()
    sender = sessions[0]
    before_public = snapshot_watten(game)
    before_modified = game["_updated_at"], game["_last_activity"]
    command = engine_command(game_id, "partner_feedback", next(numbers), "good", sender.player_id)
    asyncio.run(_handle_locked(sender, command["action"], command))
    assert snapshot_watten(game) == before_public
    assert (game["_updated_at"], game["_last_activity"]) == before_modified
    assert sessions[1].websocket.messages == sessions[3].websocket.messages == []
    assert sessions[0].websocket.messages[0]["scoreboard"]["engine"]["feedback"][0]["value"] == "good"
    assert sessions[2].websocket.messages[0]["scoreboard"]["engine"]["feedback"][0]["value"] == "good"
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
    assert snapshot_watten(restore_watten_json(raw)) == before_public
    # Wrong account cannot use the partner's private command envelope.
    with pytest.raises(ValueError, match="watten_actor_not_bound"):
        apply_runtime_action(game, sessions[1].auth_identity.user_id, sender.player_id, command)


def test_call_delivery_survives_restart_is_personal_and_ack_does_not_reopen_or_notify_opponents(server):
    game_id, owners, sessions = local_started(server, count_players=2)
    game = games[game_id]
    spectator_owner = account("RuntimeLiveSpectator")
    spectator = CapturingSocket(spectator_owner)
    game["_spectators"].append({"id": "spectator", "user_id": spectator_owner[0].user_id, "ws": spectator})
    numbers = count()
    advance_to_play(game_id, sessions, numbers)
    live = [frame["watten_public_call_events"] for frame in spectator.messages if "watten_public_call_events" in frame]
    assert {event["kind"] for frame in live for event in frame} == {"strike_announced", "colour_announced"}
    assert snapshot_watten(game)["pending_call_events"] == []
    original = snapshot_watten(game, sessions[0].player_id)["pending_call_events"]
    assert len(original) == 2
    restored = restore_watten_json(json.dumps(serializable_game_state(game)))
    assert snapshot_watten(restored, sessions[0].player_id)["pending_call_events"] == original
    assert "call" not in snapshot_watten(restored, sessions[0].player_id)["engine"]
    for session in sessions:
        session.websocket.messages.clear()
    spectator.messages.clear()
    modified = game["_updated_at"], game["_last_activity"]
    command = room_command(game_id, "watten_delivery_ack", next(numbers), delivery_ids=[item["delivery_id"] for item in original])
    asyncio.run(_handle_locked(sessions[0], command["action"], command))
    assert sessions[1].websocket.messages == spectator.messages == []
    assert (game["_updated_at"], game["_last_activity"]) == modified
    assert snapshot_watten(game, sessions[0].player_id)["pending_call_events"] == []
    assert len(snapshot_watten(game, sessions[1].player_id)["pending_call_events"]) == 2
    games[game_id] = restored = restore_watten_json(json.dumps(serializable_game_state(game)))
    candidate, _ack, replayed, _private = apply_runtime_action(restored, owners[0][0].user_id, sessions[0].player_id, command)
    assert replayed
    assert snapshot_watten(candidate, sessions[0].player_id)["pending_call_events"] == []
    assert snapshot_watten(candidate, sessions[0].player_id)["engine"]["inspection"] is None


def test_blind_inspection_rejoin_same_window_then_ack_never_reopens_and_no_spectator_call(server):
    game_id, owners, sessions = local_started(server, blind=True)
    game = games[game_id]
    numbers = count()
    while game["_watten"].engine.phase == "show_ready":
        player, command = next_move(game_id, numbers)
        session = next(item for item in sessions if item.player_id == player)
        asyncio.run(_handle_locked(session, command["action"], command))
    state = game["_watten"].engine
    seat = min(state.inspectors)
    player = state.recipe.seats[seat]
    own = next(item for item in sessions if item.player_id == player)
    original = snapshot_watten(game, player)["engine"]["inspection"]
    assert len(original["cards"]) == 2
    restored = restore_watten_json(json.dumps(serializable_game_state(game)))
    candidate, same = admit_account(restored, owners[sessions.index(own)][0], restored["_watten"].room.revision, None)
    assert same == player and snapshot_watten(candidate, player)["engine"]["inspection"] == original
    command = engine_command(game_id, "inspection_ack", next(numbers))
    asyncio.run(_handle_locked(own, command["action"], command))
    assert snapshot_watten(game, player)["engine"]["inspection"] is None
    restored = restore_watten_json(json.dumps(serializable_game_state(game)))
    candidate, *_ = apply_runtime_action(restored, own.auth_identity.user_id, player, command)
    assert snapshot_watten(candidate, player)["engine"]["inspection"] is None
    advance_to_play(game_id, sessions, numbers)
    assert game["_watten"].deliveries == ()


def test_replaced_socket_cannot_reclaim_seat_and_revoked_account_cannot_read_or_mutate(server):
    game_id, owners, sessions = local_started(server, count_players=2, password="room-secret")
    game = games[game_id]
    old = sessions[0]
    replacement = CapturingSocket(owners[0])
    new_session = GameSocketSession(replacement, game, owners[0][0])
    asyncio.run(_handle_locked(new_session, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision}))
    assert old.websocket.closes[-1][0] == 1008
    assert new_session.player_id == old.player_id
    previous = game["_watten"]
    assert asyncio.run(_handle_locked(old, "join_game", {"action": "join_game", "revision": game["_watten"].room.revision}))
    assert game["_watten"] == previous
    assert next(item for item in game["_players"] if item["id"] == old.player_id)["ws"] is replacement
    logout(owners[0][1].split("=", 1)[1])
    assert asyncio.run(_handle_locked(new_session, "get_state", {"action": "get_state"}))
    assert replacement.messages[-1]["error_code"] == "watten_access_required"
    assert game["_watten"] == previous


def test_cpu_seat_requires_manual_start_then_own_actions_and_running_leave_has_no_forfeit(server, monkeypatch):
    from types import SimpleNamespace

    from app import watten_cpu_runtime as runner
    from app import watten_runtime as runtime_module

    monkeypatch.setattr(runtime_module, "_RANDOM", SimpleNamespace(randrange=lambda _count: 1, shuffle=lambda _deck: None))
    monkeypatch.setattr(runner, "THINK_MIN_SECONDS", 0.01)
    monkeypatch.setattr(runner, "THINK_MAX_SECONDS", 0.01)
    owner = account("ManualCpuHost")
    game_id = create_game(server, owner, cpus=(1,))
    game = games[game_id]
    candidate, player = admit_account(game, owner[0], game["_watten"].room.revision, None)
    socket = CapturingSocket(owner)
    next(item for item in candidate["_players"] if item["id"] == player)["ws"] = socket
    persist_watten_game(candidate)
    game.update(candidate)
    human = GameSocketSession(socket, game, owner[0], player_id=player)

    async def scenario():
        try:
            await _handle_locked(human, "watten_take_seat", room_command(game_id, "watten_take_seat", "seat", seat=0, team=None))
            await asyncio.sleep(0.03)
            assert game["_watten"].engine is None and not game["_started"]
            await _handle_locked(human, "watten_start", room_command(game_id, "watten_start", "start"))
            assert snapshot_watten(game)["capabilities"] == {"cpu_autoplay": True}
            assert game["_watten"].engine.phase == "strike"
            await asyncio.sleep(0.03)
            assert game["_watten"].engine.phase == "strike"  # the CPU cannot announce for its human host
            await _handle_locked(human, "watten_command", engine_command(game_id, "announce_strike", "strike", "7"))
            for _ in range(100):
                if game["_watten"].engine.phase == "play":
                    break
                await asyncio.sleep(0.002)
            assert game["_watten"].engine.phase == "play"  # CPU announces only its own colour
            state = game["_watten"].engine
            assert state.play.current_player_id == player
            await _handle_locked(human, "watten_command", engine_command(game_id, "play_card", "lead", legal_cards(state.play, state.bid_state, player)[0]))
            opportunity = game["_watten"].engine.opportunity
            for _ in range(100):
                if game["_watten"].engine.opportunity > opportunity:
                    break
                await asyncio.sleep(0.002)
            assert game["_watten"].engine.opportunity > opportunity  # genuine scheduled CPU proposal
            previous = game["_watten"]
            with pytest.raises(ValueError, match="watten_running_leave_unsupported"):
                apply_runtime_action(game, owner[0].user_id, player, room_command(game_id, "leave_waiting_game", "old-leave"))
            assert game["_watten"] == previous
            await _handle_locked(human, "watten_leave", room_command(game_id, "watten_leave", "pause"))
            assert game["_watten"].absent == (player,) and game["_watten"].engine == previous.engine
            assert not game["_completion_persisted"]
            assert restore_watten_json(json.dumps(serializable_game_state(game)))["_watten"] == game["_watten"]
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())


def test_strict_codec_rejects_unknown_duplicate_nonfinite_fields_and_private_repr(server):
    game_id, _owners, _sessions = local_started(server, count_players=2)
    game = games[game_id]
    raw = serializable_game_state(game)
    with pytest.raises(ValueError):
        restore_watten_json(json.dumps({**raw, "raw_clients": []}))
    with pytest.raises(ValueError):
        restore_watten_json(json.dumps(raw).replace('"_game_type": "watten"', '"_game_type": "watten", "_game_type": "zdwa"'))
    with pytest.raises(ValueError):
        restore_watten_json(json.dumps(raw).replace('"schema_version": 1', '"schema_version": NaN', 1))
    assert "bells-" not in repr(game["_watten"]) and "account_id" not in repr(game["_watten"])


def test_stored_watten_results_never_fall_through_main_result_history_stats_delete_or_reminders(server, monkeypatch):
    owner = account("RuntimeResultOwner", role="admin")
    identity, cookie = owner
    result_id = "private-local-watten-result"
    with session_scope() as db:
        result = CompletedGame(game_id=result_id, game_type="watten", game_name="Local result", finished_at=utcnow(),
                               mode="2", hardcore=False, snapshot_json='{"kind":"watten_result"}',
                               imported_from_legacy=False, created_at=utcnow())
        db.add(result)
        db.flush()
        db.add(GameParticipant(game_id=result.id, position=0, player_key="p1", display_name=identity.username,
                               user_id=identity.user_id, points=3))
    # The production/main-origin APIs cannot infer the local result from a
    # typed result row, including an authenticated administrator's delete API.
    headers = {"Cookie": cookie, "Host": "zockdiewandan.online", "Origin": "https://zockdiewandan.online",
               "X-CSRF-Token": identity.csrf_token}
    assert server.get(f"/ergebnis/{result_id}", headers=headers).status_code == 404
    assert server.get(f"/api/game_from_leaderboard/{result_id}", headers=headers).status_code == 404
    assert server.get("/api/users/me/game-history", headers=headers).json()["games"] == []
    profile = server.get("/api/users/me/statistics", headers=headers).json()["player"]
    assert profile["recent_games"] == [] and profile["statistics"]["overall"]["games_played"] == 0
    denied = server.request("DELETE", f"https://zockdiewandan.online/api/admin/completed-games/{result_id}", headers=headers,
                            json={"confirmation_game_id": result_id, "reason": "Local result privacy test"})
    assert denied.status_code == 404
    local_headers = {**headers, "Host": "localhost:8127", "Origin": LOCAL}
    unsupported = server.request("DELETE", f"/api/admin/completed-games/{result_id}", headers=local_headers,
                                 json={"confirmation_game_id": result_id, "reason": "Local result privacy test"})
    assert unsupported.status_code == 409
    assert unsupported.json()["detail"] == "watten_result_delete_unsupported"
    from app.game_history import delete_completed_game

    with pytest.raises(ValueError, match="watten_result_delete_unsupported"):
        delete_completed_game(game_id=result_id, admin_user_id=identity.user_id, reason="Local result privacy test")
    from app.game_activity import not_played_on, play_day

    with session_scope() as db:
        assert db.scalar(select(User.id).where(User.id == identity.user_id, not_played_on(play_day(utcnow())))) == identity.user_id
        assert db.scalar(select(func.count(CompletedGame.id))) == 1
        assert db.scalar(select(func.count(DeletedGame.id))) == 0
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_GAME_PREVIEW", "0")
    local_headers = {**headers, "Host": "localhost:8127", "Origin": LOCAL}
    assert server.request("DELETE", f"/api/admin/completed-games/{result_id}", headers=local_headers,
                          json={"confirmation_game_id": result_id, "reason": "Local result privacy test"}).status_code == 404


def test_result_writer_never_invents_account_binding_for_a_deleted_participant(server):
    game_id, owners, sessions = local_started(server, count_players=2)
    game = games[game_id]
    numbers = count()
    account_by_player = {session.player_id: owner[0].user_id for session, owner in zip(sessions, owners)}
    for _ in range(300):
        state = game["_watten"].engine
        if state.phase == "match_complete":
            break
        if state.phase == "deal_complete":
            player = sessions[0].player_id
            command = room_command(game_id, "watten_next_deal", next(numbers), deal_id=state.deal_id, opportunity=state.opportunity)
        else:
            player, command = next_move(game_id, numbers)
        candidate, *_ = apply_runtime_action(game, account_by_player[player], player, command)
        game.update(candidate)
    assert game["_finished"]
    deleted_account = owners[1][0].user_id
    with session_scope() as db:
        db.delete(db.get(User, deleted_account))
    persist_watten_game(game)
    with session_scope() as db:
        rows = list(db.scalars(select(GameParticipant).order_by(GameParticipant.position)))
        assert rows[0].user_id == owners[0][0].user_id
        assert rows[1].user_id is None and rows[1].display_name == owners[1][0].username
    assert "account_id" not in json.dumps(game["_watten_result"])


@pytest.mark.parametrize("damage", ("unknown_engine_field", "missing_marker", "wrong_marker", "duplicate_last_marker"))
def test_invalid_private_checkpoint_is_retained_for_recovery_but_never_routed(server, damage):
    game_id, _owners, sessions = local_started(server, count_players=2)
    game = games[game_id]
    if damage != "unknown_engine_field":
        # A real terminal native checkpoint must never fall through legacy
        # _completion_persisted cleanup merely because its marker is damaged.
        numbers = count()
        accounts = {session.player_id: session.auth_identity.user_id for session in sessions}
        for _ in range(300):
            engine = game["_watten"].engine
            if engine.phase == "match_complete":
                break
            if engine.phase == "deal_complete":
                player = sessions[0].player_id
                command = room_command(game_id, "watten_next_deal", next(numbers), deal_id=engine.deal_id, opportunity=engine.opportunity)
            else:
                player, command = next_move(game_id, numbers)
            candidate, *_ = apply_runtime_action(game, accounts[player], player, command)
            game.update(candidate)
        assert game["_finished"]
        persist_watten_game(game)
        assert game["_completion_persisted"]
    with session_scope() as db:
        row = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))
        value = json.loads(row.state_json)
        if damage == "unknown_engine_field":
            value["_watten"]["engine"]["unknown_private_field"] = "invalid"
        elif damage == "missing_marker":
            value.pop("_game_type")
        elif damage == "wrong_marker":
            value["_game_type"] = "zdwa"
        malformed = json.dumps(value)
        if damage == "duplicate_last_marker":
            malformed = malformed[:-1] + ', "_game_type":"zdwa"}'
        row.state_json = malformed
    assert game_id not in load_active_games()
    with session_scope() as db:
        assert db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id)) == malformed


@pytest.mark.parametrize("phase", ("strike", "colour", "show_ready", "inspection", "play", "bid_response", "deal_complete"))
def test_deliberate_absence_freezes_every_engine_phase_without_reopening_knowledge(server, phase):
    game_id, _owners, sessions = local_started(server, count_players=4 if phase in {"show_ready", "inspection"} else 2,
                                              blind=phase in {"show_ready", "inspection"}, target=11)
    game = games[game_id]
    numbers = count()
    by_player = {session.player_id: session for session in sessions}
    for _ in range(40):
        state = game["_watten"].engine
        if state.phase == phase:
            break
        if phase == "bid_response" and state.phase == "play" and state.play.plays:
            player, command = state.play.current_player_id, engine_command(game_id, "bid", next(numbers))
        else:
            player, command = next_move(game_id, numbers)
        asyncio.run(_handle_locked(by_player[player], command["action"], command))
    assert game["_watten"].engine.phase == phase
    frozen_engine = game["_watten"].engine
    before = snapshot_watten(game, sessions[0].player_id)["engine"]
    leave = room_command(game_id, "watten_leave", "deliberate")
    assert asyncio.run(_handle_locked(sessions[0], leave["action"], leave))
    assert game["_watten"].engine == frozen_engine
    assert game["_watten"].absent == (sessions[0].player_id,)
    assert game["_watten"].lifecycle_revision == 1
    assert snapshot_watten(game, sessions[0].player_id)["can_resume"]
    assert not snapshot_watten(game, sessions[1].player_id)["can_resume"]
    assert not snapshot_watten(game)["can_resume"]
    assert restore_watten_json(json.dumps(serializable_game_state(game)))["_watten"] == game["_watten"]
    if phase == "deal_complete":
        player = sessions[0].player_id
        command = room_command(game_id, "watten_next_deal", "paused", deal_id=frozen_engine.deal_id, opportunity=frozen_engine.opportunity)
    elif phase == "bid_response":
        player = frozen_engine.parties.decider(1 - frozen_engine.bid_state.pending.party)
        command = engine_command(game_id, "respond", "paused", "hold")
    else:
        player, command = next_move(game_id, numbers)
    account_id = by_player[player].auth_identity.user_id
    with pytest.raises(ValueError, match="watten_match_paused"):
        apply_runtime_action(game, account_id, player, command)
    assert game["_watten"].engine == frozen_engine
    after = snapshot_watten(game, sessions[0].player_id)["engine"]
    assert {key: value for key, value in before.items() if key != "actions"} == {key: value for key, value in after.items() if key != "actions"}
    assert set(after["actions"]) <= {"partner_feedback"}


def test_multiple_deliberate_absences_restore_frozen_bid_until_explicit_account_returns_and_reject_old_generation(server):
    game_id, owners, sessions = local_started(server, target=11)
    game = games[game_id]
    numbers = count()
    advance_to_play(game_id, sessions, numbers)
    by_player = {session.player_id: session for session in sessions}
    player, command = next_move(game_id, numbers)
    asyncio.run(_handle_locked(by_player[player], command["action"], command))
    state = game["_watten"].engine
    player = state.play.current_player_id
    bid = engine_command(game_id, "bid", next(numbers))
    asyncio.run(_handle_locked(by_player[player], bid["action"], bid))
    frozen = game["_watten"].engine
    assert frozen.phase == "bid_response"
    responder = frozen.parties.decider(1 - frozen.bid_state.pending.party)
    stale = engine_command(game_id, "respond", "before-pause", "hold")
    leaves = []
    for session in sessions[:2]:
        command = room_command(game_id, "watten_leave", next(numbers))
        leaves.append(command)
        assert asyncio.run(_handle_locked(session, command["action"], command))
    assert len(game["_watten"].absent) == 2 and game["_watten"].lifecycle_revision == 2
    assert game["_watten"].engine == frozen
    restored = load_active_games()[game_id]
    assert restored["_watten"].engine == frozen
    games[game_id] = game = restored
    new_sessions = []
    for index, owner in enumerate(owners):
        socket = CapturingSocket(owner)
        session = GameSocketSession(socket, game, owner[0])
        asyncio.run(_handle_locked(session, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision}))
        new_sessions.append(session)
        assert session.player_id == sessions[index].player_id
    assert game["_watten"].lifecycle_revision == 2 and len(game["_watten"].absent) == 2
    # Advice remains private while progress and the pending bid are frozen.
    before_public = snapshot_watten(game)
    for session in new_sessions:
        session.websocket.messages.clear()
    advice = engine_command(game_id, "partner_feedback", "paused-advice", "unsure", new_sessions[2].player_id)
    asyncio.run(_handle_locked(new_sessions[2], advice["action"], advice))
    assert snapshot_watten(game) == before_public
    assert new_sessions[1].websocket.messages == new_sessions[3].websocket.messages == []
    for session in new_sessions[:2]:
        asyncio.run(_handle_locked(session, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision,
                                                           "resume": True, "lifecycle_revision": game["_watten"].lifecycle_revision}))
    assert game["_watten"].absent == () and game["_watten"].lifecycle_revision == 4
    assert not snapshot_watten(game, new_sessions[0].player_id)["can_resume"]
    assert game["_watten"].engine.bid_state == frozen.bid_state
    assert game["_watten"].engine.opportunity == frozen.opportunity
    own = next(item for item in new_sessions if item.player_id == responder)
    with pytest.raises(ValueError, match="watten_stale_lifecycle"):
        apply_runtime_action(game, own.auth_identity.user_id, own.player_id, stale)
    # A cached old leave is only a current-generation ACK, never another pause
    # or detachment of the deliberate returned connection.
    assert not asyncio.run(_handle_locked(new_sessions[0], "watten_leave", leaves[0]))
    assert new_sessions[0].websocket.closes == []
    assert new_sessions[0].websocket.messages[-1]["watten_command"]["lifecycle_revision"] == 4
    fresh = engine_command(game_id, "respond", "after-pause", "hold")
    asyncio.run(_handle_locked(own, fresh["action"], fresh))
    assert game["_watten"].engine.phase == "play"


@pytest.mark.parametrize("phase", ("inspection", "play"))
def test_logout_and_new_account_login_blocks_outbound_secrets_before_old_socket_sends_again(server, phase):
    game_id, owners, sessions = local_started(server, blind=phase == "inspection")
    game = games[game_id]
    numbers = count()
    if phase == "play":
        advance_to_play(game_id, sessions, numbers)
        victim = sessions[0]
        sender = sessions[2]
        command = engine_command(game_id, "partner_feedback", "after-account-switch", "bad", sender.player_id)
    else:
        while game["_watten"].engine.phase == "show_ready":
            player, command = next_move(game_id, numbers)
            sender = next(item for item in sessions if item.player_id == player)
            asyncio.run(_handle_locked(sender, command["action"], command))
        inspector_ids = [game["_watten"].engine.recipe.seats[index] for index in sorted(game["_watten"].engine.inspectors)]
        victim, sender = [next(item for item in sessions if item.player_id == player) for player in inspector_ids]
        assert snapshot_watten(game, victim.player_id)["engine"]["inspection"] is not None
        command = engine_command(game_id, "inspection_ack", "other-inspector-after-logout")
    for session in sessions:
        session.websocket.messages.clear()
    owner = owners[sessions.index(victim)]
    logout(owner[1].split("=", 1)[1])
    # Account B signs in after A's token was revoked. A's already accepted
    # socket keeps its immutable old handshake token, and sends no message.
    other = next(item for item in owners if item[0].user_id != owner[0].user_id)
    identity_b, _token_b = login(request_for(host="localhost:8127", origin=LOCAL), other[0].username, "runtime-account-password-123")
    assert identity_b.user_id != victim.auth_identity.user_id
    asyncio.run(_handle_locked(sender, command["action"], command))
    assert victim.websocket.messages == []
    assert victim.websocket.closes[-1][0] == 1008
    assert next(item for item in game["_players"] if item["id"] == victim.player_id)["ws"] is None


def test_only_native_locked_waiting_deadline_expires_and_running_pause_has_no_timeout_or_abandonment(server, monkeypatch):
    from app import watten_runtime
    from app.game_state import check_timeout_and_abort
    from app.models import AbandonedGame
    from app.watten_websocket import sweep_watten_waiting_games

    waiting_owner = account("RuntimeWaitingDeadline")
    waiting_id = create_game(server, waiting_owner)
    running_id, _owners, sessions = local_started(server, count_players=2)
    leave = room_command(running_id, "watten_leave", "paused-deadline")
    asyncio.run(_handle_locked(sessions[0], leave["action"], leave))
    frozen = games[running_id]["_watten"]
    future = utcnow() + timedelta(days=30)
    monkeypatch.setattr(watten_runtime, "utcnow", lambda: future)
    assert not check_timeout_and_abort(games[waiting_id], now=future)
    assert games[waiting_id]["_watten"].room.status == "waiting"
    assert asyncio.run(sweep_watten_waiting_games()) == 1
    assert games[waiting_id]["_watten"].room.status == "closed"
    assert games[running_id]["_watten"] == frozen
    with session_scope() as db:
        assert db.scalar(select(func.count(AbandonedGame.id))) == 0
        assert db.scalar(select(func.count(CompletedGame.id))) == 0


def test_delayed_resume_cannot_clear_later_absence_and_cached_leave_never_detaches_plain_return(server):
    game_id, owners, sessions = local_started(server, count_players=2)
    game = games[game_id]
    owner = owners[0]
    leave = room_command(game_id, "watten_leave", "first-absence")
    assert asyncio.run(_handle_locked(sessions[0], "watten_leave", leave))
    delayed = GameSocketSession(CapturingSocket(owner), game, owner[0])
    first_return = {"action": "rejoin_game", "revision": game["_watten"].room.revision,
                    "resume": True, "lifecycle_revision": game["_watten"].lifecycle_revision}
    plain = GameSocketSession(CapturingSocket(owner), game, owner[0])
    asyncio.run(_handle_locked(plain, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision}))
    assert game["_watten"].absent == (plain.player_id,)
    assert not asyncio.run(_handle_locked(plain, "watten_leave", leave))
    assert plain.websocket.closes == []
    assert next(item for item in game["_players"] if item["id"] == plain.player_id)["ws"] is plain.websocket
    with pytest.raises(ValueError, match="watten_stale_lifecycle"):
        asyncio.run(_handle_locked(plain, "rejoin_game", {"action": "rejoin_game", "revision": game["_watten"].room.revision, "resume": True}))
    asyncio.run(_handle_locked(plain, "rejoin_game", first_return))
    second_leave = room_command(game_id, "watten_leave", "second-absence")
    assert asyncio.run(_handle_locked(plain, "watten_leave", second_leave))
    frozen = game["_watten"]
    assert frozen.lifecycle_revision == 3 and frozen.absent == (plain.player_id,)
    with pytest.raises(ValueError, match="watten_stale_lifecycle"):
        asyncio.run(_handle_locked(delayed, "rejoin_game", first_return))
    assert game["_watten"] == frozen
    assert next(item for item in game["_players"] if item["id"] == plain.player_id)["ws"] is None


def test_logout_during_awaited_peer_leave_fanout_cannot_emit_late_private_snapshot_or_ack(server, monkeypatch):
    game_id, owners, sessions = local_started(server)
    advance_to_play(game_id, sessions, count())
    for session in sessions:
        session.websocket.messages.clear()
    sender = sessions[0]
    original_send = sessions[1].websocket.send_json

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def delayed_peer(message):
            entered.set()
            await release.wait()
            await original_send(message)

        monkeypatch.setattr(sessions[1].websocket, "send_json", delayed_peer)
        leave = room_command(game_id, "watten_leave", "logout-during-leave")
        task = asyncio.create_task(_handle_locked(sender, "watten_leave", leave))
        await asyncio.wait_for(entered.wait(), timeout=2)
        logout(owners[0][1].split("=", 1)[1])
        login(request_for(host="localhost:8127", origin=LOCAL), owners[1][0].username, "runtime-account-password-123")
        release.set()
        assert await asyncio.wait_for(task, timeout=2)

    asyncio.run(scenario())
    assert sender.websocket.messages == []
    assert sender.websocket.closes[-1][0] == 1008
    assert games[game_id]["_watten"].absent == (sender.player_id,)


def test_canonical_large_valid_checkpoint_restores_without_asymmetric_reader_limit(server):
    game_id, _owners, _sessions = local_started(server, count_players=2, target=10000)
    game = games[game_id]
    runtime = game["_watten"]
    engine = runtime.engine
    # Construct validated durable score evidence directly: this tests storage,
    # not thousands of already-covered card transitions. Both targets and a
    # match's number of past deals intentionally have no invented size limit.
    results = tuple(DealResult(f"old-{game_id}-{index:016x}",
                               replace(engine.parties, dealer_id=engine.recipe.seats[(engine.dealer_seat + index) % 2]),
                               index % 2, 2, "tricks") for index in range(3000))
    accounts = tuple(ScoreAccount(item.members, sum(result.points for result in results
                                                   if set(item.members) <= set(result.roles.parties[result.winning_party])))
                     for item in engine.ledger.accounts)
    ledger = ScoreLedger(engine.ledger.target, accounts, results)
    game["_watten"] = replace(runtime, engine=replace(engine, ledger=ledger, opportunity=150000))
    persist_watten_game(game)
    with session_scope() as db:
        saved = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
    assert len(saved) > 512000
    assert serializable_game_state(restore_watten_json(saved)) == serializable_game_state(game)
    assert serializable_game_state(load_active_games()[game_id]) == serializable_game_state(game)
