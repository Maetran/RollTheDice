"""Account-bound opt-in rematches. No push, guest identity or implicit seats."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from collections.abc import Callable
from contextlib import contextmanager
from datetime import datetime, timedelta

from pwdlib import PasswordHash
from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.websockets import WebSocketDisconnect

from .active_games import serializable_game_state
from .database import session_scope
from .game_state import GAME_TIMEOUT, check_timeout_and_abort, games
from .game_types import HAUSDEPP_GAME_TYPE, game_type_from_state
from .hausdepp_achievements import _insert_once
from .models import ActiveGame, HausdeppRematch, HausdeppRematchInvitation, HausdeppRematchSource, User
from .moderation import active_bans
from .security import as_utc, utcnow

logger = logging.getLogger(__name__)
INVITATION_SECONDS = 15 * 60
_LOCK = threading.RLock()
_ROOM_HASH = PasswordHash.recommended()


class RematchError(ValueError):
    def __init__(self, code: str, status: int = 409):
        super().__init__(code)
        self.status = status


def retain_rematch_source(game: dict) -> bool:
    """Keep terminal recreation possible after transient room/socket cleanup."""
    if game_type_from_state(game) != HAUSDEPP_GAME_TYPE:
        return True
    tournament = game.get("_hausdepp_tournament")
    if not game.get("_aborted") and (not game.get("_finished") or (tournament and not tournament.get("completed"))):
        return True
    ids = {person["user_id"] for person in game.get("_participants", [])
           if not person.get("is_cpu") and type(person.get("user_id")) is int and person["user_id"] > 0
           and person.get("id") not in game.get("_hausdepp_departures", {})}
    if not ids:
        return True
    try:
        with _LOCK, session_scope() as db:
            if db.get(HausdeppRematchSource, game["_id"]):
                return True
            code = game.get("_passphrase")
            # The retained recipe has no reusable plaintext secret. Subsequent
            # rematches reuse the salted verifier, never hash it a second time.
            verifier = {"hausdepp_hash": _ROOM_HASH.hash(code)} if isinstance(code, str) and code else code
            remaining_count = sum(person.get("id") not in game.get("_hausdepp_departures", {})
                                  for person in game.get("_participants", []))
            mode = str(max(2, remaining_count)) if game.get("_hausdepp_departures") else game["_mode"]
            settings = {"_name": game["_name"], "_mode": mode,
                        "_hausdepp_cpu_count": game.get("_hausdepp_cpu_count", 0),
                        "_hausdepp_tournament_enabled": bool(game.get("_hausdepp_tournament_enabled") or tournament),
                        "_voice_enabled": game.get("_voice_enabled", True) is True,
                        "_hausdepp_four_of_a_kind_as_ten": game.get("_hausdepp_four_of_a_kind_as_ten", False) is True,
                        "_passphrase": verifier}
            if game.get("_hausdepp_voice_room_id"):
                settings["_hausdepp_voice_room_id"] = game["_hausdepp_voice_room_id"]
                settings["_hausdepp_voice_allowed_user_ids"] = sorted(ids)
            _insert_once(db, HausdeppRematchSource, {
                "game_id": game["_id"], "original_user_ids_json": json.dumps(sorted(ids)),
                "settings_json": json.dumps(settings), "created_at": utcnow(),
            })
        return True
    except SQLAlchemyError:
        logger.exception("Could not retain Hausdepp rematch recipe %s", game.get("_id"))
        return False


def _active_ids(db, ids: set[int]) -> set[int]:
    active = set(db.scalars(select(User.id).where(User.id.in_(ids), User.is_active.is_(True))))
    return {value for value in active if not active_bans(db, value, scope="play")}


def _waiting(game: dict | None) -> bool:
    return bool(game and not game.get("_started") and not game.get("_finished")
                and not game.get("_aborted") and game.get("_hausdepp") is None)


def _target(db, rematch) -> dict:
    game = games.get(rematch.game_id)
    if game is None:
        # Recover only this waiting target, not every active game's sockets.
        stored = db.scalar(select(ActiveGame).where(ActiveGame.game_id == rematch.game_id))
        if stored is not None:
            game = json.loads(stored.state_json)
            game["_last_activity"] = as_utc(datetime.fromisoformat(game["_last_activity"]))
            if (game.get("_hausdepp_rematch_id") != rematch.id or game_type_from_state(game) != HAUSDEPP_GAME_TYPE):
                raise RematchError("hausdepp_rematch_closed")
            from .game_lifecycle import bind_room

            game["_id"] = rematch.game_id
            bind_room(game, rematch.game_id, stored.admission_revision)
            games[rematch.game_id] = game
    if game is None:
        raise RematchError("hausdepp_rematch_closed")
    check_timeout_and_abort(game)
    if game.get("_aborted") or (_waiting(game) and game.get("_hausdepp_host_user_id") not in _active_ids(
        db, {game.get("_hausdepp_host_user_id")},
    )):
        raise RematchError("hausdepp_rematch_closed")
    return game


def _seated_ids(game: dict) -> set[int]:
    return {player["user_id"] for player in game.get("_players", []) if type(player.get("user_id")) is int}


def _reservations(db, rematch, game: dict) -> set[int]:
    rows = db.scalars(select(HausdeppRematchInvitation).where(HausdeppRematchInvitation.rematch_id == rematch.id)).all()
    pending_valid = utcnow() < as_utc(rematch.expires_at)
    previously_joined = set(game.get("_hausdepp_rematch_joined_ids", []))
    reserved = {row.user_id for row in rows if (row.status == "accepted" and row.user_id not in previously_joined)
                or (row.status == "pending" and pending_valid)}
    return _active_ids(db, reserved) - _seated_ids(game)


def validate_rematch_join(game: dict, user_id: int | None) -> None:
    rematch_id = game.get("_hausdepp_rematch_id")
    if not rematch_id:
        return
    with session_scope() as db:
        row = db.get(HausdeppRematch, rematch_id)
        if row is None or row.game_id != game.get("_id"):
            raise ValueError("hausdepp_rematch_closed")
        check_timeout_and_abort(game)
        if (not _waiting(game) or game.get("_hausdepp_host_user_id") not in _active_ids(
                db, {game.get("_hausdepp_host_user_id")})):
            raise ValueError("hausdepp_rematch_closed")
        if user_id not in _active_ids(db, {user_id}):
            raise ValueError("account_play_banned")
        if user_id in _seated_ids(game):
            raise ValueError("hausdepp_account_already_joined")
        invitation = db.scalar(select(HausdeppRematchInvitation).where(
            HausdeppRematchInvitation.rematch_id == row.id, HausdeppRematchInvitation.user_id == user_id))
        if invitation and invitation.status == "pending" and utcnow() < as_utc(row.expires_at):
            raise ValueError("hausdepp_invitation_accept_required")
        reserved = _reservations(db, row, game) - {user_id}
        # Once no other invitee is reserved, a waiting CPU may yield its seat.
        # Until then keep the human-seat limit: filling it auto-starts a legacy
        # rematch and must never strand an invited person behind a computer.
        capacity = game["_expected_connections"] if reserved else game["_expected"]
        free = capacity - len(game.get("_players", []))
        if free <= len(reserved):
            raise ValueError("hausdepp_rematch_reserved_seats")


@contextmanager
def rematch_join_guard(game: dict, user_id: int | None):
    """Keep invitation responses and seat admission atomic in this process."""
    if not game.get("_hausdepp_rematch_id"):
        yield
        return
    with _LOCK:
        validate_rematch_join(game, user_id)
        yield


@contextmanager
def rematch_waiting_guard(game: dict, action: str):
    """Host controls must not consume or skip an invited person's reservation."""
    if not game.get("_hausdepp_rematch_id"):
        yield
        return
    with _LOCK:
        if error := rematch_waiting_error(game, action):
            raise ValueError(error)
        yield


