"""Private, server-derived Zilch achievements and reload-safe award delivery.

This module is intentionally isolated from :mod:`app.achievements`: the
existing module owns public ZDWA achievements, Ehrenberg marks, account ranks,
and public profiles.  Zilch awards use their own ``zilch.*`` namespace,
durable tables, points, and rank ladder and never influence a shared title.

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
from math import ceil
from typing import Any, Final, Iterable, Mapping

from sqlalchemy import and_, or_, select, update
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
    ZilchCommunityGame,
    ZilchCommunityMilestone,
    ZilchCommunityParticipant,
    ZilchCommunityRecipient,
    ZilchCommunityState,
)
from .security import as_utc, utcnow
from .zilch_cpu_strategy import ZILCH_CPU_STRATEGIES
from .zilch_engine import ZILCH_RULESET_VERSION, ZILCH_TARGET_SCORE
from .zilch_results import validate_stored_zilch_result_payload
from .zilch_solo_objective import ZILCH_SOLO_SPRINT_OBJECTIVE_ID, ZILCH_SOLO_SPRINT_OBJECTIVE_VERSION

logger = logging.getLogger(__name__)

ZILCH_ACHIEVEMENT_RESPONSE_VERSION: Final = 2
# Version 3 keeps the public catalog payload at version 2, but guarantees that
# installations which already ran the first expanded-catalog materialization
# retry once with source-backed evidence enrichment.
ZILCH_ACHIEVEMENT_CATALOG_VERSION: Final = 3
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
    points: int
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


@dataclass(frozen=True)
class ZilchAchievementRank:
    """One Zilch-only title tier derived from Zilch achievement points."""

    key: str
    title: str
    stars: int
    reference_minimum_points: int


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
    points: int,
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
        points=int(points),
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
        points=1,
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
        points=2,
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
        points=1,
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
        points=1,
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
        points=2,
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
        points=4,
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
        points=2,
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
        points=1,
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
        points=2,
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
        points=3,
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
        points=4,
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
        points=5,
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
        points=4,
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
        points=3,
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
        points=4,
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
        points=2,
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
        points=2,
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
        points=4,
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
        points=5,
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
        points=6,
    ),
    _definition(
        "games_played_5",
        category="milestones",
        icon_key="games",
        title_de="Stammplatz I",
        title_en="Table Regular I",
        description_de="5 Zilch-Partien erfolgreich abgeschlossen.",
        description_en="Successfully complete 5 Zilch games.",
        criterion="games_played",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=1,
        target=5,
    ),
    _definition(
        "games_played_25",
        category="milestones",
        icon_key="games",
        title_de="Stammplatz II",
        title_en="Table Regular II",
        description_de="25 Zilch-Partien erfolgreich abgeschlossen.",
        description_en="Successfully complete 25 Zilch games.",
        criterion="games_played",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=2,
        target=25,
    ),
    _definition(
        "games_played_100",
        category="milestones",
        icon_key="games",
        title_de="Hundert am Tisch",
        title_en="Century at the Table",
        description_de="100 Zilch-Partien erfolgreich abgeschlossen.",
        description_en="Successfully complete 100 Zilch games.",
        criterion="games_played",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=4,
        target=100,
    ),
    _definition(
        "games_played_500",
        category="milestones",
        icon_key="games",
        title_de="Teil des Inventars",
        title_en="Part of the Furniture",
        description_de="500 Zilch-Partien erfolgreich abgeschlossen.",
        description_en="Successfully complete 500 Zilch games.",
        criterion="games_played",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=8,
        target=500,
    ),
    _definition(
        "career_banked_50000",
        category="milestones",
        icon_key="paper",
        title_de="Kleine Kasse",
        title_en="Fifty Thousand Banked",
        description_de="In abgeschlossenen Partien insgesamt 50’000 Punkte gesichert.",
        description_en="Bank a total of 50,000 points in completed games.",
        criterion="career_banked_points",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=2,
        target=50_000,
    ),
    _definition(
        "career_banked_250000",
        category="milestones",
        icon_key="paper",
        title_de="Volle Kasse",
        title_en="Quarter Million Banked",
        description_de="In abgeschlossenen Partien insgesamt 250’000 Punkte gesichert.",
        description_en="Bank a total of 250,000 points in completed games.",
        criterion="career_banked_points",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=4,
        target=250_000,
    ),
    _definition(
        "career_banked_1000000",
        category="milestones",
        icon_key="star",
        title_de="Millionenblock",
        title_en="Million-Point Ledger",
        description_de="In abgeschlossenen Partien insgesamt 1’000’000 Punkte gesichert.",
        description_en="Bank a total of 1,000,000 points in completed games.",
        criterion="career_banked_points",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=9,
        target=1_000_000,
    ),
    _definition(
        "competitive_wins_10",
        category="milestones",
        icon_key="duel",
        title_de="Zehn Siege",
        title_en="Ten Victories",
        description_de="10 Partien gegen Menschen oder die CPU gewonnen.",
        description_en="Win 10 games against humans or the CPU.",
        criterion="competitive_wins",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=2,
        target=10,
    ),
    _definition(
        "competitive_wins_50",
        category="milestones",
        icon_key="duel",
        title_de="Seriensieger",
        title_en="Serial Victor",
        description_de="50 Partien gegen Menschen oder die CPU gewonnen.",
        description_en="Win 50 games against humans or the CPU.",
        criterion="competitive_wins",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=6,
        target=50,
    ),
    _definition(
        "banked_round_2500",
        category="scoring",
        icon_key="star",
        title_de="Gross angeschrieben",
        title_en="Big Entry",
        description_de="2’500 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 2,500 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=5,
        target=2_500,
    ),
    _definition(
        "banked_round_3000",
        category="scoring",
        icon_key="star",
        title_de="Dreitausender",
        title_en="Three Grand",
        description_de="3’000 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 3,000 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=6,
        target=3_000,
    ),
    _definition(
        "banked_round_4000",
        category="scoring",
        icon_key="star",
        title_de="Vier auf einen Streich",
        title_en="Four Grand Turn",
        description_de="4’000 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 4,000 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=8,
        target=4_000,
    ),
    _definition(
        "banked_round_5000",
        category="scoring",
        icon_key="star",
        title_de="Halbe Miete",
        title_en="Halfway in One",
        description_de="5’000 Punkte oder mehr in einer Runde gesichert.",
        description_en="Bank 5,000 points or more in one round.",
        criterion="banked_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=10,
        target=5_000,
    ),
    _definition(
        "hot_dice_3_one_game",
        category="combinations",
        icon_key="flame",
        title_de="Dreifach heiss",
        title_en="Triple Heat",
        description_de="In einer Partie mindestens dreimal Hot Dice ausgelöst.",
        description_en="Trigger Hot Dice at least three times in one game.",
        criterion="hot_dice_in_game",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=3,
        target=3,
        requires_complete_history=True,
    ),
    _definition(
        "hot_dice_5_one_game",
        category="combinations",
        icon_key="flame",
        title_de="Feuerlauf",
        title_en="Hot Streak",
        description_de="In einer Partie mindestens fünfmal Hot Dice ausgelöst.",
        description_en="Trigger Hot Dice at least five times in one game.",
        criterion="hot_dice_in_game",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=6,
        target=5,
        requires_complete_history=True,
    ),
    _definition(
        "three_four_digit_banks",
        category="scoring",
        icon_key="paper",
        title_de="Dreifach vierstellig",
        title_en="Triple Four Digits",
        description_de="In einer Partie drei Runden mit je mindestens 1’000 Punkten gesichert.",
        description_en="Bank at least 1,000 points in three rounds of one game.",
        criterion="three_four_digit_banks",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=5,
    ),
    _definition(
        "win_without_zilch",
        category="risk",
        icon_key="shield",
        title_de="Saubere Weste",
        title_en="Clean Sheet",
        description_de="Eine Partie gegen einen Menschen oder die CPU ohne eigenen Zilch gewonnen.",
        description_en="Win against a human or the CPU without a Zilch of your own.",
        criterion="win_without_zilch",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=4,
    ),
    _definition(
        "win_with_five_zilchs",
        category="risk",
        icon_key="comeback",
        title_de="Fünfmal gefallen",
        title_en="Five Falls, Still Standing",
        description_de="Eine Partie trotz mindestens fünf eigener Zilchs gewonnen.",
        description_en="Win a game despite at least five Zilchs of your own.",
        criterion="win_after_zilchs",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=6,
        target=5,
    ),
    _definition(
        "win_with_ten_zilchs",
        category="risk",
        icon_key="comeback",
        title_de="Unkaputtbar",
        title_en="Unbreakable",
        description_de="Eine Partie trotz mindestens zehn eigener Zilchs gewonnen.",
        description_en="Win a game despite at least ten Zilchs of your own.",
        criterion="win_after_zilchs",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=10,
        target=10,
    ),
    _definition(
        "ten_zilchs_one_game",
        category="risk",
        icon_key="flame",
        title_de="Zilch-Magnet",
        title_en="Zilch Magnet",
        description_de="In einer abgeschlossenen Partie mindestens zehn Zilchs geworfen.",
        description_en="Roll at least ten Zilchs in one completed game.",
        criterion="zilchs_in_game",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=4,
        target=10,
    ),
    _definition(
        "win_after_two_penalties",
        category="risk",
        icon_key="comeback",
        title_de="Tausend zurückgeholt",
        title_en="A Thousand Recovered",
        description_de="Nach insgesamt mindestens 1’000 Punkten Zilch-Strafe gewonnen.",
        description_en="Win after receiving at least 1,000 points in Zilch penalties.",
        criterion="win_after_penalty_points",
        eligible_modes={"multiplayer", "cpu"},
        result_schema_versions={1},
        points=6,
        target=1_000,
    ),
    _definition(
        "lost_round_2000",
        category="risk",
        icon_key="flame",
        title_de="Alles verzockt",
        title_en="All Gone",
        description_de="Durch einen Zilch mindestens 2’000 ungesicherte Punkte verloren.",
        description_en="Lose at least 2,000 unbanked points to one Zilch.",
        criterion="discarded_round",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=6,
        target=2_000,
    ),
    _definition(
        "hvh_margin_500",
        category="multiplayer",
        icon_key="duel",
        title_de="Klarer Tisch",
        title_en="Clear Win",
        description_de="Ein Duell mit mindestens 500 Punkten Vorsprung gewonnen.",
        description_en="Win a human duel by at least 500 points.",
        criterion="hvh_margin",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=2,
        target=500,
    ),
    _definition(
        "hvh_margin_1000",
        category="multiplayer",
        icon_key="duel",
        title_de="Tausend voraus",
        title_en="A Thousand Ahead",
        description_de="Ein Duell mit mindestens 1’000 Punkten Vorsprung gewonnen.",
        description_en="Win a human duel by at least 1,000 points.",
        criterion="hvh_margin",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=4,
        target=1_000,
    ),
    _definition(
        "hvh_margin_2500",
        category="multiplayer",
        icon_key="duel",
        title_de="Abgehängt",
        title_en="Left Behind",
        description_de="Ein Duell mit mindestens 2’500 Punkten Vorsprung gewonnen.",
        description_en="Win a human duel by at least 2,500 points.",
        criterion="hvh_margin",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=7,
        target=2_500,
    ),
    _definition(
        "first_two_triples",
        category="combinations",
        icon_key="pairs",
        title_de="Doppelpack",
        title_en="Twin Triples",
        description_de="Zum ersten Mal zwei verschiedene Drillinge gleichzeitig gehalten.",
        description_en="Hold two different triples at the same time for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=6,
        target=4,
        requires_complete_history=True,
    ),
    _definition(
        "hvh_close_win_100",
        category="multiplayer",
        icon_key="target",
        title_de="Hauchdünn",
        title_en="By a Whisker",
        description_de="Ein Duell mit höchstens 100 Punkten Vorsprung gewonnen.",
        description_en="Win a human duel by no more than 100 points.",
        criterion="hvh_close_win",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=3,
        target=100,
    ),
    _definition(
        "hvh_comeback_1000",
        category="multiplayer",
        icon_key="comeback",
        title_de="Kleine Aufholjagd",
        title_en="Comeback I",
        description_de="Ein Duell nach mindestens 1’000 Punkten Rückstand gewonnen.",
        description_en="Win a human duel after trailing by at least 1,000 points.",
        criterion="hvh_comeback",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=4,
        target=1_000,
    ),
    _definition(
        "hvh_comeback_2000",
        category="multiplayer",
        icon_key="comeback",
        title_de="Grosse Aufholjagd",
        title_en="Comeback II",
        description_de="Ein Duell nach mindestens 2’000 Punkten Rückstand gewonnen.",
        description_en="Win a human duel after trailing by at least 2,000 points.",
        criterion="hvh_comeback",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=7,
        target=2_000,
    ),
    _definition(
        "hvh_comeback_3000",
        category="multiplayer",
        icon_key="comeback",
        title_de="Vom Abgrund zurück",
        title_en="Comeback III",
        description_de="Ein Duell nach mindestens 3’000 Punkten Rückstand gewonnen.",
        description_en="Win a human duel after trailing by at least 3,000 points.",
        criterion="hvh_comeback",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=10,
        target=3_000,
    ),
    _definition(
        "hvh_start_roll_reversal",
        category="multiplayer",
        icon_key="comeback",
        title_de="Zweiter Start, erstes Ziel",
        title_en="Second Off, First Home",
        description_de="Den Startwurf verloren und das Duell trotzdem gewonnen.",
        description_en="Lose the opening roll and still win the human duel.",
        criterion="hvh_start_roll_reversal",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=3,
    ),
    _definition(
        "hvh_win_under_20_turns",
        category="multiplayer",
        icon_key="flag",
        title_de="Kurze Partie",
        title_en="Quick Match",
        description_de="Ein Duell in höchstens 20 abgeschlossenen Gesamtzügen gewonnen.",
        description_en="Win a human duel in no more than 20 completed turns overall.",
        criterion="hvh_max_game_turns",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=5,
        target=20,
    ),
    _definition(
        "hvh_win_under_14_turns",
        category="multiplayer",
        icon_key="flag",
        title_de="Blitzduell",
        title_en="Lightning Duel",
        description_de="Ein Duell in höchstens 14 abgeschlossenen Gesamtzügen gewonnen.",
        description_en="Win a human duel in no more than 14 completed turns overall.",
        criterion="hvh_max_game_turns",
        eligible_modes={"multiplayer"},
        result_schema_versions={1},
        points=9,
        target=14,
    ),
    _definition(
        "solo_under_25_turns",
        category="solo",
        icon_key="flag",
        title_de="Flotter Block",
        title_en="Quick Ledger",
        description_de="Den Solo-Sprint in höchstens 25 Zügen abgeschlossen.",
        description_en="Complete the Solo Sprint in no more than 25 turns.",
        criterion="solo_max_turns",
        eligible_modes={"solo"},
        result_schema_versions={2},
        points=2,
        target=25,
    ),
    _definition(
        "solo_under_18_turns",
        category="solo",
        icon_key="flag",
        title_de="Sprinter",
        title_en="Sprinter",
        description_de="Den Solo-Sprint in höchstens 18 Zügen abgeschlossen.",
        description_en="Complete the Solo Sprint in no more than 18 turns.",
        criterion="solo_max_turns",
        eligible_modes={"solo"},
        result_schema_versions={2},
        points=5,
        target=18,
    ),
    _definition(
        "solo_under_12_turns",
        category="solo",
        icon_key="flag",
        title_de="Blitzpartie",
        title_en="Lightning Run",
        description_de="Den Solo-Sprint in höchstens 12 Zügen abgeschlossen.",
        description_en="Complete the Solo Sprint in no more than 12 turns.",
        criterion="solo_max_turns",
        eligible_modes={"solo"},
        result_schema_versions={2},
        points=10,
        target=12,
    ),
    _definition(
        "solo_under_40_rolls",
        category="solo",
        icon_key="die",
        title_de="Kurzer Weg",
        title_en="Short Route",
        description_de="Den Solo-Sprint in höchstens 40 Würfen abgeschlossen.",
        description_en="Complete the Solo Sprint in no more than 40 rolls.",
        criterion="solo_max_rolls",
        eligible_modes={"solo"},
        result_schema_versions={2},
        points=4,
        target=40,
    ),
    _definition(
        "solo_under_30_rolls",
        category="solo",
        icon_key="die",
        title_de="Direkter Weg",
        title_en="Direct Route",
        description_de="Den Solo-Sprint in höchstens 30 Würfen abgeschlossen.",
        description_en="Complete the Solo Sprint in no more than 30 rolls.",
        criterion="solo_max_rolls",
        eligible_modes={"solo"},
        result_schema_versions={2},
        points=7,
        target=30,
    ),
    _definition(
        "first_double_triple",
        category="combinations",
        icon_key="star",
        title_de="Sechslinge",
        title_en="Six of a Kind",
        description_de="Zum ersten Mal sechs gleiche Würfel als zwei Drillinge gehalten.",
        description_en="Hold six matching dice as two triples for the first time.",
        criterion="combination",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=10,
        target=5,
        requires_complete_history=True,
    ),
    _definition(
        "community_games_100",
        category="community",
        icon_key="star",
        title_de="Die ersten Hundert",
        title_en="The First Hundred",
        description_de="Die Zilch-Community hat gemeinsam 100 Partien abgeschlossen.",
        description_en="The Zilch community has completed 100 games together.",
        criterion="community_games",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=0,
        target=100,
    ),
    _definition(
        "community_games_500",
        category="community",
        icon_key="star",
        title_de="Das Wirtshaus füllt sich",
        title_en="The House Is Filling Up",
        description_de="Die Zilch-Community hat gemeinsam 500 Partien abgeschlossen.",
        description_en="The Zilch community has completed 500 games together.",
        criterion="community_games",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=0,
        target=500,
    ),
    _definition(
        "community_games_1000",
        category="community",
        icon_key="star",
        title_de="Tausend Partien",
        title_en="One Thousand Games",
        description_de="Die Zilch-Community hat gemeinsam 1’000 Partien abgeschlossen.",
        description_en="The Zilch community has completed 1,000 games together.",
        criterion="community_games",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=0,
        target=1_000,
    ),
    _definition(
        "community_games_5000",
        category="community",
        icon_key="star",
        title_de="Volles Haus",
        title_en="Full House",
        description_de="Die Zilch-Community hat gemeinsam 5’000 Partien abgeschlossen.",
        description_en="The Zilch community has completed 5,000 games together.",
        criterion="community_games",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=0,
        target=5_000,
    ),
    _definition(
        "community_games_10000",
        category="community",
        icon_key="star",
        title_de="Zehntausender-Tisch",
        title_en="Ten-Thousand Table",
        description_de="Die Zilch-Community hat gemeinsam 10’000 Partien abgeschlossen.",
        description_en="The Zilch community has completed 10,000 games together.",
        criterion="community_games",
        eligible_modes=_KNOWN_PLAY_MODES,
        result_schema_versions=_KNOWN_RESULT_SCHEMAS,
        points=0,
        target=10_000,
    ),
)

ZILCH_ACHIEVEMENT_BY_KEY: Final[dict[str, ZilchAchievementDefinition]] = {
    definition.key: definition for definition in ZILCH_ACHIEVEMENTS
}
ZILCH_ACHIEVEMENT_CATEGORIES: Final[tuple[str, ...]] = (
    "entry",
    "milestones",
    "scoring",
    "combinations",
    "risk",
    "multiplayer",
    "cpu",
    "solo",
    "community",
)
_COMBINATION_BY_TARGET: Final[dict[int, str]] = {
    0: "straight",
    1: "three_pairs",
    2: "nothing_bonus",
    3: "three_ones",
    4: "two_triples",
    5: "double_triple",
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
        if definition.criterion == "community_games":
            if definition.points != 0:
                raise RuntimeError("Community achievements must award zero points.")
        elif not 1 <= definition.points <= 10:
            raise RuntimeError("Personal Zilch achievements must award between one and ten points.")
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

ZILCH_ACHIEVEMENT_POINTS_BY_KEY: Final[dict[str, int]] = {
    definition.key: definition.points for definition in ZILCH_ACHIEVEMENTS
}
ZILCH_ACHIEVEMENT_POINTS_POSSIBLE: Final[int] = sum(ZILCH_ACHIEVEMENT_POINTS_BY_KEY.values())

# Use the same proportional ladder and star language as ZDWA while keeping the
# currency and title calculation in this isolated Zilch namespace.
_ZILCH_RANK_REFERENCE_MAXIMUM: Final = 451
ZILCH_ACHIEVEMENT_RANKS: Final[tuple[ZilchAchievementRank, ...]] = (
    ZilchAchievementRank("newbie", "Newbie", 0, 0),
    ZilchAchievementRank("rookie", "Rookie", 1, 10),
    ZilchAchievementRank("player", "Spieler", 2, 35),
    ZilchAchievementRank("advanced", "Fortgeschritten", 2, 75),
    ZilchAchievementRank("pro", "Pro", 3, 120),
    ZilchAchievementRank("expert", "Experte", 3, 170),
    ZilchAchievementRank("master", "Meister", 4, 230),
    ZilchAchievementRank("elite", "Elite", 4, 300),
    ZilchAchievementRank("legend", "Legende", 5, 375),
    ZilchAchievementRank("godmode", "Godmode", 5, 430),
)


def _zilch_rank_minimum_points(rank: ZilchAchievementRank) -> int:
    if rank.reference_minimum_points <= 0:
        return 0
    return ceil(
        ZILCH_ACHIEVEMENT_POINTS_POSSIBLE
        * rank.reference_minimum_points
        / _ZILCH_RANK_REFERENCE_MAXIMUM
    )


def zilch_achievement_points_for_keys(keys: Iterable[str]) -> int:
    """Return a duplicate-safe Zilch-only achievement score."""

    return sum(ZILCH_ACHIEVEMENT_POINTS_BY_KEY.get(str(key), 0) for key in set(keys))


def zilch_achievement_rank_for_points(points: int | float | None) -> dict[str, Any]:
    """Project one Zilch title without consulting any ZDWA award state."""

    try:
        earned = min(ZILCH_ACHIEVEMENT_POINTS_POSSIBLE, max(0, int(points or 0)))
    except (TypeError, ValueError):
        earned = 0
    current_index = 0
    for index, rank in enumerate(ZILCH_ACHIEVEMENT_RANKS):
        if earned >= _zilch_rank_minimum_points(rank):
            current_index = index
        else:
            break
    current = ZILCH_ACHIEVEMENT_RANKS[current_index]
    next_rank = (
        ZILCH_ACHIEVEMENT_RANKS[current_index + 1]
        if current_index + 1 < len(ZILCH_ACHIEVEMENT_RANKS)
        else None
    )
    next_minimum = _zilch_rank_minimum_points(next_rank) if next_rank is not None else None
    return {
        "key": current.key,
        "title": current.title,
        "title_key": f"zilch.rank.{current.key}",
        "stars": current.stars,
        "points": earned,
        "points_possible": ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
        "minimum_points": _zilch_rank_minimum_points(current),
        "next_minimum_points": next_minimum,
        "points_to_next_rank": max(0, next_minimum - earned) if next_minimum is not None else 0,
    }


def zilch_achievement_rank_legend_payload(points: int | float | None = None) -> dict[str, Any]:
    """Return the stable Zilch rank ladder and optionally a current rank."""

    payload: dict[str, Any] = {
        "version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION,
        "points_possible": ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
        "ranks": [
            {
                "key": rank.key,
                "title": rank.title,
                "title_key": f"zilch.rank.{rank.key}",
                "stars": rank.stars,
                "minimum_points": _zilch_rank_minimum_points(rank),
            }
            for rank in ZILCH_ACHIEVEMENT_RANKS
        ],
    }
    if points is not None:
        payload["current"] = zilch_achievement_rank_for_points(points)
    return payload


def zilch_achievement_rank_payloads_for_user_ids(db, user_ids: Iterable[int]) -> dict[int, dict[str, Any]]:
    """Read several isolated Zilch ranks in one existing database session."""

    normalized: set[int] = set()
    for raw_user_id in user_ids:
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            normalized.add(user_id)
    ranks = {user_id: zilch_achievement_rank_for_points(0) for user_id in normalized}
    if not normalized:
        return ranks
    keys_by_user: dict[int, set[str]] = {user_id: set() for user_id in normalized}
    for user_id, key in db.execute(
        select(ZilchAchievementUnlock.user_id, ZilchAchievementUnlock.achievement_key).where(
            ZilchAchievementUnlock.user_id.in_(normalized),
            ZilchAchievementUnlock.achievement_key.in_(ZILCH_ACHIEVEMENT_BY_KEY),
        )
    ):
        keys_by_user[int(user_id)].add(str(key))
    return {
        user_id: zilch_achievement_rank_for_points(zilch_achievement_points_for_keys(keys))
        for user_id, keys in keys_by_user.items()
    }


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
    """Expose immutable catalog metadata without private result evidence."""

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
        "points": definition.points,
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
        "points_possible": ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
        "ranks": zilch_achievement_rank_legend_payload()["ranks"],
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


def _round_facts(board: object) -> dict[str, Any]:
    """Return normalized server-stored round facts; missing holds stay unknown."""

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
    max_discarded_points = 0
    roll_count = 0
    for entry in rounds:
        if not isinstance(entry, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        event = entry.get("event")
        roll_count += _strict_int(entry.get("rolls_used"), "zilch_achievement_invalid_result")
        if event == "bank":
            banked.append(_strict_int(entry.get("points"), "zilch_achievement_invalid_result"))
        elif event == "zilch":
            zilchs += 1
            penalties += _strict_int(entry.get("penalty"), "zilch_achievement_invalid_result")
            max_discarded_points = max(
                max_discarded_points,
                _strict_int(entry.get("discarded_points"), "zilch_achievement_invalid_result"),
            )
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
    return {
        "banked_rounds": banked,
        "zilch_count": zilchs,
        "zilch_penalty_points": penalties,
        "history_complete": history_complete,
        "hot_dice_events": hot_dice,
        "combination_types": sorted(combinations),
        "max_discarded_points": max_discarded_points,
        "turn_count": len(rounds),
        "roll_count": roll_count,
    }


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


def _competitive_result_facts(payload: Mapping[str, Any], participant_id: str) -> dict[str, Any]:
    """Derive opponent and score-trajectory facts from the typed two-seat log."""

    if payload.get("play_mode") not in {"multiplayer", "cpu"}:
        return {}
    participants = payload.get("participants")
    boards = payload.get("boards")
    totals = payload.get("totals")
    if not isinstance(participants, list) or not isinstance(boards, Mapping) or not isinstance(totals, Mapping):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    participant_ids = [
        str(item.get("participant_id") or "")
        for item in participants
        if isinstance(item, Mapping)
    ]
    if len(participant_ids) != 2 or participant_id not in participant_ids or any(not value for value in participant_ids):
        raise ZilchAchievementError("zilch_achievement_invalid_result")
    opponent_id = next(value for value in participant_ids if value != participant_id)
    own_final = _strict_int(totals.get(participant_id), "zilch_achievement_invalid_result")
    opponent_final = _strict_int(totals.get(opponent_id), "zilch_achievement_invalid_result")

    timeline: list[tuple[int, str, int]] = []
    seen_turn_ids: set[int] = set()
    for player_id in participant_ids:
        board = boards.get(player_id)
        rounds = board.get("rounds") if isinstance(board, Mapping) else None
        if not isinstance(rounds, list):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        for entry in rounds:
            if not isinstance(entry, Mapping):
                raise ZilchAchievementError("zilch_achievement_invalid_result")
            turn_id = _strict_int(entry.get("turn_id"), "zilch_achievement_invalid_result", minimum=1)
            if turn_id in seen_turn_ids:
                # A trajectory achievement needs one unambiguous global order.
                # Older payload validation did not require this explicitly, so
                # fail this derived fact closed instead of guessing an order.
                return {
                    "opponent_final_score": opponent_final,
                    "score_margin": own_final - opponent_final,
                    "max_deficit_before_finish": None,
                    "won_start_roll": None,
                    "game_turns": None,
                }
            seen_turn_ids.add(turn_id)
            timeline.append(
                (
                    turn_id,
                    player_id,
                    _strict_int(entry.get("total_after"), "zilch_achievement_invalid_result"),
                )
            )
    running = {player_id: 0 for player_id in participant_ids}
    max_deficit = 0
    for _turn_id, player_id, total_after in sorted(timeline):
        running[player_id] = total_after
        max_deficit = max(max_deficit, running[opponent_id] - running[participant_id])

    start_roll = payload.get("start_roll")
    start_winner = start_roll.get("winner_id") if isinstance(start_roll, Mapping) else None
    won_start_roll = start_winner == participant_id if isinstance(start_winner, str) else None
    return {
        "opponent_final_score": opponent_final,
        "score_margin": own_final - opponent_final,
        "max_deficit_before_finish": max_deficit,
        "won_start_roll": won_start_roll,
        "game_turns": len(timeline),
    }


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
    round_facts = _round_facts(board)
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
        **round_facts,
        "highest_banked_round": max(round_facts["banked_rounds"], default=0),
        "target_score": _strict_int(payload.get("target_score"), "zilch_achievement_invalid_result", minimum=1),
    }
    facts.update(_competitive_result_facts(payload, participant_id))
    if play_mode == "solo":
        objective = payload.get("objective")
        if not isinstance(objective, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        facts["objective_id"] = _strict_text(objective.get("id"), "zilch_achievement_invalid_result", limit=80)
        facts["objective_version"] = _strict_int(
            objective.get("version"), "zilch_achievement_invalid_result", minimum=1
        )
        metrics = payload.get("metrics")
        if not isinstance(metrics, Mapping):
            raise ZilchAchievementError("zilch_achievement_invalid_result")
        facts["turn_count"] = _strict_int(metrics.get("turns"), "zilch_achievement_invalid_result")
        facts["roll_count"] = _strict_int(metrics.get("rolls"), "zilch_achievement_invalid_result")
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
            or schema_version != int(row.result_schema_version)
            or ruleset != str(row.ruleset)
            or play_mode != str(row.play_mode)
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
        for optional_key in (
            "max_discarded_points",
            "turn_count",
            "roll_count",
            "opponent_final_score",
        ):
            if optional_key in facts:
                _strict_int(facts.get(optional_key), "zilch_achievement_invalid_evidence")
        if "score_margin" in facts and type(facts.get("score_margin")) is not int:
            return None
        max_deficit = facts.get("max_deficit_before_finish")
        if max_deficit is not None and (type(max_deficit) is not int or max_deficit < 0):
            return None
        won_start_roll = facts.get("won_start_roll")
        if won_start_roll is not None and type(won_start_roll) is not bool:
            return None
        game_turns = facts.get("game_turns")
        if game_turns is not None and (type(game_turns) is not int or game_turns < 0):
            return None
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


def _is_qualified_completion(facts: Mapping[str, Any]) -> bool:
    """Keep abandoned solo attempts out of every personal/global milestone."""

    if facts.get("play_mode") == "solo":
        return facts.get("outcome") == "completed"
    return facts.get("play_mode") in {"multiplayer", "cpu"} and facts.get("outcome") in {
        "win",
        "loss",
        "tie",
    }


def _criterion_is_satisfied(definition: ZilchAchievementDefinition, facts: list[dict[str, Any]]) -> bool:
    """Evaluate immutable definitions against all explicitly registered evidence."""

    if definition.criterion == "community_games":
        # Community unlocks have their own monotonic ledger and frozen source
        # recipient.  Personal evidence resync must never grant or revoke one.
        return False
    applicable = [
        item
        for item in facts
        if _definition_applies(definition, item) and _is_qualified_completion(item)
    ]
    if not applicable:
        return False
    criterion = definition.criterion
    if criterion == "first_registered_game":
        return bool(applicable)
    if criterion == "games_played":
        return len(applicable) >= int(definition.target or 0)
    if criterion == "career_banked_points":
        return sum(sum(int(value) for value in item["banked_rounds"]) for item in applicable) >= int(
            definition.target or 0
        )
    if criterion == "competitive_wins":
        return sum(item.get("outcome") == "win" for item in applicable) >= int(definition.target or 0)
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
    if criterion == "hot_dice_in_game":
        target = int(definition.target or 0)
        return any(
            item.get("hot_dice_events") is not None and int(item["hot_dice_events"]) >= target
            for item in applicable
        )
    if criterion == "three_four_digit_banks":
        return any(sum(int(points) >= 1_000 for points in item["banked_rounds"]) >= 3 for item in applicable)
    if criterion == "win_without_zilch":
        return any(item.get("outcome") == "win" and int(item["zilch_count"]) == 0 for item in applicable)
    if criterion == "win_after_zilchs":
        target = int(definition.target or 0)
        return any(item.get("outcome") == "win" and int(item["zilch_count"]) >= target for item in applicable)
    if criterion == "zilchs_in_game":
        target = int(definition.target or 0)
        return any(int(item["zilch_count"]) >= target for item in applicable)
    if criterion == "win_after_zilch_penalty":
        return any(item.get("outcome") == "win" and int(item["zilch_penalty_points"]) > 0 for item in applicable)
    if criterion == "win_after_penalty_points":
        target = int(definition.target or 0)
        return any(
            item.get("outcome") == "win" and int(item["zilch_penalty_points"]) >= target
            for item in applicable
        )
    if criterion == "discarded_round":
        target = int(definition.target or 0)
        return any(
            item.get("max_discarded_points") is not None and int(item["max_discarded_points"]) >= target
            for item in applicable
        )
    if criterion == "hvh_margin":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "multiplayer"
            and item.get("outcome") == "win"
            and item.get("score_margin") is not None
            and int(item["score_margin"]) >= target
            for item in applicable
        )
    if criterion == "hvh_close_win":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "multiplayer"
            and item.get("outcome") == "win"
            and item.get("score_margin") is not None
            and 0 < int(item["score_margin"]) <= target
            for item in applicable
        )
    if criterion == "hvh_comeback":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "multiplayer"
            and item.get("outcome") == "win"
            and item.get("max_deficit_before_finish") is not None
            and int(item["max_deficit_before_finish"]) >= target
            for item in applicable
        )
    if criterion == "hvh_start_roll_reversal":
        return any(
            item.get("play_mode") == "multiplayer"
            and item.get("outcome") == "win"
            and item.get("won_start_roll") is False
            for item in applicable
        )
    if criterion == "hvh_max_game_turns":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "multiplayer"
            and item.get("outcome") == "win"
            and item.get("game_turns") is not None
            and 0 < int(item["game_turns"]) <= target
            for item in applicable
        )
    if criterion == "solo_max_turns":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "solo"
            and item.get("turn_count") is not None
            and 0 < int(item["turn_count"]) <= target
            for item in applicable
        )
    if criterion == "solo_max_rolls":
        target = int(definition.target or 0)
        return any(
            item.get("play_mode") == "solo"
            and item.get("roll_count") is not None
            and 0 < int(item["roll_count"]) <= target
            for item in applicable
        )
    if criterion == "solo_sprint_without_zilch":
        return any(
            item.get("outcome") == "completed"
            and item.get("objective_id") == ZILCH_SOLO_SPRINT_OBJECTIVE_ID
            and int(item["zilch_count"]) == 0
            for item in applicable
        )
    raise RuntimeError(f"Unknown Zilch achievement criterion: {criterion}")


def _first_supporting_evidence(
    definition: ZilchAchievementDefinition,
    facts_by_evidence: list[tuple[ZilchAchievementEvidence, dict[str, Any]]],
) -> ZilchAchievementEvidence | None:
    """Pick an auditable earliest source without changing eligibility rules."""

    prefix: list[dict[str, Any]] = []
    for evidence, facts in sorted(
        facts_by_evidence,
        key=lambda item: (as_utc(item[0].recorded_at), int(item[0].id)),
    ):
        prefix.append(facts)
        if _criterion_is_satisfied(definition, prefix):
            return evidence
    return None


def _progress_for_definition(
    definition: ZilchAchievementDefinition,
    facts: list[dict[str, Any]],
    *,
    community_games: int | None = None,
) -> dict[str, int] | None:
    """Expose progress only where a stable numeric denominator exists."""

    if definition.criterion == "community_games":
        return {
            "current": max(0, int(community_games or 0)),
            "target": int(definition.target or 0),
        }
    applicable = [
        item
        for item in facts
        if _definition_applies(definition, item) and _is_qualified_completion(item)
    ]
    if definition.criterion == "games_played":
        current = len(applicable)
    elif definition.criterion == "career_banked_points":
        current = sum(sum(int(value) for value in item["banked_rounds"]) for item in applicable)
    elif definition.criterion == "competitive_wins":
        current = sum(item.get("outcome") == "win" for item in applicable)
    elif definition.criterion == "hot_dice_in_game":
        current = max(
            (
                int(item["hot_dice_events"])
                for item in applicable
                if item.get("hot_dice_events") is not None
            ),
            default=0,
        )
    elif definition.criterion == "three_four_digit_banks":
        current = max(
            (sum(int(points) >= 1_000 for points in item["banked_rounds"]) for item in applicable),
            default=0,
        )
        return {"current": current, "target": 3}
    elif definition.criterion == "zilchs_in_game":
        current = max((int(item["zilch_count"]) for item in applicable), default=0)
    elif definition.criterion == "win_after_penalty_points":
        current = max(
            (
                int(item["zilch_penalty_points"])
                for item in applicable
                if item.get("outcome") == "win"
            ),
            default=0,
        )
    elif definition.criterion == "discarded_round":
        current = max(
            (
                int(item["max_discarded_points"])
                for item in applicable
                if item.get("max_discarded_points") is not None
            ),
            default=0,
        )
    elif definition.criterion == "hvh_margin":
        current = max(
            (
                int(item["score_margin"])
                for item in applicable
                if item.get("outcome") == "win" and item.get("score_margin") is not None
            ),
            default=0,
        )
    elif definition.criterion == "hvh_comeback":
        current = max(
            (
                int(item["max_deficit_before_finish"])
                for item in applicable
                if item.get("outcome") == "win" and item.get("max_deficit_before_finish") is not None
            ),
            default=0,
        )
    else:
        current = None
    if definition.criterion == "banked_round":
        current = max((int(item.get("highest_banked_round", 0)) for item in applicable), default=0)
    if definition.criterion == "win_after_zilchs":
        current = max(
            (int(item.get("zilch_count", 0)) for item in applicable if item.get("outcome") == "win"),
            default=0,
        )
    if current is None:
        return None
    return {"current": int(current), "target": int(definition.target or 0)}


def _unlock_payload(
    unlock: ZilchAchievementUnlock,
    definition: ZilchAchievementDefinition,
    *,
    delivery: ZilchAchievementDelivery | None = None,
    progress: dict[str, int] | None = None,
    presentation_game_id: object | None = None,
) -> dict[str, Any]:
    source_game_id = str(unlock.source_game_id) if unlock.source_game_id else None
    projected_presentation_game_id = (
        str(presentation_game_id) if presentation_game_id else source_game_id
    )
    payload = _definition_payload(definition)
    payload.update(
        {
            # Personal source provenance remains the revocable evidence link.
            # Neither ID ever crosses the protected Zilch API.
            "source_game_id": source_game_id,
            # Presentation provenance is deliberately separate from award
            # evidence.  A global milestone is shown with the game whose
            # completion crossed the threshold, while its immutable recipient
            # remains independent of that game's later deletion.
            "presentation_game_id": projected_presentation_game_id,
            "source_kind": "community" if unlock.source_community_recipient_id is not None else "game",
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


def _community_presentation_game_ids_in_session(
    db,
    unlocks: Iterable[ZilchAchievementUnlock],
) -> dict[int, str]:
    """Map recipients to a trigger game only when they played that game."""

    recipient_ids = {
        int(unlock.source_community_recipient_id)
        for unlock in unlocks
        if unlock.source_community_recipient_id is not None
    }
    if not recipient_ids:
        return {}
    return {
        int(recipient_id): str(trigger_game_id)
        for recipient_id, trigger_game_id in db.execute(
            select(ZilchCommunityRecipient.id, ZilchCommunityMilestone.trigger_game_id)
            .join(
                ZilchCommunityMilestone,
                ZilchCommunityMilestone.id == ZilchCommunityRecipient.milestone_id,
            )
            .join(
                ZilchCommunityParticipant,
                and_(
                    ZilchCommunityParticipant.game_id == ZilchCommunityMilestone.trigger_game_id,
                    ZilchCommunityParticipant.user_id == ZilchCommunityRecipient.user_id,
                ),
            )
            .where(ZilchCommunityRecipient.id.in_(recipient_ids))
        ).all()
    }


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
            .join(
                ZilchAchievementEvaluation,
                ZilchAchievementEvaluation.id == ZilchAchievementEvidence.evaluation_id,
            )
            .where(
                ZilchAchievementEvidence.user_id == user_id,
                ZilchAchievementEvaluation.status == "completed",
                ZilchAchievementEvidence.source_game_id == ZilchAchievementEvaluation.game_id,
                ~ZilchAchievementEvidence.source_game_id.in_(
                    select(DeletedGame.game_id).where(DeletedGame.game_type == ZILCH_GAME_TYPE)
                ),
            )
            .order_by(ZilchAchievementEvidence.recorded_at, ZilchAchievementEvidence.id)
        )
    )
    result: list[tuple[ZilchAchievementEvidence, dict[str, Any]]] = []
    for row in rows:
        facts = _facts_from_evidence(row)
        if facts is not None:
            result.append((row, facts))
    return result


def _enrich_registered_evidence_for_catalog_in_session(db) -> int:
    """Refresh facts for completed, explicitly registered result sources.

    This is deliberately driven by the bounded evaluation table rather than
    by ``CompletedGame``.  Each source is loaded by the registered game id and
    must still be a valid typed Zilch result.  Existing fact values and their
    account/seat mapping are treated as an integrity seal: enrichment may add
    newly derivable fields, but it must never silently reinterpret evidence
    that no longer agrees with its source.

    Typed tombstones are excluded because their separate recovery path owns
    evidence removal.  Any other missing, malformed, or mismatched source
    aborts the surrounding catalog transaction, leaving both evidence and the
    catalog version unchanged for a safe retry.
    """

    evaluations = list(
        db.scalars(
            select(ZilchAchievementEvaluation)
            .where(
                ZilchAchievementEvaluation.game_type == ZILCH_GAME_TYPE,
                ZilchAchievementEvaluation.status == "completed",
                ~ZilchAchievementEvaluation.game_id.in_(
                    select(DeletedGame.game_id).where(DeletedGame.game_type == ZILCH_GAME_TYPE)
                ),
            )
            .order_by(ZilchAchievementEvaluation.id)
        )
    )
    enriched = 0
    for evaluation in evaluations:
        game_id = str(evaluation.game_id)
        game = db.scalar(
            select(CompletedGame).where(
                CompletedGame.game_id == game_id,
                CompletedGame.game_type == ZILCH_GAME_TYPE,
            )
        )
        if game is None:
            raise ZilchAchievementError("zilch_achievement_catalog_source_missing")
        payload = _payload_from_completed_game(game)
        if (
            int(payload["schema_version"]) != int(evaluation.result_schema_version)
            or str(payload["ruleset"]) != str(evaluation.ruleset)
        ):
            raise ZilchAchievementError("zilch_achievement_source_changed")

        evidence_rows = list(
            db.scalars(
                select(ZilchAchievementEvidence)
                .where(ZilchAchievementEvidence.evaluation_id == evaluation.id)
                .order_by(ZilchAchievementEvidence.id)
            )
        )
        evidence_by_user: dict[int, tuple[ZilchAchievementEvidence, dict[str, Any]]] = {}
        for evidence in evidence_rows:
            user_id = int(evidence.user_id)
            stored_facts = _facts_from_evidence(evidence)
            if (
                stored_facts is None
                or str(evidence.source_game_id) != game_id
                or int(evidence.result_schema_version) != int(evaluation.result_schema_version)
                or str(evidence.ruleset) != str(evaluation.ruleset)
                or user_id in evidence_by_user
            ):
                raise ZilchAchievementError("zilch_achievement_invalid_evidence")
            evidence_by_user[user_id] = (evidence, stored_facts)

        fresh_by_user: dict[int, dict[str, Any]] = {}
        for participant in game.participants:
            if participant.user_id is None:
                continue
            user_id = int(participant.user_id)
            if user_id not in evidence_by_user:
                continue
            fresh_facts = _facts_for_human_participant(payload, participant)
            if fresh_facts is None or user_id in fresh_by_user:
                raise ZilchAchievementError("zilch_achievement_evidence_user_mismatch")
            fresh_by_user[user_id] = fresh_facts
        if set(fresh_by_user) != set(evidence_by_user):
            raise ZilchAchievementError("zilch_achievement_evidence_user_mismatch")

        for user_id, (evidence, stored_facts) in evidence_by_user.items():
            fresh_facts = fresh_by_user[user_id]
            # Every pre-existing value must still be supported verbatim by the
            # source.  Only fields introduced by a newer catalog may be added.
            if any(key not in fresh_facts or fresh_facts[key] != value for key, value in stored_facts.items()):
                raise ZilchAchievementError("zilch_achievement_source_changed")
            serialized = _json_facts(fresh_facts)
            if evidence.facts_json != serialized:
                evidence.facts_json = serialized
                enriched += 1
    return enriched


def _known_unlock_rows(db, user_id: int) -> dict[str, ZilchAchievementUnlock]:
    rows = db.scalars(
        select(ZilchAchievementUnlock).where(
            ZilchAchievementUnlock.user_id == user_id,
            ZilchAchievementUnlock.achievement_key.in_(ZILCH_ACHIEVEMENT_BY_KEY),
        )
    )
    return {str(row.achievement_key): row for row in rows}


def _community_count_in_session(db) -> int:
    state = db.get(ZilchCommunityState, 1)
    return max(0, int(state.qualified_games)) if state is not None else 0


def _payload_is_qualified_completion(payload: Mapping[str, Any]) -> bool:
    """Classify only the already validated typed terminal payload."""

    outcome = payload.get("outcome")
    if not isinstance(outcome, Mapping):
        return False
    if payload.get("play_mode") == "solo":
        return outcome.get("status") == "completed"
    return payload.get("play_mode") in {"multiplayer", "cpu"} and (
        bool(outcome.get("tied"))
        or isinstance(outcome.get("winner_id"), str)
        and bool(str(outcome.get("winner_id")).strip())
    )


def _ensure_community_unlocks_for_user_in_session(
    db,
    user_id: int,
    existing: dict[str, ZilchAchievementUnlock],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Project frozen recipients without consulting mutable game evidence."""

    recipient_rows = db.execute(
        select(ZilchCommunityRecipient, ZilchCommunityMilestone)
        .join(
            ZilchCommunityMilestone,
            ZilchCommunityMilestone.id == ZilchCommunityRecipient.milestone_id,
        )
        .where(ZilchCommunityRecipient.user_id == user_id)
        .order_by(ZilchCommunityMilestone.reached_at, ZilchCommunityMilestone.id)
    ).all()
    recipients_by_key = {
        str(milestone.achievement_key): (recipient, milestone)
        for recipient, milestone in recipient_rows
        if str(milestone.achievement_key) in ZILCH_ACHIEVEMENT_BY_KEY
        and ZILCH_ACHIEVEMENT_BY_KEY[str(milestone.achievement_key)].criterion == "community_games"
    }
    newly_unlocked: list[dict[str, Any]] = []
    revoked: list[str] = []
    for definition in ZILCH_ACHIEVEMENTS:
        if definition.criterion != "community_games":
            continue
        source = recipients_by_key.get(definition.key)
        unlock = existing.get(definition.key)
        if source is None:
            if unlock is not None:
                revoked.append(definition.key)
                db.delete(unlock)
            continue
        recipient, milestone = source
        if unlock is None:
            unlock = ZilchAchievementUnlock(
                user_id=user_id,
                achievement_key=definition.key,
                definition_version=definition.definition_version,
                source_evidence_id=None,
                source_community_recipient_id=recipient.id,
                source_game_id=None,
                unlocked_at=recipient.awarded_at,
            )
            db.add(unlock)
            db.flush()
            delivery = ZilchAchievementDelivery(
                unlock_id=unlock.id,
                queued_at=recipient.awarded_at,
                acknowledged_at=None,
            )
            db.add(delivery)
            presentation_game_id = db.scalar(
                select(ZilchCommunityParticipant.game_id).where(
                    ZilchCommunityParticipant.game_id == milestone.trigger_game_id,
                    ZilchCommunityParticipant.user_id == user_id,
                )
            )
            newly_unlocked.append(
                _unlock_payload(
                    unlock,
                    definition,
                    delivery=delivery,
                    presentation_game_id=presentation_game_id,
                )
            )
        else:
            # Repair only the durable community source.  A personal resync
            # must not attach this zero-point award to mutable game evidence.
            unlock.source_evidence_id = None
            unlock.source_game_id = None
            unlock.source_community_recipient_id = recipient.id
    return newly_unlocked, revoked


