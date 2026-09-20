// Local-only counterpart of app/zilch_engine.py and zilch_cpu_strategy.py.
// No transport, account, achievement or leaderboard dependencies belong here.
export const RULESET = "zilch-house-v1";
const READY = "ready_to_roll";
const HOLD = "awaiting_hold";
const CONFIRM = "confirmation_roll_required";
const STRATEGIES = { conservative:500, normal:600, aggressive:700 };

function reject(code) { const error = new Error(code); error.code = code; throw error; }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function randomDie() {
  const bytes = new Uint8Array(1);
  do { globalThis.crypto.getRandomValues(bytes); } while (bytes[0] >= 252);
  return bytes[0] % 6 + 1;
}
function die(rng) {
  const value = rng();
  if (!integer(value, 1, 6)) reject("zilch_rng_invalid_result");
  return value;
}
function newTurn(playerId, turnId, count) {
  return {
    player_id:playerId, turn_id:turnId, round:Math.floor((turnId - 1) / count) + 1,
    version:0, phase:READY, dice:[0, 0, 0, 0, 0, 0], held_indices:[],
    committed_holds:[], round_points:0, rolls_used:0, roll_id:0,
    confirmation_reasons:[], last_event:null,
  };
}

/** RNG arguments are functions returning an integer from 1 through 6.
 * Commands mutate and return the same JSON-serializable game object.
 */
export function createGame({ mode = "solo", strategy = "normal", targetScore = 10000 } = {}, rng = randomDie) {
  if (!["solo", "cpu"].includes(mode)) reject("zilch_invalid_play_mode");
  if (!Object.hasOwn(STRATEGIES, strategy)) reject("zilch_invalid_cpu_strategy");
  if (targetScore !== 10000) reject("zilch_invalid_target_score");
  const players = [{ id:"you", type:"human", totalPoints:0, zilchStreak:0, rounds:[] }];
  const startRolls = [];
  let turnOrder = ["you"];
  if (mode === "cpu") {
    players.push({ id:"cpu", type:"cpu", totalPoints:0, zilchStreak:0, rounds:[] });
    for (let attempts = 0; ; attempts += 1) {
      if (attempts >= 128) reject("zilch_start_roll_repeated_tie");
      const attempt = { you:die(rng), cpu:die(rng) };
      startRolls.push(attempt);
      if (attempt.you !== attempt.cpu) {
        turnOrder = attempt.you > attempt.cpu ? ["you", "cpu"] : ["cpu", "you"];
        break;
      }
    }
  }
  return {
    schemaVersion:1, game:"zilch", ruleset:RULESET, mode, strategy, targetScore,
    players, turnOrder, startRolls, turn:newTurn(turnOrder[0], 1, players.length),
    finalRound:null, finished:false, winnerIds:[], lastEvent:{ type:"started", player_id:turnOrder[0] },
    stats:{ turns:1, rolls:0, zilchs:0, hotDice:0, highestBankedRound:0 },
  };
}

