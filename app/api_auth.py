from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from .achievements import achievement_rank_payloads_for_user_ids, public_achievement_ranks
from .auth import (
    auth_identity_payload,
    change_password,
    change_username,
    clear_session_cookie,
    create_user,
    login,
    logout,
    promote_legacy_session_cookie,
    require_admin,
    require_csrf,
    require_user,
    reset_password,
    resolve_session,
    session_token_from_connection,
    set_session_cookie,
    validate_request_origin,
)
from .auth_protection import (
    clear_login_failures,
    enforce_email_request_rate_limit,
    enforce_login_rate_limit,
    enforce_registration_rate_limit,
    record_login_failure,
    registration_public_config,
    verify_registration_challenge,
)
from .database import session_scope
from .email_accounts import (
    account_email_status,
    begin_email_verification,
    begin_password_reset,
    begin_registration,
    complete_password_reset,
    complete_registration,
    confirm_email,
    inspect_account_email_token,
    inspect_registration,
)
from .email_delivery import (
    EmailDeliveryFailed,
    EmailDeliveryUnavailable,
    account_email_available,
    account_email_config,
    send_account_email_safely,
)
from .engagement import record_engagement_safely
from .game_access import public_game_access_payload
from .models import Session as LoginSession
from .models import User
from .passkeys import passkey_public_config
from .product_hosts import is_zilch_host
from .security import normalize_email_address, utcnow
from .web_push import (
    WebPushPreferencesRequest,
    WebPushSubscriptionRequest,
    claim_web_push_opt_in_prompt,
    remove_web_push_subscriptions,
    save_web_push_subscription,
    update_web_push_preferences,
    web_push_subscription_status,
)

router = APIRouter(prefix="/api", tags=["authentication"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class RegisterRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    email: str | None = Field(default=None, min_length=3, max_length=254)
    password: str | None = Field(default=None, min_length=1, max_length=256)
    turnstile_token: str | None = Field(default=None, max_length=4096)
    preferred_language: Literal["de", "en"] = "de"


class RegistrationCompletionRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class TokenInspectionRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)


class PasswordResetRequest(BaseModel):
    email: str = Field(min_length=1, max_length=254)
    preferred_language: Literal["de", "en"] = "de"


class PasswordResetCompletionRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256)
    password: str = Field(min_length=1, max_length=256)


class AccountEmailRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    current_password: str = Field(min_length=1, max_length=256)


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=1, max_length=256)


class UsernameChangeRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    current_password: str = Field(min_length=1, max_length=256)


class UserPreferencesRequest(BaseModel):
    announce_selection_mode: Literal["table", "overlay"]
    auto_write_announced: bool
    mobile_row_quick_entry: bool
    haptic_feedback: bool = False
    keep_screen_awake: bool = False
    # Kept optional so a tab with a previous static bundle cannot accidentally
    # re-enable a user's explicit lobby-chat choice during a normal save.
    lobby_chat_popups: bool | None = None
    lobby_chat_enabled: bool | None = None
    preferred_language: Literal["de", "en"] = "de"


class LanguagePreferenceRequest(BaseModel):
    preferred_language: Literal["de", "en"]


class LobbyChatPreferenceRequest(BaseModel):
    lobby_chat_popups: bool | None = None
    lobby_chat_enabled: bool | None = None


class AdminUserCreateRequest(BaseModel):
    username: str
    temporary_password: str
    role: Literal["user", "admin"] = "user"


class AdminPasswordResetRequest(BaseModel):
    temporary_password: str


class AdminUserUpdateRequest(BaseModel):
    role: Literal["user", "admin"] | None = None
    is_active: bool | None = None
    lobby_chat_muted: bool | None = None
    lobby_chat_excluded: bool | None = None


def _user_payload(user: User, *, achievement_rank: dict | None = None) -> dict:
    payload = {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "is_active": user.is_active,
        "must_change_password": user.must_change_password,
        "lobby_chat_muted": user.lobby_chat_muted,
        "lobby_chat_excluded": user.lobby_chat_excluded,
        "created_at": user.created_at,
        "updated_at": user.updated_at,
    }
    if achievement_rank is not None:
        payload["achievement_rank"] = achievement_rank
    return payload


@router.get("/auth/me")
def auth_me(request: Request, response: Response):
    identity = resolve_session(request)
    if identity:
        promote_legacy_session_cookie(response, request)
    response.headers["Cache-Control"] = "no-store"
    return {
        "authenticated": bool(identity),
        "user": auth_identity_payload(identity, include_csrf=True) if identity else None,
        # Guests need the same server-derived product availability as signed-in
        # visitors so the app switcher can open a public Zilch table directly.
        "game_access": public_game_access_payload(identity),
        "registration": {**registration_public_config(), "email_enabled": account_email_available()},
        "passkeys": passkey_public_config(),
    }


