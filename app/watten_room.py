"""Pure, immutable Watten waiting rooms, seats, start roster and rematches.

The technical decisions of this package come from Codex
(docs/WATTEN_ROOM_HANDOFF.md), not from new house rules. Logical seats are
fixed and ordered; account binding, participant ID, seat index and CPU
occupancy stay distinct, and admission is a separate step from a deliberate
seat choice. Four-player parties sit opposite each other (seats 0+2, 1+3)
and a human confirms the chosen seat's team explicitly. Two players play
alone; three keep fixed seats whose solo rotates per deal, without teams.

Each person's transition takes the expected room revision and the trusted,
server-authenticated account; server transitions take the revision. A
rejected action raises and changes nothing. Socket IDs, disconnects,
spectators, chat and pings are no inputs. Everything here is server-internal:
never send a room, its payload or a roster to a participant or a CPU.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from typing import Final

from .watten_bidding import DealParties
from .watten_play import PlayProfile
from .watten_recipe import (
    WattenRecipe,
    WattenRecipeError,
    dumps_canonical_json,
    loads_strict_json,
    recipe_from_payload,
    recipe_to_payload,
    require_fields,
)
from .watten_tournament import NockerlSeries, bind_room_series, series_from_payload, series_to_payload

ROOM_SCHEMA_VERSION: Final = 1
_ROOM_KIND: Final = "watten_room"
_STATUSES: Final = frozenset({"waiting", "started", "finished", "closed"})
_PLAYING: Final = frozenset({"started", "finished"})
_PARTICIPANT_ID: Final = re.compile(r"p[1-9][0-9]{0,8}")
_MAX_ROOM_ID_LENGTH: Final = 128
_ROOM_KEYS: Final = frozenset({
    "kind", "schema_version", "room_id", "recipe", "revision", "status", "host_participant_id", "members",
    "cpus", "reservations", "participant_counter", "wait_seconds", "wait_expires_at", "first_dealer",
    "rematch_of", "rematch_room_id", "series",
})
_MEMBER_KEYS: Final = frozenset({"participant_id", "account_id", "seat", "team"})
_CPU_KEYS: Final = frozenset({"participant_id", "seat"})
_RESERVATION_KEYS: Final = frozenset({"account_id", "seat", "expires_at"})


class WattenRoomError(ValueError):
    """A stable rejection reason; the previous immutable room stays current."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _account(value: object) -> int:
    if type(value) is not int or value < 1:
        raise WattenRoomError("watten_invalid_account")
    return value


def _participant(value: object) -> str:
    if type(value) is not str or not _PARTICIPANT_ID.fullmatch(value):
        raise WattenRoomError("watten_invalid_participant")
    return value


def _room_id(value: object) -> str:
    if type(value) is not str or not value or value != value.strip() or len(value) > _MAX_ROOM_ID_LENGTH:
        raise WattenRoomError("watten_invalid_room_id")
    return value


def _utc(value: object) -> datetime:
    """Explicit aware server time, normalized to UTC; naive times are rejected."""
    if not isinstance(value, datetime) or value.utcoffset() is None:
        raise WattenRoomError("watten_invalid_time")
    return value.astimezone(timezone.utc)


def _wait_seconds(value: object) -> int:
    if type(value) is not int or value < 1:
        raise WattenRoomError("watten_invalid_wait_seconds")
    return value


def seat_team(player_count: int, seat: int) -> int | None:
    """Four players: opposite seats form party 0 (seats 0, 2) and party 1 (1, 3)."""
    return seat % 2 if player_count == 4 else None


@dataclass(frozen=True, slots=True)
class Member:
    """An admitted human bound to one account; the seat is a separate choice."""

    participant_id: str
    account_id: int
    seat: int | None = None
    team: int | None = None

    def __post_init__(self) -> None:
        _participant(self.participant_id)
        _account(self.account_id)
        if self.seat is not None and type(self.seat) is not int:
            raise WattenRoomError("watten_invalid_seat")
        if self.team is not None and type(self.team) is not int:
            raise WattenRoomError("watten_invalid_team")


