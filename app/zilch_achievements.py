"""Private, server-derived Zilch achievements and reload-safe award delivery.

This module is intentionally isolated from :mod:`app.achievements`: the
existing module owns public ZDWA achievements, Ehrenberg marks, account ranks,
and public profiles.  Zilch awards use their own ``zilch.*`` namespace and
their own durable tables, have no points, and never influence a shared title.

Only an explicit call from the post-persistence Zilch finalizer registers a
result.  There is deliberately no scan of historic ``CompletedGame`` rows, so
pre-rollout Zilch results cannot be retroactively unlocked merely by opening a
page or starting the application.  A registered result is first turned into
strictly validated human-seat evidence; a small pending-work table then makes
retry after a transient award failure deterministic and bounded.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Final, Iterable, Mapping

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from .database import database_schema_ready, session_scope
from .game_types import ZILCH_GAME_TYPE
from .models import (
    CompletedGame,
    DeletedGame,
    GameParticipant,
    User,
    ZilchAchievementDelivery,
    ZilchAchievementEvaluation,
    ZilchAchievementEvidence,
    ZilchAchievementUnlock,
)
from .security import as_utc, utcnow
from .zilch_cpu_strategy import ZILCH_CPU_STRATEGIES
from .zilch_engine import ZILCH_RULESET_VERSION, ZILCH_TARGET_SCORE
from .zilch_results import validate_stored_zilch_result_payload
from .zilch_solo_objective import ZILCH_SOLO_SPRINT_OBJECTIVE_ID, ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION

logger = logging.getLogger(__name__)

ZILCH_ACHIEVEMENT_RESPONSE_VERSION: Final = 1
ZILCH_ACHIEVEMENT_NAMESPACE: Final = "zilch."
ZILCH_ACHIEVEMENT_DEFINITION_VERSION: Final = 1
ZILCH_ACHIEVEMENT_RECOVERY_DEFAULT_LIMIT: Final = 50
ZILCH_ACHIEVEMENT_RECOVERY_MAX_LIMIT: Final = 100
ZILCH_ACHIEVEMENT_TOMBSTONE_RECOVERY_DEFAULT_LIMIT: Final = 50
ZILCH_ACHIEVEMENT_TOMBSTONE_RECOVERY_MAX_LIMIT: Final = 100

_KNOWN_PLAY_MODES: Final[frozenset[str]] = frozenset({"multiplayer", "cpu", "solo"})
_KNOWN_RESULT_SCHEMAS: Final[frozenset[int]] = frozenset({1, 2})


class ZilchAchievementError(ValueError):
    """A controlled Zilch-achievement input or durable-state rejection."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class ZilchAchievementSyncError(RuntimeError):
    """A retryable server-side evaluation failure after result persistence."""

    def __init__(self, code: str = "zilch_achievement_sync_failed") -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class ZilchAchievementDefinition:
    """One immutable, namespaced Zilch award contract."""

    key: str
    definition_version: int
    category: str
    icon_key: str
    title_key: str
    description_key: str
    title_de: str
    title_en: str
    description_de: str
    description_en: str
    criterion: str
    eligible_modes: frozenset[str]
    result_schema_versions: frozenset[int]
    ruleset: str = ZILCH_RULESET_VERSION
    target: int | None = None
    requires_complete_history: bool = False


@dataclass(frozen=True)
class ZilchAchievementRegistration:
    """Result of one idempotent finalizer registration/evaluation attempt."""

    game_id: str
    status: str
    new_unlocks_by_user: dict[int, list[dict[str, Any]]]
    pending: bool = False


def _definition(
    suffix: str,
    *,
    category: str,
    icon_key: str,
    title_de: str,
    title_en: str,
    description_de: str,
    description_en: str,
    criterion: str,
    eligible_modes: Iterable[str],
    result_schema_versions: Iterable[int],
    target: int | None = None,
    requires_complete_history: bool = False,
) -> ZilchAchievementDefinition:
    key = f"{ZILCH_ACHIEVEMENT_NAMESPACE}{suffix}"
    return ZilchAchievementDefinition(
        key=key,
        definition_version=ZILCH_ACHIEVEMENT_DEFINITION_VERSION,
        category=category,
        icon_key=icon_key,
        title_key=f"zilch.achievement.{suffix}.title",
        description_key=f"zilch.achievement.{suffix}.description",
        title_de=title_de,
        title_en=title_en,
        description_de=description_de,
        description_en=description_en,
        criterion=criterion,
        eligible_modes=frozenset(eligible_modes),
        result_schema_versions=frozenset(result_schema_versions),
        target=target,
        requires_complete_history=requires_complete_history,
    )


