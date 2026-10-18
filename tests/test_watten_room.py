"""Pure Watten waiting rooms: members, chosen seats/teams, CPUs, start, rematch and JSON."""

import json
import random
from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta, timezone
from itertools import permutations

import pytest

from app.watten_cards import deal_cards, make_deck
from app.watten_play import start_play
from app.watten_recipe import WattenRecipe
from app.watten_room import (
    Member,
    WattenRoomError,
    admit,
    close_expired,
    create_rematch,
    create_room,
    decline_reservation,
    finish,
    leave,
    place_cpu,
    remove_cpu,
    room_from_json,
    room_from_payload,
    room_to_json,
    room_to_payload,
    seat_team,
    start,
    start_roster,
    take_seat,
)
from app.watten_rules import WattenCall

NOW = datetime(2026, 10, 18, 17, 0, tzinfo=timezone.utc)
WAIT = 600
HOST = 100
ACCOUNTS = (HOST, 201, 202, 203)
AUTO = object()


def later(seconds):
    return NOW + timedelta(seconds=seconds)


def recipe(count=4, *, cpu_seats=(), password=False, **options):
    determination, blind = ("ladinisch", True) if count == 4 else ("normal", False)
    return WattenRecipe(count, determination, blind, False, cpu_seats=cpu_seats, password_required=password, **options)


def new_room(count=4, **kwargs):
    return create_room("room-1", recipe(count, **kwargs), host_account=HOST, now=NOW, wait_seconds=WAIT)


def join(room, account, now=NOW, **kwargs):
    return admit(room, revision=room.revision, account_id=account, now=now, **kwargs).room


def sit(room, account, seat, now=NOW, team=AUTO):
    team = seat_team(room.recipe.player_count, seat) if team is AUTO else team
    return take_seat(room, revision=room.revision, account_id=account, seat=seat, team=team, now=now)


def code_of(action, *args, **kwargs):
    with pytest.raises(WattenRoomError) as caught:
        action(*args, **kwargs)
    return caught.value.code


def seated(count=4, *, cpu_seats=(), password=False, **options):
    room = new_room(count, cpu_seats=cpu_seats, password=password, **options)
    humans = [seat for seat in range(count) if seat not in cpu_seats]
    for account, seat in zip(ACCOUNTS, humans):
        if account != HOST:
            room = join(room, account, protection_verified=password)
        room = sit(room, account, seat)
    return room


def started(count=4, dealer=0, **kwargs):
    room = seated(count, **kwargs)
    return start(room, revision=room.revision, account_id=HOST, now=NOW, first_dealer=dealer).room


def finished(count=4, **kwargs):
    room = started(count, **kwargs)
    return finish(room, revision=room.revision)


def test_creation_admits_only_the_unseated_host_and_places_concrete_recipe_cpus():
    room = new_room(4, cpu_seats=(3, 1))
    assert room.status == "waiting" and room.revision == 0 and room.host_participant_id == "p1"
    assert room.members == (Member("p1", HOST),)
    assert [(cpu.participant_id, cpu.seat) for cpu in room.cpus] == [("p2", 1), ("p3", 3)]
    assert room.participant_counter == 3 and room.wait_expires_at == later(WAIT)
    for wait in (0, -5, True, 1.5, "600"):
        assert code_of(create_room, "room-1", recipe(), host_account=HOST, now=NOW,
                       wait_seconds=wait) == "watten_invalid_wait_seconds"
    for account in (0, True, "100"):
        assert code_of(create_room, "room-1", recipe(), host_account=account, now=NOW,
                       wait_seconds=WAIT) == "watten_invalid_account"
    assert code_of(create_room, "room-1", recipe(), host_account=HOST, now=NOW.replace(tzinfo=None),
                   wait_seconds=WAIT) == "watten_invalid_time"
    for room_id in ("", " room", "x" * 129, 7):
        assert code_of(create_room, room_id, recipe(), host_account=HOST, now=NOW,
                       wait_seconds=WAIT) == "watten_invalid_room_id"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_every_join_and_seating_order_yields_the_chosen_seats_and_teams(count):
    accounts = ACCOUNTS[:count]
    seat_of = {account: (index - 1) % count for index, account in enumerate(accounts)}  # host takes the last seat
    rosters = set()
    for join_order in permutations(accounts[1:]):
        for seating_order in permutations(accounts):
            room = new_room(count)
            for account in join_order:
                room = join(room, account)
            for account in seating_order:
                room = sit(room, account, seat_of[account])
                assert room.status == "waiting"
            if count == 4:
                assert all(member.team == member.seat % 2 for member in room.members)
            else:
                assert all(member.team is None for member in room.members)
            roster = start(room, revision=room.revision, account_id=HOST, now=NOW, first_dealer=0).roster
            rosters.add(roster.accounts)
    assert rosters == {tuple(account for seat in range(count) for account in accounts if seat_of[account] == seat)}


