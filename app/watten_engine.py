"""Internal immutable Watten phases; transport, locks and durable writes follow later.

Only trusted server code creates bindings, actors, recipes and predealt cards.
Commands still check the bound account/seat and exact phase/opportunity. A
future transport must rederive that actor after obtaining its transaction lock.
Never serialize this state to humans or CPUs: use watten_views instead.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace

from .watten_bidding import (
    BidState,
    DealParties,
    DealResult,
    Offer,
    Retourschneider,
    ScoreAccount,
    ScoreLedger,
    award_deal,
    bid,
    choose_retourschneider,
    new_score_ledger,
    respond,
    retourschneider_candidate,
)
from .watten_cards import WATTEN_NORMAL_RANKS, WATTEN_SUITS, DealtCards
from .watten_play import PlayProfile, PlayState, deal_progress, finish_deal, play_card, start_play
from .watten_rules import (
    WELI_STRIKE,
    ComparisonRules,
    WattenCall,
    ladinisch_call,
    ladinisch_reveal_events,
    round_roles,
)

# Per bound actor: another actor's private feedback must never evict your ACK
# and turn an otherwise identical public retry into an observable stale error.
ACK_LIMIT = 64
_PHASES = frozenset({"strike", "colour", "show_ready", "inspection", "play", "bid_response",
                     "deal_complete", "match_complete"})
_FEEDBACK = frozenset({"good", "bad", "unsure"})


class WattenEngineError(ValueError):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _text(value: object) -> bool:
    return type(value) is str and bool(value.strip()) and len(value) <= 160


def _number(value: object, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


@dataclass(frozen=True, slots=True)
class SeatBinding:
    player_id: str
    # None is an explicitly server-owned CPU seat, never an anonymous human.
    account_id: int | None

    def __post_init__(self):
        if not _text(self.player_id) or (self.account_id is not None and not _number(self.account_id, 1)):
            raise WattenEngineError("watten_invalid_binding")


@dataclass(frozen=True, slots=True)
class EngineRecipe:
    profile: PlayProfile
    bindings: tuple[SeatBinding, ...]
    manual_parties: tuple[tuple[str, ...], tuple[str, ...]] | None = None
    target_points: int = 11
    show_rechter: bool = False
    open_partner_hand: bool = False
    trick_history: bool = False

    def __post_init__(self):
        if not isinstance(self.profile, PlayProfile) or type(self.bindings) is not tuple:
            raise WattenEngineError("watten_invalid_recipe")
        if (len(self.bindings) != self.profile.player_count
                or not all(isinstance(item, SeatBinding) for item in self.bindings)):
            raise WattenEngineError("watten_invalid_bindings")
        players = tuple(item.player_id for item in self.bindings)
        accounts = tuple(item.account_id for item in self.bindings if item.account_id is not None)
        if len(set(players)) != len(players) or len(set(accounts)) != len(accounts):
            raise WattenEngineError("watten_duplicate_binding")
        if not _number(self.target_points, 3) or any(type(value) is not bool for value in (
                self.show_rechter, self.open_partner_hand, self.trick_history)):
            raise WattenEngineError("watten_invalid_recipe")
        if self.open_partner_hand and self.profile.blind:
            raise WattenEngineError("watten_partner_hand_requires_open")
        if self.open_partner_hand and self.profile.player_count == 2:
            raise WattenEngineError("watten_partner_hand_requires_partners")
        if self.profile.player_count == 4:
            # Manual party membership is explicit; seats must already be in
            # clockwise A+C/B+D order, as required by DealParties.
            DealParties(players, players[0], self.manual_parties)
        elif self.manual_parties is not None:
            raise WattenEngineError("watten_manual_parties_require_four")

    @property
    def gestrichen_from(self) -> int:
        # Chosen TWG W02 source policy: needing at most two points is gestrichen.
        # This is a source decision, not a new customizable house-rule option.
        return self.target_points - 2

    @property
    def seats(self) -> tuple[str, ...]:
        return tuple(binding.player_id for binding in self.bindings)


@dataclass(frozen=True, slots=True)
class EngineActor:
    """Trusted account/seat claim; None accounts authorize only bound CPU seats."""

    player_id: str
    account_id: int | None


@dataclass(frozen=True, slots=True, repr=False)
class EngineCommand:
    command_id: str
    deal_id: str
    opportunity: int
    phase: str
    kind: str
    value: str | None = None
    private_opportunity: int | None = None

    def __post_init__(self):
        if (not all(_text(value) for value in (self.command_id, self.deal_id, self.phase, self.kind))
                or not _number(self.opportunity) or (self.value is not None and not _text(self.value))
                or (self.private_opportunity is not None and not _number(self.private_opportunity))):
            raise WattenEngineError("watten_invalid_command")

    def __repr__(self):
        return f"EngineCommand(kind={self.kind!r}, opportunity={self.opportunity})"


@dataclass(frozen=True, slots=True)
class CommandAck:
    command_id: str
    deal_id: str
    opportunity: int


@dataclass(frozen=True, slots=True)
class CachedAck:
    player_id: str
    account_id: int | None
    digest: str
    ack: CommandAck


@dataclass(frozen=True, slots=True, repr=False)
class PrivateFeedback:
    sender: str
    recipient: str
    value: str
    sequence: int


@dataclass(frozen=True, slots=True, repr=False)
class EngineState:
    recipe: EngineRecipe
    deal_id: str
    deal: DealtCards
    parties: DealParties
    phase: str
    opportunity: int
    ledger: ScoreLedger
    bid_state: BidState
    normal_strike: str | None = None
    call: WattenCall | None = None
    shown: frozenset[int] = frozenset()
    acknowledged: frozenset[int] = frozenset()
    play: PlayState | None = None
    feedback: tuple[PrivateFeedback, ...] = ()
    ack_cache: tuple[CachedAck, ...] = ()

    def __post_init__(self):
        if (not isinstance(self.recipe, EngineRecipe) or not _text(self.deal_id)
                or not isinstance(self.deal, DealtCards) or not isinstance(self.parties, DealParties)
                or self.phase not in _PHASES or not _number(self.opportunity)
                or not isinstance(self.ledger, ScoreLedger) or not isinstance(self.bid_state, BidState)):
            raise WattenEngineError("watten_invalid_engine_state")
        if (len(self.deal.hands) != self.recipe.profile.player_count
                or self.parties != _parties(self.recipe, self.parties.dealer_id)
                or self.bid_state.deal_id != self.deal_id or self.bid_state.roles != self.parties
                or self.ledger.target != self.recipe.target_points):
            raise WattenEngineError("watten_engine_context_mismatch")
        roster = {member for account in self.ledger.accounts for member in account.members}
        if roster != set(self.recipe.seats):
            raise WattenEngineError("watten_engine_score_mismatch")
        expected_accounts = self.parties.parties if len(self.recipe.seats) == 4 else tuple((s,) for s in self.recipe.seats)
        if {frozenset(item.members) for item in self.ledger.accounts} != {frozenset(item) for item in expected_accounts}:
            raise WattenEngineError("watten_engine_score_mismatch")
        if self.ledger.replayed_accounts != self.ledger.accounts:
            raise WattenEngineError("watten_engine_score_mismatch")
        if (type(self.shown) is not frozenset or type(self.acknowledged) is not frozenset
                or any(type(seat) is not int for seat in (*self.shown, *self.acknowledged))
                or not self.shown <= self.inspectors or not self.acknowledged <= self.shown):
            raise WattenEngineError("watten_invalid_inspection")
        if self.recipe.profile.determination == "normal":
            if self.shown or self.acknowledged or self.phase in {"show_ready", "inspection"}:
                raise WattenEngineError("watten_invalid_normal_phase")
            if self.phase == "strike":
                if self.normal_strike is not None or self.call is not None:
                    raise WattenEngineError("watten_invalid_normal_phase")
            elif self.phase == "colour":
                if self.normal_strike not in (*WATTEN_NORMAL_RANKS, WELI_STRIKE) or self.call is not None:
                    raise WattenEngineError("watten_invalid_normal_phase")
            elif self.call is None or self.normal_strike != self.call.strike_rank:
                raise WattenEngineError("watten_invalid_normal_phase")
            if self.recipe.profile.critical and self.normal_strike == WELI_STRIKE:
                raise WattenEngineError("watten_free_weli_strike_with_critical")
        else:
            if self.normal_strike is not None or self.phase in {"strike", "colour"}:
                raise WattenEngineError("watten_invalid_ladinisch_phase")
            if self.phase == "show_ready":
                if self.shown == self.inspectors or self.acknowledged or self.call is not None:
                    raise WattenEngineError("watten_invalid_ladinisch_phase")
            elif self.shown != self.inspectors or self.call != ladinisch_call(self.deal, dealer=self.dealer_seat):
                raise WattenEngineError("watten_invalid_ladinisch_phase")
            if self.phase == "inspection":
                if self.acknowledged == self.inspectors:
                    raise WattenEngineError("watten_invalid_ladinisch_phase")
            elif self.phase != "show_ready" and self.acknowledged != self.inspectors:
                raise WattenEngineError("watten_inspection_not_finished")
        active = self.phase in {"play", "bid_response", "deal_complete", "match_complete"}
        if active:
            if (not isinstance(self.play, PlayState) or self.play.deal_id != self.deal_id
                    or self.play.deal != self.deal or self.play.parties != self.parties
                    or self.play.profile != self.recipe.profile or self.play.call != self.call):
                raise WattenEngineError("watten_engine_play_mismatch")
        elif self.play is not None or self.bid_state != BidState(self.deal_id, self.parties):
            raise WattenEngineError("watten_unstarted_play")
        terminal = self.phase in {"deal_complete", "match_complete"}
        if terminal:
            if (self.bid_state.result is None or not self.ledger.applied_results
                    or self.ledger.applied_results[-1] != self.bid_state.result
                    or bool(self.ledger.winners) != (self.phase == "match_complete")):
                raise WattenEngineError("watten_unscored_terminal")
            if self.bid_state.result.reason == "tricks" and self.play.winning_party != self.bid_state.result.winning_party:
                raise WattenEngineError("watten_terminal_winner_mismatch")
            if self.bid_state.result.reason == "go" and self.play.ended:
                raise WattenEngineError("watten_terminal_winner_mismatch")
        elif (self.bid_state.result is not None or self.ledger.winners
              or any(result.deal_id == self.deal_id for result in self.ledger.applied_results)):
            raise WattenEngineError("watten_invalid_active_score")
        if active and not terminal:
            if self.play.ended or bool(self.bid_state.pending) != (self.phase == "bid_response"):
                raise WattenEngineError("watten_invalid_play_phase")
        if active and not self.play.plays and (self.bid_state.pending is not None
                                               or self.bid_state.last_offering_party is not None
                                               or self.bid_state.accepted_stake != 2):
            raise WattenEngineError("watten_first_card_required")
        if type(self.feedback) is not tuple or len(self.feedback) > len(self.recipe.seats):
            raise WattenEngineError("watten_invalid_feedback")
        if self.feedback and self.phase != "bid_response":
            raise WattenEngineError("watten_invalid_feedback")
        senders = []
        for item in self.feedback:
            if (not isinstance(item, PrivateFeedback) or item.value not in _FEEDBACK
                    or not _number(item.sequence, 1) or partner_id(self, item.sender) != item.recipient
                    or self.bid_state.pending is None
                    or self.parties.party_of(item.sender) == self.bid_state.pending.party):
                raise WattenEngineError("watten_invalid_feedback")
            senders.append(item.sender)
        if len(set(senders)) != len(senders):
            raise WattenEngineError("watten_invalid_feedback")
        if type(self.ack_cache) is not tuple or len(self.ack_cache) > ACK_LIMIT * len(self.recipe.seats):
            raise WattenEngineError("watten_invalid_ack_cache")
        keys = []
        for item in self.ack_cache:
            if (not isinstance(item, CachedAck) or not isinstance(item.ack, CommandAck)
                    or not _text(item.ack.command_id) or not _text(item.ack.deal_id)
                    or not _number(item.ack.opportunity) or item.ack.opportunity > self.opportunity
                    or type(item.digest) is not str or len(item.digest) != 64
                    or any(char not in "0123456789abcdef" for char in item.digest)):
                raise WattenEngineError("watten_invalid_ack_cache")
            require_actor(self, EngineActor(item.player_id, item.account_id))
            keys.append((item.player_id, item.account_id, item.ack.command_id))
        if len(set(keys)) != len(keys):
            raise WattenEngineError("watten_invalid_ack_cache")
        if any(sum(item.player_id == player for item in self.ack_cache) > ACK_LIMIT for player in self.recipe.seats):
            raise WattenEngineError("watten_invalid_ack_cache")

    @property
    def dealer_seat(self) -> int:
        return self.recipe.seats.index(self.parties.dealer_id)

    @property
    def inspectors(self) -> frozenset[int]:
        return frozenset((self.dealer_seat, (self.dealer_seat + 1) % len(self.recipe.seats)))

    @property
    def thanks(self) -> tuple[int, ...]:
        if self.recipe.profile.determination != "ladinisch" or self.call is None:
            return ()
        return tuple(event.seat for event in ladinisch_reveal_events(
            self.deal, dealer=self.dealer_seat,
            rules=ComparisonRules(self.call, critical=self.recipe.profile.critical),
            blind=self.recipe.profile.blind, shown_seats=self.shown,
        ))

    def __repr__(self):
        return f"EngineState(phase={self.phase!r}, opportunity={self.opportunity})"


@dataclass(frozen=True, slots=True, repr=False)
class EngineTransition:
    state: EngineState
    ack: CommandAck
    # Normal public announcements are delivered once, never cached/replayed.
    # Thanks alone is also retained as an owner-approved public transcript.
    public_events: tuple[tuple[str, int, str | None], ...] = ()
    replayed: bool = False

    def __repr__(self):
        return f"EngineTransition(opportunity={self.ack.opportunity}, replayed={self.replayed})"


def _parties(recipe: EngineRecipe, dealer_id: str) -> DealParties:
    if dealer_id not in recipe.seats:
        raise WattenEngineError("watten_invalid_dealer")
    index, count = recipe.seats.index(dealer_id), len(recipe.seats)
    following = recipe.seats[(index + 1) % count]
    groups = recipe.manual_parties if count == 4 else (
        ((dealer_id,), (following,)) if count == 2 else
        ((dealer_id, recipe.seats[(index + 2) % count]), (following,))
    )
    return DealParties(recipe.seats, dealer_id, groups)


def require_actor(state: EngineState, actor: EngineActor) -> int:
    if (not isinstance(actor, EngineActor) or not _text(actor.player_id)
            or (actor.account_id is not None and not _number(actor.account_id, 1))):
        raise WattenEngineError("watten_actor_not_bound")
    for seat, binding in enumerate(state.recipe.bindings):
        if binding.player_id == actor.player_id and binding.account_id == actor.account_id:
            return seat
    raise WattenEngineError("watten_actor_not_bound")


def partner_id(state: EngineState, player_id: str) -> str | None:
    members = state.parties.parties[state.parties.party_of(player_id)]
    return next((member for member in members if member != player_id), None)


def gestrichen_players(state: EngineState) -> frozenset[str]:
    return frozenset(member for account in state.ledger.accounts
                     if account.points >= state.recipe.gestrichen_from for member in account.members)


def retourschneider_decider(state: EngineState, members: tuple[str, ...]) -> str:
    """Keep a mixed team's optional comeback decision with its human player."""
    humans = tuple(binding.player_id for binding in state.recipe.bindings
                   if binding.player_id in members and binding.account_id is not None)
    return humans[0] if len(humans) == 1 else state.parties.decider(state.parties.party_of(members[0]))