@dataclass(frozen=True, slots=True)
class CpuOccupant:
    """A CPU the host placed on one concrete seat."""

    participant_id: str
    seat: int

    def __post_init__(self) -> None:
        _participant(self.participant_id)
        if type(self.seat) is not int:
            raise WattenRoomError("watten_invalid_seat")


@dataclass(frozen=True, slots=True)
class SeatReservation:
    """A private seat suggestion; accepting it is a deliberate join and seat choice."""

    account_id: int
    seat: int
    expires_at: datetime

    def __post_init__(self) -> None:
        _account(self.account_id)
        if type(self.seat) is not int:
            raise WattenRoomError("watten_invalid_seat")
        object.__setattr__(self, "expires_at", _utc(self.expires_at))

    def valid_at(self, now: datetime) -> bool:
        return now < self.expires_at


@dataclass(frozen=True, slots=True)
class WattenRoom:
    """Server-internal room state; every relation is checked on construction.

    Members keep admission order, so the first eligible one is the oldest.
    ``recipe.cpu_seats`` always mirrors the current CPU seats, so a rematch
    recipe describes the table as it was actually configured.
    """

    room_id: str
    recipe: WattenRecipe
    revision: int
    status: str
    host_participant_id: str | None
    members: tuple[Member, ...]
    cpus: tuple[CpuOccupant, ...]
    reservations: tuple[SeatReservation, ...]
    participant_counter: int
    wait_seconds: int
    wait_expires_at: datetime
    first_dealer: int | None = None
    rematch_of: str | None = None
    rematch_room_id: str | None = None
    series: NockerlSeries | None = None

    def __post_init__(self) -> None:
        _room_id(self.room_id)
        if not isinstance(self.recipe, WattenRecipe):
            raise WattenRoomError("watten_invalid_room")
        if (type(self.revision) is not int or self.revision < 0
                or type(self.participant_counter) is not int or self.participant_counter < 0):
            raise WattenRoomError("watten_invalid_room")
        if type(self.status) is not str or self.status not in _STATUSES:
            raise WattenRoomError("watten_invalid_room")
        for items, kind in ((self.members, Member), (self.cpus, CpuOccupant), (self.reservations, SeatReservation)):
            if type(items) is not tuple or not all(isinstance(item, kind) for item in items):
                raise WattenRoomError("watten_invalid_room")
        _wait_seconds(self.wait_seconds)
        object.__setattr__(self, "wait_expires_at", _utc(self.wait_expires_at))
        count = self.recipe.player_count
        if len(self.members) > count:
            raise WattenRoomError("watten_room_full")
        participants = [member.participant_id for member in self.members] + [cpu.participant_id for cpu in self.cpus]
        if (len(set(participants)) != len(participants)
                or any(int(participant[1:]) > self.participant_counter for participant in participants)):
            raise WattenRoomError("watten_invalid_participants")
        if len({member.account_id for member in self.members}) != len(self.members):
            raise WattenRoomError("watten_duplicate_account")
        seats = [member.seat for member in self.members if member.seat is not None] + [cpu.seat for cpu in self.cpus]
        if len(set(seats)) != len(seats) or any(not 0 <= seat < count for seat in seats):
            raise WattenRoomError("watten_invalid_seats")
        if any(member.team != (None if member.seat is None else seat_team(count, member.seat))
               for member in self.members):
            raise WattenRoomError("watten_invalid_team")
        if tuple(cpu.seat for cpu in self.cpus) != self.recipe.cpu_seats:
            raise WattenRoomError("watten_cpu_recipe_mismatch")
        reserved = [reservation.seat for reservation in self.reservations]
        if (len(set(reserved)) != len(reserved)
                or len({reservation.account_id for reservation in self.reservations}) != len(reserved)
                or any(not 0 <= seat < count or seat in self.recipe.cpu_seats for seat in reserved)):
            raise WattenRoomError("watten_invalid_reservations")
        if self.host_participant_id is None:
            if self.status != "closed":
                raise WattenRoomError("watten_host_required")
        elif _participant(self.host_participant_id) not in {member.participant_id for member in self.members}:
            raise WattenRoomError("watten_host_required")
        if self.status in _PLAYING:
            if (type(self.first_dealer) is not int or not 0 <= self.first_dealer < count
                    or len(seats) != count or self.reservations):
                raise WattenRoomError("watten_invalid_started_room")
        elif self.first_dealer is not None:
            raise WattenRoomError("watten_invalid_started_room")
        for link in (self.rematch_of, self.rematch_room_id):
            if link is not None and _room_id(link) == self.room_id:
                raise WattenRoomError("watten_invalid_rematch_link")
        if self.rematch_room_id is not None and self.status not in {"finished", "closed"}:
            raise WattenRoomError("watten_invalid_rematch_link")
        if self.series is not None:
            if (not isinstance(self.series, NockerlSeries) or len(self.series.bindings) != count
                    or self.series.target != self.recipe.tournament_nockerl_target):
                raise WattenRoomError("watten_invalid_nockerl_series")
            if self.series.roster_locked:
                if (any(self.series.seat_for_account(member.account_id) is None
                        or member.seat is not None and self.series.seat_for_account(member.account_id) != member.seat
                        for member in self.members)
                        or {f"c:{cpu.seat}" for cpu in self.cpus} != {token for token in self.series.bindings if token.startswith("c:")}
                        or any(self.series.seat_for_account(item.account_id) != item.seat for item in self.reservations)
                        or self.series.finished and self.status == "started"):
                    raise WattenRoomError("watten_tournament_roster_locked")