ZILCH_ACHIEVEMENTS: Final[tuple[ZilchAchievementDefinition, ...]] = (
    _definition(
        "first_game",
        category="entry",
        icon_key="die",
        title_de="Erster Wurf",
        title_en="First Roll",
        description_de="Deine erste abgeschlossene Zilch-Partie gespeichert.",
        description_en="Your first completed Zilch game has been saved.",
        criterion="first_registered_game",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
    ),
    _definition(
        "first_hvh_win",
        category="multiplayer",
        icon_key="duel",
        title_de="Tischsieger",
        title_en="Table Victor",
        description_de="Deinen ersten Sieg gegen einen menschlichen Gegner errungen.",
        description_en="Earn your first win against a human opponent.",
        criterion="first_hvh_win",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
    ),
    _definition(
        "first_cpu_win",
        category="cpu",
        icon_key="cpu",
        title_de="Maschinenstopp",
        title_en="Machine Stop",
        description_de="Deinen ersten Sieg gegen eine CPU errungen.",
        description_en="Earn your first win against a CPU.",
        criterion="first_cpu_win",
        eligible_modes={"cpu"},
        result_schema_versions={1},
    ),
    _definition(
        "cpu_win_conservative",
        category="cpu",
        icon_key="shield",
        title_de="Sicher besiegt",
        title_en="Safely Beaten",
        description_de="Die konservative CPU besiegt.",
        description_en="Defeat the conservative CPU.",
        criterion="cpu_strategy_win",
        eligible_modes={"cpu"},
        result_schema_versions={1},
        target=0,
    ),
    _definition(
        "cpu_win_normal",
        category="cpu",
        icon_key="cpu",
        title_de="Ausgeglichen besiegt",
        title_en="Balanced Victory",
        description_de="Die normale CPU besiegt.",
        description_en="Defeat the normal CPU.",
        criterion="cpu_strategy_win",
        eligible_modes={"cpu"},
        result_schema_versions={1},
        target=1,
    ),
    _definition(
        "cpu_win_aggressive",
        category="cpu",
        icon_key="flame",
        title_de="Risiko gezähmt",
        title_en="Risk Tamed",
        description_de="Die aggressive CPU besiegt.",
        description_en="Defeat the aggressive CPU.",
        criterion="cpu_strategy_win",
        eligible_modes={"cpu"},
        result_schema_versions={1},
        target=2,
    ),
    _definition(
        "solo_sprint_completed",
        category="solo",
        icon_key="flag",
        title_de="Sprint geschafft",
        title_en="Sprint Complete",
        description_de="Den Solo-Sprint auf 10’000 Punkte erfolgreich abgeschlossen.",
        description_en="Complete the 10,000-point Solo Sprint.",
        criterion="solo_sprint_completed",
        eligible_modes={"solo"},
        result_schema_versions={2},
    ),
    _definition(
        "banked_round_500",
        category="scoring",
        icon_key="paper",
        title_de="Erste sichere Runde",
        title_en="First Safe Round",
        description_de="500 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 500 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=500,
    ),
    _definition(
        "banked_round_1000",
        category="scoring",
        icon_key="paper",
        title_de="Vierstellig gesichert",
        title_en="Four Digits Banked",
        description_de="1’000 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 1,000 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=1_000,
    ),
    _definition(
        "banked_round_1500",
        category="scoring",
        icon_key="star",
        title_de="Hohe Kante",
        title_en="High Stakes",
        description_de="1’500 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 1,500 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=1_500,
    ),
    _definition(
        "banked_round_2000",
        category="scoring",
        icon_key="star",
        title_de="Doppelt tausend",
        title_en="Double Thousand",
        description_de="2’000 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 2,000 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=2_000,
    ),
    _definition(
        "exact_10000",
        category="scoring",
        icon_key="target",
        title_de="Punktgenau 10’000",
        title_en="Exact 10,000",
        description_de="Eine Partie mit exakt 10’000 eigenen Punkten beendet.",
        description_en="Finish a game on exactly 10,000 personal points.",
        criterion="exact_target_score",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=ZILCH_TARGET_SCORE,
    ),
    _definition(
        "first_straight",
        category="combinations",
        icon_key="straight",
        title_de="Geradeaus",
        title_en="Straight Ahead",
        description_de="Zum ersten Mal eine Strasse gehalten.",
        description_en="Hold a straight for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=0,
        requires_complete_history=True,
    ),
    _definition(
        "first_three_pairs",
        category="combinations",
        icon_key="pairs",
        title_de="Drei Paare",
        title_en="Three Pairs",
        description_de="Zum ersten Mal drei Paare gehalten.",
        description_en="Hold three pairs for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=1,
        requires_complete_history=True,
    ),
    _definition(
        "first_500_for_nothing",
        category="combinations",
        icon_key="spark",
        title_de="500 für nichts",
        title_en="500 for Nothing",
        description_de="Zum ersten Mal die Sonderwertung „500 für nichts“ gehalten.",
        description_en="Hold the special “500 for nothing” score for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=2,
        requires_complete_history=True,
    ),
    _definition(
        "first_three_ones",
        category="combinations",
        icon_key="ones",
        title_de="Einserdrilling",
        title_en="Triple Ones",
        description_de="Zum ersten Mal einen Drilling aus Einsen gehalten.",
        description_en="Hold triple ones for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        target=3,
        requires_complete_history=True,
    ),
    _definition(
        "first_hot_dice",
        category="combinations",
        icon_key="flame",
        title_de="Heisse Würfel",
        title_en="Hot Dice",
        description_de="Zum ersten Mal Hot Dice ausgelöst.",
        description_en="Trigger Hot Dice for the first time.",
        criterion="hot_dice",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        requires_complete_history=True,
    ),
    _definition(
        "win_after_three_zilchs",
        category="risk",
        icon_key="comeback",
        title_de="Trotz Zilch-Serie",
        title_en="Through the Zilch Streak",
        description_de="Eine Partie trotz mindestens drei eigener Zilchs gewonnen.",
        description_en="Win a game despite at least three personal Zilchs.",
        criterion="win_after_zilchs",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        target=3,
    ),
    _definition(
        "win_after_zilch_penalty",
        category="risk",
        icon_key="comeback",
        title_de="500 zurückgeholt",
        title_en="500 Recovered",
        description_de="Nach einer angewandten 500-Punkte-Zilch-Strafe gewonnen.",
        description_en="Win after receiving the 500-point Zilch penalty.",
        criterion="win_after_zilch_penalty",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
    ),
    _definition(
        "solo_sprint_without_zilch",
        category="solo",
        icon_key="shield",
        title_de="Sauberer Sprint",
        title_en="Clean Sprint",
        description_de="Den Solo-Sprint ohne einen Zilch abgeschlossen.",
        description_en="Complete the Solo Sprint without a Zilch.",
        criterion="solo_sprint_without_zilch",
        eligible_modes={"solo"},
        result_schema_versions={2},
    ),
)

ZILCH_ACHIEVEMENT_BY_KEY: Final[dict[str, ZilchAchievementDefinition]] = {
    definition.key: definition for definition in ZILCH_ACHIEVEMENTS
}
ZILCH_ACHIEVEMENT_CATEGORIES: Final[tuple[str, ...]] = (
    "entry",
    "scoring",
    "combinations",
    "risk",
    "multiplayer",
    "cpu",
    "solo",
)
_COMBINATION_BY_TARGET: Final[dict[int, str]] = {
    0: "straight",
    1: "three_pairs",
    2: "nothing_bonus",
    3: "three_ones",
}
_CPU_STRATEGY_BY_TARGET: Final[dict[int, str]] = {
    0: "conservative",
    1: "normal",
    2: "aggressive",
}


def _validate_catalog() -> None:
    if len(ZILCH_ACHIEVEMENT_BY_KEY) != len(ZILCH_ACHIEVEMENTS):
        raise RuntimeError("Zilch achievement keys must be unique.")
    for definition in ZILCH_ACHIEVEMENTS:
        if not definition.key.startswith(ZILCH_ACHIEVEMENT_NAMESPACE):
            raise RuntimeError("Zilch achievement keys must be namespaced.")
        if definition.definition_version < 1:
            raise RuntimeError("Zilch achievement definitions require a positive version.")
        if definition.category not in ZILCH_ACHIEVEMENT_CATEGORIES:
            raise RuntimeError("Zilch achievement categories must be known.")
        if not definition.eligible_modes or not definition.eligible_modes <= _KNOWN_PLAY_MODES:
            raise RuntimeError("Zilch achievement modes must be known.")
        if not definition.result_schema_versions or not definition.result_schema_versions <= _KNOWN_RESULT_SCHEMAS:
            raise RuntimeError("Zilch achievement schemas must be known.")
        if definition.ruleset != ZILCH_RULESET_VERSION:
            raise RuntimeError("Zilch achievement rulesets must be explicit and known.")
        if not all(
            isinstance(value, str) and value.strip()
            for value in (
                definition.title_key,
                definition.description_key,
                definition.title_de,
                definition.title_en,
                definition.description_de,
                definition.description_en,
            )
        ):
            raise RuntimeError("Zilch achievement localizations must be complete.")