def rematch_waiting_error(game: dict, action: str) -> str | None:
    """The same reservation decision drives host affordances and admission."""
    rematch_id = game.get("_hausdepp_rematch_id")
    if not rematch_id:
        return None
    with _LOCK, session_scope() as db:
        row = db.get(HausdeppRematch, rematch_id)
        if row is None or row.game_id != game.get("_id") or not _waiting(game):
            return "hausdepp_rematch_closed"
        reserved = _reservations(db, row, game)
        free = game["_expected"] - len(game.get("_participants", []))
        if (action == "hausdepp_add_cpu" and free <= len(reserved)
                or action == "hausdepp_start_game" and reserved):
            return "hausdepp_rematch_reserved_seats"
    return None


def rematch_private_consent(game: dict, user_id: int | None) -> bool:
    rematch_id = game.get("_hausdepp_rematch_id")
    if not rematch_id or type(user_id) is not int:
        return False
    with session_scope() as db:
        return bool(db.scalar(select(HausdeppRematchInvitation.id).join(
            HausdeppRematch, HausdeppRematch.id == HausdeppRematchInvitation.rematch_id,
        ).where(HausdeppRematch.id == rematch_id, HausdeppRematch.game_id == game.get("_id"),
                HausdeppRematchInvitation.user_id == user_id, HausdeppRematchInvitation.status == "accepted")))


