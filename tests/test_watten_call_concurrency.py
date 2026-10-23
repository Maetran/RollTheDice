"""Real socket handlers queue overlapping Blödeln/show/ACK requests on one lock."""

import asyncio
import json
from dataclasses import replace
from itertools import count, permutations
from types import SimpleNamespace

import pytest

from app import watten_runtime
from app.active_games import serializable_game_state
from app.game_state import games
from app.game_ws_session import GameSocketSession
from app.watten_play import legal_cards
from app.watten_runtime import game_lock, persist_watten_game, restore_watten_json, snapshot_watten
from app.watten_websocket import handle_watten_gameplay_action
from tests import test_watten_runtime as native
from tests.test_watten_call_consistency import oracle_winner, source_call
from tests.test_watten_engine import dealt

server = native.server


def assert_current_sources(game):
    engine = game["_watten"].engine
    expected = source_call(engine)
    if engine.call is not None:
        assert engine.call == expected
    if engine.play is not None:
        assert engine.play.call == expected
        for trick in engine.play.tricks:
            assert trick.winner == (trick.leader + oracle_winner(
                trick.cards, expected, engine.recipe.profile.critical)) % 4
    roles = snapshot_watten(game)["engine"]["announcement_roles"]
    for binding in engine.recipe.bindings:
        view = snapshot_watten(game, binding.player_id)["engine"]
        assert (view["deal_id"], view["deal_revision"]) == (engine.deal_id, engine.deal_revision)
        if view["inspection"] is not None:
            assert view["inspection"]["cards"] == [
                {"role": "strike", "card": engine.deal.bottom_cards[roles["strike"]]},
                {"role": "colour", "card": engine.deal.bottom_cards[roles["colour"]]},
            ]
        if view.get("reference_card", {}).get("face") == "card":
            assert view["reference_card"]["card"] == ("bells-6" if expected.strike_rank == "weli"
                                                       else f"{expected.trump_suit}-{expected.strike_rank}")
        if engine.phase in {"deal_complete", "match_complete"}:
            assert view["round_summary"] == {"strike_rank": expected.strike_rank, "trump_suit": expected.trump_suit,
                                               "rechter": f"{expected.trump_suit}-{expected.strike_rank}"}


