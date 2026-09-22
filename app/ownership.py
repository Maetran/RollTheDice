"""Account-ID-based ownership and server-side staff administration boundaries."""

from fastapi import HTTPException
from sqlalchemy import delete, select, update

from .models import AccountOwnership, OwnershipAudit, User
from .security import utcnow


def ownership_flags(db, user_id: int) -> dict:
    membership = db.get(AccountOwnership, user_id)
    return {"is_owner": membership is not None, "is_founder": bool(membership and membership.is_founder)}


def _actor(db, user_id: int) -> User:
    # Serialize policy checks with account/ownership writes, including on SQLite.
    locked = db.execute(update(User).where(User.id == user_id, User.role == "admin", User.is_active.is_(True))
                        .values(updated_at=User.updated_at).returning(User.id)).scalar_one_or_none()
    if locked is None:
        raise HTTPException(status_code=403, detail="admin_required")
    actor = db.get(User, user_id)
    db.refresh(actor)
    return actor


def require_owner(db, actor_user_id: int, *, founder: bool = False) -> User:
    actor = _actor(db, actor_user_id)
    flags = ownership_flags(db, actor_user_id)
    if not flags["is_founder" if founder else "is_owner"]:
        raise HTTPException(status_code=403, detail="founder_required" if founder else "owner_required")
    return actor


def ensure_can_moderate(db, actor_user_id: int, target: User) -> None:
    """Owners must be revoked first; ordinary admins cannot moderate staff."""
    _actor(db, actor_user_id)
    db.refresh(target)
    if ownership_flags(db, target.id)["is_owner"]:
        raise HTTPException(status_code=409, detail="owner_protected")
    if target.role == "admin" and not ownership_flags(db, actor_user_id)["is_owner"]:
        raise HTTPException(status_code=403, detail="staff_protected")


def ensure_can_change_role(db, actor_user_id: int, target: User, role: str | None) -> None:
    ensure_can_moderate(db, actor_user_id, target)
    if role is not None and role != target.role:
        require_owner(db, actor_user_id)


def ensure_can_create_user(db, actor_user_id: int, role: str) -> None:
    _actor(db, actor_user_id)
    if role == "admin":
        require_owner(db, actor_user_id)


def ensure_can_reset_password(db, actor_user_id: int | None, target: User) -> None:
    if actor_user_id is not None:
        _actor(db, actor_user_id)
        db.refresh(target)
    flags = ownership_flags(db, target.id)
    if flags["is_founder"]:
        raise HTTPException(status_code=409, detail="founder_protected")
    actor_flags = ownership_flags(db, actor_user_id) if actor_user_id is not None else {}
    if flags["is_owner"]:
        if not actor_flags.get("is_founder"):
            raise HTTPException(status_code=403, detail="owner_protected")
    elif target.role == "admin" and not actor_flags.get("is_owner"):
        raise HTTPException(status_code=403, detail="staff_protected")


def _eligible(db, user: User) -> bool:
    from .moderation import active_bans

    return bool(user.role == "admin" and user.is_active and not user.lobby_chat_muted
                and not user.lobby_chat_excluded and not active_bans(db, user.id))


def _ownership_target(db, user_id: int) -> User:
    db.execute(update(User).where(User.id == user_id).values(updated_at=User.updated_at))
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user_not_found")
    db.refresh(user)
    return user


def bind_founder(db, user_id: int) -> AccountOwnership:
    """Explicit operator binding by ID, optionally invoked by configured startup."""
    user = _ownership_target(db, user_id)
    existing = db.scalar(select(AccountOwnership).where(AccountOwnership.is_founder.is_(True)))
    if existing:
        if existing.user_id == user_id:
            return existing
        raise HTTPException(status_code=409, detail="founder_already_bound")
    if not _eligible(db, user):
        raise HTTPException(status_code=409, detail="ownership_requires_eligible_admin")
    membership = AccountOwnership(user_id=user_id, is_founder=True, created_at=utcnow())
    db.add(membership)
    db.add(OwnershipAudit(user_id=user_id, actor_user_id=None, action="founder_bound", created_at=utcnow()))
    db.flush()
    return membership


def grant_ownership(db, user_id: int, actor_user_id: int) -> AccountOwnership:
    require_owner(db, actor_user_id, founder=True)
    user = _ownership_target(db, user_id)
    membership = db.get(AccountOwnership, user_id)
    if membership:
        return membership
    if not _eligible(db, user):
        raise HTTPException(status_code=409, detail="ownership_requires_eligible_admin")
    membership = AccountOwnership(user_id=user_id, is_founder=False, granted_by_user_id=actor_user_id, created_at=utcnow())
    db.add(membership)
    db.add(OwnershipAudit(user_id=user_id, actor_user_id=actor_user_id, action="granted", created_at=utcnow()))
    db.flush()
    return membership


def revoke_ownership(db, user_id: int, actor_user_id: int) -> None:
    require_owner(db, actor_user_id, founder=True)
    _ownership_target(db, user_id)
    membership = db.get(AccountOwnership, user_id)
    if membership is None:
        return
    if membership.is_founder:
        raise HTTPException(status_code=409, detail="founder_protected")
    db.execute(delete(AccountOwnership).where(AccountOwnership.user_id == user_id, AccountOwnership.is_founder.is_(False)))
    db.add(OwnershipAudit(user_id=user_id, actor_user_id=actor_user_id, action="revoked", created_at=utcnow()))
    db.flush()


def administration_capabilities(db, actor_user_id: int, target: User) -> dict:
    actor = db.get(User, actor_user_id)
    valid = bool(actor and actor.is_active and actor.role == "admin")
    actor_flags = ownership_flags(db, actor_user_id)
    target_flags = ownership_flags(db, target.id)
    mutable = valid and not target_flags["is_owner"] and (target.role != "admin" or actor_flags["is_owner"])
    return {
        "can_change_role": bool(mutable and actor_flags["is_owner"]),
        "can_reset_password": bool(valid and not target_flags["is_founder"] and (
            actor_flags["is_founder"] if target_flags["is_owner"] else target.role != "admin" or actor_flags["is_owner"])),
        "can_toggle_active": bool(mutable), "can_moderate_chat": bool(mutable),
        "can_set_ban": bool(mutable and target.role != "admin"), "can_revoke_ban": bool(mutable),
        "can_grant_owner": bool(valid and actor_flags["is_founder"] and not target_flags["is_owner"] and _eligible(db, target)),
        "can_revoke_owner": bool(valid and actor_flags["is_founder"] and target_flags["is_owner"] and not target_flags["is_founder"]),
    }