@dataclass(frozen=True, slots=True)
class StartRoster:
    """Immutable clockwise seat order handed to the P3 core.

    ``seats`` holds participant IDs by seat index, the same index as in
    DealtCards; the matching ``accounts`` entry is None for a CPU. Accounts
    never play cards, participants do.
    """

    room_id: str
    recipe: WattenRecipe
    seats: tuple[str, ...]
    accounts: tuple[int | None, ...]
    first_dealer: int

    def __post_init__(self) -> None:
        _room_id(self.room_id)
        if not isinstance(self.recipe, WattenRecipe):
            raise WattenRoomError("watten_invalid_roster")
        count = self.recipe.player_count
        if (type(self.seats) is not tuple or type(self.accounts) is not tuple
                or len(self.seats) != count or len(self.accounts) != count):
            raise WattenRoomError("watten_invalid_roster")
        for participant in self.seats:
            _participant(participant)
        humans = [_account(account) for account in self.accounts if account is not None]
        cpu_seats = tuple(seat for seat, account in enumerate(self.accounts) if account is None)
        if len(set(self.seats)) != count or len(set(humans)) != len(humans) or cpu_seats != self.recipe.cpu_seats:
            raise WattenRoomError("watten_invalid_roster")
        if type(self.first_dealer) is not int or not 0 <= self.first_dealer < count:
            raise WattenRoomError("watten_invalid_first_dealer")

    @property
    def profile(self) -> PlayProfile:
        return self.recipe.play_profile

    def deal_parties(self, dealer: int) -> DealParties:
        """Parties for one deal: fixed opposite teams of four, the rotating three-player solo, two singles."""
        count = len(self.seats)
        if type(dealer) is not int or not 0 <= dealer < count:
            raise WattenRoomError("watten_invalid_dealer")
        ring = tuple(self.seats[(dealer + offset) % count] for offset in range(count))
        if count == 2:
            parties = ((ring[0],), (ring[1],))
        elif count == 3:
            parties = ((ring[0], ring[2]), (ring[1],))
        else:
            parties = ((self.seats[0], self.seats[2]), (self.seats[1], self.seats[3]))
        return DealParties(self.seats, ring[0], parties)


@dataclass(frozen=True, slots=True)
class Admission:
    room: WattenRoom
    participant_id: str
    rejoined: bool


