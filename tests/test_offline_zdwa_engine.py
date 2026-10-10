"""Run the browser's local rules against the authoritative Python rules.

Node is installed in the backend CI job before pytest. Importing the standalone
module as a data URL avoids a second bundler or a browser-only test seam.
"""

from __future__ import annotations

import itertools
import json
import random
import subprocess
from pathlib import Path

from app import game_engine, game_scoring
from app.game_state import WRITABLE_COLS, WRITABLE_MAP, WRITABLE_ROWS
from app.rules import compute_row_subtotals
from tests.support import GameStateTestCase

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "frontend/offline/zdwa-engine.js"


def run_javascript(body, payload=None):
    script = """
import { readFileSync } from 'node:fs';
const engine = await import('data:text/javascript;base64,' + readFileSync(process.argv[1]).toString('base64'));
const input = JSON.parse(readFileSync(0, 'utf8'));
""" + body
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, str(ENGINE)],
        input=json.dumps(payload), text=True, capture_output=True, check=True,
        cwd=ROOT, timeout=30,
    )
    return json.loads(result.stdout)


def python_cells(game):
    cells = []
    board = game["_scoreboards"]["p1"]
    if game["_finished"] or (game["_rolls_used"] < 1 and len(board) != 47):
        return cells
    for row in WRITABLE_ROWS:
        for column in WRITABLE_COLS:
            if f"{row},{column}" in board:
                continue
            allowed, _reason = game_engine.can_write_now(
                game, "p1", row, column, during_turn_announce=game["_announced_row4"],
            )
            if not allowed:
                continue
            field = WRITABLE_MAP[row]
            points = game_scoring.score_field_value(field, game["_dice"])
            if not game["_rolls_used"] or (field == "poker" and not game_scoring.poker_points_allowed(
                game["_dice"], column, roll_index=game["_rolls_used"],
                first4oak_roll=game["_turn"]["first4oak_roll"],
                announced_poker=game["_announced_row4"] == "poker",
            )):
                points = 0
            cells.append({"row": row, "col": column, "field": field, "points": points})
    return cells


def python_projection(game):
    board = game["_scoreboards"]["p1"]
    return {
        "board": dict(board), "dice": list(game["_dice"]), "holds": list(game["_holds"]),
        "rollsUsed": game["_rolls_used"], "rollsMax": game["_rolls_max"],
        "announced": game["_announced_row4"], "firstFourRoll": game["_turn"]["first4oak_roll"],
        "finished": game["_finished"], "canRoll": game_engine.can_roll_now(game, "p1")[0],
        "cells": python_cells(game), "total": game_engine._compute_final_totals(game)["p1"],
        "valid": True,
    }