def test_four_player_seats_need_the_explicit_matching_team():
    room = join(new_room(4), 201)
    for team in (None, 0, True, "1"):
        assert code_of(sit, room, 201, 1, team=team) == "watten_team_confirmation_required"
    assert sit(room, 201, 1, team=1).members[1].team == 1
    for count in (2, 3):
        small = join(new_room(count), 201)
        assert code_of(sit, small, 201, 1, team=0) == "watten_team_not_used"
        assert sit(small, 201, 1, team=None).members[1].team is None


def test_seat_choice_conflicts_moves_and_wait_renewal():
    room = join(join(new_room(4), 201), 202, now=later(60))
    assert room.wait_expires_at == later(WAIT)  # admission alone renews nothing
    room = sit(room, 201, 1, now=later(100))
    assert room.wait_expires_at == later(100 + WAIT)
    assert code_of(sit, room, 202, 1) == "watten_seat_taken"
    assert code_of(sit, room, 201, 1) == "watten_already_on_seat"
    assert code_of(sit, room, 999, 2) == "watten_not_a_member"
    for seat in (4, -1, True, "2"):
        assert code_of(sit, room, 202, seat, team=0) == "watten_invalid_seat"
    moved = sit(room, 201, 3, now=later(200))
    assert moved.wait_expires_at == later(100 + WAIT)  # moving is no new human seat
    assert [member.seat for member in moved.members] == [None, 3, None]
    assert sit(moved, 202, 1, now=later(200)).members[2].seat == 1


def test_account_rejoin_precedes_capacity_and_changes_nothing():
    full = seated(4)
    assert code_of(admit, full, revision=full.revision, account_id=999, now=NOW) == "watten_room_full"
    for member in full.members:
        admission = admit(full, revision=full.revision, account_id=member.account_id, now=later(500))
        assert admission.rejoined and admission.room is full and admission.participant_id == member.participant_id
    assert full.wait_expires_at == later(WAIT)
    assert code_of(admit, full, revision=full.revision, account_id=201, now=later(WAIT)) == "watten_room_expired"
    for room, status in ((started(4), "started"), (finished(4), "finished")):
        admission = admit(room, revision=room.revision, account_id=203, now=later(10_000))
        assert admission.rejoined and admission.room is room
        assert code_of(admit, room, revision=room.revision, account_id=999, now=NOW) == f"watten_room_{status}"
    closed = leave(new_room(4), revision=0, account_id=HOST, now=NOW, eligible_host_accounts=frozenset())
    assert code_of(admit, closed, revision=closed.revision, account_id=HOST, now=NOW) == "watten_room_closed"


def test_protected_tables_admit_new_accounts_only_after_server_verification():
    room = new_room(4, password=True)
    assert code_of(admit, room, revision=0, account_id=201, now=NOW) == "watten_room_protected"
    assert code_of(admit, room, revision=0, account_id=201, now=NOW,
                   protection_verified="yes") == "watten_invalid_protection_result"
    room = join(room, 201, protection_verified=True)
    assert admit(room, revision=room.revision, account_id=201, now=NOW).rejoined


