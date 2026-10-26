"""Caller-transaction identity retirement; no external or realtime effects."""
from sqlalchemy import delete, func, select, update

from .account_progress import ProgressIdentityError, is_retired_merge_origin
from .auth import revoke_account_recovery_state
from .models import (
    AccountEmailToken,
    AccountOwnership,
    AccountProgressOrigin,
    AdminHelpRecipient,
    PasskeyCredential,
    PushReleaseRecipient,
    Session,
    User,
    UserBan,
    WebAuthnCeremony,
    WebPushSubscription,
)
from .security import PASSWORDLESS_HASH, as_utc

MAX_TRANSFERRED_BANS = 256


def retire_source_identity_in_session(db, source: User, target: User, *, operation_id: str, now) -> dict:
    """Retire already locked original identities after the ownership map write.

    The coordinator locks actual actor/source/target/origins in sorted order,
    validates authorization and creates the operation/map before calling this.
    Do not refresh these ORM objects: earlier intentional progress writes must
    remain in this same atomic transaction. Only current source restrictions
    transfer; retired ancestors are never replayed after an explicit unban.
    """
    if source.id == target.id or source.role != "user" or db.get(AccountOwnership, source.id) is not None:
        raise ProgressIdentityError("merge_identity_source_protected")
    if not target.is_active or is_retired_merge_origin(db, target.id):
        raise ProgressIdentityError("merge_identity_target_inactive")
    origin = db.get(AccountProgressOrigin, source.id)
    if origin is None or origin.owner_user_id != target.id or origin.operation_id != operation_id:
        raise ProgressIdentityError("merge_identity_origin_not_mapped")
    stamp = as_utc(now)
    bans = list(db.scalars(select(UserBan).where(
        UserBan.user_id == source.id, UserBan.revoked_at.is_(None),
        (UserBan.expires_at.is_(None)) | (UserBan.expires_at > stamp),
    ).order_by(UserBan.id).limit(MAX_TRANSFERRED_BANS + 1)))
    if len(bans) > MAX_TRANSFERRED_BANS:
        raise ProgressIdentityError("merge_identity_too_many_restrictions")
    source_flags = {key: bool(getattr(source, key)) for key in ("lobby_chat_muted", "lobby_chat_excluded")}
    if (bans or any(source_flags.values())) and (
        target.role != "user" or db.get(AccountOwnership, target.id) is not None
    ):
        raise ProgressIdentityError("merge_identity_restricted_target_protected")

    revoked = {name: int(db.scalar(select(func.count()).select_from(model).where(model.user_id == source.id)) or 0)
               for name, model in (("sessions", Session), ("passkeys", PasskeyCredential),
                                   ("email_tokens", AccountEmailToken), ("ceremonies", WebAuthnCeremony),
                                   ("push_devices", WebPushSubscription))}
    revoke_account_recovery_state(db, source.id, remove_passkeys=True)
    db.execute(delete(Session).where(Session.user_id == source.id))
    db.execute(delete(WebPushSubscription).where(WebPushSubscription.user_id == source.id))
    for name, model in (("release_snapshots", PushReleaseRecipient), ("help_snapshots", AdminHelpRecipient)):
        revoked[name] = db.execute(update(model).where(
            model.user_id == source.id, model.subscription_snapshot_json != "[]",
        ).values(subscription_snapshot_json="[]")).rowcount

    transferred = []
    for ban in bans:
        clone = UserBan(user_id=target.id, scope=ban.scope, reason=ban.reason, created_at=ban.created_at,
                        expires_at=ban.expires_at, created_by_user_id=ban.created_by_user_id,
                        help_request_id=ban.help_request_id)
        db.add(clone)
        db.flush()
        transferred.append({"source_ban_id": ban.id, "target_ban_id": clone.id})
    chat = {}
    for key, source_value in source_flags.items():
        before = bool(getattr(target, key))
        setattr(target, key, before or source_value)
        chat[key] = {"before": before, "source": source_value, "after": before or source_value}

    source.is_active = False
    source.password_hash = PASSWORDLESS_HASH
    source.email = source.email_normalized = source.email_confirmed_at = None
    source.webauthn_user_handle = None
    source.analytics_access = False
    source.updated_at = stamp
    db.flush()
    return {"revoked": revoked, "bans": transferred, "chat": chat}
