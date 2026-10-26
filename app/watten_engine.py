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
    RoundRoles,
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
    schoeneres_enabled: bool = False
    schlagwechsel_enabled: bool = True

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
                self.show_rechter, self.open_partner_hand, self.trick_history, self.schoeneres_enabled,
                self.schlagwechsel_enabled)):
            raise WattenEngineError("watten_invalid_recipe")
        if self.schoeneres_enabled and self.profile.player_count == 3:
            raise WattenEngineError("watten_schoeneres_requires_two_callers")
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


@dataclass(frozen=True, slots=True)
class PreplayRequest:
    kind: str
    requester: int
    responder: int


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
    deal_revision: int = 0
    call_swapped: bool = False
    preplay_request: PreplayRequest | None = None
    bloedeln: bool = False
    retour_accepted_by: tuple[str, ...] = ()
    discarded_bid_increases: int = 0
    # None is reserved for other modes and already-started legacy rounds.
    # Optional request/answer receipts; one explicit No seals this deal.
    bloedeln_decisions: tuple[tuple[int, bool], ...] | None = None

    def __post_init__(self):
        if (not isinstance(self.recipe, EngineRecipe) or not _text(self.deal_id)
                or not isinstance(self.deal, DealtCards) or not isinstance(self.parties, DealParties)
                or self.phase not in _PHASES or not _number(self.opportunity)
                or not _number(self.discarded_bid_increases) or self.discarded_bid_increases > self.opportunity
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
        if (not _number(self.deal_revision) or self.deal_revision > self.opportunity
                or type(self.call_swapped) is not bool or type(self.bloedeln) is not bool
                or (self.call_swapped and (self.recipe.profile.determination != "normal"
                                          or self.recipe.profile.blind or len(self.recipe.seats) not in {2, 4}))
                or (self.bloedeln and (not self.recipe.profile.blind or len(self.recipe.seats) != 4))):
            raise WattenEngineError("watten_invalid_preplay")
        request = self.preplay_request
        if request is not None:
            if (not isinstance(request, PreplayRequest) or not preplay_available(self, request.kind)
                    or type(request.requester) is not int or type(request.responder) is not int
                    or {request.requester, request.responder} != set(preplay_seats(self, request.kind))):
                raise WattenEngineError("watten_invalid_preplay")
        choices = self.bloedeln_decisions
        eligible = preplay_seats(self, "bloedeln")
        required = self.recipe.profile.blind and len(self.recipe.seats) == 4
        if choices is None:
            if required and not _round_already_begun(self):
                raise WattenEngineError("watten_invalid_bloedeln_consent")
        elif (not required or type(choices) is not tuple
              or any(type(item) is not tuple or len(item) != 2 or type(item[0]) is not int
                     or item[0] not in eligible or type(item[1]) is not bool for item in choices)
              or tuple(sorted(choices)) != choices or len({seat for seat, _ in choices}) != len(choices)
              or self.bloedeln != (len(choices) == 2 and all(accepted for _, accepted in choices))):
            raise WattenEngineError("watten_invalid_bloedeln_consent")
        if (choices and len(choices) == 1 and choices[0][1] and (
                request is None or request.kind != "bloedeln" or request.requester != choices[0][0])):
            raise WattenEngineError("watten_invalid_bloedeln_consent")
        if request is not None and request.kind == "bloedeln" and choices != ((request.requester, True),):
            raise WattenEngineError("watten_invalid_bloedeln_consent")
        candidate = retourschneider_candidate(self.ledger)
        if (type(self.retour_accepted_by) is not tuple or any(type(player) is not str for player in self.retour_accepted_by)
                or len(set(self.retour_accepted_by)) != len(self.retour_accepted_by)
                or (self.retour_accepted_by and (self.phase != "deal_complete" or candidate is None
                                                or not set(self.retour_accepted_by) < set(candidate)))):
            raise WattenEngineError("watten_invalid_retourschneider_votes")
        if active:
            if (not isinstance(self.play, PlayState) or self.play.deal_id != self.deal_id
                    or self.play.deal != self.deal or self.play.parties != self.parties
                    or self.play.profile != self.recipe.profile or self.play.call != self.call
                    or self.play.forced_opening != bloedeln_cards(self)):
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
        if type(self.feedback) is not tuple or len(self.feedback) > len(self.recipe.seats):
            raise WattenEngineError("watten_invalid_feedback")
        if self.feedback and self.phase != "bid_response":
            raise WattenEngineError("watten_invalid_feedback")
        senders = []
        for item in self.feedback:
            if (not isinstance(item, PrivateFeedback) or item.value not in _FEEDBACK
                    or not _number(item.sequence, 1) or partner_feedback_recipient(self, item.sender) != item.recipient
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


def announcement_roles(state: EngineState) -> RoundRoles:
    """Accepted caller exchange changes announcements, never the original lead."""
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    return replace(roles, strike_announcer=roles.suit_announcer, suit_announcer=roles.strike_announcer) if state.call_swapped else roles


def schlagwechsel_profile_supported(profile: PlayProfile) -> bool:
    return profile.determination == "normal" and not profile.blind and profile.player_count in {2, 4}


def preplay_available(state: EngineState, kind: str) -> bool:
    if state.phase not in {"strike", "colour", "show_ready", "inspection", "play"} or (state.play and state.play.plays):
        return False
    profile = state.recipe.profile
    if kind == "schoeneres":
        return state.recipe.schoeneres_enabled and profile.player_count in {2, 4}
    if kind == "schlagwechsel":
        return state.recipe.schlagwechsel_enabled and state.phase == "strike" and schlagwechsel_profile_supported(profile)
    return (kind == "bloedeln" and profile.blind and profile.player_count == 4
            and state.bloedeln_decisions is not None and len(state.bloedeln_decisions) < 2
            and not any(not accepted for _, accepted in state.bloedeln_decisions) and not state.bloedeln)


def preplay_seats(state: EngineState, kind: str) -> tuple[int, ...]:
    if kind == "bloedeln":
        return tuple(seat for seat in range(len(state.recipe.seats)) if seat not in state.inspectors)
    roles = announcement_roles(state)
    return tuple(sorted({roles.strike_announcer, roles.suit_announcer}))


def bloedeln_cards(state: EngineState) -> tuple[tuple[int, str], ...]:
    return tuple((seat, state.deal.bottom_cards[seat]) for seat in range(len(state.recipe.seats))
                 if seat not in state.inspectors) if state.bloedeln else ()


def _round_already_begun(state: EngineState) -> bool:
    return bool((state.play and state.play.plays) or state.bid_state.pending is not None
                or state.bid_state.accepted_stake > 2 or state.bid_state.result is not None)


def bloedeln_pending(state: EngineState) -> bool:
    return state.preplay_request is not None and state.preplay_request.kind == "bloedeln"


def bloedeln_status(state: EngineState) -> str | None:
    if state.bloedeln_decisions is None:
        return None
    if bloedeln_pending(state):
        return "pending"
    if state.bloedeln:
        return "accepted"
    if any(not accepted for _, accepted in state.bloedeln_decisions):
        return "declined"
    return "available" if preplay_available(state, "bloedeln") else None


def _reset_call(state: EngineState, **changes) -> EngineState:
    return replace(state, normal_strike=None, call=None, play=None, shown=frozenset(), acknowledged=frozenset(),
                   bid_state=BidState(state.deal_id, state.parties),
                   discarded_bid_increases=state.discarded_bid_increases + state.bid_state.accepted_stake - 2,
                   feedback=(), preplay_request=None, deal_revision=state.deal_revision + 1,
                   bloedeln_decisions=() if state.bloedeln_decisions is None and state.recipe.profile.blind else state.bloedeln_decisions,
                   phase="strike" if state.recipe.profile.determination == "normal" else "show_ready", **changes)


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


def partner_feedback_recipient(state: EngineState, player_id: str) -> str | None:
    """In blind play only the uninformed partner advises the deciding knower."""
    if (state.recipe.profile.blind
            and player_id == state.parties.decider(state.parties.party_of(player_id))):
        return None
    return partner_id(state, player_id)


def gestrichen_players(state: EngineState) -> frozenset[str]:
    choice = state.ledger.retourschneider
    comeback = frozenset(choice.members) if choice is not None and choice.accepted and not state.ledger.winners else frozenset()
    return frozenset(member for account in state.ledger.accounts
                     if account.points >= state.recipe.gestrichen_from for member in account.members if member not in comeback)


def retourschneider_decider(state: EngineState, members: tuple[str, ...]) -> str:
    """Keep a mixed team's optional comeback decision with its human player."""
    humans = tuple(binding.player_id for binding in state.recipe.bindings
                   if binding.player_id in members and binding.account_id is not None)
    return humans[0] if len(humans) == 1 else state.parties.decider(state.parties.party_of(members[0]))


def retourschneider_actors(state: EngineState, members: tuple[str, ...]) -> tuple[str, ...]:
    """A mixed team follows its human; older saved yes-votes may finish mirroring."""
    humans = tuple(binding.player_id for binding in state.recipe.bindings
                   if binding.player_id in members and binding.account_id is not None)
    if len(humans) != 1:
        return members
    if humans[0] in state.retour_accepted_by:
        return tuple(member for member in members if member not in humans)
    return humans


def retourschneider_offer(state: EngineState) -> tuple[str, ...] | None:
    """Only a team with a bound human may receive the optional challenge."""
    members = retourschneider_candidate(state.ledger)
    return members if members is not None and any(
        binding.player_id in members and binding.account_id is not None for binding in state.recipe.bindings) else None


def start_match(recipe: EngineRecipe, deal_id: str, deal: DealtCards, *, first_dealer: str) -> EngineState:
    """First dealer is a trusted server draw result; this module never draws it."""
    parties = _parties(recipe, first_dealer)
    return EngineState(recipe, deal_id, deal, parties,
                       "strike" if recipe.profile.determination == "normal" else "show_ready", 0,
                       new_score_ledger(parties, target=recipe.target_points), BidState(deal_id, parties),
                       bloedeln_decisions=() if recipe.profile.blind and len(recipe.seats) == 4 else None)


def next_deal(state: EngineState, deal_id: str, deal: DealtCards) -> EngineState:
    """Trusted server transition after a scored deal; no new teams or shuffle."""
    if state.phase != "deal_complete":
        raise WattenEngineError("watten_next_deal_unavailable")
    if retourschneider_offer(state) is not None:
        raise WattenEngineError("watten_retourschneider_decision_pending")
    if deal_id == state.deal_id or any(result.deal_id == deal_id for result in state.ledger.applied_results):
        raise WattenEngineError("watten_deal_id_reused")
    roles = round_roles(len(state.recipe.seats), state.dealer_seat, determination=state.recipe.profile.determination)
    parties = _parties(state.recipe, state.recipe.seats[roles.next_dealer])
    return EngineState(state.recipe, deal_id, deal, parties,
                       "strike" if state.recipe.profile.determination == "normal" else "show_ready",
                       state.opportunity + 1, state.ledger, BidState(deal_id, parties), ack_cache=state.ack_cache,
                       discarded_bid_increases=state.discarded_bid_increases,
                       bloedeln_decisions=() if state.recipe.profile.blind and len(state.recipe.seats) == 4 else None)


def _finish(state: EngineState, play: PlayState, bidding: BidState) -> EngineState:
    ledger = award_deal(state.ledger, bidding)
    return replace(state, play=play, bid_state=bidding, ledger=ledger,
                   phase="match_complete" if ledger.winners else "deal_complete")


def play_forced_openings(state: EngineState) -> EngineState:
    """Play consented original bottoms when their first-trick turns arrive.

    This is a trusted consequence of the preceding transition, with no card
    choice or extra actor command. The caller advances the public opportunity
    and commits the resulting history together with that transition. Pending
    preplay decisions and bids retain their ordinary freeze semantics.
    """
    if state.phase != "play" or state.preplay_request is not None or state.play.tricks:
        return state
    play = state.play
    forced = dict(play.forced_opening)
    while not play.tricks and (card := forced.get(play.current_seat)) is not None:
        play = play_card(play, state.bid_state, play.current_player_id, card)
    return state if play is state.play else replace(state, play=play)


def _digest(command: EngineCommand) -> str:
    data = [command.deal_id, command.opportunity, command.phase, command.kind, command.value, command.private_opportunity]
    return hashlib.sha256(json.dumps(data, separators=(",", ":"), ensure_ascii=True).encode("ascii")).hexdigest()


def apply_command(state: EngineState, actor: EngineActor, command: EngineCommand, *,
                  replacement_deal: DealtCards | None = None) -> EngineTransition:
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
    roles = announcement_roles(state)
    if kind in {"bloedeln_accept", "bloedeln_decline"}:
        # Older clients may answer with these names, but can never create a
        # vote without an actual request or answer for its other participant.
        if not bloedeln_pending(state):
            raise WattenEngineError("watten_bloedeln_choice_unavailable")
        kind = "preplay_accept" if kind == "bloedeln_accept" else "preplay_decline"
    if bloedeln_pending(state) and kind in {"preplay_accept", "preplay_decline"}:
        request = state.preplay_request
        if seat != request.responder or value is not None:
            raise WattenEngineError("watten_preplay_response_required")
        enabled = kind == "preplay_accept"
        choices = tuple(sorted(((request.requester, True), (seat, enabled))))
        forced = tuple((index, state.deal.bottom_cards[index]) for index in preplay_seats(state, "bloedeln")) if enabled else ()
        changed = replace(state, preplay_request=None, bloedeln_decisions=choices, bloedeln=enabled,
                          play=replace(state.play, forced_opening=forced) if state.play else None)
    elif state.preplay_request is not None and not (
            bloedeln_pending(state) and kind in {"show_ready", "inspection_ack", "play_card", "bid"}):
        request = state.preplay_request
        if seat != request.responder or kind not in {"preplay_accept", "preplay_decline"} or value is not None:
            raise WattenEngineError("watten_preplay_response_required")
        changed = replace(state, preplay_request=None)
        if kind == "preplay_accept":
            if request.kind == "schoeneres":
                callers = preplay_seats(state, request.kind)
                if (not isinstance(replacement_deal, DealtCards) or len(replacement_deal.hands) != len(state.recipe.seats)
                        or any(replacement_deal.hands[index] != state.deal.hands[index]
                               for index in range(len(state.recipe.seats)) if index not in callers)):
                    raise WattenEngineError("watten_replacement_deal_required")
                changed = _reset_call(state, deal=replacement_deal)
            elif request.kind == "schlagwechsel":
                changed = _reset_call(state, call_swapped=not state.call_swapped)
    elif kind.startswith("request_"):
        feature = kind.removeprefix("request_")
        if value is not None or not preplay_available(state, feature) or seat not in preplay_seats(state, feature):
            raise WattenEngineError("watten_preplay_unavailable")
        responder = next(index for index in preplay_seats(state, feature) if index != seat)
        changed = replace(state, preplay_request=PreplayRequest(feature, seat, responder),
                          bloedeln_decisions=((seat, True),) if feature == "bloedeln" else state.bloedeln_decisions)
    elif kind == "announce_strike" and state.phase == "strike":
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
        play = start_play(state.deal_id, state.deal, state.parties, state.recipe.profile, call=call,
                          forced_opening=bloedeln_cards(state))
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
            play = start_play(state.deal_id, state.deal, state.parties, state.recipe.profile, call=state.call,
                              forced_opening=bloedeln_cards(state))
            changed = replace(state, acknowledged=acknowledged, play=play, phase="play")
            if not state.recipe.profile.blind:
                # Open Ladinisch officially informs every seat. Non-inspecting
                # partners get the call once, not the other original bottoms.
                events = (("strike_announced", roles.strike_announcer, state.call.strike_rank),
                          ("colour_announced", roles.suit_announcer, state.call.trump_suit))
        else:
            changed = replace(state, acknowledged=acknowledged)
    elif kind == "play_card" and state.phase == "play":
        if bloedeln_pending(state):
            raise WattenEngineError("watten_bloedeln_decision_pending")
        play = play_card(state.play, state.bid_state, actor.player_id, value)
        changed = _finish(state, play, finish_deal(play, state.bid_state)) if play.ended else replace(state, play=play)
    elif kind == "bid" and state.phase == "play" and value is None:
        if bloedeln_pending(state):
            raise WattenEngineError("watten_bloedeln_decision_pending")
        bidding = bid(state.bid_state, actor.player_id, deal_progress(state.play),
                      gestrichen=gestrichen_players(state))
        changed = replace(state, bid_state=bidding, phase="bid_response", feedback=())
    elif kind == "respond" and state.phase == "bid_response":
        bidding = respond(state.bid_state, actor.player_id, value, deal_progress(state.play))
        cleared = replace(state, feedback=())
        changed = _finish(cleared, state.play, bidding) if bidding.result else replace(
            cleared, bid_state=bidding, phase="bid_response" if bidding.pending else "play")
    elif kind == "retourschneider" and state.phase == "deal_complete":
        members = retourschneider_offer(state)
        if (members is None or value not in {"accept", "decline"}
                or actor.player_id not in retourschneider_actors(state, members)
                or actor.player_id in state.retour_accepted_by):
            raise WattenEngineError("watten_retourschneider_unavailable")
        humans = tuple(binding.player_id for binding in state.recipe.bindings
                       if binding.player_id in members and binding.account_id is not None)
        mixed = len(humans) == 1
        if mixed and actor.account_id is None and value != "accept":
            raise WattenEngineError("watten_retourschneider_unavailable")
        votes = (*state.retour_accepted_by, actor.player_id) if value == "accept" else ()
        if mixed and value == "accept":
            votes = members
        if value == "decline" or set(votes) == set(members):
            changed = replace(state, ledger=choose_retourschneider(state.ledger, members, accept=value == "accept"),
                              retour_accepted_by=())
        else:
            changed = replace(state, retour_accepted_by=votes)
    elif kind == "partner_feedback" and state.phase == "bid_response":
        partner = partner_feedback_recipient(state, actor.player_id)
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
        changed = play_forced_openings(changed)
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
                   "open_partner_hand": recipe.open_partner_hand, "trick_history": recipe.trick_history,
                   "schoeneres_enabled": recipe.schoeneres_enabled,
                   "schlagwechsel_enabled": recipe.schlagwechsel_enabled},
        "deal": {"id": state.deal_id, "dealer_id": state.parties.dealer_id,
                 "hands": [list(hand) for hand in state.deal.hands], "stock": list(state.deal.stock),
                 "bottom_cards": list(state.deal.bottom_cards)},
        "phase": state.phase, "opportunity": state.opportunity, "normal_strike": state.normal_strike,
        "call": None if state.call is None else {"strike_rank": state.call.strike_rank, "trump_suit": state.call.trump_suit},
        "shown": sorted(state.shown), "acknowledged": sorted(state.acknowledged),
        "preplay": {"deal_revision": state.deal_revision, "call_swapped": state.call_swapped,
                    "bloedeln_decisions": None if state.bloedeln_decisions is None else [
                        {"seat": seat, "accepted": accepted} for seat, accepted in state.bloedeln_decisions],
                    "bloedeln": state.bloedeln, "pending": None if state.preplay_request is None else {
                        "kind": state.preplay_request.kind, "requester": state.preplay_request.requester,
                        "responder": state.preplay_request.responder}},
        "retour_accepted_by": list(state.retour_accepted_by),
        "discarded_bid_increases": state.discarded_bid_increases,
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
    value = _object(value, "schema recipe deal phase opportunity normal_strike call shown acknowledged plays bid ledger feedback ack_cache",
                    frozenset({"preplay", "retour_accepted_by", "discarded_bid_increases"}))
    if type(value["schema"]) is not int or value["schema"] != 1:
        raise WattenEngineError("watten_invalid_storage")
    raw = _object(value["recipe"], "profile bindings manual_parties target_points show_rechter open_partner_hand trick_history",
                  frozenset({"schoeneres_enabled", "schlagwechsel_enabled"}))
    profile = PlayProfile(**_object(raw["profile"], "player_count determination blind critical"))
    bindings = tuple(SeatBinding(**_object(item, "player_id account_id")) for item in _list(raw["bindings"]))
    groups = None if raw["manual_parties"] is None else tuple(tuple(_list(party)) for party in _list(raw["manual_parties"]))
    recipe = EngineRecipe(profile, bindings, groups, raw["target_points"], raw["show_rechter"], raw["open_partner_hand"],
                          raw["trick_history"], raw.get("schoeneres_enabled", False), raw.get("schlagwechsel_enabled", True))
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
    # Older checkpoints allowed unsolicited feedback and blind knowers advising
    # their partners. Neither message confers permission in the restricted flow.
    feedback = tuple(item for item in feedback if value["phase"] == "bid_response" and pending is not None
                     and parties.party_of(item.sender) != pending.party
                     and (not profile.blind or item.recipient == parties.decider(parties.party_of(item.sender))))
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
    preplay = _object(value.get("preplay", {"deal_revision": 0, "call_swapped": False, "bloedeln": False, "pending": None}),
                      "deal_revision call_swapped bloedeln pending", frozenset({"bloedeln_decisions"}))
    pending_request = None if preplay["pending"] is None else PreplayRequest(**_object(preplay["pending"], "kind requester responder"))
    inspectors = {recipe.seats.index(parties.dealer_id), (recipe.seats.index(parties.dealer_id) + 1) % len(recipe.seats)}
    forced = tuple((seat, deal.bottom_cards[seat]) for seat in range(len(recipe.seats)) if seat not in inspectors) if preplay["bloedeln"] else ()
    play = None if value["plays"] is None else PlayState(raw_deal["id"], deal, parties, profile, call, tuple(_list(value["plays"])), forced)
    choices = None
    if "bloedeln_decisions" in preplay:
        if preplay["bloedeln_decisions"] is not None:
            choices = tuple((item["seat"], item["accepted"]) for item in (
                _object(item, "seat accepted") for item in _list(preplay["bloedeln_decisions"])))
        # The short-lived mandatory-choice format already recorded explicit
        # Yes/No. Preserve No; a lone Yes becomes its actual pending request.
        if choices and len(choices) == 1 and choices[0][1] and pending_request is None:
            responder = next(seat for seat in range(4) if seat not in inspectors and seat != choices[0][0])
            pending_request = PreplayRequest("bloedeln", choices[0][0], responder)
    elif profile.blind and len(recipe.seats) == 4:
        eligible = tuple(seat for seat in range(4) if seat not in inspectors)
        if preplay["bloedeln"]:
            choices = tuple((seat, True) for seat in eligible)
        elif pending_request is not None and pending_request.kind == "bloedeln":
            # The old request was an explicit Yes from its requester. Keep it;
            # the other seat must still choose, with no manufactured No.
            if {pending_request.requester, pending_request.responder} != set(eligible):
                raise WattenEngineError("watten_invalid_preplay")
            choices = ((pending_request.requester, True),)
        elif not ((play and play.plays) or bidding.pending is not None or bidding.accepted_stake > 2 or bidding.result is not None):
            choices = ()
    return EngineState(recipe, raw_deal["id"], deal, parties, value["phase"], value["opportunity"], ledger, bidding,
                       value["normal_strike"], call, *inspection, play, feedback, tuple(cache),
                       preplay["deal_revision"], preplay["call_swapped"], pending_request, preplay["bloedeln"],
                       tuple(_list(value.get("retour_accepted_by", []))), value.get("discarded_bid_increases", 0),
                       bloedeln_decisions=choices)
