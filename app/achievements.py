"""Achievement catalog and deterministic evaluation for player profiles."""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import timedelta
from math import ceil
from typing import Iterable
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .models import CompletedGame, GameParticipant, User, UserAchievement
from .rules import compute_row_subtotals
from .security import as_utc, utcnow

ZURICH = ZoneInfo("Europe/Zurich")
TOP_FIELDS = tuple(str(number) for number in range(1, 7))
LOWER_FIELDS = ("kenter", "full", "poker")
STYLER_FULL_VALUES = frozenset(40 + 3 * face for face in range(1, 7))


@dataclass(frozen=True)
class Achievement:
    key: str
    name: str
    description: str
    icon_key: str
    kind: str
    target: int = 1
    points: int = 1


@dataclass(frozen=True)
class AchievementRank:
    """A title tier derived from the cumulative achievement score.

    The thresholds intentionally scale from the catalog maximum.  Adding a
    future achievement therefore keeps the rank distribution balanced instead
    of making every existing title progressively easier to obtain.
    """

    key: str
    title: str
    stars: int
    reference_minimum_points: int


def _tiered(kind: str, icon_key: str, values: list[tuple[int, str, str]]) -> list[Achievement]:
    return [
        Achievement(f"{kind}_{value}", name, description, icon_key, kind, value) for value, name, description in values
    ]


EXACT_GAME_SCORE_TARGETS = (555, 666, 777, 888, 999, 1_111, 1_222, 1_333, 1_444, 1_555)


def _exact_score_achievements() -> list[Achievement]:
    """Create one achievement per deliberately exact final score."""
    return [
        Achievement(
            f"exact_game_score_{score}",
            f"Punktlandung {score}",
            f"Ein Spiel mit exakt {score} Punkten beendet.",
            "score",
            f"exact_game_score_{score}",
            score,
        )
        for score in EXACT_GAME_SCORE_TARGETS
    ]


