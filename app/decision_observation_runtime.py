"""Build strictly seat-scoped decision records for the optional observer.

This module never serializes an engine, room, socket, account or participant
identifier. Recording is best effort; losing a record must never reject a move.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

_HAUSDEPP_ACTIONS = frozenset({"play", "pickup", "gamble", "afterthrow", "draw", "peek", "withdraw"})
_WATTEN_ACTIONS = frozenset({
    "announce_strike", "announce_colour", "show_ready", "inspection_ack", "play_card", "bid", "respond",
    "retourschneider", "partner_feedback", "request_bloedeln", "request_schoeneres", "request_schlagwechsel",
    "preplay_accept", "preplay_decline", "bloedeln_accept", "bloedeln_decline",
})


def _token(game: dict, round_number: int, policy_version: int) -> dict:
    """Allocate a random opaque per-round token and a monotonically increasing sequence."""
    from .observation import new_recording_id

    old = game.get("_decision_observation")
    if not isinstance(old, dict) or old.get("round") != round_number:
        old = {"id": new_recording_id(policy_version), "round": round_number, "sequence": 0,
               "policy_version": policy_version, "previous_ids": []}
    elif old.get("policy_version") != policy_version:
        previous = [*old["previous_ids"], old["id"]]
        if len(previous) > 64:
            raise ValueError("observation_too_many_policy_windows")
        old = {"id": new_recording_id(policy_version), "round": round_number, "sequence": 0,
               "policy_version": policy_version, "previous_ids": previous}
    current = {**old, "sequence": old["sequence"] + 1}
    game["_decision_observation"] = current
    return current


def policy_version_for(eligible_user_ids: tuple[int, ...]) -> int | None:
    """An off/unavailable policy means no token, hand projection or recording.

    This read is an optimization only. The writer rechecks the same version
    under the policy lock before storing anything.
    """
    try:
        from .database import database_schema_ready, session_scope
        from .observation import observation_may_record

        if not database_schema_ready():
            return None
        with session_scope() as db:
            return observation_may_record(db, eligible_user_ids)
    except Exception:
        return None


def _eligible_accounts(participants: list[dict]) -> tuple[int, ...]:
    return tuple(item["user_id"] for item in participants
                 if not item.get("is_cpu") and type(item.get("user_id")) is int and item["user_id"] > 0)


def _watten_trick(trick: dict | None) -> dict | None:
    if trick is None:
        return None
    result = {"cards": [{"seat": card["seat"], "card": card["card"]} for card in trick["cards"]]}
    if "winner" in trick:
        result["winner"] = trick["winner"]
    return result


def _watten_value(kind: str, value):
    from .watten_cards import WATTEN_NORMAL_RANKS, WATTEN_SUITS, make_deck
    from .watten_rules import WELI_STRIKE

    values = {"announce_strike": (*WATTEN_NORMAL_RANKS, WELI_STRIKE), "announce_colour": WATTEN_SUITS,
              "play_card": make_deck(), "respond": ("hold", "go", "counter"),
              "retourschneider": ("accept", "decline"), "partner_feedback": ("good", "bad", "unsure")}
    if kind in values:
        if type(value) is not str or value not in values[kind]:
            raise ValueError("invalid_observed_action")
        return value
    if value is not None:
        raise ValueError("invalid_observed_action")
    return None


def prepare_hausdepp(game: dict, before: dict, after: dict, player_id: str, command: dict,
                     *, policy_version: int) -> dict | None:
    """Project only what the actual actor could see before its accepted action."""
    from .hausdepp_engine import project_state

    kind = command.get("action")
    if kind not in _HAUSDEPP_ACTIONS:
        return None
    view = project_state(before, player_id)
    ids = {player["id"]: index for index, player in enumerate(view["players"])}
    actor = ids[player_id]
    participants = game["_participants"]
    seats = [{"seat": index, "kind": "cpu" if player["is_cpu"] else "human",
              "hand_count": player["hand_count"], "finished": player["finished"],
              "withdrawn": player["withdrawn"]} for index, player in enumerate(view["players"])]
    action = {"kind": kind}
    if kind in {"play", "afterthrow"}:
        action["cards"] = list(command["cards"])
    post_view = project_state(after, player_id)
    aftermath = after.get("last_event") or {}
    visible_event = {key: aftermath[key] for key in (
        "cards", "success", "picked_up_count", "drawn_count", "burn_reason", "burned_count",
    ) if key in aftermath}
    afterthrow = view["afterthrow"]
    context = {"schema_version": 1, "ruleset_version": view["ruleset_version"], "phase": view["phase"],
               "actor_hand": view["hand"], "discard": view["discard"], "deck_count": view["deck_count"],
               "available_actions": view["available_actions"], "playable_cards": view["playable_cards"],
               "playable_groups": view["playable_groups"], "seats": seats,
               "four_of_a_kind_as_ten": view["four_of_a_kind_as_ten"],
               "private_peek": view["private_peek"], "private_peek_in_stock": view["private_peek_in_stock"],
               "afterthrow": {"seat": ids[afterthrow["player_id"]], "rank": afterthrow["rank"]} if afterthrow else None,
               "after": {"actor_hand": post_view["hand"], "private_peek": post_view["private_peek"],
                         "private_peek_in_stock": post_view["private_peek_in_stock"], "event": visible_event}}
    tournament = game.get("_hausdepp_tournament") or {}
    marker = _token(game, tournament.get("round_number", 1), policy_version)
    participant = next(item for item in participants if item["id"] == player_id)
    outcome = None
    if after["phase"] == "finished":
        outcome = {"status": "finished", "loser_seat": ids.get(after.get("loser_id")),
                   "finished_order": [ids[item] for item in after["finished_order"]],
                   "withdrawn_seats": [ids[item] for item in after.get("withdrawn_ids", [])],
                   "round_end_reason": after.get("round_end_reason", "normal"),
                   "remaining_seat": ids.get(after.get("remaining_player_id"))}
    return {"game_type": "hausdepp", "recording_id": marker["id"], "sequence": marker["sequence"],
            "actor_seat": actor, "actor_kind": seats[actor]["kind"], "actor_user_id": participant.get("user_id"),
            "action": action, "context": context,
            "eligible_user_ids": _eligible_accounts(participants), "expected_policy_version": policy_version,
            "outcome": outcome}


def prepare_watten(candidate: dict, before, actor, command, *, policy_version: int) -> dict | None:
    """Use the actor projection; never inspect other hands or hidden calls."""
    from .watten_views import cpu_view, member_view

    if command.kind not in _WATTEN_ACTIONS:
        return None
    view = (cpu_view(before, player_id=actor.player_id) if actor.account_id is None else
            member_view(before, account_id=actor.account_id, player_id=actor.player_id))
    seats_by_id = {binding.player_id: seat for seat, binding in enumerate(before.recipe.bindings)}
    actor_seat = seats_by_id[actor.player_id]
    seats = [{"seat": seat["seat"], "kind": "cpu" if before.recipe.bindings[seat["seat"]].account_id is None else "human",
              "party": seat["party"], "card_count": seat["card_count"], "tricks_won": seat["tricks_won"]}
             for seat in view["seats"]]
    scores = [{"seats": [seats_by_id[item] for item in score["members"]], "points": score["points"]}
              for score in view["scores"]]
    raw_bid = view["bid"]
    pending = raw_bid["pending"]
    result = raw_bid["result"]
    bid = {"accepted_stake": raw_bid["accepted_stake"],
           "pending": {"party": pending["party"], "points": pending["points"],
                       "decider": seats_by_id[pending["decider"]]} if pending else None,
           "result": {"winning_party": result["winning_party"], "points": result["points"],
                      "reason": result["reason"]} if result else None}
    profile, options, roles = view["profile"], view["options"], view["announcement_roles"]
    recipe = candidate["_watten"].room.recipe
    inspection = view["inspection"]
    history = view["trick_history"]
    context = {"schema_version": 1, "phase": view["phase"],
               "profile": {key: profile[key] for key in ("player_count", "determination", "blind", "critical")},
               "options": {key: options[key] for key in ("show_rechter", "open_partner_hand", "trick_history",
                                                          "schoeneres_enabled", "schlagwechsel_enabled")},
               "actor_hand": [card.get("card", "back") for card in view["hand"]], "actions": list(view["actions"]),
               "current_trick": _watten_trick(view["current_trick"]), "last_trick": _watten_trick(view["last_trick"]), "bid": bid,
               "scores": scores, "seats": seats, "target_points": view["target_points"],
               "ruleset_id": recipe.ruleset_id, "ruleset_version_number": recipe.ruleset_version,
               "dealer_seat": view["dealer_seat"],
               "announcement_roles": {key: roles[key] for key in ("strike", "colour", "first_player")},
               "deal_number": len(before.ledger.applied_results) + 1,
               # An actor may inspect a partner's private bottom card. Record
               # only the actor's own or a CPU's, never a different human's.
               "inspection": {"cards": [{"role": item["role"], "card": item["card"]}
                                         for item in inspection["cards"]
                                         if roles[item["role"]] == actor_seat
                                         or before.recipe.bindings[roles[item["role"]]].account_id is None]}
               if inspection else None,
               "trick_history": [_watten_trick(trick) for trick in history] if history is not None else None,
               }
    if "reference_card" in view:
        reference = view["reference_card"]
        context["reference_card"] = {"face": reference["face"],
                                     **({"card": reference["card"]} if "card" in reference else {})}
    if "announced_strike" in view:
        context["announced_strike"] = view["announced_strike"]
    action = {"kind": command.kind}
    value = _watten_value(command.kind, command.value)
    if value is not None:
        action["value"] = value
    marker = _token(candidate, 1, policy_version)
    outcome = None
    engine = candidate["_watten"].engine
    post_view = (cpu_view(engine, player_id=actor.player_id) if actor.account_id is None else
                 member_view(engine, account_id=actor.account_id, player_id=actor.player_id))
    context["after"] = {"actor_hand": [card.get("card", "back") for card in post_view["hand"]]}
    if engine.phase == "match_complete":
        outcome = {"status": "finished", "winner_parties": [[seats_by_id[player] for player in party]
                                                                  for party in engine.ledger.winners],
                   "scores": [{"seats": [seats_by_id[player] for player in account.members], "points": account.points}
                              for account in engine.ledger.accounts]}
    return {"game_type": "watten", "recording_id": marker["id"], "sequence": marker["sequence"],
            "actor_seat": actor_seat, "actor_kind": seats[actor_seat]["kind"], "actor_user_id": actor.account_id,
            "action": action,
            "context": context, "eligible_user_ids": tuple(binding.account_id for binding in before.recipe.bindings
                                                                if binding.account_id is not None),
            "expected_policy_version": policy_version, "outcome": outcome}


def emit_observation(event: dict | None) -> None:
    """Use a separate transaction after the accepted game transition is durable.

    Records remain partial: a process crash can occur between the two commits.
    The observer never gets to break gameplay, including on schema/DB failure.
    """
    if event is None:
        return
    try:
        from .database import database_schema_ready, session_scope
        from .observation import finish_observation, record_observation

        if not database_schema_ready():
            return
        record = {key: value for key, value in event.items() if key != "outcome"}
        with session_scope() as db:
            recorded = record_observation(db, **record)
            if recorded and event["outcome"] is not None:
                finish_observation(db, recording_id=event["recording_id"], outcome=event["outcome"],
                                   eligible_user_ids=event["eligible_user_ids"])
    except Exception:
        # No exception contents or game identity are written to logs.
        logger.warning("Optional decision observation was not recorded")


def _clear_terminal_marker(game: dict, marker: dict) -> bool:
    """Delete only the marker matching this checkpoint; concurrent writes win."""
    from sqlalchemy import select, update

    from .database import session_scope
    from .models import ActiveGame

    with session_scope() as db:
        raw = db.scalar(select(ActiveGame.state_json).where(ActiveGame.game_id == game["_id"]))
        if raw is None:
            return True
        checkpoint = json.loads(raw)
        stored_marker = checkpoint.get("_decision_observation")
        if stored_marker is None:
            return True
        if stored_marker != marker:
            return False
        checkpoint.pop("_decision_observation")
        changed = db.execute(update(ActiveGame).where(ActiveGame.game_id == game["_id"],
                             ActiveGame.state_json == raw).values(
                                 state_json=json.dumps(checkpoint, ensure_ascii=False, separators=(",", ":"))))
        return changed.rowcount == 1


def finish_terminal_observations(game: dict) -> bool:
    """Close known windows only after a committed, authoritative terminal state.

    This never opens a window. Earlier policy windows are retained only as
    opaque IDs and closed as partial by the backend's policy-version fence.
    """
    marker = game.get("_decision_observation")
    if not isinstance(marker, dict) or not (game.get("_finished") or game.get("_aborted")):
        return True
    try:
        from .database import database_schema_ready, session_scope
        from .observation import finish_observation

        if not database_schema_ready():
            return False
        kind = game.get("_game_type")
        if kind == "hausdepp":
            state = game.get("_hausdepp")
            if not state or not (game.get("_aborted") or state.get("phase") == "finished"):
                return False
            ids = {player["id"]: seat for seat, player in enumerate(state["players"])}
            eligible = _eligible_accounts(game["_participants"])
            outcome = ({"status": "aborted"} if game.get("_aborted") else
                       {"status": "finished", "loser_seat": ids.get(state.get("loser_id")),
                        "finished_order": [ids[item] for item in state["finished_order"]],
                        "withdrawn_seats": [ids[item] for item in state.get("withdrawn_ids", [])],
                        "round_end_reason": state.get("round_end_reason", "normal"),
                        "remaining_seat": ids.get(state.get("remaining_player_id"))})
        elif kind == "watten":
            engine = game["_watten"].engine
            if engine is None or not (game.get("_aborted") or engine.phase == "match_complete"):
                return False
            ids = {binding.player_id: seat for seat, binding in enumerate(engine.recipe.bindings)}
            eligible = tuple(binding.account_id for binding in engine.recipe.bindings if binding.account_id is not None)
            outcome = ({"status": "aborted"} if game.get("_aborted") else
                       {"status": "finished", "winner_parties": [[ids[player] for player in party]
                                                                  for party in engine.ledger.winners],
                        "scores": [{"seats": [ids[player] for player in account.members], "points": account.points}
                                   for account in engine.ledger.accounts]})
        else:
            return False
        for recording_id in (*marker.get("previous_ids", ()), marker["id"]):
            with session_scope() as db:
                finish_observation(db, recording_id=recording_id, outcome=outcome, eligible_user_ids=eligible)
        if not _clear_terminal_marker(game, marker):
            return False
        game.pop("_decision_observation", None)
        return True
    except Exception:
        logger.warning("Optional decision observation could not be closed")
        return False
