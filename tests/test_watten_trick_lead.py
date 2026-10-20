"""The actual card winner leads immediately; their party or dealer cannot substitute."""

import asyncio

import pytest
from sqlalchemy import select

from app import watten_cpu_runtime as runner
from app import watten_runtime as runtime
from app.database import session_scope
from app.game_state import games
from app.models import ActiveGame
from app.watten_cards import DealtCards, make_deck
from app.watten_engine import partner_id
from app.watten_play import WattenPlayError, legal_cards
from app.watten_views import cpu_view, spectator_view
from app.watten_websocket import _handle_locked
from tests import test_watten_runtime as native
from tests.test_watten_cpu_runtime import accepted_engine, complete_call, deterministic_dealer

server = native.server


def opening_cards(count):
    # With seven called and bells trump, the final non-dealer's leaves ace
    # beats the leaves lead. Dealer zero discards an ordinary hearts eight.
    first = ["hearts-8", "leaves-8", "leaves-9", "leaves-A"][:count]
    first[-1] = "leaves-A"
    hands = [[card] for card in first]
    hands[-1].append("hearts-9")
    used = {card for hand in hands for card in hand}
    stock = [card for card in make_deck() if card not in used]
    for hand in hands:
        while len(hand) < 5:
            hand.append(stock.pop(0))
    return first, DealtCards(tuple(tuple(hand) for hand in hands), tuple(stock), tuple(hand[-1] for hand in hands))


@pytest.mark.parametrize("count", (2, 3, 4))
def test_actual_non_dealer_winner_gets_next_card_turn_views_and_cpu_job_without_continue(server, monkeypatch, count):
    first, deal = opening_cards(count)
    deterministic_dealer(monkeypatch)
    monkeypatch.setattr(runtime, "cryptographic_deal", lambda _count, _dealer: deal)
    game_id, _owners, sessions = native.local_started(server, count_players=count, cpus=tuple(range(1, count)))
    game, human = games[game_id], sessions[0]
    complete_call(game_id)
    seats = game["_watten"].engine.recipe.seats
    winner_seat, winner = count - 1, seats[-1]
    for seat in range(1, count):
        accepted_engine(game, seats[seat], native.engine_command(game_id, "play_card", f"lead-guard-first-{seat}", first[seat]))
    assert game["_watten"].engine.play.current_player_id == human.player_id == seats[0]

    async def scenario():
        try:
            # The real human's final card commits, broadcasts and schedules the
            # next CPU through the ordinary locked gameplay handler.
            await _handle_locked(human, "watten_command", native.engine_command(game_id, "play_card", "lead-guard-last", first[0]))
            state = game["_watten"].engine
            assert state.phase == "play" and state.bid_state.pending is None
            assert state.play.tricks[-1].winner == winner_seat != state.dealer_seat
            assert state.play.trick_leader == state.play.current_seat == winner_seat
            assert state.play.current_player_id == winner and state.play.trick_cards == ()
            partner = partner_id(state, winner)
            assert (partner is None) == (count == 2)
            if partner is not None:
                assert partner != winner
                assert state.parties.party_of(partner) == state.parties.party_of(winner)
            # The actual browser-bound broadcast and every CPU/public DTO agree.
            broadcast = next(message["scoreboard"] for message in reversed(human.websocket.messages) if "scoreboard" in message)
            assert broadcast["engine"]["card_turn"] == broadcast["engine"]["last_trick"]["winner"] == winner_seat
            assert "play_card" not in broadcast["engine"]["actions"]
            assert spectator_view(state)["card_turn"] == winner_seat
            for seat in range(1, count):
                view = cpu_view(state, player_id=seats[seat])
                assert view["card_turn"] == winner_seat
                assert ("play_card" in view["actions"]) == (seat == winner_seat)
            assert set(runner._JOBS) == {(game_id, winner)}
            with session_scope() as db:
                raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
            restored = runtime.restore_watten_json(raw)["_watten"].engine
            assert restored.play.current_player_id == winner and restored.play.trick_leader == winner_seat
            # Even the winning party's partner cannot use the fresh opportunity.
            for seat, player in enumerate(seats):
                if player == winner:
                    continue
                assert legal_cards(state.play, state.bid_state, player) == ()
                with pytest.raises(WattenPlayError, match="watten_not_your_turn"):
                    accepted_engine(game, player, native.engine_command(game_id, "play_card", f"lead-guard-wrong-{seat}",
                                                                       state.play.hands[seat][0]))
                assert game["_watten"].engine is state
            accepted_engine(game, winner, native.engine_command(game_id, "play_card", "lead-guard-next", "hearts-9"))
            after = game["_watten"].engine
            assert after.phase == "play" and after.play.trick_cards == ("hearts-9",)
            assert after.play.trick_leader == winner_seat and after.play.current_player_id == seats[0]
        finally:
            await runner.stop_cpu_runners()

    asyncio.run(scenario())