_ACHIEVEMENT_CATALOG: tuple[Achievement, ...] = tuple(
    _tiered(
        "career_points",
        "points",
        [
            (1_000, "Punktesammler I", "Insgesamt 1’000 Punkte erreicht."),
            (10_000, "Punktesammler II", "Insgesamt 10’000 Punkte erreicht."),
            (100_000, "Punktesammler III", "Insgesamt 100’000 Punkte erreicht."),
            (500_000, "Punktesammler IV", "Insgesamt 500’000 Punkte erreicht."),
            (1_000_000, "Punktesammler V", "Insgesamt 1’000’000 Punkte erreicht."),
        ],
    )
    + _tiered(
        "games_played",
        "games",
        [
            (10, "Warmgelaufen", "10 Spiele mit deinem Konto abgeschlossen."),
            (100, "Hundert Spiele", "100 Spiele mit deinem Konto abgeschlossen."),
            (200, "Doppelhundert", "200 Spiele mit deinem Konto abgeschlossen."),
            (500, "Ausdauer", "500 Spiele mit deinem Konto abgeschlossen."),
            (800, "Unermüdlich", "800 Spiele mit deinem Konto abgeschlossen."),
            (1_000, "Tausenderclub", "1’000 Spiele mit deinem Konto abgeschlossen."),
            (10_000, "Legende", "10’000 Spiele mit deinem Konto abgeschlossen."),
        ],
    )
    + _tiered(
        "single_game_score",
        "score",
        [
            (1_000, "Vierstellig", "In einem Spiel mindestens 1’000 Punkte erreicht."),
            (1_100, "1’100er Club", "In einem Spiel mindestens 1’100 Punkte erreicht."),
            (1_200, "1’200er Club", "In einem Spiel mindestens 1’200 Punkte erreicht."),
            (1_300, "1’300er Club", "In einem Spiel mindestens 1’300 Punkte erreicht."),
            (1_400, "1’400er Club", "In einem Spiel mindestens 1’400 Punkte erreicht."),
            (1_500, "1’500er Club", "In einem Spiel mindestens 1’500 Punkte erreicht."),
            (1_600, "Godmode", "In einem Spiel mindestens 1’600 Punkte erreicht."),
        ],
    )
    + [
        Achievement(
            "normal_under_700",
            "Pro Loser",
            "Ein normales Spiel mit weniger als 700 Punkten beendet.",
            "score",
            "normal_under_700",
        ),
        *_exact_score_achievements(),
        Achievement(
            "top_section_exact_60",
            "Grad und grad",
            "In einer Reihe im oberen Teil (1–6) genau 60 Punkte erreicht.",
            "upper",
            "top_section_exact_60",
        ),
        Achievement(
            "top_section_all_exact_60",
            "Sechziger-Festung",
            "In einem Spiel in allen vier Reihen im oberen Teil (1–6) jeweils genau 60 Punkte erreicht.",
            "upper",
            "top_section_all_exact_60",
        ),
        Achievement(
            "top_section_81_without_bonus",
            "Obere Liga",
            "In einer Reihe im oberen Teil (1–6) ohne Bonus über 80 Punkte erreicht.",
            "upper",
            "top_section",
            81,
        ),
        Achievement(
            "top_section_101",
            "Zahlenzauber",
            "In einer Reihe im oberen Teil (1–6) über 100 Punkte erreicht.",
            "upper",
            "top_section",
            101,
        ),
        Achievement(
            "row_401", "Reihenmeister", "In einer einzelnen Reihe über 400 Punkte erreicht.", "row", "row_score", 401
        ),
        Achievement(
            "lower_six_strikes",
            "Streichkonzert",
            "In einem Spiel 6 Felder bei Kenter, Full oder Poker gestrichen.",
            "strike",
            "lower_strikes",
            6,
        ),
        Achievement("sixty_once", "Volltreffer 60", "Mindestens einen 60er geschrieben.", "sixty", "sixty_once"),
        Achievement(
            "sixty_all_written",
            "Sechziger-Sammlung",
            "In einem Spiel alle vier 60er geschrieben.",
            "sixty",
            "sixty_all_written",
            4,
        ),
        Achievement(
            "sixty_all_struck",
            "Sechziger-Flaute",
            "In einem Spiel alle vier 60er gestrichen.",
            "sixty",
            "sixty_all_struck",
            4,
        ),
        Achievement(
            "full_perfect",
            "Full House Royal",
            "In einem Spiel alle vier Fulls mit Sechsern geschrieben.",
            "full",
            "full_perfect",
            4,
        ),
        Achievement(
            "poker_perfect",
            "Poker Royale",
            "In einem Spiel alle vier Poker mit Sechsern geschrieben.",
            "poker",
            "poker_perfect",
            4,
        ),
        Achievement(
            "full_minimal",
            "Kleines Full",
            "In einem Spiel alle vier Fulls nur mit Einsern geschrieben.",
            "full",
            "full_minimal",
            4,
        ),
        Achievement(
            "poker_minimal",
            "Kleiner Poker",
            "In einem Spiel alle vier Poker nur mit Einsern geschrieben.",
            "poker",
            "poker_minimal",
            4,
        ),
        Achievement(
            "diff_over_100",
            "Differenz extrem I",
            "In einer Reihe eine Differenz über 100 erreicht.",
            "diff",
            "diff_max",
            101,
        ),
        Achievement(
            "diff_over_120",
            "Differenz extrem II",
            "In einer Reihe eine Differenz über 120 erreicht.",
            "diff",
            "diff_max",
            121,
        ),
        Achievement(
            "diff_pro",
            "Differenz-Profi",
            "In einem Spiel alle vier Differenzen über 60 und mindestens eine über 80 erreicht.",
            "diff",
            "diff_pro",
        ),
        Achievement(
            "diff_all_under_20",
            "Differenz null",
            "In einem Spiel alle vier Differenzen unter 20 gehalten.",
            "diff",
            "diff_all_under_20",
        ),
        Achievement(
            "diff_zero",
            "Differenz abgekackt",
            "In einem Spiel mindestens eine Differenz von 0 geschrieben.",
            "diff",
            "diff_zero",
        ),
        Achievement(
            "kenter_struck",
            "Kenter gestrichen",
            "In einem Spiel mindestens einen Kenter gestrichen.",
            "kenter",
            "kenter_struck",
        ),
        Achievement(
            "kenter_all_written",
            "Kenter-Serie",
            "In einem Spiel alle vier Kenter geschrieben.",
            "kenter",
            "kenter_all_written",
            4,
        ),
        Achievement(
            "top_totals_equal",
            "Oben im Gleichklang",
            "In einem Spiel in allen vier Reihen dieselbe Summe bei 1–6 erreicht.",
            "upper",
            "top_totals_equal",
        ),
        Achievement(
            "diffs_equal",
            "Differenz im Gleichklang",
            "In einem Spiel in allen vier Reihen dieselbe Differenz erreicht.",
            "diff",
            "diffs_equal",
        ),
        Achievement(
            "no_top_bonus",
            "Ohne Prämie",
            "In einem Spiel in keiner Reihe den oberen Bonus erhalten.",
            "bonus",
            "no_top_bonus",
        ),
        Achievement(
            "all_top_bonuses",
            "Prämienjäger",
            "In einem Spiel in allen vier Reihen den oberen Bonus erhalten.",
            "bonus",
            "all_top_bonuses",
            4,
        ),
        Achievement(
            "five_ones_written",
            "Einser-Serie",
            "Fünf Einsen im 1er-Feld geschrieben.",
            "upper",
            "five_ones_written",
        ),
        Achievement(
            "five_twos_written",
            "Zweier-Serie",
            "Fünf Zweien im 2er-Feld geschrieben.",
            "upper",
            "five_twos_written",
        ),
        Achievement(
            "five_threes_written",
            "Dreier-Serie",
            "Fünf Dreien im 3er-Feld geschrieben.",
            "upper",
            "five_threes_written",
        ),
        Achievement(
            "five_fours_written",
            "Vierer-Serie",
            "Fünf Vieren im 4er-Feld geschrieben.",
            "upper",
            "five_fours_written",
        ),
        Achievement(
            "five_fives_written",
            "Fünfer-Serie",
            "Fünf Fünfen im 5er-Feld geschrieben.",
            "upper",
            "five_fives_written",
        ),
        Achievement(
            "min_five",
            "Bäm Minimum",
            "Genau 5 Punkte im Minimum geschrieben.",
            "score",
            "min_five",
        ),
        Achievement(
            "max_under_ten",
            "Fail Max",
            "Weniger als 10 Punkte im Maximum geschrieben.",
            "score",
            "max_under_ten",
        ),
        Achievement(
            "min_under_ten",
            "Minimum tief",
            "Weniger als 10 Punkte im Minimum geschrieben.",
            "score",
            "min_under_ten",
        ),
        Achievement(
            "max_over_25",
            "Maximum hoch",
            "Mehr als 25 Punkte im Maximum geschrieben.",
            "score",
            "max_over_25",
        ),
        Achievement(
            "min_over_25",
            "Fail Min",
            "Mehr als 25 Punkte im Minimum geschrieben.",
            "score",
            "min_over_25",
        ),
        Achievement(
            "diff_over_125",
            "Differenz extrem III",
            "In einer Reihe exakt 125 Punkte Differenz erreicht.",
            "diff",
            "diff_exact_125",
        ),
        Achievement(
            "max_thirty",
            "Bäm Maximum",
            "30 Punkte im Maximum geschrieben.",
            "score",
            "max_thirty",
        ),
        Achievement(
            "six_thirty",
            "Sechser-Bäm",
            "30 Punkte im 6er-Feld geschrieben.",
            "upper",
            "six_thirty",
        ),
        Achievement(
            "styler_full_once",
            "Styler Full",
            "Ein Full mit fünf gleichen Würfeln geschrieben.",
            "full",
            "styler_full_count",
        ),
        Achievement(
            "styler_full_10",
            "Styler-Show",
            "10 Fulls mit fünf gleichen Würfeln geschrieben.",
            "full",
            "styler_full_count",
            10,
        ),
        Achievement(
            "daily_streak_7",
            "Wochenläufer",
            "Während 7 aufeinanderfolgenden Tagen je ein Spiel beendet.",
            "games",
            "daily_streak",
            7,
        ),
        Achievement(
            "daily_streak_14",
            "Zwei-Wochen-Lauf",
            "Während 14 aufeinanderfolgenden Tagen je ein Spiel beendet.",
            "games",
            "daily_streak",
            14,
        ),
        Achievement(
            "daily_streak_30",
            "Monatsläufer",
            "Während 30 aufeinanderfolgenden Tagen je ein Spiel beendet.",
            "games",
            "daily_streak",
            30,
        ),
    ]
    + _tiered(
        "hardcore_games",
        "games",
        [
            (1, "Hardcore-Einstieg", "1 Hardcore-Spiel abgeschlossen."),
            (10, "Hardcore-Stammgast", "10 Hardcore-Spiele abgeschlossen."),
            (30, "Hardcore-Veteran", "30 Hardcore-Spiele abgeschlossen."),
            (50, "Hardcore-Dauerläufer", "50 Hardcore-Spiele abgeschlossen."),
            (100, "Hardcore-Hundert", "100 Hardcore-Spiele abgeschlossen."),
            (300, "Hardcore-Monument", "300 Hardcore-Spiele abgeschlossen."),
            (500, "Hardcore-Legende", "500 Hardcore-Spiele abgeschlossen."),
            (1_000, "Hardcore-Unsterblich", "1’000 Hardcore-Spiele abgeschlossen."),
        ],
    )
    + _tiered(
        "hardcore_score",
        "score",
        [
            (300, "Hardcore 300", "In einem Hardcore-Spiel mindestens 300 Punkte erreicht."),
            (400, "Hardcore 400", "In einem Hardcore-Spiel mindestens 400 Punkte erreicht."),
            (500, "Hardcore 500", "In einem Hardcore-Spiel mindestens 500 Punkte erreicht."),
            (600, "Hardcore 600", "In einem Hardcore-Spiel mindestens 600 Punkte erreicht."),
            (700, "Hardcore 700", "In einem Hardcore-Spiel mindestens 700 Punkte erreicht."),
            (800, "Hardcore Pro", "In einem Hardcore-Spiel mindestens 800 Punkte erreicht."),
            (900, "Hardcore Legend", "In einem Hardcore-Spiel mindestens 900 Punkte erreicht."),
            (1_000, "Hardcore Godmode", "In einem Hardcore-Spiel mindestens 1’000 Punkte erreicht."),
        ],
    )
    + [
        Achievement(
            "hardcore_streak_7",
            "Hardcore-Woche",
            "Während 7 aufeinanderfolgenden Tagen je ein Hardcore-Spiel beendet.",
            "games",
            "hardcore_streak",
            7,
        ),
        # Mehrspieler-Ziele sind bewusst nach Spielmodus gegliedert. Die
        # eigenständige Dreier-Serie misst den Vorsprung auf den letzten Platz,
        # nicht noch einmal den Vorsprung auf Platz zwei.
        Achievement(
            "multiplayer_2p_margin_100",
            "Duell-Dominanz I",
            "Ein 2-Spieler-Spiel mit mehr als 100 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2p",
            101,
        ),
        Achievement(
            "multiplayer_2p_margin_200",
            "Duell-Dominanz II",
            "Ein 2-Spieler-Spiel mit mehr als 200 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2p",
            201,
        ),
        Achievement(
            "multiplayer_2p_margin_350",
            "Duell-Dominanz III",
            "Ein 2-Spieler-Spiel mit mehr als 350 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2p",
            351,
        ),
        Achievement(
            "multiplayer_3p_runner_up_margin_100",
            "Podiums-Dominanz I",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 100 Punkten Vorsprung auf Platz 2 gewonnen.",
            "score",
            "multiplayer_margin_3p_runner_up",
            101,
        ),
        Achievement(
            "multiplayer_3p_runner_up_margin_200",
            "Podiums-Dominanz II",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 200 Punkten Vorsprung auf Platz 2 gewonnen.",
            "score",
            "multiplayer_margin_3p_runner_up",
            201,
        ),
        Achievement(
            "multiplayer_3p_runner_up_margin_350",
            "Podiums-Dominanz III",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 350 Punkten Vorsprung auf Platz 2 gewonnen.",
            "score",
            "multiplayer_margin_3p_runner_up",
            351,
        ),
        Achievement(
            "multiplayer_3p_last_margin_100",
            "Dreierfeld-Dominanz I",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 100 Punkten Vorsprung auf den letzten Platz beendet.",
            "score",
            "multiplayer_margin_3p_last",
            101,
        ),
        Achievement(
            "multiplayer_3p_last_margin_200",
            "Dreierfeld-Dominanz II",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 200 Punkten Vorsprung auf den letzten Platz beendet.",
            "score",
            "multiplayer_margin_3p_last",
            201,
        ),
        Achievement(
            "multiplayer_3p_last_margin_350",
            "Dreierfeld-Dominanz III",
            "Ein 3-Spieler-Spiel als Erster mit mehr als 350 Punkten Vorsprung auf den letzten Platz beendet.",
            "score",
            "multiplayer_margin_3p_last",
            351,
        ),
        Achievement(
            "multiplayer_2v2_margin_100",
            "Team-Dominanz I",
            "Ein 2v2-Spiel als Team mit mehr als 100 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2v2",
            101,
        ),
        Achievement(
            "multiplayer_2v2_margin_200",
            "Team-Dominanz II",
            "Ein 2v2-Spiel als Team mit mehr als 200 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2v2",
            201,
        ),
        Achievement(
            "multiplayer_2v2_margin_350",
            "Team-Dominanz III",
            "Ein 2v2-Spiel als Team mit mehr als 350 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_margin_2v2",
            351,
        ),
        Achievement(
            "multiplayer_close_win",
            "Foto-Finish",
            "Ein Mehrspieler-Spiel mit höchstens 10 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_close_win",
        ),
        Achievement(
            "multiplayer_one_point_win",
            "Ein Punkt reicht",
            "Ein Mehrspieler-Spiel mit exakt 1 Punkt Vorsprung gewonnen.",
            "score",
            "multiplayer_one_point_win",
        ),
        Achievement(
            "multiplayer_blowout",
            "Unüberbrückbar",
            "Ein Mehrspieler-Spiel mit mehr als 500 Punkten Vorsprung gewonnen.",
            "score",
            "multiplayer_blowout",
        ),
        # Zeitbasierte Ziele bleiben am Ende des Katalogs, damit sie in der
        # Profilansicht nach den Spiel- und Hardcore-Zielen erscheinen.
        Achievement(
            "office_hours",
            "Bürozeit",
            "Ein Spiel werktags zwischen 07:00 und 17:00 Uhr beendet.",
            "office",
            "office_hours",
        ),
        Achievement(
            "office_hours_10",
            "Arbeitszeitbetrug I",
            "10 Spiele werktags zwischen 07:00 und 17:00 Uhr beendet.",
            "office",
            "office_hours_count",
            10,
        ),
        Achievement(
            "office_hours_25",
            "Arbeitszeitbetrug II",
            "25 Spiele werktags zwischen 07:00 und 17:00 Uhr beendet.",
            "office",
            "office_hours_count",
            25,
        ),
        Achievement(
            "office_hours_50",
            "Arbeitszeitbetrug Ultra Pro Max III",
            "50 Spiele werktags zwischen 07:00 und 17:00 Uhr beendet.",
            "office",
            "office_hours_count",
            50,
        ),
        Achievement("night_owl", "Nachteule", "Ein Spiel zwischen 02:00 und 05:00 Uhr beendet.", "night", "night_owl"),
        Achievement(
            "weekend_games",
            "Wochenendspieler",
            "10 Spiele am Samstag oder Sonntag beendet.",
            "weekend",
            "weekend_games",
            10,
        ),
        Achievement(
            "early_bird_games",
            "Early Bird",
            "10 Spiele zwischen 06:00 und 07:00 Uhr beendet.",
            "early",
            "early_bird_games",
            10,
        ),
        Achievement(
            "statistics_views",
            "Statistiker",
            "Die eigene Konto-Statistik 10-mal geöffnet.",
            "statistics",
            "statistics_views",
            10,
        ),
        Achievement("account_created", "Konto eröffnet", "Ein ZDWA-Konto erstellt.", "account", "account_created"),
    ]
)


