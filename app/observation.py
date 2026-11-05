"""Bounded, pseudonymous game-decision records, separate from analytics.

Callers may pass account IDs only for the policy check; no real account or
runtime game identifiers are written to a recording. Data is always treated as
potentially identifiable, particularly for a small selected-player cohort.
"""

from __future__ import annotations

import json
import re
import secrets
from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update

from .models import (
    ObservationAudit,
    ObservationEvent,
    ObservationPolicy,
    ObservationRecording,
    ObservationSelection,
    User,
)
from .ownership import require_owner
from .security import as_utc, utcnow

RETENTION_DAYS = 365
MAX_JSON_BYTES = 65536
MAX_POLICY_VERSION = 0x7FFFFFFF
PRIVATE_HEADERS = {"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"}
_ID = re.compile(r"^[0-9a-f]{32}$")


def _error(status, detail):
    return HTTPException(status_code=status, detail=detail, headers=PRIVATE_HEADERS)


def lock_policy(db):
    # A write lock serializes decisions with disabling, selection and deletion.
    changed = db.execute(update(ObservationPolicy).where(ObservationPolicy.id == 1).values(id=ObservationPolicy.id))
    if changed.rowcount != 1:
        raise _error(503, "observation_unavailable")


def policy_snapshot(db, viewer_id):
    from .models import AccountOwnership

    row = db.execute(select(ObservationPolicy.__table__).where(ObservationPolicy.id == 1)).mappings().one_or_none()
    if row is None:
        raise _error(503, "observation_unavailable")
    players = db.execute(select(User.id, User.username).join(ObservationSelection).where(User.is_active.is_(True))
                         .order_by(User.username_normalized)).all()
    audits = db.scalars(select(ObservationAudit).order_by(ObservationAudit.id.desc()).limit(50)).all()
    return {"viewer_id": viewer_id,
            "can_manage": db.scalar(select(AccountOwnership.user_id).where(AccountOwnership.user_id == viewer_id)) is not None,
            "enabled": bool(row["enabled"]), "mode": row["mode"], "version": row["version"],
            "retention_days": RETENTION_DAYS,
            "selected_players": [{"id": item.id, "username": item.username} for item in players],
            "audit": [{"actor_username": item.actor_username, "action": item.action,
                       "created_at": as_utc(item.created_at).isoformat(), "summary": json.loads(item.summary_json)}
                      for item in audits]}


def _audit(db, actor, action, summary):
    db.add(ObservationAudit(actor_user_id=actor.id, actor_username=actor.username, action=action,
                            summary_json=json.dumps(summary, sort_keys=True), created_at=utcnow()))


def change_policy(db, *, actor_user_id, enabled, mode, selected_user_ids, version):
    actor = require_owner(db, actor_user_id)
    lock_policy(db)
    current = db.get(ObservationPolicy, 1)
    db.refresh(current)
    if current.version != version:
        raise _error(409, "observation_policy_changed")
    if current.version >= MAX_POLICY_VERSION:
        raise _error(409, "observation_policy_version_exhausted")
    if len(selected_user_ids) > 1000 or len(set(selected_user_ids)) != len(selected_user_ids):
        raise _error(422, "observation_invalid_selection")
    active = set(db.scalars(select(User.id).where(User.id.in_(selected_user_ids), User.is_active.is_(True))))
    if active != set(selected_user_ids):
        raise _error(422, "observation_invalid_selection")
    # Any policy change makes open windows partial. A switch back on never
    # silently claims that the intervening actions were recorded.
    db.execute(update(ObservationRecording).where(ObservationRecording.finished_at.is_(None))
               .values(status="partial"))
    db.execute(delete(ObservationSelection))
    db.add_all(ObservationSelection(user_id=user_id) for user_id in selected_user_ids)
    current.enabled, current.mode = enabled, mode
    current.version += 1
    current.updated_at = utcnow()
    _audit(db, actor, "policy", {"enabled": enabled, "mode": mode, "selected_count": len(selected_user_ids)})
    db.flush()
    return policy_snapshot(db, actor_user_id)


