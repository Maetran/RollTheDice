"""Server-private, versioned memory of one Watten CPU seat's permitted knowledge.

The only inputs are that CPU's own personal DTO (the same allowlist a human on
that seat receives) and the public one-time call events of an accepted
transition, each explicitly bound to its deal. Engine state, dealt cards,
rooms, storage payloads and other viewers' projections are rejected rather
than read; unknown DTO keys fail closed instead of being silently ignored.

Ladinisch original cards are remembered only from this seat's own unclosed
inspection window: persist the observed memory before submitting the
acknowledgement. Normal announcements, the optional matching reference card,
public Danke and public plays are remembered as a person at the table would,
independently of the trick-history option; nothing is fetched from an archive.
The matching reference card is not an original shown card: a Weli reference
names only the sole Weli strike, never a trump suit. A new deal drops every
per-deal card and call. This memory is never a client display; only the
explicit schema below may be written to private storage.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Final

from .watten_cards import CARDS_PER_HAND, WATTEN_NORMAL_RANKS, WATTEN_SUITS, WELI, card_rank, card_suit, validate_card
from .watten_play import PlayProfile, WattenPlayError, official_knower_seats
from .watten_rules import (
    WELI_STRIKE,
    CardKind,
    ComparisonRules,
    RoundRoles,
    WattenCall,
    WattenRuleError,
    card_kind,
    round_roles,
    trick_winner,
)

MEMORY_SCHEMA: Final = 1
RETIRED_DEAL_LIMIT: Final = 16
MAX_TRICKS: Final = 5
STRIKES: Final = (*WATTEN_NORMAL_RANKS, WELI_STRIKE)
PLAY_PHASES: Final = frozenset({"play", "bid_response", "deal_complete", "match_complete"})
ROUND_COMPLETE_PHASES: Final = frozenset({"deal_complete", "match_complete"})
_PHASES: Final = frozenset({"strike", "colour", "show_ready", "inspection"}) | PLAY_PHASES
_VIEW_KEYS: Final = frozenset((
    "schema deal_id phase opportunity profile options dealer_seat seats scores target_points winners party_tricks "
    "card_turn current_trick last_trick bid transcript trick_history viewer hand actions inspection partner_hand "
    "feedback feedback_opportunity").split())
_OPTIONAL_VIEW_KEYS: Final = frozenset({"announced_strike", "reference_card", "retourschneider", "nockerl", "round_summary",
                                      "deal_revision", "announcement_roles", "preplay"})
REQUEST_ACTIONS: Final = frozenset({"request_schoeneres", "request_schlagwechsel", "request_bloedeln"})
PREPLAY_RESPONSES: Final = frozenset({"preplay_accept", "preplay_decline"})
VIEW_ACTIONS: Final = frozenset({"announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card",
                                 "bid", "respond_hold", "respond_go", "respond_counter", "partner_feedback", "retourschneider"}) | REQUEST_ACTIONS | PREPLAY_RESPONSES
FEEDBACK_VALUES: Final = frozenset({"good", "bad", "unsure"})
_STORAGE_KEYS: Final = frozenset((
    "schema kind player_id seat profile deal_id dealer_seat opportunity strike suit inspected thanks plays winners "
    "retired_deals").split())
_STORAGE_KIND: Final = "watten_cpu_memory"
_OPTIONAL_STORAGE_KEYS: Final = frozenset({"deal_revision", "announcement_roles"})


class WattenCpuMemoryError(ValueError):
    """A stable, fail-closed rejection; the previous memory remains valid."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _fail(code: str = "watten_cpu_invalid_view"):
    raise WattenCpuMemoryError(code)


def _text(value: object) -> bool:
    return type(value) is str and bool(value.strip()) and len(value) <= 160


def _int(value: object, low: int = 0, high: int | None = None) -> bool:
    return type(value) is int and value >= low and (high is None or value < high)


def _object(value: object, keys: str, optional: frozenset[str] = frozenset(), code: str = "watten_cpu_invalid_view"
            ) -> dict:
    required = frozenset(keys.split())
    if type(value) is not dict or not required <= set(value) or set(value) - required - optional:
        _fail(code)
    return value


def _list(value: object, code: str = "watten_cpu_invalid_view") -> list:
    if type(value) is not list:
        _fail(code)
    return value


def _card(value: object, code: str = "watten_cpu_invalid_view") -> str:
    if type(value) is not str:
        _fail(code)
    try:
        return validate_card(value)
    except ValueError:
        _fail(code)


def call_from_bottoms(strike_card: str, colour_card: str) -> tuple[str, str]:
    # Weli shown as the strike card is the sole strike; as the colour card it means bells.
    return (WELI_STRIKE if strike_card == WELI else card_rank(strike_card)), card_suit(colour_card)


def _roles(profile: PlayProfile, dealer: int, value: object = None, *, code: str = "watten_cpu_invalid_view") -> RoundRoles:
    base = round_roles(profile.player_count, dealer, determination=profile.determination)
    if value is None:
        return base
    raw = _object(value, "strike colour first_player", code=code)
    if any(not _int(item, 0, profile.player_count) for item in raw.values()) or raw["first_player"] != base.first_player:
        _fail(code)
    actual = (raw["strike"], raw["colour"])
    ordinary = (base.strike_announcer, base.suit_announcer)
    swapped = profile.determination == "normal" and not profile.blind and profile.player_count in {2, 4}
    if actual != ordinary and not (swapped and actual == ordinary[::-1]):
        _fail(code)
    return replace(base, strike_announcer=actual[0], suit_announcer=actual[1])


