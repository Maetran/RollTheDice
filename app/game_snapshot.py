"""Client-safe game snapshots and final result projections."""

from __future__ import annotations

import logging
import os

from .achievements import public_achievement_ranks
from .game_admin import superadmin_edit_active
from .game_engine import (
    _compute_final_totals,
    compute_suggestions,
)
from .game_scoring import has_n_of_a_kind
from .game_state import (
    CHAT_HISTORY_LIMIT,
    GameDict,
    _format_duration_hm,
    _offline_players,
    _player_connected,
    check_timeout_and_abort,
    is_team_mode,
    multiplayer_pause_reason,
    pause_remaining_seconds,
    timeout_seconds,
)

logger = logging.getLogger(__name__)


def refresh_game_achievement_ranks(g: GameDict) -> None:
    """Hydrate account-player ranks once and refresh them after a finish.

    Active games retain their player dictionaries across reconnects and server
    restarts.  Keeping the public rank beside that identity avoids a database
    query for every dice roll while still making a newly unlocked title visible
    in the final snapshot.
    """
    players = list(g.get("_players", [])) + list(g.get("_spectators", []))
    refresh_final = bool(g.get("_finished") and not g.get("_achievement_ranks_finalized"))
    candidates = [
        player
        for player in players
        if player.get("user_id") is not None and (refresh_final or not isinstance(player.get("achievement_rank"), dict))
    ]
    if not candidates:
        return
    ranks = public_achievement_ranks(player.get("user_id") for player in candidates)
    for player in candidates:
        try:
            rank = ranks.get(int(player["user_id"]))
        except (TypeError, ValueError):
            rank = None
        if rank:
            player["achievement_rank"] = rank
    if refresh_final:
        g["_achievement_ranks_finalized"] = True


def public_player_payload(player: dict, *, connected: bool | None = None) -> dict:
    """Serialize a player identity consistently for lobby and game clients."""
    payload = {
        "id": str(player.get("id") or ""),
        "name": player.get("name", "Player"),
        "user_id": player.get("user_id"),
    }
    if connected is not None:
        payload["connected"] = bool(connected)
    if isinstance(player.get("achievement_rank"), dict):
        payload["achievement_rank"] = player["achievement_rank"]
    return payload


def _serialize_scoreboards(g: GameDict) -> dict:
    """Bereitet Scoreboards für den Snapshot vor (Team/Einzel vereinheitlicht).

    Args:
        g (GameDict): Spielzustand

    Returns:
        dict: Scoreboards als Dictionary
    """
    out = {}
    for pid, board in g["_scoreboards"].items():
        sb = {}
        for k, v in board.items():
            if isinstance(k, str):
                sb[k] = v
        out[pid] = sb
    return out


# -----------------------------
# Snapshot / Broadcast
# -----------------------------