def delete_recordings(db, *, actor_user_id, version):
    actor = require_owner(db, actor_user_id)
    lock_policy(db)
    current = db.get(ObservationPolicy, 1)
    db.refresh(current)
    if current.version != version:
        raise _error(409, "observation_policy_changed")
    if current.version >= MAX_POLICY_VERSION:
        raise _error(409, "observation_policy_version_exhausted")
    count = db.scalar(select(func.count()).select_from(ObservationRecording)) or 0
    db.execute(delete(ObservationEvent))
    db.execute(delete(ObservationRecording))
    current.enabled = False  # otherwise an active table could recreate deleted records immediately
    current.version += 1
    current.updated_at = utcnow()
    _audit(db, actor, "delete", {"deleted": count, "disabled": True})
    db.flush()
    return {"deleted": count, "version": current.version}


def prune_recordings(db, now=None):
    """Remove expired records and all their events; callable by a scheduler."""
    cutoff = (now or utcnow()) - timedelta(days=RETENTION_DAYS)
    lock_policy(db)
    expired = select(ObservationRecording.id).where(ObservationRecording.started_at <= cutoff)
    db.execute(delete(ObservationEvent).where(ObservationEvent.recording_id.in_(expired)))
    result = db.execute(delete(ObservationRecording).where(ObservationRecording.started_at <= cutoff))
    return result.rowcount


def _allowed(db, eligible_user_ids):
    # Called only after the shared policy lock. Selected rows are never copied
    # to event data. Accounts must still be active at the time of each write.
    policy = db.get(ObservationPolicy, 1)
    db.refresh(policy)
    if not policy.enabled or not eligible_user_ids:
        return None
    candidates = {value for value in eligible_user_ids if type(value) is int and value > 0}
    if not candidates:
        return None
    query = select(User.id).where(User.id.in_(candidates), User.is_active.is_(True))
    if policy.mode == "selected":
        query = query.join(ObservationSelection, ObservationSelection.user_id == User.id)
    return policy if db.scalar(query.limit(1)) is not None else None


def observation_may_record(db, eligible_user_ids):
    """Return the allowed policy version or None; writes must lock and recheck.

    This avoids generating tokens or projecting private hands while recording
    is off. A concurrent policy change can invalidate the result immediately.
    Missing schema/DB errors must be treated as disabled by the caller.
    """
    row = db.execute(select(ObservationPolicy.enabled, ObservationPolicy.mode, ObservationPolicy.version)
                     .where(ObservationPolicy.id == 1)).one_or_none()
    if row is None or not row.enabled or not 1 <= row.version <= MAX_POLICY_VERSION:
        return None
    candidates = {value for value in eligible_user_ids if type(value) is int and value > 0}
    if not candidates:
        return None
    query = select(User.id).where(User.id.in_(candidates), User.is_active.is_(True))
    if row.mode == "selected":
        query = query.join(ObservationSelection, ObservationSelection.user_id == User.id)
    return row.version if db.scalar(query.limit(1)) is not None else None


def new_recording_id(policy_version):
    """A fresh per-window pseudonym bound to the policy version, not a game ID."""
    if type(policy_version) is not int or not 1 <= policy_version <= MAX_POLICY_VERSION:
        raise ValueError("observation_policy_version_invalid")
    return f"{policy_version:08x}{secrets.token_hex(12)}"