def _record_community_participants_in_session(db, *, game_id: str) -> None:
    """Persist qualifying account seats independently of mutable evidence."""

    existing_user_ids = set(
        db.scalars(
            select(ZilchCommunityParticipant.user_id).where(
                ZilchCommunityParticipant.game_id == game_id
            )
        )
    )
    evidence_rows = db.scalars(
        select(ZilchAchievementEvidence).where(ZilchAchievementEvidence.source_game_id == game_id)
    )
    for evidence in evidence_rows:
        user_id = int(evidence.user_id)
        if user_id in existing_user_ids:
            continue
        facts = _facts_from_evidence(evidence)
        if facts is None or not _is_qualified_completion(facts):
            continue
        db.add(
            ZilchCommunityParticipant(
                game_id=game_id,
                user_id=user_id,
                qualified_at=evidence.recorded_at,
            )
        )
        existing_user_ids.add(user_id)
    db.flush()


def _community_eligible_user_ids_in_session(db, *, through_ordinal: int) -> list[int]:
    """Freeze active accounts with a durable seat at or before a threshold."""

    return sorted(
        {
            int(user_id)
            for user_id in db.scalars(
                select(ZilchCommunityParticipant.user_id)
                .join(
                    ZilchCommunityGame,
                    ZilchCommunityGame.game_id == ZilchCommunityParticipant.game_id,
                )
                .join(User, User.id == ZilchCommunityParticipant.user_id)
                .where(
                    User.is_active.is_(True),
                    ZilchCommunityGame.ordinal <= through_ordinal,
                )
                .distinct()
            )
        }
    )