def test_every_transition_rejects_stale_revisions_without_change():
    room = sit(join(new_room(4, cpu_seats=(2,)), 201), 201, 1)
    snapshot = room_to_json(room)
    calls = (
        lambda revision: admit(room, revision=revision, account_id=202, now=NOW),
        lambda revision: take_seat(room, revision=revision, account_id=HOST, seat=0, team=0, now=NOW),
        lambda revision: place_cpu(room, revision=revision, account_id=HOST, seat=3, now=NOW),
        lambda revision: remove_cpu(room, revision=revision, account_id=HOST, seat=2, now=NOW),
        lambda revision: decline_reservation(room, revision=revision, account_id=201, now=NOW),
        lambda revision: leave(room, revision=revision, account_id=201, now=NOW, eligible_host_accounts=frozenset()),
        lambda revision: close_expired(room, revision=revision, now=later(WAIT * 2)),
        lambda revision: start(room, revision=revision, account_id=HOST, now=NOW, first_dealer=0),
        lambda revision: finish(room, revision=revision),
        lambda revision: create_rematch(room, revision=revision, account_id=HOST, target_room_id="room-2",
                                        now=NOW, wait_seconds=WAIT),
    )
    for call in calls:
        for stale in (room.revision - 1, room.revision + 1, str(room.revision), True):
            assert code_of(call, stale) == "watten_stale_revision"
    assert room_to_json(room) == snapshot


def test_cpu_management_is_host_only_and_humans_claim_one_named_cpu_seat():
    room = join(new_room(4, cpu_seats=(1, 2, 3)), 201)
    assert code_of(place_cpu, room, revision=room.revision, account_id=201, seat=0, now=NOW) == "watten_host_required"
    assert code_of(remove_cpu, room, revision=room.revision, account_id=999, seat=1, now=NOW) == "watten_not_a_member"
    room = remove_cpu(room, revision=room.revision, account_id=HOST, seat=2, now=later(30))
    assert [(cpu.participant_id, cpu.seat) for cpu in room.cpus] == [("p2", 1), ("p4", 3)]
    assert room.recipe.cpu_seats == (1, 3) and room.wait_expires_at == later(WAIT) and room.status == "waiting"
    room = place_cpu(room, revision=room.revision, account_id=HOST, seat=2, now=later(30))
    assert [(cpu.participant_id, cpu.seat) for cpu in room.cpus] == [("p2", 1), ("p6", 2), ("p4", 3)]
    room = sit(room, 201, 3)
    assert [(cpu.participant_id, cpu.seat) for cpu in room.cpus] == [("p2", 1), ("p6", 2)]
    assert room.recipe.cpu_seats == (1, 2) and room.members[1].seat == 3
    assert code_of(place_cpu, room, revision=room.revision, account_id=HOST, seat=3, now=NOW) == "watten_seat_taken"
    assert code_of(remove_cpu, room, revision=room.revision, account_id=HOST, seat=0, now=NOW) == (
        "watten_no_cpu_on_seat")
    assert code_of(place_cpu, room, revision=room.revision, account_id=HOST, seat=4, now=NOW) == "watten_invalid_seat"
    lonely = new_room(2, cpu_seats=(1,))
    assert code_of(place_cpu, lonely, revision=0, account_id=HOST, seat=0, now=NOW) == "watten_cpu_seats_need_a_human"