def _creation_response(db, rematch, user_id: int, created: bool) -> dict:
    if user_id not in json.loads(rematch.original_user_ids_json):
        raise RematchError("game_not_found", 404)
    game = _target(db, rematch)
    if not _waiting(game) and user_id not in _seated_ids(game):
        raise RematchError("hausdepp_rematch_closed")
    invitation = db.scalar(select(HausdeppRematchInvitation).where(
        HausdeppRematchInvitation.rematch_id == rematch.id, HausdeppRematchInvitation.user_id == user_id))
    return {"game_id": rematch.game_id, "source_game_id": rematch.source_game_id,
            "url": f"/hausdepp/spiel/{rematch.game_id}", "created": created,
            "requires_acceptance": bool(invitation and invitation.status != "accepted" and user_id not in _seated_ids(game)),
            "invitation_id": invitation.id if invitation else None}


def create_rematch(source_id: str, user_id: int, *, before_create: Callable | None = None) -> dict:
    from .hausdepp_state import configure_hausdepp_game, new_hausdepp_game

    with _LOCK:
        with session_scope() as db:
            existing = db.scalar(select(HausdeppRematch).where(HausdeppRematch.source_game_id == source_id))
            if existing:
                return _creation_response(db, existing, user_id, False)
        source = games.get(source_id)
        if source is None:
            with session_scope() as db:
                recipe = db.get(HausdeppRematchSource, source_id)
                if recipe is not None:
                    ids = set(json.loads(recipe.original_user_ids_json))
                    source = {**json.loads(recipe.settings_json), "_finished": True, "_game_type": HAUSDEPP_GAME_TYPE}
                else:
                    pending = db.execute(select(ActiveGame.state_json, ActiveGame.admission_revision)
                                         .where(ActiveGame.game_id == source_id)).first()
            if source is None:
                # A failed recipe write retains its old terminal ActiveGame.
                # Release the read transaction before retrying a writer.
                recovered = json.loads(pending[0]) if pending else None
                if (not isinstance(recovered, dict) or game_type_from_state(recovered) != HAUSDEPP_GAME_TYPE
                        or not recovered.get("_hausdepp_rematch_source_pending")):
                    raise RematchError("game_not_found", 404)
                from .game_lifecycle import bind_room

                # Only this exact stored revision may be updated or retired.
                recovered["_id"] = source_id
                bind_room(recovered, source_id, pending[1])
                ids = {person["user_id"] for person in recovered.get("_participants", [])
                       if not person.get("is_cpu") and type(person.get("user_id")) is int and person["user_id"] > 0
                       and person.get("id") not in recovered.get("_hausdepp_departures", {})}
                if user_id not in ids:
                    raise RematchError("game_not_found", 404)
                if not retain_rematch_source(recovered):
                    raise RematchError("hausdepp_rematch_unavailable", 503)
                from .active_games import save_active_game

                if recovered.get("_aborted") and not recovered.get("_abandonment_accounted"):
                    from .abandoned_games import persist_abandoned_game

                    accounting = persist_abandoned_game(recovered)
                    if accounting.succeeded or accounting.status == "skipped":
                        recovered["_abandonment_accounted"] = True
                save_active_game(recovered)
                with session_scope() as db:
                    recipe = db.get(HausdeppRematchSource, source_id)
                    source = {**json.loads(recipe.settings_json), "_finished": True, "_game_type": HAUSDEPP_GAME_TYPE}
        elif game_type_from_state(source) == HAUSDEPP_GAME_TYPE:
            ids = {player["user_id"] for player in source.get("_participants", [])
                   if not player.get("is_cpu") and type(player.get("user_id")) is int and player["user_id"] > 0
                   and player.get("id") not in source.get("_hausdepp_departures", {})}
        else:
            raise RematchError("game_not_found", 404)
        if user_id not in ids:
            raise RematchError("game_not_found", 404)
        tournament = source.get("_hausdepp_tournament")
        if not source.get("_aborted") and (not source.get("_finished") or (tournament and not tournament.get("completed"))):
            raise RematchError("hausdepp_rematch_not_finished")
        if before_create:
            before_create()
        game_id, rematch_id = uuid.uuid4().hex[:8], uuid.uuid4().hex
        mode = source["_mode"]
        if source.get("_hausdepp_departures"):
            mode = str(max(2, sum(person.get("id") not in source["_hausdepp_departures"]
                                  for person in source.get("_participants", []))))
        game = new_hausdepp_game(game_id, source["_name"], mode, register=False)
        configure_hausdepp_game(game, host_user_id=user_id, cpu_count=source.get("_hausdepp_cpu_count", 0),
                                tournament=bool(source.get("_hausdepp_tournament_enabled") or tournament),
                                voice_enabled=source.get("_voice_enabled", True) is True,
                                four_of_a_kind_as_ten=source.get("_hausdepp_four_of_a_kind_as_ten", False) is True)
        game["_passphrase"] = source.get("_passphrase")
        game["_hausdepp_rematch_id"] = rematch_id
        game["_hausdepp_rematch_joined_ids"] = []
        from .hausdepp_voice import carry_voice_room

        carry_voice_room(source, game, ids)
        now = utcnow()
        settings = {"mode": game["_mode"], "cpu_count": game["_hausdepp_cpu_count"],
                    "tournament": game["_hausdepp_tournament_enabled"], "locked": bool(game["_passphrase"]),
                    "four_of_a_kind_as_ten": game.get("_hausdepp_four_of_a_kind_as_ten", False) is True,
                    "name": game["_name"]}
        with session_scope() as db:
            from .hausdepp_features import HausdeppFeatureError, validate_checkpoint_features

            try:
                validate_checkpoint_features(db, game, creating=True)
            except HausdeppFeatureError as exc:
                raise RematchError(str(exc), 403) from exc
            if user_id not in _active_ids(db, {user_id}):
                raise RematchError("account_play_banned", 403)
            inserted = _insert_once(db, HausdeppRematch, {
                "id": rematch_id, "source_game_id": source_id, "game_id": game_id,
                "created_by_user_id": user_id, "original_user_ids_json": json.dumps(sorted(ids)),
                "settings_json": json.dumps(settings), "created_at": now,
                "expires_at": now + timedelta(seconds=INVITATION_SECONDS),
            })
            if not inserted:
                existing = db.scalar(select(HausdeppRematch).where(HausdeppRematch.source_game_id == source_id))
                rematch_id = existing.id
            else:
                db.add(ActiveGame(game_id=game_id, state_json=json.dumps(serializable_game_state(game)), created_at=now, updated_at=now))
                for recipient in _active_ids(db, ids):
                    db.add(HausdeppRematchInvitation(id=uuid.uuid4().hex, rematch_id=rematch_id, user_id=recipient,
                                                   status="accepted" if recipient == user_id else "pending",
                                                   responded_at=now if recipient == user_id else None))
        if not inserted:
            with session_scope() as db:
                return _creation_response(db, db.get(HausdeppRematch, rematch_id), user_id, False)
        from .game_lifecycle import bind_room

        # The row above was strictly inserted with the default revision 0.
        bind_room(game, game_id, 0)
        games[game_id] = game
        with session_scope() as db:
            return _creation_response(db, db.get(HausdeppRematch, rematch_id), user_id, True)


