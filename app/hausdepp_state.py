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
_DEALER_RANDOM = SystemRandom()


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


def configure_hausdepp_game(game: GameDict, *, host_user_id: int, cpu_count: int = 1, tournament: bool = False,
                           waiting_mode: str = "fixed", manual_start: bool = False) -> None:
    if game.get("_players") or game.get("_started"):
        raise ValueError("hausdepp_game_already_configured")
    if type(host_user_id) is not int or host_user_id < 1:
        raise ValueError("hausdepp_account_required")
    if waiting_mode not in {"fixed", "open"} or type(manual_start) is not bool:
        raise ValueError("hausdepp_invalid_waiting_options")
    capacity = 6 if waiting_mode == "open" else game["_expected"]
    if type(cpu_count) is not int or not 0 <= cpu_count < capacity:
        raise ValueError("hausdepp_invalid_cpu_count")
    if type(tournament) is not bool:
        raise ValueError("hausdepp_invalid_tournament")
    game["_hausdepp_host_user_id"] = host_user_id
    game["_expected"] = capacity
    game["_mode"] = str(capacity)
    game["_hausdepp_waiting_mode"] = waiting_mode
    game["_hausdepp_manual_start"] = manual_start or waiting_mode == "open"
    game["_hausdepp_cpu_count"] = cpu_count
    game["_hausdepp_next_cpu_id"] = cpu_count + 1
    game["_hausdepp_tournament_enabled"] = tournament
    game["_expected_connections"] = game["_expected"] - cpu_count
    game["_play_mode"] = "cpu" if cpu_count else "multiplayer"
    names = _CPU_RANDOM.sample(HAUSDEPP_CPU_NAMES, cpu_count)
    game["_participants"] = [{"id": f"cpu-{index + 1}", "name": names[index], "type": "cpu",
                              "is_cpu": True, "user_id": None, "connection_player_id": None}
                             for index in range(cpu_count)]


def hausdepp_waiting_summary(game: GameDict) -> dict:
    """Public capacity facts; a full CPU table still admits a human before start."""
    waiting = not (game.get("_started") or game.get("_finished") or game.get("_aborted")
                   or game.get("_hausdepp") is not None)
    capacity = int(game["_expected"])
    cpu_count = sum(bool(person.get("is_cpu")) for person in game.get("_participants", []))
    free = max(0, capacity - len(game.get("_participants", []))) if waiting else 0
    replaceable = cpu_count if waiting else 0
    return {"waiting_mode": game.get("_hausdepp_waiting_mode", "fixed"),
            "manual_start": bool(game.get("_hausdepp_manual_start")),
            "tournament_enabled": bool(game.get("_hausdepp_tournament_enabled")),
            "can_join": bool(waiting and (free or replaceable)),
            "free_seats": free, "replaceable_cpus": replaceable}


def sync_hausdepp_waiting_seats(game: GameDict) -> None:
    """Keep transport capacity and durable domain seats in agreement."""
    cpus = sum(bool(person.get("is_cpu")) for person in game.get("_participants", []))
    game["_hausdepp_cpu_count"] = cpus
    game["_expected_connections"] = game["_expected"] - cpus
    game["_play_mode"] = "cpu" if cpus else "multiplayer"


def hausdepp_start_error(game: GameDict) -> str | None:
    """Explain a host's manual start without creating a partial card round."""
    if game.get("_started") or game.get("_finished") or game.get("_aborted") or game.get("_hausdepp") is not None:
        return "hausdepp_waiting_already_started"
    count = len(game.get("_participants", []))
    if count > 6:
        return "hausdepp_invalid_player_count"
    if count < 2:
        return "hausdepp_waiting_minimum_players"
    if game.get("_hausdepp_waiting_mode", "fixed") == "fixed" and count != game["_expected"]:
        return "hausdepp_waiting_not_full"
    if not game.get("_players") or any(person.get("ws") is None for person in game["_players"]):
        return "hausdepp_waiting_players_offline"
    return None


def add_hausdepp_cpu(game: GameDict) -> None:
    summary = hausdepp_waiting_summary(game)
    if not summary["free_seats"]:
        raise ValueError("hausdepp_game_full")
    reserved = {str(person["name"]).casefold() for person in game.get("_participants", [])}
    names = [name for name in HAUSDEPP_CPU_NAMES if name.casefold() not in reserved]
    next_id = int(game.get("_hausdepp_next_cpu_id", 1))
    existing_ids = {person["id"] for person in game.get("_participants", [])}
    while f"cpu-{next_id}" in existing_ids:
        next_id += 1
    game["_hausdepp_next_cpu_id"] = next_id + 1
    game.setdefault("_participants", []).append({
        "id": f"cpu-{next_id}", "name": _CPU_RANDOM.choice(names), "type": "cpu",
        "is_cpu": True, "user_id": None, "connection_player_id": None,
    })
    sync_hausdepp_waiting_seats(game)