def test_host_leave_passes_to_the_oldest_eligible_member_or_closes():
    room = sit(join(join(join(new_room(4), 201), 202), 203), 202, 2)
    room = leave(room, revision=room.revision, account_id=HOST, now=NOW, eligible_host_accounts=frozenset({202, 203}))
    assert room.host_participant_id == "p3" and [member.account_id for member in room.members] == [201, 202, 203]
    room = leave(room, revision=room.revision, account_id=201, now=NOW, eligible_host_accounts=frozenset())
    assert room.host_participant_id == "p3" and room.status == "waiting"
    room = leave(room, revision=room.revision, account_id=202, now=NOW, eligible_host_accounts=frozenset({999}))
    assert room.status == "closed" and room.host_participant_id is None
    assert [member.account_id for member in room.members] == [203] and room.cpus == ()
    waiting = seated(4)
    freed = leave(waiting, revision=waiting.revision, account_id=203, now=NOW, eligible_host_accounts=frozenset())
    assert all(member.seat != 3 for member in freed.members) and freed.cpus == ()
    for candidates in ({202}, frozenset({"202"})):
        assert code_of(leave, waiting, revision=waiting.revision, account_id=203, now=NOW,
                       eligible_host_accounts=candidates) == "watten_invalid_host_candidates"
    assert code_of(leave, waiting, revision=waiting.revision, account_id=999, now=NOW,
                   eligible_host_accounts=frozenset()) == "watten_not_a_member"
    running = started(4)
    assert code_of(leave, running, revision=running.revision, account_id=203, now=NOW,
                   eligible_host_accounts=frozenset()) == "watten_room_started"


def test_wait_deadline_closes_only_when_due_and_blocks_late_actions():
    room = join(new_room(4), 201, now=later(500))
    room = place_cpu(room, revision=room.revision, account_id=HOST, seat=3, now=later(500))
    assert room.wait_expires_at == later(WAIT)
    assert code_of(close_expired, room, revision=room.revision, now=later(WAIT - 1)) == "watten_room_not_expired"
    for action in (lambda: sit(room, 201, 1, now=later(WAIT)),
                   lambda: join(room, 202, now=later(WAIT)),
                   lambda: start(room, revision=room.revision, account_id=HOST, now=later(WAIT), first_dealer=0)):
        assert code_of(action) == "watten_room_expired"
    closed = close_expired(room, revision=room.revision, now=later(WAIT))
    assert closed.status == "closed" and closed.revision == room.revision + 1
    assert code_of(close_expired, closed, revision=closed.revision, now=later(WAIT)) == "watten_room_closed"


def test_only_the_host_starts_a_completely_occupied_table():
    room = sit(join(new_room(4, cpu_seats=(3,)), 201), 201, 1)
    assert code_of(start, room, revision=room.revision, account_id=HOST, now=NOW,
                   first_dealer=0) == "watten_seats_incomplete"
    room = sit(join(room, 202), 202, 2)
    room = sit(room, HOST, 0)
    assert room.status == "waiting"
    assert code_of(start, room, revision=room.revision, account_id=201, now=NOW,
                   first_dealer=0) == "watten_host_required"
    for dealer in (True, -1, 4, "0", None):
        assert code_of(start, room, revision=room.revision, account_id=HOST, now=NOW,
                       first_dealer=dealer) == "watten_invalid_first_dealer"
    result = start(room, revision=room.revision, account_id=HOST, now=NOW, first_dealer=2)
    assert result.room.status == "started" and result.room.revision == room.revision + 1
    assert result.roster == start_roster(result.room)
    assert result.roster.accounts == (HOST, 201, 202, None) and result.roster.first_dealer == 2
    running = result.room
    for action in (lambda: sit(running, 201, 1),
                   lambda: place_cpu(running, revision=running.revision, account_id=HOST, seat=3, now=NOW),
                   lambda: start(running, revision=running.revision, account_id=HOST, now=NOW, first_dealer=0)):
        assert code_of(action) == "watten_room_started"
    assert code_of(start_roster, room) == "watten_room_not_started"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_start_roster_drives_the_existing_card_engine_for_every_dealer(count):
    roster = start_roster(started(count, cpu_seats=(count - 1,)))
    assert roster.accounts[count - 1] is None and roster.profile == roster.recipe.play_profile
    for dealer in range(count):
        parties = roster.deal_parties(dealer)
        assert parties.seats == roster.seats and parties.dealer_id == roster.seats[dealer]
        if count == 4:
            assert {frozenset(party) for party in parties.parties} == {
                frozenset(roster.seats[0::2]), frozenset(roster.seats[1::2])}
        elif count == 3:
            assert (roster.seats[(dealer + 1) % 3],) in parties.parties
        deck = list(make_deck())
        random.Random(dealer).shuffle(deck)
        deal = deal_cards(deck, player_count=count, recipient_order=[seat for seat in range(count) for _ in range(5)])
        call = None if count == 4 else WattenCall("A", "hearts")
        state = start_play(f"deal-{dealer}", deal, parties, roster.profile, call=call)
        assert state.current_player_id == roster.seats[(dealer + 1) % count]
    for dealer in (count, -1, True):
        assert code_of(roster.deal_parties, dealer) == "watten_invalid_dealer"