@dataclass(frozen=True, slots=True, repr=False)
class SeatSnapshot:
    """One parsed personal DTO; derived values only from fields that DTO contains."""

    deal_id: str
    phase: str
    opportunity: int
    profile: PlayProfile
    show_rechter: bool
    open_partner_hand: bool
    dealer_seat: int
    players: tuple[str, ...]
    seat_parties: tuple[int, ...]
    card_counts: tuple[int, ...]
    tricks_won: tuple[int, ...]
    scores: tuple[tuple[tuple[str, ...], int], ...]
    target_points: int
    finished: bool
    party_tricks: tuple[int, int]
    card_turn: int | None
    current_trick: tuple[tuple[int, str], ...]
    last_trick: tuple[tuple[tuple[int, str], ...], int] | None
    history: tuple[tuple[tuple[tuple[int, str], ...], int], ...] | None
    accepted_stake: int
    pending: tuple[int, int, str] | None
    thanks: tuple[int, ...]
    announced_strike: str | None
    reference: str | None
    seat: int
    player_id: str
    hand: tuple[str, ...] | None
    actions: tuple[str, ...]
    inspection: tuple[str, str] | None
    partner_seat: int | None
    partner_cards: tuple[str, ...] | None
    partner_feedback: str | None
    own_feedback: str | None
    feedback_opportunity: int
    deal_revision: int
    announcement_roles: RoundRoles
    schoeneres_enabled: bool
    preplay_pending: tuple[str, int, int] | None
    bloedeln_cards: tuple[tuple[int, str], ...]

    def __repr__(self) -> str:
        return f"SeatSnapshot(deal_id={self.deal_id!r}, phase={self.phase!r}, opportunity={self.opportunity})"


def _trick(value: object, count: int, *, complete: bool) -> tuple[tuple[tuple[int, str], ...], int | None]:
    raw = _object(value, "cards winner" if complete else "cards")
    cards = []
    for item in _list(raw["cards"]):
        item = _object(item, "seat card")
        if not _int(item["seat"], 0, count):
            _fail()
        cards.append((item["seat"], _card(item["card"])))
    if len(cards) > count or (complete and len(cards) != count) or len({card for _, card in cards}) != len(cards):
        _fail()
    if any(seat != (cards[0][0] + index) % count for index, (seat, _) in enumerate(cards)):
        _fail()
    winner = raw.get("winner")
    if complete and not _int(winner, 0, count):
        _fail()
    return tuple(cards), winner


