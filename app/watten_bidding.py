"""Pure bidding and score accounting for confirmed Watten rules only.

Inputs are authoritative engine state, never commands parsed from a client.
Card legality, the end of a deal and gestrichen status are supplied by that
engine. This module is not a complete rule profile or a game adapter.
"""

from dataclasses import dataclass, replace
from typing import Literal


class WattenBiddingError(ValueError):
    """An invalid state or an action outside the current opportunity."""


def _integer(value: object, minimum: int = 0) -> bool:
    return type(value) is int and value >= minimum


def _members(value: object) -> bool:
    return (type(value) is tuple and bool(value)
            and all(type(member) is str and bool(member.strip()) for member in value)
            and len(set(value)) == len(value))


@dataclass(frozen=True, slots=True)
class DealParties:
    """Explicit clockwise seats and manual parties; dealer determines deciders.

    Two: each opponent decides. Three: dealer A decides for A+C, solo B
    decides for B. Four: dealer A and the other knower B decide for A+C/B+D.
    Party tuple order is deliberately independent of seat or dealer order.
    """

    seats: tuple[str, ...]
    dealer_id: str
    parties: tuple[tuple[str, ...], tuple[str, ...]]

    def __post_init__(self):
        if not _members(self.seats) or len(self.seats) not in {2, 3, 4} or self.dealer_id not in self.seats:
            raise WattenBiddingError("watten_invalid_seats")
        if type(self.parties) is not tuple or len(self.parties) != 2 or not all(map(_members, self.parties)):
            raise WattenBiddingError("watten_invalid_parties")
        flattened = self.parties[0] + self.parties[1]
        if len(flattened) != len(self.seats) or set(flattened) != set(self.seats):
            raise WattenBiddingError("watten_invalid_parties")
        if len(self.seats) == 2 and any(len(party) != 1 for party in self.parties):
            raise WattenBiddingError("watten_invalid_parties")
        if len(self.seats) == 3 and self.parties[self.party_of(self.next_to_dealer)] != (self.next_to_dealer,):
            raise WattenBiddingError("watten_invalid_solo_party")
        if len(self.seats) == 4:
            index = self.seats.index(self.dealer_id)
            expected = {self.dealer_id, self.seats[(index + 2) % 4]}
            if set(self.parties[self.party_of(self.dealer_id)]) != expected:
                raise WattenBiddingError("watten_invalid_four_player_parties")

    @property
    def next_to_dealer(self) -> str:
        return self.seats[(self.seats.index(self.dealer_id) + 1) % len(self.seats)]

    def party_of(self, player_id: str) -> int:
        for index, members in enumerate(self.parties):
            if player_id in members:
                return index
        raise WattenBiddingError("watten_unknown_player")

    def decider(self, party: int) -> str:
        if type(party) is not int or party not in {0, 1}:
            raise WattenBiddingError("watten_unknown_party")
        if len(self.seats) == 2:
            return self.parties[party][0]
        return self.dealer_id if self.dealer_id in self.parties[party] else self.next_to_dealer


@dataclass(frozen=True, slots=True)
class DealProgress:
    """Current card opportunity and accepted deal-end status from the engine."""

    current_player_id: str | None
    cards_played: int
    ended: bool

    def __post_init__(self):
        if not _integer(self.cards_played) or type(self.ended) is not bool:
            raise WattenBiddingError("watten_invalid_deal_progress")
        if self.current_player_id is not None and (type(self.current_player_id) is not str
                                                   or not self.current_player_id.strip()):
            raise WattenBiddingError("watten_invalid_deal_progress")


@dataclass(frozen=True, slots=True)
class Offer:
    party: int
    points: int

    def __post_init__(self):
        if type(self.party) is not int or self.party not in {0, 1} or not _integer(self.points, 3):
            raise WattenBiddingError("watten_invalid_offer")


@dataclass(frozen=True, slots=True)
class DealResult:
    deal_id: str
    roles: DealParties
    winning_party: int
    points: int
    reason: Literal["go", "tricks"]

    def __post_init__(self):
        if type(self.deal_id) is not str or not self.deal_id.strip() or not isinstance(self.roles, DealParties):
            raise WattenBiddingError("watten_invalid_result")
        if (type(self.winning_party) is not int or self.winning_party not in {0, 1}
                or not _integer(self.points, 2) or type(self.reason) is not str or self.reason not in {"go", "tricks"}):
            raise WattenBiddingError("watten_invalid_result")