# The recorder is intentionally not a general JSON store. These keys and values
# are the complete public/actor-local vocabulary; names, real IDs, chat and
# unprojected engine state cannot pass the write boundary.
_TOKENS = frozenset({
    "human", "cpu", "back", "hausdepp-house-v1", "normal", "ladinisch", "peeking", "playing", "finished",
    "strike", "colour", "show_ready", "inspection", "play", "bid_response", "deal_complete", "match_complete",
    "play_card", "pickup", "gamble", "afterthrow", "draw", "peek", "bid", "announce_strike", "announce_colour",
    "preplay_accept", "preplay_decline", "request_schoeneres", "request_schlagwechsel", "request_bloedeln",
    "inspection_ack", "retourschneider", "respond_hold", "respond_go", "respond_counter", "partner_feedback",
    "partial", "aborted", "win", "loss", "drawn", "hold", "go", "counter", "schoeneres", "schlagwechsel",
    "bloedeln", "accepted", "declined", "true", "false", "hearts", "bells", "leaves", "acorns",
    "6", "7", "8", "9", "10", "U", "O", "K", "A", "weli", "WELI", "tricks", "gone", "three_tricks",
    "folded", "withdrawn", "target", "points", "low", "high", "yes", "no",
    "card", "strong", "weak", "neutral", "none", "four", "ten", "ten_clear", "four_of_a_kind",
    "good", "bad", "unsure", "respond", "accept", "decline", "bloedeln_accept", "bloedeln_decline", "watten-house",
})


def _shape(value, schema, depth=0):
    """Validate field-specific structure, not just global key vocabulary."""
    if depth > 8:
        raise ValueError("observation_payload_invalid")
    if value is None:
        return
    if isinstance(schema, dict):
        if not isinstance(value, dict) or not set(value) <= set(schema):
            raise ValueError("observation_payload_invalid")
        for key, child in value.items():
            _shape(child, schema[key], depth + 1)
        return
    if isinstance(schema, list):
        if not isinstance(value, list) or len(value) > 128:
            raise ValueError("observation_payload_invalid")
        for child in value:
            _shape(child, schema[0], depth + 1)
        return
    if schema == "bool" and type(value) is bool:
        return
    if schema == "int" and type(value) is int and -1 <= value <= 10000:
        return
    if schema == "seat" and type(value) is int and 0 <= value <= 5:
        return
    if schema == "party" and type(value) is int and 0 <= value <= 1:
        return
    if schema in {"token", "card", "card_or_back", "value"}:
        from .hausdepp_engine import make_deck as hausdepp_deck
        from .watten_cards import make_deck as watten_deck

        if schema == "value" and (type(value) is bool or type(value) is int and -1 <= value <= 10000):
            return
        if isinstance(value, str):
            cards = value in hausdepp_deck() or value in watten_deck()
            if cards or schema == "card_or_back" and value == "back" or schema in {"token", "value"} and value in _TOKENS:
                return
    raise ValueError("observation_payload_invalid")


def _payload(value, schema):
    if not isinstance(value, dict):
        raise ValueError("observation_payload_invalid")
    _shape(value, schema)
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_JSON_BYTES:
        raise ValueError("observation_payload_invalid")
    return encoded


