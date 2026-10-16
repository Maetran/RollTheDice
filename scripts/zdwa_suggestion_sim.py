#!/usr/bin/env python3
"""Simulate solo ZDWA games for the highlighted field (app/zdwa_advice.py).

Every game runs through ``game_engine.compute_field_previews``, so the bots see
exactly the writable fields, points and highlight the 2026 score sheet shows.

``validate`` plays the same seeded games with one shared, simple way of holding
dice and compares how the field to write is chosen: the most raw points on the
last roll (the old highlight), the highlighted field on the last roll, and the
highlighted field as soon as one is highlighted (its keep-rolling hint).

``derive`` re-derives ``PARS`` by self-play: the player writes as soon as a
field is highlighted, otherwise holds the dice ``roll_on_gain`` names or
announces a ❗ field when that is worth more. An open cell is worth, per phase,
the average it ended with in the games where it was still open in the middle
of that phase. ``--write`` stores the table in app/zdwa_advice.py.
"""

from __future__ import annotations

import argparse
import random
import re
import sys
from collections import Counter
from multiprocessing import Pool
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import game_engine  # noqa: E402
from app import zdwa_advice as advice  # noqa: E402
from app.game_state import WRITABLE_MAP  # noqa: E402
from app.rules import compute_row_subtotals  # noqa: E402

BOTS = {
    "raw": "most raw points on the last roll (old)",
    "last": "highlighted field on the last roll",
    "hint": "highlighted field, as soon as shown",
}


def new_game(hardcore: bool) -> dict:
    return {
        "_mode": "1", "_expected": 1, "_started": True, "_finished": False, "_aborted": False,
        "_hardcore": hardcore, "_players": [{"id": "p", "name": "Sim", "ws": None}],
        "_scoreboards": {"p": {}}, "_correction": {"active": False}, "_dice": [0] * 5,
    }


def roll(g: dict, held: tuple, rng: random.Random) -> None:
    g["_dice"] = list(held) + [rng.randint(1, 6) for _ in range(5 - len(held))]
    g["_rolls_used"] += 1
    turn = g["_turn"]
    turn["roll_index"] = g["_rolls_used"]
    if turn["first4oak_roll"] is None and max(Counter(g["_dice"]).values()) >= 4:
        turn["first4oak_roll"] = turn["roll_index"]


def cell(preview: dict) -> tuple[str, str]:
    return preview["col"], WRITABLE_MAP[preview["row"]]


def simple_hold(dice: list, target: str | None, kenter_open: bool, rolls_left: int) -> tuple:
    """Shared holding: chase the one allowed field, else a Kenter draw, else the most common face."""
    counts = Counter(dice)
    common = max(counts, key=lambda face: (counts[face], face))
    if target in ("1", "2", "3", "4", "5", "6"):
        return tuple(die for die in dice if die == int(target))
    if target in ("max", "min"):
        limit = 5 if rolls_left > 1 else 4
        return tuple(die for die in dice if (die >= limit if target == "max" else die <= 7 - limit))
    if target == "full":
        second = max((face for face in counts if face != common), key=lambda face: (counts[face], face), default=0)
        return (common,) * min(3, counts[common]) + (second,) * min(2, counts[second])
    if target == "kenter" or (target is None and kenter_open and len(counts) >= 4):
        return tuple(sorted(counts))
    return (common,) * counts[common]


def smart_hold(g: dict, previews: list[dict], columns: dict, rolls_left: int) -> tuple:
    """Hold what ``roll_on_gain`` names, or announce the ❗ field worth more after the first roll."""
    four_seen = g["_turn"]["first4oak_roll"] is not None
    announced = g["_announced_row4"]
    options = []
    if g["_rolls_used"] == 1 and not announced and len(columns_open(columns)) > 1:
        if not game_engine._must_announce_after_first(g, "p"):
            later = [cell(p) for p in previews if p["col"] != "ang"]
            if later:
                options.append((*advice.roll_on_gain(columns, later, g["_dice"], rolls_left, four_seen=four_seen), None))
        for field, value in zip(advice.FIELDS, columns["ang"]):
            if value is None:
                options.append((*advice.roll_on_gain(columns, [("ang", field)], g["_dice"], rolls_left,
                                                     four_seen=four_seen, announced_poker=field == "poker"), field))
    else:
        options.append((*advice.roll_on_gain(columns, [cell(p) for p in previews], g["_dice"], rolls_left,
                                             four_seen=four_seen, announced_poker=announced == "poker"), None))
    _gain, held, field = max(options, key=lambda option: option[0])
    if field:
        g["_announced_row4"] = field
    return held