@dataclass(frozen=True, slots=True)
class BidState:
    deal_id: str
    roles: DealParties
    accepted_stake: int = 2
    last_offering_party: int | None = None
    pending: Offer | None = None
    result: DealResult | None = None

    def __post_init__(self):
        if type(self.deal_id) is not str or not self.deal_id.strip() or not isinstance(self.roles, DealParties):
            raise WattenBiddingError("watten_invalid_bid_state")
        if not _integer(self.accepted_stake, 2):
            raise WattenBiddingError("watten_invalid_bid_state")
        if self.last_offering_party is not None and (type(self.last_offering_party) is not int
                                                    or self.last_offering_party not in {0, 1}):
            raise WattenBiddingError("watten_invalid_bid_state")
        if self.pending is not None and (not isinstance(self.pending, Offer)
                                        or self.pending.party != self.last_offering_party
                                        or self.pending.points != self.accepted_stake + 1):
            raise WattenBiddingError("watten_invalid_bid_state")
        if self.last_offering_party is None and (self.pending is not None or self.accepted_stake != 2):
            raise WattenBiddingError("watten_invalid_bid_state")
        if (self.last_offering_party is not None and self.pending is None and self.result is None
                and self.accepted_stake == 2):
            raise WattenBiddingError("watten_invalid_bid_state")
        if self.result is not None and (not isinstance(self.result, DealResult) or self.pending is not None
                                       or self.result.deal_id != self.deal_id or self.result.roles != self.roles
                                       or self.result.points != self.accepted_stake):
            raise WattenBiddingError("watten_invalid_bid_state")
        if self.result is not None and self.result.reason == "go" and self.result.winning_party != self.last_offering_party:
            raise WattenBiddingError("watten_invalid_bid_state")

    @property
    def gameplay_frozen(self) -> bool:
        return self.pending is not None or self.result is not None


def require_gameplay_allowed(state: BidState) -> None:
    """The card engine must call this before accepting any gameplay action."""
    if state.result is not None:
        raise WattenBiddingError("watten_deal_finished")
    if state.pending is not None:
        raise WattenBiddingError("watten_bid_response_pending")


def _active_progress(state: BidState, progress: DealProgress) -> None:
    if state.result is not None or progress.ended:
        raise WattenBiddingError("watten_deal_finished")
    if progress.current_player_id is not None:
        state.roles.party_of(progress.current_player_id)


def bid(state: BidState, player_id: str, progress: DealProgress, *, gestrichen: frozenset[str]) -> BidState:
    """Offer three initially, or the next single point after a held offer.

    Opening and later unsolicited raising require the initiator's own card
    opportunity, including the opening turn before any card is played once
    calling has completed, also in blind partnership play. Gestrichen is checked
    for the initiating individual; a clear three-player partner may offer even
    if the other partner is gestrichen. Pending response counters use respond()
    instead and stay with the informed decider.
    """
    require_gameplay_allowed(state)
    _active_progress(state, progress)
    party = state.roles.party_of(player_id)
    if progress.current_player_id != player_id:
        raise WattenBiddingError("watten_card_turn_required")
    if type(gestrichen) is not frozenset or not gestrichen <= set(state.roles.seats):
        raise WattenBiddingError("watten_invalid_gestrichen")
    if player_id in gestrichen:
        raise WattenBiddingError("watten_gestrichen_cannot_open")
    if party == state.last_offering_party:
        raise WattenBiddingError("watten_alternating_bid_required")
    offer = Offer(party, state.accepted_stake + 1)
    return replace(state, last_offering_party=party, pending=offer)


def respond(state: BidState, player_id: str, action: str, progress: DealProgress) -> BidState:
    """Only the other party's assigned decider may hold, go or counter now."""
    _active_progress(state, progress)
    offer = state.pending
    if offer is None:
        raise WattenBiddingError("watten_no_pending_bid")
    replying_party = 1 - offer.party
    if player_id != state.roles.decider(replying_party):
        raise WattenBiddingError("watten_designated_decider_required")
    if action == "hold":
        return replace(state, accepted_stake=offer.points, pending=None)
    if action == "counter":
        return replace(state, accepted_stake=offer.points, last_offering_party=replying_party,
                       pending=Offer(replying_party, offer.points + 1))
    if action == "go":
        result = DealResult(state.deal_id, state.roles, offer.party, state.accepted_stake, "go")
        return replace(state, pending=None, result=result)
    raise WattenBiddingError("watten_unknown_bid_response")


