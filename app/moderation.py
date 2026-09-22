"""Account bans independent of login, roles and help-request completion."""

from datetime import timedelta

from fastapi import HTTPException, WebSocketDisconnect
from sqlalchemy import or_, select

from .database import database_schema_ready, session_scope
from .models import User, UserBan
from .security import as_utc, utcnow

BAN_DURATIONS = frozenset({3, 5, 7, 14, 30, 60})


def active_bans(db, user_id: int, *, scope: str | None = None) -> list[UserBan]:
    query = select(UserBan).where(
        UserBan.user_id == user_id, UserBan.revoked_at.is_(None),
        or_(UserBan.expires_at.is_(None), UserBan.expires_at > utcnow()),
    )
    if scope:
        query = query.where(UserBan.scope == scope)
    return list(db.scalars(query.order_by(UserBan.created_at.desc())))


def ban_payload(ban: UserBan) -> dict:
    return {
        "id": ban.id, "scope": ban.scope, "reason": ban.reason,
        "created_at": as_utc(ban.created_at).isoformat(),
        "expires_at": as_utc(ban.expires_at).isoformat() if ban.expires_at else None,
    }


def account_bans(user_id: int) -> list[dict]:
    if not database_schema_ready():
        return []
    with session_scope() as db:
        return [ban_payload(ban) for ban in active_bans(db, user_id)]


def user_play_banned(user_id: int | None) -> bool:
    return bool(user_id and any(ban["scope"] == "play" for ban in account_bans(user_id)))


def admin_help_blocked(user_id: int) -> bool:
    return bool(account_bans(user_id))


def ensure_play_allowed(identity) -> None:
    if identity and user_play_banned(identity.user_id):
        raise HTTPException(status_code=403, detail="account_play_banned")


def revoke_bans(db, user_id: int, scope: str, admin_id: int) -> None:
    for ban in active_bans(db, user_id, scope=scope):
        ban.revoked_at = utcnow()
        ban.revoked_by_user_id = admin_id


def apply_ban(db, user_id: int, admin_id: int, *, scope: str, days: int | None, reason: str,
              help_request_id: str | None = None) -> UserBan:
    if scope not in {"play", "help"} or (days is not None and days not in BAN_DURATIONS):
        raise HTTPException(status_code=422, detail="invalid_ban_duration")
    if not reason.strip():
        raise HTTPException(status_code=422, detail="ban_reason_required")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="user_not_found")
    if user.role == "admin":
        raise HTTPException(status_code=409, detail="admin_ban_requires_role_change")
    revoke_bans(db, user_id, scope, admin_id)
    now = utcnow()
    ban = UserBan(user_id=user_id, scope=scope, reason=reason.strip()[:500], created_at=now,
                  expires_at=now + timedelta(days=days) if days else None, created_by_user_id=admin_id,
                  help_request_id=help_request_id)
    db.add(ban)
    db.flush()
    return ban


def apply_help_misuse_ban(db, user_id: int, admin_id: int, request_id: str) -> None:
    apply_ban(db, user_id, admin_id, scope="help", days=None,
              reason="admin_help_misuse", help_request_id=request_id)


async def disconnect_banned_user(user_id: int) -> None:
    from .game_state import games
    from .game_ws_session import close_with_error

    for game in list(games.values()):
        for player in [*game.get("_players", []), *game.get("_spectators", [])]:
            if player.get("user_id") == user_id and player.get("ws"):
                try:
                    await close_with_error(player["ws"],
                                           "Dein Konto ist für das Spielen gesperrt. Details findest du im Konto.",
                                           fatal=True, error_code="account_play_banned")
                except (WebSocketDisconnect, RuntimeError, OSError):
                    # The durable ban still applies, including to the account's other sockets.
                    pass