def columns_open(columns: dict) -> list:
    return [(column, index) for column, values in columns.items() for index, value in enumerate(values) if value is None]


def play(seed: int, bot: str, hardcore: bool) -> tuple[int, dict, dict]:
    """One solo game; returns the total, the final sheet and the turn each cell was written in."""
    rng = random.Random(seed)  # nosec B311  # seeded, reproducible simulation; never used for real games
    g = new_game(hardcore)
    board = g["_scoreboards"]["p"]
    written_at = {}
    for turn in range(advice.CELLS):
        g.update(_rolls_used=0, _announced_row4=None, _turn={"player_id": "p", "roll_index": 0, "first4oak_roll": None})
        game_engine._set_roll_cap_for_current_turn(g)
        held = ()
        while True:
            roll(g, held, rng)
            previews = game_engine.compute_field_previews(g)
            rolls_left = g["_rolls_max"] - g["_rolls_used"]
            pick = None
            if bot == "raw":
                if rolls_left == 0:
                    pick = max(previews, key=lambda p: p["points"])
            elif rolls_left == 0 or bot in ("hint", "smart"):
                pick = next((p for p in previews if p.get("best")), None)
            if pick:
                board[f"{pick['row']},{pick['col']}"] = pick["points"]
                written_at[cell(pick)] = turn
                break
            if rolls_left <= 0:
                raise RuntimeError(f"no field to write in game {seed}, turn {turn}")
            columns = advice.columns_from_board(board)
            if bot == "smart":
                held = smart_hold(g, previews, columns, rolls_left)
                continue
            if g["_rolls_used"] == 1 and game_engine._must_announce_after_first(g, "p"):
                def worth(preview: dict) -> float:
                    if bot == "raw":
                        return preview["points"]
                    return advice.write_gain(columns, *cell(preview), preview["points"], hardcore=hardcore)
                g["_announced_row4"] = cell(max((p for p in previews if p["col"] == "ang"), key=worth))[1]
            open_cells = columns_open(columns)
            target = g["_announced_row4"] or (advice.FIELDS[open_cells[0][1]] if len(open_cells) == 1 else None)
            kenter_open = any(cell(p)[1] == "kenter" and (p["col"] != "ang" or g["_announced_row4"]) for p in previews)
            held = simple_hold(g["_dice"], target, kenter_open, rolls_left)
    sheet = advice.columns_from_board(board)
    total = sum(compute_row_subtotals(dict(zip(advice.FIELDS, sheet[column])), hardcore=hardcore)["total_column"]
                for column in advice.COLUMNS)
    return total, sheet, written_at


# ---------------------------------------------------------------- derive
def measure(games: list, old: dict) -> dict:
    """Per column and phase, what each cell ended with when it was still open mid-phase."""
    table = {}
    for column in advice.COLUMNS:
        rows = []
        for phase in range(advice.PHASES):
            middle = (phase + 0.5) * advice.CELLS / advice.PHASES
            stats = []
            for index, field in enumerate(advice.FIELDS):
                values = [sheet[column][index] for _total, sheet, written_at in games
                          if written_at[(column, field)] >= middle]
                if len(values) < 40:
                    stats.append(rows[-1][index] if rows else _stats_from_row(old[column][phase], index))
                    continue
                if index < 6:
                    values = [value / (index + 1) for value in values]
                mean = sum(values) / len(values)
                spread = sum((value - mean) ** 2 for value in values) / len(values)
                stats.append((mean, spread if index < 6 else spread ** 0.5))
            rows.append(stats)
        table[column] = tuple(_row_from_stats(stats) for stats in rows)
    return table


def _stats_from_row(row: tuple, index: int) -> tuple:
    """(mean, spread) of field ``index`` in a ``PARS`` row, as ``measure`` collects them."""
    par = advice.Par.from_row(row)
    if index < 6:
        return par.counts[index], par.count_vars[index]
    if index == 6:
        return par.high, par.high_sd
    if index == 7:
        return par.low, par.low_sd
    return par.bottom[index - 8], 0.0