@dataclass(frozen=True, slots=True)
class RoomStart:
    room: WattenRoom
    roster: StartRoster


@dataclass(frozen=True, slots=True)
class RematchCreated:
    """The marked source, the new waiting room and the server-only verifier.

    The protection verifier travels next to, never inside, the public recipe.
    """

    source: WattenRoom
    room: WattenRoom
    protection_verifier: str | None = field(default=None, repr=False)


def _current(room: object, revision: object) -> WattenRoom:
    if not isinstance(room, WattenRoom):
        raise WattenRoomError("watten_invalid_room")
    if type(revision) is not int or revision != room.revision:
        raise WattenRoomError("watten_stale_revision")
    return room


def _open_waiting(room: WattenRoom, now: object) -> datetime:
    now = _utc(now)
    if room.status != "waiting":
        raise WattenRoomError(f"watten_room_{room.status}")
    if now >= room.wait_expires_at:
        raise WattenRoomError("watten_room_expired")
    return now


def _member(room: WattenRoom, account_id: int) -> Member | None:
    return next((member for member in room.members if member.account_id == account_id), None)


def _required_member(room: WattenRoom, account_id: object) -> Member:
    member = _member(room, _account(account_id))
    if member is None:
        raise WattenRoomError("watten_not_a_member")
    return member


def _require_host(room: WattenRoom, account_id: object) -> None:
    if _required_member(room, account_id).participant_id != room.host_participant_id:
        raise WattenRoomError("watten_host_required")


def _seat(room: WattenRoom, seat: object) -> int:
    if type(seat) is not int or not 0 <= seat < room.recipe.player_count:
        raise WattenRoomError("watten_invalid_seat")
    return seat


def _occupied(room: WattenRoom, seat: int) -> bool:
    return any(member.seat == seat for member in room.members) or any(cpu.seat == seat for cpu in room.cpus)


def _valid_reservation(room: WattenRoom, seat: int, now: datetime) -> SeatReservation | None:
    return next((item for item in room.reservations if item.seat == seat and item.valid_at(now)), None)


def _recipe_with_cpus(recipe: WattenRecipe, cpus: tuple[CpuOccupant, ...]) -> WattenRecipe:
    try:
        return replace(recipe, cpu_seats=tuple(cpu.seat for cpu in cpus))
    except WattenRecipeError as exc:
        raise WattenRoomError(exc.code) from exc


def _next(room: WattenRoom, **changes: object) -> WattenRoom:
    return replace(room, revision=room.revision + 1, **changes)


def create_room(room_id: str, recipe: WattenRecipe, *, host_account: int, now: datetime,
                wait_seconds: int) -> WattenRoom:
    """Admit the creating host as the first, still unseated member; CPUs take the recipe's seats."""
    if not isinstance(recipe, WattenRecipe):
        raise WattenRoomError("watten_invalid_recipe")
    now = _utc(now)
    host = Member("p1", _account(host_account))
    cpus = tuple(CpuOccupant(f"p{number}", seat) for number, seat in enumerate(recipe.cpu_seats, start=2))
    return WattenRoom(room_id, recipe, 0, "waiting", host.participant_id, (host,), cpus, (), 1 + len(cpus),
                      _wait_seconds(wait_seconds), now + timedelta(seconds=wait_seconds))


