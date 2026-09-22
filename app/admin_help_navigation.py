"""Scoped spectator navigation and a preserved seat during an admin assignment."""

from datetime import timedelta
from urllib.parse import quote

from fastapi import HTTPException, WebSocketDisconnect

from .active_games import save_active_game
from .game_state import games, touch
from .product_hosts import site_origin, zilch_origin
from .security import utcnow


def game_url(game_id: str, game_type: str, *, spectator: bool = False) -> str:
    origin = zilch_origin() if game_type == "zilch" else site_origin()
    return f"{origin}/spiel/{quote(game_id, safe='')}" + ("/zuschauen" if spectator else "")


async def _publish(game) -> None:
    from .game_realtime import broadcast
    from .game_snapshot import snapshot

    save_active_game(game)
    await broadcast(game, {"scoreboard": snapshot(game)})


async def enter_help_game(identity, help_request: dict) -> dict:
    from .admin_help import has_active_help_claim

    if help_request.get("claimed_by_user_id") != identity.user_id:
        raise HTTPException(status_code=403, detail="admin_help_not_assigned")
    target_id = help_request["game_id"]
    if not has_active_help_claim(identity.user_id, target_id, request_id=help_request["id"]):
        raise HTTPException(status_code=409, detail="admin_help_resolved")
    origin_id = help_request.get("origin_game_id")
    origin = games.get(origin_id)
    return_url = None
    if origin and origin_id != target_id and not origin.get("_finished") and not origin.get("_aborted"):
        player = next((p for p in origin.get("_players", []) if p.get("user_id") == identity.user_id), None)
        if player:
            from .zilch_state import pause_zilch_solo_timer

            marker = origin.setdefault("_admin_help_away", {})
            marker[str(identity.user_id)] = {
                "request_id": help_request["id"], "name": identity.username,
                "until": (utcnow() + timedelta(hours=1)).isoformat(),
            }
            pause_zilch_solo_timer(origin)
            touch(origin)
            await _publish(origin)
            return_url = game_url(origin_id, origin.get("_game_type", "zdwa"))
    return {"help_url": game_url(target_id, help_request["game_type"], spectator=True)
            + f"?help_request={help_request['id']}", "return_url": return_url}


async def end_help_assignment(request_id: str) -> None:
    from .admin_help import has_active_help_claim
    from .database import session_scope
    from .models import AdminHelpRequest

    with session_scope() as db:
        request = db.get(AdminHelpRequest, request_id)
        target_id = request.game_id if request else None
        helper_id = request.claimed_by_user_id if request else None
    for game in list(games.values()):
        if game.get("_id") == target_id:
            for spectator in list(game.get("_spectators", [])):
                if spectator.get("_admin_help") and (
                    spectator.get("user_id") == helper_id
                    or not has_active_help_claim(spectator.get("user_id"), target_id)
                ):
                    game["_spectators"].remove(spectator)
                    if spectator.get("ws"):
                        from .game_ws_session import close_with_error

                        try:
                            await close_with_error(spectator["ws"], "Der Admin-Einsatz ist beendet.", fatal=True, code=1000,
                                                   error_code="admin_help_completed")
                        except (WebSocketDisconnect, RuntimeError, OSError):
                            # An already closed connection must not strand the admin's own game.
                            pass
        away = game.get("_admin_help_away", {})
        removed = [key for key, value in away.items() if value.get("request_id") == request_id]
        for key in removed:
            away.pop(key, None)
        if removed:
            touch(game)
            await _publish(game)


async def return_from_help(identity, help_request: dict) -> dict:
    if help_request.get("claimed_by_user_id") != identity.user_id:
        raise HTTPException(status_code=403, detail="admin_help_not_assigned")
    await end_help_assignment(help_request["id"])
    origin = games.get(help_request.get("origin_game_id"))
    return {"return_url": game_url(origin["_id"], origin.get("_game_type", "zdwa")) if origin else site_origin()}


def clear_admin_away_on_rejoin(game: dict, user_id: int | None) -> None:
    if user_id:
        marker = game.get("_admin_help_away", {}).pop(str(user_id), None)
        if marker:
            from sqlalchemy import update

            from .database import session_scope
            from .models import AdminHelpRequest

            with session_scope() as db:
                db.execute(update(AdminHelpRequest).where(
                    AdminHelpRequest.id == marker["request_id"], AdminHelpRequest.claimed_by_user_id == user_id,
                    AdminHelpRequest.origin_game_id == game["_id"],
                ).values(origin_game_id=None))
