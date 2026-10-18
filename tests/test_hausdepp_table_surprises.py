"""Room effects must stay rare, authorized and outside the card transition."""

from __future__ import annotations

import asyncio
import json
import unittest
from copy import deepcopy
from functools import lru_cache
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from starlette.websockets import WebSocketDisconnect

from app.active_games import serializable_game_state
from app.game_snapshot import snapshot
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession
from app.hausdepp_engine import apply_action, make_deck, new_round
from app.hausdepp_gameplay import game_lock
from app.hausdepp_state import new_hausdepp_game
from app.hausdepp_surprise_collection import surprise_collection_evidence
from app.hausdepp_table_surprises import (
    _eligible_effect,
    handle_table_surprise,
    table_effects_projection,
    table_surprise_offer,
)

ELIGIBLE_IDS = {
    "star": "surprise-180", "hammer": "surprise-587", "ufo": "surprise-22", "portal": "surprise-271",
    "dragon": "surprise-91", "kraken": "surprise-631", "clock": "surprise-416", "blackhole": "surprise-11",
}


class RecordingSocket:
    def __init__(self, incoming=()):
        self.messages = []
        self.incoming = list(incoming)

    async def send_json(self, message):
        json.dumps(message)
        self.messages.append(message)

    async def receive_json(self):
        if self.incoming:
            return self.incoming.pop(0)
        raise WebSocketDisconnect()


@lru_cache(maxsize=32)
def eligible_game_id(effect: str, round_number: int = 1) -> str:
    return next(f"surprise-{number}" for number in range(20_000)
                if _eligible_effect(f"surprise-{number}", round_number) == effect)