def snapshot(g: GameDict) -> dict:
    """Erzeugt den vollständigen Spiel-Snapshot für den Client.

    Enthält Spieler/Teams, Boards, aktuelle Würfel/Holds, Zugstatus, Ansage,
    Korrekturstatus, Vorschläge und optionale Ergebnisse.

    Args:
        g (GameDict): Spielzustand

    Returns:
        dict: Spiel-Snapshot als Dictionary
    """
    try:
        # --- Poker-Debug (optional via env): zeigt Serverzustand im Client ---
        def _dbg_poker():
            if os.getenv("DEBUG_POKER", "").strip() != "1":
                return None
            cur = g.get("_turn", {}) or {}
            dice = (g.get("_dice") or [])[:]
            has4 = has_n_of_a_kind(dice, 4)
            has5 = has_n_of_a_kind(dice, 5)
            return {
                "roll_index": int(cur.get("roll_index", 0) or 0),
                "first4oak_roll": cur.get("first4oak_roll"),
                "announced": g.get("_announced_row4"),
                "has4": bool(has4),
                "has5": bool(has5),
                "dice": dice,
            }

        # Auto-Timeout prüfen
        check_timeout_and_abort(g)
        refresh_game_achievement_ranks(g)
        # Ergebnisse (falls abgeschlossen) berechnen
        if g["_finished"] and not g.get("_results"):
            g["_results"] = _compute_results_for_snapshot(g)

        # --- Auto-advance roll trigger logic ---
        # Im 1P-Modus und im Hardcore-Modus (alle Modi) wird der erste Wurf automatisch angestoßen,
        # sobald ein neuer Zug beginnt (würfel alle 0, keine Holds, keine Würfe verwendet).
        _auto_single = False
        if (
            (g.get("_expected") == 1 or bool(g.get("_hardcore")))
            and not g.get("_finished")
            and g.get("_turn") is not None
        ):
            # Only if dice are all zero, no holds, and no rolls used
            dice = g.get("_dice", [])
            holds = g.get("_holds", [])
            rolls_used = g.get("_rolls_used", 0)
            if (
                isinstance(dice, list)
                and all(d == 0 for d in dice)
                and isinstance(holds, list)
                and all(not h for h in holds)
                and rolls_used == 0
            ):
                # This is the auto-roll trigger condition
                # Set _turn to same player (no-op in effect, but triggers client auto-roll)
                g["_turn"] = dict(g["_turn"])  # make sure to trigger update if needed
                _auto_single = True
        else:
            _auto_single = False

        offline_players = _offline_players(g)
        pause_reason = multiplayer_pause_reason(g)
        pause_left = pause_remaining_seconds(g)
        return {
            "_name": g["_name"],
            "_hardcore": bool(g.get("_hardcore", False)),
            "_players": [
                public_player_payload(p, connected=_player_connected(p))
                for p in g["_players"]
            ],
            "_players_joined": len(g["_players"]),
            "_expected": g["_expected"],
            "_started": g["_started"],
            "_finished": g["_finished"],
            "_started_at": g.get("_started_at"),
            "_updated_at": g.get("_updated_at"),
            "_aborted": g.get("_aborted", False),
            "_paused": bool(pause_reason),
            "_pause_reason": pause_reason,
            "_manual_pause": bool(g.get("_manual_pause")),
            "_pause_remaining_seconds": pause_left,
            "_pause_remaining_label": _format_duration_hm(pause_left),
            "_timeout_seconds": timeout_seconds(),
            "_timeout_label": _format_duration_hm(timeout_seconds()),
            "_offline_players": offline_players,
            "_connected": {str(p.get("id")): _player_connected(p) for p in g.get("_players", [])},
            "locked": bool(g.get("_passphrase")),  # neu: passwortgeschütztes Spiel kennzeichnen
            "_turn": g["_turn"],
            "_dice": g["_dice"],
            "_holds": g["_holds"],
            "_rolls_used": g["_rolls_used"],
            "_rolls_max": g["_rolls_max"],
            "_scoreboards": ({} if is_team_mode(g) else _serialize_scoreboards(g)),
            "_admin_edits": g.get("_admin_edits", {}),
            "_superadmin_active": superadmin_edit_active(g),
            "_announced_row4": g["_announced_row4"],
            "_announced_by": g.get("_announced_by"),  # player-id (Einzel/2/3 Spieler)
            "_announced_board": g.get("_announced_board"),  # board-id: team-id ("A"/"B") in 2v2, sonst player-id
            "_correction": g["_correction"],
            # Team-Infos für 2v2
            "_mode": g.get("_mode"),
            "_teams": (
                [
                    {
                        "id": "A",
                        "name": g.get("_teams", {}).get("A", {}).get("name", "Team A"),
                        # Nur IDs liefern – der Client mappt Namen aus _players
                        "members": g.get("_teams", {}).get("A", {}).get("members", []),
                    },
                    {
                        "id": "B",
                        "name": g.get("_teams", {}).get("B", {}).get("name", "Team B"),
                        "members": g.get("_teams", {}).get("B", {}).get("members", []),
                    },
                ]
                if is_team_mode(g)
                else []
            ),
            "_scoreboards_by_team": (g.get("_scoreboards_by_team", {}) if is_team_mode(g) else {}),
            "_results": g.get("_results"),
            "_last_write_public": {
                pid: [int(rc[0]), str(rc[1])] if (isinstance(rc, tuple) and len(rc) == 2) else rc
                for pid, rc in g.get("_last_write", {}).items()
            },
            "_has_last": {pid: bool(g["_last_write"].get(pid)) for pid in g["_scoreboards"].keys()},
            "_auto_single": _auto_single,
            "_chat_history": list(g.get("_chat_history", []))[-CHAT_HISTORY_LIMIT:],
            # Serverseitig berechnete Vorschläge für den aktiven Spieler.
            "suggestions": compute_suggestions(g),
            # Optionales Poker-Debugging
            "_dbg_poker": _dbg_poker(),
        }
    except Exception:
        logger.exception("Could not build snapshot for game %s", g.get("_id"))
        return {}


def _compute_results_for_snapshot(g: GameDict):
    """Berechnet die Ergebnisse für den Snapshot eines Spiels.

    Args:
        g (GameDict): Spielzustand

    Returns:
        list[dict]: Ergebnisse als Liste von Dictionaries
    """
    totals = _compute_final_totals(g)
    res = []
    if is_team_mode(g):
        # Teams im Snapshot anzeigen
        for tid in ("A", "B"):
            res.append(
                {
                    "player": g.get("_teams", {}).get(tid, {}).get("name", f"Team {tid}"),
                    "total": int(totals.get(tid, 0)),
                }
            )
        res.sort(key=lambda x: x["total"], reverse=True)
        return res
    # Einzel/3P
    for p in g["_players"]:
        pid = p["id"]
        result = {"player": p.get("name", "Player"), "total": int(totals.get(pid, 0))}
        if p.get("user_id") is not None:
            result["user_id"] = p["user_id"]
        if isinstance(p.get("achievement_rank"), dict):
            result["achievement_rank"] = p["achievement_rank"]
        res.append(result)
    res.sort(key=lambda x: x["total"], reverse=True)
    return res