def _register_community_game_in_session(
    db,
    *,
    game_id: str,
    payload: Mapping[str, Any],
) -> dict[int, list[dict[str, Any]]]:
    """Count one terminal source and atomically freeze newly reached awards."""

    if not _payload_is_qualified_completion(payload):
        return {}
    if db.scalar(select(ZilchCommunityGame.id).where(ZilchCommunityGame.game_id == game_id)) is not None:
        return {}
    state = db.get(ZilchCommunityState, 1)
    if state is None:
        # Alembic installs this singleton.  The fallback keeps metadata-only
        # test databases deterministic without scanning historic games.
        db.add(
            ZilchCommunityState(
                id=1,
                qualified_games=0,
                achievement_catalog_version=ZILCH_ACHIEVEMENT_CATALOG_VERSION,
                updated_at=utcnow(),
            )
        )
        db.flush()
    now = utcnow()
    ordinal = db.scalar(
        update(ZilchCommunityState)
        .where(ZilchCommunityState.id == 1)
        .values(
            qualified_games=ZilchCommunityState.qualified_games + 1,
            updated_at=now,
        )
        .returning(ZilchCommunityState.qualified_games)
    )
    if ordinal is None:
        raise ZilchAchievementError("zilch_achievement_community_state_missing")
    counted = ZilchCommunityGame(game_id=game_id, ordinal=int(ordinal), counted_at=now)
    db.add(counted)
    db.flush()
    _record_community_participants_in_session(db, game_id=game_id)

    eligible_user_ids: list[int] | None = None
    new_unlocks: dict[int, list[dict[str, Any]]] = {}
    for definition in ZILCH_ACHIEVEMENTS:
        if definition.criterion != "community_games" or int(definition.target or 0) != int(ordinal):
            continue
        existing_milestone = db.scalar(
            select(ZilchCommunityMilestone.id).where(
                ZilchCommunityMilestone.achievement_key == definition.key
            )
        )
        if existing_milestone is not None:
            continue
        milestone = ZilchCommunityMilestone(
            achievement_key=definition.key,
            threshold=int(definition.target or 0),
            reached_ordinal=int(ordinal),
            trigger_game_id=game_id,
            reached_at=now,
        )
        db.add(milestone)
        db.flush()
        if eligible_user_ids is None:
            eligible_user_ids = _community_eligible_user_ids_in_session(
                db,
                through_ordinal=int(ordinal),
            )
        for user_id in eligible_user_ids:
            recipient = ZilchCommunityRecipient(
                milestone_id=milestone.id,
                user_id=user_id,
                awarded_at=now,
            )
            db.add(recipient)
            db.flush()
            existing = _known_unlock_rows(db, user_id)
            unlocked, _revoked = _ensure_community_unlocks_for_user_in_session(db, user_id, existing)
            if unlocked:
                new_unlocks.setdefault(user_id, []).extend(unlocked)
    return new_unlocks


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
        if definition.criterion == "community_games":
            continue
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
    community_unlocked, community_revoked = _ensure_community_unlocks_for_user_in_session(db, user_id, existing)
    newly_unlocked.extend(community_unlocked)
    revoked.extend(community_revoked)
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
            evaluated_at = utcnow()
            claim = db.execute(
                update(ZilchAchievementEvaluation)
                .where(
                    ZilchAchievementEvaluation.id == evaluation.id,
                    ZilchAchievementEvaluation.status == "pending",
                )
                .values(
                    status="completed",
                    attempts=ZilchAchievementEvaluation.attempts + 1,
                    evaluated_at=evaluated_at,
                    last_error=None,
                )
                .execution_options(synchronize_session=False)
            )
            if claim.rowcount != 1:
                return ZilchAchievementRegistration(game_id, "already_evaluated", {}, pending=False)
            affected = {int(row.user_id) for row in evidence}
            new_unlocks: dict[int, list[dict[str, Any]]] = {}
            for user_id in sorted(affected):
                unlocked, _revoked = _sync_user_achievements_in_session(db, user_id)
                if unlocked:
                    new_unlocks[user_id] = unlocked
            community_unlocks = _register_community_game_in_session(
                db,
                game_id=game_id,
                payload=payload,
            )
            for user_id, unlocked in community_unlocks.items():
                new_unlocks.setdefault(user_id, []).extend(unlocked)
            rank_after_by_user = zilch_achievement_rank_payloads_for_user_ids(db, new_unlocks)
            for user_id, unlocked in new_unlocks.items():
                rank_after = rank_after_by_user[user_id]
                for award in unlocked:
                    award["rank_after"] = rank_after
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