_validate_catalog()


def zilch_achievement_localization_entries() -> dict[str, str]:
    """Return the DE source strings and EN targets needed by the UI catalog.

    The HTTP payload exposes localization keys rather than server-rendered
    copy.  This helper lets the frontend catalog and its test assert that the
    immutable server definitions have a matching pair of translations.
    """

    entries: dict[str, str] = {}
    for definition in ZILCH_ACHIEVEMENTS:
        entries[definition.title_de] = definition.title_en
        entries[definition.description_de] = definition.description_en
    return entries


def _definition_payload(definition: ZilchAchievementDefinition) -> dict[str, Any]:
    """Expose no mutable criteria, result data, points, or shared rank data."""

    return {
        "key": definition.key,
        "definition_version": definition.definition_version,
        "category": definition.category,
        "category_key": f"zilch.achievement.category.{definition.category}",
        "icon_key": definition.icon_key,
        "title_key": definition.title_key,
        "description_key": definition.description_key,
        "eligible_modes": sorted(definition.eligible_modes),
        "ruleset": definition.ruleset,
        "hidden": False,
    }


def zilch_achievement_definitions_payload() -> dict[str, Any]:
    """Return the stable catalog projection for the private client."""

    return {
        "version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION,
        "categories": [
            {"key": category, "title_key": f"zilch.achievement.category.{category}"}
            for category in ZILCH_ACHIEVEMENT_CATEGORIES
        ],
        "definitions": [_definition_payload(definition) for definition in ZILCH_ACHIEVEMENTS],
    }


def _strict_int(value: object, code: str, *, minimum: int = 0) -> int:
    if type(value) is not int or value < minimum:
        raise ZilchAchievementError(code)
    return value