def start_match(recipe: EngineRecipe, deal_id: str, deal: DealtCards, *, first_dealer: str) -> EngineState:
    """First dealer is a trusted server draw result; this module never draws it."""
    parties = _parties(recipe, first_dealer)
    return EngineState(recipe, deal_id, deal, parties,
                       "strike" if recipe.profile.determination == "normal" else "show_ready", 0,
                       new_score_ledger(parties, target=recipe.target_points), BidState(deal_id, parties))


def next_deal(state: EngineState, deal_id: str, deal: DealtCards) -> EngineState:
    """Trusted server transition after a scored deal; no new teams or shuffle."""
    if state.phase != "deal_complete":
        raise WattenEngineError("watten_next_deal_unavailable")
    if retourschneider_candidate(state.ledger) is not None:
        raise WattenEngineError("watten_retourschneider_decision_pending")
    if deal_id == state.deal_id or any(result.deal_id == deal_id for result in state.ledger.applied_results):
        raise WattenEngineError("watten_deal_id_reused")
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    parties = _parties(state.recipe, state.recipe.seats[roles.next_dealer])
    return EngineState(state.recipe, deal_id, deal, parties,
                       "strike" if state.recipe.profile.determination == "normal" else "show_ready",
                       state.opportunity + 1, state.ledger, BidState(deal_id, parties), ack_cache=state.ack_cache)


