"""Prospective, server-recorded proof for achievements that scores cannot prove."""

from __future__ import annotations

from .game_state import KEY_TO_ROW, WRITABLE_COLS

STYLER_EVIDENCE_KEY = "_styler_full_evidence"


def clear_styler_full_evidence(game: dict, board_id: str, key: str) -> None:
    """An edited or moved score no longer proves the original dice."""
    boards = game.get(STYLER_EVIDENCE_KEY)
    board = boards.get(str(board_id)) if isinstance(boards, dict) else None
    if isinstance(board, dict):
        board.pop(key, None)


def record_styler_full_evidence(game: dict, board_id: str, key: str, value: int, dice: list) -> None:
    """Record only successful Full writes made with five equal, valid dice.

    The face is a compact proof of the server-observed dice. An ordinary 3+2
    Full has exactly the same score, so neither historic scores nor an admin's
    manually entered points may manufacture this evidence.
    """
    clear_styler_full_evidence(game, board_id, key)
    if key not in {f"{KEY_TO_ROW['full']},{column}" for column in WRITABLE_COLS}:
        return
    if len(dice) != 5 or any(type(face) is not int or not 1 <= face <= 6 for face in dice):
        return
    if len(set(dice)) != 1 or value != 40 + 3 * dice[0]:
        return
    game.setdefault(STYLER_EVIDENCE_KEY, {}).setdefault(str(board_id), {})[key] = dice[0]


def styler_full_snapshot_evidence(game: dict) -> dict:
    """Copy only the explicit proof schema into durable completed results."""
    evidence = game.get(STYLER_EVIDENCE_KEY)
    if not isinstance(evidence, dict):
        return {"version": 1, "boards": {}}
    boards = {}
    for board_id, fields in evidence.items():
        if not isinstance(fields, dict):
            continue
        clean = {
            key: face for key, face in fields.items()
            if key in {f"{KEY_TO_ROW['full']},{column}" for column in WRITABLE_COLS}
            and type(face) is int and 1 <= face <= 6
        }
        if clean:
            boards[str(board_id)] = clean
    return {"version": 1, "boards": boards}
