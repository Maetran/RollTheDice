"""Local Watten composition, private checkpoint codec and per-recipient views.

Sockets/HTTP must take game_lock before changing this state. Immutable room
and engine replacements are committed before becoming live or acknowledged.
The personal CPU runner composes these transitions. Terminal checkpoints share
one transaction with the explicit local draft progression journal; there is no
automatic forfeit.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import secrets
from dataclasses import dataclass, replace
from datetime import datetime
from weakref import WeakValueDictionary

from sqlalchemy import or_, select, update

from .database import database_schema_ready, session_scope
from .models import ActiveGame, User
from .security import hash_password, utcnow, verify_password
from .watten_cpu_memory import CpuMemory, memory_from_storage, memory_to_storage, new_memory
from .watten_engine import (
    EngineActor,
    EngineCommand,
    EngineRecipe,
    EngineState,
    SeatBinding,
    announcement_roles,
    apply_command,
    next_deal,
    play_forced_openings,
    preplay_seats,
    restore_storage,
    start_match,
    storage_payload,
)
from .watten_evidence import PlayerBids
from .watten_match_evidence import (
    advance_bid_counters,
    counters_from_storage,
    counters_to_storage,
    new_bid_counters,
    validate_bid_counters,
)
from .watten_recipe import WattenRecipe, dumps_canonical_json, recipe_to_payload, require_fields
from .watten_room import (
    WattenRoom,
    admit,
    close_expired,
    create_room,
    decline_reservation,
    finish,
    leave,
    place_cpu,
    remove_cpu,
    room_from_payload,
    room_to_payload,
    start,
    start_roster,
    take_seat,
)
from .watten_views import member_view, spectator_view

_LOCKS: WeakValueDictionary[str, asyncio.Lock] = WeakValueDictionary()
_RANDOM = secrets.SystemRandom()
_CALL_KINDS = frozenset({"strike_announced", "colour_announced"})
ROOM_ACTIONS = frozenset({"watten_take_seat", "watten_decline_reservation", "watten_place_cpu", "watten_remove_cpu", "watten_start", "watten_next_deal", "watten_delivery_ack", "watten_leave", "leave_waiting_game"})
WATTEN_ACTIONS = ROOM_ACTIONS | {"watten_command"}


def game_lock(game: dict) -> asyncio.Lock:
    return _LOCKS.setdefault(str(game["_id"]), asyncio.Lock())


@dataclass(frozen=True, slots=True)
class CallDelivery:
    delivery_id: str
    participant_id: str
    deal_id: str
    kind: str
    seat: int
    value: str


@dataclass(frozen=True, slots=True)
class RuntimeAck:
    account_id: int
    command_id: str
    digest: str
    room_revision: int
    deal_id: str | None
    opportunity: int | None


@dataclass(frozen=True, slots=True, repr=False)
class WattenRuntime:
    room: WattenRoom
    engine: EngineState | None
    names: tuple[tuple[str, str], ...]
    deliveries: tuple[CallDelivery, ...] = ()
    acks: tuple[RuntimeAck, ...] = ()
    absent: tuple[str, ...] = ()
    lifecycle_revision: int = 0
    cpu_memories: tuple[CpuMemory, ...] = ()
    bid_counters: tuple[PlayerBids, ...] | None = None
    round_review_started_at: str | None = None
    abort_reason: str | None = None

    def __post_init__(self):
        if not isinstance(self.room, WattenRoom) or type(self.names) is not tuple:
            raise ValueError("watten_invalid_runtime")
        participants = {item.participant_id for item in (*self.room.members, *self.room.cpus)}
        if (any(type(item) is not tuple or len(item) != 2 or type(item[0]) is not str
                or type(item[1]) is not str or not 1 <= len(item[1]) <= 64 for item in self.names)
                or len(dict(self.names)) != len(self.names) or set(dict(self.names)) != participants):
            raise ValueError("watten_invalid_names")
        if self.engine is None:
            if self.room.status not in {"waiting", "closed"}:
                raise ValueError("watten_runtime_engine_required")
        else:
            roster = start_roster(self.room)
            if (self.engine.recipe != _engine_recipe(roster) or self.room.status != (
                    "finished" if self.engine.phase == "match_complete" else "started")):
                raise ValueError("watten_runtime_engine_mismatch")
        if self.abort_reason is not None and (
                self.abort_reason != "inactivity_timeout" or self.engine is None
                or self.engine.phase == "match_complete" or self.absent):
            raise ValueError("watten_invalid_abort")
        validate_bid_counters(self.bid_counters, self.engine)
        if self.round_review_started_at is not None and (
                type(self.round_review_started_at) is not str
                or datetime.fromisoformat(self.round_review_started_at).tzinfo is None
                or self.engine is None or self.engine.phase not in {"deal_complete", "match_complete"}):
            raise ValueError("watten_invalid_round_review")
        seated_humans = {item.participant_id for item in self.room.members if item.seat is not None}
        if (type(self.lifecycle_revision) is not int or self.lifecycle_revision < 0
                or type(self.absent) is not tuple or any(type(item) is not str for item in self.absent)
                or tuple(sorted(set(self.absent))) != self.absent
                or not set(self.absent) <= seated_humans
                or (self.absent and (self.engine is None or self.engine.phase == "match_complete"))):
            raise ValueError("watten_invalid_absence")
        cpu_ids = {item.participant_id for item in self.room.cpus}
        if (type(self.cpu_memories) is not tuple or any(not isinstance(item, CpuMemory) for item in self.cpu_memories)
                or len({item.player_id for item in self.cpu_memories}) != len(self.cpu_memories)
                or not {item.player_id for item in self.cpu_memories} <= cpu_ids):
            raise ValueError("watten_invalid_cpu_memory")
        if type(self.deliveries) is not tuple or len(self.deliveries) > 2 * self.room.recipe.player_count:
            raise ValueError("watten_invalid_delivery")
        delivery_keys = []
        for item in self.deliveries:
            if (not isinstance(item, CallDelivery) or self.engine is None or self.room.recipe.blind
                    or item.participant_id not in participants or item.deal_id != self.engine.deal_id
                    or item.kind not in _CALL_KINDS or type(item.seat) is not int
                    or not 0 <= item.seat < self.room.recipe.player_count
                    or type(item.delivery_id) is not str or not 1 <= len(item.delivery_id) <= 300):
                raise ValueError("watten_invalid_delivery")
            expected = self.engine.normal_strike if item.kind == "strike_announced" else (
                self.engine.call.trump_suit if self.engine.call else None)
            if self.room.recipe.determination == "ladinisch" and self.engine.call and item.kind == "strike_announced":
                expected = self.engine.call.strike_rank
            if item.value != expected:
                raise ValueError("watten_invalid_delivery")
            roles = announcement_roles(self.engine)
            if item.seat != (roles.strike_announcer if item.kind == "strike_announced" else roles.suit_announcer):
                raise ValueError("watten_invalid_delivery")
            delivery_keys.append((item.participant_id, item.kind))
        if len(set(delivery_keys)) != len(delivery_keys):
            raise ValueError("watten_invalid_delivery")
        if type(self.acks) is not tuple or len(self.acks) > 64 * self.room.recipe.player_count:
            raise ValueError("watten_invalid_runtime_ack")
        accounts = {item.account_id for item in self.room.members}
        keys = []
        for item in self.acks:
            if (not isinstance(item, RuntimeAck) or type(item.account_id) is not int or item.account_id not in accounts
                    or type(item.command_id) is not str or not 1 <= len(item.command_id) <= 160
                    or type(item.digest) is not str or len(item.digest) != 64
                    or any(char not in "0123456789abcdef" for char in item.digest)
                    or type(item.room_revision) is not int or not 0 <= item.room_revision <= self.room.revision
                    or (item.deal_id is not None and (type(item.deal_id) is not str or not item.deal_id))
                    or (item.opportunity is not None and (type(item.opportunity) is not int or item.opportunity < 0))):
                raise ValueError("watten_invalid_runtime_ack")
            if ((item.deal_id is None) != (item.opportunity is None)
                    or (item.deal_id is not None and (self.engine is None or item.opportunity > self.engine.opportunity
                        or item.deal_id not in {self.engine.deal_id, *(result.deal_id for result in self.engine.ledger.applied_results)}))):
                raise ValueError("watten_invalid_runtime_ack")
            keys.append((item.account_id, item.command_id))
        if len(keys) != len(set(keys)) or any(sum(item.account_id == account for item in self.acks) > 64 for account in accounts):
            raise ValueError("watten_invalid_runtime_ack")

    def __repr__(self):
        return f"WattenRuntime(status={self.room.status!r}, revision={self.room.revision})"


def _engine_recipe(roster) -> EngineRecipe:
    recipe = roster.recipe
    return EngineRecipe(roster.profile, tuple(SeatBinding(player, account) for player, account in zip(roster.seats, roster.accounts)),
                        roster.deal_parties(roster.first_dealer).parties if recipe.player_count == 4 else None,
                        recipe.target_points, recipe.show_rechter, recipe.partner_hand, recipe.trick_history,
                        recipe.schoeneres_enabled)


def cryptographic_deal(count: int, dealer: int):
    from .watten_cards import deal_cards, make_deck

    cards = list(make_deck())
    _RANDOM.shuffle(cards)
    # Explicit server allocation, without asserting a regional packet animation.
    schedule = tuple((dealer + 1 + offset) % count for _ in range(5) for offset in range(count))
    return deal_cards(cards, player_count=count, recipient_order=schedule)


def _redraw_callers(engine: EngineState):
    """Trusted partial redeal: only consenting callers return cards to stock."""
    from .watten_cards import DealtCards

    callers = preplay_seats(engine, "schoeneres")
    pool = [*engine.deal.stock, *(card for seat in callers for card in engine.deal.hands[seat])]
    _RANDOM.shuffle(pool)
    hands = list(engine.deal.hands)
    for seat in callers:
        hands[seat] = tuple(pool[:5])
        del pool[:5]
    return DealtCards(tuple(hands), tuple(pool), tuple(hand[-1] for hand in hands))


def new_watten_game(game_id: str, name: str, mode: object) -> dict:
    if str(mode) not in {"2", "3", "4"}:
        raise ValueError("watten_invalid_player_count")
    now = utcnow()
    # Configuration needs the authenticated creator; never register a partial
    # adapter result or start through the existing automatic-start hook.
    return {"_id": game_id, "_name": name, "_mode": str(mode), "_game_type": "watten", "_watten": None,
            "_players": [], "_spectators": [], "_started": False, "_finished": False, "_aborted": False,
            "_hardcore": False, "_expected": int(mode), "_started_at": None, "_finished_at": None,
            "_updated_at": now.isoformat(), "_last_activity": now, "_passphrase": None,
            "_completion_persisted": False, "_watten_result": None}


def configure_watten_game(game: dict, recipe: WattenRecipe, identity, passphrase: str | None) -> None:
    if game.get("_watten") is not None or recipe.player_count != game["_expected"]:
        raise ValueError("watten_invalid_configuration")
    if recipe.password_required != bool(passphrase):
        raise ValueError("watten_password_option_mismatch")
    room = create_room(game["_id"], recipe, host_account=identity.user_id, now=utcnow(), wait_seconds=3600)
    from .watten_cpu import available_cpu_names

    pool = iter(available_cpu_names((identity.username,)))
    names = (("p1", identity.username), *tuple((cpu.participant_id, next(pool)) for cpu in room.cpus))
    game["_watten"] = WattenRuntime(room, None, names)
    game["_passphrase"] = hash_password(passphrase) if passphrase else None
    game["_players"] = [{"id": "p1", "name": identity.username, "user_id": identity.user_id, "ws": None}]


def passphrase_matches(game: dict, value: object) -> bool:
    expected = game["_passphrase"]
    return expected is None or (type(value) is str and verify_password(value, expected))


def account_protection_verified(game: dict, account: int, value: object) -> bool:
    series = game["_watten"].room.series
    if series is not None and series.roster_locked:
        return series.seat_for_account(account) is not None
    if passphrase_matches(game, value):
        return True
    from .watten_invitations import accepted_invitation_access

    return accepted_invitation_access(game, account)


def copy_game(game: dict) -> dict:
    return {**game, "_players": [dict(item) for item in game["_players"]],
            "_spectators": [dict(item) for item in game["_spectators"]]}


def _sync(game: dict, runtime: WattenRuntime, *, public: bool) -> None:
    terminal = runtime.engine is not None and runtime.engine.phase in {"deal_complete", "match_complete"}
    if terminal and runtime.round_review_started_at is None:
        runtime = replace(runtime, round_review_started_at=utcnow().isoformat() if public else game["_updated_at"])
    elif not terminal and runtime.round_review_started_at is not None:
        runtime = replace(runtime, round_review_started_at=None)
    game["_watten"] = runtime
    game["_started"] = runtime.engine is not None and runtime.abort_reason is None
    game["_finished"] = bool(runtime.abort_reason or runtime.engine and runtime.engine.phase == "match_complete")
    game["_aborted"] = runtime.room.status == "closed" or runtime.abort_reason is not None
    if runtime.abort_reason is not None:
        game["_abort_reason"] = runtime.abort_reason
    if public:
        now = utcnow()
        game["_updated_at"] = now.isoformat()
        game["_last_activity"] = now
        if game["_started"] and game["_started_at"] is None:
            game["_started_at"] = now.isoformat()
        if game["_finished"] and game["_finished_at"] is None:
            game["_finished_at"] = now.isoformat()


def admit_account(game: dict, identity, revision: int, protection: object) -> tuple[dict, str]:
    candidate, runtime = copy_game(game), game["_watten"]
    if runtime.abort_reason is not None:
        raise ValueError("watten_room_closed")
    existing = next((member for member in runtime.room.members if member.account_id == identity.user_id), None)
    if existing is None and not account_protection_verified(game, identity.user_id, protection):
        raise ValueError("watten_wrong_passphrase")
    admission = admit(runtime.room, revision=revision, account_id=identity.user_id, now=utcnow(), protection_verified=True)
    # Update names and room together so the constructor never observes an
    # admitted participant without its presentation name.
    names = dict(runtime.names)
    if runtime.engine is None:
        names[admission.participant_id] = identity.username
        names = _cpu_names(admission.room, names)
    runtime = replace(runtime, room=admission.room, names=tuple(names.items()))
    _sync(candidate, runtime, public=not admission.rejoined)
    player = next((item for item in candidate["_players"] if item["id"] == admission.participant_id), None)
    if player is None:
        candidate["_players"].append({"id": admission.participant_id, "name": identity.username, "user_id": identity.user_id, "ws": None})
    else:
        player["name"] = names[admission.participant_id]
    return candidate, admission.participant_id


def resume_account(game: dict, account: int, player: str, *, lifecycle_revision: object) -> None:
    """A fresh authenticated deliberate return restores only its own presence."""
    runtime = game["_watten"]
    if runtime.abort_reason is not None:
        raise ValueError("watten_room_closed")
    _require_lifecycle(runtime, {"lifecycle_revision": lifecycle_revision})
    if type(account) is not int or not any(item.account_id == account and item.participant_id == player and item.seat is not None for item in runtime.room.members):
        raise ValueError("watten_actor_not_bound")
    if player in runtime.absent:
        runtime = replace(runtime, absent=tuple(item for item in runtime.absent if item != player),
                          lifecycle_revision=runtime.lifecycle_revision + 1)
        _sync(game, _resume_forced_openings(runtime), public=True)


def _resume_forced_openings(runtime: WattenRuntime) -> WattenRuntime:
    """Settle a legacy forced turn only while every human is present.

    Current commands already settle these turns in their own transaction.
    Recovery and an explicit return can encounter a checkpoint written by a
    client that still required the obligated player to click their bottom.
    """
    if runtime.engine is None or runtime.absent or runtime.abort_reason is not None:
        return runtime
    engine = play_forced_openings(runtime.engine)
    if engine is runtime.engine:
        return runtime
    from .watten_cpu_runtime import observe_cpu_memories

    return observe_cpu_memories(replace(runtime, engine=replace(
        engine, opportunity=runtime.engine.opportunity + 1)))


def _require_lifecycle(runtime: WattenRuntime, data: dict) -> None:
    if type(data.get("lifecycle_revision")) is not int or data["lifecycle_revision"] != runtime.lifecycle_revision:
        raise ValueError("watten_stale_lifecycle")


def _cached_runtime_ack(runtime: WattenRuntime, account: int, data: dict) -> tuple[str, RuntimeAck | None]:
    command_id = data.get("command_id")
    if type(command_id) is not str or not 1 <= len(command_id) <= 160:
        raise ValueError("watten_command_id_required")
    digest = hashlib.sha256(dumps_canonical_json(data).encode()).hexdigest()
    for item in runtime.acks:
        if item.account_id == account and item.command_id == command_id:
            if item.digest != digest:
                raise ValueError("watten_command_conflict")
            return digest, item
    return digest, None


def apply_runtime_action(game: dict, account: int, player: str, data: dict, *, eligible_accounts=None) -> tuple[dict, dict, bool, set[str] | None]:
    """Called only under lock after fresh socket ownership/account checks.

    Returns candidate, safe ACK, replay flag and optional private recipients.
    No socket, DB or public notification happens before the caller commits it.
    """
    runtime = game["_watten"]
    if runtime.abort_reason is not None:
        raise ValueError("watten_room_closed")
    if type(account) is not int or type(player) is not str:
        raise ValueError("watten_actor_not_bound")
    member = next((item for item in runtime.room.members if item.account_id == account and item.participant_id == player), None)
    if member is None:
        raise ValueError("watten_actor_not_bound")
    action = data.get("action")
    candidate = copy_game(game)
    private = None
    if action == "watten_command":
        require_fields(data, frozenset({"action", "command_id", "deal_id", "opportunity", "phase", "kind", "value", "private_opportunity", "lifecycle_revision"}), ValueError, "watten_command")
        _require_lifecycle(runtime, data)
        if runtime.absent and data["kind"] != "partner_feedback":
            raise ValueError("watten_match_paused")
        if runtime.engine is None:
            raise ValueError("watten_not_started")
        command = EngineCommand(data["command_id"], data["deal_id"], data["opportunity"], data["phase"], data["kind"], data["value"], data["private_opportunity"])
        return _apply_engine_command(game, EngineActor(player, account), command)
    if action not in ROOM_ACTIONS:
        raise ValueError("watten_action_unavailable")
    digest, cached = _cached_runtime_ack(runtime, account, data)
    if cached:
        return candidate, _ack_payload(cached, runtime.lifecycle_revision), True, {player}
    _require_lifecycle(runtime, data)
    revision = data.get("revision")
    if type(revision) is not int or revision != runtime.room.revision:
        raise ValueError("watten_stale_room_revision")
    now = utcnow()
    common = {"action", "command_id", "revision", "lifecycle_revision"}
    allowed = common | ({"seat", "team"} if action == "watten_take_seat" else {"seat"} if action in {"watten_place_cpu", "watten_remove_cpu"}
                        else {"delivery_ids"} if action == "watten_delivery_ack" else {"deal_id", "opportunity"} if action == "watten_next_deal" else set())
    require_fields(data, frozenset(allowed), ValueError, "watten_command")
    room, engine, deliveries = runtime.room, runtime.engine, runtime.deliveries
    bid_counters = runtime.bid_counters
    if action == "watten_take_seat":
        room = take_seat(room, revision=revision, account_id=account, seat=data["seat"], team=data["team"], now=now)
    elif action == "watten_decline_reservation":
        room = decline_reservation(room, revision=revision, account_id=account, now=now)
    elif action == "watten_place_cpu":
        room = place_cpu(room, revision=revision, account_id=account, seat=data["seat"], now=now)
    elif action == "watten_remove_cpu":
        room = remove_cpu(room, revision=revision, account_id=account, seat=data["seat"], now=now)
    elif action == "leave_waiting_game":
        if engine is not None:
            raise ValueError("watten_running_leave_unsupported")
        room = leave(room, revision=revision, account_id=account, now=now,
                     eligible_host_accounts=eligible_accounts)
    elif action == "watten_start":
        started = start(room, revision=revision, account_id=account, now=now, first_dealer=_RANDOM.randrange(room.recipe.player_count))
        room = started.room
        roster = started.roster
        engine = start_match(_engine_recipe(roster), f"{room.room_id}-{secrets.token_hex(8)}",
                             cryptographic_deal(room.recipe.player_count, roster.first_dealer), first_dealer=roster.seats[roster.first_dealer])
        bid_counters = new_bid_counters(engine)
    elif action == "watten_next_deal":
        if runtime.absent:
            raise ValueError("watten_match_paused")
        if player != room.host_participant_id:
            raise ValueError("watten_host_required")
        if (engine is None or data["deal_id"] != engine.deal_id or type(data["opportunity"]) is not int
                or data["opportunity"] != engine.opportunity):
            raise ValueError("watten_stale_opportunity")
        from .watten_round_runtime import review_deadlines

        deadlines = review_deadlines(game)
        if deadlines is not None:
            from .watten_round_runtime import utcnow as review_now

            if review_now() < deadlines[1]:
                raise ValueError("watten_round_review_pending")
        dealer = (engine.dealer_seat + 1) % room.recipe.player_count
        engine = next_deal(engine, f"{room.room_id}-{secrets.token_hex(8)}", cryptographic_deal(room.recipe.player_count, dealer))
        deliveries = ()
    elif action == "watten_leave":
        if engine is None or engine.phase == "match_complete" or member.seat is None:
            raise ValueError("watten_leave_unavailable")
        if player not in runtime.absent:
            runtime = replace(runtime, absent=tuple(sorted((*runtime.absent, player))),
                              lifecycle_revision=runtime.lifecycle_revision + 1)
    elif action == "watten_delivery_ack":
        ids = data["delivery_ids"]
        if type(ids) is not list or len(ids) > 2 or any(type(item) is not str for item in ids):
            raise ValueError("watten_invalid_delivery_ack")
        own = {item.delivery_id for item in deliveries if item.participant_id == player}
        if not set(ids) <= own:
            raise ValueError("watten_invalid_delivery_ack")
        deliveries = tuple(item for item in deliveries if not (item.participant_id == player and item.delivery_id in ids))
        private = {player}
    names = dict(runtime.names)
    ids = {item.participant_id for item in (*room.members, *room.cpus)}
    names = {key: name for key, name in names.items() if key in ids}
    names = _cpu_names(room, names)
    acks = tuple(item for item in runtime.acks if item.account_id in {member.account_id for member in room.members})
    memories = tuple(item for item in runtime.cpu_memories if item.player_id in ids)
    runtime = WattenRuntime(room, engine, tuple(names.items()), deliveries, acks, runtime.absent, runtime.lifecycle_revision, memories, bid_counters,
                            runtime.round_review_started_at if engine is not None and runtime.engine is not None
                            and engine.deal_id == runtime.engine.deal_id else None)
    # A waiting leave removes its own actor; it has no seat or durable retry
    # authority afterwards, so do not retain an ACK tied to a departed member.
    ack = RuntimeAck(account, data["command_id"], digest, room.revision,
                     engine.deal_id if engine else None, engine.opportunity if engine else None)
    if action != "leave_waiting_game":
        own = tuple(item for item in runtime.acks if item.account_id == account)
        others = tuple(item for item in runtime.acks if item.account_id != account)
        runtime = replace(runtime, acks=(*others, *(*own, ack)[-64:]))
    candidate["_players"] = [item for item in candidate["_players"] if item["id"] in ids]
    _sync(candidate, runtime, public=private is None)
    return candidate, _ack_payload(ack, runtime.lifecycle_revision), False, private


def _cpu_names(room: WattenRoom, names: dict[str, str]) -> dict[str, str]:
    from .watten_cpu import available_cpu_names

    used = {names[item.participant_id].casefold() for item in room.members}
    result = dict(names)
    for cpu in room.cpus:
        current = result.get(cpu.participant_id)
        if current is None or current.casefold() in used:
            current = next(iter(available_cpu_names(used)))
            result[cpu.participant_id] = current
        used.add(current.casefold())
    return result


def _apply_engine_command(game: dict, actor: EngineActor, command: EngineCommand) -> tuple[dict, dict, bool, set[str] | None]:
    runtime = game["_watten"]
    if runtime.abort_reason is not None:
        raise ValueError("watten_room_closed")
    candidate = copy_game(game)
    request = runtime.engine.preplay_request
    replacement = _redraw_callers(runtime.engine) if (
        command.kind == "preplay_accept" and request is not None and request.kind == "schoeneres") else None
    transition = apply_command(runtime.engine, actor, command, replacement_deal=replacement)
    ack = {"command_id": transition.ack.command_id, "accepted": True,
           "deal_id": transition.ack.deal_id, "opportunity": transition.ack.opportunity,
           "lifecycle_revision": runtime.lifecycle_revision}
    if transition.replayed:
        return candidate, ack, True, {actor.player_id}
    deliveries = [] if transition.state.deal_revision != runtime.engine.deal_revision else list(runtime.deliveries)
    for kind, seat, value in transition.public_events:
        if kind in _CALL_KINDS:
            for recipient in transition.state.recipe.seats:
                deliveries.append(CallDelivery(f"{transition.state.deal_id}:{transition.state.opportunity}:{kind}:{recipient}",
                                               recipient, transition.state.deal_id, kind, seat, value))
    room = finish(runtime.room, revision=runtime.room.revision) if transition.state.phase == "match_complete" else runtime.room
    if transition.state.phase == "match_complete":
        from .watten_tournament import complete_room_series

        room = complete_room_series(room, transition.state)
    runtime = replace(runtime, room=room, engine=transition.state, deliveries=tuple(deliveries),
                      bid_counters=advance_bid_counters(runtime.bid_counters, actor.player_id, command.kind, command.value))
    private = None
    if command.kind == "partner_feedback":
        private = {item.sender for item in runtime.engine.feedback if item.sender == actor.player_id} | {
            item.recipient for item in runtime.engine.feedback if item.sender == actor.player_id}
    _sync(candidate, runtime, public=private is None)
    return candidate, ack, False, private


def _ack_payload(ack: RuntimeAck, lifecycle_revision: int) -> dict:
    return {"command_id": ack.command_id, "accepted": True, "room_revision": ack.room_revision,
            "deal_id": ack.deal_id, "opportunity": ack.opportunity, "lifecycle_revision": lifecycle_revision}


def snapshot_watten(game: dict, viewer_id: str | None = None, *, viewer_account_id: int | None = None) -> dict:
    from .watten_public_titles import public_title
    from .watten_round_runtime import review_projection
    from .watten_surprises import surprise_offer
    from .watten_tournament import public_score_history, public_series

    runtime = game["_watten"]
    room, engine = runtime.room, None if runtime.abort_reason is not None else runtime.engine
    names = dict(runtime.names)
    member = next((item for item in room.members if item.participant_id == viewer_id), None)
    engine_view = None
    if engine is not None:
        engine_view = member_view(engine, account_id=member.account_id, player_id=member.participant_id) if member and member.seat is not None else spectator_view(engine)
        if runtime.absent and "actions" in engine_view:
            engine_view["actions"] = [action for action in engine_view["actions"] if action == "partner_feedback"]
    account = member.account_id if member else viewer_account_id
    reservation = next((item for item in room.reservations if type(account) is int
                        and item.account_id == account and item.valid_at(utcnow())), None)
    host = next((item for item in room.members if item.participant_id == room.host_participant_id), None)
    seats = []
    for seat in range(room.recipe.player_count):
        occupant = next((item for item in (*room.members, *room.cpus) if item.seat == seat), None)
        seats.append({"seat": seat, "participant_id": occupant.participant_id if occupant else None,
                      "name": names[occupant.participant_id] if occupant else None,
                      "public_title": public_title(game, occupant.participant_id if occupant else None,
                                                   getattr(occupant, "account_id", None)),
                      "is_cpu": any(cpu.seat == seat for cpu in room.cpus), "team": seat % 2 if room.recipe.player_count == 4 else None})
    return {"game_type": "watten", "id": game["_id"], "name": game["_name"], "started": game["_started"],
            "finished": game["_finished"], "aborted": game["_aborted"],
            **({"abort_reason": runtime.abort_reason} if runtime.abort_reason else {}),
            "room": {"revision": room.revision, "status": "closed" if runtime.abort_reason else room.status, "recipe": recipe_to_payload(room.recipe),
                     "series": public_series(room),
                     "required_seat": room.series.seat_for_account(account) if (
                         room.series is not None and room.series.roster_locked and type(account) is int) else None,
                     "host_participant_id": room.host_participant_id, "seats": seats,
                     "rematch": {"source_game_id": room.rematch_of, "game_id": room.rematch_room_id,
                                 "can_create": bool(host and type(account) is int and host.account_id == account
                                     and room.status == "finished" and room.rematch_room_id is None
                                     and not (room.series and room.series.finished))},
                     "reservation": {"seat": reservation.seat, "expires_at": reservation.expires_at.isoformat()} if reservation else None,
                     "members": [{"participant_id": item.participant_id, "name": names[item.participant_id],
                                  "seat": item.seat, "team": item.team} for item in room.members],
                     "wait_expires_at": room.wait_expires_at.isoformat() if room.status == "waiting" else None},
            "viewer": {"participant_id": member.participant_id, "seat": member.seat} if member else None,
            "engine": engine_view,
            "round_review": None if runtime.abort_reason else review_projection(game),
            "score_history": public_score_history(engine),
            "lifecycle_revision": runtime.lifecycle_revision, "paused": bool(runtime.absent),
            "awaited_participant_ids": list(runtime.absent), "can_resume": bool(member and member.participant_id in runtime.absent),
            "pending_call_events": [{"delivery_id": item.delivery_id, "deal_id": item.deal_id,
                                     "kind": item.kind, "seat": item.seat, "value": item.value}
                                    for item in runtime.deliveries if member and item.participant_id == member.participant_id],
            "capabilities": {"cpu_autoplay": _cpu_capability()}, "result_persisted": game["_completion_persisted"],
            "table_surprise_offer": {"deal_id": None, "effect": None} if runtime.abort_reason else surprise_offer(game, viewer_id)}


def lobby_entry(game: dict, account: int) -> dict:
    runtime = game["_watten"]
    member = next((item for item in runtime.room.members if item.account_id == account), None)
    return {"id": game["_id"], "name": game["_name"], "game_type": "watten", "mode": game["_mode"],
            "expected": runtime.room.recipe.player_count, "started": game["_started"], "finished": game["_finished"],
            "locked": bool(game["_passphrase"]), "my_player_id": member.participant_id if member else None,
            "room": snapshot_watten(game, viewer_account_id=account)["room"], "paused": bool(runtime.absent),
            "awaited_participant_ids": list(runtime.absent), "lifecycle_revision": runtime.lifecycle_revision,
            "can_resume": bool(member and member.participant_id in runtime.absent),
            "capabilities": {"cpu_autoplay": _cpu_capability()}}


def _cpu_capability() -> bool:
    from .watten_cpu_runtime import cpu_autoplay_enabled

    return cpu_autoplay_enabled()


def serialize_watten_game(game: dict) -> dict:
    runtime = game["_watten"]
    if not isinstance(runtime, WattenRuntime):
        raise ValueError("watten_unconfigured_game")
    return {"_game_type": "watten", "_id": game["_id"], "_name": game["_name"], "_mode": game["_mode"],
            "_started_at": game["_started_at"], "_finished_at": game["_finished_at"],
            "_updated_at": game["_updated_at"], "_last_activity": game["_last_activity"].isoformat(),
            "_passphrase": game["_passphrase"], "_completion_persisted": game["_completion_persisted"],
            "_watten_result": game["_watten_result"],
            "_watten": {"schema_version": 5 if runtime.abort_reason else 4, "room": room_to_payload(runtime.room),
                        **({"abort_reason": runtime.abort_reason} if runtime.abort_reason else {}),
                        "engine": storage_payload(runtime.engine) if runtime.engine else None,
                        "names": [list(item) for item in runtime.names],
                        "absent": list(runtime.absent), "lifecycle_revision": runtime.lifecycle_revision,
                        "cpu_memories": [memory_to_storage(item) for item in runtime.cpu_memories],
                        "bid_counters": counters_to_storage(runtime.bid_counters),
                        "round_review_started_at": runtime.round_review_started_at,
                        "deliveries": [{"delivery_id": item.delivery_id, "participant_id": item.participant_id,
                                        "deal_id": item.deal_id, "kind": item.kind, "seat": item.seat, "value": item.value}
                                       for item in runtime.deliveries],
                        "acks": [{"account_id": item.account_id, "command_id": item.command_id, "digest": item.digest,
                                  "room_revision": item.room_revision, "deal_id": item.deal_id, "opportunity": item.opportunity}
                                 for item in runtime.acks]}}


def restore_watten_game(raw: dict) -> dict:
    keys = frozenset({"_game_type", "_id", "_name", "_mode", "_started_at", "_finished_at", "_updated_at", "_last_activity", "_passphrase", "_completion_persisted", "_watten_result", "_watten"})
    require_fields(raw, keys, ValueError, "watten_storage")
    if raw["_game_type"] != "watten" or type(raw["_completion_persisted"]) is not bool:
        raise ValueError("watten_invalid_storage")
    data = raw["_watten"]
    version = data.get("schema_version") if type(data) is dict else None
    if type(version) is not int or version not in {1, 2, 3, 4, 5}:
        raise ValueError("watten_invalid_storage")
    fields = {"schema_version", "room", "engine", "names", "deliveries", "acks", "absent", "lifecycle_revision"}
    if version >= 2:
        fields.add("cpu_memories")
    if version >= 3:
        fields.add("bid_counters")
    if version >= 4:
        fields.add("round_review_started_at")
    if version >= 5:
        fields.add("abort_reason")
    data = require_fields(data, frozenset(fields), ValueError, "watten_storage")
    if any(type(data[key]) is not list for key in ("names", "deliveries", "acks", "absent")):
        raise ValueError("watten_invalid_storage")
    room = room_from_payload(data["room"])
    engine = restore_storage(data["engine"]) if data["engine"] is not None else None
    if version == 1 and engine is not None and room.cpus:
        raise ValueError("watten_cpu_legacy_memory_unavailable")
    if version >= 2 and type(data["cpu_memories"]) is not list:
        raise ValueError("watten_invalid_cpu_memory")
    memories = (tuple(memory_from_storage(item) for item in data["cpu_memories"]) if version >= 2
                else tuple(new_memory(cpu.participant_id) for cpu in room.cpus))
    bid_counters = counters_from_storage(data["bid_counters"]) if version >= 3 else None
    deliveries = tuple(CallDelivery(**require_fields(item, frozenset({"delivery_id", "participant_id", "deal_id", "kind", "seat", "value"}), ValueError, "watten_delivery")) for item in data["deliveries"])
    acks = tuple(RuntimeAck(**require_fields(item, frozenset({"account_id", "command_id", "digest", "room_revision", "deal_id", "opportunity"}), ValueError, "watten_ack")) for item in data["acks"])
    runtime = WattenRuntime(room, engine, tuple(tuple(item) if type(item) is list else item for item in data["names"]), deliveries, acks,
                            tuple(data["absent"]), data["lifecycle_revision"], memories, bid_counters,
                            data["round_review_started_at"] if version >= 4 else None,
                            data["abort_reason"] if version >= 5 else None)
    if version >= 5 and runtime.abort_reason is None:
        raise ValueError("watten_invalid_abort")
    from .watten_cpu_runtime import validate_stored_memories

    validate_stored_memories(runtime, allow_empty_waiting=version == 1)
    # Validate the stored memories against their actual old checkpoint before
    # observing the newly public automatic cards in a recovered legacy turn.
    runtime = _resume_forced_openings(runtime)
    if room.room_id != raw["_id"] or str(room.recipe.player_count) != raw["_mode"]:
        raise ValueError("watten_storage_context_mismatch")
    if type(raw["_name"]) is not str or not 1 <= len(raw["_name"].strip()) <= 80:
        raise ValueError("watten_invalid_storage")
    for key in ("_started_at", "_finished_at", "_updated_at"):
        if raw[key] is None and key != "_updated_at":
            continue
        if type(raw[key]) is not str or datetime.fromisoformat(raw[key]).tzinfo is None:
            raise ValueError("watten_invalid_storage")
    if raw["_passphrase"] is not None and (type(raw["_passphrase"]) is not str or not raw["_passphrase"]):
        raise ValueError("watten_invalid_storage")
    if room.recipe.password_required != bool(raw["_passphrase"]):
        raise ValueError("watten_invalid_storage")
    game = new_watten_game(raw["_id"], raw["_name"], raw["_mode"])
    for key in ("_started_at", "_finished_at", "_updated_at", "_passphrase", "_completion_persisted", "_watten_result"):
        game[key] = raw[key]
    game["_last_activity"] = datetime.fromisoformat(raw["_last_activity"])
    if game["_last_activity"].tzinfo is None:
        raise ValueError("watten_invalid_storage")
    game["_players"] = [{"id": member.participant_id, "name": dict(runtime.names)[member.participant_id], "user_id": member.account_id, "ws": None}
                        for member in room.members]
    _sync(game, runtime, public=False)
    if game["_completion_persisted"] and (not game["_finished"] or game["_aborted"]):
        raise ValueError("watten_invalid_storage")
    if (bool(game["_started_at"]) != (runtime.engine is not None) or bool(game["_finished_at"]) != game["_finished"]):
        raise ValueError("watten_invalid_storage")
    if game["_completion_persisted"]:
        from .watten_results import result_payload

        if type(game["_watten_result"]) is not dict or game["_watten_result"] != result_payload(game):
            raise ValueError("watten_invalid_storage")
    elif game["_watten_result"] is not None:
        raise ValueError("watten_invalid_storage")
    return game


def _checkpoint_authority(raw: str, checkpoint: dict) -> None:
    """Follow-up links and terminal aborts are monotonic across every writer."""
    prior = json.loads(raw)
    if type(prior) is not dict or prior.get("_game_type") != "watten":
        raise ValueError("watten_game_id_collision")
    native = prior.get("_watten")
    room = native.get("room") if type(native) is dict else None
    if type(room) is not dict or "rematch_room_id" not in room:
        raise ValueError("watten_invalid_stored_checkpoint")
    if native.get("abort_reason") is not None and native["abort_reason"] != checkpoint["_watten"].abort_reason:
        raise ValueError("watten_stale_checkpoint")
    link = room["rematch_room_id"]
    if link is not None and (type(link) is not str or not link or checkpoint["_watten"].room.rematch_room_id != link):
        raise ValueError("watten_stale_checkpoint")


def _write_checkpoint(db, checkpoint: dict, *, creating=False, expected_json=None) -> bool:
    """Caller-owned transaction; every existing source write uses exact JSON CAS."""
    payload = dumps_canonical_json(serialize_watten_game(checkpoint))
    now = utcnow()
    previous_json = expected_json
    if expected_json is not None:
        _checkpoint_authority(expected_json, checkpoint)
        changed = db.execute(update(ActiveGame).where(ActiveGame.game_id == checkpoint["_id"],
            ActiveGame.state_json == expected_json).values(state_json=payload, updated_at=now))
        if changed.rowcount != 1:
            return False
    else:
        row = db.scalar(select(ActiveGame).where(ActiveGame.game_id == checkpoint["_id"]).with_for_update())
        if row is None:
            if not creating:
                raise ValueError("watten_checkpoint_missing")
            db.add(ActiveGame(game_id=checkpoint["_id"], state_json=payload, created_at=now, updated_at=now))
            db.flush()
        elif creating:
            raise ValueError("watten_game_id_collision")
        else:
            previous_json = row.state_json
            _checkpoint_authority(previous_json, checkpoint)
            changed = db.execute(update(ActiveGame).where(ActiveGame.game_id == checkpoint["_id"],
                ActiveGame.state_json == previous_json).values(state_json=payload, updated_at=now))
            if changed.rowcount != 1:
                raise ValueError("watten_stale_checkpoint")
    from .watten_admissions import sync_checkpoint_memberships

    previous_room = room_from_payload(json.loads(previous_json)["_watten"]["room"]) if previous_json is not None else None
    sync_checkpoint_memberships(db, checkpoint, previous_room, now=now)
    return True


def _record_human_play_day(db, checkpoint: dict, actor: tuple[int, str]) -> None:
    """Account activity shares the accepted checkpoint's transaction."""
    from .game_activity import play_day

    if (type(actor) is not tuple or len(actor) != 2 or type(actor[0]) is not int
            or actor[0] <= 0 or type(actor[1]) is not str):
        raise ValueError("watten_actor_not_bound")
    account, player = actor
    runtime = checkpoint["_watten"]
    if (runtime.engine is None or not any(member.account_id == account
            and member.participant_id == player and member.seat is not None for member in runtime.room.members)
            or not any(record["id"] == player and record.get("user_id") == account
                       for record in checkpoint["_players"])):
        raise ValueError("watten_actor_not_bound")
    day = play_day(utcnow())
    db.execute(update(User).where(User.id == account,
        or_(User.last_played_on.is_(None), User.last_played_on < day)).values(last_played_on=day))