def read_personal_view(view: object, *, player_id: str) -> SeatSnapshot:
    """Strictly parse exactly one seat's personal DTO; anything else fails closed."""
    if type(view) is not dict:
        _fail("watten_cpu_view_required")
    keys = set(view)
    if not _VIEW_KEYS <= keys or keys - _VIEW_KEYS - _OPTIONAL_VIEW_KEYS:
        _fail()
    if type(view["schema"]) is not int or view["schema"] != 1 or not _text(view["deal_id"]):
        _fail()
    phase, opportunity = view["phase"], view["opportunity"]
    if type(phase) is not str or phase not in _PHASES or not _int(opportunity):
        _fail()
    try:
        profile = PlayProfile(**_object(view["profile"], "player_count determination blind critical"))
    except WattenPlayError:
        _fail()
    count = profile.player_count
    options = _object(view["options"], "show_rechter open_partner_hand trick_history", frozenset({"schoeneres_enabled"}))
    if any(type(item) is not bool for item in options.values()):
        _fail()
    if options["open_partner_hand"] and (profile.blind or count == 2):
        _fail()
    schoeneres_enabled = options.get("schoeneres_enabled", False)
    if schoeneres_enabled and count not in {2, 4}:
        _fail()
    if ((profile.determination == "normal" and phase in {"show_ready", "inspection"})
            or (profile.determination == "ladinisch" and phase in {"strike", "colour"})):
        _fail()
    dealer = view["dealer_seat"]
    if not _int(dealer, 0, count):
        _fail()
    revision = view.get("deal_revision", 0)
    if not _int(revision) or ("announcement_roles" in view and view["announcement_roles"] is None):
        _fail()
    roles = _roles(profile, dealer, view.get("announcement_roles"))
    base_roles = round_roles(count, dealer, determination=profile.determination)
    if roles != base_roles and revision == 0:
        _fail()
    inspectors = frozenset((roles.dealer, roles.clockwise_next))
    seats = _list(view["seats"])
    if len(seats) != count:
        _fail()
    players, parties, counts, tricks_won = [], [], [], []
    provided_trick_counts = ["tricks_won" in item for item in seats if type(item) is dict]
    if any(provided_trick_counts) and not all(provided_trick_counts):
        _fail()
    for index, item in enumerate(seats):
        item = _object(item, "seat player_id party card_count", frozenset({"tricks_won"}))
        if (not _int(item["seat"]) or item["seat"] != index or not _text(item["player_id"])
                or not _int(item["party"], 0, 2) or not _int(item["card_count"], 0, CARDS_PER_HAND + 1)
                or not _int(item.get("tricks_won", 0), 0, MAX_TRICKS + 1)):
            _fail()
        players.append(item["player_id"])
        parties.append(item["party"])
        counts.append(item["card_count"])
        tricks_won.append(item.get("tricks_won", 0))
    if len(set(players)) != count or set(parties) != {0, 1}:
        _fail()
    scores = []
    for item in _list(view["scores"]):
        item = _object(item, "members points")
        members = tuple(_list(item["members"]))
        if (not members or not all(type(member) is str for member in members) or not set(members) <= set(players)
                or not _int(item["points"])):
            _fail()
        scores.append((members, item["points"]))
    if sorted(member for members, _ in scores for member in members) != sorted(players):
        _fail()
    target = view["target_points"]
    if not _int(target, 3) or type(view["winners"]) is not list:
        _fail()
    retour = view.get("retourschneider")
    if retour is not None:
        raw = _object(retour, "status members opponent_members decider erased_points after_deal_id", frozenset({"accepted_by"}))
        members, opponents = tuple(_list(raw["members"])), tuple(_list(raw["opponent_members"]))
        accepted_by = tuple(_list(raw.get("accepted_by", [])))
        if (count != 4 or raw["status"] not in {"available", "declined", "active", "succeeded", "failed"}
                or {frozenset(members), frozenset(opponents)} != {frozenset(group) for group, _ in scores}
                or raw["decider"] not in members or not _int(raw["erased_points"])
                or not _text(raw["after_deal_id"]) or (raw["status"] == "available" and phase != "deal_complete")
                or any(type(member) is not str or member not in members for member in accepted_by)
                or len(set(accepted_by)) != len(accepted_by)):
            _fail()
    for item in _list(view.get("nockerl", [])):
        raw = _object(item, "members count reason")
        if (phase != "match_complete" or tuple(_list(raw["members"])) not in [group for group, _ in scores]
                or type(raw["count"]) is not int or raw["count"] not in {1, 2, 4}
                or raw["reason"] not in {"loss", "schneider", "retourschneider", "retourschneider_failed"}):
            _fail()
    party_tricks = _list(view["party_tricks"])
    if len(party_tricks) != 2 or not all(_int(item, 0, 4) for item in party_tricks):
        _fail()
    completed = sum(party_tricks)
    if all(provided_trick_counts) and any(
            sum(won for seat, won in enumerate(tricks_won) if parties[seat] == party) != party_tricks[party]
            for party in (0, 1)):
        _fail()
    card_turn = view["card_turn"]
    if card_turn is not None and not _int(card_turn, 0, count):
        _fail()
    current, _ = _trick(view["current_trick"], count, complete=False)
    last = None if view["last_trick"] is None else _trick(view["last_trick"], count, complete=True)
    if (last is None) != (completed == 0) or completed > MAX_TRICKS or (current and completed == MAX_TRICKS):
        _fail()
    if all(provided_trick_counts) and last is not None and not tricks_won[last[1]]:
        _fail()
    history = None
    if view["trick_history"] is not None:
        if not options["trick_history"] and phase not in ROUND_COMPLETE_PHASES:
            _fail()
        history = tuple(_trick(item, count, complete=True) for item in _list(view["trick_history"]))
        if len(history) != completed or (history and history[-1] != last):
            _fail()
        if all(provided_trick_counts) and any(
                tricks_won[seat] != sum(winner == seat for _, winner in history) for seat in range(count)):
            _fail()
    if "round_summary" in view:
        raw = _object(view["round_summary"], "strike_rank trump_suit rechter")
        if phase not in ROUND_COMPLETE_PHASES:
            _fail()
        try:
            call = WattenCall(raw["strike_rank"], raw["trump_suit"])
            rules = ComparisonRules(call, critical=profile.critical)
        except WattenRuleError:
            _fail()
        if profile.determination == "normal" and profile.critical and call.strike_rank == WELI_STRIKE:
            _fail()
        matching = WELI if call.strike_rank == WELI_STRIKE else f"{call.trump_suit}-{call.strike_rank}"
        expected = matching if card_kind(matching, rules) == CardKind.RECHTER else None
        if raw["rechter"] != expected:
            _fail()
        # The end-of-round explanation is display data. It never supplies a
        # call to an in-progress CPU decision or survives into the next deal.
    preplay_pending = None
    bloedeln = []
    if "preplay" in view:
        raw_preplay = _object(view["preplay"], "pending bloedeln_cards")
        for item in _list(raw_preplay["bloedeln_cards"]):
            item = _object(item, "seat card")
            if not _int(item["seat"], 0, count):
                _fail()
            bloedeln.append((item["seat"], _card(item["card"])))
        if bloedeln and (not profile.blind or count != 4
                         or tuple(seat for seat, _ in bloedeln) != tuple(seat for seat in range(count) if seat not in inspectors)
                         or len({card for _, card in bloedeln}) != 2):
            _fail()
        if raw_preplay["pending"] is not None:
            raw = _object(raw_preplay["pending"], "kind requester responder")
            kind = raw["kind"]
            if type(kind) is not str or kind not in {"schoeneres", "schlagwechsel", "bloedeln"}:
                _fail()
            eligible = set(range(count)) - inspectors if kind == "bloedeln" else {roles.strike_announcer, roles.suit_announcer}
            if (any(not _int(raw[key], 0, count) for key in ("requester", "responder"))
                    or raw["requester"] == raw["responder"] or {raw["requester"], raw["responder"]} != eligible
                    or phase not in {"strike", "colour", "show_ready", "inspection", "play"} or completed or current
                    or counts != [CARDS_PER_HAND] * count
                    or (kind == "schoeneres" and not schoeneres_enabled)
                    or (kind == "schlagwechsel" and (phase != "strike" or profile.determination != "normal" or profile.blind or count not in {2, 4}))
                    or (kind == "bloedeln" and (not profile.blind or count != 4 or bloedeln))):
                _fail()
            preplay_pending = (kind, raw["requester"], raw["responder"])
    raw_bid = _object(view["bid"], "accepted_stake pending result")
    if not _int(raw_bid["accepted_stake"], 2):
        _fail()
    pending = None
    if raw_bid["pending"] is not None:
        raw = _object(raw_bid["pending"], "party points decider")
        if (not _int(raw["party"], 0, 2) or not _int(raw["points"]) or raw["points"] != raw_bid["accepted_stake"] + 1
                or raw["decider"] not in players or phase != "bid_response"):
            _fail()
        pending = (raw["party"], raw["points"], raw["decider"])
    elif phase == "bid_response":
        _fail()
    if raw_bid["result"] is not None:
        _object(raw_bid["result"], "winning_party points reason")
    thanks = []
    for item in _list(view["transcript"]):
        item = _object(item, "kind seat")
        if item["kind"] != "watten_thanks" or not _int(item["seat"], 0, count) or item["seat"] in thanks:
            _fail()
        thanks.append(item["seat"])
    viewer = _object(view["viewer"], "seat player_id")
    seat = viewer["seat"]
    if viewer["player_id"] != player_id:
        _fail("watten_cpu_foreign_view")
    if not _int(seat, 0, count) or players[seat] != player_id:
        _fail()
    announced = view.get("announced_strike")
    if "announced_strike" in view and (phase != "colour" or announced not in STRIKES):
        _fail()
    reference = None
    if "reference_card" in view:
        raw = view["reference_card"]
        if not options["show_rechter"] or type(raw) is not dict:
            _fail()
        if raw.get("face") == "card":
            _object(raw, "face card")
            if (phase not in PLAY_PHASES
                    or seat not in official_knower_seats(profile, dealer)):
                _fail()
            reference = _card(raw["card"])
        elif raw != {"face": "back"}:
            _fail()
    hand_items = _list(view["hand"])
    if len(hand_items) != counts[seat]:
        _fail()
    if all(item == {"back": True} for item in hand_items):
        hand = None
    else:
        hand = tuple(_card(_object(item, "card")["card"]) for item in hand_items)
        if len(set(hand)) != len(hand):
            _fail()
    hand_visible = phase in PLAY_PHASES or (
        profile.determination == "normal" and seat in {roles.strike_announcer, roles.suit_announcer})
    if counts[seat] and (hand is not None) != hand_visible:
        _fail()
    actions = tuple(_list(view["actions"]))
    if any(type(action) is not str or action not in VIEW_ACTIONS for action in actions):
        _fail()
    if len(set(actions)) != len(actions):
        _fail()
    if "retourschneider" in actions and (retour is None or retour["status"] != "available"
                                          or player_id not in retour["members"]
                                          or player_id in retour.get("accepted_by", [])
                                          or ("accepted_by" not in retour and retour["decider"] != player_id)):
        _fail()
    ordinary_actions = tuple(action for action in actions if action not in REQUEST_ACTIONS)
    if preplay_pending is not None:
        if actions != (("preplay_accept", "preplay_decline") if seat == preplay_pending[2] else ()):
            _fail()
    elif set(actions) & PREPLAY_RESPONSES:
        _fail()
    elif phase in {"strike", "colour"}:
        action, announcer = (("announce_strike", roles.strike_announcer) if phase == "strike"
                             else ("announce_colour", roles.suit_announcer))
        if ordinary_actions != ((action,) if seat == announcer else ()):
            _fail()
    elif phase in {"show_ready", "inspection"}:
        action = "show_ready" if phase == "show_ready" else "inspection_ack"
        if ordinary_actions not in ((), (action,)) or (ordinary_actions and seat not in inspectors):
            _fail()
    elif set(actions) & {"announce_strike", "announce_colour", "show_ready", "inspection_ack"}:
        _fail()
    for action in set(actions) & REQUEST_ACTIONS:
        kind = action.removeprefix("request_")
        if (phase not in {"strike", "colour", "show_ready", "inspection", "play"} or completed or current
                or counts != [CARDS_PER_HAND] * count
                or (kind == "schoeneres" and (not schoeneres_enabled or seat not in {roles.strike_announcer, roles.suit_announcer}))
                or (kind == "schlagwechsel" and (phase != "strike" or profile.determination != "normal" or profile.blind or count not in {2, 4}
                                                 or seat not in {roles.strike_announcer, roles.suit_announcer}))
                or (kind == "bloedeln" and (not profile.blind or count != 4 or seat in inspectors or bloedeln))):
            _fail()
    inspection = None
    if view["inspection"] is not None:
        raw = _object(view["inspection"], "cards")
        cards = _list(raw["cards"])
        if len(cards) != 2 or phase != "inspection" or seat not in inspectors:
            _fail()
        strike_item, colour_item = (_object(item, "role card") for item in cards)
        if strike_item["role"] != "strike" or colour_item["role"] != "colour":
            _fail()
        inspection = (_card(strike_item["card"]), _card(colour_item["card"]))
        if inspection[0] == inspection[1]:
            _fail()
    if (inspection is not None) != ("inspection_ack" in actions) and preplay_pending is None:
        _fail()
    mates = [index for index in range(count) if parties[index] == parties[seat] and index != seat]
    partner = mates[0] if len(mates) == 1 else None
    if len(mates) > 1:
        _fail()
    partner_cards = None
    if view["partner_hand"] is not None:
        raw = _object(view["partner_hand"], "player_id cards")
        if (phase not in PLAY_PHASES or not options["open_partner_hand"]
                or partner is None or raw["player_id"] != players[partner]):
            _fail()
        partner_cards = tuple(_card(card) for card in _list(raw["cards"]))
        if len(partner_cards) != counts[partner] or set(partner_cards) & set(hand or ()):
            _fail()
    partner_feedback = own_feedback = None
    for item in _list(view["feedback"]):
        item = _object(item, "sender recipient value sequence")
        if type(item["value"]) is not str or item["value"] not in FEEDBACK_VALUES or not _int(item["sequence"], 1):
            _fail()
        if profile.blind and (item["sender"] not in players or item["recipient"] not in players
                              or players.index(item["sender"]) in inspectors
                              or players.index(item["recipient"]) not in inspectors):
            _fail()
        if partner is not None and (item["sender"], item["recipient"]) == (players[partner], player_id):
            partner_feedback = item["value"]
        elif partner is not None and (item["sender"], item["recipient"]) == (player_id, players[partner]):
            own_feedback = item["value"]
        else:
            _fail()
    if not _int(view["feedback_opportunity"]):
        _fail()
    if "partner_feedback" in actions and (phase != "bid_response" or partner is None
                                             or parties[seat] == pending[0] or own_feedback is not None
                                             or (profile.blind and seat in inspectors)):
        _fail()
    played = {card for _, card in current} | {card for cards, _ in (history or ()) for _, card in cards}
    if last is not None:
        played |= {card for _, card in last[0]}
    if played & (set(hand or ()) | set(partner_cards or ())):
        _fail()
    public = dict(bloedeln)
    for index, visible in ((seat, hand), (partner, partner_cards)):
        if visible is not None and any(card in visible and owner != index for owner, card in bloedeln):
            _fail()
        if (visible is not None and index in public and completed == 0 and index not in {owner for owner, _ in current}
                and public[index] not in visible):
            _fail()
    if inspection is not None and set(inspection) & set(public.values()):
        _fail()
    first_cards = history[0][0] if history else current if completed == 0 else last[0] if completed == 1 and last else ()
    if any(owner in public and public[owner] != card for owner, card in first_cards):
        _fail()
    return SeatSnapshot(
        deal_id=view["deal_id"], phase=phase, opportunity=opportunity, profile=profile,
        show_rechter=options["show_rechter"], open_partner_hand=options["open_partner_hand"], dealer_seat=dealer,
        players=tuple(players), seat_parties=tuple(parties), card_counts=tuple(counts), tricks_won=tuple(tricks_won), scores=tuple(scores),
        target_points=target, finished=bool(view["winners"]) or raw_bid["result"] is not None,
        party_tricks=(party_tricks[0], party_tricks[1]), card_turn=card_turn, current_trick=current, last_trick=last,
        history=history, accepted_stake=raw_bid["accepted_stake"], pending=pending, thanks=tuple(sorted(thanks)),
        announced_strike=announced, reference=reference, seat=seat, player_id=player_id, hand=hand,
        actions=actions, inspection=inspection, partner_seat=partner, partner_cards=partner_cards,
        partner_feedback=partner_feedback, own_feedback=own_feedback,
        feedback_opportunity=view["feedback_opportunity"],
        deal_revision=revision, announcement_roles=roles, schoeneres_enabled=schoeneres_enabled,
        preplay_pending=preplay_pending, bloedeln_cards=tuple(bloedeln),
    )