function component(kind, indices, dice, points, labelParams = {}) {
  return {
    combination_type:kind, dice_indices:indices, dice_values:indices.map(index => dice[index]),
    points, label_key:`zilch.option.${["four_of_a_kind", "five_of_a_kind", "six_of_a_kind"].includes(kind) ? "of_a_kind" : kind}`,
    label_params:labelParams,
  };
}
function ordinaryComponents(dice, indices) {
  const result = [];
  for (let face = 1; face <= 6; face += 1) {
    const positions = indices.filter(index => dice[index] === face);
    let count = positions.length;
    if (!count) continue;
    if (face === 1) {
      while (count >= 3) {
        result.push(component("three_ones", positions.splice(0, 3), dice, 1000, { count:3, face:1 }));
        count -= 3;
      }
      for (const index of positions) result.push(component("single_one", [index], dice, 100, { count:1, face:1 }));
    } else if (count >= 3) {
      const kind = { 3:"three_of_a_kind", 4:"four_of_a_kind", 5:"five_of_a_kind", 6:"six_of_a_kind" }[count];
      result.push(component(kind, positions, dice, face * 100 * 2 ** (count - 3), { count, face }));
    } else if (face === 5) {
      for (const index of positions) result.push(component("single_five", [index], dice, 50, { count:1, face:5 }));
    } else return null;
  }
  return result.sort((a, b) => compare(a.combination_type, b.combination_type) || compareIndices(a.dice_indices, b.dice_indices));
}
function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
function compareIndices(a, b) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function classify(components) {
  if (components.length === 1) {
    const first = components[0];
    return [first.combination_type, first.label_key, first.label_params];
  }
  if (components.length === 2 && components.every(value => ["three_ones", "three_of_a_kind"].includes(value.combination_type))) {
    const faces = components.map(value => value.dice_values[0]).sort((a, b) => a - b);
    return faces[0] === faces[1]
      ? ["double_triple", "zilch.option.double_triple", { face:faces[0] }]
      : ["two_triples", "zilch.option.two_triples", { first_face:faces[0], second_face:faces[1] }];
  }
  return ["combined", "zilch.option.combined", { component_count:components.length }];
}

/** The six-die subset search is equivalent to the server's disjoint component
 * search. IDs are deliberately local; no local choice is a server capability.
 */
export function scoringOptions(dice, { held_indices = [], round_points = 0, turn_id = 0, roll_id = 0 } = {}) {
  if (!Array.isArray(dice) || dice.length !== 6 || dice.some(value => !integer(value, 0, 6))) reject("zilch_invalid_dice");
  if (!Array.isArray(held_indices) || new Set(held_indices).size !== held_indices.length || held_indices.some(index => !integer(index, 0, 5))) reject("zilch_invalid_dice_indices");
  const available = dice.map((_, index) => index).filter(index => !held_indices.includes(index));
  if (!available.length || available.some(index => !dice[index])) return [];
  const selections = [];
  for (let mask = 1; mask < 2 ** available.length; mask += 1) {
    const indices = available.filter((_, index) => mask & (1 << index));
    const components = ordinaryComponents(dice, indices);
    if (components) selections.push(components);
  }
  if (available.length === 6) {
    const sorted = [...dice].sort((a, b) => a - b);
    const counts = [...new Set(dice)].map(face => dice.filter(value => value === face).length).sort((a, b) => a - b);
    const special = sorted.join("") === "123456" ? ["straight", 2000]
      : counts.join(",") === "2,2,2" ? ["three_pairs", 1500]
        : !selections.length ? ["nothing_bonus", 500] : null;
    if (special) selections.push([component(special[0], available, dice, special[1])]);
  }
  return selections.map(components => {
    const indices = components.flatMap(value => value.dice_indices).sort((a, b) => a - b);
    const hotDice = indices.length === available.length;
    const reasons = hotDice ? ["hot_dice"] : [];
    if (components.some(value => value.combination_type === "three_ones")) reasons.push("three_ones");
    const points = components.reduce((sum, value) => sum + value.points, 0);
    const [kind, labelKey, labelParams] = classify(components);
    return {
      id:`local:${turn_id}:${roll_id}:${kind}:${indices.join("")}`,
      turn_id, roll_id, combination_type:kind, components, dice_indices:indices,
      dice_values:indices.map(index => dice[index]), points, label_key:labelKey, label_params:labelParams,
      all_available_dice:hotDice, hot_dice:hotDice, free_roll:hotDice,
      requires_confirmation:reasons.length > 0, confirmation_reasons:reasons,
      follow_up_actions:!reasons.length && round_points + points >= 400
        ? ["zilch_roll_dice", "zilch_bank_points"] : ["zilch_roll_dice"],
    };
  }).sort((a, b) => b.points - a.points || compare(a.combination_type, b.combination_type) || compareIndices(a.dice_indices, b.dice_indices) || compare(a.id, b.id));
}