def finish_deal_from_trusted_engine(state: BidState, winning_party: int, progress: DealProgress) -> BidState:
    """Record an engine-confirmed terminal event, not a client's claimed win.

    The separate card engine decides trick winners and when a deal ends. Its
    accepted terminal status is mandatory here; no third-trick timing rule is
    guessed in this bidding foundation.
    """
    require_gameplay_allowed(state)
    if not progress.ended or progress.cards_played < 1:
        raise WattenBiddingError("watten_terminal_engine_event_required")
    result = DealResult(state.deal_id, state.roles, winning_party, state.accepted_stake, "tricks")
    return replace(state, result=result)


@dataclass(frozen=True, slots=True)
class ScoreAccount:
    members: tuple[str, ...]
    points: int = 0

    def __post_init__(self):
        if not _members(self.members) or not _integer(self.points):
            raise WattenBiddingError("watten_invalid_score_account")


@dataclass(frozen=True, slots=True)
class Retourschneider:
    """Public, irreversible decision at the first gestrichen round boundary.

    The challenging team erases its own score only after accepting. Every
    following round must be won: one loss ends the game for two Nockerl;
    reaching the target without a loss gives the original leaders four.
    """

    members: tuple[str, ...]
    after_deal_id: str
    erased_points: int
    accepted: bool

    def __post_init__(self):
        if (not _members(self.members) or len(self.members) != 2
                or type(self.after_deal_id) is not str or not self.after_deal_id.strip()
                or not _integer(self.erased_points) or type(self.accepted) is not bool):
            raise WattenBiddingError("watten_invalid_retourschneider")


@dataclass(frozen=True, slots=True)
class ScoreLedger:
    """Individual accounts for two/three, two team accounts for four."""

    target: int
    accounts: tuple[ScoreAccount, ...]
    applied_results: tuple[DealResult, ...] = ()
    retourschneider: Retourschneider | None = None

    def __post_init__(self):
        if not _integer(self.target, 1) or type(self.accounts) is not tuple:
            raise WattenBiddingError("watten_invalid_score_ledger")
        if not all(isinstance(account, ScoreAccount) for account in self.accounts):
            raise WattenBiddingError("watten_invalid_score_ledger")
        sizes = sorted(len(account.members) for account in self.accounts)
        if sizes not in ([1, 1], [1, 1, 1], [2, 2]):
            raise WattenBiddingError("watten_invalid_score_ledger")
        members = tuple(member for account in self.accounts for member in account.members)
        if len(set(members)) != len(members):
            raise WattenBiddingError("watten_invalid_score_ledger")
        if type(self.applied_results) is not tuple or not all(isinstance(item, DealResult) for item in self.applied_results):
            raise WattenBiddingError("watten_invalid_score_ledger")
        if len({item.deal_id for item in self.applied_results}) != len(self.applied_results):
            raise WattenBiddingError("watten_deal_already_scored")
        for result in self.applied_results:
            if set(result.roles.seats) != set(members):
                raise WattenBiddingError("watten_score_roster_mismatch")
            if sizes == [2, 2] and {frozenset(account.members) for account in self.accounts} != {
                    frozenset(party) for party in result.roles.parties}:
                raise WattenBiddingError("watten_score_teams_mismatch")
        if self.retourschneider is not None:
            choice = self.retourschneider
            if (not isinstance(choice, Retourschneider) or sizes != [2, 2]
                    or choice.members not in tuple(account.members for account in self.accounts)
                    or choice.after_deal_id not in {result.deal_id for result in self.applied_results}):
                raise WattenBiddingError("watten_invalid_retourschneider")

    @property
    def winners(self) -> tuple[tuple[str, ...], ...]:
        return tuple(account.members for account in self.accounts if account.points >= self.target)

    @property
    def replayed_accounts(self) -> tuple[ScoreAccount, ...]:
        """Reconstruct public scores, including the explicitly accepted erasure."""
        accounts = tuple(replace(account, points=0) for account in self.accounts)
        choice = self.retourschneider
        for index, result in enumerate(self.applied_results):
            if any(account.points >= self.target for account in accounts):
                raise WattenBiddingError("watten_result_after_match_end")
            winning = set(result.roles.parties[result.winning_party])
            accounts = tuple(replace(account, points=account.points + result.points)
                             if set(account.members) <= winning else account for account in accounts)
            if choice is not None and result.deal_id == choice.after_deal_id:
                candidate = retourschneider_candidate(ScoreLedger(self.target, accounts, self.applied_results[:index + 1]), _historical=True)
                if (candidate != choice.members
                        or next(account.points for account in accounts if account.members == choice.members)
                        != choice.erased_points):
                    raise WattenBiddingError("watten_invalid_retourschneider")
                if choice.accepted:
                    accounts = tuple(replace(account, points=0) if account.members == choice.members else account
                                     for account in accounts)
        return accounts