@dataclass(frozen=True, slots=True, repr=False)
class CpuMemory:
    """Per-seat permitted knowledge; ``plays`` are (trick, position, seat, card).

    ``strike``/``suit`` record only an actually received call (announcement,
    own inspection, matching reference); they never imply an official trump
    duty, which follows the seat's role. ``inspected`` keeps the two original
    cards seen in this seat's own window. Inferences are recomputed, not stored.
    """

    player_id: str
    seat: int | None = None
    profile: PlayProfile | None = None
    deal_id: str | None = None
    dealer_seat: int | None = None
    opportunity: int | None = None
    strike: str | None = None
    suit: str | None = None
    inspected: tuple[str, str] | None = None
    thanks: tuple[int, ...] = ()
    plays: tuple[tuple[int, int, int, str], ...] = ()
    winners: tuple[tuple[int, int], ...] = ()
    retired_deals: tuple[str, ...] = ()
    deal_revision: int = 0
    announcement_roles: tuple[int, int, int] | None = None

    def __post_init__(self) -> None:
        try:
            self._validate()
            if self.deal_id is not None and self.announcement_roles is None:
                roles = round_roles(self.profile.player_count, self.dealer_seat, determination=self.profile.determination)
                object.__setattr__(self, "announcement_roles", (roles.strike_announcer, roles.suit_announcer, roles.first_player))
        except (WattenRuleError, WattenPlayError, TypeError) as exc:
            raise WattenCpuMemoryError("watten_cpu_invalid_memory") from exc

    def _validate(self) -> None:
        code = "watten_cpu_invalid_memory"
        if not _text(self.player_id) or (self.seat is None) != (self.profile is None) or not _int(self.deal_revision):
            _fail(code)
        if self.profile is not None and (not isinstance(self.profile, PlayProfile)
                                         or not _int(self.seat, 0, self.profile.player_count)):
            _fail(code)
        retired = self.retired_deals
        if (type(retired) is not tuple or len(retired) > RETIRED_DEAL_LIMIT or not all(map(_text, retired))
                or len(set(retired)) != len(retired)):
            _fail(code)
        if self.deal_id is None:
            if (self.dealer_seat, self.opportunity, self.strike, self.suit, self.inspected) != (None,) * 5 or (
                    self.thanks or self.plays or self.winners or self.deal_revision != 0 or self.announcement_roles is not None):
                _fail(code)
            return
        if self.profile is None or not _text(self.deal_id) or self.deal_id in retired:
            _fail(code)
        profile, count = self.profile, self.profile.player_count
        if not _int(self.dealer_seat, 0, count) or not _int(self.opportunity) or not _int(self.deal_revision):
            _fail(code)
        if self.strike is not None and (type(self.strike) is not str or self.strike not in STRIKES):
            _fail(code)
        if self.suit is not None and (type(self.suit) is not str or self.suit not in WATTEN_SUITS):
            _fail(code)
        if profile.critical and profile.determination == "normal" and self.strike == WELI_STRIKE:
            _fail(code)
        if self.announcement_roles is not None and (type(self.announcement_roles) is not tuple or len(self.announcement_roles) != 3):
            _fail(code)
        if self.deal_revision and self.announcement_roles is None:
            _fail(code)
        role_data = None if self.announcement_roles is None else dict(zip(("strike", "colour", "first_player"), self.announcement_roles))
        roles = _roles(profile, self.dealer_seat, role_data, code=code)
        if self.deal_revision == 0 and roles != round_roles(count, self.dealer_seat, determination=profile.determination):
            _fail(code)
        inspectors = frozenset((roles.dealer, roles.clockwise_next))
        # These fields record a received call, not deductions from public plays.
        if profile.blind and self.seat not in inspectors and (self.strike is not None or self.suit is not None):
            _fail(code)
        if self.inspected is not None:
            if (type(self.inspected) is not tuple or len(self.inspected) != 2
                    or profile.determination != "ladinisch" or self.seat not in inspectors):
                _fail(code)
            strike_card, colour_card = (_card(card, code) for card in self.inspected)
            if strike_card == colour_card or (self.strike, self.suit) != call_from_bottoms(strike_card, colour_card):
                _fail(code)
        if (type(self.thanks) is not tuple or not all(type(seat) is int for seat in self.thanks)
                or list(self.thanks) != sorted(set(self.thanks)) or not set(self.thanks) <= inspectors
                or (self.thanks and not profile.blind)):
            _fail(code)
        if type(self.plays) is not tuple or type(self.winners) is not tuple:
            _fail(code)
        tricks: dict[int, dict[int, tuple[int, str]]] = {}
        previous = None
        for item in self.plays:
            if type(item) is not tuple or len(item) != 4:
                _fail(code)
            trick, position, seat, card = item
            if (not _int(trick, 0, MAX_TRICKS) or not _int(position, 0, count) or not _int(seat, 0, count)
                    or (previous is not None and (trick, position) <= previous)):
                _fail(code)
            tricks.setdefault(trick, {})[position] = (seat, _card(card, code))
            previous = (trick, position)
        cards = [card for *_, card in self.plays]
        if len(set(cards)) != len(cards):
            _fail(code)
        winners: dict[int, int] = {}
        for item in self.winners:
            if type(item) is not tuple or len(item) != 2:
                _fail(code)
            trick, seat = item
            if (not _int(trick, 0, MAX_TRICKS) or not _int(seat, 0, count) or (winners and trick <= max(winners))
                    or len(tricks.get(trick, ())) != count):
                _fail(code)
            winners[trick] = seat
        rules = None
        if self.strike is not None and self.suit is not None:
            rules = ComparisonRules(WattenCall(self.strike, self.suit), critical=profile.critical)
        for trick, positions in tricks.items():
            leaders = {(seat - position) % count for position, (seat, _) in positions.items()}
            expected = roles.first_player if trick == 0 else winners.get(trick - 1)
            if len(leaders) != 1 or (expected is not None and leaders != {expected}):
                _fail(code)
            if rules is not None and trick in winners:
                leader = leaders.pop()
                ordered = [positions[position][1] for position in range(count)]
                if (leader + trick_winner(ordered, rules=rules)) % count != winners[trick]:
                    _fail(code)

    def __repr__(self) -> str:
        # Keep remembered cards and any received call out of logs and diagnostics.
        return f"CpuMemory(player_id={self.player_id!r}, deal_id={self.deal_id!r}, opportunity={self.opportunity})"


