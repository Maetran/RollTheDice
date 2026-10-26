"""Historical progress ownership. Never use these helpers for authentication.

All helpers use the caller's transaction and never commit. A retired origin
stays a real, inactive identity; only its historical progress has a beneficiary.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select, update

from .models import AccountProgressOrigin, User


class ProgressIdentityError(ValueError):
    pass


def progress_owner_ids(db, user_ids: Iterable[int]) -> dict[int, int]:
    ids = sorted({int(value) for value in user_ids})
    owners = {value: value for value in ids}
    if ids:
        owners.update(db.execute(select(
            AccountProgressOrigin.origin_user_id, AccountProgressOrigin.owner_user_id,
        ).where(AccountProgressOrigin.origin_user_id.in_(ids))).all())
    return owners


def progress_owner_id(db, original_id: int) -> int:
    return progress_owner_ids(db, [original_id])[original_id]


def is_retired_merge_origin(db, user_id: int) -> bool:
    return db.get(AccountProgressOrigin, user_id) is not None


def owned_origin_ids(db, active_owner_id: int) -> tuple[int, ...]:
    if is_retired_merge_origin(db, active_owner_id):
        raise ProgressIdentityError("progress_owner_retired")
    return tuple(sorted({active_owner_id, *db.scalars(select(
        AccountProgressOrigin.origin_user_id,
    ).where(AccountProgressOrigin.owner_user_id == active_owner_id))}))


def lock_account_rows(db, user_ids: Iterable[int]) -> dict[int, User]:
    """One ascending write-lock order on both SQLite and PostgreSQL.

    Acquire these before authorization/reauthentication and reread with
    populate_existing so an old ORM identity cannot authorize a stale write.
    """
    result = {}
    with db.no_autoflush:
        for user_id in sorted({int(value) for value in user_ids}):
            locked = db.execute(update(User).where(User.id == user_id).values(
                updated_at=User.updated_at,
            ).execution_options(synchronize_session=False))
            if locked.rowcount != 1:
                raise ProgressIdentityError("account_not_found")
            result[user_id] = db.scalar(select(User).where(User.id == user_id).execution_options(populate_existing=True))
    return result


def require_exact_active_account(db, user_id: int) -> User:
    """Admission/write guard; deliberately does not redirect to an owner."""
    user = lock_account_rows(db, [user_id])[user_id]
    if not user.is_active or is_retired_merge_origin(db, user_id):
        raise ProgressIdentityError("account_retired_or_inactive")
    return user
