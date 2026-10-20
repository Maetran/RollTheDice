"""Founder-only access, per-viewer cards and trusted CPU lifecycle contracts."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.active_games import load_active_games, save_active_game, serializable_game_state
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_access import can_access_hausdepp
from app.game_realtime import broadcast
from app.game_registry import create_game_state, gameplay_actions_for_game
from app.game_snapshot import snapshot
from app.game_state import games, multiplayer_pause_reason
from app.game_ws_session import GameSocketSession, disconnect_session, handle_session_action
from app.hausdepp_cpu_runner import cpu_action_is_due, maybe_schedule_cpu_turn, stop_cpu_runners
from app.hausdepp_cpu_strategy import choose_cpu_action
from app.hausdepp_engine import HausdeppRuleError, apply_action, make_deck, new_round, project_state
from app.hausdepp_gameplay import apply_hausdepp_command, game_lock, handle_hausdepp_gameplay_action
from app.hausdepp_results import finalize_hausdepp_result, list_hausdepp_results_for_user
from app.hausdepp_state import configure_hausdepp_game, join_hausdepp_player, start_hausdepp_game
from app.models import CompletedGame, GameParticipant
from app.ownership import bind_founder, grant_ownership
from tests.test_user_accounts import request_for


class RecordingSocket:
    def __init__(self):
        self.messages = []
        self.closed = False

    async def send_json(self, message):
        self.messages.append(message)

    async def close(self, **_kwargs):
        self.closed = True


class HausdeppIntegrationTests(unittest.TestCase):
    def setUp(self):
        games.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/hausdepp.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": "0",
        })
        self.env.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.founder = create_user("Founder", "secure-password-123", role="admin", must_change_password=False)
        self.owner = create_user("Owner", "secure-password-123", role="admin", must_change_password=False)
        self.admin = create_user("Mani", "secure-password-123", role="admin", must_change_password=False)
        self.player = create_user("Player", "secure-password-123", must_change_password=False)
        with session_scope() as db:
            bind_founder(db, self.founder.id)
            grant_ownership(db, self.owner.id, self.founder.id)
        self.identity, self.token = login(request_for(), "Founder", "secure-password-123")
        self.request = request_for(cookie=f"rollthedice_session={self.token}", csrf=self.identity.csrf_token)

    def tearDown(self):
        asyncio.run(stop_cpu_runners())
        games.clear()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    def game(self, *, cpu_count=1, count=2, start_play=True):
        game = create_game_state("haus-test", "Kartentisch", str(count), "hausdepp")
        configure_hausdepp_game(game, host_user_id=self.founder.id, cpu_count=cpu_count)
        for index in range(count - cpu_count):
            account = self.founder if index == 0 else self.player
            join_hausdepp_player(game, {"id": f"human-{index}", "name": account.username,
                                      "user_id": account.id, "ws": RecordingSocket(), "resume_token": f"resume{index}"})
        # The live first dealer is random; tests pin the last seat.
        with patch("app.hausdepp_state._DEALER_RANDOM.randrange", return_value=count - 1):
            start_hausdepp_game(game)
        if start_play:
            while game["_hausdepp"]["phase"] == "peeking":
                state = game["_hausdepp"]
                game["_hausdepp"] = apply_action(state, state["current_player_id"], "peek", version=state["version"])
        return game

    def test_signed_in_accounts_can_create_discover_and_read_public_game_metadata(self):
        self.assertTrue(can_access_hausdepp(self.identity))
        req = main.CreateReq(name="Hausdepp", mode="2", game_type="hausdepp")
        created = asyncio.run(main.api_games_create(req, self.request))
        game_id = created["game_id"]
        self.assertEqual(games[game_id]["_expected_connections"], 1)
        self.assertEqual(games[game_id]["_participants"][0]["type"], "cpu")
        for account in (self.owner, self.admin, self.player):
            identity, token = login(request_for(), account.username, "secure-password-123")
            request = request_for(cookie=f"rollthedice_session={token}", csrf=identity.csrf_token)
            self.assertTrue(can_access_hausdepp(identity))
            self.assertTrue(asyncio.run(main.api_games(request, "hausdepp"))["games"])
            own = asyncio.run(main.api_games_create(req, request))
            self.assertEqual(games[own["game_id"]]["_hausdepp_host_user_id"], account.id)
            metadata = main.game_info(game_id, request)
            self.assertTrue(metadata["exists"])
            self.assertNotIn("_hausdepp", metadata)
        self.assertFalse(can_access_hausdepp(None))

    def test_player_counts_and_game_action_isolation(self):
        for count in range(2, 7):
            req = main.CreateReq(name="Hausdepp", mode=count, game_type="hausdepp")
            self.assertEqual(req.cpu_count, 1)
        for options in ({"mode": "1"}, {"mode": "2v2"}, {"mode": "2", "play_mode": "solo"},
                        {"mode": "2", "cpu_count": 2}, {"mode": "2", "hardcore": True}):
            with self.assertRaises(ValidationError):
                main.CreateReq(name="No", game_type="hausdepp", **options)
        with self.assertRaises(ValidationError):
            main.CreateReq(name="No", mode="6", game_type="zdwa")
        self.assertNotIn("roll_dice", gameplay_actions_for_game(self.game()))

    def test_projection_and_fanout_never_share_hands_stock_or_failed_peek(self):
        game = self.game(cpu_count=0)
        deck = make_deck()
        deck.remove("acorns-6")
        deck.append("acorns-6")
        game["_hausdepp"] = new_round(game["_participants"], dealer_index=1, deck=deck)
        state = game["_hausdepp"]
        game["_hausdepp"] = apply_action(state, "human-0", "peek", version=state["version"])
        spectator = RecordingSocket()
        game["_spectators"] = [{"id": "watcher", "name": "Viewer", "ws": spectator}]
        asyncio.run(broadcast(game, {"scoreboard": snapshot(game, "human-0")}))
        for index, player in enumerate(game["_players"]):
            projected = player["ws"].messages[-1]["scoreboard"]["_hausdepp"]
            self.assertEqual(projected["hand"], game["_hausdepp"]["players"][index]["hand"])
            self.assertNotIn("deck", projected)
            self.assertTrue(all("hand" not in seat for seat in projected["players"]))
            self.assertEqual(projected["private_peek"], ["acorns-6"] if index == 0 else [])
        public = spectator.messages[-1]["scoreboard"]["_hausdepp"]
        self.assertEqual(public["hand"], [])
        self.assertEqual(public["private_peek"], [])
        self.assertNotIn("cards", public["peek"])
        self.assertEqual(snapshot(game)["_hausdepp"]["hand"], [])
        metadata = main.game_info(game["_id"], self.request)
        self.assertNotIn("_hausdepp", metadata)
        self.assertNotIn("acorns-6", json.dumps(metadata))
        self.assertNotIn("acorns-6", json.dumps(asyncio.run(main.api_games(self.request, "hausdepp"))))

    def test_reconnect_restores_only_account_owned_hand_and_durable_private_state(self):
        async def scenario():
            game = self.game()
            original_hand = list(game["_hausdepp"]["players"][0]["hand"])
            save_active_game(game)
            restored = load_active_games()[game["_id"]]
            self.assertTrue(multiplayer_pause_reason(restored))
            self.assertFalse(cpu_action_is_due(restored))
            socket = RecordingSocket()
            session = GameSocketSession(socket, restored, self.identity)
            # The founder resumes its one durable account seat on another device.
            with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
                self.assertFalse(await handle_session_action(session, "join_game", {}))
            projected = socket.messages[-1]["scoreboard"]["_hausdepp"]
            self.assertEqual(projected["hand"], original_hand)
            self.assertEqual(projected["viewer_id"], "human-0")
            self.assertIsNone(multiplayer_pause_reason(restored))
            await disconnect_session(session)
            self.assertTrue(multiplayer_pause_reason(restored))
            self.assertFalse(cpu_action_is_due(restored))
            self.assertNotIn("_hausdepp_cpu_thinking", serializable_game_state(restored))
        asyncio.run(scenario())

    def test_cpu_actor_cannot_be_forged_or_joined(self):
        game = self.game()
        projection = project_state(game["_hausdepp"], "human-0")
        decision = choose_cpu_action(projection)
        with self.assertRaises(HausdeppRuleError):
            apply_hausdepp_command(game, "cpu-1", decision)
        with self.assertRaises(HausdeppRuleError):
            apply_hausdepp_command(game, "human-0", decision, trusted_cpu=True)
        with self.assertRaises(ValueError):
            join_hausdepp_player(game, {"id": "other", "name": "Other", "user_id": self.player.id})
        self.assertNotIn("cpu-1", {player["id"] for player in game["_players"]})
        self.assertIsNone(game["_participants"][-1]["user_id"])

    def test_real_cpu_completes_round_with_no_cross_game_points_or_awards(self):
        async def scenario():
            game = self.game()
            # A seeded round retains a real 36-card deck, both private hands,
            # refill, afterthrow, gamble and finish transitions throughout.
            import random

            game["_hausdepp"] = new_round(game["_participants"], dealer_index=1, rng=random.Random(27))
            for _ in range(5000):
                if game["_finished"]:
                    break
                decision = choose_cpu_action(project_state(game["_hausdepp"], "human-0"))
                if decision:
                    async with game_lock(game):
                        apply_hausdepp_command(game, "human-0", decision)
                maybe_schedule_cpu_turn(game, finalize_game=finalize_hausdepp_result)
                await asyncio.sleep(0)
            await stop_cpu_runners()
            self.assertTrue(game["_finished"])
            self.assertEqual(set(game["_results"]["finished_order"]) | {game["_results"]["loser_id"]},
                             {"human-0", "cpu-1"})
            self.assertTrue(finalize_hausdepp_result(game)["result_persisted"])
            payloads = list_hausdepp_results_for_user(self.founder.id)
            self.assertEqual(len(payloads), 1)
            self.assertNotIn("hand", json.dumps(payloads))
            self.assertNotIn("points", payloads[0])
            self.assertNotIn("achievement", json.dumps(payloads))
            with session_scope() as db:
                row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
                self.assertEqual(row.game_type, "hausdepp")
                seats = db.scalars(select(GameParticipant).where(GameParticipant.game_id == row.id)
                                   .order_by(GameParticipant.position)).all()
                self.assertEqual([seat.user_id for seat in seats], [self.founder.id, None])
        asyncio.run(scenario())

    def test_finished_human_can_leave_while_other_humans_continue(self):
        async def scenario():
            game = self.game(cpu_count=1, count=3)
            state = game["_hausdepp"]
            state["players"][0]["hand"] = []
            state["players"][0]["finished"] = True
            state["finished_order"] = ["human-0"]
            state["current_player_id"] = "cpu-1"
            session = GameSocketSession(game["_players"][0]["ws"], game, self.identity, player_id="human-0")
            await disconnect_session(session)
            self.assertIsNone(multiplayer_pause_reason(game))
            self.assertTrue(cpu_action_is_due(game))
            remaining = GameSocketSession(game["_players"][1]["ws"], game, None, player_id="human-1")
            await disconnect_session(remaining)
            self.assertTrue(multiplayer_pause_reason(game))
            self.assertFalse(cpu_action_is_due(game))
        asyncio.run(scenario())

    def test_manual_refill_is_one_private_socket_command_without_blocking_cpu_turn(self):
        async def scenario():
            game = self.game()
            state = game["_hausdepp"]
            state["current_player_id"] = "human-0"
            state["afterthrow"] = None
            state["discard"] = ["acorns-6"]
            state["players"][0]["hand"] = ["hearts-6", "bells-6", "hearts-10"]
            state["players"][1]["hand"] = ["hearts-K", "bells-K", "leaves-A"]
            used = set(state["discard"] + state["players"][0]["hand"] + state["players"][1]["hand"])
            state["deck"] = [card for card in make_deck() if card not in used]
            state["burned"] = []
            before_count = len(state["deck"])
            cpu_hand = list(state["players"][1]["hand"])
            socket = game["_players"][0]["ws"]
            session = GameSocketSession(socket, game, self.identity, player_id="human-0")
            with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
                await handle_hausdepp_gameplay_action(session, "hausdepp_play", {
                    "cards": ["hearts-6", "bells-6"], "version": state["version"],
                })
                pending = socket.messages[-1]["scoreboard"]["_hausdepp"]
                self.assertEqual(pending["hand"], ["hearts-10"])
                self.assertEqual(pending["deck_count"], before_count)
                self.assertEqual(pending["available_actions"], ["draw"])
                self.assertEqual(pending["pending_refill"]["player_id"], "human-0")
                self.assertTrue(cpu_action_is_due(game))
                await handle_hausdepp_gameplay_action(session, "hausdepp_draw", {
                    "version": pending["version"], "actor_id": "cpu-1",
                })
                filled = socket.messages[-1]["scoreboard"]["_hausdepp"]
                self.assertEqual(len(filled["hand"]), 3)
                self.assertEqual(filled["deck_count"], before_count - 2)
                self.assertIsNone(filled["pending_refill"])
                self.assertEqual(game["_hausdepp"]["players"][1]["hand"], cpu_hand)
                self.assertTrue(cpu_action_is_due(game))
                # A duplicate browser tap cannot draw again or advance a seat.
                version = filled["version"]
                await handle_hausdepp_gameplay_action(session, "hausdepp_draw", {"version": pending["version"]})
                self.assertEqual(game["_hausdepp"]["version"], version)
        asyncio.run(scenario())

    def test_active_human_peek_acknowledges_each_tap_and_rejection_restores_private_projection(self):
        async def scenario():
            game = self.game(start_play=False)
            deck = make_deck()
            for card in ("hearts-A", "bells-10"):
                deck.remove(card)
            deck.extend(["bells-10", "hearts-A"])
            game["_hausdepp"] = new_round(game["_participants"], dealer_index=1, deck=deck)
            socket = game["_players"][0]["ws"]
            session = GameSocketSession(socket, game, self.identity, player_id="human-0")
            with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn"):
                initial = game["_hausdepp"]["version"]
                await handle_hausdepp_gameplay_action(session, "hausdepp_gamble", {
                    "version": initial, "command_id": "too-soon",
                })
                rejected = socket.messages[-1]
                self.assertEqual(rejected["error_code"], "hausdepp_peek_required")
                self.assertFalse(rejected["hausdepp_command"]["accepted"])
                self.assertEqual(rejected["scoreboard"]["_hausdepp"]["available_actions"], ["peek"])
                await handle_hausdepp_gameplay_action(session, "hausdepp_peek", {
                    "version": initial, "command_id": "peek-one",
                })
                self.assertEqual(socket.messages[-1]["hausdepp_command"], {
                    "command_id": "peek-one", "accepted": True, "version": initial + 1,
                })
                own = socket.messages[-2]["scoreboard"]["_hausdepp"]
                self.assertEqual(own["private_peek"], ["hearts-A"])
                self.assertEqual(own["phase"], "peeking")
                self.assertEqual(snapshot(game)["_hausdepp"]["private_peek"], [])
                await handle_hausdepp_gameplay_action(session, "hausdepp_peek", {
                    "version": initial + 1, "command_id": "peek-two",
                })
                self.assertTrue(socket.messages[-1]["hausdepp_command"]["accepted"])
                dealt = socket.messages[-2]["scoreboard"]["_hausdepp"]
                self.assertEqual(dealt["phase"], "playing")
                self.assertEqual(dealt["peek"]["cards"], ["hearts-A", "bells-10"])
                self.assertTrue(dealt["deal"]["sequence"])
                self.assertNotIn("deck", dealt)
        asyncio.run(scenario())

    def test_cpu_peeker_taps_its_own_setup_before_cards_are_dealt(self):
        async def scenario():
            game = self.game(cpu_count=5, count=6, start_play=False)
            self.assertEqual(game["_hausdepp"]["peek_information"]["player_id"], "cpu-4")
            self.assertTrue(cpu_action_is_due(game))
            maybe_schedule_cpu_turn(game)
            for _ in range(30):
                await asyncio.sleep(0)
                if game["_hausdepp"]["phase"] == "playing":
                    break
            await stop_cpu_runners()
            self.assertEqual(game["_hausdepp"]["phase"], "playing")
            self.assertTrue(game["_hausdepp"]["peek_information"]["complete"])
            self.assertTrue(all(len(player["hand"]) >= 3 for player in game["_hausdepp"]["players"]))
        asyncio.run(scenario())

    def test_fifo_refill_debts_survive_persistence_and_remain_private_after_restart(self):
        game = self.game()
        state = game["_hausdepp"]
        state["current_player_id"] = "human-0"
        state["afterthrow"] = None
        state["discard"] = ["acorns-6"]
        state["players"][0]["hand"] = ["hearts-6", "bells-6", "hearts-10"]
        state["players"][1]["hand"] = ["hearts-7", "bells-7", "leaves-A"]
        used = set(state["discard"] + state["players"][0]["hand"] + state["players"][1]["hand"])
        state["deck"] = [card for card in make_deck() if card not in used]
        state["burned"] = []
        apply_hausdepp_command(game, "human-0", {"action": "play", "cards": ["hearts-6"], "version": state["version"]})
        apply_hausdepp_command(game, "cpu-1", {"action": "play", "cards": ["hearts-7"],
                                               "version": game["_hausdepp"]["version"]}, trusted_cpu=True)
        save_active_game(game)
        restored = load_active_games()[game["_id"]]
        self.assertEqual(list(restored["_hausdepp"]["pending_refills"]), ["human-0", "cpu-1"])
        cpu = project_state(restored["_hausdepp"], "cpu-1")
        self.assertEqual(cpu["stock_blocked_by"], "human-0")
        self.assertTrue(cpu["draw_required"])
        self.assertFalse(cpu["draw_urgent"])
        self.assertNotIn("draw", cpu["available_actions"])
        self.assertNotIn("deck", cpu)
        state = apply_action(restored["_hausdepp"], "human-0", "draw", version=restored["_hausdepp"]["version"])
        self.assertEqual(state["current_player_id"], "human-0")
        self.assertEqual(list(state["pending_refills"]), ["cpu-1"])
        self.assertTrue(project_state(state, "cpu-1")["draw_urgent"])
        self.assertIn("draw", project_state(state, "cpu-1")["available_actions"])

    def test_founder_product_pages_and_game_type_routes(self):
        game = self.game()
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", self.token)
            for path in ("/hausdepp", "/hausdepp/regeln", "/hausdepp/konto", f"/hausdepp/spiel/{game['_id']}",
                         f"/hausdepp/spiel/{game['_id']}/zuschauen"):
                response = client.get(path)
                self.assertEqual(response.status_code, 200, path)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual("noindex" in response.headers.get("x-robots-tag", ""), path not in {"/hausdepp", "/hausdepp/regeln"})
            account = client.get("/hausdepp/konto", follow_redirects=False)
            self.assertEqual(account.status_code, 200)
            self.assertIn('data-page="account"', account.text)
            legacy = client.get(f"/spiel/{game['_id']}", follow_redirects=False)
            self.assertEqual(legacy.headers["location"], f"/hausdepp/spiel/{game['_id']}")
            self.assertEqual(client.get(f"/zdwa/spiel/{game['_id']}",
                                        headers={"host": "zilch.zockdiewandan.online"}).status_code, 404)
            foreign = create_game_state("ordinary-zdwa", "Wuerfeltisch", "2", "zdwa")
            self.assertEqual(client.get(f"/hausdepp/spiel/{foreign['_id']}").status_code, 404)

    def test_auto_refill_preference_is_per_account_and_off_by_default(self):
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", self.token)
            self.assertFalse(client.get("/api/auth/me").json()["user"]["preferences"]["hausdepp_auto_refill"])
            path = "/api/auth/preferences/hausdepp"
            self.assertEqual(client.put(path, json={"hausdepp_auto_refill": True}).status_code, 403)
            headers = {"X-CSRF-Token": self.identity.csrf_token}
            response = client.put(path, json={"hausdepp_auto_refill": True}, headers=headers)
            self.assertEqual(response.json(), {"hausdepp_auto_refill": True})
            self.assertTrue(client.get("/api/auth/me").json()["user"]["preferences"]["hausdepp_auto_refill"])
            self.assertEqual(client.put(path, json={"hausdepp_auto_refill": "maybe"}, headers=headers).status_code, 422)
        with TestClient(main.app) as anonymous:
            self.assertEqual(anonymous.put(path, json={"hausdepp_auto_refill": True}).status_code, 401)

    def test_founder_account_api_is_personal_bounded_and_uncached(self):
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", self.token)
            response = client.get("/api/hausdepp/account")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers["cache-control"], "no-store")
            data = response.json()
            self.assertEqual(data["statistics"]["rounds_played"], 0)
            self.assertEqual(data["history"]["rounds"], [])
            self.assertTrue(data["scoring"]["available"])
            self.assertEqual(data["scoring"]["points"], 0)
            self.assertTrue(data["achievements"]["available"])
            self.assertEqual(len(data["achievements"]["items"]), 136)
            self.assertEqual(len(data["ranks"]), 24)
            for query in ("limit=0", "limit=31", "limit=abc"):
                self.assertEqual(client.get(f"/api/hausdepp/account?{query}").status_code, 422)
            invalid = client.get("/api/hausdepp/account?before=invalid-cursor")
            self.assertEqual(invalid.status_code, 400)
            self.assertEqual(invalid.json()["detail"], "hausdepp_invalid_cursor")

    def test_started_preview_emits_no_friend_activity_push_invites_or_admin_help(self):
        from app.admin_help import create_help_request, help_status
        from app.friend_activity import _recipient_payload
        from app.security import utcnow
        from app.web_push import game_invite_push_recipients, open_seat_invitation_error

        game = self.game()
        self.assertIsNone(_recipient_payload(game, self.identity, now=utcnow()))
        self.assertEqual(game_invite_push_recipients(game, sender_user_id=self.founder.id), [])
        self.assertEqual(open_seat_invitation_error(game, user_id=self.founder.id), "game_invite_not_waiting")
        self.assertFalse(help_status(self.founder.id, game["_id"])["can_request"])
        with self.assertRaises(HTTPException) as denied:
            create_help_request(game["_id"], self.founder.id)
        self.assertEqual(denied.exception.status_code, 404)

    def test_delayed_cpu_leaves_afterthrow_time_and_disconnect_cancels_then_resumes(self):
        async def scenario():
            game = self.game()
            state = game["_hausdepp"]
            state["current_player_id"] = "cpu-1"
            state["afterthrow"] = {"player_id": "human-0", "rank": "U"}
            state["discard"] = ["hearts-U"]
            state["players"][0]["hand"] = ["bells-U", "acorns-6", "leaves-10", "bells-7"]
            state["players"][1]["hand"] = ["hearts-K", "acorns-K", "hearts-10"]
            used = set(state["discard"] + state["players"][0]["hand"] + state["players"][1]["hand"])
            state["deck"] = [card for card in make_deck() if card not in used]
            state["burned"] = []
            with patch.dict(os.environ, {"ROLLTHEDICE_HAUSDEPP_CPU_DELAY_SECONDS": "0.06"}):
                version = state["version"]
                maybe_schedule_cpu_turn(game)
                await asyncio.sleep(0.01)
                self.assertEqual(game["_hausdepp"]["version"], version)
                async with game_lock(game):
                    apply_hausdepp_command(game, "human-0", {"action": "afterthrow", "cards": ["bells-U"],
                                                            "version": version})
                self.assertEqual(game["_hausdepp"]["version"], version + 1)
                session = GameSocketSession(game["_players"][0]["ws"], game, self.identity, player_id="human-0")
                await disconnect_session(session)
                await asyncio.sleep(0.07)
                self.assertEqual(game["_hausdepp"]["version"], version + 1)
                rejoined = GameSocketSession(RecordingSocket(), game, self.identity)
                await handle_session_action(rejoined, "join_game", {})
                await asyncio.sleep(0.09)
                self.assertGreater(game["_hausdepp"]["version"], version + 1)
                await stop_cpu_runners()
        asyncio.run(scenario())

    def test_guest_is_limited_to_public_documents_and_signed_in_spectators_keep_cards_private(self):
        game = self.game()
        save_active_game(game)
        with TestClient(main.app) as client:
            guest_page = client.get("/hausdepp", follow_redirects=False)
            self.assertEqual(guest_page.status_code, 200)
            self.assertEqual(guest_page.headers["cache-control"], "no-store")
            self.assertNotIn("noindex", guest_page.headers.get("x-robots-tag", ""))
            guest_account = client.get("/hausdepp/konto", follow_redirects=False)
            self.assertEqual(guest_account.status_code, 303)
            self.assertIn("return_to=%2Fhausdepp%2Fkonto", guest_account.headers["location"])
            self.assertEqual(client.get("/api/hausdepp/account").status_code, 401)
            with self.assertRaises(WebSocketDisconnect) as denied:
                with client.websocket_connect(f"/ws/{game['_id']}"):
                    self.fail("Guest must not receive a frame")
            self.assertEqual(denied.exception.code, 1008)
            for account in (self.owner, self.admin, self.player):
                _identity, token = login(request_for(), account.username, "secure-password-123")
                client.cookies.set("rollthedice_session", token)
                for path in ("/hausdepp", "/hausdepp/regeln", "/hausdepp/konto", f"/hausdepp/spiel/{game['_id']}"):
                    self.assertEqual(client.get(path).status_code, 200)
                self.assertEqual(client.get("/api/hausdepp/results").json(), {"results": []})
                self.assertEqual(client.get("/api/hausdepp/account").status_code, 200)
                with client.websocket_connect(f"/ws/{game['_id']}") as socket:
                    socket.send_json({"action": "spectate_game", "name": account.username})
                    message = socket.receive_json()
                    while "scoreboard" not in message:
                        message = socket.receive_json()
                    projected = message["scoreboard"]["_hausdepp"]
                    self.assertEqual(projected["hand"], [])
                    self.assertEqual(projected["private_peek"], [])
                    self.assertNotIn("deck", projected)
            for path in ("/static/hausdepp.html", "/static/hausdepp-lobby.html", "/static/hausdepp-rules.html",
                         "/static/hausdepp-account.html"):
                self.assertEqual(client.get(path).status_code, 404)

    def test_private_static_document_aliases_are_blocked_for_guest_and_admin(self):
        with TestClient(main.app) as client:
            for account in (None, self.admin):
                client.cookies.clear()
                if account:
                    _identity, token = login(request_for(), account.username, "secure-password-123")
                    client.cookies.set("rollthedice_session", token)
                for filename in ("hausdepp.html", "hausdepp-lobby.html", "hausdepp-rules.html", "hausdepp-account.html"):
                    for path in (
                        f"/static/{filename}",
                        f"/static//{filename}",
                        f"/static/%2e/{filename}",
                        f"/static/folder/%2e%2e/{filename}",
                        f"/static/{filename.upper()}",
                    ):
                        with self.subTest(account=account.username if account else "guest", path=path):
                            response = client.get(path, follow_redirects=False)
                            self.assertEqual(response.status_code, 404)
                            self.assertEqual(response.content, b"")
                            self.assertEqual(response.headers["cache-control"], "no-store")
                            self.assertIn("noindex", response.headers["x-robots-tag"])


if __name__ == "__main__":
    unittest.main()