export function options(game) {
  const turn = game.turn;
  if (game.finished || !turn || turn.phase !== HOLD) return [];
  return scoringOptions(turn.dice, turn).filter(option => turn.rolls_used < 3 || turn.round_points + option.points >= 300);
}
function current(game) {
  if (game.finished || !game.turn) reject("zilch_game_finished");
  return game.turn;
}
export function status(game) {
  const turn = game.turn;
  const activePlayer = game.players.find(player => player.id === turn?.player_id) || null;
  let bankReason = null;
  if (game.finished || !turn) bankReason = "zilch_game_finished";
  else if (turn.phase === HOLD) bankReason = "zilch_hold_required";
  else if (turn.confirmation_reasons.length) bankReason = "zilch_confirmation_required";
  else if (turn.phase !== READY) bankReason = "zilch_bank_not_allowed";
  else if (turn.round_points < 400) bankReason = "zilch_bank_minimum_not_reached";
  return {
    activePlayer, finished:game.finished, canBank:!bankReason, bankReason,
    canRoll:!game.finished && Boolean(turn) && [READY, CONFIRM].includes(turn.phase),
    availableDiceCount:turn ? 6 - turn.held_indices.length : 0,
    confirmationRequired:Boolean(turn?.confirmation_reasons.length),
  };
}
function endTurn(game, type, reason = null) {
  const turn = game.turn;
  const player = game.players.find(candidate => candidate.id === turn.player_id);
  let penalty = 0;
  if (type === "bank") {
    player.totalPoints += turn.round_points;
    player.zilchStreak = 0;
    game.stats.highestBankedRound = Math.max(game.stats.highestBankedRound, turn.round_points);
  } else {
    player.zilchStreak += 1;
    penalty = player.zilchStreak % 3 === 0 ? 500 : 0;
    player.totalPoints = Math.max(0, player.totalPoints - penalty);
    game.stats.zilchs += 1;
  }
  const entry = {
    turn_id:turn.turn_id, round:turn.round, event:type, points:type === "bank" ? turn.round_points : 0,
    discarded_points:type === "zilch" ? turn.round_points : 0, penalty,
    total_after:player.totalPoints, zilch_streak:player.zilchStreak, rolls_used:turn.rolls_used,
  };
  player.rounds.push(entry);
  game.lastEvent = { type, player_id:player.id, points:entry.points, discarded_points:entry.discarded_points, reason, penalty, dice:[...turn.dice] };
  let nextId;
  if (game.mode === "solo") game.finished = player.totalPoints >= game.targetScore;
  else if (game.finalRound) {
    game.finalRound.pending_player_ids = game.finalRound.pending_player_ids.filter(id => id !== player.id);
    game.finished = !game.finalRound.pending_player_ids.length;
    nextId = game.finalRound.pending_player_ids[0];
  } else if (player.totalPoints >= game.targetScore) {
    const pending = game.turnOrder.filter(id => id !== player.id);
    game.finalRound = { triggered_by:player.id, pending_player_ids:pending };
    nextId = pending[0];
  }
  if (game.finished) {
    game.winnerIds = game.mode === "solo" ? [] : game.players.filter(candidate => candidate.totalPoints === Math.max(...game.players.map(value => value.totalPoints))).map(candidate => candidate.id);
    game.turn = null;
  } else {
    nextId ||= game.turnOrder[(game.turnOrder.indexOf(player.id) + 1) % game.turnOrder.length];
    game.turn = newTurn(nextId, turn.turn_id + 1, game.players.length);
    game.stats.turns += 1;
  }
  return game;
}
export function roll(game, rng = randomDie) {
  const turn = current(game);
  if (!status(game).canRoll) reject("zilch_roll_not_allowed");
  // Generate first so an invalid injected RNG cannot half-mutate a saved turn.
  const dice = turn.dice.map((value, index) => turn.held_indices.includes(index) ? value : die(rng));
  Object.assign(turn, { dice, version:turn.version + 1, phase:HOLD, rolls_used:turn.rolls_used + 1, roll_id:turn.roll_id + 1, last_event:"roll" });
  game.stats.rolls += 1;
  const raw = scoringOptions(dice, turn);
  if (!raw.length) return endTurn(game, "zilch", "no_scoring_option");
  if (turn.rolls_used >= 3 && turn.round_points + raw[0].points < 300) return endTurn(game, "zilch", "third_roll_minimum_not_reachable");
  game.lastEvent = { type:"roll", player_id:turn.player_id };
  return game;
}
export function selectHold(game, optionId) {
  const turn = current(game);
  if (turn.phase !== HOLD) reject("zilch_hold_not_allowed");
  const option = options(game).find(candidate => candidate.id === optionId);
  if (!option) reject("zilch_stale_or_invalid_option");
  turn.round_points += option.points;
  turn.committed_holds.push(option);
  turn.held_indices = option.hot_dice ? [] : [...turn.held_indices, ...option.dice_indices].sort((a, b) => a - b);
  if (option.hot_dice) { turn.dice = [0, 0, 0, 0, 0, 0]; game.stats.hotDice += 1; }
  turn.confirmation_reasons = [...option.confirmation_reasons];
  turn.phase = option.requires_confirmation ? CONFIRM : READY;
  turn.version += 1;
  turn.last_event = option.hot_dice ? "hot_dice" : "hold";
  game.lastEvent = { type:turn.last_event, player_id:turn.player_id, points:option.points };
  return game;
}
export function bank(game) {
  current(game);
  const { bankReason } = status(game);
  if (bankReason) reject(bankReason);
  return endTurn(game, "bank");
}

