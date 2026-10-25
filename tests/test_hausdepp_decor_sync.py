"""Independent contracts for shared cosmetic objects and local-only placement."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import func, select
from starlette.websockets import WebSocketDisconnect

from app import hausdepp_table_props as props
from app import main
from app.active_games import load_active_games, save_active_game
from app.auth import create_user
from app.database import configure_database, session_scope, upgrade_database
from app.game_websocket import MessageRateLimiter, _receive_messages
from app.game_ws_session import GameSocketSession
from app.hausdepp_gameplay import game_lock
from app.hausdepp_state import new_hausdepp_game
from app.hausdepp_tournament import new_tournament
from app.models import CompletedGame, HausdeppAchievementUnlock, HausdeppRoundCredit, HausdeppWithdrawal
from tests.test_hausdepp_engine import scenario


class Socket:
    def __init__(self, user_id):
        self.identity = SimpleNamespace(user_id=user_id) if user_id is not None else None
        self.messages = []
        self.incoming = []
        self.closed = None

    async def send_json(self, message):
        # Preserve the actual sent representation, not mutable references.
        self.messages.append(json.loads(json.dumps(message)))

    async def receive_json(self):
        if self.incoming:
            return self.incoming.pop(0)
        raise WebSocketDisconnect()

    async def close(self, *, code=1000, reason=None):
        self.closed = code


@pytest.fixture
def room(tmp_path):
    with patch.dict(os.environ, {"ROLLTHEDICE_DATABASE_URL": f"sqlite:///{tmp_path}/decor.sqlite3"}):
        configure_database(tmp_path)
        upgrade_database(main.BASE)
        users = [create_user(name, "test-password-123", must_change_password=False)
                 for name in ("DecorFirst", "DecorSecond", "DecorObserver")]
        now = [1_792_490_000_000]
        with patch.object(props, "resolve_session", side_effect=lambda socket: socket.identity), \
                patch.object(props, "_now_ms", side_effect=lambda: now[0]):
            yield SimpleNamespace(users=users, now=now)
    configure_database(main.DATA_DIR)


def make_room(room, *, game_id="shared-decor", wanted=None):
    for index in range(500):
        key = game_id if wanted is None else f"{game_id}-{index}"
        game = new_hausdepp_game(key, "Cosmetic contract", "2", register=False)
        game["_participants"] = [{"id": f"p{slot}", "name": user.username, "user_id": user.id,
                                  "type": "human", "is_cpu": False} for slot, user in enumerate(room.users[:2])]
        game["_players"] = [{**person, "ws": Socket(person["user_id"]), "resume_token": f"PRIVATE-{person['id']}"}
                            for person in game["_participants"]]
        game["_spectators"] = [{"id": "observer", "user_id": room.users[2].id, "ws": Socket(room.users[2].id)}]
        game.update(_started=True,
                    _hausdepp=scenario([["hearts-6"], ["bells-6"]], discard=["hearts-7"], deck=["bells-8"]),
                    _turn={"player_id": "p0"})
        projection = props.table_props_projection(game)
        if wanted is None or wanted in projection["objects"]:
            return game
    raise AssertionError(f"No real offered {wanted} object in 500 independent room manifests")


def seated(game, index=0):
    player = game["_players"][index]
    return GameSocketSession(player["ws"], game, player["ws"].identity, player_id=player["id"])


def request(game, object_id, *, action_id="use-1", operation="tap", **extra):
    return {"action": "hausdepp_table_prop", "round_number": (game.get("_hausdepp_tournament") or {}).get("round_number", 1),
            "object_id": object_id, "operation": operation, "action_id": action_id, **extra}


def use(session, object_id, *, action_id="use-1", operation="tap", **extra):
    asyncio.run(props.handle_table_prop(session, request(session.game, object_id, action_id=action_id,
                                                        operation=operation, **extra)))


def messages_with(socket, key):
    return [message[key] for message in socket.messages if key in message]


def food(game):
    return next((key, state) for key, state in props.table_props_projection(game)["objects"].items()
                if "remaining" in state and state["remaining"] >= 2)


def test_manifest_snapshot_is_shared_and_contains_no_delivery_journal_or_private_cards(room):
    game = make_room(room)
    first = props.table_props_projection(game)
    assert first["schema_version"] == 1 and first["game_id"] == game["_id"] and first["round_number"] == 1
    assert first == props.table_props_projection(deepcopy(game))
    assert first["layout"] == props.initial_layout(game["_id"], 1)
    assert 0 < len(first["objects"]) <= 24
    assert not set(first["objects"]).intersection({"star", "hammer", "ufo", "portal", "dragon", "kraken", "clock", "blackhole"})
    key, _ = food(game)
    use(seated(game), key, action_id="PRIVATE-DELIVERY-ID")
    public = json.dumps(props.table_props_projection(game))
    assert "PRIVATE-DELIVERY-ID" not in public and "recent_actions" not in public
    for private in ('"user_id"', '"resume_token"', '"achievement_evidence"', '"hand"', 'hearts-6', 'bells-6'):
        assert private not in public


def test_two_people_eating_concurrently_apply_two_bites_and_one_shared_revision_each(room):
    game = make_room(room, wanted="nuts")
    key, before = food(game)
    count = before["remaining"]
    revision = props.table_props_projection(game)["revision"]

    async def run():
        await asyncio.gather(*(props.handle_table_prop(seated(game, index), request(game, key, action_id=f"bite-{index}"))
                               for index in (0, 1)))
    asyncio.run(run())
    after = props.table_props_projection(game)
    assert after["objects"][key]["remaining"] == count - 2
    assert after["revision"] == revision + 2
    for watcher in [*game["_players"], *game["_spectators"]]:
        events = messages_with(watcher["ws"], "hausdepp_table_prop")
        assert len(events) == 2 and {event["actor_id"] for event in events} == {"p0", "p1"}
        assert {event["revision"] for event in events} == {revision + 1, revision + 2}
        assert all(event["object_id"] == key for event in events)


def test_delivery_retry_is_idempotent_but_another_actor_may_use_same_action_id(room):
    game = make_room(room, wanted="nuts")
    key, before = food(game)
    original = before["remaining"]
    use(seated(game), key, action_id="same-request")
    revision = props.table_props_projection(game)["revision"]
    use(seated(game), key, action_id="same-request")
    assert props.table_props_projection(game)["objects"][key]["remaining"] == original - 1
    assert props.table_props_projection(game)["revision"] == revision
    assert messages_with(game["_players"][0]["ws"], "hausdepp_table_prop_ack")[-1] == {
        "action_id": "same-request", "duplicate": True}
    assert len(messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")) == 1
    use(seated(game, 1), key, action_id="same-request")
    assert props.table_props_projection(game)["objects"][key]["remaining"] == original - 2


@pytest.mark.parametrize("kind", ["spectator", "replaced_socket", "missing_seat", "cpu", "revoked_account", "foreign_account", "foreign_binding", "guest_downgrade"])
def test_only_current_seated_authority_can_mutate_shared_objects(room, kind):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    session = seated(game)
    if kind == "spectator":
        session = GameSocketSession(game["_spectators"][0]["ws"], game, None, spectator_id="observer", is_spectator=True)
    elif kind == "replaced_socket":
        game["_players"][0]["ws"] = Socket(room.users[0].id)
    elif kind == "missing_seat":
        game["_participants"] = game["_participants"][1:]
    elif kind == "cpu":
        game["_participants"][0].update(is_cpu=True, type="cpu", user_id=None)
    elif kind == "revoked_account":
        session.websocket.identity = None
    elif kind == "foreign_binding":
        game["_participants"][0]["user_id"] = room.users[1].id
    elif kind == "guest_downgrade":
        game["_players"][0]["user_id"] = None
        session.websocket.identity = None
    else:
        session.websocket.identity = SimpleNamespace(user_id=room.users[1].id)
    before = deepcopy(props.table_props_projection(game))
    use(session, key)
    assert props.table_props_projection(game) == before
    assert session.websocket.messages[-1]["error_code"] == "hausdepp_table_prop_invalid_actor"
    assert not messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")


def test_existing_guest_seat_can_use_cosmetics_without_creating_an_account_or_join(room):
    game = make_room(room, wanted="nuts")
    game["_participants"][0]["user_id"] = game["_players"][0]["user_id"] = None
    game["_players"][0]["ws"].identity = None
    key, before = food(game)
    use(seated(game), key)
    assert props.table_props_projection(game)["objects"][key]["remaining"] == before["remaining"] - 1
    assert len(messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")) == 1


def test_connection_is_rechecked_after_waiting_for_game_lock(room):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    session = seated(game)
    before = deepcopy(props.table_props_projection(game))

    async def run():
        async with game_lock(game):
            pending = asyncio.create_task(props.handle_table_prop(session, request(game, key)))
            await asyncio.sleep(0)
            game["_players"][0]["ws"] = Socket(room.users[0].id)
        await pending
    asyncio.run(run())
    assert props.table_props_projection(game) == before
    assert session.websocket.messages[-1]["error_code"] == "hausdepp_table_prop_invalid_actor"


@pytest.mark.parametrize("key,value", [("round_number", 0), ("round_number", 2), ("round_number", True),
                                       ("round_number", "1"), ("round_number", {}),
                                       ("object_id", "star"), ("object_id", "foreign-prop"),
                                       ("object_id", []), ("object_id", {}),
                                       ("action_id", ""), ("action_id", "a" * 81), ("action_id", "ümlaut"),
                                       ("action_id", True), ("operation", "move"), ("operation", {})])
def test_stale_rounds_unoffered_props_and_malformed_commands_never_mutate(room, key, value):
    game = make_room(room, wanted="nuts")
    object_id, _ = food(game)
    before = deepcopy(props.table_props_projection(game))
    data = request(game, object_id)
    data[key] = value
    asyncio.run(props.handle_table_prop(seated(game), data))
    assert props.table_props_projection(game) == before
    assert game["_players"][0]["ws"].messages[-1]["error_code"] in {
        "hausdepp_table_prop_invalid_request", "hausdepp_table_prop_unavailable"}
    assert not messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")


@pytest.mark.parametrize("forgery", [{"actor_id": "p1"}, {"user_id": 999}, {"game_id": "other-table"},
                                     {"value": 6}, {"face": "heads"}, {"remaining": 999},
                                     {"state": {"remaining": 999}}, {"x": 50, "y": 80}])
def test_browser_cannot_supply_identity_result_object_state_or_global_positions(room, forgery):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    before = deepcopy(props.table_props_projection(game))
    use(seated(game), key, **forgery)
    assert props.table_props_projection(game) == before
    assert game["_players"][0]["ws"].messages[-1]["error_code"] == "hausdepp_table_prop_invalid_request"


def test_dice_and_coin_results_come_from_server_rng_and_are_shared(room):
    for name in ("die", "coin"):
        game = make_room(room, wanted=name)
        with patch.object(props, "_RANDOM") as random:
            random.randrange.side_effect = lambda *bounds: 4 if bounds == (1, 7) else 1
            use(seated(game), name)
        projected = props.table_props_projection(game)["objects"][name]
        assert projected["value"] == 4 if name == "die" else projected["face"] == "tails"
        events = [messages_with(person["ws"], "hausdepp_table_prop")[-1] for person in [*game["_players"], *game["_spectators"]]]
        assert events[0] == events[1] == events[2]
        assert events[0]["after"] == projected


def test_rate_window_is_per_actor_and_retry_does_not_consume_their_budget(room):
    game = make_room(room, wanted="coaster")
    for index in range(10):
        use(seated(game), "coaster", action_id=f"mark-{index}")
    revision = props.table_props_projection(game)["revision"]
    use(seated(game), "coaster", action_id="mark-0")
    assert messages_with(game["_players"][0]["ws"], "hausdepp_table_prop_ack")[-1]["duplicate"] is True
    use(seated(game), "coaster", action_id="mark-over-budget")
    assert game["_players"][0]["ws"].messages[-1]["error_code"] == "hausdepp_table_prop_rate_limited"
    assert props.table_props_projection(game)["revision"] == revision
    use(seated(game, 1), "coaster", action_id="other-mark")
    assert props.table_props_projection(game)["revision"] == revision + 1
    room.now[0] += 5001
    use(seated(game), "coaster", action_id="later-mark")
    assert props.table_props_projection(game)["revision"] == revision + 2


def test_state_and_idempotency_journal_remain_bounded_after_long_use(room):
    game = make_room(room, wanted="coaster")
    initial_keys = set(props.table_props_projection(game)["objects"])
    for index in range(180):
        room.now[0] += 501
        use(seated(game), "coaster", action_id=f"long-use-{index}")
    stored = game["_hausdepp_table_props"]
    assert len(stored["recent_actions"]) <= 128
    assert set(props.table_props_projection(game)["objects"]) == initial_keys
    assert len(json.dumps(stored)) < 60_000
    assert not any(key in stored for key in ("history", "events", "positions", "x", "y"))


def test_reconnect_and_restart_keep_shared_state_and_deduplicate_previous_delivery(room):
    game = make_room(room, wanted="nuts")
    save_active_game(game, creating=True)  # Explicit new durable fixture, before cosmetic actions.
    key, _ = food(game)
    use(seated(game), key, action_id="before-restart")
    before = deepcopy(props.table_props_projection(game))
    save_active_game(game)
    restored = load_active_games()[game["_id"]]
    for person in restored["_players"]:
        person["ws"] = Socket(person["user_id"])
    restored["_resume_required"] = False
    assert props.table_props_projection(restored) == before
    use(seated(restored), key, action_id="before-restart")
    assert props.table_props_projection(restored) == before
    assert messages_with(restored["_players"][0]["ws"], "hausdepp_table_prop_ack")[-1]["duplicate"] is True
    use(seated(restored, 1), key, action_id="after-restart")
    assert props.table_props_projection(restored)["objects"][key]["remaining"] == before["objects"][key]["remaining"] - 1


def test_new_round_has_fresh_objects_and_rejects_previous_round_delivery(room):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    old = request(game, key, action_id="old-round-click")
    use(seated(game), key, action_id="first-round-bite")
    tournament = new_tournament(game["_id"], game["_participants"])
    tournament.update(round_number=2, round_losers=["p1"], losses={"p0": 0, "p1": 1})
    game["_hausdepp_tournament"] = tournament
    fresh = deepcopy(props.table_props_projection(game))
    assert fresh["round_number"] == 2 and fresh["revision"] == 0
    assert all(state["remaining"] == state["total"] for state in fresh["objects"].values() if "remaining" in state)
    asyncio.run(props.handle_table_prop(seated(game), old))
    assert props.table_props_projection(game) == fresh


def test_cosmetic_actions_do_not_change_cards_turn_version_or_any_xp_evidence(room):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    unchanged = {name: deepcopy(game.get(name)) for name in
                 ("_hausdepp", "_turn", "_finished", "_results", "_hausdepp_surprise_collection")}
    use(seated(game), key)
    for name, value in unchanged.items():
        assert game.get(name) == value
    with session_scope() as db:
        for model in (CompletedGame, HausdeppRoundCredit, HausdeppAchievementUnlock, HausdeppWithdrawal):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_slow_cosmetic_fanout_does_not_hold_the_card_game_lock(room):
    game = make_room(room, wanted="nuts")
    key, before = food(game)
    count = before["remaining"]

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        original = game["_players"][0]["ws"].send_json
        async def slow(message):
            entered.set()
            await release.wait()
            await original(message)
        game["_players"][0]["ws"].send_json = slow
        first = asyncio.create_task(props.handle_table_prop(seated(game), request(game, key, action_id="slow-a")))
        await asyncio.wait_for(entered.wait(), 2)
        second = asyncio.create_task(props.handle_table_prop(seated(game, 1), request(game, key, action_id="slow-b")))
        try:
            await asyncio.sleep(0)
            lock = game_lock(game)
            await asyncio.wait_for(lock.acquire(), 2)
            try:
                assert props.table_props_projection(game)["objects"][key]["remaining"] == count - 2
            finally:
                lock.release()
        finally:
            release.set()
            await asyncio.gather(first, second)
    asyncio.run(run())


def test_spill_is_shared_and_another_player_can_complete_one_wipe(room):
    game = make_room(room, wanted="beer")
    for index in range(3):
        room.now[0] += 100
        use(seated(game), "beer", action_id=f"rapid-sip-{index}")
    spilled = props.table_props_projection(game)["objects"]["beer"]
    assert spilled["level"] == 0 and spilled["spill"] is not None
    use(seated(game, 1), "beer", operation="wipe", action_id="other-person-wiped")
    cleaned = props.table_props_projection(game)["objects"]["beer"]
    assert cleaned["spill"] is None and cleaned["level"] == 0
    for person in [*game["_players"], *game["_spectators"]]:
        assert messages_with(person["ws"], "hausdepp_table_prop")[-1]["after"]["spill"] is None


def test_lantern_relights_from_server_deadline_after_restart_without_new_card_actions(room):
    game = make_room(room, wanted="lantern")
    save_active_game(game, creating=True)
    before = deepcopy(game["_hausdepp"])
    use(seated(game), "lantern", operation="shake")
    shaken = props.table_props_projection(game)["objects"]["lantern"]
    assert shaken["lit"] is False and shaken["relight_at"] > room.now[0]
    save_active_game(game)
    restored = load_active_games()[game["_id"]]
    room.now[0] = shaken["relight_at"] + 1
    relit = props.table_props_projection(restored)["objects"]["lantern"]
    assert relit["lit"] is True and relit["relight_at"] is None
    assert restored["_hausdepp"] == before


@pytest.mark.parametrize("field,value", [("object_id", {}), ("operation", []), ("action_id", []),
                                         ("actor_id", []), ("at", -1)])
def test_malformed_stored_delivery_rows_do_not_break_a_reconnect_snapshot(room, field, value):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    use(seated(game), key)
    game["_hausdepp_table_props"]["recent_actions"][0][field] = value
    projection = props.table_props_projection(game)
    assert projection["revision"] == 0
    assert all(state["remaining"] == state["total"] for state in projection["objects"].values() if "remaining" in state)


@pytest.mark.parametrize("change", [{"_started": False}, {"_finished": True}, {"_aborted": True},
                                    {"_manual_pause": True}, {"_game_type": "zilch"}])
def test_ineligible_lifecycle_never_uses_an_object(room, change):
    game = make_room(room, wanted="nuts")
    key, _ = food(game)
    game.update(change)
    before = deepcopy(props.table_props_projection(game))
    use(seated(game), key)
    assert props.table_props_projection(game) == before
    assert game["_players"][0]["ws"].messages[-1]["error_code"] in {
        "hausdepp_table_prop_invalid_actor", "hausdepp_table_prop_unavailable"}
    assert not messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")


@pytest.mark.parametrize("kind", ["routed", "paused", "spectator", "unjoined", "rate_limited", "revoked"])
def test_real_websocket_coordinator_routes_and_guards_cosmetics_separately_from_card_commands(room, kind):
    game = make_room(room, wanted="nuts")
    key, before = food(game)
    count = before["remaining"]
    session = seated(game)
    if kind == "paused":
        game["_manual_pause"] = True
    elif kind == "spectator":
        observer = game["_spectators"][0]
        session = GameSocketSession(observer["ws"], game, observer["ws"].identity,
                                    spectator_id=observer["id"], is_spectator=True)
    elif kind == "unjoined":
        session.player_id = None
    elif kind == "revoked":
        session.websocket.identity = None
    limiter = MessageRateLimiter()
    if kind == "rate_limited":
        for _ in range(10):
            assert limiter.check("send_emoji") is None
    session.websocket.incoming = [request(game, key)]

    async def run():
        with patch("app.game_websocket.resolve_session", side_effect=lambda socket: socket.identity), \
                patch("app.game_websocket.dispatch_gameplay_action", new_callable=AsyncMock) as gameplay:
            if kind == "revoked":
                await _receive_messages(session, limiter=limiter, finalize_game=AsyncMock())
            else:
                with pytest.raises(WebSocketDisconnect):
                    await _receive_messages(session, limiter=limiter, finalize_game=AsyncMock())
            gameplay.assert_not_awaited()

    asyncio.run(run())
    after = props.table_props_projection(game)["objects"][key]["remaining"]
    if kind == "routed":
        assert after == count - 1
        assert len(messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")) == 1
    else:
        assert after == count
        assert not messages_with(game["_players"][1]["ws"], "hausdepp_table_prop")
        if kind == "revoked":
            assert session.websocket.closed == 1008
        else:
            assert session.websocket.messages[-1]["error_code"] == {
                "paused": "hausdepp_table_prop_unavailable",
                "spectator": "hausdepp_table_prop_invalid_actor",
                "unjoined": "hausdepp_table_prop_invalid_actor",
                "rate_limited": "hausdepp_table_prop_rate_limited",
            }[kind]


@pytest.mark.parametrize("spill_id", ["bad", "x:1", "1:0", {}, []])
def test_corrupt_spill_ids_cannot_break_reconnect_or_the_next_gesture(room, spill_id):
    game = make_room(room, wanted="beer")
    for index in range(3):
        room.now[0] += 100
        use(seated(game), "beer", action_id=f"spill-{index}")
    game["_hausdepp_table_props"]["objects"]["beer"]["spill"]["id"] = spill_id
    restored = props.table_props_projection(game)
    assert restored["revision"] == 0
    assert restored["objects"]["beer"]["spill"] is None
    use(seated(game), "beer", action_id="fresh-after-corruption")
    assert props.table_props_projection(game)["objects"]["beer"]["level"] == 3


def test_server_manifest_matches_actual_browser_selection_across_rounds_and_viewports():
    # Execute the renderer's actual catalog, PRNG, construction and responsive
    # selection in Node. This catches Python/JS drift without copying either
    # implementation or introducing a production export solely for this test.
    root = Path(__file__).resolve().parents[1]
    cases = [(f"manifest-contract-{index}", round_number) for index in range(12) for round_number in (1, 8, 48)]
    script = r"""
const fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync(process.argv[1], 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/^export (?=(?:function|const|let|var|class)\b)/gm, '');
const start = source.indexOf('const random = randomFor(key);');
const construction = source.slice(start, source.indexOf('state.onMotionPreference =', start));
const selectStart = source.indexOf('const phone = innerWidth < 768;');
const selection = source.slice(selectStart, source.indexOf('const used = [];', selectStart));
if (start < 0 || selectStart < 0) throw new Error('Renderer construction or viewport selection moved');
const context = { matchMedia: () => ({}) };
vm.runInNewContext(source + `
globalThis.renderedManifest = (gameId, round) => {
  const key = gameId + ':' + round, table = {}, layer = {}, phase = 'playing'; let state;
  ${construction}
  const offered = new Set();
  for (const [innerWidth, innerHeight] of [[390,844], [844,390], [1024,768], [1440,900]]) {
    const bounds = {width: innerWidth}; ${selection}
    wanted.forEach(prop => offered.add(prop));
  }
  return {layout:{props:state.props,scatter:state.scatter,count:state.count,scatter_count:state.scatterCount},
          offered:[...offered].sort()};
};`, context);
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(cases.map(([gameId, round]) => context.renderedManifest(gameId, round))));
"""
    completed = subprocess.run(["node", "-e", script, str(root / "frontend/hausdepp/decor.js")],
                               input=json.dumps(cases), text=True, capture_output=True, check=True,
                               cwd=root, timeout=10)
    actual = json.loads(completed.stdout)
    for (game_id, round_number), browser in zip(cases, actual, strict=True):
        assert props.initial_layout(game_id, round_number) == browser["layout"]
        game = new_hausdepp_game(game_id, "Manifest contract", "2", register=False)
        game["_hausdepp"] = scenario([["hearts-6"], ["bells-6"]], discard=["hearts-7"], deck=["bells-8"])
        game["_hausdepp_tournament"] = {"round_number": round_number}
        assert sorted(props.table_props_projection(game)["objects"]) == browser["offered"]