# Achievement points deliberately reflect both rarity and effort.  They are
# catalog data rather than UI-only decoration: profile totals and the public
# achievement ranking use the exact same values.
_TIER_POINTS: dict[str, dict[int, int]] = {
    "career_points": {1_000: 1, 10_000: 2, 100_000: 4, 500_000: 7, 1_000_000: 10},
    "games_played": {10: 1, 100: 2, 200: 3, 500: 5, 800: 6, 1_000: 7, 10_000: 10},
    "single_game_score": {1_000: 2, 1_100: 3, 1_200: 4, 1_300: 5, 1_400: 6, 1_500: 7, 1_600: 8},
    "hardcore_games": {1: 2, 10: 3, 30: 4, 50: 5, 100: 6, 300: 7, 500: 8, 1_000: 10},
    "hardcore_score": {300: 3, 400: 4, 500: 5, 600: 6, 700: 7, 800: 8, 900: 9, 1_000: 10},
}
_EXACT_SCORE_POINTS = {555: 4, 666: 4, 777: 4, 888: 4, 999: 5, 1_111: 5, 1_222: 6, 1_333: 7, 1_444: 8, 1_555: 10}
_KEY_POINTS: dict[str, int] = {
    "account_created": 1,
    "statistics_views": 1,
    "normal_under_700": 3,
    "top_section_exact_60": 4,
    "top_section_all_exact_60": 10,
    "top_section_81_without_bonus": 5,
    "top_section_101": 6,
    "row_401": 6,
    "lower_six_strikes": 3,
    "sixty_once": 2,
    "sixty_all_written": 5,
    "sixty_all_struck": 4,
    "full_perfect": 8,
    "poker_perfect": 8,
    "full_minimal": 6,
    "poker_minimal": 6,
    "diff_over_100": 4,
    "diff_over_120": 6,
    "diff_over_125": 10,
    "diff_pro": 7,
    "diff_all_under_20": 6,
    "diff_zero": 1,
    "kenter_struck": 1,
    "kenter_all_written": 5,
    "top_totals_equal": 5,
    "diffs_equal": 6,
    "no_top_bonus": 2,
    "all_top_bonuses": 7,
    "five_ones_written": 2,
    "five_twos_written": 2,
    "five_threes_written": 3,
    "five_fours_written": 3,
    "five_fives_written": 4,
    "six_thirty": 4,
    "min_five": 2,
    "max_under_ten": 2,
    "min_under_ten": 2,
    "max_over_25": 3,
    "min_over_25": 3,
    "max_thirty": 4,
    "styler_full_once": 4,
    "styler_full_10": 8,
    "daily_streak_7": 4,
    "daily_streak_14": 6,
    "daily_streak_30": 8,
    "hardcore_streak_7": 7,
    "office_hours": 1,
    "office_hours_10": 3,
    "office_hours_25": 5,
    "office_hours_50": 8,
    "multiplayer_2p_margin_100": 2,
    "multiplayer_2p_margin_200": 4,
    "multiplayer_2p_margin_350": 7,
    "multiplayer_3p_runner_up_margin_100": 2,
    "multiplayer_3p_runner_up_margin_200": 4,
    "multiplayer_3p_runner_up_margin_350": 7,
    "multiplayer_3p_last_margin_100": 1,
    "multiplayer_3p_last_margin_200": 3,
    "multiplayer_3p_last_margin_350": 5,
    "multiplayer_2v2_margin_100": 2,
    "multiplayer_2v2_margin_200": 4,
    "multiplayer_2v2_margin_350": 7,
    "multiplayer_close_win": 3,
    "multiplayer_one_point_win": 7,
    "multiplayer_blowout": 10,
    "night_owl": 2,
    "weekend_games": 3,
    "early_bird_games": 3,
}