_TRICK = {"cards": [{"seat": "seat", "card": "card"}], "winner": "seat"}
_SCORE = {"seats": ["seat"], "points": "int"}
_ACTION = {"kind": "token", "cards": ["card"], "value": "value"}
_CONTEXT = {
    "schema_version": "int", "ruleset_version": "token", "ruleset_id": "token", "ruleset_version_number": "int",
    "phase": "token", "actor_hand": ["card_or_back"],
    "discard": ["card"], "deck_count": "int", "available_actions": ["token"], "playable_cards": ["card"],
    "playable_groups": [["card"]], "four_of_a_kind_as_ten": "bool", "actions": ["token"],
    "seats": [{"seat": "seat", "kind": "token", "hand_count": "int", "finished": "bool", "withdrawn": "bool",
               "party": "party", "card_count": "int", "tricks_won": "int"}],
    "profile": {"player_count": "int", "determination": "token", "blind": "bool", "critical": "bool"},
    "options": {"show_rechter": "bool", "open_partner_hand": "bool", "trick_history": "bool",
                "schoeneres_enabled": "bool", "schlagwechsel_enabled": "bool"},
    "current_trick": _TRICK, "last_trick": _TRICK,
    "bid": {"accepted_stake": "int", "pending": {"party": "party", "points": "int", "decider": "seat"},
            "result": {"winning_party": "party", "points": "int", "reason": "token"}},
    "scores": [_SCORE], "target_points": "int",
    "inspection": {"cards": [{"role": "token", "card": "card"}]},
    "partner_hand": {"seat": "seat", "cards": ["card"]},
    "feedback": [{"sender": "seat", "recipient": "seat", "value": "token"}],
    "reference_card": {"face": "token", "card": "card"}, "announced_strike": "token", "dealer_seat": "seat",
    "announcement_roles": {"strike": "seat", "colour": "seat", "first_player": "seat"},
    "trick_history": [_TRICK], "deal_number": "int", "private_peek": ["card"],
    "private_peek_in_stock": ["card"], "afterthrow": {"seat": "seat", "rank": "token"},
    "after": {"actor_hand": ["card_or_back"], "private_peek": ["card"], "private_peek_in_stock": ["card"],
              "event": {"cards": ["card"], "success": "bool", "picked_up_count": "int", "drawn_count": "int",
                        "burn_reason": "token", "burned_count": "int"}},
}
_OUTCOME = {"status": "token", "loser_seat": "seat", "finished_order": ["seat"], "withdrawn_seats": ["seat"],
            "winner_seats": ["seat"], "winner_parties": [["seat"]], "scores": [_SCORE]}
_HAUSDEPP_ACTIONS = frozenset({"play", "pickup", "gamble", "afterthrow", "draw", "peek"})
_WATTEN_ACTIONS = frozenset({"play_card", "bid", "respond", "announce_strike", "announce_colour", "show_ready",
                             "inspection_ack", "preplay_accept", "preplay_decline", "bloedeln_accept",
                             "bloedeln_decline", "request_schoeneres", "request_schlagwechsel", "request_bloedeln",
                             "retourschneider", "partner_feedback"})
_PUBLIC_CONTEXT = frozenset({"schema_version", "ruleset_version", "ruleset_id", "ruleset_version_number", "phase",
                             "discard", "deck_count", "seats", "four_of_a_kind_as_ten", "profile", "options",
                             "current_trick", "last_trick", "bid", "scores", "target_points", "announced_strike",
                             "dealer_seat", "announcement_roles", "trick_history", "deal_number"})
_PUBLIC_VALUE_ACTIONS = frozenset({"play_card", "announce_strike", "announce_colour", "respond", "retourschneider"})