@pytest.mark.parametrize("dealer", range(4))
@pytest.mark.parametrize("swap_roles", (False, True))
@pytest.mark.parametrize("arrival", list(permutations(range(3))))
def test_overlapping_show_bloedeln_ack_retry_and_rejoin_keep_the_same_frozen_call(server, monkeypatch, dealer, swap_roles, arrival, record_property):
    deal_number = count()

    def fixed_deal(_count, actual_dealer):
        if next(deal_number) == 0:
            strike, colour = ("bells-A", "leaves-7") if swap_roles else ("leaves-7", "bells-A")
        else:
            strike, colour = "acorns-9", "hearts-O"
        bottoms = [None] * 4
        bottoms[actual_dealer], bottoms[(actual_dealer + 1) % 4] = colour, strike
        for seat, card in zip((seat for seat in range(4) if bottoms[seat] is None), ("hearts-8", "acorns-8")):
            bottoms[seat] = card
        return dealt(4, bottoms=bottoms)

    monkeypatch.setattr(watten_runtime, "_RANDOM", SimpleNamespace(randrange=lambda _count: dealer, shuffle=lambda _deck: None))
    monkeypatch.setattr(watten_runtime, "cryptographic_deal", fixed_deal)
    game_id, owners, sessions = native.local_started(server, count_players=4, blind=True, target=11)
    game = games[game_id]
    runtime = game["_watten"]
    game["_watten"] = replace(runtime, room=replace(runtime.room, recipe=replace(runtime.room.recipe, show_rechter=True)),
                              engine=replace(runtime.engine, recipe=replace(runtime.engine.recipe, show_rechter=True)))
    persist_watten_game(game)
    sockets = [session.websocket for session in sessions]
    numbers = count()

    async def send(session, data):
        return await handle_watten_gameplay_action(session, data["action"], data)

    async def queued_wave(intents):
        """All clients enter the actual handler while its native table lock is held."""
        envelopes = [(sessions[seat], native.engine_command(game_id, kind, next(numbers))) for seat, kind in intents]
        lock = game_lock(game)
        await lock.acquire()
        try:
            tasks = [asyncio.create_task(send(session, data)) for session, data in envelopes]
            await asyncio.sleep(0)
            assert all(not task.done() for task in tasks)  # Concurrent, genuinely queued submissions.
        finally:
            lock.release()
        outcomes = await asyncio.gather(*tasks, return_exceptions=True)
        assert sum(not isinstance(outcome, Exception) for outcome in outcomes) == 1
        assert_current_sources(game)
        pending = []
        for intent, envelope, outcome in zip(intents, envelopes, outcomes):
            if isinstance(outcome, Exception):
                assert isinstance(outcome, ValueError) and "stale_" in str(outcome)
                before = serializable_game_state(game)
                with pytest.raises(ValueError, match="stale_"):
                    await send(*envelope)  # A delayed old opportunity cannot change a later checkpoint.
                assert serializable_game_state(game) == before
                pending.append(intent)
        return pending, envelopes[outcomes.index(None)]

    async def complete_intents(intents):
        accepted = []
        while intents:
            intents, envelope = await queued_wave(intents)
            accepted.append(envelope)
        return accepted

    async def scenario():
        nonlocal sessions
        engine = game["_watten"].engine
        inspectors = sorted(engine.inspectors)
        others = sorted(set(range(4)) - set(inspectors))
        initial = [(inspectors[0], "show_ready"), (inspectors[1], "show_ready"), (others[0], "request_bloedeln")]
        old_shows = await complete_intents([initial[index] for index in arrival])
        assert game["_watten"].engine.phase == "inspection"
        assert game["_watten"].engine.preplay_request.kind == "bloedeln"
        original_call = game["_watten"].engine.call
        original_deal_id = game["_watten"].engine.deal_id
        original_bottoms = game["_watten"].engine.deal.bottom_cards

        # Persisted state and fresh authenticated socket returns must retain the
        # exact cards already shown, even with the unanswered request in flight.
        restored = restore_watten_json(json.dumps(serializable_game_state(game)))
        game.clear()
        game.update(restored)
        sessions = []
        for owner in owners:
            socket = native.CapturingSocket(owner)
            sockets.append(socket)
            session = GameSocketSession(socket, game, owner[0])
            await send(session, {"action": "rejoin_game", "revision": game["_watten"].room.revision,
                                 "expected_account_id": owner[0].user_id})
            sessions.append(session)
        assert_current_sources(game)
        final = [(inspectors[0], "inspection_ack"), (inspectors[1], "inspection_ack"), (others[1], "preplay_accept")]
        await complete_intents([final[index] for index in reversed(arrival)])
        assert game["_watten"].engine.phase == "play" and game["_watten"].engine.bloedeln
        assert game["_watten"].engine.call == original_call

        while game["_watten"].engine.phase == "play":
            current = game["_watten"].engine
            seat = current.play.current_seat
            card = legal_cards(current.play, current.bid_state, current.recipe.seats[seat])[0]
            await send(sessions[seat], native.engine_command(game_id, "play_card", next(numbers), card))
            assert_current_sources(game)
        assert game["_watten"].engine.phase == "deal_complete"
        current = game["_watten"].engine
        record_property("race_rounds", 1)
        record_property("race_tricks", len(current.play.tricks))
        await send(sessions[0], native.room_command(game_id, "watten_next_deal", next(numbers),
                    deal_id=current.deal_id, opportunity=current.opportunity))
        assert game["_watten"].engine.phase == "show_ready"
        before = serializable_game_state(game)
        # Accepted old IDs can only return their safe ACK. Replaying one after
        # next-deal must not publish the old faces/call into the new round.
        for previous_session, data in old_shows:
            seat = next(index for index, owner in enumerate(owners)
                        if owner[0].user_id == previous_session.auth_identity.user_id)
            await send(sessions[seat], data)
            assert serializable_game_state(game) == before
        current = game["_watten"].engine
        assert source_call(current).strike_rank == "9" and source_call(current).trump_suit == "hearts"
        assert_current_sources(game)
        assert all(snapshot_watten(game, session.player_id)["engine"].get("round_summary") is None for session in sessions)
        inspections = 0
        for socket in sockets:
            for message in socket.messages:
                view = message.get("scoreboard", {}).get("engine", {})
                if view.get("inspection") is not None:
                    inspections += 1
                    assert (view["deal_id"], view["deal_revision"]) == (original_deal_id, 0)
                    roles = view["announcement_roles"]
                    assert view["inspection"]["cards"] == [
                        {"role": "strike", "card": original_bottoms[roles["strike"]]},
                        {"role": "colour", "card": original_bottoms[roles["colour"]]},
                    ]
                if view.get("round_summary"):
                    assert view["deal_id"] == original_deal_id
                    assert view["round_summary"]["strike_rank"] == original_call.strike_rank
                    assert view["round_summary"]["trump_suit"] == original_call.trump_suit
        assert inspections >= 4

    asyncio.run(scenario())
