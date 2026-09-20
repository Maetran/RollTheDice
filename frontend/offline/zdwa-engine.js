// Local standard solo rules. This module has no transport, account, storage or
// achievement dependencies. Scores are recreational and never authoritative.
export const ROWS = Object.freeze([0, 1, 2, 3, 4, 5, 9, 10, 12, 13, 14, 15]);
export const COLS = Object.freeze(["down", "free", "up", "ang"]);
export const FIELD_BY_ROW = Object.freeze({
  0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6",
  9: "max", 10: "min", 12: "kenter", 13: "full", 14: "poker", 15: "60",
});
const FIELDS = Object.values(FIELD_BY_ROW);
const ROW_BY_FIELD = Object.fromEntries(Object.entries(FIELD_BY_ROW).map(([row, field]) => [field, Number(row)]));
const owns = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const filledCount = game => Object.keys(game.board).length;
const remainingCount = game => 48 - filledCount(game);
const fullColumn = (game, col) => ROWS.every(row => owns(game.board, `${row},${col}`));

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertActive(game) {
  if (game.finished) fail("game_finished", "Spiel ist bereits beendet");
}

export function createGame() {
  return {
    schema: 1, game: "zdwa", mode: "solo", board: {},
    dice: [0, 0, 0, 0, 0], holds: [false, false, false, false, false],
    rollsUsed: 0, rollsMax: 3, announced: null, firstFourRoll: null,
    turn: 1, finished: false, lastWrite: null,
  };
}

function counts(dice) {
  const result = new Map();
  for (const face of dice) if (face) result.set(face, (result.get(face) || 0) + 1);
  return result;
}

export function scoreField(field, dice) {
  const occurrences = counts(dice);
  if (/^[1-6]$/.test(field)) return (occurrences.get(Number(field)) || 0) * Number(field);
  if (field === "max" || field === "min") return dice.reduce((sum, face) => sum + face, 0);
  if (field === "kenter") return occurrences.size === 5 ? 35 : 0;
  if (field === "full") {
    const values = [...occurrences.values()].sort((a, b) => a - b);
    if (String(values) === "2,3" || String(values) === "5") {
      const face = [...occurrences.entries()].find(([, count]) => count >= 3)[0];
      return 40 + 3 * face;
    }
    return 0;
  }
  if (field === "poker") {
    const match = [...occurrences.entries()].find(([, count]) => count >= 4);
    return match ? 50 + 4 * match[0] : 0;
  }
  if (field === "60") {
    const match = [...occurrences.entries()].find(([, count]) => count === 5);
    return match ? 60 + 5 * match[0] : 0;
  }
  return 0;
}

function pokerAllowed(game, col) {
  const sizes = [...counts(game.dice).values()];
  if (!sizes.some(size => size >= 4)) return false;
  if (sizes.includes(5) || (col === "ang" && game.announced === "poker")) return true;
  const first = game.firstFourRoll ?? game.rollsUsed;
  return Boolean(first && game.rollsUsed === first);
}

export function announcementRequired(game) {
  return !game.finished && remainingCount(game) > 1
    && ["down", "free", "up"].every(col => fullColumn(game, col));
}

export function canRoll(game) {
  return !game.finished && game.rollsUsed < game.rollsMax
    && !(game.rollsUsed >= 1 && !game.announced && announcementRequired(game));
}

function randomDie() {
  // Reject the small uneven tail rather than biasing one face with modulo.
  const data = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(data); } while (data[0] >= 4294967292);
  return 1 + data[0] % 6;
}

export function roll(game, rng = randomDie) {
  assertActive(game);
  if (game.rollsUsed >= game.rollsMax) fail("no_rolls", "Keine Würfe mehr");
  if (game.rollsUsed >= 1 && !game.announced && announcementRequired(game)) {
    fail("announcement_required", "Bitte zuerst ein ❗-Feld ansagen, bevor weiter gewürfelt wird");
  }
  const dice = game.dice.map((face, index) => game.holds[index] ? face : rng());
  if (!dice.every(face => Number.isInteger(face) && face >= 1 && face <= 6)) {
    fail("invalid_dice", "Ungültige Würfelauswahl");
  }
  game.dice = dice;
  game.rollsUsed += 1;
  if (game.firstFourRoll === null && [...counts(dice).values()].some(count => count >= 4)) {
    game.firstFourRoll = game.rollsUsed;
  }
  return game;
}