def persist_watten_game(game: dict, *, creating: bool = False,
                        human_actor: tuple[int, str] | None = None,
                        expected_source: str | None = None, commit_guard=None) -> None:
    """Commit before installation; optional internal authority precedes writers.

    Background callers can bind their decision to an already inspected source.
    A guard runs in the same source-locked transaction before result/progress
    writers. Existing callers retain their transaction and checkpoint behavior.
    """
    if not database_schema_ready():
        raise RuntimeError("watten_database_not_ready")
    if commit_guard is not None and expected_source is None:
        raise ValueError("watten_invalid_expected_source")
    checkpoint = copy_game(game)
    from .watten_cpu_runtime import observe_cpu_memories

    checkpoint["_watten"] = observe_cpu_memories(checkpoint["_watten"])
    with session_scope() as db:
        if expected_source is not None:
            if type(expected_source) is not str:
                raise ValueError("watten_invalid_expected_source")
            if db.get_bind().dialect.name == "sqlite":
                connection = db.connection()
                if not connection.connection.driver_connection.in_transaction:
                    connection.exec_driver_sql("BEGIN IMMEDIATE")
            current = db.scalar(select(ActiveGame.state_json).where(
                ActiveGame.game_id == checkpoint["_id"]).with_for_update())
            if current != expected_source:
                raise ValueError("watten_stale_checkpoint")
        if commit_guard is not None:
            commit_guard(db, checkpoint)
        if checkpoint["_finished"] and not checkpoint["_aborted"]:
            from .watten_completion import store_completion_progress
            from .watten_results import store_result_in_session

            checkpoint["_watten_result"] = store_result_in_session(db, checkpoint)
            checkpoint["_completion_persisted"] = True
            store_completion_progress(db, checkpoint)
        options = {"creating": creating}
        if expected_source is not None:
            options["expected_json"] = expected_source
        if not _write_checkpoint(db, checkpoint, **options):
            raise ValueError("watten_stale_checkpoint")
        if human_actor is not None:
            _record_human_play_day(db, checkpoint, human_actor)
        from .watten_public_titles import refresh_public_titles

        db.flush()  # Actual checkpoint/result failures must still abort gameplay.
        titles = refresh_public_titles(db, checkpoint)
    # Publish markers only after session_scope's successful commit.
    game["_watten_result"] = checkpoint["_watten_result"]
    game["_completion_persisted"] = checkpoint["_completion_persisted"]
    game["_finished_at"] = checkpoint["_finished_at"]
    game["_watten"] = checkpoint["_watten"]
    game["_watten_public_titles"] = titles