def test_rematch_creates_one_follow_up_from_the_complete_recipe_without_moving_people():
    source = finished(4, cpu_seats=(3,), password=True, show_rechter=True, trick_history=True)
    created = create_rematch(source, revision=source.revision, account_id=201, target_room_id="room-2", now=NOW,
                             wait_seconds=WAIT, protection_verifier="argon2-verifier")
    room = created.room
    assert room.recipe == source.recipe and room.recipe.password_required
    assert room.rematch_of == "room-1" and room.status == "waiting" and room.revision == 0
    assert room.members == (Member("p1", 201),) and [cpu.seat for cpu in room.cpus] == [3]
    assert created.protection_verifier == "argon2-verifier" and "argon2" not in repr(created)
    marked = created.source
    assert marked.rematch_room_id == "room-2" and marked.revision == source.revision + 1
    assert marked.members == source.members and start_roster(marked) == start_roster(source)
    assert code_of(create_rematch, marked, revision=marked.revision, account_id=HOST, target_room_id="room-3",
                   now=NOW, wait_seconds=WAIT, protection_verifier="argon2-verifier") == "watten_rematch_exists"
    for verifier in (None, "", 5):
        assert code_of(create_rematch, source, revision=source.revision, account_id=201, target_room_id="room-2",
                       now=NOW, wait_seconds=WAIT,
                       protection_verifier=verifier) == "watten_rematch_protection_mismatch"
    open_source = finished(4)
    for verifier in ("argon2-verifier", 5):
        assert code_of(create_rematch, open_source, revision=open_source.revision, account_id=HOST,
                       target_room_id="room-2", now=NOW, wait_seconds=WAIT,
                       protection_verifier=verifier) == "watten_rematch_protection_mismatch"
    running = started(4)
    for room_state, account, target, code in (
            (open_source, 999, "room-2", "watten_rematch_requires_player"),
            (open_source, HOST, "room-1", "watten_invalid_rematch_link"),
            (running, HOST, "room-2", "watten_rematch_requires_finished_room")):
        assert code_of(create_rematch, room_state, revision=room_state.revision, account_id=account,
                       target_room_id=target, now=NOW, wait_seconds=WAIT) == code


@pytest.mark.parametrize("reservations, expires, code", (
    ({999: 1}, later(300), "watten_invalid_reservations"),
    ({201: 3}, later(300), "watten_invalid_reservations"),
    ({201: 1, 202: 1}, later(300), "watten_invalid_reservations"),
    ({True: 1}, later(300), "watten_invalid_reservations"),
    ({201: 4}, later(300), "watten_invalid_reservations"),
    ({201: "1"}, later(300), "watten_invalid_reservations"),
    ({201: 1}, NOW, "watten_invalid_reservations"),
    ({}, later(300), "watten_invalid_reservations"),
    ({201: 1}, None, "watten_invalid_time"),
    ([(201, 1)], later(300), "watten_invalid_reservations"),
))
def test_rematch_seat_suggestions_must_name_former_players_and_human_seats(reservations, expires, code):
    source = finished(4, cpu_seats=(3,))
    assert code_of(create_rematch, source, revision=source.revision, account_id=HOST, target_room_id="room-2",
                   now=NOW, wait_seconds=WAIT, reservations=reservations,
                   reservations_expire_at=expires) == code


