"""Private picker discovery and totals use current native human socket bindings."""

from dataclasses import replace

import pytest
from sqlalchemy import delete

from app.database import session_scope
from app.game_state import games
from app.models import Session as LoginSession
from app.ownership import bind_founder, grant_ownership
from app.watten_runtime import admit_account, apply_runtime_action, persist_watten_game, serialize_watten_game
from tests import test_watten_runtime as native
from tests.test_user_accounts import request_for

server = native.server
APEX = "https://zockdiewandan.online"


def live_table(server):
    owners = [native.account(name, role="admin" if index < 2 else "user")
              for index, name in enumerate(("PickerFounder", "PickerOwner", "PickerVisitor", "PickerOutsider"))]
    game_id = native.create_game(server, owners[0], count=4, cpus=(2, 3))
    game = games[game_id]
    for index, owner in enumerate(owners[:3]):
        candidate, player = admit_account(game, owner[0], game["_watten"].room.revision, None)
        socket = native.CapturingSocket(owner)
        next(record for record in candidate["_players"] if record["id"] == player)["ws"] = socket
        if index < 2:
            candidate, *_ = apply_runtime_action(candidate, owner[0].user_id, player,
                {"action": "watten_take_seat", "command_id": f"picker-seat-{index}", "revision": candidate["_watten"].room.revision,
                 "lifecycle_revision": 0, "seat": index, "team": index})
        game.update(candidate)
    candidate, *_ = apply_runtime_action(game, owners[0][0].user_id, "p1",
        {"action": "watten_start", "command_id": "picker-manual-start", "revision": game["_watten"].room.revision,
         "lifecycle_revision": 0})
    persist_watten_game(candidate)
    game.update(candidate)
    return game, owners


def get(server, owner=None, origin=native.LOCAL, **headers):
    return server.get(origin + "/api/game-activity", headers={**({"Cookie": owner[1]} if owner else {}), **headers})


def test_local_authenticated_picker_counts_only_seated_fresh_humans_deduplicated_without_private_data(server):
    game, owners = live_table(server)
    before = serialize_watten_game(game)
    assert "watten" not in get(server).json()["games"]
    assert get(server, owners[2]).json()["games"]["watten"] == {"players": 2}
    # Duplicate transports, a CPU-labelled record, an unseated visitor and
    # spectator sockets cannot add another human account to this projection.
    game["_players"].append(dict(game["_players"][0]))
    game["_players"].append({"id": game["_watten"].room.cpus[0].participant_id, "user_id": owners[3][0].user_id,
                             "ws": native.CapturingSocket(owners[3])})
    game["_spectators"].append({"id": "spectator", "user_id": owners[3][0].user_id, "ws": native.CapturingSocket(owners[3])})
    response = get(server, owners[2])
    assert response.json()["games"]["watten"] == {"players": 2}
    assert set(response.json()["games"]["watten"]) == {"players"}
    assert all(value not in response.text for value in (game["_id"], "PickerFounder", "account_id", "user_id", "hand", "seat"))
    assert response.headers["cache-control"] == "no-store" and "cookie" in response.headers["vary"].lower()
    assert serialize_watten_game(game) == before


def test_revoked_or_rebound_native_socket_cannot_continue_contributing_to_playing_totals(server):
    game, owners = live_table(server)
    assert get(server, owners[2]).json()["games"]["watten"]["players"] == 2
    seated = game["_players"][1]
    seated["ws"] = native.CapturingSocket(owners[3])
    assert get(server, owners[2]).json()["games"]["watten"]["players"] == 1
    seated["ws"] = native.CapturingSocket(owners[1])
    with session_scope() as db:
        db.execute(delete(LoginSession).where(LoginSession.user_id == owners[1][0].user_id))
    assert get(server, owners[2]).json()["games"]["watten"]["players"] == 1
    game["_players"][0]["user_id"] = True
    assert get(server, owners[2]).json()["games"]["watten"]["players"] == 0


@pytest.mark.parametrize("origin", (APEX, "https://zilch.zockdiewandan.online", "https://hausdepp.zockdiewandan.online"))
def test_production_watten_key_is_exclusively_fresh_founder_discovery_on_the_existing_suite_hosts(server, monkeypatch, origin):
    game, owners = live_table(server)
    admin = native.account("PickerOrdinaryAdmin", role="admin")
    with session_scope() as db:
        bind_founder(db, owners[0][0].user_id)
        grant_ownership(db, owners[1][0].user_id, owners[0][0].user_id)
    # Real durable identities, including sessions issued before founder binding.
    monkeypatch.setenv("ROLLTHEDICE_SITE_ORIGIN", APEX)
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")
    for record, owner in zip(game["_players"], owners, strict=False):
        record["ws"].request = request_for(host="zockdiewandan.online", origin=APEX, cookie=owner[1])
    response = get(server, owners[0], origin)
    assert response.status_code == 200 and response.json()["games"]["watten"] == {"players": 1}
    for other in (None, owners[1], owners[2], owners[3], admin):
        response = get(server, other, origin)
        assert response.status_code == 200 and "watten" not in response.json()["games"]
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "0")
    assert "watten" not in get(server, owners[0], origin).json()["games"]
    monkeypatch.setenv("ROLLTHEDICE_WATTEN_FOUNDER_PREVIEW", "1")
    with session_scope() as db:
        db.execute(delete(LoginSession).where(LoginSession.user_id == owners[0][0].user_id))
    assert "watten" not in get(server, owners[0], origin).json()["games"]


def test_waiting_terminal_and_unknown_runtime_are_not_invented_as_active_watten_players(server):
    game, owners = live_table(server)
    for field, value in (("_finished", True), ("_aborted", True), ("_started", False), ("_watten", None)):
        original = game[field]
        game[field] = value
        assert get(server, owners[2]).json()["games"]["watten"] == {"players": 0}
        game[field] = original
    game["_watten"] = replace(game["_watten"], absent=(game["_watten"].room.members[0].participant_id,), lifecycle_revision=1)
    # A network pause alone does not invent or remove a currently connected
    # human: the shared picker measures live participants, not whose turn it is.
    assert get(server, owners[2]).json()["games"]["watten"] == {"players": 2}
