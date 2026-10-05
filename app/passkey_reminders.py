"""Account-wide, dismissible invitations to add a first passkey."""

from datetime import timedelta, timezone

from fastapi import APIRouter, Request, Response
from sqlalchemy import or_, select, update

from .auth import require_csrf, require_user
from .database import session_scope
from .models import PasskeyCredential, User
from .passkeys import passkey_config
from .security import utcnow

router = APIRouter(prefix="/api/auth/passkeys", tags=["authentication"])
PROMPT_INTERVAL = timedelta(days=7)


def claim_passkey_prompt(user_id: int) -> dict:
    """Only one tab/device may show a reminder within a rolling seven days."""
    if not passkey_config().enabled:
        return {"show_prompt": False, "interval_days": PROMPT_INTERVAL.days}
    now = utcnow()
    has_passkey = select(PasskeyCredential.id).where(PasskeyCredential.user_id == User.id).exists()
    with session_scope() as db:
        claimed = db.execute(
            update(User)
            .where(
                User.id == user_id,
                User.is_active.is_(True),
                User.must_change_password.is_(False),
                ~has_passkey,
                or_(User.passkey_prompted_at.is_(None), User.passkey_prompted_at <= now - PROMPT_INTERVAL),
            )
            .values(passkey_prompted_at=now)
            .returning(User.id)
        ).scalar_one_or_none()
        user = db.get(User, user_id)
        prompted_at = user.passkey_prompted_at if user else None
        next_prompt_at = prompted_at.replace(tzinfo=timezone.utc) + PROMPT_INTERVAL if prompted_at else None
    return {"show_prompt": claimed is not None, "interval_days": PROMPT_INTERVAL.days, "next_prompt_at": next_prompt_at}


@router.post("/prompt")
def passkey_prompt(request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    return claim_passkey_prompt(identity.user_id)


@router.post("/prompt/dismiss")
def dismiss_passkey_prompt(request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    now = utcnow()
    with session_scope() as db:
        db.execute(update(User).where(User.id == identity.user_id).values(passkey_prompted_at=now))
    return {"next_prompt_at": now + PROMPT_INTERVAL}