def test_valid_private_reservations_hold_capacity_and_seats_until_accepted_declined_or_expired():
    source = finished(4)
    room = create_rematch(source, revision=source.revision, account_id=HOST, target_room_id="room-2", now=NOW,
                          wait_seconds=WAIT, reservations={201: 1, 202: 2}, reservations_expire_at=later(300)).room
    assert [(item.account_id, item.seat) for item in room.reservations] == [(201, 1), (202, 2)]
    room = join(room, 300)
    assert code_of(admit, room, revision=room.revision, account_id=301, now=NOW) == "watten_room_full"
    room = join(room, 201)
    assert code_of(sit, room, 300, 1) == "watten_seat_reserved"
    assert code_of(place_cpu, room, revision=room.revision, account_id=HOST, seat=2, now=NOW) == (
        "watten_seat_reserved")
    room = sit(room, 201, 1)
    assert [(item.account_id, item.seat) for item in room.reservations] == [(202, 2)]
    declined = decline_reservation(room, revision=room.revision, account_id=202, now=NOW)
    assert declined.reservations == () and join(declined, 301).members[-1].account_id == 301
    assert code_of(decline_reservation, declined, revision=declined.revision, account_id=202, now=NOW) == (
        "watten_no_reservation")
    expired = sit(room, 300, 2, now=later(300))
    assert expired.members[1].seat == 2 and join(expired, 301, now=later(300)).members[-1].account_id == 301
    cpu = place_cpu(room, revision=room.revision, account_id=HOST, seat=2, now=later(300))
    assert cpu.reservations == () and cpu.recipe.cpu_seats == (2,)


def test_rooms_are_frozen():
    room = new_room(4)
    with pytest.raises(FrozenInstanceError):
        room.status = "started"


@pytest.mark.parametrize("count", (2, 3, 4))
def test_constructor_rejects_more_human_members_than_player_count(count):
    room = new_room(count)
    members = tuple(Member(f"p{index + 1}", HOST + index) for index in range(count + 1))
    assert code_of(replace, room, members=members, participant_counter=count + 1) == "watten_room_full"


@pytest.mark.parametrize("count", (2, 3, 4))
@pytest.mark.parametrize("format", ("payload", "json"))
def test_restore_rejects_excess_distinct_unseated_human_members(count, format):
    payload = room_to_payload(new_room(count))
    payload["members"] = [{"participant_id": f"p{index + 1}", "account_id": HOST + index,
                           "seat": None, "team": None} for index in range(count + 1)]
    payload["participant_counter"] = count + 1
    restore, value = (room_from_payload, payload) if format == "payload" else (room_from_json, json.dumps(payload))
    assert code_of(restore, value) == "watten_room_full"


def _rematch_room():
    source = finished(4, cpu_seats=(3,))
    return create_rematch(source, revision=source.revision, account_id=HOST, target_room_id="room-2", now=NOW,
                          wait_seconds=WAIT, reservations={201: 1}, reservations_expire_at=later(300))


def stages():
    created = _rematch_room()
    closed = leave(new_room(3), revision=0, account_id=HOST, now=NOW, eligible_host_accounts=frozenset())
    return (new_room(4, cpu_seats=(1, 3)), sit(join(new_room(2), 201), 201, 0), created.room, started(3),
            created.source, closed, close_expired(new_room(2), revision=0, now=later(WAIT)))


def test_json_roundtrips_are_exact_and_canonical_for_every_stage():
    for room in stages():
        text = room_to_json(room)
        assert room_from_json(text) == room and room_from_payload(room_to_payload(room)) == room
        assert room_to_json(room_from_json(text)) == text and json.loads(text) == room_to_payload(room)


def broken(room, change):
    data = json.loads(room_to_json(room))
    change(data)
    return data


