"""One private, secret-free Watten recipe per active account.

The caller authenticates the account and owns commit/rollback; mutations flush
but never commit. Reads never autoflush or repair an unknown/malformed recipe.
Protection is retained as ``password_required`` only. A future room-creation UI
must request a fresh password or explicit deselection, never silently unprotect
a saved recipe. No room, participant, invitation or password is saved here.
"""

from __future__ import annotations

from sqlalchemy import delete, exists, literal, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .models import User, WattenFavorite
from .watten_recipe import WattenRecipe, WattenRecipeError, recipe_from_json, recipe_to_json


class WattenFavoriteError(ValueError):
    pass


def _user_id(user_id):
    if type(user_id) is not int or user_id < 1:
        raise WattenFavoriteError("watten_favorite_invalid_account")


def _active_account(db, user_id, *, lock=False):
    query = select(User.id).where(User.id == user_id, User.is_active.is_(True))
    if db.scalar(query.with_for_update() if lock else query) is None:
        raise WattenFavoriteError("watten_favorite_invalid_account")


def _decode(raw):
    try:
        return recipe_from_json(raw)
    except (WattenRecipeError, TypeError, ValueError) as exc:
        raise WattenFavoriteError("watten_favorite_invalid_recipe") from exc


def read_watten_favorite(db, *, user_id: int) -> WattenRecipe | None:
    """Read this account's immutable recipe, or None; invalid storage fails closed."""
    _user_id(user_id)
    with db.no_autoflush:
        _active_account(db, user_id)
        raw = db.scalar(select(WattenFavorite.recipe_json).where(WattenFavorite.user_id == user_id))
    return None if raw is None else _decode(raw)


def save_watten_favorite(db, *, user_id: int, recipe: WattenRecipe) -> WattenRecipe:
    """Validate before any mutation, then atomically replace this account's recipe.

    Explicitly replacing a protected recipe with password_required=False is a
    caller choice; no default or migration changes the saved protection flag.
    The caller must roll back on any error, including unrelated pending work.
    """
    _user_id(user_id)
    if type(recipe) is not WattenRecipe:
        raise WattenFavoriteError("watten_favorite_invalid_recipe")
    try:
        # Revalidate even an object altered outside its frozen constructor.
        validated = _decode(recipe_to_json(recipe))
        raw = recipe_to_json(validated)
    except (WattenRecipeError, TypeError, ValueError) as exc:
        raise WattenFavoriteError("watten_favorite_invalid_recipe") from exc
    dialect = db.get_bind().dialect.name
    if dialect not in {"sqlite", "postgresql"}:
        raise WattenFavoriteError("watten_favorite_unsupported_database")
    db.flush()
    with db.no_autoflush:
        _active_account(db, user_id, lock=True)
        insert = sqlite_insert if dialect == "sqlite" else pg_insert
        # SQLite ignores FOR UPDATE: require active ownership at the write too.
        source = select(User.id, literal(raw)).where(User.id == user_id, User.is_active.is_(True))
        statement = insert(WattenFavorite).from_select(("user_id", "recipe_json"), source)
        db.execute(statement.on_conflict_do_update(
            index_elements=("user_id",), set_={"recipe_json": statement.excluded.recipe_json}))
        _active_account(db, user_id)
    db.flush()
    return validated


def delete_watten_favorite(db, *, user_id: int) -> None:
    """Delete only this account's favorite; a missing favorite is a no-op."""
    _user_id(user_id)
    db.flush()
    with db.no_autoflush:
        _active_account(db, user_id, lock=True)
        active = exists(select(User.id).where(User.id == user_id, User.is_active.is_(True)))
        db.execute(delete(WattenFavorite).where(WattenFavorite.user_id == user_id, active))
        _active_account(db, user_id)
    db.flush()
