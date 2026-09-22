"""Current, public contact badges; never an authorization capability."""

from __future__ import annotations

import logging
from collections.abc import Iterable

from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .models import User

logger = logging.getLogger(__name__)


def active_admin_user_ids(user_ids: Iterable[object], *, db=None) -> set[int]:
    ids = {value for value in user_ids if type(value) is int and value > 0}
    if not ids or (db is None and not database_schema_ready()):
        return set()
    statement = select(User.id).where(User.id.in_(ids), User.is_active.is_(True), User.role == "admin")
    try:
        if db is not None:
            return set(db.scalars(statement))
        with session_scope() as session:
            return set(session.scalars(statement))
    except Exception:
        # A supplemental badge must never interrupt a game, and a failed
        # lookup must never preserve a stale claim that someone is an admin.
        logger.exception("Could not resolve public admin badges")
        return set()


def hydrate_admin_status(players: Iterable[dict], *, admin_ids: set[int] | None = None) -> set[int]:
    identities = [player for player in players if isinstance(player, dict)]
    if admin_ids is None:
        admin_ids = active_admin_user_ids(player.get("user_id") for player in identities)
    for player in identities:
        user_id = player.get("user_id")
        player["is_admin"] = (
            type(user_id) is int and user_id in admin_ids
            and player.get("type") != "cpu" and player.get("participant_type") != "cpu"
        )
    return admin_ids