def _strict_text(value: object, code: str, *, limit: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ZilchAchievementError(code)
    return value.strip()[:limit]


def _payload_from_completed_game(game: CompletedGame) -> dict[str, Any]:
    """Read only a typed, shared-validator-approved private result payload."""

    if game.game_type != ZILCH_GAME_TYPE:
        raise ZilchAchievementError("zilch_achievement_wrong_game_type")
    try:
        decoded = json.loads(game.snapshot_json)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ZilchAchievementError("zilch_achievement_invalid_result") from exc
    payload = validate_stored_zilch_result_payload(decoded, expected_game_id=game.game_id)
    if payload is None:
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    if payload.get("ruleset") != ZILCH_RULESET_VERSION:
        raise ZilchAchievementError("zilch_achievement_unknown_ruleset")
    if payload.get("play_mode") not in _KNOWN_PLAY_MODES:
        raise ZilchAchievementError("zilch_achievement_invalid_mode")
    if payload.get("schema_version") not in _KNOWN_RESULT_SCHEMAS:
        raise ZilchAchievementError("zilch_achievement_unknown_schema")
    return payload


def _round_facts(board: object) -> tuple[list[int], int, int, bool, int | None, set[str]]:
    """Return only server-stored round facts; missing holds stay unknown."""

    if not isinstance(board, Mapping):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    rounds = board.get("rounds")
    if not isinstance(rounds, list):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    banked: list[int] = []
    zilchs = 0
    penalties = 0
    history_complete = True
    hot_dice: int | None = 0
    combinations: set[str] = set()
    for entry in rounds:
        if not isinstance(entry, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        event = entry.get("event")
        if event == "bank":
            banked.append(_strict_int(entry.get("points"), "zilch_achievement_invalid_result"))
        elif event == "zilch":
            zilchs += 1
            penalties += _strict_int(entry.get("penalty"), "zilch_achievement_invalid_result")
        else:
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        holds = entry.get("committed_holds")
        if not isinstance(holds, list):
            history_complete = False
            hot_dice = None
            continue
        for hold in holds:
            if not isinstance(hold, Mapping):
                continue
            if bool(hold.get("hot_dice")) and hot_dice is not None:
                hot_dice += 1
            combination_type = hold.get("combination_type")
            if isinstance(combination_type, str) and combination_type:
                combinations.add(combination_type)
            components = hold.get("components")
            if isinstance(components, list):
                for component in components:
                    if not isinstance(component, Mapping):
                        continue
                    component_type = component.get("combination_type")
                    if isinstance(component_type, str) and component_type:
                        combinations.add(component_type)
    if not history_complete:
        # Do not let partial history emit a false absence or false positive for
        # Hot Dice/combinations.  The historic v1 contract intentionally
        # marks this condition as unknown.
        combinations.clear()
    return banked, zilchs, penalties, history_complete, hot_dice, combinations


def _match_outcome(payload: Mapping[str, Any], participant_id: str) -> tuple[str | None, str | None]:
    """Return a human's authoritative match outcome and optional CPU strategy."""

    play_mode = payload.get("play_mode")
    if play_mode == "solo":
        outcome = payload.get("outcome")
        if not isinstance(outcome, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        return ("completed" if outcome.get("status") == "completed" else "abandoned"), None
    outcome = payload.get("outcome")
    if not isinstance(outcome, Mapping):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    if bool(outcome.get("tied")):
        match_outcome = "tie"
    else:
        winner_id = outcome.get("winner_id")
        if not isinstance(winner_id, str) or not winner_id:
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        match_outcome = "win" if winner_id == participant_id else "loss"
    cpu_strategy = None
    if play_mode == "cpu":
        participants = payload.get("participants")
        if not isinstance(participants, list):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        cpu = next(
            (item for item in participants if isinstance(item, Mapping) and item.get("participant_type") == "cpu"),
            None,
        )
        strategy = cpu.get("cpu_strategy") if isinstance(cpu, Mapping) else None
        if strategy not in ZILCH_CPU_STRATEGIES:
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        cpu_strategy = str(strategy)
    return match_outcome, cpu_strategy


def _facts_for_human_participant(payload: Mapping[str, Any], participant: GameParticipant) -> dict[str, Any] | None:
    """Normalize one linked human participant without trusting payload user IDs."""

    if participant.user_id is None:
        return None
    payload_participants = payload.get("participants")
    boards = payload.get("boards")
    totals = payload.get("totals")
    if not isinstance(payload_participants, list) or not isinstance(boards, Mapping) or not isinstance(totals, Mapping):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    seat = next(
        (
            item
            for item in payload_participants
            if isinstance(item, Mapping) and str(item.get("player_key") or "") == str(participant.player_key)
        ),
        None,
    )
    if not isinstance(seat, Mapping) or seat.get("participant_type") != "human":
        return None
    participant_id = _strict_text(seat.get("participant_id"), "zilch_achievement_invalid_result", limit=64)
    board = boards.get(participant_id)
    if not isinstance(board, Mapping):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    final_score = _strict_int(totals.get(participant_id), "zilch_achievement_invalid_result")
    banked, zilchs, penalties, history_complete, hot_dice, combinations = _round_facts(board)
    outcome, cpu_strategy = _match_outcome(payload, participant_id)
    play_mode = _strict_text(payload.get("play_mode"), "zilch_achievement_invalid_mode", limit=24)
    schema_version = _strict_int(payload.get("schema_version"), "zilch_achievement_unknown_schema", minimum=1)
    ruleset = _strict_text(payload.get("ruleset"), "zilch_achievement_unknown_ruleset", limit=64)
    facts: dict[str, Any] = {
        "schema_version": schema_version,
        "ruleset": ruleset,
        "play_mode": play_mode,
        "participant_id": participant_id,
        "final_score": final_score,
        "outcome": outcome,
        "cpu_strategy": cpu_strategy,
        "banked_rounds": banked,
        "highest_banked_round": max(banked, default=0),
        "zilch_count": zilchs,
        "zilch_penalty_points": penalties,
        "history_complete": history_complete,
        "hot_dice_events": hot_dice,
        "combination_types": sorted(combinations),
        "target_score": _strict_int(payload.get("target_score"), "zilch_achievement_invalid_result", minimum=1),
    }
    if play_mode == "solo":
        objective = payload.get("objective")
        if not isinstance(objective, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        facts["objective_id"] = _strict_text(objective.get("id"), "zilch_achievement_invalid_result", limit=80)
        facts["objective_version"] = _strict_int(
            objective.get("version"), "zilch_achievement_invalid_result", minimum=1
        )
    return facts


def _evidence_rows_for_result(db, game: CompletedGame, payload: Mapping[str, Any]) -> list[tuple[int, dict[str, Any]]]:
    """Extract only actual account-linked human seats; a CPU is never a user."""

    output: list[tuple[int, dict[str, Any]]] = []
    seen_users: set[int] = set()
    for participant in game.participants:
        facts = _facts_for_human_participant(payload, participant)
        if facts is None:
            continue
        user_id = int(participant.user_id)
        if user_id in seen_users:
            # A malformed self-play record must not double-count one account
            # toward a cumulative award.  Its result validator still governs
            # normal gameplay; the achievement boundary fails closed here.
            raise ZilchAchievementError("zilch_achievement_duplicate_human_user")
        user = db.get(User, user_id)
        # A deactivated account is not an award identity.  In particular, a
        # historic human seat must not make a disabled account appear through
        # a private achievement response or pending award queue.
        if user is None or not user.is_active:
            continue
        seen_users.add(user_id)
        output.append((user_id, facts))
    return output


def _facts_from_evidence(row: ZilchAchievementEvidence) -> dict[str, Any] | None:
    """Read a normalized fact envelope defensively; damaged evidence is inert."""

    try:
        facts = json.loads(row.facts_json)
    except (TypeError, json.JSONDecodeError):
        logger.warning("Skipping malformed Zilch achievement evidence %s", row.id)
        return None
    if not isinstance(facts, dict):
        return None
    try:
        schema_version = _strict_int(facts.get("schema_version"), "zilch_achievement_invalid_evidence", minimum=1)
        ruleset = _strict_text(facts.get("ruleset"), "zilch_achievement_invalid_evidence", limit=64)
        play_mode = _strict_text(facts.get("play_mode"), "zilch_achievement_invalid_evidence", limit=24)
        _strict_text(facts.get("participant_id"), "zilch_achievement_invalid_evidence", limit=64)
        _strict_int(facts.get("final_score"), "zilch_achievement_invalid_evidence")
        if (
            schema_version not in _KNOWN_RESULT_SCHEMAS
            or ruleset != ZILCH_RULESET_VERSION
            or play_mode not in _KNOWN_PLAY_MODES
        ):
            return None
        if facts.get("outcome") not in {"win", "loss", "tie", "completed", "abandoned"}:
            return None
        banked = facts.get("banked_rounds")
        combinations = facts.get("combination_types")
        if not isinstance(banked, list) or any(type(value) is not int or value < 0 for value in banked):
            return None
        if _strict_int(facts.get("highest_banked_round"), "zilch_achievement_invalid_evidence") != max(
            banked, default=0
        ):
            return None
        if not isinstance(combinations, list) or any(not isinstance(value, str) for value in combinations):
            return None
        if type(facts.get("history_complete")) is not bool:
            return None
        hot_dice = facts.get("hot_dice_events")
        if hot_dice is not None and (type(hot_dice) is not int or hot_dice < 0):
            return None
        _strict_int(facts.get("zilch_count"), "zilch_achievement_invalid_evidence")
        _strict_int(facts.get("zilch_penalty_points"), "zilch_achievement_invalid_evidence")
        if (
            _strict_int(facts.get("target_score"), "zilch_achievement_invalid_evidence", minimum=1)
            != ZILCH_TARGET_SCORE
        ):
            return None
        outcome = facts.get("outcome")
        if play_mode in {"multiplayer", "cpu"} and outcome not in {"win", "loss", "tie"}:
            return None
        if play_mode == "solo" and outcome not in {"completed", "abandoned"}:
            return None
        if play_mode == "cpu":
            if facts.get("cpu_strategy") not in ZILCH_CPU_STRATEGIES:
                return None
        elif facts.get("cpu_strategy") is not None:
            return None
        if play_mode == "solo":
            if (
                facts.get("objective_id") != ZILCH_SOLO_SPRINT_OBJECTIVE_ID
                or facts.get("objective_version") != ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION
            ):
                return None
        return facts
    except ZilchAchievementError:
        return None


def _definition_applies(definition: ZilchAchievementDefinition, facts: Mapping[str, Any]) -> bool:
    return (
        facts.get("play_mode") in definition.eligible_modes
        and facts.get("schema_version") in definition.result_schema_versions
        and facts.get("ruleset") == definition.ruleset
        and (not definition.requires_complete_history or facts.get("history_complete") is True)
    )


def _criterion_is_satisfied(definition: ZilchAchievementDefinition, facts: list[dict[str, Any]]) -> bool:
    """Evaluate immutable definitions against all explicitly registered evidence."""

    applicable = [item for item in facts if _definition_applies(definition, item)]
    if not applicable:
        return False
    criterion = definition.criterion
    if criterion == "first_registered_game":
        return bool(applicable)
    if criterion == "first_hvh_win":
        return any(item.get("play_mode") == "multiplayer" and item.get("outcome") == "win" for item in applicable)
    if criterion == "first_cpu_win":
        return any(item.get("play_mode") == "cpu" and item.get("outcome") == "win" for item in applicable)
    if criterion == "cpu_strategy_win":
        strategy = _CPU_STRATEGY_BY_TARGET.get(definition.target)
        return any(
            item.get("play_mode") == "cpu" and item.get("outcome") == "win" and item.get("cpu_strategy") == strategy
            for item in applicable
        )
    if criterion == "solo_sprint_completed":
        return any(
            item.get("outcome") == "completed"
            and item.get("objective_id") == ZILCH_SOLO_SPRINT_OBJECTIVE_ID
            and item.get("objective_version") == ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION
            for item in applicable
        )
    if criterion == "banked_round":
        target = int(definition.target or 0)
        return any(any(int(points) >= target for points in item["banked_rounds"]) for item in applicable)
    if criterion == "exact_target_score":
        target = int(definition.target or 0)
        return any(item.get("final_score") == target for item in applicable)
    if criterion == "combination":
        combination = _COMBINATION_BY_TARGET.get(definition.target)
        return any(combination in item["combination_types"] for item in applicable)
    if criterion == "hot_dice":
        return any(item.get("hot_dice_events") is not None and int(item["hot_dice_events"]) > 0 for item in applicable)
    if criterion == "win_after_zilchs":
        target = int(definition.target or 0)
        return any(item.get("outcome") == "win" and int(item["zilch_count"]) >= target for item in applicable)
    if criterion == "win_after_zilch_penalty":
        return any(item.get("outcome") == "win" and int(item["zilch_penalty_points"]) > 0 for item in applicable)
    if criterion == "solo_sprint_without_zilch":
        return any(
            item.get("outcome") == "completed"
            and item.get("objective_id") == ZILCH_SOLO_SPRINT_OBJECTIVE_ID
            and int(item["zilch_count"]) == 0
            for item in applicable
        )
    raise RuntimeError(f"Unknown Zilch achievement criterion: {criterion}")


def _fact_individually_satisfies(definition: ZilchAchievementDefinition, fact: Mapping[str, Any]) -> bool:
    """Tell whether a concrete evidence row can be shown as an award source."""

    if not _definition_applies(definition, fact):
        return False
    criterion = definition.criterion
    if criterion == "first_registered_game":
        return True
    if criterion == "first_hvh_win":
        return fact.get("play_mode") == "multiplayer" and fact.get("outcome") == "win"
    if criterion == "first_cpu_win":
        return fact.get("play_mode") == "cpu" and fact.get("outcome") == "win"
    if criterion == "cpu_strategy_win":
        return fact.get("outcome") == "win" and fact.get("cpu_strategy") == _CPU_STRATEGY_BY_TARGET.get(
            definition.target
        )
    if criterion == "solo_sprint_completed":
        return fact.get("outcome") == "completed"
    if criterion == "banked_round":
        return any(int(points) >= int(definition.target or 0) for points in fact["banked_rounds"])
    if criterion == "exact_target_score":
        return fact.get("final_score") == int(definition.target or 0)
    if criterion == "combination":
        return _COMBINATION_BY_TARGET.get(definition.target) in fact["combination_types"]
    if criterion == "hot_dice":
        return fact.get("hot_dice_events") is not None and int(fact["hot_dice_events"]) > 0
    if criterion == "win_after_zilchs":
        return fact.get("outcome") == "win" and int(fact["zilch_count"]) >= int(definition.target or 0)
    if criterion == "win_after_zilch_penalty":
        return fact.get("outcome") == "win" and int(fact["zilch_penalty_points"]) > 0
    if criterion == "solo_sprint_without_zilch":
        return fact.get("outcome") == "completed" and int(fact["zilch_count"]) == 0
    raise RuntimeError(f"Unknown Zilch achievement criterion: {criterion}")


def _first_supporting_evidence(
    definition: ZilchAchievementDefinition,
    facts_by_evidence: list[tuple[ZilchAchievementEvidence, dict[str, Any]]],
) -> ZilchAchievementEvidence | None:
    """Pick an auditable earliest source without changing eligibility rules."""

    for evidence, facts in sorted(
        facts_by_evidence,
        key=lambda item: (as_utc(item[0].recorded_at), int(item[0].id)),
    ):
        if _fact_individually_satisfies(definition, facts):
            return evidence
    return None


def _progress_for_definition(
    definition: ZilchAchievementDefinition, facts: list[dict[str, Any]]
) -> dict[str, int] | None:
    """Expose progress only where a stable numeric denominator exists."""

    applicable = [item for item in facts if _definition_applies(definition, item)]
    if definition.criterion == "banked_round":
        return {
            "current": max((int(item.get("highest_banked_round", 0)) for item in applicable), default=0),
            "target": int(definition.target or 0),
        }
    if definition.criterion == "win_after_zilchs":
        return {
            "current": max(
                (int(item.get("zilch_count", 0)) for item in applicable if item.get("outcome") == "win"), default=0
            ),
            "target": int(definition.target or 0),
        }
    return None


def _unlock_payload(
    unlock: ZilchAchievementUnlock,
    definition: ZilchAchievementDefinition,
    *,
    delivery: ZilchAchievementDelivery | None = None,
    progress: dict[str, int] | None = None,
) -> dict[str, Any]:
    payload = _definition_payload(definition)
    payload.update(
        {
            "unlocked_at": as_utc(unlock.unlocked_at).isoformat(),
        }
    )
    if progress is not None:
        payload["progress"] = progress
    if delivery is not None:
        payload["queued_at"] = as_utc(delivery.queued_at).isoformat()
        payload["acknowledged_at"] = (
            as_utc(delivery.acknowledged_at).isoformat() if delivery.acknowledged_at is not None else None
        )
    return payload


def _normalised_game_id(value: object) -> str:
    return _strict_text(value, "zilch_achievement_invalid_game_id", limit=64)


def _json_facts(facts: Mapping[str, Any]) -> str:
    """Persist a canonical JSON fact envelope, never a live game object."""

    try:
        return json.dumps(dict(facts), ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_invalid_evidence") from exc


def _register_evaluation(game_id: str) -> str:
    """Create pending work plus evidence once, without any historic scan.

    The transaction intentionally commits before evaluation.  If the later
    evaluation fails, the pending row survives and recovery sees exactly this
    explicitly registered source—not every old private result.
    """

    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            existing = db.scalar(
                select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id)
            )
            if existing is not None:
                return "already_registered" if existing.status == "completed" else "pending"
            game = db.scalar(
                select(CompletedGame).where(
                    CompletedGame.game_id == game_id, CompletedGame.game_type == ZILCH_GAME_TYPE
                )
            )
            if game is None:
                raise ZilchAchievementError("zilch_achievement_result_not_found")
            payload = _payload_from_completed_game(game)
            evidence_rows = _evidence_rows_for_result(db, game, payload)
            now = utcnow()
            evaluation = ZilchAchievementEvaluation(
                game_id=game_id,
                game_type=ZILCH_GAME_TYPE,
                result_schema_version=int(payload["schema_version"]),
                ruleset=str(payload["ruleset"]),
                status="pending",
                attempts=0,
                registered_at=now,
                evaluated_at=None,
                last_error=None,
            )
            db.add(evaluation)
            db.flush()
            for user_id, facts in evidence_rows:
                db.add(
                    ZilchAchievementEvidence(
                        evaluation_id=evaluation.id,
                        source_game_id=game_id,
                        user_id=user_id,
                        result_schema_version=int(facts["schema_version"]),
                        ruleset=str(facts["ruleset"]),
                        play_mode=str(facts["play_mode"]),
                        facts_json=_json_facts(facts),
                        recorded_at=now,
                    )
                )
            return "registered"
    except ZilchAchievementError:
        raise
    except IntegrityError:
        # A concurrent terminal/recovery path may have won the unique source
        # registration race.  Treat it as the same idempotent work item, not
        # as a duplicate unlock or a failed completed result.
        return "pending"
    except SQLAlchemyError as exc:
        logger.exception("Could not register Zilch achievement evaluation for %s", game_id)
        raise ZilchAchievementSyncError() from exc


def _evidence_for_user(db, user_id: int) -> list[tuple[ZilchAchievementEvidence, dict[str, Any]]]:
    rows = list(
        db.scalars(
            select(ZilchAchievementEvidence)
            .where(ZilchAchievementEvidence.user_id == user_id)
            .order_by(ZilchAchievementEvidence.recorded_at, ZilchAchievementEvidence.id)
        )
    )
    result: list[tuple[ZilchAchievementEvidence, dict[str, Any]]] = []
    for row in rows:
        facts = _facts_from_evidence(row)
        if facts is not None:
            result.append((row, facts))
    return result


def _known_unlock_rows(db, user_id: int) -> dict[str, ZilchAchievementUnlock]:
    rows = db.scalars(
        select(ZilchAchievementUnlock).where(
            ZilchAchievementUnlock.user_id == user_id,
            ZilchAchievementUnlock.achievement_key.in_(ZILCH_ACHIEVEMENT_BY_KEY),
        )
    )
    return {str(row.achievement_key): row for row in rows}


def _sync_user_achievements_in_session(db, user_id: int) -> tuple[list[dict[str, Any]], list[str]]:
    """Materialize/revoke one user's isolated Zilch awards atomically."""

    user = db.get(User, user_id)
    existing = _known_unlock_rows(db, user_id)
    if user is None or not user.is_active:
        revoked = sorted(existing)
        for unlock in existing.values():
            db.delete(unlock)
        return [], revoked
    evidence_pairs = _evidence_for_user(db, user_id)
    facts = [fact for _evidence, fact in evidence_pairs]
    newly_unlocked: list[dict[str, Any]] = []
    revoked: list[str] = []
    now = utcnow()
    for definition in ZILCH_ACHIEVEMENTS:
        should_unlock = _criterion_is_satisfied(definition, facts)
        unlock = existing.get(definition.key)
        if should_unlock and unlock is None:
            source = _first_supporting_evidence(definition, evidence_pairs)
            if source is None:
                # A malformed evidence row cannot turn into an unlock merely
                # because a broad aggregate happened to be truthy.
                continue
            unlock = ZilchAchievementUnlock(
                user_id=user_id,
                achievement_key=definition.key,
                definition_version=definition.definition_version,
                source_evidence_id=source.id,
                source_game_id=source.source_game_id,
                unlocked_at=now,
            )
            db.add(unlock)
            db.flush()
            delivery = ZilchAchievementDelivery(unlock_id=unlock.id, queued_at=now, acknowledged_at=None)
            db.add(delivery)
            newly_unlocked.append(
                _unlock_payload(
                    unlock,
                    definition,
                    delivery=delivery,
                    progress=_progress_for_definition(definition, facts),
                )
            )
        elif should_unlock and unlock is not None:
            # A later source deletion can leave the old foreign key NULL.  Do
            # not change the original unlock date or requeue the award; only
            # restore a truthful, still-valid display source.
            source = _first_supporting_evidence(definition, evidence_pairs)
            if source is not None and (
                unlock.source_evidence_id != source.id or unlock.source_game_id != source.source_game_id
            ):
                unlock.source_evidence_id = source.id
                unlock.source_game_id = source.source_game_id
        elif not should_unlock and unlock is not None:
            revoked.append(definition.key)
            db.delete(unlock)
    return newly_unlocked, revoked


def _record_evaluation_failure(game_id: str, code: str) -> None:
    """Persist a compact retry diagnostic without ever exposing raw payloads."""

    if not database_schema_ready():
        return
    try:
        with session_scope() as db:
            evaluation = db.scalar(
                select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id)
            )
            if evaluation is not None and evaluation.status == "pending":
                evaluation.attempts = max(0, int(evaluation.attempts)) + 1
                evaluation.last_error = str(code or "zilch_achievement_sync_failed")[:160]
    except SQLAlchemyError:
        logger.exception("Could not record failed Zilch achievement evaluation for %s", game_id)


def _remove_evaluation_in_session(db, game_id: str, *, user_ids: set[int]) -> None:
    """Remove stale source evidence before recomputing all affected users."""

    evidence_rows = list(
        db.scalars(select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id))
    )
    user_ids.update(int(row.user_id) for row in evidence_rows)
    # Usually evidence supplies every affected account.  Include source-linked
    # unlocks too: a process may have been interrupted after an evidence
    # foreign key was set to NULL by deletion but before its account was
    # re-synchronized.  This keeps tombstone recovery idempotent and complete.
    user_ids.update(
        int(row.user_id)
        for row in db.scalars(select(ZilchAchievementUnlock).where(ZilchAchievementUnlock.source_game_id == game_id))
    )
    for row in evidence_rows:
        db.delete(row)
    evaluations = list(
        db.scalars(select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id))
    )
    for evaluation in evaluations:
        db.delete(evaluation)
    db.flush()


def _process_registered_evaluation(game_id: str) -> ZilchAchievementRegistration:
    """Consume one pending work item in one transaction.

    The source row is revalidated before derived unlock writes.  A result that
    vanished after registration is removed from evidence rather than creating
    awards from an administrative tombstone.
    """

    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            evaluation = db.scalar(
                select(ZilchAchievementEvaluation).where(ZilchAchievementEvaluation.game_id == game_id)
            )
            if evaluation is None:
                raise ZilchAchievementError("zilch_achievement_not_registered")
            if evaluation.status == "completed":
                return ZilchAchievementRegistration(game_id, "already_evaluated", {}, pending=False)
            game = db.scalar(
                select(CompletedGame).where(
                    CompletedGame.game_id == game_id,
                    CompletedGame.game_type == ZILCH_GAME_TYPE,
                )
            )
            if game is None:
                affected: set[int] = set()
                _remove_evaluation_in_session(db, game_id, user_ids=affected)
                for user_id in affected:
                    _sync_user_achievements_in_session(db, user_id)
                return ZilchAchievementRegistration(game_id, "source_deleted", {}, pending=False)
            payload = _payload_from_completed_game(game)
            if int(payload["schema_version"]) != int(evaluation.result_schema_version) or str(
                payload["ruleset"]
            ) != str(evaluation.ruleset):
                raise ZilchAchievementError("zilch_achievement_source_changed")
            evidence = list(
                db.scalars(
                    select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.evaluation_id == evaluation.id)
                )
            )
            affected = {int(row.user_id) for row in evidence}
            new_unlocks: dict[int, list[dict[str, Any]]] = {}
            for user_id in sorted(affected):
                unlocked, _revoked = _sync_user_achievements_in_session(db, user_id)
                if unlocked:
                    new_unlocks[user_id] = unlocked
            evaluation.status = "completed"
            evaluation.attempts = max(0, int(evaluation.attempts)) + 1
            evaluation.evaluated_at = utcnow()
            evaluation.last_error = None
            return ZilchAchievementRegistration(game_id, "evaluated", new_unlocks, pending=False)
    except ZilchAchievementError as exc:
        _record_evaluation_failure(game_id, exc.code)
        raise ZilchAchievementSyncError(exc.code) from exc
    except IntegrityError as exc:
        _record_evaluation_failure(game_id, "zilch_achievement_concurrent_sync")
        raise ZilchAchievementSyncError("zilch_achievement_concurrent_sync") from exc
    except SQLAlchemyError as exc:
        logger.exception("Could not evaluate registered Zilch achievement source %s", game_id)
        _record_evaluation_failure(game_id, "zilch_achievement_sync_failed")
        raise ZilchAchievementSyncError() from exc