@pytest.mark.parametrize("room_factory, change, code", (
    (lambda: new_room(4), lambda data: data.update(extra=1), "watten_room_unknown_field"),
    (lambda: new_room(4), lambda data: data.pop("rematch_of"), "watten_room_missing_field"),
    (lambda: new_room(4), lambda data: data.update(kind="watten_recipe"), "watten_room_invalid_payload"),
    (lambda: new_room(4), lambda data: data.update(schema_version=2), "watten_unknown_room_version"),
    (lambda: new_room(4), lambda data: data.update(schema_version=True), "watten_unknown_room_version"),
    (lambda: new_room(4), lambda data: data.update(revision=True), "watten_invalid_room"),
    (lambda: new_room(4), lambda data: data.update(revision=-1), "watten_invalid_room"),
    (lambda: new_room(4), lambda data: data.update(status="paused"), "watten_invalid_room"),
    (lambda: new_room(4), lambda data: data.update(members={}), "watten_room_invalid_payload"),
    (lambda: new_room(4), lambda data: data["members"][0].update(socket="x"), "watten_member_unknown_field"),
    (lambda: new_room(4), lambda data: data["members"][0].update(account_id=True), "watten_invalid_account"),
    (lambda: new_room(4), lambda data: data.update(host_participant_id=["p1"]), "watten_invalid_participant"),
    (lambda: new_room(4), lambda data: data.update(host_participant_id="p2"), "watten_host_required"),
    (lambda: new_room(4), lambda data: data.update(host_participant_id=None), "watten_host_required"),
    (lambda: new_room(4, cpu_seats=(1, 3)), lambda data: data.update(participant_counter=1),
     "watten_invalid_participants"),
    (lambda: new_room(4, cpu_seats=(1, 3)), lambda data: data["recipe"].update(cpu_seats=[1]),
     "watten_cpu_recipe_mismatch"),
    (lambda: new_room(4, cpu_seats=(1, 3)), lambda data: data["members"][0].update(seat=1, team=1),
     "watten_invalid_seats"),
    (lambda: new_room(4), lambda data: data["recipe"].update(password="secret"), "watten_recipe_unknown_field"),
    (lambda: new_room(4), lambda data: data.update(first_dealer=0), "watten_invalid_started_room"),
    (lambda: new_room(4), lambda data: data.update(rematch_room_id="room-9"), "watten_invalid_rematch_link"),
    (lambda: new_room(4), lambda data: data.update(rematch_of="room-1"), "watten_invalid_rematch_link"),
    (lambda: new_room(4), lambda data: data.update(wait_expires_at="2026-10-18T17:10:00"), "watten_invalid_time"),
    (lambda: new_room(4), lambda data: data.update(wait_expires_at="2026-10-18T19:10:00+02:00"),
     "watten_invalid_time"),
    (lambda: new_room(4), lambda data: data.update(wait_seconds=0), "watten_invalid_wait_seconds"),
    (lambda: seated(4), lambda data: data["members"][1].update(team=0), "watten_invalid_team"),
    (lambda: seated(4), lambda data: data["members"][1].update(account_id=HOST), "watten_duplicate_account"),
    (lambda: started(4), lambda data: data["members"].pop(), "watten_invalid_started_room"),
    (lambda: _rematch_room().room, lambda data: data["reservations"][0].update(seat=3),
     "watten_invalid_reservations"),
    (lambda: _rematch_room().room, lambda data: data["reservations"][0].update(note="x"),
     "watten_reservation_unknown_field"),
))
def test_defective_payloads_and_relations_are_rejected(room_factory, change, code):
    assert code_of(room_from_payload, broken(room_factory(), change)) == code


def test_strict_room_json_rejects_duplicate_keys_and_constants():
    text = room_to_json(new_room(4))
    assert text.startswith('{"cpus":[],')
    for bad in (text.replace('{"cpus":[],', '{"cpus":[],"cpus":[],', 1),
                text.replace('"revision":0', '"revision":NaN'), text[:-1], None):
        assert code_of(room_from_json, bad) == "watten_invalid_json"
