"""Durable Hausdepp seats, independent of sockets and account identities."""

from __future__ import annotations

from datetime import datetime, timezone
from secrets import SystemRandom

from .active_games import save_active_game
from .game_state import GameDict, games
from .game_types import HAUSDEPP_GAME_TYPE

HAUSDEPP_CPU_NAMES = (
    "Peppi", "Seppl", "Schorsch", "Loisl", "Alois", "Wastl", "Hiasl", "Franzi", "Sepp", "Xaver",
    "Toni", "Vitus", "Bertl", "Ferdl", "Gustl", "Korbinian", "Engelbert", "Rupert", "Anderl", "Florian",
    "Lenz", "Balthasar", "Kajetan", "Quirin", "Vinzenz",
    "Resi", "Vroni", "Traudl", "Mizzi", "Liesl", "Zenzi", "Annerl", "Fanni", "Burgl", "Kathi",
    "Hanni", "Rosi", "Mitzi", "Walburga", "Hilde", "Ottilie", "Rosl", "Berta", "Theres", "Irmi",
    "Wally", "Vefi", "Maridl", "Leni", "Zilli",
)
_CPU_RANDOM = SystemRandom()


def validate_hausdepp_mode(mode: object) -> str:
    value = str(mode).strip()
    if value not in {"2", "3", "4", "5", "6"}:
        raise ValueError("hausdepp_invalid_player_count")
    return value


def new_hausdepp_game(game_id: str, name: str, mode: object, *, register: bool = True) -> GameDict:
    count = int(validate_hausdepp_mode(mode))
    now = datetime.now(timezone.utc)
    game: GameDict = {
        "_id": game_id, "_name": name, "_mode": str(count), "_game_type": HAUSDEPP_GAME_TYPE,
        "_expected": count, "_expected_connections": count, "_hardcore": False,
        "_started": False, "_finished": False, "_started_at": None, "_updated_at": now.isoformat(),
        "_last_activity": now, "_hausdepp_waiting_last_join_at": now.isoformat(),
        "_players": [], "_participants": [], "_spectators": [],
        "_hausdepp": None, "_hausdepp_cpu_count": 0, "_play_mode": "multiplayer", "_turn": None,
        "_results": None, "_aborted": False, "_passphrase": None, "_chat_history": [],
        "_superadmins": {}, "_correction": {"active": False}, "_resume_required": False,
        "_manual_pause": False, "_manual_pause_by": None, "_manual_pause_by_name": None, "_manual_pause_at": None,
    }
    if register:
        games[game_id] = game
        save_active_game(game)
    return game


def configure_hausdepp_game(game: GameDict, *, host_user_id: int, cpu_count: int = 1, tournament: bool = False) -> None:
    if game.get("_players") or game.get("_started"):
        raise ValueError("hausdepp_game_already_configured")
    if type(host_user_id) is not int or host_user_id < 1:
        raise ValueError("hausdepp_account_required")
    if type(cpu_count) is not int or not 0 <= cpu_count < game["_expected"]:
        raise ValueError("hausdepp_invalid_cpu_count")
    if type(tournament) is not bool:
        raise ValueError("hausdepp_invalid_tournament")
    game["_hausdepp_host_user_id"] = host_user_id
    game["_hausdepp_cpu_count"] = cpu_count
    game["_hausdepp_tournament_enabled"] = tournament
    game["_expected_connections"] = game["_expected"] - cpu_count
    game["_play_mode"] = "cpu" if cpu_count else "multiplayer"
    names = _CPU_RANDOM.sample(HAUSDEPP_CPU_NAMES, cpu_count)
    game["_participants"] = [{"id": f"cpu-{index + 1}", "name": names[index], "type": "cpu",
                              "is_cpu": True, "user_id": None, "connection_player_id": None}
                             for index in range(cpu_count)]


def join_hausdepp_player(game: GameDict, player: dict) -> None:
    from .hausdepp_rematch import rematch_join_guard

    with rematch_join_guard(game, player.get("user_id")):
        _join_hausdepp_player(game, player)


def _join_hausdepp_player(game: GameDict, player: dict) -> None:
    if game.get("_started") or game.get("_finished"):
        raise ValueError("hausdepp_game_already_started")
    if len(game.get("_players", [])) >= game.get("_expected_connections", game["_expected"]):
        raise ValueError("hausdepp_game_full")
    # The first human must be the creating account. No guest token can claim it.
    if (not game.get("_players") and player.get("user_id") != game.get("_hausdepp_host_user_id")
            and not game.get("_hausdepp_rematch_id")):
        raise ValueError("hausdepp_host_required")
    if player.get("user_id") is None:
        raise ValueError("hausdepp_account_required")
    # A human may have a name from the pool too. Resolve that collision before
    # play starts; established tournament seats never change their names.
    reserved = {str(person["name"]).casefold() for person in [*game.get("_participants", []), player]}
    for participant in game.get("_participants", []):
        if participant.get("is_cpu") and participant["name"].casefold() == player["name"].casefold():
            participant["name"] = _CPU_RANDOM.choice([name for name in HAUSDEPP_CPU_NAMES if name.casefold() not in reserved])
            reserved.add(participant["name"].casefold())
    game["_players"].append(player)
    participant = {"id": player["id"], "name": player["name"], "type": "human", "is_cpu": False,
                   "user_id": player["user_id"], "connection_player_id": player["id"]}
    # Humans occupy clockwise seats before the domain-only CPU seats.
    game.setdefault("_participants", []).insert(len(game["_players"]) - 1, participant)
    if game.get("_hausdepp_rematch_id"):
        joined = game.setdefault("_hausdepp_rematch_joined_ids", [])
        if player["user_id"] not in joined:
            joined.append(player["user_id"])
    game["_hausdepp_waiting_last_join_at"] = datetime.now(timezone.utc).isoformat()


def start_hausdepp_game(game: GameDict) -> None:
    if game.get("_started") or len(game.get("_players", [])) != game.get("_expected_connections", game["_expected"]):
        return
    from .hausdepp_engine import new_round

    participants = game["_participants"]
    game["_hausdepp"] = new_round(participants, dealer_index=len(participants) - 1)
    if game.get("_hausdepp_tournament_enabled"):
        from .hausdepp_tournament import new_tournament

        game["_hausdepp_tournament"] = new_tournament(game["_id"], participants)
    game["_started"] = True
    game["_started_at"] = datetime.now(timezone.utc).isoformat()
    game["_turn"] = {"player_id": game["_hausdepp"]["current_player_id"]}


def hausdepp_participants(game: GameDict) -> list[dict]:
    return game.get("_participants", [])


def hausdepp_progress(game: GameDict) -> list[dict]:
    state_players = {player["id"]: player for player in (game.get("_hausdepp") or {}).get("players", [])}
    connections = {player["id"]: player for player in game.get("_players", [])}
    return [{"id": player["id"], "name": player["name"], "is_cpu": bool(player.get("is_cpu")),
             "user_id": (player.get("user_id") if not player.get("is_cpu")
                         and type(player.get("user_id")) is int and player["user_id"] > 0 else None),
             "participant_type": player["type"], "connected": (None if player.get("is_cpu") else
                 connections.get(player["id"], {}).get("ws") is not None),
             "hand_count": len(state_players.get(player["id"], {}).get("hand", [])),
             "finished": bool(state_players.get(player["id"], {}).get("finished"))}
            for player in hausdepp_participants(game)]
