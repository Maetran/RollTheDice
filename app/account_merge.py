"""Owner-controlled atomic account consolidation; no production side effects.

Historical seats are immutable. Game adapters validate their own evidence and
only the progress-owner relation changes. Preview uses the same transaction
path with an unconditional rollback and performs no transport/delivery work.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import date, datetime

from fastapi import HTTPException
from sqlalchemy import or_, select

from .account_merge_backings import MergeContext
from .account_progress import ProgressIdentityError, lock_account_rows
from .auth import lock_current_account_session, require_account_reauthentication
from .models import (
    AccountMergeGameResolution,
    AccountMergeOperation,
    AccountProgressOrigin,
    ActiveGame,
    Base,
    CompletedGame,
    GameAccountMembership,
    GameParticipant,
    HausdeppRematch,
    HausdeppRematchInvitation,
    User,
    WattenPersonalInvitation,
)
from .ownership import ownership_flags, require_owner
from .security import utcnow

POLICY_VERSION = 1
MAX_SUMMARY_BYTES = 262144


def _game_hooks():
    from .dice_merge_achievements import (
        consolidate_zdwa_merge_in_session,
        consolidate_zilch_merge_in_session,
        prepare_zdwa_merge_in_session,
        prepare_zilch_merge_in_session,
    )
    from .hausdepp_merge import consolidate_hausdepp_merge_in_session, prepare_hausdepp_merge_in_session
    from .watten_merge import consolidate_watten_merge_in_session, prepare_watten_merge_in_session

    return (
        ("zdwa", prepare_zdwa_merge_in_session, consolidate_zdwa_merge_in_session),
        ("zilch", prepare_zilch_merge_in_session, consolidate_zilch_merge_in_session),
        ("hausdepp", prepare_hausdepp_merge_in_session, consolidate_hausdepp_merge_in_session),
        ("watten", prepare_watten_merge_in_session, consolidate_watten_merge_in_session),
    )


def _json_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.hex()
    raise TypeError(f"Unsupported merge fingerprint value: {type(value).__name__}")


def _encoded(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=_json_value)


def _origins(db, owner_id: int) -> tuple[int, ...]:
    # This snapshot deliberately does not redirect/reject a retired source:
    # an idempotent replay is rechecked under locks before normal preflight.
    return tuple(sorted({owner_id, *db.scalars(select(AccountProgressOrigin.origin_user_id).where(
        AccountProgressOrigin.owner_user_id == owner_id,
    ))}))


def _lock_operation_accounts(db, actor_id: int, source_id: int, target_id: int):
    if source_id == target_id:
        raise ProgressIdentityError("merge_same_account")
    source_origins, target_origins = _origins(db, source_id), _origins(db, target_id)
    users = lock_account_rows(db, {*source_origins, *target_origins, actor_id})
    require_owner(db, actor_id)
    if source_origins != _origins(db, source_id) or target_origins != _origins(db, target_id):
        raise ProgressIdentityError("merge_source_changed")
    return users, source_origins, target_origins


def _active_checkpoint_accounts(raw: str) -> set[int]:
    try:
        state = json.loads(raw)
        if not isinstance(state, dict):
            raise ValueError("invalid_checkpoint")
        result = set()
        if state.get("_game_type") == "watten" or "_watten" in state:
            room = state["_watten"]["room"]
            values = [*room["members"], *room["reservations"]]
            for value in values:
                account = value.get("account_id")
                if type(account) is not int or account < 1:
                    raise ValueError("invalid_checkpoint_account")
                result.add(account)
        else:
            for name in ("_players", "_participants"):
                values = state.get(name, [])
                if not isinstance(values, list):
                    raise ValueError("invalid_checkpoint_players")
                for player in values:
                    account = player.get("user_id")
                    if account is not None:
                        if type(account) is not int or account < 1:
                            raise ValueError("invalid_checkpoint_account")
                        result.add(account)
            for name in ("_hausdepp_host_user_id", "_zilch_cpu_host_user_id", "_zilch_solo_host_user_id"):
                if type(state.get(name)) is int and state[name] > 0:
                    result.add(state[name])
        return result
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        # Unknown recovery state must not silently authorize a merge. This is
        # the legacy backfill boundary as well as a corruption safety check.
        raise ProgressIdentityError("merge_recovery_state_unknown") from exc


def ensure_no_pending_games(db, origin_ids: tuple[int, ...]) -> None:
    wanted = set(origin_ids)
    if db.scalar(select(GameAccountMembership.game_id).where(GameAccountMembership.user_id.in_(wanted)).limit(1)):
        raise ProgressIdentityError("merge_account_at_table")
    for raw in db.scalars(select(ActiveGame.state_json)):
        if wanted & _active_checkpoint_accounts(raw):
            raise ProgressIdentityError("merge_account_at_table")
    pending_hd = select(HausdeppRematchInvitation.id).join(
        HausdeppRematch, HausdeppRematch.id == HausdeppRematchInvitation.rematch_id,
    ).where(HausdeppRematchInvitation.user_id.in_(wanted), HausdeppRematch.expires_at > utcnow(),
            HausdeppRematchInvitation.status.in_(("pending", "accepted")))
    pending_watten = select(WattenPersonalInvitation.id).where(
        WattenPersonalInvitation.recipient_user_id.in_(wanted),
        WattenPersonalInvitation.expires_at > utcnow(), WattenPersonalInvitation.status.in_(("pending", "accepted")),
    )
    if db.scalar(pending_hd.limit(1)) or db.scalar(pending_watten.limit(1)):
        raise ProgressIdentityError("merge_pending_invitation")


def _preflight(db, source: User, target: User, origin_ids: tuple[int, ...]) -> None:
    if db.get(AccountProgressOrigin, source.id) or db.get(AccountProgressOrigin, target.id):
        raise ProgressIdentityError("merge_account_already_retired")
    if not target.is_active:
        raise ProgressIdentityError("merge_target_inactive")
    if source.role != "user" or ownership_flags(db, source.id)["is_owner"]:
        raise ProgressIdentityError("merge_source_staff_protected")
    ensure_no_pending_games(db, origin_ids)


def source_fingerprint(db, origin_ids: tuple[int, ...]) -> str:
    """Hash current source data; never persist or return private row payloads.

    Include persistent user relations plus full original completed games and
    their other participants. Sessions and transient authentication ceremonies
    are excluded: requesting the required passkey confirmation must not stale
    a preview when the actor is also the target. Actual credentials, the exact
    actor session and the action-bound proof are independently checked on apply.
    """
    payload = {}
    for table in Base.metadata.sorted_tables:
        if table.name in {"sessions", "webauthn_ceremonies", "active_games", "game_account_memberships"}:
            continue
        columns = [column for column in table.columns if any(fk.target_fullname == "users.id" for fk in column.foreign_keys)]
        if table.name == "users":
            columns = [table.c.id]
        if not columns:
            continue
        rows = db.execute(select(table).where(or_(*(column.in_(origin_ids) for column in columns)))).mappings()
        payload[table.name] = sorted((_encoded(dict(row)) for row in rows))
    game_ids = select(GameParticipant.game_id).where(GameParticipant.user_id.in_(origin_ids))
    for model, predicate in ((CompletedGame, CompletedGame.id.in_(game_ids)), (GameParticipant, GameParticipant.game_id.in_(game_ids))):
        payload[model.__tablename__] = sorted(_encoded(dict(row)) for row in db.execute(
            select(model.__table__).where(predicate),
        ).mappings())
    return hashlib.sha256(_encoded(payload).encode("utf-8")).hexdigest()


def _store_resolutions(db, context: MergeContext, game_type: str, values: list[dict]) -> None:
    for value in values:
        if value["game_type"] != game_type or value["origin_user_id"] not in context.origin_ids:
            raise ProgressIdentityError("merge_invalid_result_resolution")
        key = (context.target_user_id, game_type, value["game_id"])
        row = db.get(AccountMergeGameResolution, key)
        if row is None:
            row = AccountMergeGameResolution(owner_user_id=context.target_user_id, game_type=game_type, game_id=value["game_id"])
            db.add(row)
        for field in ("origin_user_id", "participant_id", "player_key", "source_fingerprint"):
            setattr(row, field, value[field])
        row.operation_id, row.policy_version = context.operation_id, context.policy_version


def _consolidate(db, context: MergeContext, *, actor_id: int, key: str, fingerprint: str) -> AccountMergeOperation:
    from .account_merge_identity import retire_source_identity_in_session

    operation = AccountMergeOperation(id=context.operation_id, actor_user_id=actor_id,
                                     source_user_id=context.source_user_id, target_user_id=context.target_user_id,
                                     idempotency_key=key, preview_fingerprint=fingerprint, policy_version=POLICY_VERSION,
                                     created_at=context.created_at, summary_json="{}")
    db.add(operation)
    db.flush()
    hooks = _game_hooks()
    prepared = {game: prepare(db, context) for game, prepare, _ in hooks}
    for origin in context.origin_ids:
        if origin == context.target_user_id:
            continue
        row = db.get(AccountProgressOrigin, origin)
        if row is None:
            row = AccountProgressOrigin(origin_user_id=origin, owner_user_id=context.target_user_id, operation_id=context.operation_id)
            db.add(row)
        else:
            row.owner_user_id, row.operation_id = context.target_user_id, context.operation_id
    db.flush()
    identity = retire_source_identity_in_session(db, db.get(User, context.source_user_id), db.get(User, context.target_user_id),
                                                operation_id=context.operation_id, now=context.created_at)
    games = {}
    for game, _, consolidate in hooks:
        summary = dict(consolidate(db, context, prepared[game]))
        _store_resolutions(db, context, game, summary.pop("resolutions", []))
        games[game] = summary
    summary = {"schema_version": 1, "games": games, "game_context": prepared, "identity": identity}
    encoded = _encoded(summary)
    if len(encoded.encode("utf-8")) > MAX_SUMMARY_BYTES:
        raise ProgressIdentityError("merge_summary_too_large")
    operation.summary_json = encoded
    db.flush()
    return operation


def public_operation(operation: AccountMergeOperation) -> dict:
    stored = json.loads(operation.summary_json)
    return {"operation_id": operation.id, "target_user_id": operation.target_user_id,
            "created_at": operation.created_at.isoformat(), "acknowledged": operation.acknowledged_at is not None,
            "games": {game: summary.get("public", {}) for game, summary in stored.get("games", {}).items()}}


def preview_merge_in_session(db, *, actor_id: int, source_id: int, target_id: int) -> dict:
    """Simulate inside a savepoint which is always rolled back before return."""
    users, source_origins, target_origins = _lock_operation_accounts(db, actor_id, source_id, target_id)
    origins = tuple(sorted(set(source_origins) | set(target_origins)))
    _preflight(db, users[source_id], users[target_id], origins)
    fingerprint = source_fingerprint(db, origins)
    context = MergeContext(uuid.uuid4().hex, source_id, target_id, source_origins, target_origins, utcnow())
    with db.begin_nested() as simulation:
        operation = _consolidate(db, context, actor_id=actor_id, key="preview-" + uuid.uuid4().hex, fingerprint=fingerprint)
        result = {"fingerprint": fingerprint, "source": {"id": source_id, "username": users[source_id].username},
                  "target": {"id": target_id, "username": users[target_id].username}, **public_operation(operation)}
        simulation.rollback()
    return result


def apply_merge_in_session(db, *, identity, request, source_id: int, target_id: int, fingerprint: str,
                           idempotency_key: str, current_password=None, passkey=None) -> dict:
    users, source_origins, target_origins = _lock_operation_accounts(db, identity.user_id, source_id, target_id)
    lock_current_account_session(db, identity)
    existing = db.scalar(select(AccountMergeOperation).where(AccountMergeOperation.idempotency_key == idempotency_key))
    if existing is not None:
        if (existing.actor_user_id, existing.source_user_id, existing.target_user_id, existing.preview_fingerprint) != (
                identity.user_id, source_id, target_id, fingerprint):
            raise ProgressIdentityError("merge_idempotency_conflict")
        return {**public_operation(existing), "replayed": True}
    origins = tuple(sorted(set(source_origins) | set(target_origins)))
    _preflight(db, users[source_id], users[target_id], origins)
    if source_fingerprint(db, origins) != fingerprint:
        raise ProgressIdentityError("merge_preview_stale")
    require_account_reauthentication(db, identity, current_password, passkey=passkey, request=request,
                                     action="merge_accounts", target=f"{source_id}:{target_id}:{fingerprint}")
    context = MergeContext(uuid.uuid4().hex, source_id, target_id, source_origins, target_origins, utcnow())
    return {**public_operation(_consolidate(db, context, actor_id=identity.user_id, key=idempotency_key, fingerprint=fingerprint)),
            "replayed": False}


def acknowledge_merge_in_session(db, *, identity, operation_id: str) -> dict:
    user = lock_account_rows(db, [identity.user_id])[identity.user_id]
    lock_current_account_session(db, identity)
    operation = db.get(AccountMergeOperation, operation_id)
    if not user.is_active or operation is None or operation.target_user_id != identity.user_id:
        raise HTTPException(status_code=404, detail="merge_operation_not_found")
    if operation.acknowledged_at is None:
        operation.acknowledged_at = utcnow()
    return {"acknowledged": True, "operation_id": operation.id}