def _row_from_stats(stats: list) -> tuple:
    """A ``PARS`` row from one (mean, spread) per field: variances for 1-6, sd for + and -."""
    means, spreads = zip(*stats)
    return advice.Par(means[:6], spreads[:6], *stats[6], *stats[7], means[8:]).row()


def format_table(table: dict) -> str:
    lines = ["PARS = {"]
    for mode in ("normal", "hardcore"):
        lines.append(f'    "{mode}": {{')
        for column in advice.COLUMNS:
            lines.append(f'        "{column}": (')
            for row in table[mode][column]:
                numbers = [repr(round(value, 2)) for value in row]
                lines.append(f"            ({', '.join(numbers[:12])},")
                lines.append(f"             {', '.join(numbers[12:])}),")
            lines.append("        ),")
        lines.append("    },")
    return "\n".join(lines + ["}"])


# ---------------------------------------------------------------- command line
def _use_table(table: dict) -> None:
    advice.PARS = table
    advice._column_value.cache_clear()
    advice._recommend.cache_clear()


def _play(job: tuple) -> tuple:
    return play(*job)


def _map(jobs: list, table: dict, processes: int) -> list:
    if processes <= 1:
        _use_table(table)
        return [_play(job) for job in jobs]
    with Pool(processes, initializer=_use_table, initargs=(table,)) as pool:
        return pool.map(_play, jobs, chunksize=8)


def _mean_sd(totals: list) -> tuple[float, float]:
    mean = sum(totals) / len(totals)
    return mean, (sum((value - mean) ** 2 for value in totals) / len(totals)) ** 0.5


def validate(games: int, seed: int, hardcore: bool, processes: int) -> None:
    print(f"{games} solo games ({'hardcore' if hardcore else 'normal'}), same dice seeds and holding strategy:")
    for bot, label in BOTS.items():
        if hardcore and bot == "hint":
            continue  # one roll: the highlight is always shown
        totals = [result[0] for result in _map([(seed + i, bot, hardcore) for i in range(games)], advice.PARS, processes)]
        mean, sd = _mean_sd(totals)
        print(f"  {label:42s} {mean:7.1f} points (sd {sd:.1f})", flush=True)


def derive(games: int, rounds: int, seed: int, processes: int, write_back: bool) -> None:
    table = {mode: dict(columns) for mode, columns in advice.PARS.items()}
    for mode in ("normal", "hardcore"):
        for number in range(rounds):
            jobs = [(seed + number * games + i, "smart", mode == "hardcore") for i in range(games)]
            played = _map(jobs, table, processes)
            measured = measure(played, table[mode])
            # Half steps keep the self-consistent table from oscillating between rounds.
            table[mode] = {column: tuple(tuple((a + b) / 2 for a, b in zip(old, new))
                                         for old, new in zip(table[mode][column], measured[column]))
                           for column in advice.COLUMNS}
            print(f"{mode} round {number + 1}: mean total {_mean_sd([g[0] for g in played])[0]:.1f}", flush=True)
    text = format_table(table)
    if write_back:
        path = ROOT / "app" / "zdwa_advice.py"
        source = path.read_text(encoding="utf-8")
        path.write_text(re.sub(r"^PARS = \{\n.*?^\}$", lambda _match: text, source, count=1, flags=re.S | re.M),
                        encoding="utf-8")
    else:
        print(text)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    commands = parser.add_subparsers(dest="command", required=True)
    check = commands.add_parser("validate", help="compare raw-point writes with the highlight")
    check.add_argument("--hardcore", action="store_true")
    build = commands.add_parser("derive", help="re-derive the PARS table by self-play")
    build.add_argument("--rounds", type=int, default=3)
    build.add_argument("--write", action="store_true", help="store the table in app/zdwa_advice.py")
    for command in (check, build):
        command.add_argument("--games", type=int, default=2000)
        command.add_argument("--seed", type=int, default=1)
        command.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args(argv)
    if args.command == "validate":
        validate(args.games, args.seed, args.hardcore, args.jobs)
    else:
        derive(args.games, args.rounds, args.seed, args.jobs, args.write)


if __name__ == "__main__":
    main()