def _achievement_points(achievement: Achievement) -> int:
    if achievement.kind in _TIER_POINTS:
        return _TIER_POINTS[achievement.kind][achievement.target]
    if achievement.kind.startswith("exact_game_score_"):
        return _EXACT_SCORE_POINTS[achievement.target]
    return _KEY_POINTS[achievement.key]


ACHIEVEMENTS: tuple[Achievement, ...] = tuple(
    replace(achievement, points=_achievement_points(achievement)) for achievement in _ACHIEVEMENT_CATALOG
)
ACHIEVEMENT_BY_KEY = {achievement.key: achievement for achievement in ACHIEVEMENTS}
ACHIEVEMENT_POINTS_BY_KEY = {achievement.key: achievement.points for achievement in ACHIEVEMENTS}
ACHIEVEMENT_POINTS_POSSIBLE = sum(achievement.points for achievement in ACHIEVEMENTS)

if len(ACHIEVEMENT_BY_KEY) != len(ACHIEVEMENTS):
    raise RuntimeError("Achievement keys must be unique.")
if not all(1 <= achievement.points <= 10 for achievement in ACHIEVEMENTS):
    raise RuntimeError("Every achievement must award between 1 and 10 points.")


# The first catalog with achievement ranks awards 451 points in total.  The
# reference thresholds are the published distribution and are scaled to the
# actual catalog total by ``achievement_rank_for_points``.  This keeps the
# advertised nine progression steps and the final Godmode tier stable even
# when the catalog grows later.
_RANK_REFERENCE_MAXIMUM = 451
ACHIEVEMENT_RANKS: tuple[AchievementRank, ...] = (
    AchievementRank("newbie", "Newbie", 0, 0),
    AchievementRank("rookie", "Rookie", 1, 10),
    AchievementRank("player", "Spieler", 2, 35),
    AchievementRank("advanced", "Fortgeschritten", 2, 75),
    AchievementRank("pro", "Pro", 3, 120),
    AchievementRank("expert", "Expert", 3, 170),
    AchievementRank("master", "Meister", 4, 230),
    AchievementRank("elite", "Elite", 4, 300),
    AchievementRank("legend", "Legende", 5, 375),
    AchievementRank("godmode", "Godmode", 5, 430),
)


def _rank_minimum_points(rank: AchievementRank) -> int:
    """Return the current catalog-scaled lower bound for one rank."""
    if rank.reference_minimum_points <= 0 or _RANK_REFERENCE_MAXIMUM <= 0:
        return 0
    return ceil(ACHIEVEMENT_POINTS_POSSIBLE * rank.reference_minimum_points / _RANK_REFERENCE_MAXIMUM)


def achievement_rank_for_points(points: int | float | None) -> dict:
    """Return the public rank payload for a cumulative achievement score."""
    try:
        earned = max(0, int(points or 0))
    except (TypeError, ValueError):
        earned = 0

    current_index = 0
    for index, rank in enumerate(ACHIEVEMENT_RANKS):
        if earned >= _rank_minimum_points(rank):
            current_index = index
        else:
            break
    current = ACHIEVEMENT_RANKS[current_index]
    next_rank = ACHIEVEMENT_RANKS[current_index + 1] if current_index + 1 < len(ACHIEVEMENT_RANKS) else None
    next_minimum = _rank_minimum_points(next_rank) if next_rank else None
    return {
        "key": current.key,
        "title": current.title,
        "stars": current.stars,
        "points": earned,
        "points_possible": ACHIEVEMENT_POINTS_POSSIBLE,
        "minimum_points": _rank_minimum_points(current),
        "next_minimum_points": next_minimum,
        "points_to_next_rank": max(0, next_minimum - earned) if next_minimum is not None else 0,
    }