def admit(room: WattenRoom, *, revision: int, account_id: int, now: datetime,
          protection_verified: bool = False) -> Admission:
    """Admit an account as member, or return its existing participant unchanged.

    Account rejoin comes before every capacity and occupancy check and keeps
    the participant, seat and team; it renews nothing and never starts. A new
    member does not get a seat. Valid reservations of other, not yet admitted
    accounts keep their capacity. ``protection_verified`` is the server's own
    result of checking a protected table's secret.
    """
    room = _current(room, revision)
    _account(account_id)
    now = _utc(now)
    if type(protection_verified) is not bool:
        raise WattenRoomError("watten_invalid_protection_result")
    if room.status == "closed":
        raise WattenRoomError("watten_room_closed")
    if room.status == "waiting" and now >= room.wait_expires_at:
        raise WattenRoomError("watten_room_expired")
    existing = _member(room, account_id)
    if existing is not None:
        return Admission(room, existing.participant_id, True)
    if room.status != "waiting":
        raise WattenRoomError(f"watten_room_{room.status}")
    if room.series is not None and room.series.roster_locked and room.series.seat_for_account(account_id) is None:
        raise WattenRoomError("watten_tournament_roster_locked")
    if room.recipe.password_required and not protection_verified:
        raise WattenRoomError("watten_room_protected")
    held = sum(1 for item in room.reservations
               if item.valid_at(now) and item.account_id != account_id and _member(room, item.account_id) is None)
    if len(room.members) + held >= room.recipe.player_count:
        raise WattenRoomError("watten_room_full")
    participant = f"p{room.participant_counter + 1}"
    admitted = _next(room, members=(*room.members, Member(participant, account_id)),
                     participant_counter=room.participant_counter + 1)
    return Admission(admitted, participant, False)


def take_seat(room: WattenRoom, *, revision: int, account_id: int, seat: int, team: int | None,
              now: datetime) -> WattenRoom:
    """A member deliberately takes one concrete seat, or moves to it.

    Four players must confirm exactly the seat's party; two and three players
    pass no team. A free seat or a named, unreserved CPU seat may be taken;
    other CPUs keep their seats. Only a member's first seat renews the wait.
    """
    room = _current(room, revision)
    member = _required_member(room, account_id)
    now = _open_waiting(room, now)
    seat = _seat(room, seat)
    if room.series is not None and room.series.roster_locked and room.series.seat_for_account(account_id) != seat:
        raise WattenRoomError("watten_tournament_roster_locked")
    expected = seat_team(room.recipe.player_count, seat)
    if expected is None and team is not None:
        raise WattenRoomError("watten_team_not_used")
    if expected is not None and (type(team) is not int or team != expected):
        raise WattenRoomError("watten_team_confirmation_required")
    if member.seat == seat:
        raise WattenRoomError("watten_already_on_seat")
    if any(other.seat == seat for other in room.members):
        raise WattenRoomError("watten_seat_taken")
    reservation = _valid_reservation(room, seat, now)
    if reservation is not None and reservation.account_id != account_id:
        raise WattenRoomError("watten_seat_reserved")
    cpus = tuple(cpu for cpu in room.cpus if cpu.seat != seat)
    members = tuple(replace(other, seat=seat, team=expected) if other.participant_id == member.participant_id
                    else other for other in room.members)
    deadline = room.wait_expires_at
    if member.seat is None:
        deadline = max(deadline, now + timedelta(seconds=room.wait_seconds))
    return _next(room, recipe=_recipe_with_cpus(room.recipe, cpus), members=members, cpus=cpus,
                 reservations=tuple(item for item in room.reservations if item.account_id != account_id),
                 wait_expires_at=deadline)


def place_cpu(room: WattenRoom, *, revision: int, account_id: int, seat: int, now: datetime) -> WattenRoom:
    """Host places a CPU on a named free seat that no valid reservation holds."""
    room = _current(room, revision)
    if room.series is not None and room.series.roster_locked:
        raise WattenRoomError("watten_tournament_roster_locked")
    _require_host(room, account_id)
    now = _open_waiting(room, now)
    seat = _seat(room, seat)
    if _occupied(room, seat):
        raise WattenRoomError("watten_seat_taken")
    if _valid_reservation(room, seat, now) is not None:
        raise WattenRoomError("watten_seat_reserved")
    participant = f"p{room.participant_counter + 1}"
    cpus = tuple(sorted((*room.cpus, CpuOccupant(participant, seat)), key=lambda cpu: cpu.seat))
    return _next(room, recipe=_recipe_with_cpus(room.recipe, cpus), cpus=cpus,
                 reservations=tuple(item for item in room.reservations if item.seat != seat),
                 participant_counter=room.participant_counter + 1)


