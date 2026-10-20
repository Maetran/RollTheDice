"""Trusted public-match evidence and durable accepted-command bid counters.

The counter journal contains only actor IDs and public command totals. It is
maintained by the native runtime after engine acceptance, never reconstructed
from the bounded retry cache or accepted from a client. None means that an
older running match has no complete journal; absence is never proof of zero.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timedelta, timezone

from .watten_evidence import BidEvidence, MatchEvidence, PlayerBids, PublicProfile, adapt_result_v1, validate_result_v1

_COUNTER_FIELDS = frozenset({"player_id", "initiated", "countered", "held", "went"})


def _require(condition: bool) -> None:
    if not condition:
        raise ValueError("watten_invalid_bid_counters")


def new_bid_counters(engine) -> tuple[PlayerBids, ...]:
    """Only a newly started engine may establish a complete zero journal."""
    _require(engine.opportunity == 0 and not engine.ledger.applied_results)
    return tuple(PlayerBids(player, 0, 0, 0, 0) for player in engine.recipe.seats)


def validate_bid_counters(counters: tuple[PlayerBids, ...] | None, engine) -> None:
    if counters is None:
        return
    _require(engine is not None and type(counters) is tuple
             and all(type(item) is PlayerBids for item in counters)
             and tuple(item.player_id for item in counters) == engine.recipe.seats)
    initiated = sum(item.initiated for item in counters)
    countered = sum(item.countered for item in counters)
    held = sum(item.held for item in counters)
    went = sum(item.went for item in counters)
    results = engine.ledger.applied_results
    current_scored = any(item.deal_id == engine.deal_id for item in results)
    stake_increases = sum(item.points - 2 for item in results)
    if not current_scored:
        stake_increases += engine.bid_state.accepted_stake - 2
    # A raised deal ending on tricks had to close at least one offer by holding.
    # Counters alone leave a pending response and cannot resume card play.
    raised_closed = sum(item.reason == "tricks" and item.points > 2 for item in results)
    raised_closed += int(not current_scored and engine.bid_state.accepted_stake > 2
                         and engine.bid_state.pending is None)
    _require(initiated == held + went + int(engine.bid_state.pending is not None)
             and went == sum(item.reason == "go" for item in results)
             and held + countered == stake_increases
             and held >= raised_closed and (not countered or initiated > 0)
             and initiated + countered + held + went <= engine.opportunity)


def advance_bid_counters(counters: tuple[PlayerBids, ...] | None, player: str,
                         kind: str, value: str | None) -> tuple[PlayerBids, ...] | None:
    """Call only for a successful, non-replayed native engine transition."""
    if counters is None:
        return None
    field = "initiated" if kind == "bid" else ({"hold": "held", "go": "went", "counter": "countered"}.get(value)
                                               if kind == "respond" else None)
    if field is None:
        return counters
    _require(any(item.player_id == player for item in counters))
    return tuple(replace(item, **{field: getattr(item, field) + 1}) if item.player_id == player else item
                 for item in counters)


def counters_to_storage(counters: tuple[PlayerBids, ...] | None) -> list[dict] | None:
    return None if counters is None else [
        {"player_id": item.player_id, "initiated": item.initiated, "countered": item.countered,
         "held": item.held, "went": item.went} for item in counters]


def counters_from_storage(raw: object) -> tuple[PlayerBids, ...] | None:
    if raw is None:
        return None
    _require(type(raw) is list)
    result = []
    for item in raw:
        _require(type(item) is dict and set(item) == _COUNTER_FIELDS)
        result.append(PlayerBids(**item))
    return tuple(result)


def _timestamp(value: object) -> datetime:
    if type(value) is not str:
        raise ValueError("watten_invalid_match_timestamp")
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("watten_invalid_match_timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("watten_invalid_match_timestamp")
    return parsed.astimezone(timezone.utc)


def terminal_evidence(game: dict, *, finished_at: datetime) -> MatchEvidence:
    """Produce public evidence alongside the trusted completed-result transaction.

    The caller supplies the aware UTC CompletedGame timestamp. Existing v1
    result data, including an optional Retourschneider decision, must agree exactly.
    This function performs no storage, grants, account lookup or client reads.
    """
    from .watten_results import result_payload
    from .watten_runtime import WattenRuntime

    if type(game) is not dict or type(game.get("_watten")) is not WattenRuntime:
        raise ValueError("watten_invalid_match_evidence")
    runtime = game["_watten"]
    if (runtime.engine is None or runtime.engine.phase != "match_complete" or runtime.room.status != "finished"
            or game.get("_game_type") != "watten" or game.get("_id") != runtime.room.room_id
            or not game.get("_finished") or game.get("_aborted")):
        raise ValueError("watten_match_not_finished")
    if (type(finished_at) is not datetime or finished_at.tzinfo is None
            or finished_at.utcoffset() != timedelta(0) or _timestamp(game.get("_finished_at")) != finished_at):
        raise ValueError("watten_invalid_match_timestamp")
    started_at = _timestamp(game.get("_started_at"))
    result = validate_result_v1(result_payload(game))
    stored = game.get("_watten_result")
    if ((stored is not None and validate_result_v1(stored) != result)
            or (game.get("_completion_persisted") and stored is None)):
        raise ValueError("watten_result_conflict")
    validate_bid_counters(runtime.bid_counters, runtime.engine)
    recipe = runtime.room.recipe
    profile = PublicProfile(recipe.ruleset_id, recipe.ruleset_version, recipe.determination, recipe.blind,
                            recipe.critical, recipe.show_rechter, recipe.trick_history, recipe.partner_hand)
    return replace(adapt_result_v1(result, finished_at=finished_at), source="public_match_v1", profile=profile,
                   started_at=started_at, bids=BidEvidence() if runtime.bid_counters is None else BidEvidence(True, runtime.bid_counters))