def achievement_rank_legend_payload(points: int | float | None = None) -> dict:
    """Serialize the public, catalog-scaled rank ladder for the client.

    The minimums are deliberately evaluated here instead of duplicated in a
    template or JavaScript.  As the achievement catalog grows, this endpoint
    and every rank badge continue to describe the same scaled thresholds.
    ``points`` is optional so the public legend can be fetched anonymously;
    authenticated callers may include their current rank as a convenience.
    """
    payload = {
        "points_possible": ACHIEVEMENT_POINTS_POSSIBLE,
        "ranks": [
            {
                "key": rank.key,
                "title": rank.title,
                "stars": rank.stars,
                "minimum_points": _rank_minimum_points(rank),
            }
            for rank in ACHIEVEMENT_RANKS
        ],
    }
    if points is not None:
        payload["current"] = achievement_rank_for_points(points)
    return payload


def achievement_rank_for_keys(keys: Iterable[str]) -> dict:
    """Return a rank payload for a user's materialized achievement keys."""
    return achievement_rank_for_points(achievement_points_for_keys(keys))


def _normalized_user_ids(user_ids: Iterable[int]) -> set[int]:
    normalized: set[int] = set()
    for user_id in user_ids:
        if user_id is None:
            continue
        try:
            normalized.add(int(user_id))
        except (TypeError, ValueError):
            continue
    return normalized


def achievement_rank_payloads_for_user_ids(db, user_ids: Iterable[int]) -> dict[int, dict]:
    """Read public rank payloads in one query inside an existing DB session."""
    normalized_ids = _normalized_user_ids(user_ids)
    payloads = {user_id: achievement_rank_for_points(0) for user_id in normalized_ids}
    if not normalized_ids:
        return payloads
    keys_by_user: dict[int, set[str]] = {user_id: set() for user_id in normalized_ids}
    rows = db.execute(
        select(UserAchievement.user_id, UserAchievement.achievement_key).where(UserAchievement.user_id.in_(normalized_ids))
    ).all()
    for user_id, key in rows:
        keys_by_user[int(user_id)].add(str(key))
    return {
        user_id: achievement_rank_for_keys(keys_by_user[user_id])
        for user_id in normalized_ids
    }


def public_achievement_ranks(user_ids: Iterable[int]) -> dict[int, dict]:
    """Read public rank payloads safely from modules without a DB session."""
    normalized_ids = _normalized_user_ids(user_ids)
    if not normalized_ids:
        return {}
    from .database import database_schema_ready, session_scope

    if not database_schema_ready():
        return {}
    with session_scope() as db:
        return achievement_rank_payloads_for_user_ids(db, normalized_ids)


def achievement_points_for_keys(keys: Iterable[str]) -> int:
    """Return the score for known, unique unlocked achievement keys."""
    return sum(ACHIEVEMENT_POINTS_BY_KEY.get(key, 0) for key in set(keys))


def achievement_sort_key(achievement: Achievement) -> tuple[int, int, int, str]:
    """Keep related achievements together in both unlocked and locked lists."""
    kind = achievement.kind
    if kind == "account_created":
        return (0, 0, 0, achievement.key)
    if kind in {"games_played", "career_points", "statistics_views"}:
        return (10, {"games_played": 0, "career_points": 1, "statistics_views": 2}[kind], achievement.target, achievement.key)
    if kind == "normal_under_700":
        return (20, 0, 0, achievement.key)
    if kind.startswith("exact_game_score_"):
        return (20, 1, achievement.target, achievement.key)
    if kind == "single_game_score":
        return (20, 2, achievement.target, achievement.key)
    five_of_kind_order = {
        "five_ones_written": 1,
        "five_twos_written": 2,
        "five_threes_written": 3,
        "five_fours_written": 4,
        "five_fives_written": 5,
        "six_thirty": 6,
    }
    if kind in five_of_kind_order:
        return (30, five_of_kind_order[kind], 0, achievement.key)
    if kind in {
        "top_section_exact_60",
        "top_section_all_exact_60",
        "top_section",
        "row_score",
        "top_totals_equal",
        "no_top_bonus",
        "all_top_bonuses",
    }:
        return (
            30,
            {
                "top_section_exact_60": 0,
                "top_section_all_exact_60": 1,
                "top_section": 10,
                "row_score": 11,
                "top_totals_equal": 12,
                "no_top_bonus": 13,
                "all_top_bonuses": 14,
            }[kind],
            achievement.target,
            achievement.key,
        )
    if kind in {
        "min_five", "max_under_ten", "min_under_ten", "max_over_25", "min_over_25", "max_thirty",
        "diff_max", "diff_exact_125", "diff_pro", "diff_all_under_20", "diff_zero", "diffs_equal",
    }:
        return (
            40,
            {
                "min_five": 0,
                "max_under_ten": 1,
                "min_under_ten": 2,
                "max_over_25": 3,
                "min_over_25": 4,
                "max_thirty": 5,
                "diff_max": 10,
                "diff_exact_125": 11,
                "diff_pro": 12,
                "diff_all_under_20": 13,
                "diff_zero": 14,
                "diffs_equal": 15,
            }[kind],
            achievement.target,
            achievement.key,
        )
    if kind in {
        "lower_strikes", "sixty_once", "sixty_all_written", "sixty_all_struck", "full_perfect",
        "full_minimal", "poker_perfect", "poker_minimal", "styler_full_count", "kenter_struck", "kenter_all_written",
    }:
        return (
            50,
            {
                "lower_strikes": 0,
                "kenter_struck": 1,
                "kenter_all_written": 2,
                "full_minimal": 3,
                "full_perfect": 4,
                "styler_full_count": 5,
                "poker_minimal": 6,
                "poker_perfect": 7,
                "sixty_once": 8,
                "sixty_all_written": 9,
                "sixty_all_struck": 10,
            }[kind],
            achievement.target,
            achievement.key,
        )
    if kind in {
        "multiplayer_margin_2p",
        "multiplayer_margin_3p_runner_up",
        "multiplayer_margin_3p_last",
        "multiplayer_margin_2v2",
        "multiplayer_close_win",
        "multiplayer_one_point_win",
        "multiplayer_blowout",
    }:
        return (
            60,
            {
                "multiplayer_margin_2p": 0,
                "multiplayer_margin_3p_runner_up": 1,
                "multiplayer_margin_3p_last": 2,
                "multiplayer_margin_2v2": 3,
                "multiplayer_close_win": 4,
                "multiplayer_one_point_win": 5,
                "multiplayer_blowout": 6,
            }[kind],
            achievement.target,
            achievement.key,
        )
    if kind in {"daily_streak", "office_hours", "office_hours_count", "night_owl", "weekend_games", "early_bird_games"}:
        return (
            65,
            {
                "daily_streak": 0,
                "office_hours": 1,
                "office_hours_count": 2,
                "night_owl": 3,
                "weekend_games": 4,
                "early_bird_games": 5,
            }[kind],
            achievement.target,
            achievement.key,
        )
    if kind in {"hardcore_games", "hardcore_score", "hardcore_streak"}:
        return (70, {"hardcore_games": 0, "hardcore_score": 1, "hardcore_streak": 2}[kind], achievement.target, achievement.key)
    raise RuntimeError(f"Achievement {achievement.key} has no display order.")