class HausdeppTableSurpriseTests(unittest.TestCase):
    def setUp(self):
        # Focused in-memory socket tests must not touch a developer's database.
        self.persistence = patch("app.game_realtime.save_active_game")
        self.save = self.persistence.start()
        self.addCleanup(self.persistence.stop)

    def game(self, *, effect="star", round_number=1):
        game_id = eligible_game_id(effect, round_number)
        game = new_hausdepp_game(game_id, "Table", 2, register=False)
        game["_players"] = [{"id": f"p{index}", "name": f"Player {index}", "user_id": index,
                              "ws": RecordingSocket()} for index in (1, 2)]
        game["_participants"] = [{"id": player["id"], "name": player["name"], "user_id": player["user_id"],
                                   "type": "human", "is_cpu": False, "connection_player_id": player["id"]}
                                  for player in game["_players"]]
        state = new_round(game["_participants"], deck=make_deck())
        while state["phase"] == "peeking":
            state = apply_action(state, state["current_player_id"], "peek", version=state["version"])
        game.update(_started=True, _hausdepp=state, _turn={"player_id": state["current_player_id"]},
                    _hausdepp_presentation_until=123.5, _hausdepp_cpu_thinking=True)
        if round_number != 1:
            game["_hausdepp_tournament"] = {"round_number": round_number}
        return game

    @staticmethod
    def session(game, player=0):
        person = game["_players"][player]
        return GameSocketSession(person["ws"], game, None, player_id=person["id"])

    def test_offer_is_deterministic_shared_and_uses_fixed_eligible_variant_fixtures(self):
        for effect, game_id in ELIGIBLE_IDS.items():
            self.assertEqual(eligible_game_id(effect), game_id)
            game = self.game(effect=effect)
            expected = {"round_number": 1, "effect": effect}
            self.assertEqual(table_surprise_offer(game, "p1"), expected)
            self.assertEqual(table_surprise_offer(game, "p2"), expected)
            self.assertEqual(table_surprise_offer(deepcopy(game), "p1"), expected)
            self.assertNotIn("_hausdepp_table_surprise_claim", game)
            self.assertEqual(table_effects_projection(game), {"scorched_cards": False})
            self.assertTrue(all(not person["ws"].messages for person in game["_players"]))
        self.save.assert_not_called()

    def test_rarity_decision_precedes_separate_equal_eight_way_variant_draw(self):
        def digest(value):
            return SimpleNamespace(digest=lambda: value.to_bytes(32, "big"))

        for chance in (1, 49, 51, 99, 2 ** 256 - 1):
            with self.subTest(ineligible_chance=chance), \
                    patch("app.hausdepp_table_surprises.sha256", return_value=digest(chance)) as hashes:
                self.assertIsNone(_eligible_effect("fixed-table", 7))
                hashes.assert_called_once_with(b"hausdepp-table-surprise:eligibility:v1:fixed-table:7")
        for chance in (0, 50, 100):
            for index, effect in enumerate(ELIGIBLE_IDS):
                with self.subTest(eligible_chance=chance, variant=effect), \
                        patch("app.hausdepp_table_surprises.sha256",
                              side_effect=[digest(chance), digest(index + 8)]) as hashes:
                    self.assertEqual(_eligible_effect("fixed-table", 7), effect)
                    self.assertEqual(hashes.call_count, 2)
                    self.assertEqual(hashes.call_args_list[0].args,
                                     (b"hausdepp-table-surprise:eligibility:v1:fixed-table:7",))
                    self.assertEqual(hashes.call_args_list[1].args,
                                     (b"hausdepp-table-surprise:variant:v1:fixed-table:7",))

    def test_real_claim_persists_private_collection_without_replaying_it_to_viewers(self):
        game = self.game(effect="clock")
        engine = deepcopy(game["_hausdepp"])
        game["_spectators"] = [{"id": "spectator", "ws": RecordingSocket()}]
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "clock", "round_number": 1}))
        expected = {"p1": {"activated": ["clock"], "witnessed": ["clock"]},
                    "p2": {"activated": [], "witnessed": ["clock"]}}
        self.assertEqual(surprise_collection_evidence(game, 1), expected)
        self.assertEqual(game["_hausdepp"], engine)
        restored = serializable_game_state(game)
        self.assertEqual(surprise_collection_evidence(restored, 1), expected)
        for viewer in ("p1", "p2", None):
            public = json.dumps(snapshot(game, viewer))
            self.assertNotIn("_hausdepp_surprise_collection", public)
            self.assertNotIn("witnessed", public)
        for person in [*game["_players"], *game["_spectators"]]:
            self.assertNotIn("witnessed", json.dumps(person["ws"].messages))
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "clock", "round_number": 1}))
        self.assertEqual(surprise_collection_evidence(game, 1), expected)

    def test_browser_cannot_supply_collection_credit_or_spoof_the_activator(self):
        game = self.game()
        session = self.session(game)
        forged = {"actor_id": "p2", "table_surprises": {"activated": ["blackhole"], "witnessed": ["blackhole"]}}
        asyncio.run(handle_table_surprise(session, {**forged, "effect": "forged", "round_number": 1}))
        self.assertEqual(surprise_collection_evidence(game, 1), {})
        asyncio.run(handle_table_surprise(session, {**forged, "effect": "star", "round_number": 1}))
        self.assertEqual(surprise_collection_evidence(game, 1), {
            "p1": {"activated": ["star"], "witnessed": ["star"]},
            "p2": {"activated": [], "witnessed": ["star"]},
        })

    def test_solo_cpu_table_can_play_the_surprise_without_collection_credit(self):
        game = self.game(effect="hammer")
        game["_participants"][1].update(is_cpu=True, type="cpu", user_id=None)
        engine = deepcopy(game["_hausdepp"])
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "hammer", "round_number": 1}))
        self.assertIn("hausdepp_table_surprise", game["_players"][0]["ws"].messages[-1])
        self.assertEqual(surprise_collection_evidence(game, 1), {})
        self.assertEqual(game["_hausdepp"], engine)

    def test_snapshot_offer_belongs_to_participants_and_never_replays_an_event(self):
        game = self.game()
        self.assertEqual(snapshot(game, "p1")["_hausdepp_table_surprises"]["effect"], "star")
        for viewer in (None, "watcher", "cpu-fake"):
            self.assertEqual(snapshot(game, viewer)["_hausdepp_table_surprises"]["effect"], None)
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "star", "round_number": 1}))
        for viewer in ("p1", "p2", None):
            projection = snapshot(game, viewer)
            self.assertIsNone(projection["_hausdepp_table_surprises"]["effect"])
            self.assertNotIn("hausdepp_table_surprise", projection)
        restored = serializable_game_state(game)
        self.assertNotIn("actor_id", json.dumps(restored))
        for player in restored["_players"]:
            player["ws"] = RecordingSocket()
        self.assertIsNone(table_surprise_offer(restored, "p1")["effect"])

    def test_each_effect_broadcasts_one_shared_event_without_touching_gameplay(self):
        for effect in ELIGIBLE_IDS:
            with self.subTest(effect=effect):
                game = self.game(effect=effect)
                observer = RecordingSocket()
                game["_spectators"] = [{"id": "viewer", "ws": observer}]
                before = {key: deepcopy(value) for key, value in game.items()
                          if key not in {"_players", "_spectators"}}
                with patch("app.hausdepp_cpu_runner.maybe_schedule_cpu_turn") as schedule:
                    asyncio.run(handle_table_surprise(self.session(game),
                                                     {"effect": effect, "actor_id": "fake", "round_number": 1}))
                schedule.assert_not_called()
                message = game["_players"][0]["ws"].messages[-1]
                event = message["hausdepp_table_surprise"]
                self.assertEqual(event["effect"], effect)
                self.assertEqual(event["actor_id"], "p1")
                self.assertEqual(event["game_id"], game["_id"])
                self.assertEqual(event["round_number"], 1)
                self.assertEqual(len(event["id"]), 32)
                self.assertNotIn("scoreboard", message)
                self.assertNotIn("version", event)
                self.assertEqual(message["hausdepp_table_effects"], {"scorched_cards": effect == "dragon"})
                self.assertEqual(message, game["_players"][1]["ws"].messages[-1])
                self.assertEqual(message, observer.messages[-1])
                for key, value in before.items():
                    self.assertEqual(game[key], value, key)
                self.assertEqual(self.save.call_args.args, (game,))

    def test_dragon_marks_paper_for_every_viewer_and_restores_without_replaying_fire(self):
        game = self.game(effect="dragon")
        engine, turn = deepcopy(game["_hausdepp"]), deepcopy(game["_turn"])
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "dragon", "round_number": 1}))
        self.assertEqual(game["_hausdepp"], engine)
        self.assertEqual(game["_turn"], turn)
        self.assertTrue(game["_hausdepp_scorched_cards"])
        restored = serializable_game_state(game)
        for viewer in ("p1", "p2", None, "spectator"):
            self.assertEqual(snapshot(restored, viewer)["_hausdepp_table_effects"], {"scorched_cards": True})
            self.assertNotIn("hausdepp_table_surprise", snapshot(restored, viewer))
        # A new round replaces the engine state but keeps this table's paper.
        restored["_hausdepp"] = new_round(restored["_participants"], deck=make_deck())
        self.assertEqual(table_effects_projection(restored), {"scorched_cards": True})
        fresh = new_hausdepp_game("fresh-table", "New table", 2, register=False)
        self.assertEqual(table_effects_projection(fresh), {"scorched_cards": False})

    def test_a_forged_dragon_cannot_mark_paper_and_only_true_restores_the_appearance(self):
        game = self.game(effect="star")
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "dragon", "round_number": 1}))
        self.assertNotIn("_hausdepp_scorched_cards", game)
        self.assertEqual(table_effects_projection(game), {"scorched_cards": False})
        for value in ("true", 1, {}, [], None):
            game["_hausdepp_scorched_cards"] = value
            self.assertEqual(table_effects_projection(game), {"scorched_cards": False})

    def test_forged_effect_ineligible_table_and_invalid_payloads_do_not_broadcast(self):
        game = self.game()
        session = self.session(game)
        for value in (None, "hammer", "ufo", "unknown", [], {}, 1):
            asyncio.run(handle_table_surprise(session, {"effect": value, "round_number": 1}))
            self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")
        self.assertEqual(game["_players"][1]["ws"].messages, [])
        self.assertNotIn("_hausdepp_table_surprise_claim", game)
        game["_id"] = next(f"ordinary-{index}" for index in range(100)
                           if _eligible_effect(f"ordinary-{index}", 1) is None)
        asyncio.run(handle_table_surprise(session, {"effect": "star", "eligible": True, "round_number": 1}))
        self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")
        self.save.assert_not_called()

    def test_spectator_cpu_unseated_and_replaced_sockets_cannot_activate(self):
        for kind in ("spectator", "cpu", "unseated", "replaced"):
            with self.subTest(kind=kind):
                game = self.game()
                session = self.session(game)
                if kind == "spectator":
                    session.is_spectator = True
                elif kind == "cpu":
                    game["_participants"][0].update(type="cpu", is_cpu=True)
                elif kind == "unseated":
                    game["_participants"] = game["_participants"][1:]
                else:
                    game["_players"][0]["ws"] = RecordingSocket()
                asyncio.run(handle_table_surprise(session, {"effect": "star", "round_number": 1}))
                self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_invalid_actor")
                self.assertEqual(game["_players"][1]["ws"].messages, [])

    def test_round_is_required_and_bool_wrong_types_or_stale_rounds_never_claim(self):
        game = self.game()
        session = self.session(game)
        engine = deepcopy(game["_hausdepp"])
        for value in (None, True, False, 1.0, "1", [], {}, 0, 2, 99):
            with self.subTest(round_number=value):
                asyncio.run(handle_table_surprise(session, {"effect": "star", "round_number": value}))
                self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")
                self.assertNotIn("_hausdepp_table_surprise_claim", game)
                self.assertEqual(game["_hausdepp"], engine)
        asyncio.run(handle_table_surprise(session, {"effect": "star"}))
        self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")
        self.save.assert_not_called()

    def test_waiting_peeking_finished_aborted_paused_and_other_games_have_no_offer(self):
        for change in ({"_started": False}, {"_finished": True}, {"_aborted": True},
                       {"_manual_pause": True}, {"_game_type": "zilch"}, {"_game_type": "zdwa"},
                       {"phase": "peeking"}, {"phase": "finished"}):
            with self.subTest(change=change):
                game = self.game()
                if "phase" in change:
                    game["_hausdepp"].update(change)
                else:
                    game.update(change)
                session = self.session(game)
                asyncio.run(handle_table_surprise(session, {"effect": "star", "round_number": 1}))
                self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")
                self.assertEqual(game["_players"][1]["ws"].messages, [])

    def test_two_simultaneous_players_can_activate_only_one_event_total(self):
        async def scenario():
            game = self.game()
            await asyncio.gather(*(handle_table_surprise(self.session(game, index), {"effect": "star", "round_number": 1})
                                   for index in (0, 1)))
            for player in game["_players"]:
                self.assertEqual(sum("hausdepp_table_surprise" in item for item in player["ws"].messages), 1)
            self.assertEqual(game["_hausdepp_table_surprise_claim"], {"round_number": 1, "activated": True})
            self.assertIsNone(table_surprise_offer(game, "p2")["effect"])
            return game
        game = asyncio.run(scenario())
        session = self.session(game, 1)
        asyncio.run(handle_table_surprise(session, {"effect": "hammer", "round_number": 1}))
        self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_unavailable")

    def test_claim_is_bounded_to_one_record_and_does_not_block_a_later_round(self):
        game = self.game(round_number=7)
        game["_hausdepp_table_surprise_claim"] = {"round_number": 6, "activated": True}
        asyncio.run(handle_table_surprise(self.session(game), {"effect": "star", "round_number": 7}))
        self.assertEqual(game["_hausdepp_table_surprise_claim"], {"round_number": 7, "activated": True})
        self.assertEqual(len(game["_hausdepp_table_surprise_claim"]), 2)

    def test_waiting_action_rechecks_a_replaced_connection_after_taking_lock(self):
        async def scenario():
            game = self.game()
            session = self.session(game)
            async with game_lock(game):
                pending = asyncio.create_task(handle_table_surprise(session, {"effect": "star", "round_number": 1}))
                await asyncio.sleep(0)
                game["_players"][0]["ws"] = RecordingSocket()
            await pending
            self.assertEqual(session.websocket.messages[-1]["error_code"], "hausdepp_table_surprise_invalid_actor")
            self.assertNotIn("_hausdepp_table_surprise_claim", game)
        asyncio.run(scenario())

    def test_slow_fanout_never_holds_game_lock_and_persists_claim_before_network(self):
        async def scenario():
            entered, release = asyncio.Event(), asyncio.Event()

            class BlockedSocket(RecordingSocket):
                async def send_json(inner, message):
                    entered.set()
                    await release.wait()
                    await super().send_json(message)

            game = self.game()
            game["_players"][0]["ws"] = BlockedSocket()
            lock = game_lock(game)
            pending = asyncio.create_task(handle_table_surprise(self.session(game),
                                                               {"effect": "star", "round_number": 1}))
            try:
                await asyncio.wait_for(entered.wait(), timeout=1)
                self.save.assert_called_once_with(game)
                self.assertEqual(game["_hausdepp_table_surprise_claim"], {"round_number": 1, "activated": True})
                # Card commands and CPU decisions must acquire this same lock
                # while a decorative event is still blocked on its recipient.
                await asyncio.wait_for(lock.acquire(), timeout=.2)
                lock.release()
            finally:
                release.set()
                await pending
        asyncio.run(scenario())

    def test_coordinator_errors_keep_presentation_prefix_without_rejecting_card_commands(self):
        async def scenario(kind):
            game = self.game()
            session = self.session(game)
            if kind == "paused":
                game["_manual_pause"] = True
            elif kind == "spectator":
                session.is_spectator, session.spectator_id = True, "viewer"
            elif kind == "unjoined":
                session.player_id = None
            else:
                game["_game_type"] = "zdwa"
            session.websocket.incoming = [{"action": "hausdepp_table_surprise", "effect": "star", "round_number": 1}]
            with patch("app.game_websocket.resolve_session", return_value=SimpleNamespace(user_id=1)), \
                    patch("app.game_websocket.can_access_game", return_value=True), \
                    patch("app.game_websocket.user_play_banned", return_value=False):
                with self.assertRaises(WebSocketDisconnect):
                    await _receive_messages(session, limiter=MessageRateLimiter(), finalize_game=AsyncMock())
            self.assertTrue(session.websocket.messages[-1]["error_code"].startswith("hausdepp_table_surprise_"))
            self.assertEqual(game["_players"][1]["ws"].messages, [])
            self.assertNotIn("_hausdepp_table_surprise_claim", game)
        for kind in ("paused", "spectator", "unjoined", "wrong_game"):
            with self.subTest(kind=kind):
                asyncio.run(scenario(kind))

    def test_websocket_routes_effect_as_presentation_only_and_limits_it_with_reactions(self):
        async def scenario():
            game = self.game()
            session = self.session(game)
            session.websocket.incoming = [{"action": "hausdepp_table_surprise", "effect": "star", "round_number": 1}]
            with patch("app.game_websocket.resolve_session", return_value=SimpleNamespace(user_id=1)), \
                    patch("app.game_websocket.can_access_game", return_value=True), \
                    patch("app.game_websocket.user_play_banned", return_value=False), \
                    patch("app.game_websocket.dispatch_gameplay_action", new_callable=AsyncMock) as gameplay:
                with self.assertRaises(WebSocketDisconnect):
                    await _receive_messages(session, limiter=MessageRateLimiter(), finalize_game=AsyncMock())
            gameplay.assert_not_called()
            self.assertIn("hausdepp_table_surprise", session.websocket.messages[-1])
        asyncio.run(scenario())
        limiter = MessageRateLimiter()
        for _ in range(10):
            self.assertIsNone(limiter.check("send_emoji"))
        self.assertEqual(limiter.check("hausdepp_table_surprise"), "wait")

    def test_reaction_rate_limit_keeps_surprise_error_out_of_pending_card_command(self):
        async def scenario():
            game = self.game()
            session = self.session(game)
            session.websocket.incoming = [{"action": "hausdepp_table_surprise", "effect": "star", "round_number": 1}]
            limiter = MessageRateLimiter()
            for _ in range(10):
                self.assertIsNone(limiter.check("send_emoji"))
            with patch("app.game_websocket.resolve_session", return_value=SimpleNamespace(user_id=1)), \
                    patch("app.game_websocket.can_access_game", return_value=True), \
                    patch("app.game_websocket.user_play_banned", return_value=False), \
                    patch("app.game_websocket.handle_table_surprise", new_callable=AsyncMock) as surprise:
                with self.assertRaises(WebSocketDisconnect):
                    await _receive_messages(session, limiter=limiter, finalize_game=AsyncMock())
            self.assertEqual(session.websocket.messages[-1], {
                "error": "Bitte kurz warten", "error_code": "hausdepp_table_surprise_rate_limited",
            })
            surprise.assert_not_called()
            self.assertNotIn("_hausdepp_table_surprise_claim", game)
            self.assertEqual(game["_players"][1]["ws"].messages, [])
        asyncio.run(scenario())