def _invitation_payload(db, invitation, rematch, game: dict) -> dict | None:
    sender = db.get(User, rematch.created_by_user_id)
    if sender is None or not sender.is_active:
        return None
    expires_at = as_utc(rematch.expires_at)
    if invitation.status == "accepted":
        expires_at = as_utc(datetime.fromisoformat(game["_hausdepp_waiting_last_join_at"])) + GAME_TIMEOUT
    return {"id": invitation.id, "game_id": rematch.game_id, "source_game_id": rematch.source_game_id,
            "url": f"/hausdepp/spiel/{rematch.game_id}",
            "status": invitation.status,
            "sender": {"id": sender.id, "username": sender.username}, "name": game["_name"],
            "players": int(game["_mode"]), "cpu_count": game["_hausdepp_cpu_count"],
            "tournament": bool(game.get("_hausdepp_tournament_enabled")), "locked": bool(game.get("_passphrase")),
            "four_of_a_kind_as_ten": game.get("_hausdepp_four_of_a_kind_as_ten", False) is True,
            "expires_at": expires_at.isoformat()}


def pending_invitations(user_id: int) -> dict:
    with _LOCK, session_scope() as db:
        if user_id not in _active_ids(db, {user_id}):
            return {"invitations": []}
        rows = db.execute(select(HausdeppRematchInvitation, HausdeppRematch).join(
            HausdeppRematch, HausdeppRematch.id == HausdeppRematchInvitation.rematch_id,
        ).where(HausdeppRematchInvitation.user_id == user_id, HausdeppRematch.created_by_user_id != user_id,
                or_(HausdeppRematchInvitation.status == "accepted",
                    (HausdeppRematchInvitation.status == "pending") & (HausdeppRematch.expires_at > utcnow())))
            .order_by(HausdeppRematch.created_at.desc()).limit(100)).all()
        invitations = []
        for invitation, rematch in rows:
            try:
                game = _target(db, rematch)
            except RematchError:
                continue
            if not _waiting(game):
                continue
            if user_id in game.get("_hausdepp_rematch_joined_ids", []):
                continue
            payload = _invitation_payload(db, invitation, rematch, game)
            if payload:
                invitations.append(payload)
            if len(invitations) == 20:
                break
        return {"invitations": invitations}