def _finish(state: EngineState, play: PlayState, bidding: BidState) -> EngineState:
    ledger = award_deal(state.ledger, bidding)
    return replace(state, play=play, bid_state=bidding, ledger=ledger,
                   phase="match_complete" if ledger.winners else "deal_complete")


def _digest(command: EngineCommand) -> str:
    data = [command.deal_id, command.opportunity, command.phase, command.kind, command.value, command.private_opportunity]
    return hashlib.sha256(json.dumps(data, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def apply_command(state: EngineState, actor: EngineActor, command: EngineCommand) -> EngineTransition:
    """Reject stale inputs without consuming opportunity; replay only safe ACKs.

    An evicted command with its original envelope fails the ordinary stale
    opportunity check. A duplicate never reemits a reveal or call event: the
    caller may send a new *current* allowed view. Cache lookup and all writes
    must later be inside the same durable per-table transaction lock.
    """
    seat = require_actor(state, actor)
    if not isinstance(command, EngineCommand):
        raise WattenEngineError("watten_invalid_command")
    digest = _digest(command)
    for cached in state.ack_cache:
        if (cached.player_id, cached.account_id, cached.ack.command_id) == (actor.player_id, actor.account_id, command.command_id):
            if cached.digest != digest:
                raise WattenEngineError("watten_command_conflict")
            return EngineTransition(state, cached.ack, replayed=True)
    if (command.deal_id != state.deal_id or command.opportunity != state.opportunity
            or command.phase != state.phase):
        raise WattenEngineError("watten_stale_opportunity")
    kind, value, events = command.kind, command.value, ()
    if kind != "partner_feedback" and command.private_opportunity is not None:
        raise WattenEngineError("watten_invalid_command")
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    if kind == "announce_strike" and state.phase == "strike":
        if seat != roles.strike_announcer:
            raise WattenEngineError("watten_announcer_required")
        if value not in (*WATTEN_NORMAL_RANKS, WELI_STRIKE):
            raise WattenEngineError("watten_invalid_strike")
        if value == WELI_STRIKE and state.recipe.profile.critical:
            raise WattenEngineError("watten_free_weli_strike_with_critical")
        changed = replace(state, normal_strike=value, phase="colour")
        events = (("strike_announced", seat, value),)
    elif kind == "announce_colour" and state.phase == "colour":
        if seat != roles.suit_announcer:
            raise WattenEngineError("watten_announcer_required")
        if value not in WATTEN_SUITS:
            raise WattenEngineError("watten_invalid_trump_suit")
        call = WattenCall(state.normal_strike, value)
        play = start_play(state.deal_id, state.deal, state.parties, state.recipe.profile, call=call)
        changed = replace(state, call=call, play=play, phase="play")
        events = (("colour_announced", seat, value),)
    elif kind == "show_ready" and state.phase == "show_ready":
        # Accepted publication of this actor's original bottom into the two-
        # knower window. Both publications are required before any reveal;
        # inspection_ack then irrevocably closes that actor's own window.
        if seat not in state.inspectors or seat in state.shown or value is not None:
            raise WattenEngineError("watten_show_unavailable")
        shown = state.shown | {seat}
        changed = replace(state, shown=shown, call=ladinisch_call(state.deal, dealer=state.dealer_seat)
                          if shown == state.inspectors else None,
                          phase="inspection" if shown == state.inspectors else "show_ready")
        events = tuple(("watten_thanks", thanked, None) for thanked in changed.thanks)
    elif kind == "inspection_ack" and state.phase == "inspection":
        if seat not in state.inspectors or seat in state.acknowledged or value is not None:
            raise WattenEngineError("watten_inspection_unavailable")
        acknowledged = state.acknowledged | {seat}
        if acknowledged == state.inspectors:
            play = start_play(state.deal_id, state.deal, state.parties, state.recipe.profile, call=state.call)
            changed = replace(state, acknowledged=acknowledged, play=play, phase="play")
            if not state.recipe.profile.blind:
                # Open Ladinisch officially informs every seat. Non-inspecting
                # partners get the call once, not the other original bottoms.
                events = (("strike_announced", roles.strike_announcer, state.call.strike_rank),
                          ("colour_announced", roles.suit_announcer, state.call.trump_suit))
        else:
            changed = replace(state, acknowledged=acknowledged)
    elif kind == "play_card" and state.phase == "play":
        play = play_card(state.play, state.bid_state, actor.player_id, value)
        changed = _finish(state, play, finish_deal(play, state.bid_state)) if play.ended else replace(state, play=play)
    elif kind == "bid" and state.phase == "play" and value is None:
        bidding = bid(state.bid_state, actor.player_id, deal_progress(state.play), gestrichen=gestrichen_players(state))
        changed = replace(state, bid_state=bidding, phase="bid_response", feedback=())
    elif kind == "respond" and state.phase == "bid_response":
        bidding = respond(state.bid_state, actor.player_id, value, deal_progress(state.play))
        cleared = replace(state, feedback=())
        changed = _finish(cleared, state.play, bidding) if bidding.result else replace(
            cleared, bid_state=bidding, phase="bid_response" if bidding.pending else "play")
    elif kind == "retourschneider" and state.phase == "deal_complete":
        members = retourschneider_candidate(state.ledger)
        if (members is None or value not in {"accept", "decline"}
                or actor.player_id != retourschneider_decider(state, members)):
            raise WattenEngineError("watten_retourschneider_unavailable")
        changed = replace(state, ledger=choose_retourschneider(state.ledger, members, accept=value == "accept"))
    elif kind == "partner_feedback" and state.phase == "bid_response":
        partner = partner_id(state, actor.player_id)
        if (partner is None or value not in _FEEDBACK
                or state.parties.party_of(actor.player_id) == state.bid_state.pending.party
                or any(item.sender == actor.player_id for item in state.feedback)):
            raise WattenEngineError("watten_feedback_unavailable")
        sequence = next((item.sequence + 1 for item in state.feedback if item.sender == actor.player_id), 1)
        if command.private_opportunity != sequence - 1:
            raise WattenEngineError("watten_stale_opportunity")
        item = PrivateFeedback(actor.player_id, partner, value, sequence)
        changed = replace(state, feedback=(*tuple(item for item in state.feedback if item.sender != actor.player_id), item))
    else:
        raise WattenEngineError("watten_action_unavailable")
    if kind != "partner_feedback":
        changed = replace(changed, opportunity=state.opportunity + 1)
    ack = CommandAck(command.command_id, state.deal_id, changed.opportunity)
    cached = CachedAck(actor.player_id, actor.account_id, digest, ack)
    own_cache = tuple(item for item in state.ack_cache if item.player_id == actor.player_id)
    other_cache = tuple(item for item in state.ack_cache if item.player_id != actor.player_id)
    changed = replace(changed, ack_cache=(*other_cache, *(*own_cache, cached)[-ACK_LIMIT:]))
    return EngineTransition(changed, ack, events)


def _roles_payload(roles: DealParties) -> dict:
    return {"seats": list(roles.seats), "dealer_id": roles.dealer_id, "parties": [list(party) for party in roles.parties]}


def _result_payload(result: DealResult | None) -> dict | None:
    return None if result is None else {"deal_id": result.deal_id, "roles": _roles_payload(result.roles),
                                       "winning_party": result.winning_party, "points": result.points, "reason": result.reason}


def storage_payload(state: EngineState) -> dict:
    """Explicit JSON schema for PRIVATE storage, never a response or log value."""
    recipe, bidding = state.recipe, state.bid_state
    return {
        "schema": 1,
        "recipe": {"profile": {"player_count": recipe.profile.player_count, "determination": recipe.profile.determination,
                               "blind": recipe.profile.blind, "critical": recipe.profile.critical},
                   "bindings": [{"player_id": binding.player_id, "account_id": binding.account_id} for binding in recipe.bindings],
                   "manual_parties": None if recipe.manual_parties is None else [list(party) for party in recipe.manual_parties],
                   "target_points": recipe.target_points, "show_rechter": recipe.show_rechter,
                   "open_partner_hand": recipe.open_partner_hand, "trick_history": recipe.trick_history},
        "deal": {"id": state.deal_id, "dealer_id": state.parties.dealer_id,
                 "hands": [list(hand) for hand in state.deal.hands], "stock": list(state.deal.stock),
                 "bottom_cards": list(state.deal.bottom_cards)},
        "phase": state.phase, "opportunity": state.opportunity, "normal_strike": state.normal_strike,
        "call": None if state.call is None else {"strike_rank": state.call.strike_rank, "trump_suit": state.call.trump_suit},
        "shown": sorted(state.shown), "acknowledged": sorted(state.acknowledged),
        "plays": None if state.play is None else list(state.play.plays),
        "bid": {"accepted_stake": bidding.accepted_stake, "last_offering_party": bidding.last_offering_party,
                "pending": None if bidding.pending is None else {"party": bidding.pending.party, "points": bidding.pending.points},
                "result": _result_payload(bidding.result)},
        "ledger": {"target": state.ledger.target, "accounts": [{"members": list(account.members), "points": account.points}
                                                                for account in state.ledger.accounts],
                   "applied_results": [_result_payload(result) for result in state.ledger.applied_results],
                   "retourschneider": retourschneider_payload(state.ledger.retourschneider)},
        "feedback": [{"sender": item.sender, "recipient": item.recipient, "value": item.value, "sequence": item.sequence}
                     for item in state.feedback],
        "ack_cache": [{"player_id": item.player_id, "account_id": item.account_id, "digest": item.digest,
                       "ack": {"command_id": item.ack.command_id, "deal_id": item.ack.deal_id,
                               "opportunity": item.ack.opportunity}} for item in state.ack_cache],
    }


def _object(value: object, keys: str, optional: frozenset[str] = frozenset()) -> dict:
    required = set(keys.split())
    if type(value) is not dict or not required <= set(value) or set(value) - required - optional:
        raise WattenEngineError("watten_invalid_storage")
    return value


def _list(value: object) -> list:
    if type(value) is not list:
        raise WattenEngineError("watten_invalid_storage")
    return value


def _restore_roles(value: dict) -> DealParties:
    value = _object(value, "seats dealer_id parties")
    return DealParties(tuple(_list(value["seats"])), value["dealer_id"], tuple(tuple(_list(p)) for p in _list(value["parties"])))


def _restore_result(value: dict | None) -> DealResult | None:
    if value is None:
        return None
    value = _object(value, "deal_id roles winning_party points reason")
    return DealResult(value["deal_id"], _restore_roles(value["roles"]), value["winning_party"], value["points"], value["reason"])


def retourschneider_payload(choice: Retourschneider | None) -> dict | None:
    return None if choice is None else {"members": list(choice.members), "after_deal_id": choice.after_deal_id,
                                       "erased_points": choice.erased_points, "accepted": choice.accepted}


def restore_retourschneider(value: dict | None) -> Retourschneider | None:
    if value is None:
        return None
    raw = _object(value, "members after_deal_id erased_points accepted")
    return Retourschneider(tuple(_list(raw["members"])), raw["after_deal_id"], raw["erased_points"], raw["accepted"])


def restore_storage(value: dict) -> EngineState:
    """Validate/reconstruct our private schema, replaying card history for legality.

    This is not a client import endpoint. Durable transaction integrity and
    access control remain the responsibility of the later storage adapter.
    """
    value = _object(value, "schema recipe deal phase opportunity normal_strike call shown acknowledged plays bid ledger feedback ack_cache")
    if type(value["schema"]) is not int or value["schema"] != 1:
        raise WattenEngineError("watten_invalid_storage")
    raw = _object(value["recipe"], "profile bindings manual_parties target_points show_rechter open_partner_hand trick_history")
    profile = PlayProfile(**_object(raw["profile"], "player_count determination blind critical"))
    bindings = tuple(SeatBinding(**_object(item, "player_id account_id")) for item in _list(raw["bindings"]))
    groups = None if raw["manual_parties"] is None else tuple(tuple(_list(party)) for party in _list(raw["manual_parties"]))
    recipe = EngineRecipe(profile, bindings, groups, raw["target_points"], raw["show_rechter"], raw["open_partner_hand"], raw["trick_history"])
    raw_deal = _object(value["deal"], "id dealer_id hands stock bottom_cards")
    deal = DealtCards(tuple(tuple(_list(hand)) for hand in _list(raw_deal["hands"])),
                     tuple(_list(raw_deal["stock"])), tuple(_list(raw_deal["bottom_cards"])))
    parties = _parties(recipe, raw_deal["dealer_id"])
    call = None if value["call"] is None else WattenCall(**_object(value["call"], "strike_rank trump_suit"))
    raw_bid = _object(value["bid"], "accepted_stake last_offering_party pending result")
    pending = None if raw_bid["pending"] is None else Offer(**_object(raw_bid["pending"], "party points"))
    bidding = BidState(raw_deal["id"], parties, raw_bid["accepted_stake"], raw_bid["last_offering_party"],
                       pending, _restore_result(raw_bid["result"]))
    raw_ledger = _object(value["ledger"], "target accounts applied_results", frozenset({"retourschneider"}))
    accounts = []
    for item in _list(raw_ledger["accounts"]):
        item = _object(item, "members points")
        accounts.append(ScoreAccount(tuple(_list(item["members"])), item["points"]))
    ledger = ScoreLedger(raw_ledger["target"], tuple(accounts), tuple(_restore_result(item) for item in _list(raw_ledger["applied_results"])),
                         restore_retourschneider(raw_ledger.get("retourschneider")))
    feedback = tuple(PrivateFeedback(**_object(item, "sender recipient value sequence")) for item in _list(value["feedback"]))
    # Older checkpoints allowed unsolicited feedback outside a received bid.
    # Those messages confer no new permission under the restricted flow.
    feedback = tuple(item for item in feedback if value["phase"] == "bid_response" and pending is not None
                     and parties.party_of(item.sender) != pending.party)
    cache = []
    for item in _list(value["ack_cache"]):
        item = _object(item, "player_id account_id digest ack")
        cache.append(CachedAck(item["player_id"], item["account_id"], item["digest"],
                               CommandAck(**_object(item["ack"], "command_id deal_id opportunity"))))
    inspection = []
    for key in ("shown", "acknowledged"):
        seats = _list(value[key])
        if any(type(seat) is not int for seat in seats) or len(set(seats)) != len(seats):
            raise WattenEngineError("watten_invalid_storage")
        inspection.append(frozenset(seats))
    play = None if value["plays"] is None else PlayState(raw_deal["id"], deal, parties, profile, call, tuple(_list(value["plays"])))
    return EngineState(recipe, raw_deal["id"], deal, parties, value["phase"], value["opportunity"], ledger, bidding,
                       value["normal_strike"], call, *inspection, play, feedback, tuple(cache))
