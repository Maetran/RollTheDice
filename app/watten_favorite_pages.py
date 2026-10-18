"""Private local Watten favorite API; recipes never contain a passphrase."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import SQLAlchemyError
from starlette.concurrency import run_in_threadpool

from .database import session_scope
from .watten_favorites import delete_watten_favorite, read_watten_favorite, save_watten_favorite
from .watten_progress_pages import _HEADERS, _csrf, _identity, _response
from .watten_recipe import MAX_JSON_CHARS, loads_strict_json, recipe_from_payload, recipe_to_payload, require_fields

router = APIRouter()


def _payload(recipe):
    return {"schema_version": 1, "game_type": "watten", "recipe": recipe_to_payload(recipe) if recipe else None}


def _storage_error(exc):
    if str(exc) == "watten_favorite_invalid_account":
        return HTTPException(status_code=401, detail="authentication_required", headers=_HEADERS)
    return HTTPException(status_code=503, detail="watten_favorite_unavailable", headers=_HEADERS)


async def _body(request: Request):
    chunks, size = [], 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_JSON_CHARS:
            raise HTTPException(status_code=422, detail="watten_favorite_invalid_recipe", headers=_HEADERS)
        chunks.append(chunk)
    return b"".join(chunks)


@router.get("/api/watten/favorite")
def read_favorite(request: Request, identity=Depends(_identity)):
    try:
        with session_scope() as db:
            recipe = read_watten_favorite(db, user_id=identity.user_id)
        return _response(_payload(recipe))
    except (ValueError, SQLAlchemyError) as exc:
        raise _storage_error(exc) from exc


@router.put("/api/watten/favorite")
async def save_favorite(request: Request, identity=Depends(_identity)):
    _csrf(request, identity)
    try:
        raw = loads_strict_json((await _body(request)).decode("utf-8"))
        body = require_fields(raw, frozenset({"recipe"}), ValueError, "watten_favorite")
        recipe = recipe_from_payload(body["recipe"])
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=422, detail="watten_favorite_invalid_recipe", headers=_HEADERS) from exc
    try:
        return await run_in_threadpool(_save, request, identity.user_id, recipe)
    except (ValueError, SQLAlchemyError) as exc:
        raise _storage_error(exc) from exc


@router.delete("/api/watten/favorite")
async def delete_favorite(request: Request, identity=Depends(_identity)):
    _csrf(request, identity)
    if (await _body(request)).strip():
        raise HTTPException(status_code=422, detail="watten_favorite_invalid_request", headers=_HEADERS)
    try:
        return await run_in_threadpool(_delete, request, identity.user_id)
    except (ValueError, SQLAlchemyError) as exc:
        raise _storage_error(exc) from exc


def _mutation_identity(request, user_id):
    # Body streaming and worker dispatch can outlive the authenticated session.
    # Re-resolve its original cookie immediately before this worker mutates.
    identity = _identity(request)
    if identity.user_id != user_id:
        raise HTTPException(status_code=409, detail="watten_account_changed", headers=_HEADERS)
    _csrf(request, identity)


def _save(request, user_id, recipe):
    _mutation_identity(request, user_id)
    with session_scope() as db:
        saved = save_watten_favorite(db, user_id=user_id, recipe=recipe)
    return _response(_payload(saved))


def _delete(request, user_id):
    _mutation_identity(request, user_id)
    with session_scope() as db:
        delete_watten_favorite(db, user_id=user_id)
    return _response(_payload(None))