class OfflineZDWARulesTestCase(GameStateTestCase):
    def test_number_announcement_holds_later_matches_and_allows_releasing_them(self):
        actual = run_javascript("""
const game = engine.createGame();
let faces = [2, 1, 3, 4, 5];
engine.roll(game, () => faces.shift());
engine.announce(game, '2');
const afterAnnounce = [...game.holds];
faces = [2, 2, 4, 5];
engine.roll(game, () => faces.shift());
const afterSecond = { dice: [...game.dice], holds: [...game.holds] };
engine.toggleHold(game, 1);
const afterRelease = [...game.holds];
const restored = JSON.parse(JSON.stringify(game));
const valid = engine.validateSavedGame(restored);
faces = [6, 2, 5];
engine.roll(restored, () => faces.shift());
console.log(JSON.stringify({ afterAnnounce, afterSecond, afterRelease, valid,
  afterThird: { dice: restored.dice, holds: restored.holds } }));
""")
        self.assertEqual(actual, {
            "afterAnnounce": [True, False, False, False, False],
            "afterSecond": {"dice": [2, 2, 2, 4, 5], "holds": [True, True, True, False, False]},
            "afterRelease": [True, False, True, False, False],
            "valid": True,
            "afterThird": {"dice": [2, 6, 2, 2, 5], "holds": [True, False, True, True, False]},
        })

    def test_number_auto_hold_preference_can_be_disabled_and_reenabled_between_rolls(self):
        actual = run_javascript("""
const game = engine.createGame();
engine.roll(game, () => 1);
engine.announce(game, '6');
engine.toggleHold(game, 0);
engine.roll(game, () => 6, { autoHoldAnnouncedNumbers: false });
const disabled = [...game.holds];
engine.roll(game, () => 6, { autoHoldAnnouncedNumbers: true });
console.log(JSON.stringify({ disabled, enabled: game.holds }));
""")
        self.assertEqual(actual, {"disabled": [True, False, False, False, False], "enabled": [True] * 5})

    def test_non_number_announcements_do_not_change_the_players_holds(self):
        actual = run_javascript("""
console.log(JSON.stringify([null, 'max', 'min', 'kenter', 'full', 'poker', '60'].map(field => {
  const game = engine.createGame();
  engine.roll(game, () => 6);
  if (field) engine.announce(game, field);
  engine.toggleHold(game, 0);
  engine.roll(game, () => 6);
  return game.holds;
})));
""")
        self.assertEqual(actual, [[True, False, False, False, False]] * 7)

    def test_announcement_change_cancel_and_manual_rehold_keep_manual_dice(self):
        actual = run_javascript("""
const game = engine.createGame();
let faces = [2, 2, 3, 3, 4];
engine.roll(game, () => faces.shift());
engine.toggleHold(game, 0);
engine.toggleHold(game, 2);
engine.announce(game, '2');
const first = { holds: [...game.holds], automatic: [...game.autoHeldAnnouncedIndices] };
engine.announce(game, '3');
const changed = { holds: [...game.holds], automatic: [...game.autoHeldAnnouncedIndices] };
engine.toggleHold(game, 3);
engine.toggleHold(game, 3);
const restored = JSON.parse(JSON.stringify(game));
const valid = engine.validateSavedGame(restored);
engine.announce(restored, null);
console.log(JSON.stringify({ first, changed, valid, canceled: restored.holds,
  automatic: restored.autoHeldAnnouncedIndices }));
""")
        self.assertEqual(actual, {
            "first": {"holds": [True, True, True, False, False], "automatic": [1]},
            "changed": {"holds": [True, False, True, True, False], "automatic": [3]},
            "valid": True,
            "canceled": [True, False, True, True, False], "automatic": [],
        })

    def test_legacy_saved_games_keep_manual_holds_and_reject_invalid_auto_hold_provenance(self):
        actual = run_javascript("""
const game = engine.createGame();
engine.roll(game, () => 2);
engine.toggleHold(game, 0);
engine.announce(game, '2', { autoHoldAnnouncedNumbers: false });
const legacy = structuredClone(game);
delete legacy.autoHeldAnnouncedIndices;
const legacyValid = engine.validateSavedGame(legacy);
engine.announce(legacy, null);
engine.announce(game, '2');
const mutations = [null, {}, [1, 1], [-1], [5], [1.5], ['1'], [true]];
const invalid = mutations.map(value => engine.validateSavedGame({ ...game, autoHeldAnnouncedIndices:value }));
const noAnnouncement = { ...game, announced:null };
console.log(JSON.stringify({ legacyValid, manualHolds:legacy.holds, valid:engine.validateSavedGame(game),
  invalid, noAnnouncement:engine.validateSavedGame(noAnnouncement) }));
""")
        self.assertTrue(actual["legacyValid"])
        self.assertEqual(actual["manualHolds"], [True, False, False, False, False])
        self.assertTrue(actual["valid"])
        self.assertTrue(all(value is False for value in actual["invalid"]))
        self.assertFalse(actual["noAnnouncement"])

    def test_all_five_dice_results_match_all_twelve_server_categories(self):
        rolls = list(itertools.product(range(1, 7), repeat=5))
        fields = list(WRITABLE_MAP.values())
        actual = run_javascript("""
console.log(JSON.stringify(input.rolls.map(dice => input.fields.map(field => engine.scoreField(field, dice)))));
""", {"rolls": rolls, "fields": fields})
        expected = [[game_scoring.score_field_value(field, dice) for field in fields] for dice in rolls]
        self.assertEqual(actual, expected)

    def test_complete_games_match_server_holds_announcements_cells_scores_and_totals(self):
        scenarios = []
        expectations = []
        for seed in range(4):
            rng = random.Random(seed)
            game = self.make_game(mode=1, players=[("p1", "Local")])
            actions = []
            expected = [python_projection(game)]

            def record(action):
                actions.append(action)
                expected.append(python_projection(game))

            while not game["_finished"]:
                remaining = 48 - len(game["_scoreboards"]["p1"])
                # Include both five-roll last turns and last-field completion
                # without any roll, which the online rules intentionally allow.
                rolls = 0 if remaining == 1 and seed % 2 == 0 else (
                    5 if remaining == 1 else rng.randint(1, 3)
                )
                for roll_index in range(rolls):
                    dice = [rng.randint(1, 6) for _ in range(5 - sum(game["_holds"]))]
                    iterator = iter(dice)
                    game_engine.apply_roll(game, randint_fn=lambda _lo, _hi: next(iterator))
                    record({"type": "roll", "dice": dice})
                    if roll_index == 0 and (
                        game_engine._must_announce_after_first(game, "p1") or rng.random() < 0.5
                    ):
                        options = [
                            field for row, field in WRITABLE_MAP.items()
                            if f"{row},ang" not in game["_scoreboards"]["p1"]
                        ]
                        if options:
                            game_engine.apply_announcement(game, rng.choice(options))
                            record({"type": "announce", "field": game["_announced_row4"]})
                            if not game_engine._must_announce_after_first(game, "p1") and rng.random() < 0.5:
                                game_engine.apply_announcement(game, None)
                                record({"type": "announce", "field": None})
                    if roll_index + 1 < rolls:
                        for index in rng.sample(range(5), rng.randint(0, 4)):
                            game["_holds"][index] = not game["_holds"][index]
                            record({"type": "hold", "index": index})
                cell = rng.choice(python_cells(game))
                strike = rng.random() < 0.08
                game["_scoreboards"]["p1"][f"{cell['row']},{cell['col']}"] = 0 if strike else cell["points"]
                game["_finished"] = game_engine._is_game_finished(game)
                if not game["_finished"]:
                    game_engine._begin_next_turn(game, "p1")
                record({"type": "write", "row": cell["row"], "col": cell["col"], "strike": strike})
            scenarios.append(actions)
            expectations.append(expected)

        actual = run_javascript("""
const project = game => ({
  board: structuredClone(game.board), dice: [...game.dice], holds: [...game.holds],
  rollsUsed: game.rollsUsed, rollsMax: game.rollsMax, announced: game.announced,
  firstFourRoll: game.firstFourRoll, finished: game.finished, canRoll: engine.canRoll(game),
  cells: engine.allowedCells(game), total: engine.totals(game).overall,
  valid: engine.validateSavedGame(JSON.parse(JSON.stringify(game))),
});
console.log(JSON.stringify(input.map(actions => {
  const game = engine.createGame();
  const states = [project(game)];
  for (const action of actions) {
    if (action.type === 'roll') { let index = 0; engine.roll(game, () => action.dice[index++]); }
    else if (action.type === 'hold') engine.toggleHold(game, action.index);
    else if (action.type === 'announce') engine.announce(game, action.field);
    else engine.write(game, action.row, action.col, { strike: action.strike });
    states.push(project(game));
  }
  return states;
})));
""", scenarios)
        for index, (states, expected) in enumerate(zip(actual, expectations, strict=True)):
            with self.subTest(seed=index):
                self.assertEqual(states, expected)

    def test_poker_timing_matches_server_even_when_four_kind_survives_a_reroll(self):
        cases = []
        expected = []
        for dice in ([4, 4, 4, 4, 2], [6, 6, 6, 6, 6], [1, 2, 3, 4, 5]):
            for roll in (1, 2, 3):
                for first in (None, 1, roll):
                    for announced in (None, "poker"):
                        for column in ("free", "ang"):
                            game = self.make_game(mode=1, players=[("p1", "Local")])
                            game["_dice"] = dice
                            game["_rolls_used"] = roll
                            game["_turn"]["roll_index"] = roll
                            game["_turn"]["first4oak_roll"] = first
                            game["_announced_row4"] = announced
                            cases.append({"dice": dice, "rollsUsed": roll, "firstFourRoll": first, "announced": announced, "column": column})
                            expected.append(next((cell["points"] for cell in python_cells(game) if cell["row"] == 14 and cell["col"] == column), None))
        actual = run_javascript("""
console.log(JSON.stringify(input.map(value => engine.allowedCells(Object.assign(engine.createGame(), value))
  .find(cell => cell.row === 14 && cell.col === value.column)?.points ?? null)));
""", cases)
        self.assertEqual(actual, expected)

    def test_column_bonus_threshold_and_max_min_subtotals_match_server(self):
        cases = [
            {"1": 5, "2": 10, "3": 15, "4": 20, "5": 5, "6": 6, "max": 28, "min": 8},
            {"1": 4, "2": 10, "3": 15, "4": 20, "5": 5, "6": 6, "max": 8, "min": 28},
            {"1": 3, "2": 10, "3": 15, "4": 20, "5": 5, "6": 6, "max": 30},
            {"1": 0, "max": 30, "min": 5, "kenter": 35, "full": 58, "poker": 74, "60": 90},
        ]
        boards = [{f"{row},free": values[field] for row, field in WRITABLE_MAP.items() if field in values} for values in cases]
        actual = run_javascript("""
console.log(JSON.stringify(input.map(board => engine.totals({ ...engine.createGame(), board }).columns.free)));
""", boards)
        self.assertEqual(actual, [compute_row_subtotals(values) for values in cases])

    def test_only_announcement_fields_remaining_require_announcement_before_second_roll(self):
        actual = run_javascript("""
const game = engine.createGame();
for (const col of ['down', 'free', 'up']) {
  const order = col === 'up' ? [...engine.ROWS].reverse() : engine.ROWS;
  for (const row of order) { engine.roll(game, () => 1); engine.write(game, row, col); }
}
const firstAllowed = engine.canRoll(game);
engine.roll(game, () => 2);
const before = JSON.stringify(game);
let code;
try { engine.roll(game, () => 2); } catch (error) { code = error.code; }
const corrupt = structuredClone(game);
corrupt.rollsUsed = 2;
const corruptRejected = !engine.validateSavedGame(corrupt);
const result = { firstAllowed, blocked: !engine.canRoll(game), code,
  unchanged: before === JSON.stringify(game), corruptRejected };
engine.announce(game, 'full');
engine.roll(game, () => 3);
result.cells = engine.allowedCells(game);
result.valid = engine.validateSavedGame(game);
console.log(JSON.stringify(result));
""")
        self.assertEqual(actual, {
            "firstAllowed": True, "blocked": True, "code": "announcement_required",
            "unchanged": True, "corruptRejected": True, "valid": True,
            "cells": [{"row": 13, "col": "ang", "field": "full", "points": 49}],
        })

    def test_illegal_actions_leave_the_previous_local_game_unchanged(self):
        actual = run_javascript("""
const game = engine.createGame();
const results = [];
const rejected = operation => {
  const before = JSON.stringify(game);
  try { operation(); results.push({ rejected: false }); }
  catch (error) { results.push({ code: error.code, unchanged: before === JSON.stringify(game) }); }
};
rejected(() => engine.toggleHold(game, 0));
rejected(() => engine.write(game, 0, 'free'));
rejected(() => engine.announce(game, 'poker'));
rejected(() => engine.roll(game, () => 0));
engine.roll(game, () => 1);
rejected(() => engine.toggleHold(game, -1));
rejected(() => engine.write(game, 5, 'down'));
engine.announce(game, 'poker');
rejected(() => engine.write(game, 0, 'free'));
engine.roll(game, () => 1);
rejected(() => engine.announce(game, null));
engine.roll(game, () => 1);
rejected(() => engine.roll(game, () => 1));
engine.write(game, 14, 'ang');
engine.roll(game, () => 1);
rejected(() => engine.write(game, 14, 'ang'));
rejected(() => engine.announce(game, 'poker'));
console.log(JSON.stringify(results));
""")
        self.assertEqual([result["code"] for result in actual], [
            "roll_first", "roll_first", "announcement_timing", "invalid_dice", "invalid_dice",
            "cell_not_allowed", "cell_not_allowed", "announcement_timing", "no_rolls", "cell_filled", "cell_filled",
        ])
        self.assertTrue(all(result["unchanged"] for result in actual))

    def test_local_recovery_rejects_corruption_and_unknown_schema(self):
        actual = run_javascript("""
const game = engine.createGame();
engine.roll(game, () => 2);
engine.write(game, 1, 'free');
const mutations = [
  value => { value.schema = 2; }, value => { value.game = 'zilch'; },
  value => { value.mode = 'multiplayer'; }, value => { value.board['7,free'] = 12; },
  value => { value.board['1,free'] = 9; }, value => { value.board['1,free'] = 10000; },
  value => { value.board['0,free'] = -1; }, value => { value.board['1,down'] = 2; },
  value => { value.dice[0] = 9; }, value => { value.holds[0] = 'false'; },
  value => { value.rollsUsed = 6; }, value => { value.rollsMax = 5; },
  value => { value.firstFourRoll = 1; }, value => { value.finished = true; },
  value => { value.lastWrite.points = 0; }, value => { value.turn = 48; },
  value => { value.announced = 'unknown'; }, value => { value.board = null; },
];
console.log(JSON.stringify({
  valid: engine.validateSavedGame(JSON.parse(JSON.stringify(game))),
  invalid: [...mutations.map(mutate => { const value = structuredClone(game); mutate(value); return engine.validateSavedGame(value); }),
    ...[null, [], {}, 'invalid'].map(value => engine.validateSavedGame(value))],
}));
""")
        self.assertTrue(actual["valid"])
        self.assertTrue(all(valid is False for valid in actual["invalid"]))