@router.get("/auth/registration-config")
def auth_registration_config():
    return {**registration_public_config(), "email_enabled": account_email_available()}


@router.post("/auth/login")
def auth_login(payload: LoginRequest, request: Request, response: Response):
    identity, raw_token = login(request, payload.username, payload.password)
    set_session_cookie(response, raw_token)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}


@router.post("/auth/register", status_code=status.HTTP_202_ACCEPTED)
def auth_register(payload: RegisterRequest, request: Request, response: Response, background_tasks: BackgroundTasks):
    validate_request_origin(request)
    enforce_registration_rate_limit(request)
    verify_registration_challenge(request, payload.turnstile_token)
    try:
        if not account_email_config().enabled:
            if payload.password is None:
                raise HTTPException(status_code=422, detail="password_required")
            user = create_user(
                payload.username, payload.password, must_change_password=False,
                preferred_language=payload.preferred_language,
            )
            identity, raw_token = login(request, user.username, payload.password)
            set_session_cookie(response, raw_token)
            response.status_code = status.HTTP_201_CREATED
            response.headers["Cache-Control"] = "no-store"
            return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}
        _require_account_email()
        if payload.email is None:
            raise HTTPException(status_code=422, detail="email_required")
        normalized_email = normalize_email_address(payload.email)
        enforce_email_request_rate_limit(request, "registration", normalized_email)
        result = begin_registration(
            username=payload.username,
            email=payload.email,
            preferred_language=payload.preferred_language,
            delivery=lambda **message: background_tasks.add_task(send_account_email_safely, **message),
        )
    except (EmailDeliveryUnavailable, EmailDeliveryFailed) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="email_delivery_unavailable") from exc
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/auth/registration/inspect")
def auth_registration_inspect(payload: TokenInspectionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    response.headers["Cache-Control"] = "no-store"
    return inspect_registration(payload.token)


@router.post("/auth/registration/complete")
def auth_registration_complete(payload: RegistrationCompletionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    try:
        identity, raw_token = complete_registration(raw_token=payload.token, password=payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    set_session_cookie(response, raw_token)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "user": auth_identity_payload(identity, include_csrf=True)}


@router.post("/auth/password-reset", status_code=status.HTTP_202_ACCEPTED)
def auth_password_reset_request(payload: PasswordResetRequest, request: Request, response: Response, background_tasks: BackgroundTasks):
    validate_request_origin(request)
    if not account_email_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="email_delivery_unavailable")
    try:
        normalized_email = normalize_email_address(payload.email)
    except ValueError:
        normalized_email = f"invalid:{payload.email.strip().casefold()}"
    enforce_email_request_rate_limit(request, "password_reset", normalized_email)
    # Lookup and provider latency happen only after the response has been sent,
    # for known and unknown addresses alike. No mailbox-presence timing oracle.
    background_tasks.add_task(begin_password_reset, email=payload.email, preferred_language=payload.preferred_language)
    response.headers["Cache-Control"] = "no-store"
    return {"accepted": True}


@router.post("/auth/password-reset/inspect")
def auth_password_reset_inspect(payload: TokenInspectionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    response.headers["Cache-Control"] = "no-store"
    return inspect_account_email_token(raw_token=payload.token, purpose="password_reset")


@router.post("/auth/password-reset/complete")
def auth_password_reset_complete(payload: PasswordResetCompletionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    try:
        complete_password_reset(raw_token=payload.token, password=payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    clear_session_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


@router.post("/auth/logout")
def auth_logout(request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    raw_token, _source = session_token_from_connection(request)
    logout(raw_token)
    clear_session_cookie(response)
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": False}


@router.post("/auth/change-password")
def auth_change_password(payload: PasswordChangeRequest, request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    change_password(identity, payload.current_password, payload.new_password)
    clear_session_cookie(response)
    return {"ok": True, "login_required": True}


@router.get("/auth/email")
def auth_email_status(request: Request, response: Response):
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    return account_email_status(identity.user_id)


@router.post("/auth/email", status_code=status.HTTP_202_ACCEPTED)
def auth_email_request(payload: AccountEmailRequest, request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    if not account_email_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="email_delivery_unavailable")
    try:
        normalized_email = normalize_email_address(payload.email)
        enforce_email_request_rate_limit(request, "email_verify", normalized_email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    password_key = enforce_login_rate_limit(request, f"email-change:{identity.user_id}")
    try:
        result = begin_email_verification(
            identity=identity,
            email=payload.email,
            current_password=payload.current_password,
        )
    except ValueError as exc:
        if str(exc) == "current_password_invalid":
            record_login_failure(password_key)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except (EmailDeliveryUnavailable, EmailDeliveryFailed) as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="email_delivery_unavailable") from exc
    clear_login_failures(password_key)
    response.headers["Cache-Control"] = "no-store"
    return result


@router.post("/auth/email/inspect")
def auth_email_inspect(payload: TokenInspectionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    response.headers["Cache-Control"] = "no-store"
    return inspect_account_email_token(raw_token=payload.token, purpose="email_verify")


@router.post("/auth/email/confirm")
def auth_email_confirm(payload: TokenInspectionRequest, request: Request, response: Response):
    validate_request_origin(request)
    _require_account_email()
    try:
        confirm_email(raw_token=payload.token)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return {"ok": True}


def _require_account_email() -> None:
    if not account_email_available():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="email_delivery_unavailable")


@router.put("/auth/preferences")
def auth_update_preferences(payload: UserPreferencesRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        language_changed = user.preferred_language != payload.preferred_language
        chat_settings_saved = payload.lobby_chat_popups is not None or payload.lobby_chat_enabled is not None
        user.announce_selection_mode = payload.announce_selection_mode
        user.auto_write_announced = payload.auto_write_announced
        user.mobile_row_quick_entry = payload.mobile_row_quick_entry
        user.haptic_feedback = payload.haptic_feedback
        user.keep_screen_awake = payload.keep_screen_awake
        if payload.lobby_chat_popups is not None:
            user.lobby_chat_popups = payload.lobby_chat_popups
        if payload.lobby_chat_enabled is not None:
            user.lobby_chat_enabled = payload.lobby_chat_enabled
        user.preferred_language = payload.preferred_language
        user.updated_at = utcnow()
        db.flush()
        result = {
            "preferences": {
                "announce_selection_mode": user.announce_selection_mode,
                "auto_write_announced": user.auto_write_announced,
                "mobile_row_quick_entry": user.mobile_row_quick_entry,
                "haptic_feedback": user.haptic_feedback,
                "keep_screen_awake": user.keep_screen_awake,
                "lobby_chat_popups": user.lobby_chat_popups,
                "lobby_chat_enabled": user.lobby_chat_enabled,
                "lobby_chat_muted": user.lobby_chat_muted,
                "lobby_chat_excluded": user.lobby_chat_excluded,
                "friend_activity_enabled": user.friend_activity_enabled,
                "game_invite_push_enabled": user.game_invite_push_enabled,
                "daily_reminder_push_enabled": user.daily_reminder_push_enabled,
                "preferred_language": user.preferred_language,
            }
        }
    record_engagement_safely(identity.user_id, "settings_saved")
    if chat_settings_saved:
        record_engagement_safely(identity.user_id, "chat_settings_saved")
    if language_changed:
        record_engagement_safely(identity.user_id, "language_changed")
    return result


@router.post("/auth/change-username")
def auth_change_username(payload: UsernameChangeRequest, request: Request, response: Response):
    identity = require_user(request)
    require_csrf(request, identity)
    try:
        change_username(identity, payload.username, payload.current_password, request)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return {"authenticated": True, "user": auth_identity_payload(require_user(request), include_csrf=True)}


@router.put("/auth/preferences/language")
def auth_update_language(payload: LanguagePreferenceRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        language_changed = user.preferred_language != payload.preferred_language
        user.preferred_language = payload.preferred_language
        user.updated_at = utcnow()
        db.flush()
        result = {"preferred_language": user.preferred_language}
    if language_changed:
        record_engagement_safely(identity.user_id, "language_changed")
    return result


@router.put("/auth/preferences/lobby-chat")
def auth_update_lobby_chat_preference(payload: LobbyChatPreferenceRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    with session_scope() as db:
        user = db.get(User, identity.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        if payload.lobby_chat_popups is not None:
            user.lobby_chat_popups = payload.lobby_chat_popups
        if payload.lobby_chat_enabled is not None:
            user.lobby_chat_enabled = payload.lobby_chat_enabled
        user.updated_at = utcnow()
        db.flush()
        result = {
            "lobby_chat_popups": user.lobby_chat_popups,
            "lobby_chat_enabled": user.lobby_chat_enabled,
        }
    record_engagement_safely(identity.user_id, "settings_saved")
    record_engagement_safely(identity.user_id, "chat_settings_saved")
    return result


@router.get("/web-push/subscription")
def web_push_subscription_get(request: Request, response: Response):
    identity = require_user(request)
    response.headers["Cache-Control"] = "no-store"
    return web_push_subscription_status(identity.user_id)


@router.put("/web-push/subscription")
def web_push_subscription_put(payload: WebPushSubscriptionRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    try:
        result = save_web_push_subscription(
            user_id=identity.user_id,
            payload=payload,
            product_context="zilch" if is_zilch_host(request) else "zdwa",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    record_engagement_safely(identity.user_id, "settings_saved")
    record_engagement_safely(identity.user_id, "push_settings_viewed")
    return result


@router.delete("/web-push/subscription")
def web_push_subscription_delete(request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    try:
        result = remove_web_push_subscriptions(identity.user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    record_engagement_safely(identity.user_id, "settings_saved")
    record_engagement_safely(identity.user_id, "push_settings_viewed")
    return result


@router.post("/web-push/opt-in-prompt")
def web_push_opt_in_prompt_post(request: Request, response: Response):
    """Claim the gentle lobby prompt; browser permission remains client-side."""
    identity = require_user(request)
    require_csrf(request, identity)
    response.headers["Cache-Control"] = "no-store"
    try:
        return claim_web_push_opt_in_prompt(identity.user_id)
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc


@router.put("/web-push/preferences")
def web_push_preferences_put(payload: WebPushPreferencesRequest, request: Request):
    identity = require_user(request)
    require_csrf(request, identity)
    try:
        result = update_web_push_preferences(identity.user_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    record_engagement_safely(identity.user_id, "settings_saved")
    record_engagement_safely(identity.user_id, "push_settings_viewed")
    return result


@router.get("/admin/users")
def admin_list_users(request: Request, query: str = "", limit: int = 100, offset: int = 0):
    require_admin(request)
    limit = min(max(limit, 1), 200)
    offset = max(offset, 0)
    with session_scope() as db:
        stmt = select(User)
        if query.strip():
            stmt = stmt.where(User.username_normalized.contains(query.strip().casefold()))
        users = list(db.scalars(stmt.order_by(User.username_normalized).offset(offset).limit(limit)))
        ranks = achievement_rank_payloads_for_user_ids(db, {user.id for user in users})
        return {
            "users": [_user_payload(user, achievement_rank=ranks.get(user.id)) for user in users],
            "limit": limit,
            "offset": offset,
        }


@router.post("/admin/users", status_code=status.HTTP_201_CREATED)
def admin_create_user(payload: AdminUserCreateRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    try:
        user = create_user(
            payload.username,
            payload.temporary_password,
            role=payload.role,
            must_change_password=True,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"user": _user_payload(user, achievement_rank=public_achievement_ranks({user.id}).get(user.id))}


@router.post("/admin/users/{user_id}/reset-password")
def admin_reset_password(user_id: int, payload: AdminPasswordResetRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    try:
        reset_password(user_id, payload.temporary_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found") from exc
    return {"ok": True}


@router.patch("/admin/users/{user_id}")
def admin_update_user(user_id: int, payload: AdminUserUpdateRequest, request: Request):
    identity = require_admin(request)
    require_csrf(request, identity)
    if (
        payload.role is None
        and payload.is_active is None
        and payload.lobby_chat_muted is None
        and payload.lobby_chat_excluded is None
    ):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="no_changes")

    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="user_not_found")
        removes_admin = user.role == "admin" and (payload.role == "user" or payload.is_active is False)
        if removes_admin:
            active_admins = int(
                db.scalar(select(func.count()).select_from(User).where(User.role == "admin", User.is_active.is_(True)))
                or 0
            )
            if active_admins <= 1:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="last_admin_required")
        if payload.role is not None:
            user.role = payload.role
        if payload.is_active is not None:
            user.is_active = payload.is_active
        if payload.lobby_chat_muted is not None:
            user.lobby_chat_muted = payload.lobby_chat_muted
        if payload.lobby_chat_excluded is not None:
            user.lobby_chat_excluded = payload.lobby_chat_excluded
        user.updated_at = utcnow()
        # Chat moderation is enforced on every chat event and does not need to
        # throw the player out of an otherwise active game. Role/account-state
        # changes retain the existing session invalidation boundary.
        if payload.role is not None or payload.is_active is not None:
            db.execute(delete(LoginSession).where(LoginSession.user_id == user.id))
        db.flush()
        rank = achievement_rank_payloads_for_user_ids(db, {user.id}).get(user.id)
        return {"user": _user_payload(user, achievement_rank=rank)}
