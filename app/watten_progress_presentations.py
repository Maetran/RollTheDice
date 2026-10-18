"""Read-only presentation of earned progress; acknowledgement remains explicit."""

from copy import deepcopy

from .database import session_scope
from .watten_progression_receipts import read_match_presentation_boundaries


def apply_match_receipts(account, *, user_id):
    """Hide only already presented own-match items, retaining the global cursor."""
    result = deepcopy(account)
    progress = result["progress"]
    pending = progress["pending"]
    ids = {item["game_id"] for item in pending["credits"]}
    ids.update(item["source_game_id"] for item in pending["achievements"])
    if not ids:
        return result
    with session_scope() as db:
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
    progress = account["progress"]
    if progress["grant_sequence"] == 0:
        raise ValueError("watten_presentation_not_found")
    # Check membership even when a global acknowledgement hid all pending items.
    with session_scope() as db:
        boundaries = read_match_presentation_boundaries(
            db, user_id=user_id, generation=progress["generation"], game_ids=(game_id,))
    if game_id not in boundaries:
        raise ValueError("watten_presentation_not_found")
    boundary = boundaries[game_id]
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