def remove_hausdepp_cpu(game: GameDict, participant_id: object) -> None:
    if game.get("_started") or game.get("_finished") or game.get("_aborted") or game.get("_hausdepp") is not None:
        raise ValueError("hausdepp_waiting_already_started")
    participant = next((person for person in game.get("_participants", [])
                        if person.get("id") == participant_id and person.get("is_cpu")), None)
    if not participant:
        raise ValueError("hausdepp_waiting_cpu_not_found")
    game["_participants"].remove(participant)
    sync_hausdepp_waiting_seats(game)


def join_hausdepp_player(game: GameDict, player: dict) -> None:
    from .hausdepp_rematch import rematch_join_guard

    with rematch_join_guard(game, player.get("user_id")):
        _join_hausdepp_player(game, player)


def _join_hausdepp_player(game: GameDict, player: dict) -> None:
    if game.get("_started") or game.get("_finished") or game.get("_aborted"):
        raise ValueError("hausdepp_game_already_started")
    # The first human must be the creating account. No guest token can claim it.
    if (not game.get("_players") and player.get("user_id") != game.get("_hausdepp_host_user_id")
            and not game.get("_hausdepp_rematch_id")):
        raise ValueError("hausdepp_host_required")
    if player.get("user_id") is None:
        raise ValueError("hausdepp_account_required")
    if any(person.get("user_id") == player["user_id"] for person in game.get("_players", [])):
        raise ValueError("hausdepp_account_already_joined")
    summary = hausdepp_waiting_summary(game)
    if not summary["can_join"]:
        raise ValueError("hausdepp_game_full")
    if not summary["free_seats"]:
        # Admission validates account/rematch guards before a CPU is removed.
        # Always use a free seat first; only a full waiting table replaces one.
        cpu = next(person for person in reversed(game["_participants"]) if person.get("is_cpu"))
        remove_hausdepp_cpu(game, cpu["id"])
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


def start_hausdepp_game(game: GameDict, *, manual: bool = False) -> None:
    if game.get("_started") or game.get("_finished") or game.get("_aborted"):
        return
    if (game.get("_hausdepp_manual_start") or game.get("_hausdepp_waiting_mode") == "open") and not manual:
        return
    if manual and (error := hausdepp_start_error(game)):
        raise ValueError(error)
    if not manual and len(game.get("_players", [])) != game.get("_expected_connections", game["_expected"]):
        return
    from .hausdepp_engine import new_round

    participants = game["_participants"]
    if game.get("_hausdepp_waiting_mode") == "open":
        game["_expected"] = len(participants)
        game["_mode"] = str(len(participants))
        game["_expected_connections"] = len(game["_players"])
    # The first dealer is drawn for every new table, humans and CPUs alike;
    # tournaments then pass the deal clockwise after each round.
    game["_hausdepp"] = new_round(participants, dealer_index=_DEALER_RANDOM.randrange(len(participants)))
    if game.get("_hausdepp_tournament_enabled"):
        from .hausdepp_tournament import new_tournament

        game["_hausdepp_tournament"] = new_tournament(game["_id"], participants)
    from .hausdepp_experience import record_table_experience

    # New accounts get gentler computers and table tips during their first rounds.
    record_table_experience(game)
    game["_started"] = True
    game["_started_at"] = datetime.now(timezone.utc).isoformat()
    game["_turn"] = {"player_id": game["_hausdepp"]["current_player_id"]}



def hausdepp_is_host(game: dict, participant: dict) -> bool:
    """An account host may transfer to one exact guest seat, never every guest."""
    seat = game.get("_hausdepp_host_player_id")
    if seat is not None:
        return participant.get("id") == seat
    account = game.get("_hausdepp_host_user_id")
    return type(account) is int and account > 0 and participant.get("user_id") == account


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
             "finished": bool(state_players.get(player["id"], {}).get("finished")),
             "withdrawn": player["id"] in (game.get("_hausdepp") or {}).get("withdrawn_ids", []),
             "departed": player["id"] in game.get("_hausdepp_departures", {})}
            for player in hausdepp_participants(game)]
