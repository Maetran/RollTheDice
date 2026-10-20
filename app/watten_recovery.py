"""Recover owned terminal/waiting checkpoints after in-memory retirement."""

import json
import re

from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .game_state import games
from .models import ActiveGame, CompletedGame, GameParticipant
from .security import utcnow


def restore_owned_watten_game(game_id: str, user_id: int):
    """Read only; a restored source retains its one durable follow-up link.

    Completed-result membership precedes checkpoint decoding. Waiting/closed
    rooms instead authorize their strictly decoded member/reservation binding.
    This never resumes a running match or grants progress.
    """
    if (type(game_id) is not str or not re.fullmatch(r"[0-9a-f]{16}", game_id)
            or type(user_id) is not int or user_id < 1 or not database_schema_ready()):
        return None
    current = games.get(game_id)
    if current is not None:
        return current if current.get("_game_type") == "watten" else None
    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game_id))
        if raw is None:
            return None
        completed = db.execute(select(CompletedGame.id, CompletedGame.game_type).where(CompletedGame.game_id == game_id)).first()
        if completed is not None:
            if completed.game_type != "watten" or db.scalar(select(GameParticipant.id).where(
                    GameParticipant.game_id == completed.id, GameParticipant.user_id == user_id).limit(1)) is None:
                return None
    try:
        signature = json.loads(raw)
    except (ValueError, TypeError):
        if completed is not None:
            raise ValueError("watten_storage_invalid_json") from None
        return None
    if not isinstance(signature, dict) or not (signature.get("_game_type") == "watten" or "_watten" in signature):
        if completed is not None:
            raise ValueError("watten_storage_invalid_signature")
        return None
    from .watten_runtime import restore_watten_json

    game = restore_watten_json(raw)
    if game["_id"] != game_id:
        raise ValueError("watten_storage_context_mismatch")
    room = game["_watten"].room
    if room.status not in {"waiting", "finished", "closed"}:
        return None
    own = any(member.account_id == user_id for member in room.members)
    reserved = any(item.account_id == user_id and item.expires_at > utcnow() for item in room.reservations)
    continued = room.series is not None and room.series.roster_locked and room.series.seat_for_account(user_id) is not None
    if not own and not reserved and not continued:
        from .watten_invitations import accepted_invitation_access

        if not accepted_invitation_access(game, user_id):
            return None
    return games.setdefault(game_id, game)