export function toggleHold(game, index) {
  assertActive(game);
  if (game.rollsUsed < 1) fail("roll_first", "Erst würfeln");
  if (!Number.isInteger(index) || index < 0 || index >= 5) fail("invalid_dice", "Ungültige Würfelauswahl");
  game.holds[index] = !game.holds[index];
  return game;
}

export function announce(game, field) {
  assertActive(game);
  if (game.rollsUsed !== 1) fail("announcement_timing", "Ansage (oder Änderung) nur direkt nach Wurf 1");
  if (field === null) {
    if (!game.announced) fail("no_announcement", "Keine Ansage aktiv");
  } else {
    if (!FIELDS.includes(field)) fail("invalid_announcement", "Ungültiges Ansage-Feld");
    if (owns(game.board, `${ROW_BY_FIELD[field]},ang`)) fail("cell_filled", "Dieses Feld ist bereits befüllt");
  }
  game.announced = field;
  return game;
}

function cellAllowed(game, row, col) {
  if (owns(game.board, `${row},${col}`)) return false;
  if (remainingCount(game) === 1) return true;
  if (game.announced) return col === "ang" && FIELD_BY_ROW[row] === game.announced;
  if (col === "free") return true;
  if (col === "ang") return game.rollsUsed === 1;
  const order = col === "down" ? ROWS : [...ROWS].reverse();
  return row === order.find(candidate => !owns(game.board, `${candidate},${col}`));
}

export function allowedCells(game) {
  if (game.finished || (game.rollsUsed < 1 && remainingCount(game) !== 1)) return [];
  const cells = [];
  for (const row of ROWS) for (const col of COLS) {
    if (!cellAllowed(game, row, col)) continue;
    const field = FIELD_BY_ROW[row];
    const points = game.rollsUsed < 1 || (field === "poker" && !pokerAllowed(game, col))
      ? 0 : scoreField(field, game.dice);
    cells.push({ row, col, field, points });
  }
  return cells;
}

export function write(game, row, col, { strike = false } = {}) {
  assertActive(game);
  if (!ROWS.includes(row)) fail("invalid_row", "Dieses Feld ist nicht beschreibbar");
  if (!COLS.includes(col)) fail("invalid_column", "Ungültige Spalte");
  if (owns(game.board, `${row},${col}`)) fail("cell_filled", "Dieses Feld ist bereits befüllt");
  if (game.rollsUsed < 1 && remainingCount(game) !== 1) fail("roll_first", "Erst würfeln");
  const cell = allowedCells(game).find(candidate => candidate.row === row && candidate.col === col);
  if (!cell) fail("cell_not_allowed", "Dieses Feld ist nicht beschreibbar");
  const points = strike ? 0 : cell.points;
  game.board[`${row},${col}`] = points;
  game.lastWrite = { row, col, field: cell.field, points };
  game.finished = remainingCount(game) === 0;
  if (!game.finished) {
    game.turn += 1;
    game.dice = [0, 0, 0, 0, 0];
    game.holds = [false, false, false, false, false];
    game.rollsUsed = 0;
    game.rollsMax = remainingCount(game) === 1 ? 5 : 3;
    game.announced = null;
    game.firstFourRoll = null;
  }
  return game;
}

