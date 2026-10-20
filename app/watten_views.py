"""Strict personal/public allowlists, independently of private storage payloads.

No arbitrary viewer-supplied knowledge, sorting by hidden card strength, legal
card hints, stock, cached acknowledgements or account IDs enter these views.
CPU views use the same personal projection as their own authorized seat.
"""

from __future__ import annotations

from .watten_bidding import nockerl, retourschneider_candidate
from .watten_engine import (
    EngineActor,
    EngineState,
    WattenEngineError,
    gestrichen_players,
    partner_id,
    require_actor,
    retourschneider_decider,
)
from .watten_play import official_knower_seats
from .watten_rules import WELI_STRIKE, round_roles


def _trick(leader: int, cards: tuple[str, ...], count: int, winner: int | None = None) -> dict:
    result = {"cards": [{"seat": (leader + index) % count, "card": card} for index, card in enumerate(cards)]}
    if winner is not None:
        result["winner"] = winner
    return result


def _retourschneider(state: EngineState) -> dict | None:
    choice = state.ledger.retourschneider
    members = choice.members if choice is not None else (
        retourschneider_candidate(state.ledger) if state.phase == "deal_complete" else None)
    if members is None:
        return None
    opponents = next(account.members for account in state.ledger.accounts if account.members != members)
    status = "available"
    if choice is not None:
        status = ("declined" if not choice.accepted else "succeeded" if members in state.ledger.winners
                  else "failed" if state.ledger.winners else "active")
    return {"status": status, "members": list(members), "opponent_members": list(opponents),
            "decider": retourschneider_decider(state, members),
            "erased_points": choice.erased_points if choice else next(
                account.points for account in state.ledger.accounts if account.members == members),
            "after_deal_id": choice.after_deal_id if choice else state.deal_id}


def _public(state: EngineState) -> dict:
    play, bidding, recipe = state.play, state.bid_state, state.recipe
    count = recipe.profile.player_count
    result = bidding.result
    current = _trick(play.trick_leader, play.trick_cards, count) if play else {"cards": []}
    last = _trick(play.tricks[-1].leader, play.tricks[-1].cards, count, play.tricks[-1].winner) if play and play.tricks else None
    # Public revision/opportunity never changes for private feedback. There is
    # deliberately no global event count, modified time or private action hash.
    view = {
        "schema": 1, "deal_id": state.deal_id, "phase": state.phase, "opportunity": state.opportunity,
        "profile": {"player_count": count, "determination": recipe.profile.determination,
                    "blind": recipe.profile.blind, "critical": recipe.profile.critical},
        "options": {"show_rechter": recipe.show_rechter, "open_partner_hand": recipe.open_partner_hand,
                    "trick_history": recipe.trick_history},
        "dealer_seat": state.dealer_seat,
        "seats": [{"seat": seat, "player_id": binding.player_id,
                   "party": state.parties.party_of(binding.player_id),
                   "card_count": len(play.hands[seat]) if play else 5}
                  for seat, binding in enumerate(recipe.bindings)],
        "scores": [{"members": list(account.members), "points": account.points} for account in state.ledger.accounts],
        "target_points": recipe.target_points,
        "winners": [list(members) for members in state.ledger.winners],
        "retourschneider": _retourschneider(state),
        "nockerl": [{"members": list(members), "count": count, "reason": reason}
                    for members, count, reason in nockerl(state.ledger)],
        "party_tricks": list(play.party_tricks) if play else [0, 0],
        "card_turn": play.current_seat if play and not result else None,
        "current_trick": current, "last_trick": last,
        "bid": {"accepted_stake": bidding.accepted_stake,
                "pending": None if bidding.pending is None else {
                    "party": bidding.pending.party, "points": bidding.pending.points,
                    "decider": state.parties.decider(1 - bidding.pending.party)},
                "result": None if result is None else {"winning_party": result.winning_party,
                                                       "points": result.points, "reason": result.reason}},
        "transcript": [{"kind": "watten_thanks", "seat": seat} for seat in state.thanks],
        "trick_history": [_trick(trick.leader, trick.cards, count, trick.winner) for trick in play.tricks]
        if recipe.trick_history and play else None,
    }
    if state.phase == "colour":
        # Normal announcements are public. This transient partial call is
        # needed by the colour chooser; it disappears when the call finishes.
        view["announced_strike"] = state.normal_strike
    if recipe.show_rechter:
        view["reference_card"] = {"face": "back"}
    return view