def resync_zilch_achievement_catalog() -> dict[str, int | str]:
    """Enrich accepted evidence and materialize one catalog rollout atomically.

    The singleton version makes the rollout atomic and retry-safe.  It never
    enumerates ``CompletedGame``: only completed, explicitly registered
    evaluations may load their exact typed source by id.  Users come only from
    the isolated evidence, unlock, and frozen-recipient tables.  A failed
    validation or transaction therefore leaves the previous evidence and
    version in place for the next startup attempt.
    """

    if not database_schema_ready():
        raise ZilchAchievementSyncError("zilch_achievement_database_not_ready")
    try:
        with session_scope() as db:
            state = db.get(ZilchCommunityState, 1)
            if state is None:
                raise ZilchAchievementError("zilch_achievement_community_state_missing")
            previous_version = max(0, int(state.achievement_catalog_version))
            if previous_version >= ZILCH_ACHIEVEMENT_CATALOG_VERSION:
                return {
                    "status": "already_current",
                    "from_version": previous_version,
                    "to_version": previous_version,
                    "users": 0,
                    "evidence_enriched": 0,
                    "unlocked": 0,
                    "revoked": 0,
                }
            claimed = db.execute(
                update(ZilchCommunityState)
                .where(
                    ZilchCommunityState.id == 1,
                    ZilchCommunityState.achievement_catalog_version == previous_version,
                )
                .values(
                    achievement_catalog_version=ZILCH_ACHIEVEMENT_CATALOG_VERSION,
                    updated_at=utcnow(),
                )
                .execution_options(synchronize_session=False)
            )
            if claimed.rowcount != 1:
                current_version = db.scalar(
                    select(ZilchCommunityState.achievement_catalog_version).where(
                        ZilchCommunityState.id == 1
                    )
                )
                return {
                    "status": "already_current",
                    "from_version": max(0, int(current_version or 0)),
                    "to_version": max(0, int(current_version or 0)),
                    "users": 0,
                    "evidence_enriched": 0,
                    "unlocked": 0,
                    "revoked": 0,
                }
            evidence_enriched = _enrich_registered_evidence_for_catalog_in_session(db)
            user_ids = {
                int(user_id)
                for user_id in db.scalars(select(ZilchAchievementEvidence.user_id).distinct())
            }
            user_ids.update(
                int(user_id)
                for user_id in db.scalars(select(ZilchAchievementUnlock.user_id).distinct())
            )
            user_ids.update(
                int(user_id)
                for user_id in db.scalars(select(ZilchCommunityRecipient.user_id).distinct())
            )
            unlocked_count = 0
            revoked_count = 0
            for user_id in sorted(user_ids):
                unlocked, revoked = _sync_user_achievements_in_session(db, user_id)
                unlocked_count += len(unlocked)
                revoked_count += len(revoked)
            return {
                "status": "resynchronized",
                "from_version": previous_version,
                "to_version": ZILCH_ACHIEVEMENT_CATALOG_VERSION,
                "users": len(user_ids),
                "evidence_enriched": evidence_enriched,
                "unlocked": unlocked_count,
                "revoked": revoked_count,
            }
    except ZilchAchievementError:
        raise
    except SQLAlchemyError as exc:
        logger.exception("Could not resynchronize Zilch achievement catalog")
        raise ZilchAchievementSyncError() from exc