def new_memory(player_id: str) -> CpuMemory:
    return CpuMemory(player_id)


def _learn(current: str | None, value: str) -> str:
    if current is not None and current != value:
        _fail("watten_cpu_knowledge_conflict")
    return value


def remember(memory: CpuMemory, snapshot: SeatSnapshot, events: tuple = ()) -> CpuMemory:
    """Merge one parsed own DTO plus deal-bound public call events, or fail closed.

    ``events`` holds ``(deal_id, kind, seat, value)`` tuples taken once from an
    accepted transition's public events. An identical replay is idempotent; an
    older opportunity, a retired deal or any contradiction raises unchanged.
    """
    if not isinstance(memory, CpuMemory) or not isinstance(snapshot, SeatSnapshot):
        _fail("watten_cpu_invalid_memory")
    snap = snapshot
    if snap.player_id != memory.player_id:
        _fail("watten_cpu_foreign_view")
    if memory.profile is not None and (memory.profile != snap.profile or memory.seat != snap.seat):
        _fail("watten_cpu_seat_mismatch")
    if memory.deal_id == snap.deal_id:
        if snap.opportunity < memory.opportunity or snap.deal_revision < memory.deal_revision:
            _fail("watten_cpu_stale_observation")
        if snap.dealer_seat != memory.dealer_seat:
            _fail("watten_cpu_knowledge_conflict")
        if snap.deal_revision == memory.deal_revision:
            previous_roles = memory.announcement_roles
            if previous_roles is not None and previous_roles != (
                    snap.announcement_roles.strike_announcer, snap.announcement_roles.suit_announcer,
                    snap.announcement_roles.first_player):
                _fail("watten_cpu_knowledge_conflict")
            base = memory
        else:
            if snap.opportunity <= memory.opportunity:
                _fail("watten_cpu_stale_observation")
            base = CpuMemory(memory.player_id, snap.seat, snap.profile, snap.deal_id, snap.dealer_seat,
                             snap.opportunity, retired_deals=memory.retired_deals, deal_revision=snap.deal_revision,
                             announcement_roles=(snap.announcement_roles.strike_announcer,
                                                 snap.announcement_roles.suit_announcer, snap.announcement_roles.first_player))
    else:
        if snap.deal_id in memory.retired_deals or (memory.opportunity is not None
                                                    and snap.opportunity <= memory.opportunity):
            _fail("watten_cpu_stale_observation")
        retired = memory.retired_deals
        if memory.deal_id is not None:
            retired = (*retired, memory.deal_id)[-RETIRED_DEAL_LIMIT:]
        # A new deal never inherits private cards, calls or plays of an earlier one.
        base = CpuMemory(memory.player_id, snap.seat, snap.profile, snap.deal_id, snap.dealer_seat,
                         snap.opportunity, retired_deals=retired, deal_revision=snap.deal_revision,
                         announcement_roles=(snap.announcement_roles.strike_announcer,
                                             snap.announcement_roles.suit_announcer, snap.announcement_roles.first_player))
    profile, count = snap.profile, snap.profile.player_count
    roles = snap.announcement_roles
    inspectors = frozenset((roles.dealer, roles.clockwise_next))
    strike, suit, inspected, thanks = base.strike, base.suit, base.inspected, set(base.thanks)
    if type(events) is not tuple:
        _fail("watten_cpu_invalid_event")
    for event in events:
        if type(event) is not tuple or len(event) != 4:
            _fail("watten_cpu_invalid_event")
        deal_id, kind, seat, value = event
        if deal_id != snap.deal_id:
            _fail("watten_cpu_event_deal_mismatch")
        if not _int(seat, 0, count):
            _fail("watten_cpu_invalid_event")
        if kind == "watten_thanks":
            if value is not None or not profile.blind or seat not in inspectors or seat not in snap.thanks:
                _fail("watten_cpu_invalid_event")
            thanks.add(seat)
        elif kind in ("strike_announced", "colour_announced"):
            if profile.blind:
                # Blind Ladinisch never publishes the call; such an event is a leak.
                _fail("watten_cpu_unpermitted_call")
            if snap.phase not in PLAY_PHASES and not (
                    profile.determination == "normal" and kind == "strike_announced" and snap.phase == "colour"):
                _fail("watten_cpu_invalid_event")
            if kind == "strike_announced":
                if (seat != roles.strike_announcer or value not in STRIKES
                        or (value == WELI_STRIKE and profile.critical and profile.determination == "normal")):
                    _fail("watten_cpu_invalid_event")
                strike = _learn(strike, value)
            else:
                if seat != roles.suit_announcer or value not in WATTEN_SUITS:
                    _fail("watten_cpu_invalid_event")
                suit = _learn(suit, value)
        else:
            _fail("watten_cpu_invalid_event")
    if snap.announced_strike is not None:
        if profile.determination != "normal":
            _fail()
        strike = _learn(strike, snap.announced_strike)
    if snap.inspection is not None:
        if inspected is not None and inspected != snap.inspection:
            _fail("watten_cpu_knowledge_conflict")
        inspected = snap.inspection
        derived = call_from_bottoms(*inspected)
        strike, suit = _learn(strike, derived[0]), _learn(suit, derived[1])
    if snap.reference is not None:
        if snap.reference == WELI:
            strike = _learn(strike, WELI_STRIKE)
        else:
            strike, suit = _learn(strike, card_rank(snap.reference)), _learn(suit, card_suit(snap.reference))
    thanks |= set(snap.thanks)
    plays = {(trick, position): (seat, card) for trick, position, seat, card in base.plays}
    winners = dict(base.winners)

    def record(index: int, cards: tuple[tuple[int, str], ...], winner: int | None) -> None:
        for position, entry in enumerate(cards):
            if plays.setdefault((index, position), entry) != entry:
                _fail("watten_cpu_knowledge_conflict")
        if winner is not None and winners.setdefault(index, winner) != winner:
            _fail("watten_cpu_knowledge_conflict")

    completed = sum(snap.party_tricks)
    for index, (cards, winner) in enumerate(snap.history or ()):
        record(index, cards, winner)
    if snap.last_trick is not None:
        record(completed - 1, *snap.last_trick)
    if snap.current_trick:
        record(completed, snap.current_trick, None)
    forced = dict(snap.bloedeln_cards)
    if any(trick == 0 and seat in forced and forced[seat] != card
           for (trick, _), (seat, card) in plays.items()):
        _fail("watten_cpu_knowledge_conflict")
    if {card for _, card in plays.values()} & set(snap.hand or ()):
        _fail("watten_cpu_knowledge_conflict")
    return CpuMemory(
        memory.player_id, snap.seat, profile, snap.deal_id, snap.dealer_seat, snap.opportunity, strike, suit,
        inspected, tuple(sorted(thanks)),
        tuple((trick, position, seat, card) for (trick, position), (seat, card) in sorted(plays.items())),
        tuple(sorted(winners.items())), base.retired_deals, snap.deal_revision,
        (roles.strike_announcer, roles.suit_announcer, roles.first_player),
    )