def restore_watten_json(text: str, *, refresh_titles: bool = True) -> dict:
    if type(text) is not str:
        raise ValueError("watten_invalid_storage")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("watten_invalid_storage")
            result[key] = value
        return result

    def constant(_value):
        raise ValueError("watten_invalid_storage")

    try:
        game = restore_watten_game(json.loads(text, object_pairs_hook=unique, parse_constant=constant))
        from .watten_public_titles import restored_public_titles

        if refresh_titles:
            game["_watten_public_titles"] = restored_public_titles(game)
        return game
    except RecursionError as exc:
        raise ValueError("watten_invalid_storage") from exc


def expire_waiting_game(game: dict) -> bool:
    runtime = game["_watten"]
    if runtime.room.status != "waiting" or utcnow() < runtime.room.wait_expires_at:
        return False
    candidate = copy_game(game)
    _sync(candidate, replace(runtime, room=close_expired(runtime.room, revision=runtime.room.revision, now=utcnow())), public=True)
    persist_watten_game(candidate)
    game.clear()
    game.update(candidate)
    return True


def expire_inactive_game(game: dict) -> bool:
    """Commit an unscored terminal checkpoint under the native table lock.

    The existing activity clock advances for accepted public transitions,
    including actual CPU play and an intentional return. Views, reconnects,
    chat and private acknowledgements never renew this one-hour lifetime.
    Keeping the engine only in the private checkpoint makes a failed terminal
    publication/deletion recoverable without inventing a result or forfeit.
    """
    from .game_state import GAME_TIMEOUT

    runtime = game["_watten"]
    now = utcnow()
    if (runtime.abort_reason is not None or runtime.engine is None
            or runtime.engine.phase == "match_complete" or now - game["_last_activity"] < GAME_TIMEOUT):
        return False
    # A process-local clock must never retire a newer durable turn. Bind the
    # abort to the actual source, including older supported checkpoint codecs.
    with session_scope() as db:
        source = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
    if source is None or serialize_watten_game(restore_watten_json(source, refresh_titles=False)) != serialize_watten_game(game):
        raise ValueError("watten_stale_checkpoint")
    candidate = copy_game(game)
    _sync(candidate, replace(runtime, abort_reason="inactivity_timeout", absent=(), deliveries=(),
                             lifecycle_revision=runtime.lifecycle_revision + 1), public=False)
    candidate["_finished_at"] = candidate["_updated_at"] = now.isoformat()
    persist_watten_game(candidate, expected_source=source)
    game.clear()
    game.update(candidate)
    return True


def finalize_watten_game(game: dict, _files=None) -> dict:
    persist_watten_game(game)
    return {"result_persisted": bool(game["_completion_persisted"])}


def reject_generic_watten_join(_game: dict, _player: dict) -> None:
    raise ValueError("watten_authenticated_coordinator_required")


def never_autostart_watten(_game: dict) -> None:
    return None
