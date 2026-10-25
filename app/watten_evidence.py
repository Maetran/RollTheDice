"""Secret-free, immutable match evidence; no grants, database or runtime reads.

The existing result-v1 payload accepts an optional public Retourschneider
decision; older payloads remain valid. Its missing profile, start and
bid observations are UNKNOWN, never defaults or proof that something did not
happen. A future producer may supply the separate public-match contract below.
Validation proves internal consistency, not provenance: callers must obtain
evidence and relational bindings from their trusted result transaction.
"""

from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from zoneinfo import ZoneInfo

from .watten_bidding import (
    BidState,
    DealParties,
    DealResult,
    Retourschneider,
    ScoreAccount,
    ScoreLedger,
    award_deal,
    choose_retourschneider,
)
from .watten_recipe import WATTEN_RULESET_ID, WATTEN_RULESET_VERSION, WattenRecipe, dumps_canonical_json

EVIDENCE_SCHEMA_VERSION = 1
PLAY_DAY_ZONE = "Europe/Zurich"
_ZONE = ZoneInfo(PLAY_DAY_ZONE)


class Unknown(StrEnum):
    UNKNOWN = "unknown"


UNKNOWN = Unknown.UNKNOWN


class WattenEvidenceError(ValueError):
    def __init__(self, code="watten_invalid_evidence"):
        self.code = code
        super().__init__(code)


def _require(condition: bool) -> None:
    if not condition:
        raise WattenEvidenceError()


def _integer(value: object, minimum=0) -> bool:
    return type(value) is int and value >= minimum


def _text(value: object, maximum=64) -> bool:
    return type(value) is str and bool(value.strip()) and len(value) <= maximum


def _fields(raw: object, names: str, optional: frozenset[str] = frozenset()) -> dict:
    required = set(names.split())
    _require(type(raw) is dict and required <= set(raw) and not (set(raw) - required - optional))
    return raw


def _items(raw: object) -> list:
    _require(type(raw) is list)
    return raw


def _utc(value: object) -> datetime:
    _require(type(value) is datetime and value.tzinfo is not None and value.utcoffset() is not None)
    return value.astimezone(timezone.utc)


def _timestamp(raw: object) -> datetime:
    _require(type(raw) is str)
    try:
        value = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise WattenEvidenceError() from exc
    _require(value.tzinfo is not None and value.utcoffset() == timedelta(0))
    return _utc(value)


@dataclass(frozen=True, slots=True)
class Participant:
    player_id: str
    seat: int
    name: str
    is_cpu: bool

    def __post_init__(self):
        _require(_text(self.player_id) and _integer(self.seat) and _text(self.name) and type(self.is_cpu) is bool)


@dataclass(frozen=True, slots=True)
class Score:
    members: tuple[str, ...]
    points: int

    def __post_init__(self):
        _require(type(self.members) is tuple and bool(self.members) and all(_text(item) for item in self.members)
                 and len(set(self.members)) == len(self.members) and _integer(self.points))


@dataclass(frozen=True, slots=True)
class Deal:
    deal_id: str
    parties: tuple[tuple[str, ...], tuple[str, ...]]
    winning_party: int
    points: int
    reason: str

    def __post_init__(self):
        _require(_text(self.deal_id, 160) and type(self.parties) is tuple and len(self.parties) == 2
                 and all(type(party) is tuple and bool(party) and all(_text(member) for member in party)
                         for party in self.parties)
                 and _integer(self.winning_party) and self.winning_party in {0, 1}
                 and _integer(self.points, 2) and type(self.reason) is str and self.reason in {"go", "tricks"})


@dataclass(frozen=True, slots=True)
class PublicProfile:
    ruleset_id: str
    ruleset_version: int
    determination: str
    blind: bool
    critical: bool
    show_rechter: bool
    trick_history: bool
    partner_hand: bool

    def __post_init__(self):
        _require(type(self.ruleset_id) is str and self.ruleset_id == WATTEN_RULESET_ID
                 and type(self.ruleset_version) is int and self.ruleset_version == WATTEN_RULESET_VERSION
                 and type(self.determination) is str and self.determination in {"normal", "ladinisch"}
                 and all(type(item) is bool for item in (
                     self.blind, self.critical, self.show_rechter, self.trick_history, self.partner_hand)))


@dataclass(frozen=True, slots=True)
class PlayerBids:
    """Accepted public commands, counted by actor; not offered/accepted points."""

    player_id: str
    initiated: int
    countered: int
    held: int
    went: int

    def __post_init__(self):
        _require(_text(self.player_id) and all(_integer(item) for item in (
            self.initiated, self.countered, self.held, self.went)))


