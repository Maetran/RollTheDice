"""Native checkpoint membership shares the exact-account merge write fence."""
from __future__ import annotations

from sqlalchemy import delete, select, update

from .account_progress import lock_account_rows, require_exact_active_account
from .models import ActiveGame, GameAccountMembership


def continuation_accounts(room) -> frozenset[int]:
    """Original seats still needed by this series' current table.

    Completed matches are history. Once a fixed-roster follow-up is waiting
    or running, reservation expiry cannot replace its original humans.
    Explicit closure releases that obligation. The checkpoint's validated
    abort flag is handled by pending_native_room.
    """
    series = room.series
    if series is None or series.finished or room.status == "closed":
        return frozenset()
    if room.status not in {"waiting", "started"} or not series.roster_locked:
        return frozenset()
    return frozenset(int(token[2:]) for token in series.bindings if token.startswith("h:"))


def _bindings(room, now):
    result = {}
    for member in room.members:
        result.setdefault(member.account_id, []).append(("member", member.participant_id, member.seat, member.team))
    for reservation in room.reservations:
        if reservation.valid_at(now):
            result.setdefault(reservation.account_id, []).append(("reservation", reservation.seat, reservation.expires_at))
    for account in sorted(continuation_accounts(room)):
        result.setdefault(account, []).append(("series", room.series.series_id, room.series.seat_for_account(account)))
    return {key: tuple(values) for key, values in result.items()}


def pending_native_room(game):
    """A terminal, durably accounted table is history, not a pending seat."""
    room = game["_watten"].room
    return not (game.get("_aborted") or (room.status in {"closed", "finished"} and (
        not game.get("_started_at") or game.get("_completion_persisted"))))


def sync_checkpoint_memberships(db, checkpoint, previous_room, *, now):
    """Run after the winning game-row write, before its caller commits.

    Existing bindings can belong to a subsequently banned account. Only new
    or changed admission/reservation bindings require an active exact account;
    all present originals share ascending User write locks with account merge.
    No historical owner is ever substituted for the admitted identity.
    """
    game_id = checkpoint["_id"]
    if not pending_native_room(checkpoint):
        db.execute(delete(GameAccountMembership).where(GameAccountMembership.game_id == game_id))
        return
    current = _bindings(checkpoint["_watten"].room, now)
    old = _bindings(previous_room, now) if previous_room is not None else {}
    lock_account_rows(db, current)
    for account, binding in sorted(current.items()):
        if old.get(account) != binding:
            require_exact_active_account(db, account)
    if old != current:
        db.execute(update(ActiveGame).where(ActiveGame.game_id == game_id).values(
            admission_revision=ActiveGame.admission_revision + 1))
    revision = db.scalar(select(ActiveGame.admission_revision).where(ActiveGame.game_id == game_id))
    existing = set(db.scalars(select(GameAccountMembership.user_id).where(GameAccountMembership.game_id == game_id)))
    for account in sorted(current.keys() - existing):
        db.add(GameAccountMembership(game_id=game_id, user_id=account,
                                     admission_revision=revision, admitted_at=now))
    if removed := existing - current.keys():
        db.execute(delete(GameAccountMembership).where(GameAccountMembership.game_id == game_id,
                                                      GameAccountMembership.user_id.in_(removed)))