def _snapshot_rows(snapshot_json: str, participant: GameParticipant, mode: str) -> list[dict[str, int]]:
    try:
        snapshot = json.loads(snapshot_json)
    except (TypeError, json.JSONDecodeError):
        return []
    scoreboards = snapshot.get("scoreboards") if isinstance(snapshot, dict) else None
    if not isinstance(scoreboards, dict):
        return []
    board_key = participant.team if str(mode).lower() == "2v2" and participant.team else participant.player_key
    board = scoreboards.get(str(board_key))
    if not isinstance(board, dict):
        return []
    result: list[dict[str, int]] = []
    for item in board.get("reihen", []):
        if not isinstance(item, dict) or not isinstance(item.get("rows"), dict):
            continue
        result.append({str(key): int(value) for key, value in item["rows"].items() if isinstance(value, (int, float))})
    return result


def _multiplayer_metrics(game: CompletedGame, participant: GameParticipant) -> dict[str, int | bool]:
    """Return outcome metrics for the account that occupied ``participant``.

    Only a strict winner qualifies. This deliberately excludes ties so a
    scoreboard's presentation tiebreaker can never award a win achievement.
    The three-player global win goals use the gap to second place; the separate
    ``multiplayer_margin_3p_last`` series is the requested gap to last place.
    """
    metrics: dict[str, int | bool] = {
        "multiplayer_margin_2p": 0,
        "multiplayer_margin_3p_runner_up": 0,
        "multiplayer_margin_3p_last": 0,
        "multiplayer_margin_2v2": 0,
        "multiplayer_close_win": False,
        "multiplayer_one_point_win": False,
        "multiplayer_blowout": False,
    }
    mode = str(game.mode or "").lower()
    participants = list(game.participants)

    def apply_standard_win_metrics(margin: int) -> None:
        metrics["multiplayer_close_win"] = margin <= 10
        metrics["multiplayer_one_point_win"] = margin == 1
        metrics["multiplayer_blowout"] = margin > 500

    if mode in {"2", "3"}:
        expected_participants = int(mode)
        if len(participants) != expected_participants:
            return metrics
        ordered = sorted(participants, key=lambda item: int(item.points), reverse=True)
        winner, runner_up = ordered[0], ordered[1]
        if int(winner.points) <= int(runner_up.points) or participant.id != winner.id:
            return metrics
        margin = int(winner.points) - int(runner_up.points)
        apply_standard_win_metrics(margin)
        if mode == "2":
            metrics["multiplayer_margin_2p"] = margin
        else:
            metrics["multiplayer_margin_3p_runner_up"] = margin
            metrics["multiplayer_margin_3p_last"] = int(winner.points) - int(ordered[-1].points)
        return metrics

    if mode != "2v2" or len(participants) != 4:
        return metrics
    team_members: dict[str, list[GameParticipant]] = {}
    for item in participants:
        team = str(item.team or "").strip()
        if not team:
            return metrics
        team_members.setdefault(team, []).append(item)
    if len(team_members) != 2 or any(len(members) != 2 for members in team_members.values()):
        return metrics
    team_scores: dict[str, int] = {}
    for team, members in team_members.items():
        scores = {int(member.points) for member in members}
        if len(scores) != 1:
            return metrics
        team_scores[team] = scores.pop()
    ordered_teams = sorted(team_scores.items(), key=lambda item: item[1], reverse=True)
    (winner_team, winner_points), (_loser_team, loser_points) = ordered_teams
    if winner_points <= loser_points or str(participant.team or "").strip() != winner_team:
        return metrics
    margin = winner_points - loser_points
    metrics["multiplayer_margin_2v2"] = margin
    apply_standard_win_metrics(margin)
    return metrics


def _game_metrics(game: CompletedGame, participant: GameParticipant) -> dict[str, int | bool]:
    rows = _snapshot_rows(game.snapshot_json, participant, game.mode)
    subtotals = [compute_row_subtotals(row, hardcore=bool(game.hardcore)) for row in rows]
    top_totals = [subtotal["sum_top"] for subtotal in subtotals]
    differences = [
        subtotal["sum_maxmin"]
        for row, subtotal in zip(rows, subtotals)
        if all(key in row for key in ("1", "max", "min"))
    ]
    top_max = max(top_totals, default=0)
    row_max = max((subtotal["total_column"] for subtotal in subtotals), default=0)
    lower_strikes = sum(1 for row in rows for field in LOWER_FIELDS if field in row and row[field] == 0)
    sixties = [row["60"] for row in rows if "60" in row]
    fulls = [row["full"] for row in rows if "full" in row]
    pokers = [row["poker"] for row in rows if "poker" in row]
    kenters = [row["kenter"] for row in rows if "kenter" in row]
    number_fields = {
        number: [row[str(number)] for row in rows if str(number) in row]
        for number in range(1, 7)
    }
    maximums = [row["max"] for row in rows if "max" in row]
    minimums = [row["min"] for row in rows if "min" in row]
    local_finished = as_utc(game.finished_at).astimezone(ZURICH)
    return {
        "top_max": top_max,
        "top_section_exact_60": any(total == 60 for total in top_totals),
        "top_section_all_exact_60": len(top_totals) == 4 and all(total == 60 for total in top_totals),
        "row_max": row_max,
        "lower_strikes": lower_strikes,
        "sixty_once": any(value > 0 for value in sixties),
        "sixty_all_written": len(sixties) == 4 and all(value > 0 for value in sixties),
        "sixty_all_struck": len(sixties) == 4 and all(value == 0 for value in sixties),
        "full_perfect": len(fulls) == 4 and all(value == 58 for value in fulls),
        "poker_perfect": len(pokers) == 4 and all(value == 74 for value in pokers),
        "sixty_written_count": sum(value > 0 for value in sixties),
        "sixty_struck_count": sum(value == 0 for value in sixties),
        "full_perfect_count": sum(value == 58 for value in fulls),
        "poker_perfect_count": sum(value == 74 for value in pokers),
        "full_minimal_count": sum(value == 43 for value in fulls),
        "poker_minimal_count": sum(value == 54 for value in pokers),
        "diff_max": max(differences, default=0),
        "diff_exact_125": any(value == 125 for value in differences),
        "diff_pro": len(differences) == 4
        and all(value > 60 for value in differences)
        and any(value > 80 for value in differences),
        "diff_all_under_20": len(differences) == 4 and all(value < 20 for value in differences),
        "diff_zero": any(value == 0 for value in differences),
        "kenter_struck": any(value == 0 for value in kenters),
        "kenter_written_count": sum(value > 0 for value in kenters),
        "top_totals_equal": len(top_totals) == 4 and len(set(top_totals)) == 1,
        "diffs_equal": len(differences) == 4 and len(set(differences)) == 1,
        "no_top_bonus": len(subtotals) == 4 and all(subtotal["bonus_top"] == 0 for subtotal in subtotals),
        "all_top_bonuses": len(subtotals) == 4 and all(subtotal["bonus_top"] > 0 for subtotal in subtotals),
        "five_ones_written": any(value == 5 for value in number_fields[1]),
        "five_twos_written": any(value == 10 for value in number_fields[2]),
        "five_threes_written": any(value == 15 for value in number_fields[3]),
        "five_fours_written": any(value == 20 for value in number_fields[4]),
        "five_fives_written": any(value == 25 for value in number_fields[5]),
        "min_five": any(value == 5 for value in minimums),
        "max_under_ten": any(0 < value < 10 for value in maximums),
        "min_under_ten": any(0 < value < 10 for value in minimums),
        "max_over_25": any(value > 25 for value in maximums),
        "min_over_25": any(value > 25 for value in minimums),
        "max_thirty": any(value == 30 for value in maximums),
        "six_thirty": any(value == 30 for value in number_fields[6]),
        "styler_full_count": sum(value in STYLER_FULL_VALUES for value in fulls),
        "office_hours": local_finished.weekday() < 5 and 7 <= local_finished.hour < 17,
        "night_owl": 2 <= local_finished.hour < 5,
        "weekend": local_finished.weekday() >= 5,
        "early_bird": 6 <= local_finished.hour < 7,
        **_multiplayer_metrics(game, participant),
    }


