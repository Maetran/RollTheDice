"""Legacy room lifecycle fence and exact-account admission before account merge."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
import threading
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import game_lifecycle, game_state, main
from app.active_games import delete_active_game, save_active_game, serializable_game_state
from app.auth import create_user, login
from app.database import configure_database, session_scope, upgrade_database
from app.game_history import persist_runtime_game_result
from app.game_lifecycle import (
    AdmissionError,
    admit_player,
    bind_room,
    bound_revision,
    commit_room_binding,
    discard_new_room,
)
from app.game_results import finalize_and_log_results
from app.game_state import check_timeout_and_abort, games, new_game
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession, handle_session_action
from app.hausdepp_state import configure_hausdepp_game, new_hausdepp_game
from app.models import ActiveGame, CompletedGame, GameAccountMembership, User
from app.zilch_state import configure_zilch_solo_game, new_zilch_game
from tests.test_hausdepp_integration import RecordingSocket
from tests.test_user_accounts import request_for

PASSWORD = "secure-password-123"
GATE_SECONDS = 10


class QueuedSocket(RecordingSocket):
    """A recording socket that delivers queued client frames, then disconnects."""

    def __init__(self, frames=()):
        super().__init__()
        self.frames = list(frames)

    async def receive_json(self):
        if not self.frames:
            raise WebSocketDisconnect()
        return self.frames.pop(0)


class AccountMergeAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {
            "ROLLTHEDICE_DATABASE_URL": f"sqlite:///{self.temp.name}/admission.sqlite3",
            "ROLLTHEDICE_COOKIE_DOMAIN": "", "ROLLTHEDICE_COOKIE_SECURE": "0",
            "ROLLTHEDICE_TURNSTILE_SITE_KEY": "", "ROLLTHEDICE_TURNSTILE_SECRET": "",
            "ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES": "fencehost",
        })
        self.env.start()
        self.registry = patch.dict(games, clear=True)
        self.registry.start()
        configure_database(Path(self.temp.name))
        upgrade_database(main.BASE)
        self.accounts = [create_user(name, PASSWORD, must_change_password=False)
                         for name in ("fencehost", "FenceFriend")]
        self.logins = [login(request_for(), user.username, PASSWORD) for user in self.accounts]
        self.identities = [identity for identity, _token in self.logins]

    def tearDown(self):
        game_state._after_timeout_observation = None
        game_lifecycle._before_admission_commit = None
        self.registry.stop()
        self.env.stop()
        configure_database(main.DATA_DIR)
        self.temp.cleanup()

    # -- helpers -----------------------------------------------------------

    def seat(self, index, *, ws=None, player_id=None):
        account = self.accounts[index]
        return {"id": player_id or f"seat-{index}", "name": account.username, "user_id": account.id,
                "ws": ws, "resume_token": f"token-{index}"}

    def row(self, game_id):
        with session_scope() as db:
            stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == game_id))
            return None if stored is None else (json.loads(stored.state_json), stored.admission_revision)

    def members(self, game_id):
        with session_scope() as db:
            return set(db.scalars(select(GameAccountMembership.user_id)
                                  .where(GameAccountMembership.game_id == game_id)))

    def deactivate(self, index):
        with session_scope() as db:
            db.get(User, self.accounts[index].id).is_active = False

    def waiting_zdwa(self, game_id, *, idle=timedelta(minutes=50)):
        game = new_game(game_id, "Fence", 2)
        game["_last_activity"] = datetime.now(timezone.utc) - idle
        save_active_game(game)
        self.assertEqual(bound_revision(game), 0)
        return game

    def run_thread(self, name, target):
        done = threading.Event()
        outcome = {}

        def body():
            try:
                outcome["value"] = target()
            except AdmissionError as exc:
                outcome["error"] = exc.code
            finally:
                done.set()

        thread = threading.Thread(target=body, name=name, daemon=True)
        thread.start()
        return thread, done, outcome

    # -- timeout observation vs. admission ---------------------------------

    def test_timeout_that_observed_old_clock_first_aborts_and_admission_is_then_rejected(self):
        game = self.waiting_zdwa("fence-timeout-first")
        observed, release = threading.Event(), threading.Event()

        def pause_observer(_game):
            if threading.current_thread().name == "timeout-observer":
                observed.set()
                self.assertTrue(release.wait(GATE_SECONDS))

        game_state._after_timeout_observation = pause_observer
        later = datetime.now(timezone.utc) + timedelta(minutes=15)
        timeout, timeout_done, timeout_outcome = self.run_thread(
            "timeout-observer", lambda: check_timeout_and_abort(game, now=later))
        self.assertTrue(observed.wait(GATE_SECONDS))
        admission, admission_done, admission_outcome = self.run_thread(
            "admission", lambda: admit_player(game, self.seat(0)))
        # The observer holds the room fence: the admission cannot interleave.
        self.assertFalse(admission_done.is_set())
        release.set()
        timeout.join(GATE_SECONDS)
        admission.join(GATE_SECONDS)
        self.assertTrue(timeout_done.is_set() and admission_done.is_set())

        self.assertIs(timeout_outcome["value"], True)
        self.assertEqual(admission_outcome["error"], "Spiel ist bereits beendet")
        self.assertTrue(game["_aborted"])
        self.assertEqual(game["_players"], [])
        self.assertIsNone(self.row(game["_id"]))
        self.assertEqual(self.members(game["_id"]), set())

    def test_admission_first_renews_the_clock_so_a_waiting_timeout_does_not_abort(self):
        game = self.waiting_zdwa("fence-admission-first")
        entered, release = threading.Event(), threading.Event()

        def pause_admission(_game):
            entered.set()
            self.assertTrue(release.wait(GATE_SECONDS))

        game_lifecycle._before_admission_commit = pause_admission
        admission, admission_done, admission_outcome = self.run_thread(
            "admission", lambda: admit_player(game, self.seat(0)))
        self.assertTrue(entered.wait(GATE_SECONDS))
        later = datetime.now(timezone.utc) + timedelta(minutes=15)
        timeout, timeout_done, timeout_outcome = self.run_thread(
            "timeout-observer", lambda: check_timeout_and_abort(game, now=later))
        self.assertFalse(timeout_done.is_set())
        release.set()
        admission.join(GATE_SECONDS)
        timeout.join(GATE_SECONDS)
        self.assertTrue(timeout_done.is_set() and admission_done.is_set())

        self.assertNotIn("error", admission_outcome)
        self.assertIs(timeout_outcome["value"], False)
        self.assertFalse(game.get("_aborted"))
        self.assertEqual([player["id"] for player in game["_players"]], ["seat-0"])
        state, revision = self.row(game["_id"])
        self.assertEqual([player["id"] for player in state["_players"]], ["seat-0"])
        self.assertEqual(revision, 1)
        self.assertEqual(bound_revision(game), 1)
        self.assertNotIn("_active_row", state)
        self.assertEqual(self.members(game["_id"]), {self.accounts[0].id})

    # -- stale checkpoints and terminal rows -------------------------------

    def stale_copy(self, game):
        stale = json.loads(json.dumps(serializable_game_state(game)))
        bind_room(stale, game["_id"], bound_revision(game))
        return stale

    def test_stale_prejoin_checkpoint_cannot_erase_an_accepted_admission(self):
        game = self.waiting_zdwa("fence-stale")
        stale = self.stale_copy(game)
        admit_player(game, self.seat(0))
        stale["_chat_history"] = [{"sender": "old", "text": "written before the join"}]
        save_active_game(stale)

        state, revision = self.row(game["_id"])
        self.assertEqual([player["id"] for player in state["_players"]], ["seat-0"])
        self.assertEqual(state["_chat_history"], [])
        self.assertEqual(revision, 1)
        self.assertEqual(self.members(game["_id"]), {self.accounts[0].id})
        # The live, current object still checkpoints normally.
        game["_chat_history"] = [{"sender": "FenceHost", "text": "current"}]
        save_active_game(game)
        self.assertEqual(self.row(game["_id"])[0]["_chat_history"][0]["text"], "current")

    def test_terminal_delete_is_not_resurrected_by_an_old_checkpoint(self):
        game = self.waiting_zdwa("fence-terminal")
        admit_player(game, self.seat(0))
        stale = self.stale_copy(game)
        game.update(_aborted=True, _finished=True, _abandonment_accounted=True)
        save_active_game(game)
        self.assertIsNone(self.row(game["_id"]))
        self.assertEqual(self.members(game["_id"]), set())

        save_active_game(stale)
        save_active_game(game)
        self.assertIsNone(self.row(game["_id"]))

    def test_existing_room_admission_after_its_row_was_retired_is_rejected(self):
        game = self.waiting_zdwa("fence-missing")
        delete_active_game(game["_id"])
        self.assertIsNone(self.row(game["_id"]))

        with self.assertRaises(AdmissionError) as raised:
            admit_player(game, self.seat(0))
        self.assertEqual(raised.exception.code, "admission_room_changed")
        self.assertEqual(game["_players"], [])
        self.assertIsNone(self.row(game["_id"]))
        self.assertEqual(self.members(game["_id"]), set())
        # The retired row stays retired for ordinary checkpoints too.
        save_active_game(game)
        self.assertIsNone(self.row(game["_id"]))

    def test_unbound_json_copy_after_terminal_delete_can_neither_save_nor_admit(self):
        game = self.waiting_zdwa("fence-copy-terminal")
        admit_player(game, self.seat(0))
        copy = json.loads(json.dumps(serializable_game_state(game)))
        self.assertIsNone(bound_revision(copy))
        game.update(_aborted=True, _finished=True, _abandonment_accounted=True)
        save_active_game(game)
        self.assertIsNone(self.row(game["_id"]))

        save_active_game(copy)
        self.assertIsNone(self.row(game["_id"]))
        with self.assertRaises(AdmissionError) as raised:
            admit_player(copy, self.seat(1))
        self.assertEqual(raised.exception.code, "admission_room_unbound")
        self.assertEqual([player["id"] for player in copy["_players"]], ["seat-0"])
        self.assertIsNone(self.row(game["_id"]))
        self.assertEqual(self.members(game["_id"]), set())

    def test_unbound_copy_cannot_claim_an_existing_row(self):
        game = self.waiting_zdwa("fence-copy-claim")
        copy = json.loads(json.dumps(serializable_game_state(game)))
        copy["_chat_history"] = [{"sender": "copy", "text": "not authoritative"}]
        save_active_game(copy)
        with self.assertRaises(AdmissionError) as raised:
            admit_player(copy, self.seat(0))

        self.assertEqual(raised.exception.code, "admission_room_unbound")
        state, revision = self.row(game["_id"])
        self.assertEqual((state["_chat_history"], state["_players"], revision), ([], [], 0))
        self.assertEqual(self.members(game["_id"]), set())

    def test_failed_hausdepp_autostart_admission_leaves_the_live_room_untouched(self):
        game = new_hausdepp_game("fence-hd-candidate", "Fence", "2")
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=0)
        save_active_game(game)
        admit_player(game, self.seat(0))
        host_seat, host_before = game["_players"][0], dict(game["_players"][0])
        before = json.dumps(serializable_game_state(game), sort_keys=True)
        failure = OperationalError("INSERT game_account_memberships", {}, Exception("database unavailable"))
        with patch("app.game_lifecycle._add_memberships", side_effect=failure):
            with self.assertRaises(AdmissionError) as raised:
                # The second human fills the table: the candidate deals a round.
                admit_player(game, self.seat(1))

        self.assertEqual(raised.exception.code, "admission_storage_unavailable")
        self.assertEqual(json.dumps(serializable_game_state(game), sort_keys=True), before)
        self.assertFalse(game["_started"])
        self.assertIsNone(game["_hausdepp"])
        self.assertNotIn("_hausdepp_experience", game)
        self.assertIs(game["_players"][0], host_seat)
        self.assertEqual(game["_players"][0], host_before)
        state, revision = self.row(game["_id"])
        self.assertEqual(([player["id"] for player in state["_players"]], revision), (["seat-0"], 1))
        self.assertEqual(self.members(game["_id"]), {self.accounts[0].id})

    # -- socket admission ---------------------------------------------------

    def test_storage_failure_leaves_ram_session_and_ack_unchanged(self):
        game = self.waiting_zdwa("fence-storage")
        socket = RecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=self.identities[0])
        failure = OperationalError("UPDATE active_games", {}, Exception("database unavailable"))
        with patch("app.database.session_scope", side_effect=failure):
            closed = asyncio.run(handle_session_action(session, "join_game", {"name": "ignored"}))

        self.assertTrue(closed)
        self.assertTrue(socket.closed)
        self.assertFalse(any("player_id" in message for message in socket.messages))
        self.assertEqual(socket.messages[-1]["error_code"], "admission_storage_unavailable")
        self.assertIsNone(session.player_id)
        self.assertIs(session.auth_identity, self.identities[0])
        self.assertEqual(game["_players"], [])
        self.assertEqual(game["_scoreboards"], {})
        state, revision = self.row(game["_id"])
        self.assertEqual((state["_players"], revision), ([], 0))
        self.assertEqual(self.members(game["_id"]), set())

    def test_inactive_account_join_is_rejected_without_a_seat(self):
        game = self.waiting_zdwa("fence-inactive-join")
        self.deactivate(0)
        socket = RecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=self.identities[0])
        self.assertTrue(asyncio.run(handle_session_action(session, "join_game", {})))

        self.assertEqual(socket.messages[-1]["error_code"], "account_retired_or_inactive")
        self.assertIsNone(session.player_id)
        self.assertEqual(game["_players"], [])
        self.assertEqual(self.row(game["_id"])[1], 0)
        self.assertEqual(self.members(game["_id"]), set())

    def test_inactive_account_rejoin_does_not_rebind_its_seat(self):
        game = self.waiting_zdwa("fence-inactive-rejoin")
        admit_player(game, self.seat(0))
        self.deactivate(0)
        socket = RecordingSocket()
        session = GameSocketSession(websocket=socket, game=game, auth_identity=self.identities[0])
        closed = asyncio.run(handle_session_action(
            session, "rejoin_game", {"player_id": "seat-0", "resume_token": "token-0"}))

        self.assertTrue(closed)
        self.assertEqual(socket.messages[-1]["error_code"], "account_retired_or_inactive")
        self.assertIsNone(session.player_id)
        self.assertIsNone(game["_players"][0]["ws"])

    def test_cached_zdwa_identity_of_a_deactivated_account_is_closed_not_downgraded(self):
        game = self.waiting_zdwa("fence-cached")
        socket = QueuedSocket([{"action": "roll_dice"}])
        admit_player(game, self.seat(0, ws=socket))
        admit_player(game, self.seat(1))
        self.assertTrue(game["_started"])
        session = GameSocketSession(websocket=socket, game=game, auth_identity=self.identities[0],
                                    player_id="seat-0")
        self.deactivate(0)
        # A deactivated or retired account has no current session.
        with patch("app.game_websocket.resolve_session", return_value=None):
            asyncio.run(_receive_messages(session, limiter=MessageRateLimiter(), finalize_game=None))

        self.assertTrue(socket.closed)
        self.assertEqual(socket.messages[-1]["error_code"], "account_retired_or_inactive")
        self.assertIs(session.auth_identity, self.identities[0])
        self.assertEqual(game["_rolls_used"], 0)
        self.assertEqual(game["_dice"], [0, 0, 0, 0, 0])

    # -- strict host-bound creation -----------------------------------------

    def test_hausdepp_host_binding_failure_leaves_no_registry_row_or_membership(self):
        game = new_hausdepp_game("fence-hd-create", "Fence", "2", register=False)
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=1)
        self.deactivate(0)
        with self.assertRaises(AdmissionError) as raised:
            commit_room_binding(game, [self.accounts[0].id])
        discard_new_room(game)

        self.assertEqual(raised.exception.code, "account_retired_or_inactive")
        self.assertNotIn("fence-hd-create", games)
        self.assertIsNone(self.row("fence-hd-create"))
        self.assertEqual(self.members("fence-hd-create"), set())

    def test_hausdepp_host_binding_commits_row_and_exact_membership(self):
        game = new_hausdepp_game("fence-hd-bound", "Fence", "2", register=False)
        configure_hausdepp_game(game, host_user_id=self.accounts[0].id, cpu_count=1)
        commit_room_binding(game, [self.accounts[0].id])

        state, revision = self.row("fence-hd-bound")
        self.assertEqual((state["_hausdepp_host_user_id"], revision), (self.accounts[0].id, 0))
        self.assertEqual(self.members("fence-hd-bound"), {self.accounts[0].id})

    def test_zilch_solo_host_binding_storage_failure_is_rolled_back(self):
        game = new_zilch_game("fence-zilch-solo", "Fence", "1")
        configure_zilch_solo_game(game, host_user_id=self.accounts[0].id)
        self.assertIn("fence-zilch-solo", games)
        failure = OperationalError("UPDATE active_games", {}, Exception("database unavailable"))
        with patch("app.database.session_scope", side_effect=failure):
            with self.assertRaises(AdmissionError) as raised:
                commit_room_binding(game, [self.accounts[0].id])
        discard_new_room(game)

        self.assertEqual(raised.exception.code, "admission_storage_unavailable")
        self.assertNotIn("fence-zilch-solo", games)
        self.assertIsNone(self.row("fence-zilch-solo"))
        self.assertEqual(self.members("fence-zilch-solo"), set())
        save_active_game(game)
        self.assertIsNone(self.row("fence-zilch-solo"))

    def assert_http_creation_rolled_back(self, payload):
        identity, token = self.logins[0]
        failure = OperationalError("INSERT game_account_memberships", {}, Exception("database unavailable"))
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", token)
            before = set(games)
            with patch("app.main.enforce_game_creation_rate_limit"), \
                    patch("app.game_lifecycle._add_memberships", side_effect=failure):
                created = client.post("/api/games", json=payload, headers={"x-csrf-token": identity.csrf_token})
            self.assertEqual(created.status_code, 503, created.text)
            self.assertEqual(created.json()["detail"], "admission_storage_unavailable")
            self.assertEqual(set(games), before)
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(ActiveGame)), 0)
            self.assertEqual(db.scalar(select(func.count()).select_from(GameAccountMembership)), 0)

    def test_http_hausdepp_creation_persistence_failure_leaves_no_room(self):
        self.assert_http_creation_rolled_back({
            "name": "Fence table", "mode": "2", "game_type": "hausdepp",
            "play_mode": "cpu", "cpu_count": 1,
        })

    def test_http_zilch_solo_creation_persistence_failure_leaves_no_room(self):
        self.assert_http_creation_rolled_back({
            "name": "Solo Sprint", "mode": "1", "game_type": "zilch", "play_mode": "solo",
        })

    def test_http_hausdepp_creation_commits_room_and_host_membership(self):
        identity, token = self.logins[0]
        with TestClient(main.app) as client:
            client.cookies.set("rollthedice_session", token)
            with patch("app.main.enforce_game_creation_rate_limit"):
                created = client.post("/api/games", json={
                    "name": "Fence table", "mode": "2", "game_type": "hausdepp",
                    "play_mode": "cpu", "cpu_count": 1,
                }, headers={"x-csrf-token": identity.csrf_token})
            self.assertEqual(created.status_code, 200, created.text)
            game_id = created.json()["game_id"]
            self.assertIn(game_id, games)
            self.assertEqual(bound_revision(games[game_id]), 0)
        self.assertEqual(self.row(game_id)[1], 0)
        self.assertEqual(self.members(game_id), {self.accounts[0].id})

    # -- aborted ZDWA finalizer ---------------------------------------------

    def test_aborted_zdwa_room_reaching_its_finalizers_persists_no_credit(self):
        game = self.waiting_zdwa("fence-aborted-result")
        admit_player(game, self.seat(0))
        admit_player(game, self.seat(1))
        game.update(_aborted=True, _finished=True, _abort_reason="manual")

        outcome = finalize_and_log_results(None, game)
        self.assertEqual(outcome, {"achievement_unlocks": {}, "achievement_rank_ups": {}})
        written = persist_runtime_game_result(game, {"seat-0": 10, "seat-1": 5}, {"game_id": game["_id"]})
        self.assertEqual((written.status, written.reason), ("failed", "aborted_game"))
        with session_scope() as db:
            self.assertEqual(db.scalar(select(func.count()).select_from(CompletedGame)), 0)
        self.assertFalse(game.get("_completion_persisted"))


if __name__ == "__main__":
    unittest.main()