export function chooseCpuDecision(game) {
  const turn = current(game);
  const state = status(game);
  const own = state.activePlayer.totalPoints;
  const opponent = Math.max(0, ...game.players.filter(player => player.id !== turn.player_id).map(player => player.totalPoints));
  const gap = opponent - own;
  const available = state.availableDiceCount;
  const strategy = game.strategy;
  const priority = option => {
    const after = available - option.dice_indices.length;
    let value = option.points * 10000;
    if (strategy === "conservative") value += after * 160 - (option.hot_dice ? 90 : 0) - (option.free_roll ? 60 : 0) + (gap <= -1200 ? 40 : 0);
    else if (strategy === "normal") value += after * 80 + (option.hot_dice ? 180 : 0) + (option.all_available_dice ? 80 : 0) + (gap >= 1200 && option.free_roll ? 80 : 0);
    else value += -after * 55 + (option.hot_dice ? 620 : 0) + (option.all_available_dice ? 250 : 0) + (option.free_roll ? 180 : 0) + (gap >= 1200 && (option.hot_dice || option.free_roll) ? 250 : 0) - (gap <= -1200 ? 80 : 0);
    return value;
  };
  const choices = options(game).sort((a, b) => priority(b) - priority(a) || compare(a.id, b.id));
  if (choices.length) return { action:"select_hold", option_id:choices[0].id };
  if (state.confirmationRequired) return { action:"roll" };
  const finalReply = Boolean(game.finalRound?.pending_player_ids.includes(turn.player_id));
  const winningTotal = finalReply ? Math.max(game.targetScore, opponent) : game.targetScore;
  if (state.canBank && own + turn.round_points >= winningTotal) return { action:"bank" };
  if (finalReply && own + turn.round_points < winningTotal && state.canRoll) return { action:"roll" };
  let goal = STRATEGIES[strategy] + (gap >= 1200 ? 150 : gap <= -1200 ? -150 : 0);
  goal += available <= 2 ? -150 : available >= 5 ? 100 : 0;
  if (turn.last_event === "hot_dice" && !state.confirmationRequired) goal += 100;
  goal = Math.max(400, Math.min(1800, goal));
  if (state.canBank && (turn.round_points >= goal || !state.canRoll)) return { action:"bank" };
  if (state.canRoll) return { action:"roll" };
  reject("zilch_cpu_no_legal_action");
}
export function cpuStep(game, rng = randomDie) {
  if (status(game).activePlayer?.type !== "cpu") reject("zilch_not_cpu_turn");
  const decision = chooseCpuDecision(game);
  if (decision.action === "select_hold") return selectHold(game, decision.option_id);
  if (decision.action === "bank") return bank(game);
  return roll(game, rng);
}