@dataclass(frozen=True, slots=True)
class BidEvidence:
    complete: bool = False
    players: tuple[PlayerBids, ...] = ()
    discarded_bid_increases: int = 0

    def __post_init__(self):
        _require(type(self.complete) is bool and type(self.players) is tuple
                 and all(type(item) is PlayerBids for item in self.players)
                 and len({item.player_id for item in self.players}) == len(self.players)
                 and _integer(self.discarded_bid_increases)
                 and (self.complete or (not self.players and self.discarded_bid_increases == 0)))


def _validate_scoring(roster: tuple[Participant, ...], target: int, scores: tuple[Score, ...],
                      winners: tuple[tuple[str, ...], ...], deals: tuple[Deal, ...],
                      retourschneider: Retourschneider | None = None) -> None:
    _replay_scoring(roster, target, scores, winners, deals, retourschneider)


def replay_score_accounts(evidence: MatchEvidence) -> tuple[tuple[Score, ...], ...]:
    """Every account's score after each deal, from the same validated replay.

    Each snapshot follows that deal's Retourschneider choice, if any. The full
    replay still re-proves final scores and winners before anything is returned.
    """
    return _replay_scoring(evidence.roster, evidence.target_points, evidence.scores, evidence.winners,
                           evidence.deals, evidence.retourschneider)


def _replay_scoring(roster: tuple[Participant, ...], target: int, scores: tuple[Score, ...],
                    winners: tuple[tuple[str, ...], ...], deals: tuple[Deal, ...],
                    retourschneider: Retourschneider | None) -> tuple[tuple[Score, ...], ...]:
    snapshots = []
    seats = tuple(player.player_id for player in roster)
    count = len(seats)
    accounts = tuple(ScoreAccount(item.members, 0) for item in scores)
    ledger = ScoreLedger(target, accounts)
    _require({member for account in accounts for member in account.members} == set(seats))
    _require(sorted(map(lambda item: len(item.members), accounts)) == ([2, 2] if count == 4 else [1] * count))
    previous_solo = None
    for item in deals:
        # v1 does not record dealers. Only 3-player solo membership determines
        # that public role; no dealer fact is invented for 2/4-player results.
        if count == 3:
            _require(sorted(map(len, item.parties)) == [1, 2])
            solo = next(party[0] for party in item.parties if len(party) == 1)
            _require(solo in seats)
            solo_seat = seats.index(solo)
            _require(previous_solo is None or solo_seat == (previous_solo + 1) % count)
            previous_solo = solo_seat
            dealer = seats[(solo_seat - 1) % count]
        else:
            dealer = seats[0]
        if count == 4:
            _require(item.parties == tuple(score.members for score in scores))
        roles = DealParties(seats, dealer, item.parties)
        result = DealResult(item.deal_id, roles, item.winning_party, item.points, item.reason)
        # The last offering party of a trick result is absent from v1. This
        # synthetic BidState satisfies only award_deal's scoring preconditions;
        # it is never retained or used as evidence of an actual bid/actor.
        state = BidState(item.deal_id, roles, accepted_stake=item.points,
                         last_offering_party=item.winning_party if item.reason == "go" or item.points > 2 else None,
                         result=result)
        ledger = award_deal(ledger, state)
        if retourschneider is not None and item.deal_id == retourschneider.after_deal_id:
            ledger = choose_retourschneider(ledger, retourschneider.members, accept=retourschneider.accepted)
            _require(ledger.retourschneider == retourschneider)
        snapshots.append(tuple(Score(account.members, account.points) for account in ledger.accounts))
    _require(ledger.retourschneider == retourschneider)
    _require(tuple((item.members, item.points) for item in ledger.accounts)
             == tuple((item.members, item.points) for item in scores))
    _require(bool(ledger.winners) and winners == ledger.winners)
    return tuple(snapshots)