def register_zilch_result_for_achievements(game_id: object) -> ZilchAchievementRegistration:
    """Register and synchronously evaluate one newly persisted Zilch result.

    This is an internal finalizer boundary, not a browser/API operation.  It
    never enumerates historic completed games; repeated calls for the same
    durable game ID simply finish the one existing pending work item.
    """

    normalized_game_id = _normalised_game_id(game_id)
    try:
        registration_status = _register_evaluation(normalized_game_id)
    except ZilchAchievementError as exc:
        # A completed result remains authoritative even if an award-specific
        # validator finds an ineligible or damaged source.  Present the
        # finalizer with one controlled retryable contract instead of leaking
        # an implementation exception through the terminal WebSocket path.
        _record_evaluation_failure(normalized_game_id, exc.code)
        raise ZilchAchievementSyncError(exc.code) from exc
    result = _process_registered_evaluation(normalized_game_id)
    if registration_status == "already_registered" and result.status == "already_evaluated":
        return result
    return result


def recover_pending_zilch_achievement_evaluations(
    limit: object = ZILCH_ACHIEVEMENT_RECOVERY_DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Retry only explicitly registered pending items, never old results."""

    try:
        requested_limit = int(limit)
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_invalid_recovery_limit") from exc
    if requested_limit < 1:
        raise ZilchAchievementError("zilch_achievement_invalid_recovery_limit")
    requested_limit = min(requested_limit, ZILCH_ACHIEVEMENT_RECOVERY_MAX_LIMIT)
    if not database_schema_ready():
        return {"processed": 0, "completed": [], "failed": []}
    try:
        with session_scope() as db:
            game_ids = list(
                db.scalars(
                    select(ZilchAchievementEvaluation.game_id)
                    .where(ZilchAchievementEvaluation.status == "pending")
                    .order_by(ZilchAchievementEvaluation.registered_at, ZilchAchievementEvaluation.id)
                    .limit(requested_limit)
                )
            )
    except SQLAlchemyError as exc:
        logger.exception("Could not load pending Zilch achievement evaluations")
        raise ZilchAchievementSyncError() from exc
    completed: list[str] = []
    failed: list[dict[str, str]] = []
    for game_id in game_ids:
        try:
            result = _process_registered_evaluation(str(game_id))
            if not result.pending:
                completed.append(str(game_id))
        except ZilchAchievementSyncError as exc:
            failed.append({"game_id": str(game_id), "code": exc.code})
    return {"processed": len(game_ids), "completed": completed, "failed": failed}


def remove_zilch_result_from_achievements(
    game_id: object,
    user_ids: Iterable[object] | None = None,
) -> dict[str, Any]:
    """Purge one deleted result's evidence and revoke unsupported awards.

    Call this after an administrative typed Zilch deletion.  Evidence is not
    foreign-key-linked to ``CompletedGame`` by design: we need its affected
    user IDs long enough to recompute and remove unlocks/deliveries in the
    same durable operation.
    """

    normalized_game_id = _normalised_game_id(game_id)
    supplied_users: set[int] = set()
    for raw_user_id in user_ids or ():
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            supplied_users.add(user_id)
    if not database_schema_ready():
        return {"game_id": normalized_game_id, "affected_user_ids": [], "revoked_by_user": {}}
    try:
        with session_scope() as db:
            affected = set(supplied_users)
            _remove_evaluation_in_session(db, normalized_game_id, user_ids=affected)
            revoked_by_user: dict[int, list[str]] = {}
            for user_id in sorted(affected):
                _newly_unlocked, revoked = _sync_user_achievements_in_session(db, user_id)
                if revoked:
                    revoked_by_user[user_id] = revoked
            return {
                "game_id": normalized_game_id,
                "affected_user_ids": sorted(affected),
                "revoked_by_user": revoked_by_user,
            }
    except SQLAlchemyError as exc:
        logger.exception("Could not remove deleted Zilch achievement source %s", normalized_game_id)
        raise ZilchAchievementSyncError() from exc


def recover_deleted_zilch_achievement_sources(
    limit: object = ZILCH_ACHIEVEMENT_TOMBSTONE_RECOVERY_DEFAULT_LIMIT,
) -> dict[str, Any]:
    """Boundedly complete cleanup for already-tombstoned Zilch results.

    A completed-result deletion and the isolated evidence cleanup deliberately
    use separate durable boundaries.  If the latter briefly fails, the
    ``DeletedGame`` tombstone is the only permitted recovery source.  This
    function never enumerates ordinary ``CompletedGame`` rows and therefore
    cannot create retroactive Zilch awards.
    """

    try:
        requested_limit = int(limit)
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_invalid_tombstone_recovery_limit") from exc
    if requested_limit < 1:
        raise ZilchAchievementError("zilch_achievement_invalid_tombstone_recovery_limit")
    requested_limit = min(requested_limit, ZILCH_ACHIEVEMENT_TOMBSTONE_RECOVERY_MAX_LIMIT)
    if not database_schema_ready():
        return {"processed": 0, "cleaned": [], "failed": []}

    try:
        with session_scope() as db:
            stale_source_ids = list(
                db.scalars(
                    select(DeletedGame.game_id)
                    .where(
                        DeletedGame.game_type == ZILCH_GAME_TYPE,
                        or_(
                            DeletedGame.game_id.in_(select(ZilchAchievementEvaluation.game_id)),
                            DeletedGame.game_id.in_(select(ZilchAchievementEvidence.source_game_id)),
                            DeletedGame.game_id.in_(
                                select(ZilchAchievementUnlock.source_game_id).where(
                                    ZilchAchievementUnlock.source_game_id.is_not(None)
                                )
                            ),
                        ),
                    )
                    .order_by(DeletedGame.deleted_at, DeletedGame.id)
                    .limit(requested_limit)
                )
            )
    except SQLAlchemyError as exc:
        logger.exception("Could not load tombstoned Zilch achievement sources")
        raise ZilchAchievementSyncError() from exc

    cleaned: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for game_id in stale_source_ids:
        normalized_game_id = str(game_id)
        try:
            cleaned.append(remove_zilch_result_from_achievements(normalized_game_id))
        except ZilchAchievementSyncError as exc:
            failed.append({"game_id": normalized_game_id, "code": exc.code})
    return {"processed": len(stale_source_ids), "cleaned": cleaned, "failed": failed}


def _profile_in_session(db, user_id: int) -> dict[str, Any]:
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise ZilchAchievementError("zilch_achievement_user_not_found")
    evidence_pairs = _evidence_for_user(db, user_id)
    facts = [fact for _evidence, fact in evidence_pairs]
    unlocks = _known_unlock_rows(db, user_id)
    unlocked: list[dict[str, Any]] = []
    locked: list[dict[str, Any]] = []
    for definition in ZILCH_ACHIEVEMENTS:
        progress = _progress_for_definition(definition, facts)
        row = unlocks.get(definition.key)
        if row is None:
            payload = _definition_payload(definition)
            if progress is not None:
                payload["progress"] = progress
            locked.append(payload)
            continue
        unlocked.append(
            _unlock_payload(
                row,
                definition,
                progress=progress,
            )
        )
    unlocked.sort(key=lambda item: item["unlocked_at"], reverse=True)
    return {
        "version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION,
        "player": {"id": int(user.id), "username": str(user.username)},
        "categories": [
            {"key": category, "title_key": f"zilch.achievement.category.{category}"}
            for category in ZILCH_ACHIEVEMENT_CATEGORIES
        ],
        "unlocked": unlocked,
        "locked": locked,
    }


def get_zilch_achievement_profile(user_id: object) -> dict[str, Any]:
    """Return one private account's isolated Zilch award collection."""

    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_user_not_found") from exc
    if normalized_user_id < 1:
        raise ZilchAchievementError("zilch_achievement_user_not_found")
    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            return _profile_in_session(db, normalized_user_id)
    except ZilchAchievementError:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Could not load Zilch achievement profile for user %s", normalized_user_id)
        raise ZilchAchievementSyncError() from exc


def pending_zilch_awards(user_id: object) -> dict[str, Any]:
    """Return unacknowledged, already persisted awards in stable queue order."""

    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_user_not_found") from exc
    if normalized_user_id < 1:
        raise ZilchAchievementError("zilch_achievement_user_not_found")
    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            user = db.get(User, normalized_user_id)
            if user is None or not user.is_active:
                raise ZilchAchievementError("zilch_achievement_user_not_found")
            rows = db.execute(
                select(ZilchAchievementDelivery, ZilchAchievementUnlock)
                .join(ZilchAchievementUnlock, ZilchAchievementUnlock.id == ZilchAchievementDelivery.unlock_id)
                .where(
                    ZilchAchievementUnlock.user_id == normalized_user_id,
                    ZilchAchievementDelivery.acknowledged_at.is_(None),
                )
                .order_by(ZilchAchievementDelivery.queued_at, ZilchAchievementDelivery.id)
            ).all()
            awards: list[dict[str, Any]] = []
            for delivery, unlock in rows:
                definition = ZILCH_ACHIEVEMENT_BY_KEY.get(str(unlock.achievement_key))
                if definition is None:
                    continue
                awards.append(_unlock_payload(unlock, definition, delivery=delivery))
            return {"version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION, "awards": awards}
    except ZilchAchievementError:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Could not load pending Zilch awards for user %s", normalized_user_id)
        raise ZilchAchievementSyncError() from exc


def acknowledge_zilch_award(user_id: object, achievement_key: object) -> dict[str, Any]:
    """Idempotently acknowledge one already unlocked private Zilch award."""

    try:
        normalized_user_id = int(user_id)
    except (TypeError, ValueError) as exc:
        raise ZilchAchievementError("zilch_achievement_user_not_found") from exc
    if normalized_user_id < 1:
        raise ZilchAchievementError("zilch_achievement_user_not_found")
    normalized_key = _strict_text(achievement_key, "zilch_achievement_unknown_key", limit=96)
    if normalized_key not in ZILCH_ACHIEVEMENT_BY_KEY:
        raise ZilchAchievementError("zilch_achievement_unknown_key")
    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            user = db.get(User, normalized_user_id)
            if user is None or not user.is_active:
                raise ZilchAchievementError("zilch_achievement_user_not_found")
            unlock = db.scalar(
                select(ZilchAchievementUnlock).where(
                    ZilchAchievementUnlock.user_id == normalized_user_id,
                    ZilchAchievementUnlock.achievement_key == normalized_key,
                )
            )
            if unlock is None:
                raise ZilchAchievementError("zilch_achievement_not_unlocked")
            delivery = db.scalar(
                select(ZilchAchievementDelivery).where(ZilchAchievementDelivery.unlock_id == unlock.id)
            )
            if delivery is None:
                raise ZilchAchievementError("zilch_achievement_delivery_missing")
            if delivery.acknowledged_at is None:
                delivery.acknowledged_at = utcnow()
            return {
                "key": normalized_key,
                "acknowledged_at": as_utc(delivery.acknowledged_at).isoformat(),
            }
    except ZilchAchievementError:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Could not acknowledge Zilch award %s for user %s", normalized_key, normalized_user_id)
        raise ZilchAchievementSyncError() from exc
