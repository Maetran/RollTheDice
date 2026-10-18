"""Local draft progress in the same native result/checkpoint transaction.

Exactly one match is processed per native persistence transaction. The writer's
result-v1 remains unchanged; no grants are issued by account/history reads.
The draft policy is a calibration proposal behind the closed game preview.
"""

from sqlalchemy import select

from .models import CompletedGame, GameParticipant
from .security import as_utc
from .watten_evidence import ProjectedBinding
from .watten_match_evidence import terminal_evidence
from .watten_progression_store import store_draft_match


def store_completion_progress(db, game: dict):
    """Flush only; the caller owns rollback and the terminal checkpoint commit."""
    db.flush()
    row = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game["_id"]))
    if row is None or row.game_type != "watten":
        raise ValueError("watten_result_missing")
    evidence = terminal_evidence(game, finished_at=as_utc(row.finished_at))
    bindings = tuple(ProjectedBinding(row.game_id, seat.position, seat.player_key, seat.display_name,
                                      seat.user_id, seat.points, seat.team) for seat in db.scalars(
        select(GameParticipant).where(GameParticipant.game_id == row.id).order_by(GameParticipant.position)))
    return store_draft_match(db, row, evidence, bindings)