def respond_to_invitation(invitation_id: str, user_id: int, *, accept: bool) -> dict:
    with _LOCK, session_scope() as db:
        invitation = db.get(HausdeppRematchInvitation, invitation_id)
        if not invitation or invitation.user_id != user_id:
            raise RematchError("hausdepp_invitation_not_found", 404)
        if user_id not in _active_ids(db, {user_id}):
            raise RematchError("account_play_banned", 403)
        rematch = db.get(HausdeppRematch, invitation.rematch_id)
        game = _target(db, rematch)
        if not accept:
            if user_id in _seated_ids(game):
                raise RematchError("hausdepp_invitation_already_joined")
            if user_id == game.get("_hausdepp_host_user_id"):
                raise RematchError("hausdepp_rematch_closed")
            invitation.status = "declined"
            invitation.responded_at = utcnow()
            return {"ok": True}
        if invitation.status == "accepted" and user_id in _seated_ids(game):
            return {"game_id": rematch.game_id, "source_game_id": rematch.source_game_id,
                    "url": f"/hausdepp/spiel/{rematch.game_id}"}
        if not _waiting(game) or (invitation.status != "accepted" and utcnow() >= as_utc(rematch.expires_at)):
            raise RematchError("hausdepp_invitation_expired")
        reserved = _reservations(db, rematch, game) - {user_id}
        capacity = game["_expected_connections"] if reserved else game["_expected"]
        free = capacity - len(game.get("_players", []))
        if free <= len(reserved):
            raise RematchError("hausdepp_rematch_full")
        invitation.status = "accepted"
        invitation.responded_at = utcnow()
        return {"game_id": rematch.game_id, "source_game_id": rematch.source_game_id,
                "url": f"/hausdepp/spiel/{rematch.game_id}"}


async def deliver_rematch_invitations(source_id: str) -> None:
    """Best-effort targeted existing game sockets, with GET recovery elsewhere."""
    from .auth import resolve_session

    source = games.get(source_id) or {}
    for player in list(source.get("_players", [])):
        socket = player.get("ws")
        user_id = player.get("user_id")
        if socket is None or type(user_id) is not int:
            continue
        try:
            identity = resolve_session(socket)
            if not identity or identity.user_id != user_id:
                continue
            for invitation in pending_invitations(user_id)["invitations"]:
                with session_scope() as db:
                    rematch = db.scalar(select(HausdeppRematch).where(HausdeppRematch.game_id == invitation["game_id"]))
                    if rematch.source_game_id != source_id:
                        continue
                await asyncio.wait_for(socket.send_json({"hausdepp_invitation": invitation}), timeout=3)
        except (TimeoutError, RuntimeError, OSError, WebSocketDisconnect):
            logger.debug("Rematch recipient is no longer connected")