def observe(memory: CpuMemory, view: object, events: tuple = ()) -> CpuMemory:
    """Parse this CPU's own personal DTO and merge it with deal-bound call events."""
    if not isinstance(memory, CpuMemory):
        _fail("watten_cpu_invalid_memory")
    return remember(memory, read_personal_view(view, player_id=memory.player_id), events)


def memory_to_storage(memory: CpuMemory) -> dict:
    """Explicit JSON schema for PRIVATE server storage, never a response or log."""
    if not isinstance(memory, CpuMemory):
        _fail("watten_cpu_invalid_memory")
    profile = memory.profile
    return {
        "schema": MEMORY_SCHEMA, "kind": _STORAGE_KIND, "player_id": memory.player_id, "seat": memory.seat,
        "profile": None if profile is None else {"player_count": profile.player_count,
                                                 "determination": profile.determination,
                                                 "blind": profile.blind, "critical": profile.critical},
        "deal_id": memory.deal_id, "dealer_seat": memory.dealer_seat, "opportunity": memory.opportunity,
        "strike": memory.strike, "suit": memory.suit,
        "inspected": None if memory.inspected is None else list(memory.inspected),
        "thanks": list(memory.thanks),
        "plays": [{"trick": trick, "position": position, "seat": seat, "card": card}
                  for trick, position, seat, card in memory.plays],
        "winners": [{"trick": trick, "seat": seat} for trick, seat in memory.winners],
        "retired_deals": list(memory.retired_deals),
        "deal_revision": memory.deal_revision,
        "announcement_roles": None if memory.announcement_roles is None else dict(zip(
            ("strike", "colour", "first_player"), memory.announcement_roles)),
    }


