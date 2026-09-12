"""Current display names for historic seats, resolved only through account IDs."""

from __future__ import annotations

from sqlalchemy import select

from .database import database_schema_ready, session_scope
from .models import CompletedGame, GameParticipant, User


def completed_player_identities(game_ids: set[str], *, game_type: str) -> dict[str, list[dict]]:
    if not game_ids or not database_schema_ready():
        return {}
    with session_scope() as db:
        rows = db.execute(
            select(CompletedGame.game_id, CompletedGame.imported_from_legacy, GameParticipant, User)
            .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
            .outerjoin(User, User.id == GameParticipant.user_id)
            .where(CompletedGame.game_type == game_type, CompletedGame.game_id.in_(game_ids))
            .order_by(GameParticipant.position)
        ).all()
        result: dict[str, list[dict]] = {}
        for game_id, imported, seat, user in rows:
            result.setdefault(game_id, []).append({
                "player_key": seat.player_key,
                "position": seat.position,
                "team": seat.team,
                "points": seat.points,
                "display_name": seat.display_name,
                "user_id": user.id if user else None,
                "username": user.username if user else None,
                "is_active": bool(user and user.is_active),
                "imported_from_legacy": imported,
            })
        return result


def current_account_names(user_ids) -> dict[int, str]:
    ids = {value for value in user_ids if type(value) is int and value > 0}
    if not ids or not database_schema_ready():
        return {}
    with session_scope() as db:
        return dict(db.execute(select(User.id, User.username).where(User.id.in_(ids))).all())


def project_completed_players(players: list[dict], identities: list[dict], *, zilch: bool = False) -> list[dict]:
    """Keep scores/history intact; never infer account ownership from a name."""
    by_key = {seat["player_key"]: seat for seat in identities}
    projected = []
    for player in players:
        item = dict(player)
        key = str(player.get("participant_id" if zilch else "id") or "")
        seat = by_key.get(key)
        # Relational assignments override stale IDs embedded in snapshots,
        # including explicitly unassigned legacy/guest participants.
        item["user_id"] = seat["user_id"] if seat else None
        if zilch:
            item["is_registered"] = bool(seat and seat["user_id"])
        if seat and seat["username"]:
            item["display_name" if zilch else "name"] = seat["username"]
            item["username"] = seat["username"]
        else:
            if not zilch:
                item.pop("username", None)
            item.pop("achievement_rank", None)
        projected.append(item)
    return projected