@dataclass(frozen=True, slots=True)
class MatchEvidence:
    game_id: str
    source: str
    player_count: int
    target_points: int
    roster: tuple[Participant, ...]
    scores: tuple[Score, ...]
    winners: tuple[tuple[str, ...], ...]
    deals: tuple[Deal, ...]
    finished_at: datetime
    profile: PublicProfile | Unknown = UNKNOWN
    started_at: datetime | Unknown = UNKNOWN
    bids: BidEvidence = BidEvidence()
    retourschneider: Retourschneider | None = None

    def __post_init__(self):
        _require(_text(self.game_id) and type(self.source) is str and self.source in {"result_v1", "public_match_v1"}
                 and _integer(self.player_count) and self.player_count in {2, 3, 4}
                 and _integer(self.target_points, 3) and type(self.roster) is tuple
                 and len(self.roster) == self.player_count and all(type(item) is Participant for item in self.roster)
                 and tuple(item.seat for item in self.roster) == tuple(range(self.player_count))
                 and len({item.player_id for item in self.roster}) == self.player_count
                 and any(not item.is_cpu for item in self.roster)
                 and type(self.scores) is tuple and all(type(item) is Score for item in self.scores)
                 and type(self.winners) is tuple and all(type(item) is tuple for item in self.winners)
                 and type(self.deals) is tuple and bool(self.deals) and all(type(item) is Deal for item in self.deals)
                 and type(self.bids) is BidEvidence
                 and (self.retourschneider is None or type(self.retourschneider) is Retourschneider))
        object.__setattr__(self, "finished_at", _utc(self.finished_at))
        if self.started_at is not UNKNOWN:
            start = _utc(self.started_at)
            _require(start <= self.finished_at)
            object.__setattr__(self, "started_at", start)
        if self.profile is not UNKNOWN:
            _require(type(self.profile) is PublicProfile)
            profile = self.profile
            try:
                WattenRecipe(self.player_count, profile.determination, profile.blind, profile.critical,
                             target_points=self.target_points, show_rechter=profile.show_rechter,
                             trick_history=profile.trick_history, partner_hand=profile.partner_hand,
                             cpu_seats=tuple(item.seat for item in self.roster if item.is_cpu),
                             ruleset_id=profile.ruleset_id, ruleset_version=profile.ruleset_version)
            except ValueError as exc:
                raise WattenEvidenceError() from exc
        if self.source == "result_v1":
            _require(self.profile is UNKNOWN and self.started_at is UNKNOWN and not self.bids.complete)
        else:
            _require(type(self.profile) is PublicProfile and self.started_at is not UNKNOWN)
        try:
            _validate_scoring(self.roster, self.target_points, self.scores, self.winners, self.deals, self.retourschneider)
        except ValueError as exc:
            raise WattenEvidenceError() from exc
        if self.bids.complete:
            _require(tuple(item.player_id for item in self.bids.players) == tuple(item.player_id for item in self.roster))
            # A completed offer chain ends in exactly one hold/go per initial
            # bid. Every hold/counter raises the accepted stake by exactly one.
            _require(sum(item.initiated for item in self.bids.players)
                     == sum(item.held + item.went for item in self.bids.players))
            _require(sum(item.went for item in self.bids.players) == sum(item.reason == "go" for item in self.deals))
            _require(sum(item.held + item.countered for item in self.bids.players)
                     == sum(item.points - 2 for item in self.deals) + self.bids.discarded_bid_increases)

    @property
    def play_day(self) -> str:
        """Completion day in the explicit Swiss calendar, including DST."""
        return self.finished_at.astimezone(_ZONE).date().isoformat()


def _score(raw: object) -> Score:
    item = _fields(raw, "members points")
    return Score(tuple(_items(item["members"])), item["points"])


def _deal(raw: object) -> Deal:
    item = _fields(raw, "deal_id parties winning_party points reason")
    return Deal(item["deal_id"], tuple(tuple(_items(party)) for party in _items(item["parties"])),
                item["winning_party"], item["points"], item["reason"])


def _retourschneider(raw: object) -> Retourschneider | None:
    if raw is None:
        return None
    item = _fields(raw, "members after_deal_id erased_points accepted")
    return Retourschneider(tuple(_items(item["members"])), item["after_deal_id"], item["erased_points"], item["accepted"])


def _retourschneider_payload(choice: Retourschneider) -> dict:
    return {"members": list(choice.members), "after_deal_id": choice.after_deal_id,
            "erased_points": choice.erased_points, "accepted": choice.accepted}