def remove_cpu(room: WattenRoom, *, revision: int, account_id: int, seat: int, now: datetime) -> WattenRoom:
    """Host frees exactly the named CPU seat; it stays empty."""
    room = _current(room, revision)
    if room.series is not None and room.series.roster_locked:
        raise WattenRoomError("watten_tournament_roster_locked")
    _require_host(room, account_id)
    _open_waiting(room, now)
    seat = _seat(room, seat)
    if not any(cpu.seat == seat for cpu in room.cpus):
        raise WattenRoomError("watten_no_cpu_on_seat")
    cpus = tuple(cpu for cpu in room.cpus if cpu.seat != seat)
    return _next(room, recipe=_recipe_with_cpus(room.recipe, cpus), cpus=cpus)


def decline_reservation(room: WattenRoom, *, revision: int, account_id: int, now: datetime) -> WattenRoom:
    """The reserved account explicitly declines; a later ordinary join stays possible."""
    room = _current(room, revision)
    _account(account_id)
    _open_waiting(room, now)
    if not any(item.account_id == account_id for item in room.reservations):
        raise WattenRoomError("watten_no_reservation")
    return _next(room, reservations=tuple(item for item in room.reservations if item.account_id != account_id))


def leave(room: WattenRoom, *, revision: int, account_id: int, now: datetime,
          eligible_host_accounts: frozenset[int]) -> WattenRoom:
    """A member's deliberate leave from a waiting room frees exactly their seat.

    A network loss is not a leave and must never be routed here. A leaving
    host passes the room to the oldest remaining member whose account is in
    the server's explicit eligible list; without one the room closes. A
    started game keeps its seats and teams.
    """
    room = _current(room, revision)
    member = _required_member(room, account_id)
    _open_waiting(room, now)
    if (type(eligible_host_accounts) is not frozenset
            or not all(type(account) is int for account in eligible_host_accounts)):
        raise WattenRoomError("watten_invalid_host_candidates")
    members = tuple(other for other in room.members if other.participant_id != member.participant_id)
    host, status = room.host_participant_id, room.status
    if host == member.participant_id:
        successor = next((other for other in members if other.account_id in eligible_host_accounts), None)
        host, status = (None, "closed") if successor is None else (successor.participant_id, status)
    return _next(room, members=members, host_participant_id=host, status=status)


def close_expired(room: WattenRoom, *, revision: int, now: datetime) -> WattenRoom:
    """Server closes a waiting room once its explicit wait deadline has passed."""
    room = _current(room, revision)
    now = _utc(now)
    if room.status != "waiting":
        raise WattenRoomError(f"watten_room_{room.status}")
    if now < room.wait_expires_at:
        raise WattenRoomError("watten_room_not_expired")
    return _next(room, status="closed")


def start_roster(room: WattenRoom) -> StartRoster:
    """The immutable roster of a started or finished room, also after a restart."""
    if not isinstance(room, WattenRoom) or room.status not in _PLAYING:
        raise WattenRoomError("watten_room_not_started")
    occupants: dict[int, tuple[str, int | None]] = {cpu.seat: (cpu.participant_id, None) for cpu in room.cpus}
    occupants.update({member.seat: (member.participant_id, member.account_id)
                      for member in room.members if member.seat is not None})
    seats = range(room.recipe.player_count)
    return StartRoster(room.room_id, room.recipe, tuple(occupants[seat][0] for seat in seats),
                       tuple(occupants[seat][1] for seat in seats), room.first_dealer)