def retourschneider_candidate(ledger: ScoreLedger, *, _historical: bool = False) -> tuple[str, ...] | None:
    """A fixed four-player team gets one choice when opponents first cross nine.

    For other targets the same confirmed gestrichen boundary is target minus
    two. A game already won has no later comeback window.
    """
    if (ledger.retourschneider is not None or ledger.winners or not ledger.applied_results
            or sorted(len(account.members) for account in ledger.accounts) != [2, 2]):
        return None
    latest = ledger.applied_results[-1]
    leaders = latest.roles.parties[latest.winning_party]
    lead = next(account for account in ledger.accounts if set(account.members) == set(leaders))
    other = next(account for account in ledger.accounts if account is not lead)
    boundary = ledger.target - 2
    if lead.points >= boundary > lead.points - latest.points and other.points < boundary and (other.points > 0 or _historical):
        return other.members
    return None


def choose_retourschneider(ledger: ScoreLedger, members: tuple[str, ...], *, accept: bool, _historical: bool = False) -> ScoreLedger:
    if type(accept) is not bool or retourschneider_candidate(ledger, _historical=_historical) != members:
        raise WattenBiddingError("watten_retourschneider_unavailable")
    own = next(account for account in ledger.accounts if account.members == members)
    choice = Retourschneider(members, ledger.applied_results[-1].deal_id, own.points, accept)
    accounts = tuple(replace(account, points=0) if accept and account.members == members else account
                     for account in ledger.accounts)
    return replace(ledger, accounts=accounts, retourschneider=choice)


def nockerl(ledger: ScoreLedger) -> tuple[tuple[tuple[str, ...], int, str], ...]:
    """Loss marks belong to the losing accounts, never the round winner."""
    if not ledger.winners:
        return ()
    choice = ledger.retourschneider
    if choice is not None and choice.accepted:
        succeeded = choice.members in ledger.winners
        return tuple((account.members, 4 if succeeded else 2,
                      "retourschneider" if succeeded else "retourschneider_failed")
                     for account in ledger.accounts if account.members not in ledger.winners)
    return tuple((account.members, 2 if account.points == 0 else 1,
                  "schneider" if account.points == 0 else "loss")
                 for account in ledger.accounts if account.members not in ledger.winners)


def new_score_ledger(roles: DealParties, *, target: int) -> ScoreLedger:
    members = roles.parties if len(roles.seats) == 4 else tuple((player,) for player in roles.seats)
    return ScoreLedger(target, tuple(ScoreAccount(party) for party in members))


def award_deal(ledger: ScoreLedger, state: BidState) -> ScoreLedger:
    """Apply a completed server state once across all rounds of this match."""
    result = state.result
    if result is None:
        raise WattenBiddingError("watten_deal_not_finished")
    if any(previous.deal_id == result.deal_id for previous in ledger.applied_results):
        raise WattenBiddingError("watten_deal_already_scored")
    if ledger.winners:
        raise WattenBiddingError("watten_match_finished")
    roster = {member for account in ledger.accounts for member in account.members}
    if roster != set(state.roles.seats):
        raise WattenBiddingError("watten_score_roster_mismatch")
    if len(state.roles.seats) == 4:
        if {frozenset(account.members) for account in ledger.accounts} != {
                frozenset(party) for party in state.roles.parties}:
            raise WattenBiddingError("watten_score_teams_mismatch")
    elif any(len(account.members) != 1 for account in ledger.accounts):
        raise WattenBiddingError("watten_score_roster_mismatch")
    winning_members = set(state.roles.parties[result.winning_party])
    accounts = tuple(replace(account, points=account.points + result.points)
                     if set(account.members) <= winning_members else account for account in ledger.accounts)
    return replace(ledger, accounts=accounts, applied_results=(*ledger.applied_results, result))