def _actions(state: EngineState, seat: int) -> list[str]:
    player = state.recipe.seats[seat]
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    if state.phase == "strike":
        return ["announce_strike"] if seat == roles.strike_announcer else []
    if state.phase == "colour":
        return ["announce_colour"] if seat == roles.suit_announcer else []
    if state.phase == "show_ready":
        return ["show_ready"] if seat in state.inspectors and seat not in state.shown else []
    if state.phase == "inspection":
        return ["inspection_ack"] if seat in state.inspectors and seat not in state.acknowledged else []
    actions = []
    members = retourschneider_candidate(state.ledger)
    if (state.phase == "deal_complete" and members is not None
            and player == retourschneider_decider(state, members)):
        actions.append("retourschneider")
    if state.phase == "play" and player == state.play.current_player_id:
        actions.append("play_card")
        if (state.play.plays and player not in gestrichen_players(state)
                and state.parties.party_of(player) != state.bid_state.last_offering_party):
            actions.append("bid")
    if state.phase == "bid_response" and player == state.parties.decider(1 - state.bid_state.pending.party):
        actions.extend(("respond_hold", "respond_go", "respond_counter"))
    if (state.phase == "bid_response" and partner_id(state, player) is not None
            and state.parties.party_of(player) != state.bid_state.pending.party
            and not any(item.sender == player for item in state.feedback)):
        actions.append("partner_feedback")
    return actions


def _personal(state: EngineState, seat: int) -> dict:
    view = _public(state)
    recipe, player = state.recipe, state.recipe.seats[seat]
    roles = round_roles(len(recipe.seats), state.dealer_seat, determination=recipe.profile.determination)
    announcer = seat in {roles.strike_announcer, roles.suit_announcer}
    hand_visible = state.play is not None or (recipe.profile.determination == "normal" and announcer)
    hand = state.play.hands[seat] if state.play else state.deal.hands[seat]
    view["viewer"] = {"seat": seat, "player_id": player}
    view["hand"] = [{"card": card} if hand_visible else {"back": True} for card in hand]
    view["actions"] = _actions(state, seat)
    view["inspection"] = None
    if state.phase == "inspection" and seat in state.inspectors and seat not in state.acknowledged:
        view["inspection"] = {
            "cards": [{"role": "strike", "card": state.deal.bottom_cards[roles.strike_announcer]},
                      {"role": "colour", "card": state.deal.bottom_cards[roles.suit_announcer]}],
        }
    # No full call survives inspection. This optional matching reference is
    # neither the other original bottom nor a stronger replacement Rechter.
    if (recipe.show_rechter and state.play is not None
            and seat in official_knower_seats(recipe.profile, state.dealer_seat)):
        reference = "bells-6" if state.call.strike_rank == WELI_STRIKE else f"{state.call.trump_suit}-{state.call.strike_rank}"
        view["reference_card"] = {"face": "card", "card": reference}
    partner = partner_id(state, player)
    view["partner_hand"] = None
    if recipe.open_partner_hand and state.play is not None and partner is not None:
        partner_seat = recipe.seats.index(partner)
        view["partner_hand"] = {"player_id": partner, "cards": list(state.play.hands[partner_seat])}
    view["feedback"] = [{"sender": item.sender, "recipient": item.recipient, "value": item.value,
                         "sequence": item.sequence} for item in state.feedback if player in {item.sender, item.recipient}]
    # Actor-local opportunity keeps evicted feedback envelopes stale without
    # changing any observer's public opportunity or revealing activity timing.
    view["feedback_opportunity"] = next((item.sequence for item in state.feedback if item.sender == player), 0)
    return view


def member_view(state: EngineState, *, account_id: int, player_id: str) -> dict:
    if account_id is None:
        raise WattenEngineError("watten_actor_not_bound")
    return _personal(state, require_actor(state, EngineActor(player_id, account_id)))


def spectator_view(state: EngineState) -> dict:
    return _public(state)


def cpu_view(state: EngineState, *, player_id: str) -> dict:
    """Trusted CPU scheduler only; exactly the same personal fields as a human."""
    return _personal(state, require_actor(state, EngineActor(player_id, None)))