def start(room: WattenRoom, *, revision: int, account_id: int, now: datetime, first_dealer: int) -> RoomStart:
    """Only the host starts deliberately, once every seat is occupied.

    ``first_dealer`` is the seat the server drew; this module never draws it.
    Pending reservations end with the start, and seats and teams are fixed.
    """
    room = _current(room, revision)
    _require_host(room, account_id)
    _open_waiting(room, now)
    count = room.recipe.player_count
    if type(first_dealer) is not int or not 0 <= first_dealer < count:
        raise WattenRoomError("watten_invalid_first_dealer")
    if not all(_occupied(room, seat) for seat in range(count)):
        raise WattenRoomError("watten_seats_incomplete")
    room = bind_room_series(room)
    started = _next(room, status="started", first_dealer=first_dealer, reservations=())
    return RoomStart(started, start_roster(started))


def finish(room: WattenRoom, *, revision: int) -> WattenRoom:
    """Server marks the match over or aborted; results live elsewhere and stay unchanged."""
    room = _current(room, revision)
    if room.status != "started":
        raise WattenRoomError(f"watten_room_{room.status}")
    return _next(room, status="finished")


def create_rematch(source: WattenRoom, *, revision: int, account_id: int, target_room_id: str, now: datetime,
                   wait_seconds: int, reservations: Mapping[int, int] | None = None,
                   reservations_expire_at: datetime | None = None,
                   protection_verifier: str | None = None, password_required: bool | None = None) -> RematchCreated:
    """Create exactly one follow-up waiting room from the source's complete recipe.

    The requesting player becomes the unseated host; nobody is moved
    automatically. ``reservations`` maps former player accounts to private
    seat suggestions that still need a deliberate join and seat choice. The
    marked source refuses a second rematch. Results and points stay untouched.
    """
    source = _current(source, revision)
    _account(account_id)
    now = _utc(now)
    if source.status != "finished":
        raise WattenRoomError("watten_rematch_requires_finished_room")
    if source.series is not None and source.series.finished:
        raise WattenRoomError("watten_tournament_finished")
    if source.rematch_room_id is not None:
        raise WattenRoomError("watten_rematch_exists")
    if _room_id(target_room_id) == source.room_id:
        raise WattenRoomError("watten_invalid_rematch_link")
    players = ({account for account in start_roster(source).accounts if account is not None}
               if source.status == "finished" else {member.account_id for member in source.members})
    if source.series is not None and source.series.roster_locked:
        players = {int(token[2:]) for token in source.series.bindings if token.startswith("h:")}
    if account_id not in players:
        raise WattenRoomError("watten_rematch_requires_player")
    if password_required is not None and type(password_required) is not bool:
        raise WattenRoomError("watten_rematch_protection_mismatch")
    if password_required is True or protection_verifier is not None:
        raise WattenRoomError("watten_rematch_password_not_supported")
    recipe = replace(source.recipe, password_required=False)
    if recipe.password_required != (type(protection_verifier) is str and bool(protection_verifier)):
        raise WattenRoomError("watten_rematch_protection_mismatch")
    if protection_verifier is not None and type(protection_verifier) is not str:
        raise WattenRoomError("watten_rematch_protection_mismatch")
    suggestions = {} if reservations is None else reservations
    if not isinstance(suggestions, Mapping):
        raise WattenRoomError("watten_invalid_reservations")
    pairs = sorted(suggestions.items()) if all(type(key) is int for key in suggestions) else None
    if (pairs is None or any(key not in players or type(seat) is not int for key, seat in pairs)
            or len({seat for _, seat in pairs}) != len(pairs)):
        raise WattenRoomError("watten_invalid_reservations")
    expires_at = _utc(reservations_expire_at) if pairs else None
    if (expires_at is not None and expires_at <= now) or (not pairs and reservations_expire_at is not None):
        raise WattenRoomError("watten_invalid_reservations")
    series = source.series if source.series is not None else bind_room_series(source).series
    room = create_room(target_room_id, recipe, host_account=account_id, now=now, wait_seconds=wait_seconds)
    room = replace(room, rematch_of=source.room_id,
                   reservations=tuple(SeatReservation(key, seat, expires_at) for key, seat in pairs),
                   series=replace(series, continuation_locked=True))
    return RematchCreated(_next(source, rematch_room_id=target_room_id), room, protection_verifier)