def validate_result_v1(payload: object) -> dict:
    """Validate and copy exactly the writer-v1 shape, adding/removing no fields."""
    raw = _fields(payload, "kind schema_version game_type game_id match participants")
    _require(raw["kind"] == "watten_result" and type(raw["schema_version"]) is int and raw["schema_version"] == 1
             and raw["game_type"] == "watten")
    match = _fields(raw["match"], "target_points scores winners deals", frozenset({"retourschneider"}))
    roster = []
    for seat, value in enumerate(_items(raw["participants"])):
        item = _fields(value, "id name is_cpu")
        roster.append(Participant(item["id"], seat, item["name"], item["is_cpu"]))
    MatchEvidence(raw["game_id"], "result_v1", len(roster), match["target_points"], tuple(roster),
                  tuple(_score(item) for item in _items(match["scores"])),
                  tuple(tuple(_items(item)) for item in _items(match["winners"])),
                  tuple(_deal(item) for item in _items(match["deals"])), datetime(2000, 1, 1, tzinfo=timezone.utc),
                  retourschneider=_retourschneider(match.get("retourschneider")))
    return deepcopy(raw)


def adapt_result_v1(payload: object, *, finished_at: datetime) -> MatchEvidence:
    """The caller supplies the trusted CompletedGame timestamp, not a checkpoint.

    SQLite adapters must explicitly tag their known-UTC naive DB timestamp;
    this function rejects naive datetimes instead of guessing a local zone.
    """
    raw = validate_result_v1(payload)
    match = raw["match"]
    return MatchEvidence(raw["game_id"], "result_v1", len(raw["participants"]), match["target_points"],
                         tuple(Participant(item["id"], seat, item["name"], item["is_cpu"])
                               for seat, item in enumerate(raw["participants"])),
                         tuple(_score(item) for item in match["scores"]),
                         tuple(tuple(item) for item in match["winners"]),
                         tuple(_deal(item) for item in match["deals"]), finished_at,
                         retourschneider=_retourschneider(match.get("retourschneider")))


def evidence_to_payload(evidence: MatchEvidence) -> dict:
    _require(type(evidence) is MatchEvidence)
    profile = evidence.profile
    payload = {
        "kind": "watten_match_evidence", "schema_version": EVIDENCE_SCHEMA_VERSION, "game_type": "watten",
        "game_id": evidence.game_id, "source": evidence.source, "player_count": evidence.player_count,
        "target_points": evidence.target_points,
        "roster": [{"id": item.player_id, "seat": item.seat, "name": item.name, "is_cpu": item.is_cpu}
                   for item in evidence.roster],
        "scores": [{"members": list(item.members), "points": item.points} for item in evidence.scores],
        "winners": [list(item) for item in evidence.winners],
        "deals": [{"deal_id": item.deal_id, "parties": [list(party) for party in item.parties],
                   "winning_party": item.winning_party, "points": item.points, "reason": item.reason}
                  for item in evidence.deals],
        "finished_at": evidence.finished_at.isoformat(),
        "started_at": UNKNOWN.value if evidence.started_at is UNKNOWN else evidence.started_at.isoformat(),
        "play_day": evidence.play_day, "play_day_zone": PLAY_DAY_ZONE,
        "profile": UNKNOWN.value if profile is UNKNOWN else {
            "ruleset_id": profile.ruleset_id, "ruleset_version": profile.ruleset_version,
            "determination": profile.determination, "blind": profile.blind, "critical": profile.critical,
            "show_rechter": profile.show_rechter, "trick_history": profile.trick_history, "partner_hand": profile.partner_hand},
        "bids": {"completeness": "complete" if evidence.bids.complete else UNKNOWN.value,
                 "players": [{"id": item.player_id, "initiated": item.initiated, "countered": item.countered,
                              "held": item.held, "went": item.went} for item in evidence.bids.players]},
    }
    if evidence.retourschneider is not None:
        payload["retourschneider"] = _retourschneider_payload(evidence.retourschneider)
    if evidence.bids.discarded_bid_increases:
        payload["bids"]["discarded_bid_increases"] = evidence.bids.discarded_bid_increases
    return payload


