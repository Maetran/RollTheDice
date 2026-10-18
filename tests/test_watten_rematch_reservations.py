"""A reservation is an explicit owned choice, independent from seat and team."""

import pytest

from app.game_state import games
from app.watten_runtime import restore_watten_json
from tests import test_watten_runtime as native
from tests.test_watten_rematch import checkpoints, command, post, source_for
from tests.test_watten_social import attach, call, last

server = native.server


def test_decline_lost_ack_restart_and_later_join_do_not_restore_or_move_a_seat(server):
    match, owners = source_for()
    target_id = post(server, match.game, owners[0], command(match.game)).json()["game_id"]
    target = games[target_id]
    sender = attach(target, owners[:1])[0]
    data = native.room_command(target_id, "watten_decline_reservation", 1)
    guest_reservation = next(item for item in target["_watten"].room.reservations if item.account_id == owners[1][0].user_id)
    call(sender, data)
    assert last(sender, "watten_command")["command_id"] == data["command_id"]
    after = checkpoints()
    assert target["_watten"].room.reservations == (guest_reservation,)
    assert target["_watten"].room.members[0].seat is None and not target["_started"]
    call(sender, data)
    assert checkpoints() == after
    restored = restore_watten_json(after[target_id])
    assert restored["_watten"].room.reservations == (guest_reservation,)
    games[target_id] = restored
    sender = attach(restored, owners[:1])[0]
    call(sender, data)
    assert last(sender, "watten_command")["command_id"] == data["command_id"] and checkpoints() == after
    # Rejoin does not recreate an already declined reservation.
    call(sender, {"action": "rejoin_game", "revision": restored["_watten"].room.revision,
                  "expected_account_id": owners[0][0].user_id})
    assert restored["_watten"].room.reservations == (guest_reservation,)


def test_decline_never_accepts_another_account_or_stale_room_instruction(server):
    match, owners = source_for()
    target_id = post(server, match.game, owners[0], command(match.game)).json()["game_id"]
    target = games[target_id]
    sender = attach(target, owners[:1])[0]
    before = checkpoints()
    data = native.room_command(target_id, "watten_decline_reservation", 2)
    with pytest.raises(ValueError):
        call(sender, {**data, "account_id": owners[1][0].user_id})
    with pytest.raises(ValueError, match="stale_room"):
        call(sender, {**data, "revision": data["revision"] + 1})
    assert checkpoints() == before