def room_to_payload(room: WattenRoom) -> dict:
    """Explicit server-internal persistence payload, never a client projection."""
    if not isinstance(room, WattenRoom):
        raise WattenRoomError("watten_invalid_room")
    return {
        "kind": _ROOM_KIND,
        "schema_version": ROOM_SCHEMA_VERSION,
        "room_id": room.room_id,
        "recipe": recipe_to_payload(room.recipe),
        "revision": room.revision,
        "status": room.status,
        "host_participant_id": room.host_participant_id,
        "members": [{"participant_id": member.participant_id, "account_id": member.account_id,
                     "seat": member.seat, "team": member.team} for member in room.members],
        "cpus": [{"participant_id": cpu.participant_id, "seat": cpu.seat} for cpu in room.cpus],
        "reservations": [{"account_id": item.account_id, "seat": item.seat, "expires_at": item.expires_at.isoformat()}
                         for item in room.reservations],
        "participant_counter": room.participant_counter,
        "wait_seconds": room.wait_seconds,
        "wait_expires_at": room.wait_expires_at.isoformat(),
        "first_dealer": room.first_dealer,
        "rematch_of": room.rematch_of,
        "rematch_room_id": room.rematch_room_id,
        "series": series_to_payload(room.series),
    }


def _time(value: object) -> datetime:
    if type(value) is not str:
        raise WattenRoomError("watten_invalid_time")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise WattenRoomError("watten_invalid_time") from exc
    if parsed.utcoffset() != timedelta(0):
        raise WattenRoomError("watten_invalid_time")
    return parsed


def room_from_payload(payload: object) -> WattenRoom:
    if type(payload) is dict and "series" not in payload:
        payload = {**payload, "series": None}
    fields = require_fields(payload, _ROOM_KEYS, WattenRoomError, "watten_room")
    if fields["kind"] != _ROOM_KIND:
        raise WattenRoomError("watten_room_invalid_payload")
    if type(fields["schema_version"]) is not int or fields["schema_version"] != ROOM_SCHEMA_VERSION:
        raise WattenRoomError("watten_unknown_room_version")
    if any(type(fields[key]) is not list for key in ("members", "cpus", "reservations")):
        raise WattenRoomError("watten_room_invalid_payload")
    try:
        recipe = recipe_from_payload(fields["recipe"])
    except WattenRecipeError as exc:
        raise WattenRoomError(exc.code) from exc
    try:
        series = series_from_payload(fields["series"])
    except ValueError as exc:
        raise WattenRoomError("watten_invalid_nockerl_series") from exc
    members = tuple(Member(**require_fields(item, _MEMBER_KEYS, WattenRoomError, "watten_member"))
                    for item in fields["members"])
    cpus = tuple(CpuOccupant(**require_fields(item, _CPU_KEYS, WattenRoomError, "watten_cpu"))
                 for item in fields["cpus"])
    reservations = tuple(
        SeatReservation(item["account_id"], item["seat"], _time(item["expires_at"]))
        for item in (require_fields(raw, _RESERVATION_KEYS, WattenRoomError, "watten_reservation")
                     for raw in fields["reservations"]))
    return WattenRoom(
        room_id=fields["room_id"], recipe=recipe, revision=fields["revision"], status=fields["status"],
        host_participant_id=fields["host_participant_id"], members=members, cpus=cpus, reservations=reservations,
        participant_counter=fields["participant_counter"], wait_seconds=fields["wait_seconds"],
        wait_expires_at=_time(fields["wait_expires_at"]), first_dealer=fields["first_dealer"],
        rematch_of=fields["rematch_of"], rematch_room_id=fields["rematch_room_id"],
        series=series,
    )


def room_to_json(room: WattenRoom) -> str:
    return dumps_canonical_json(room_to_payload(room))


def room_from_json(text: object) -> WattenRoom:
    try:
        payload = loads_strict_json(text)
    except WattenRecipeError as exc:
        raise WattenRoomError(exc.code) from exc
    return room_from_payload(payload)
