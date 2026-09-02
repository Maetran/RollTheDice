"""Achievement catalog and deterministic evaluation for player profiles."""

from __future__ import annotations

import json
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from sqlalchemy import select

from .models import CompletedGame, GameParticipant, User, UserAchievement
from .rules import compute_row_subtotals
from .security import as_utc, utcnow

ZURICH = ZoneInfo("Europe/Zurich")
TOP_FIELDS = tuple(str(number) for number in range(1, 7))
LOWER_FIELDS = ("kenter", "full", "poker")


@dataclass(frozen=True)
class Achievement:
    key: str
    name: str
    description: str
    icon_key: str
    kind: str
    target: int = 1


def _tiered(kind: str, icon_key: str, values: list[tuple[int, str, str]]) -> list[Achievement]:
    return [
        Achievement(f"{kind}_{value}", name, description, icon_key, kind, value) for value, name, description in values
    ]


ACHIEVEMENTS: tuple[Achievement, ...] = tuple(
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
            "office_hours",
            "Bürozeit",
            "Ein Spiel werktags zwischen 07:00 und 17:00 Uhr beendet.",
            "office",
            "office_hours",
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
    local_finished = as_utc(game.finished_at).astimezone(ZURICH)
    return {
        "top_max": top_max,
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
        "office_hours": local_finished.weekday() < 5 and 7 <= local_finished.hour < 17,
        "night_owl": 2 <= local_finished.hour < 5,
        "weekend": local_finished.weekday() >= 5,
        "early_bird": 6 <= local_finished.hour < 7,
    }


def _progress_for_user(db, user: User) -> dict[str, int | bool]:
    rows = db.execute(
        select(CompletedGame, GameParticipant)
        .join(GameParticipant, GameParticipant.game_id == CompletedGame.id)
        .where(GameParticipant.user_id == user.id)
        .order_by(CompletedGame.finished_at, CompletedGame.id)
    ).all()
    games = [(game, participant, _game_metrics(game, participant)) for game, participant in rows]
    gameplay_started_at = as_utc(user.achievement_gameplay_started_at)
    gameplay_games = [entry for entry in games if as_utc(entry[0].finished_at) >= gameplay_started_at]
    return {
        "career_points": sum(int(participant.points) for _game, participant, _metrics in games),
        "games_played": len(games),
        "single_game_score": max((int(participant.points) for _game, participant, _metrics in games), default=0),
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
        "office_hours": any(bool(metrics["office_hours"]) for _game, _participant, metrics in gameplay_games),
        "night_owl": any(bool(metrics["night_owl"]) for _game, _participant, metrics in gameplay_games),
        "weekend_games": sum(1 for _game, _participant, metrics in gameplay_games if metrics["weekend"]),
        "early_bird_games": sum(1 for _game, _participant, metrics in gameplay_games if metrics["early_bird"]),
        "statistics_views": int(user.statistics_views),
        "account_created": True,
    }


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
    for achievement in ACHIEVEMENTS:
        payload = {
            "key": achievement.key,
            "name": achievement.name,
            "description": achievement.description,
            "icon_key": achievement.icon_key,
            "progress": {"current": int(progress[achievement.kind]), "target": achievement.target},
        }
        row = unlocked_rows.get(achievement.key)
        if row:
            payload["unlocked_at"] = row.unlocked_at
            unlocked.append(payload)
        else:
            locked.append(payload)
    return {"unlocked": unlocked, "locked": locked}


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
