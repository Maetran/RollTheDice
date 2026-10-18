"""Thin handlers used by the existing generic game endpoints."""

import secrets

from fastapi import HTTPException
from starlette.responses import JSONResponse

from .auth import require_csrf, resolve_session
from .game_state import games
from .watten_access import require_watten_access
from .watten_recipe import recipe_from_payload
from .watten_runtime import (
    configure_watten_game,
    expire_waiting_game,
    game_lock,
    lobby_entry,
    new_watten_game,
    passphrase_matches,
    persist_watten_game,
    snapshot_watten,
)


def _response(payload: dict) -> JSONResponse:
    return JSONResponse(payload, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"})


def create_watten_http(request, req) -> JSONResponse:
    identity = require_watten_access(request, resolve_session(request))
    require_csrf(request, identity)
    recipe = recipe_from_payload(req.watten_recipe)
    game = new_watten_game(secrets.token_hex(8), req.name, req.mode)
    configure_watten_game(game, recipe, identity, req.passphrase)
    persist_watten_game(game, creating=True)
    games[game["_id"]] = game
    return _response({"game_id": game["_id"]})


async def list_watten_http(request) -> JSONResponse:
    identity = require_watten_access(request, resolve_session(request))
    entries = []
    for game in list(games.values()):
        if game.get("_game_type") == "watten":
            async with game_lock(game):
                identity = require_watten_access(request, resolve_session(request))
                expire_waiting_game(game)
                if not game.get("_aborted") and not game.get("_completion_persisted"):
                    entries.append(lobby_entry(game, identity.user_id))
    return _response({"games": entries, "online_users": None})


async def detail_watten_http(request, game: dict, passphrase, check: int) -> JSONResponse:
    identity = require_watten_access(request, resolve_session(request))
    async with game_lock(game):
        identity = require_watten_access(request, resolve_session(request))
        expire_waiting_game(game)
        return _detail_response(identity, game, passphrase, check)


def _detail_response(identity, game: dict, passphrase, check: int) -> JSONResponse:
    own = next((item for item in game["_watten"].room.members if item.account_id == identity.user_id), None)
    verified = own is not None or passphrase_matches(game, passphrase)
    if check == 1:
        if not verified:
            raise HTTPException(status_code=403, detail="watten_wrong_passphrase")
        return _response({"ok": True, "exists": True})
    if not verified:
        return _response({"exists": True, **lobby_entry(game, identity.user_id)})
    return _response({"exists": True, **snapshot_watten(game, own.participant_id if own else None, viewer_account_id=identity.user_id)})