/** Corrupt or unsupported saves are rejected, never submitted or repaired
 * into online progress. Extra root-owned local metadata is harmless. */
export function validateSavedGame(game) {
  try {
    if (!game || game.schemaVersion !== 1 || game.game !== "zilch" || game.ruleset !== RULESET || !["solo", "cpu"].includes(game.mode)
      || !Object.hasOwn(STRATEGIES, game.strategy) || game.targetScore !== 10000 || typeof game.finished !== "boolean") return false;
    const ids = game.mode === "solo" ? ["you"] : ["you", "cpu"];
    if (!Array.isArray(game.players) || game.players.length !== ids.length || game.players.some((player, index) => (
      player.id !== ids[index] || player.type !== (player.id === "cpu" ? "cpu" : "human")
      || !integer(player.totalPoints) || !integer(player.zilchStreak) || !Array.isArray(player.rounds)
      || player.rounds.length > 10000 || player.rounds.some(entry => !integer(entry.total_after) || !integer(entry.points) || !["bank", "zilch"].includes(entry.event))
      || player.totalPoints !== (player.rounds.at(-1)?.total_after ?? 0)
    ))) return false;
    if (!Array.isArray(game.turnOrder) || [...game.turnOrder].sort().join() !== [...ids].sort().join()
      || !Array.isArray(game.winnerIds) || new Set(game.winnerIds).size !== game.winnerIds.length
      || game.winnerIds.some(id => !ids.includes(id)) || (game.mode === "solo" && game.winnerIds.length)
      || !Array.isArray(game.startRolls) || game.startRolls.length > 128) return false;
    if (!game.stats || ["turns", "rolls", "zilchs", "hotDice", "highestBankedRound"].some(key => !integer(game.stats[key]))) return false;
    if (game.finalRound !== null && (game.mode !== "cpu" || !ids.includes(game.finalRound.triggered_by)
      || !Array.isArray(game.finalRound.pending_player_ids) || game.finalRound.pending_player_ids.length > 1
      || game.finalRound.pending_player_ids.some(id => !ids.includes(id) || id === game.finalRound.triggered_by))) return false;
    if (game.finished) {
      if (game.turn !== null || !game.players.some(player => player.totalPoints >= game.targetScore)) return false;
      if (game.mode === "solo") return true;
      if (!game.finalRound || game.finalRound.pending_player_ids.length) return false;
      const best = Math.max(...game.players.map(player => player.totalPoints));
      const winners = game.players.filter(player => player.totalPoints === best).map(player => player.id).sort();
      return [...game.winnerIds].sort().join() === winners.join();
    }
    if (game.winnerIds.length || (game.mode === "solo" && game.players[0].totalPoints >= game.targetScore)) return false;
    const turn = game.turn;
    if (!turn || !ids.includes(turn.player_id) || ![READY, HOLD, CONFIRM].includes(turn.phase)
      || !integer(turn.turn_id, 1) || !integer(turn.round, 1) || !integer(turn.version)
      || !integer(turn.round_points) || !integer(turn.rolls_used) || !integer(turn.roll_id)
      || !Array.isArray(turn.dice) || turn.dice.length !== 6 || turn.dice.some(value => !integer(value, 0, 6))
      || !Array.isArray(turn.held_indices) || turn.held_indices.length >= 6 || new Set(turn.held_indices).size !== turn.held_indices.length
      || turn.held_indices.some(index => !integer(index, 0, 5) || !turn.dice[index])
      || !Array.isArray(turn.committed_holds) || turn.committed_holds.length > 10000
      || !Array.isArray(turn.confirmation_reasons) || turn.confirmation_reasons.some(reason => !["hot_dice", "three_ones"].includes(reason))) return false;
    if ((turn.phase === CONFIRM) !== (turn.confirmation_reasons.length > 0 && turn.phase !== HOLD)) return false;
    if (turn.phase === HOLD && !options(game).length) return false;
    return true;
  } catch { return false; }
}
