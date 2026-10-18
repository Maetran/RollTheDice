"""Minimal typed Watten results, committed in the runtime checkpoint transaction.

No achievement, ranking or progression side effects are implied by a local
development match. Results retain only already-public scoring evidence.
"""

import json
from datetime import datetime, timezone

from sqlalchemy import select

from .models import CompletedGame, DeletedGame, GameParticipant, User
from .security import utcnow


def result_payload(game: dict) -> dict:
    runtime = game["_watten"]
    engine = runtime.engine
    if engine is None or engine.phase != "match_complete":
        raise ValueError("watten_match_not_finished")
    names = dict(runtime.names)
    return {
        "kind": "watten_result", "schema_version": 1, "game_type": "watten", "game_id": game["_id"],
        "match": {
            "target_points": engine.ledger.target,
            "scores": [{"members": list(item.members), "points": item.points} for item in engine.ledger.accounts],
            "winners": [list(members) for members in engine.ledger.winners],
            "deals": [{"deal_id": item.deal_id, "parties": [list(party) for party in item.roles.parties],
                       "winning_party": item.winning_party, "points": item.points, "reason": item.reason}
                      for item in engine.ledger.applied_results],
        },
        "participants": [{"id": binding.player_id, "name": names[binding.player_id],
                          "is_cpu": binding.account_id is None} for binding in engine.recipe.bindings],
    }


def store_result_in_session(db, game: dict) -> dict:
    """Use the caller's transaction: result and terminal checkpoint are atomic."""
    payload = result_payload(game)
    game_id = game["_id"]
    if db.scalar(select(DeletedGame.id).where(DeletedGame.game_id == game_id)) is not None:
        raise ValueError("watten_result_deleted")
    existing = db.scalar(select(CompletedGame).where(CompletedGame.game_id == game_id))
    if existing is not None:
        stored = json.loads(existing.snapshot_json)
        if existing.game_type != "watten" or stored != payload:
            raise ValueError("watten_result_conflict")
        game["_finished_at"] = existing.finished_at.replace(tzinfo=timezone.utc).isoformat() if existing.finished_at.tzinfo is None else existing.finished_at.isoformat()
        return stored
    finished = datetime.fromisoformat(game["_finished_at"])
    row = CompletedGame(game_id=game_id, game_type="watten", game_name=game["_name"], finished_at=finished,
                        mode=game["_mode"], hardcore=False, snapshot_json=json.dumps(payload, separators=(",", ":")),
                        imported_from_legacy=False, created_at=utcnow())
    db.add(row)
    db.flush()
    names = dict(game["_watten"].names)
    engine = game["_watten"].engine
    for position, binding in enumerate(engine.recipe.bindings):
        account = next(item for item in engine.ledger.accounts if binding.player_id in item.members)
        user_id = binding.account_id if binding.account_id is not None and db.get(User, binding.account_id) else None
        db.add(GameParticipant(game_id=row.id, position=position, player_key=binding.player_id,
                               display_name=names[binding.player_id], user_id=user_id,
                               team=str(engine.parties.party_of(binding.player_id)) if len(engine.recipe.seats) == 4 else None,
                               points=account.points))
    return payload
