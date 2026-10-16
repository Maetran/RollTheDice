"""Audience-scoped, anonymous live totals for the shared game picker."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response

from .auth import AuthIdentity, resolve_session
from .game_access import can_access_zilch_preview
from .game_state import games
from .game_types import game_type_from_state

router = APIRouter(prefix="/api")


def game_activity(identity: AuthIdentity | None) -> dict:
    """Count connected human players once per product, without exposing seats.

    A registered account can have several open tables or devices. Guests have
    only their durable room/seat identity; spectator sockets and CPU-only
    participants never enter this projection. Reading does not mutate rooms.
    """
    allowed = ["zdwa", "hausdepp"]
    if can_access_zilch_preview(identity):
        allowed.append("zilch")
    playing: dict[str, set[tuple]] = {product: set() for product in allowed}
    for room_id, room in list(games.items()):
        if not room.get("_started") or room.get("_finished") or room.get("_aborted"):
            continue
        try:
            product = game_type_from_state(room)
        except ValueError:
            continue
        if product not in playing:
            continue
        cpu_ids = {str(person.get("connection_player_id") or person.get("id"))
                   for person in room.get("_participants", [])
                   if person.get("is_cpu") or person.get("type") == "cpu"}
        for person in room.get("_players", []):
            if (person.get("ws") is None or person.get("is_cpu") or person.get("type") == "cpu"
                    or str(person.get("id")) in cpu_ids):
                continue
            account_id = person.get("user_id")
            seat_id = person.get("id")
            if type(account_id) is int and account_id > 0:
                playing[product].add(("account", account_id))
            elif isinstance(seat_id, str) and seat_id:
                playing[product].add(("guest", str(room_id), seat_id))
    return {"games": {product: {"players": len(accounts)} for product, accounts in playing.items()}}


@router.get("/game-activity")
async def read_game_activity(request: Request, response: Response) -> dict:
    # Resolve against current durable session/role/owner state every request.
    # Cached browser capabilities and a dashboard grant cannot widen totals.
    identity = resolve_session(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Vary"] = "Cookie"
    return game_activity(identity)
