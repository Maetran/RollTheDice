"""Fresh original-roster authority for creating a fixed native continuation."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .account_progress import ProgressIdentityError, lock_account_rows
from .database import database_schema_ready, session_scope
from .models import AccountProgressOrigin, User
from .watten_tournament import bind_room_series

ORIGINAL_ROSTER_UNAVAILABLE = "watten_rematch_original_roster_unavailable"


def original_roster_available(db, room, *, lock: bool = False) -> bool:
    """Never replace an original human with their historical progress owner.

    Creation takes the same ascending account write locks as account merge.
    Display reads use fresh rows without locks, caches or journal replay.
    The authoritative caller keeps these locks until its rematch TX commits.
    """
    series = room.series if room.series is not None else bind_room_series(room).series
    accounts = tuple(sorted(int(token[2:]) for token in series.bindings if token.startswith("h:")))
    if not accounts:
        return False
    if lock:
        try:
            users = lock_account_rows(db, accounts)
        except ProgressIdentityError:
            return False
        active = {account for account, user in users.items() if user.is_active}
    else:
        active = set(db.scalars(select(User.id).where(User.id.in_(accounts), User.is_active.is_(True))))
    retired = db.scalar(select(AccountProgressOrigin.origin_user_id).where(
        AccountProgressOrigin.origin_user_id.in_(accounts)).limit(1))
    return active == set(accounts) and retired is None


def read_rematch_unavailable_reason(room) -> str | None:
    """Called only for a finished host view that could otherwise create a table."""
    if not database_schema_ready():
        return "watten_storage_unavailable"
    try:
        with session_scope() as db:
            return None if original_roster_available(db, room) else ORIGINAL_ROSTER_UNAVAILABLE
    except SQLAlchemyError:
        return "watten_storage_unavailable"