def memory_from_storage(payload: object) -> CpuMemory:
    """Restore exactly our own schema; any unknown, missing or invalid value fails closed."""
    code = "watten_cpu_invalid_memory"
    value = _object(payload, " ".join(sorted(_STORAGE_KEYS)), _OPTIONAL_STORAGE_KEYS, code=code)
    if type(value["schema"]) is not int or value["schema"] != MEMORY_SCHEMA or value["kind"] != _STORAGE_KIND:
        _fail(code)
    profile = None
    if value["profile"] is not None:
        try:
            profile = PlayProfile(**_object(value["profile"], "player_count determination blind critical", code=code))
        except WattenPlayError:
            _fail(code)
    inspected = value["inspected"]
    if inspected is not None:
        inspected = tuple(_list(inspected, code))
    plays = tuple(
        (item["trick"], item["position"], item["seat"], item["card"])
        for item in (_object(entry, "trick position seat card", code=code) for entry in _list(value["plays"], code)))
    winners = tuple((item["trick"], item["seat"])
                    for item in (_object(entry, "trick seat", code=code) for entry in _list(value["winners"], code)))
    roles = value.get("announcement_roles")
    if roles is not None:
        raw = _object(roles, "strike colour first_player", code=code)
        roles = (raw["strike"], raw["colour"], raw["first_player"])
    return CpuMemory(value["player_id"], value["seat"], profile, value["deal_id"], value["dealer_seat"],
                     value["opportunity"], value["strike"], value["suit"], inspected,
                     tuple(_list(value["thanks"], code)), plays, winners, tuple(_list(value["retired_deals"], code)),
                     value.get("deal_revision", 0), roles)