def _profile_in_session(db, user_id: int) -> dict[str, Any]:
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise ZilchAchievementError("zilch_achievement_user_not_found")
    evidence_pairs = _evidence_for_user(db, user_id)
    facts = [fact for _evidence, fact in evidence_pairs]
    unlocks = _known_unlock_rows(db, user_id)
    community_presentation_game_ids = _community_presentation_game_ids_in_session(
        db,
        unlocks.values(),
    )
    points = zilch_achievement_points_for_keys(unlocks)
    community_games = _community_count_in_session(db)
    reached_community_keys = {
        str(key) for key in db.scalars(select(ZilchCommunityMilestone.achievement_key))
    }
    recipient_community_keys = {
        str(key)
        for key in db.scalars(
            select(ZilchCommunityMilestone.achievement_key)
            .join(
                ZilchCommunityRecipient,
                ZilchCommunityRecipient.milestone_id == ZilchCommunityMilestone.id,
            )
            .where(ZilchCommunityRecipient.user_id == user_id)
        )
    }
    unlocked: list[dict[str, Any]] = []
    locked: list[dict[str, Any]] = []
    for definition in ZILCH_ACHIEVEMENTS:
        progress = _progress_for_definition(
            definition,
            facts,
            community_games=community_games,
        )
        row = unlocks.get(definition.key)
        if row is None:
            payload = _definition_payload(definition)
            missed = (
                definition.criterion == "community_games"
                and definition.key in reached_community_keys
                and definition.key not in recipient_community_keys
            )
            if missed:
                payload["missed"] = True
            elif progress is not None:
                payload["progress"] = progress
            locked.append(payload)
            continue
        unlocked.append(
            _unlock_payload(
                row,
                definition,
                progress=progress,
                presentation_game_id=community_presentation_game_ids.get(
                    int(row.source_community_recipient_id)
                )
                if row.source_community_recipient_id is not None
                else None,
            )
        )
    unlocked.sort(key=lambda item: item["unlocked_at"], reverse=True)
    return {
        "version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION,
        "player": {"id": int(user.id), "username": str(user.username)},
        "points": points,
        "points_possible": ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
        "rank": zilch_achievement_rank_for_points(points),
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
            community_presentation_game_ids = _community_presentation_game_ids_in_session(
                db,
                (unlock for _delivery, unlock in rows),
            )
            awards: list[dict[str, Any]] = []
            for delivery, unlock in rows:
                definition = ZILCH_ACHIEVEMENT_BY_KEY.get(str(unlock.achievement_key))
                if definition is None:
                    continue
                awards.append(
                    _unlock_payload(
                        unlock,
                        definition,
                        delivery=delivery,
                        presentation_game_id=community_presentation_game_ids.get(
                            int(unlock.source_community_recipient_id)
                        )
                        if unlock.source_community_recipient_id is not None
                        else None,
                    )
                )
            unlocked_keys = _known_unlock_rows(db, normalized_user_id)
            points = zilch_achievement_points_for_keys(unlocked_keys)
            return {
                "version": ZILCH_ACHIEVEMENT_RESPONSE_VERSION,
                "points": points,
                "points_possible": ZILCH_ACHIEVEMENT_POINTS_POSSIBLE,
                "rank": zilch_achievement_rank_for_points(points),
                "awards": awards,
            }
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
