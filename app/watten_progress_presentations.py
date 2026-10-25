"""Read-only presentation of earned progress; acknowledgement remains explicit."""

from copy import deepcopy

from sqlalchemy import select

from .database import session_scope
from .models import CompletedGame, GameParticipant
from .watten_progression_receipts import read_match_presentation_boundaries


def apply_match_receipts(account, *, user_id):
    """Hide only already presented own-match items, retaining the global cursor."""
    if not account["progress"]["pending"]["credits"] and not account["progress"]["pending"]["achievements"]:
        return deepcopy(account)
    with session_scope() as db:
        return apply_match_receipts_in_session(db, account, user_id=user_id)


def apply_match_receipts_in_session(db, account, *, user_id):
    """Read match boundaries in the caller's transaction, never acknowledge."""
    result = deepcopy(account)
    progress = result["progress"]
    pending = progress["pending"]
    ids = {item["game_id"] for item in pending["credits"]}
    ids.update(item["source_game_id"] for item in pending["achievements"])
    if not ids:
        return result
    boundaries = read_match_presentation_boundaries(
        db, user_id=user_id, generation=progress["generation"], game_ids=ids)
    if set(boundaries) != ids:
        raise ValueError("watten_presentation_invalid_matches")
    pending["credits"] = [item for item in pending["credits"]
                          if item["sequence"] > boundaries[item["game_id"]]]
    pending["achievements"] = [item for item in pending["achievements"]
                               if item["sequence"] > boundaries[item["source_game_id"]]]
    return result


def match_presentation(account, *, user_id, game_id):
    """Only this match's unacknowledged credit/awards, never another match."""
    with session_scope() as db:
        return match_presentation_in_session(db, account, user_id=user_id, game_id=game_id)


def match_presentation_in_session(db, account, *, user_id, game_id):
    """Project this exact original match in the caller's transaction."""
    progress = account["progress"]
    # Check membership even when a global acknowledgement hid all pending items.
    boundaries = read_match_presentation_boundaries(
        db, user_id=user_id, generation=progress["generation"], game_ids=(game_id,)) if progress["grant_sequence"] else {}
    if game_id not in boundaries:
        # The account reader already validated all owned result sources.
        # Older legitimate results intentionally have no retrospective XP.
        owned = db.scalar(select(CompletedGame.id).join(GameParticipant,
            GameParticipant.game_id == CompletedGame.id).where(
                CompletedGame.game_id == game_id, CompletedGame.game_type == "watten",
                GameParticipant.user_id == user_id).limit(1))
        if owned is None:
            from .watten_merge import is_merged, selected_matches
            inherited = is_merged(db, user_id) and any(
                item.match.evidence.game_id == game_id for item in selected_matches(db, user_id))
            if not inherited:
                raise ValueError("watten_presentation_not_found")
    boundary = boundaries.get(game_id, 0)
    credit = next((item for item in progress["pending"]["credits"]
                   if item["game_id"] == game_id and item["sequence"] > boundary), None)
    awards = [item for item in progress["pending"]["achievements"]
              if item["source_game_id"] == game_id and item["sequence"] > boundary]
    known = {item["id"]: item["name"] for item in progress["achievements"] if item["unlocked"]}
    sequences = [item["sequence"] for item in awards]
    if credit:
        sequences.append(credit["sequence"])
    archived_name = {"de": "Gespeicherter Watten-Erfolg", "en": "Stored Watten achievement"}
    return {"schema_version": 1, "game_type": "watten", "status": "draft",
            "game_id": game_id, "generation": progress["generation"],
            "through_sequence": max(sequences, default=0),
            "credit": {"xp": credit["xp"], "outcome": credit["outcome"]} if credit else None,
            "achievements": [{"id": item["id"] if item["id"] in known else f"archived-{index}",
                              "name": known.get(item["id"], archived_name), "xp": item["xp"]}
                             for index, item in enumerate(awards)],
            "title": deepcopy(progress["title"])}