export function totals(game) {
  const columns = {};
  let overall = 0;
  for (const col of COLS) {
    const value = row => game.board[`${row},${col}`] || 0;
    const sumTop = [0, 1, 2, 3, 4, 5].reduce((sum, row) => sum + value(row), 0);
    const bonusTop = sumTop >= 60 ? 30 : 0;
    const sumMaxmin = [0, 9, 10].every(row => owns(game.board, `${row},${col}`))
      ? Math.max(0, value(0) * (value(9) - value(10))) : 0;
    const sumBottom = [12, 13, 14, 15].reduce((sum, row) => sum + value(row), 0);
    columns[col] = {
      sum_top: sumTop, bonus_top: bonusTop, total_top: sumTop + bonusTop,
      sum_maxmin: sumMaxmin, sum_bottom: sumBottom,
      total_column: sumTop + bonusTop + sumMaxmin + sumBottom,
    };
    overall += columns[col].total_column;
  }
  const filled = filledCount(game);
  return { columns, overall, filled, remaining: 48 - filled };
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validPoints(row, points) {
  if (!Number.isInteger(points) || points < 0) return false;
  if (points === 0) return true;
  const field = FIELD_BY_ROW[row];
  if (/^[1-6]$/.test(field)) return points <= 5 * Number(field) && points % Number(field) === 0;
  if (field === "max" || field === "min") return points >= 5 && points <= 30;
  if (field === "kenter") return points === 35;
  if (field === "full") return points >= 43 && points <= 58 && (points - 40) % 3 === 0;
  if (field === "poker") return points >= 54 && points <= 74 && (points - 50) % 4 === 0;
  return field === "60" && points >= 65 && points <= 90 && (points - 60) % 5 === 0;
}

export function validateSavedGame(game) {
  // This protects local recovery from old/corrupt storage, not from cheating.
  // No local result is ever eligible for online scores or achievements.
  if (!plainObject(game) || game.schema !== 1 || game.game !== "zdwa" || game.mode !== "solo"
    || !plainObject(game.board) || typeof game.finished !== "boolean") return false;
  for (const [key, points] of Object.entries(game.board)) {
    const [rowText, col, extra] = key.split(",");
    const row = Number(rowText);
    if (extra !== undefined || String(row) !== rowText || !ROWS.includes(row)
      || !COLS.includes(col) || !validPoints(row, points)) return false;
  }
  for (const col of ["down", "up"]) {
    const order = col === "down" ? ROWS : [...ROWS].reverse();
    let empty = false;
    for (const row of order) {
      if (!owns(game.board, `${row},${col}`)) empty = true;
      else if (empty) return false;
    }
  }
  const filled = filledCount(game);
  if (game.finished !== (filled === 48) || game.turn !== (game.finished ? 48 : filled + 1)) return false;
  if (game.rollsMax !== (filled >= 47 ? 5 : 3) || !Number.isInteger(game.rollsUsed)
    || game.rollsUsed < 0 || game.rollsUsed > game.rollsMax) return false;
  if (!Array.isArray(game.dice) || game.dice.length !== 5
    || !game.dice.every(face => Number.isInteger(face) && (game.rollsUsed ? face >= 1 && face <= 6 : face === 0))) return false;
  if (!Array.isArray(game.holds) || game.holds.length !== 5
    || !game.holds.every(held => typeof held === "boolean" && (game.rollsUsed > 0 || !held))) return false;
  if (game.firstFourRoll !== null && (!Number.isInteger(game.firstFourRoll)
    || game.firstFourRoll < 1 || game.firstFourRoll > game.rollsUsed)) return false;
  if (game.firstFourRoll === null && [...counts(game.dice).values()].some(count => count >= 4)) return false;
  if (game.announced !== null && (!FIELDS.includes(game.announced) || game.rollsUsed < 1
    || (!game.finished && owns(game.board, `${ROW_BY_FIELD[game.announced]},ang`)))) return false;
  if (game.rollsUsed > 1 && !game.announced && announcementRequired(game)) return false;
  if (filled === 0) return game.lastWrite === null;
  const last = game.lastWrite;
  return plainObject(last) && ROWS.includes(last.row) && COLS.includes(last.col)
    && last.field === FIELD_BY_ROW[last.row] && owns(game.board, `${last.row},${last.col}`)
    && game.board[`${last.row},${last.col}`] === last.points;
}