def evidence_from_payload(payload: object) -> MatchEvidence:
    raw = _fields(payload, "kind schema_version game_type game_id source player_count target_points roster scores winners deals "
                  "finished_at started_at play_day play_day_zone profile bids", frozenset({"retourschneider"}))
    _require(raw["kind"] == "watten_match_evidence" and type(raw["schema_version"]) is int
             and raw["schema_version"] == EVIDENCE_SCHEMA_VERSION and raw["game_type"] == "watten"
             and raw["play_day_zone"] == PLAY_DAY_ZONE)
    roster = []
    for value in _items(raw["roster"]):
        item = _fields(value, "id seat name is_cpu")
        roster.append(Participant(item["id"], item["seat"], item["name"], item["is_cpu"]))
    profile = UNKNOWN
    if raw["profile"] != UNKNOWN.value:
        item = _fields(raw["profile"], "ruleset_id ruleset_version determination blind critical show_rechter trick_history partner_hand")
        profile = PublicProfile(item["ruleset_id"], item["ruleset_version"], item["determination"], item["blind"],
                                item["critical"], item["show_rechter"], item["trick_history"], item["partner_hand"])
    bids = _fields(raw["bids"], "completeness players", frozenset({"discarded_bid_increases"}))
    _require(type(bids["completeness"]) is str and bids["completeness"] in {"complete", UNKNOWN.value})
    players = []
    for value in _items(bids["players"]):
        item = _fields(value, "id initiated countered held went")
        players.append(PlayerBids(item["id"], item["initiated"], item["countered"], item["held"], item["went"]))
    evidence = MatchEvidence(raw["game_id"], raw["source"], raw["player_count"], raw["target_points"], tuple(roster),
                             tuple(_score(item) for item in _items(raw["scores"])),
                             tuple(tuple(_items(item)) for item in _items(raw["winners"])),
                             tuple(_deal(item) for item in _items(raw["deals"])), _timestamp(raw["finished_at"]), profile,
                             UNKNOWN if raw["started_at"] == UNKNOWN.value else _timestamp(raw["started_at"]),
                             BidEvidence(bids["completeness"] == "complete", tuple(players), bids.get("discarded_bid_increases", 0)),
                             _retourschneider(raw.get("retourschneider")))
    _require(type(raw["play_day"]) is str and raw["play_day"] == evidence.play_day)
    return evidence


def evidence_to_json(evidence: MatchEvidence) -> str:
    return dumps_canonical_json(evidence_to_payload(evidence))


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        _require(key not in result)
        result[key] = value
    return result


def _reject_constant(_name):
    raise WattenEvidenceError()


def evidence_from_json(text: object) -> MatchEvidence:
    _require(type(text) is str)
    try:
        return evidence_from_payload(json.loads(text, object_pairs_hook=_unique_object, parse_constant=_reject_constant))
    except (ValueError, RecursionError) as exc:
        raise WattenEvidenceError() from exc


@dataclass(frozen=True, slots=True)
class ProjectedBinding:
    """Plain trusted relational projection, never an account claim in JSON."""

    game_id: str
    position: int
    player_id: str
    display_name: str
    user_id: int | None
    points: int
    team: str | None = None

    def __post_init__(self):
        _require(_text(self.game_id) and _integer(self.position) and _text(self.player_id)
                 and _text(self.display_name) and (self.user_id is None or _integer(self.user_id, 1))
                 and _integer(self.points) and (self.team is None or type(self.team) is str and self.team in {"0", "1"}))


@dataclass(frozen=True, slots=True)
class Membership:
    user_id: int
    player_id: str
    seat: int
    won: bool


def validate_membership(evidence: MatchEvidence, *, viewer_user_id: int,
                        bindings: tuple[ProjectedBinding, ...]) -> Membership:
    """Check the entire relational roster before yielding one account's facts.

    A missing account may be a deleted human, never an inferred CPU or guest.
    Account IDs are deliberately absent from the portable evidence payload.
    """
    valid = (type(evidence) is MatchEvidence and _integer(viewer_user_id, 1) and type(bindings) is tuple
             and len(bindings) == evidence.player_count and all(type(item) is ProjectedBinding for item in bindings))
    if not valid:
        raise WattenEvidenceError("watten_evidence_invalid_membership")
    ordered = tuple(sorted(bindings, key=lambda item: item.position))
    accounts = [item.user_id for item in ordered if item.user_id is not None]
    own = [item for item in ordered if item.user_id == viewer_user_id]
    valid = len(accounts) == len(set(accounts)) and len(own) == 1
    for player, binding in zip(evidence.roster, ordered):
        account = next(item for item in evidence.scores if player.player_id in item.members)
        team = str(next(index for index, score in enumerate(evidence.scores) if player.player_id in score.members)) if evidence.player_count == 4 else None
        valid = valid and (binding.game_id == evidence.game_id and binding.position == player.seat
                           and binding.player_id == player.player_id and binding.display_name == player.name
                           and binding.points == account.points and binding.team == team
                           and not (player.is_cpu and binding.user_id is not None))
    if not valid or evidence.roster[own[0].position].is_cpu:
        raise WattenEvidenceError("watten_evidence_invalid_membership")
    own = own[0]
    return Membership(viewer_user_id, own.player_id, own.position,
                      any(own.player_id in group for group in evidence.winners))
