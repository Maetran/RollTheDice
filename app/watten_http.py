"""Thin handlers used by the existing generic game endpoints."""

import secrets

from fastapi import HTTPException
from sqlalchemy.exc import SQLAlchemyError
from starlette.responses import JSONResponse

from .auth import require_csrf, resolve_session
from .game_state import games
from .watten_access import require_watten_access
from .watten_recipe import recipe_from_payload
from .watten_runtime import (
    account_protection_verified,
    configure_watten_game,
    expire_waiting_game,
    game_lock,
    lobby_entry,
    new_watten_game,
    persist_watten_game,
    snapshot_watten,
)

_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}


def _response(payload: dict) -> JSONResponse:
    return JSONResponse(payload, headers=_HEADERS)


def _identity(request):
    try:
        identity = require_watten_access(request, resolve_session(request))
        expected = request.headers.getlist("X-Watten-Expected-Account-Id")
        if expected and (len(expected) != 1 or not expected[0].isascii() or not expected[0].isdecimal()
                         or expected[0] != str(identity.user_id)):
            raise HTTPException(status_code=409, detail="watten_account_changed")
        return identity
    except HTTPException as exc:
        exc.headers = {**(exc.headers or {}), **_HEADERS}
        raise


def create_watten_http(request, req) -> JSONResponse:
    identity = _identity(request)
    require_csrf(request, identity)
    recipe = recipe_from_payload(req.watten_recipe)
    game = new_watten_game(secrets.token_hex(8), req.name, req.mode)
    configure_watten_game(game, recipe, identity, req.passphrase)
    persist_watten_game(game, creating=True)
    games[game["_id"]] = game
    return _response({"game_id": game["_id"]})


async def list_watten_http(request) -> JSONResponse:
    from .watten_websocket import expire_watten_game

    identity = _identity(request)
    entries = []
    for game in list(games.values()):
        if game.get("_game_type") == "watten":
            async with game_lock(game):
                identity = _identity(request)
                expire_waiting_game(game)
                if await expire_watten_game(game):
                    continue
                if not game.get("_aborted") and not game.get("_completion_persisted"):
                    entries.append(lobby_entry(game, identity.user_id))
    return _response({"games": entries, "online_users": None})


async def detail_watten_http(request, game: dict, passphrase, check: int) -> JSONResponse:
    from .watten_websocket import expire_watten_game

    identity = _identity(request)
    async with game_lock(game):
        identity = _identity(request)
        try:
            expire_waiting_game(game)
            if await expire_watten_game(game):
                return _response({"exists": False})
            return _detail_response(identity, game, passphrase, check)
        except (ValueError, SQLAlchemyError) as exc:
            raise HTTPException(status_code=503, detail="watten_storage_unavailable", headers=_HEADERS) from exc


def _detail_response(identity, game: dict, passphrase, check: int) -> JSONResponse:
    own = next((item for item in game["_watten"].room.members if item.account_id == identity.user_id), None)
    verified = own is not None or account_protection_verified(game, identity.user_id, passphrase)
    if check == 1:
        if not verified:
            raise HTTPException(status_code=403, detail="watten_wrong_passphrase")
        return _response({"ok": True, "exists": True})
    if not verified:
        return _response({"exists": True, **lobby_entry(game, identity.user_id)})
    return _response({"exists": True, **snapshot_watten(game, own.participant_id if own else None, viewer_account_id=identity.user_id)})