def _longest_daily_streak(games: list[tuple[CompletedGame, GameParticipant, dict[str, int | bool]]]) -> int:
    """Return the longest run of calendar days with at least one completed game.

    Achievement days use Europe/Zurich, matching the other time-based rewards.
    Multiple games on the same day count once.
    """
    days = sorted({as_utc(game.finished_at).astimezone(ZURICH).date() for game, _participant, _metrics in games})
    longest = current = 0
    previous = None
    for day in days:
        current = current + 1 if previous and day == previous + timedelta(days=1) else 1
        longest = max(longest, current)
        previous = day
    return longest


def _progress_for_user(db, user: User) -> dict[str, int | bool]:
    rows = db.execute(
        select(CompletedGame, GameParticipant)
        .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
        .options(selectinload(CompletedGame.participants))
        .where(GameParticipant.user_id == user.id)
        .order_by(CompletedGame.finished_at, CompletedGame.id)
    ).all()
    games = [(game, participant, _game_metrics(game, participant)) for game, participant in rows]
    gameplay_started_at = as_utc(user.achievement_gameplay_started_at or utcnow())
    gameplay_games = [entry for entry in games if as_utc(entry[0].finished_at) >= gameplay_started_at]
    extra_started_at = as_utc(user.achievement_extra_started_at or utcnow())
    extra_games = [entry for entry in games if as_utc(entry[0].finished_at) >= extra_started_at]
    expansion_started_at = as_utc(user.achievement_expansion_started_at or utcnow())
    expansion_games = [entry for entry in games if as_utc(entry[0].finished_at) >= expansion_started_at]
    office_hours_started_at = as_utc(user.achievement_office_hours_started_at or utcnow())
    office_hours_games = [entry for entry in games if as_utc(entry[0].finished_at) >= office_hours_started_at]
    multiplayer_started_at = as_utc(user.achievement_multiplayer_started_at or utcnow())
    multiplayer_games = [entry for entry in games if as_utc(entry[0].finished_at) >= multiplayer_started_at]
    top_section_started_at = as_utc(user.achievement_top_section_started_at or utcnow())
    top_section_games = [entry for entry in games if as_utc(entry[0].finished_at) >= top_section_started_at]
    hardcore_games = [entry for entry in games if bool(entry[0].hardcore)]
    extra_hardcore_games = [entry for entry in extra_games if bool(entry[0].hardcore)]
    scores = {int(participant.points) for _game, participant, _metrics in games}
    progress: dict[str, int | bool] = {
        "career_points": sum(int(participant.points) for _game, participant, _metrics in games),
        "games_played": len(games),
        "single_game_score": max((int(participant.points) for _game, participant, _metrics in games), default=0),
        "top_section_exact_60": any(
            bool(metrics["top_section_exact_60"]) for _game, _participant, metrics in top_section_games
        ),
        "top_section_all_exact_60": any(
            bool(metrics["top_section_all_exact_60"]) for _game, _participant, metrics in top_section_games
        ),
        "top_section": max((int(metrics["top_max"]) for _game, _participant, metrics in gameplay_games), default=0),
        "row_score": max((int(metrics["row_max"]) for _game, _participant, metrics in gameplay_games), default=0),
        "lower_strikes": max(
            (int(metrics["lower_strikes"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "sixty_once": any(bool(metrics["sixty_once"]) for _game, _participant, metrics in gameplay_games),
        "sixty_all_written": max(
            (int(metrics["sixty_written_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "sixty_all_struck": max(
            (int(metrics["sixty_struck_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "full_perfect": max(
            (int(metrics["full_perfect_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "poker_perfect": max(
            (int(metrics["poker_perfect_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "full_minimal": max(
            (int(metrics["full_minimal_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "poker_minimal": max(
            (int(metrics["poker_minimal_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "diff_max": max((int(metrics["diff_max"]) for _game, _participant, metrics in gameplay_games), default=0),
        "diff_pro": any(bool(metrics["diff_pro"]) for _game, _participant, metrics in gameplay_games),
        "diff_all_under_20": any(bool(metrics["diff_all_under_20"]) for _game, _participant, metrics in gameplay_games),
        "diff_zero": any(bool(metrics["diff_zero"]) for _game, _participant, metrics in gameplay_games),
        "kenter_struck": any(bool(metrics["kenter_struck"]) for _game, _participant, metrics in gameplay_games),
        "kenter_all_written": max(
            (int(metrics["kenter_written_count"]) for _game, _participant, metrics in gameplay_games), default=0
        ),
        "top_totals_equal": any(bool(metrics["top_totals_equal"]) for _game, _participant, metrics in gameplay_games),
        "diffs_equal": any(bool(metrics["diffs_equal"]) for _game, _participant, metrics in gameplay_games),
        "no_top_bonus": any(bool(metrics["no_top_bonus"]) for _game, _participant, metrics in gameplay_games),
        "all_top_bonuses": max(
            (4 if metrics["all_top_bonuses"] else 0 for _game, _participant, metrics in gameplay_games), default=0
        ),
        "normal_under_700": any(
            not bool(game.hardcore) and int(participant.points) < 700
            for game, participant, _metrics in games
        ),
        "five_ones_written": any(bool(metrics["five_ones_written"]) for _game, _participant, metrics in extra_games),
        "five_twos_written": any(bool(metrics["five_twos_written"]) for _game, _participant, metrics in expansion_games),
        "five_threes_written": any(bool(metrics["five_threes_written"]) for _game, _participant, metrics in expansion_games),
        "five_fours_written": any(bool(metrics["five_fours_written"]) for _game, _participant, metrics in expansion_games),
        "five_fives_written": any(bool(metrics["five_fives_written"]) for _game, _participant, metrics in expansion_games),
        "min_five": any(bool(metrics["min_five"]) for _game, _participant, metrics in extra_games),
        "max_under_ten": any(bool(metrics["max_under_ten"]) for _game, _participant, metrics in extra_games),
        "min_under_ten": any(bool(metrics["min_under_ten"]) for _game, _participant, metrics in extra_games),
        "max_over_25": any(bool(metrics["max_over_25"]) for _game, _participant, metrics in extra_games),
        "min_over_25": any(bool(metrics["min_over_25"]) for _game, _participant, metrics in extra_games),
        "diff_exact_125": any(bool(metrics["diff_exact_125"]) for _game, _participant, metrics in extra_games),
        "max_thirty": any(bool(metrics["max_thirty"]) for _game, _participant, metrics in extra_games),
        "six_thirty": any(bool(metrics["six_thirty"]) for _game, _participant, metrics in extra_games),
        "styler_full_count": sum(
            int(metrics["styler_full_count"]) for _game, _participant, metrics in extra_games
        ),
        "daily_streak": _longest_daily_streak(extra_games),
        # Diese zwei Hardcore-Reihen sind ausdrücklich rückwirkend: alle
        # gespeicherten Hardcore-Partien zählen, unabhängig vom Rolloutmarker.
        "hardcore_games": len(hardcore_games),
        "hardcore_score": max(
            (int(participant.points) for _game, participant, _metrics in hardcore_games), default=0
        ),
        "hardcore_streak": _longest_daily_streak(extra_hardcore_games),
        "office_hours": any(bool(metrics["office_hours"]) for _game, _participant, metrics in gameplay_games),
        "office_hours_count": sum(
            1 for _game, _participant, metrics in office_hours_games if bool(metrics["office_hours"])
        ),
        "multiplayer_margin_2p": max(
            (int(metrics["multiplayer_margin_2p"]) for _game, _participant, metrics in multiplayer_games), default=0
        ),
        "multiplayer_margin_3p_runner_up": max(
            (
                int(metrics["multiplayer_margin_3p_runner_up"])
                for _game, _participant, metrics in multiplayer_games
            ),
            default=0,
        ),
        "multiplayer_margin_3p_last": max(
            (int(metrics["multiplayer_margin_3p_last"]) for _game, _participant, metrics in multiplayer_games), default=0
        ),
        "multiplayer_margin_2v2": max(
            (int(metrics["multiplayer_margin_2v2"]) for _game, _participant, metrics in multiplayer_games), default=0
        ),
        "multiplayer_close_win": any(
            bool(metrics["multiplayer_close_win"]) for _game, _participant, metrics in multiplayer_games
        ),
        "multiplayer_one_point_win": any(
            bool(metrics["multiplayer_one_point_win"]) for _game, _participant, metrics in multiplayer_games
        ),
        "multiplayer_blowout": any(
            bool(metrics["multiplayer_blowout"]) for _game, _participant, metrics in multiplayer_games
        ),
        "night_owl": any(bool(metrics["night_owl"]) for _game, _participant, metrics in gameplay_games),
        "weekend_games": sum(1 for _game, _participant, metrics in gameplay_games if metrics["weekend"]),
        "early_bird_games": sum(1 for _game, _participant, metrics in gameplay_games if metrics["early_bird"]),
        "statistics_views": int(user.statistics_views),
        "account_created": True,
    }
    progress.update(
        {
            f"exact_game_score_{score}": score if score in scores else 0
            for score in EXACT_GAME_SCORE_TARGETS
        }
    )
    return progress


def _is_unlocked(achievement: Achievement, progress: dict[str, int | bool]) -> bool:
    value = progress[achievement.kind]
    return bool(value) if isinstance(value, bool) else int(value) >= achievement.target


def sync_user_achievements(db, user: User) -> dict:
    """Synchronize derived achievement rows and return the public payload."""
    progress = _progress_for_user(db, user)
    existing = {row.achievement_key: row for row in user.achievements}
    for achievement in ACHIEVEMENTS:
        unlocked = _is_unlocked(achievement, progress)
        row = existing.get(achievement.key)
        if unlocked and row is None:
            unlocked_at = user.created_at if achievement.kind == "account_created" else utcnow()
            db.add(UserAchievement(user_id=user.id, achievement_key=achievement.key, unlocked_at=unlocked_at))
        elif not unlocked and row is not None:
            db.delete(row)
    db.flush()
    unlocked_rows = {
        row.achievement_key: row
        for row in db.scalars(select(UserAchievement).where(UserAchievement.user_id == user.id))
    }
    unlocked, locked = [], []
    for achievement in sorted(ACHIEVEMENTS, key=achievement_sort_key):
        payload = {
            "key": achievement.key,
            "name": achievement.name,
            "description": achievement.description,
            "icon_key": achievement.icon_key,
            "points": achievement.points,
            "progress": {"current": int(progress[achievement.kind]), "target": achievement.target},
        }
        row = unlocked_rows.get(achievement.key)
        if row:
            payload["unlocked_at"] = row.unlocked_at
            unlocked.append(payload)
        else:
            locked.append(payload)
    # Completed achievements are a personal timeline.  A newly earned badge
    # belongs first, while the locked catalog remains grouped logically below.
    unlocked.sort(key=lambda payload: as_utc(payload["unlocked_at"]), reverse=True)
    earned_points = achievement_points_for_keys(unlocked_rows)
    return {
        "unlocked": unlocked,
        "locked": locked,
        "points_earned": earned_points,
        "points_possible": ACHIEVEMENT_POINTS_POSSIBLE,
        "rank": achievement_rank_for_points(earned_points),
    }


def sync_achievements_for_users(user_ids: set[int]) -> dict[int, list[dict]]:
    """Re-evaluate affected users after a completed game changes."""
    from .database import database_schema_ready, session_scope

    if not user_ids or not database_schema_ready():
        return {}
    newly_unlocked: dict[int, list[dict]] = {}
    with session_scope() as db:
        for user_id in user_ids:
            user = db.get(User, user_id)
            if user:
                existing_keys = {row.achievement_key for row in user.achievements}
                payload = sync_user_achievements(db, user)
                unlocked_now = [
                    achievement
                    for achievement in payload["unlocked"]
                    if achievement["key"] not in existing_keys and achievement["key"] != "account_created"
                ]
                if unlocked_now:
                    newly_unlocked[user_id] = unlocked_now
    return newly_unlocked