def record_observation(db, *, game_type, recording_id, sequence, actor_seat, actor_kind,
                       action, context, eligible_user_ids, expected_policy_version, actor_user_id=None,
                       started_at_beginning=False):
    if (game_type not in {"hausdepp", "watten"} or not isinstance(recording_id, str) or not _ID.fullmatch(recording_id)
            or type(sequence) is not int or not 0 <= sequence <= 100000 or type(actor_seat) is not int
            or not 0 <= actor_seat <= 7 or actor_kind not in {"human", "cpu"}
            or type(expected_policy_version) is not int or not 1 <= expected_policy_version <= MAX_POLICY_VERSION
            or actor_kind == "human" and actor_user_id is not None and
            (type(actor_user_id) is not int or actor_user_id <= 0 or actor_user_id not in eligible_user_ids)
            or actor_kind == "cpu" and actor_user_id is not None):
        raise ValueError("observation_payload_invalid")
    # Version-bound pseudonyms cannot revive a deleted/disabled window after a
    # later re-enable, even if a caller accidentally reuses the old token.
    if recording_id[:8] != f"{expected_policy_version:08x}":
        return False
    _payload(action, _ACTION)
    _payload(context, _CONTEXT)
    if action.get("kind") not in (_HAUSDEPP_ACTIONS if game_type == "hausdepp" else _WATTEN_ACTIONS):
        raise ValueError("observation_payload_invalid")
    lock_policy(db)
    policy = _allowed(db, eligible_user_ids)
    if policy is None or policy.version != expected_policy_version:
        return False
    actor_selected = False
    if actor_kind == "human" and actor_user_id is not None:
        actor_query = select(User.id).where(User.id == actor_user_id, User.is_active.is_(True))
        if policy.mode == "selected":
            actor_query = actor_query.join(ObservationSelection, ObservationSelection.user_id == User.id)
        actor_selected = db.scalar(actor_query) is not None
    # A game selection must never expose the private hand, choice set, peeks,
    # partner signals or after-state of another, unselected human. Suppress
    # private feedback entirely; keep only public cards and calls from others.
    # Partner data can belong to a different person even in the chosen actor's
    # view; do not persist it without that separate actor's selection.
    context = {key: value for key, value in context.items() if key not in {"partner_hand", "feedback"}}
    if actor_kind == "human" and not actor_selected:
        if action["kind"] == "partner_feedback":
            return False
        context = {key: value for key, value in context.items() if key in _PUBLIC_CONTEXT}
        action = {key: value for key, value in action.items()
                  if key == "kind" or key == "cards" and action["kind"] in {"play", "afterthrow"}
                  or key == "value" and action["kind"] in _PUBLIC_VALUE_ACTIONS}
    action_json = _payload(action, _ACTION)
    context_json = _payload(context, _CONTEXT)
    row = db.get(ObservationRecording, recording_id)
    if row is None:
        row = ObservationRecording(id=recording_id, game_type=game_type, started_at=utcnow(),
                                   policy_version=policy.version,
                                   status="open" if started_at_beginning and sequence == 0 else "partial")
        db.add(row)
        db.flush()
    elif row.game_type != game_type or row.finished_at is not None:
        raise ValueError("observation_recording_invalid")
    elif row.policy_version != policy.version:
        row.status = "partial"
    existing = db.get(ObservationEvent, (recording_id, sequence))
    if existing:
        if (existing.actor_seat, existing.actor_kind, existing.actor_selected, existing.action_json, existing.context_json) != (
                actor_seat, actor_kind, actor_selected, action_json, context_json):
            raise ValueError("observation_event_conflict")
        return True
    # An out-of-order/missing event prevents completeness from being claimed.
    previous = db.scalar(select(func.max(ObservationEvent.sequence)).where(ObservationEvent.recording_id == recording_id))
    if previous is not None and sequence != previous + 1:
        row.status = "partial"
    db.add(ObservationEvent(recording_id=recording_id, sequence=sequence, actor_seat=actor_seat,
                            actor_kind=actor_kind, actor_selected=actor_selected, action_json=action_json,
                            context_json=context_json, created_at=utcnow()))
    db.flush()
    return True


def finish_observation(db, *, recording_id, outcome, eligible_user_ids):
    if not isinstance(recording_id, str) or not _ID.fullmatch(recording_id):
        raise ValueError("observation_payload_invalid")
    outcome_json = _payload(outcome, _OUTCOME)
    if outcome.get("status") not in {"finished", "aborted", "partial"}:
        raise ValueError("observation_payload_invalid")
    lock_policy(db)
    policy = _allowed(db, eligible_user_ids)
    row = db.get(ObservationRecording, recording_id)
    if row is None:
        return False
    if policy is None or row.policy_version != policy.version:
        # After an authoritative game end, close an existing partial window
        # even if recording has since been disabled or its selection removed.
        # This safety marker is the only allowed later write: do not persist
        # the post-disable outcome or create/recreate a deleted recording.
        if row.finished_at is None:
            row.status = "partial"
            row.finished_at = utcnow()
            db.flush()
        return True
    if row.finished_at is not None:
        if row.outcome_json != outcome_json:
            raise ValueError("observation_outcome_conflict")
        return True
    if row.policy_version != policy.version:
        row.status = "partial"
    row.finished_at = utcnow()
    row.outcome_json = outcome_json
    if row.status == "open":
        row.status = "complete"
    db.flush()
    return True
