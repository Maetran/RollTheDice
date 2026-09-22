import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// The repository's test configuration is CommonJS; load this dependency-free
// browser ES module without changing package-wide Node module semantics.
const source = readFileSync(new URL("../../frontend/offline/zilch-engine.js", import.meta.url));
const engine = await import(`data:text/javascript;base64,${source.toString("base64")}`);

const request = JSON.parse(readFileSync(0, "utf8"));
const signature = option => ({
  combination_type:option.combination_type, dice_indices:option.dice_indices, dice_values:option.dice_values,
  points:option.points, label_key:option.label_key, label_params:option.label_params,
  hot_dice:option.hot_dice, all_available_dice:option.all_available_dice,
  free_roll:option.free_roll, requires_confirmation:option.requires_confirmation,
  confirmation_reasons:option.confirmation_reasons, follow_up_actions:option.follow_up_actions,
});
function view(game) {
  const turn = game.turn ? { ...game.turn } : null;
  if (turn) delete turn.committed_holds;
  return { turn, players:game.players, finalRound:game.finalRound, finished:game.finished, winnerIds:game.winnerIds };
}
function trace({ mode, strategy, seed }) {
  let state = seed >>> 0;
  let rolled = [];
  const rng = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const value = Math.floor(state / 4294967296 * 6) + 1;
    rolled.push(value);
    return value;
  };
  const strategyRoll = ["conservative", "normal", "aggressive"].indexOf(strategy) + 1;
  const game = engine.createGame({ mode }, rng, () => strategyRoll);
  const opening = structuredClone(game.startRolls);
  const steps = [];
  for (let index = 0; !game.finished; index += 1) {
    assert.ok(index < 10000, "seeded game must terminate");
    assert.ok(engine.validateSavedGame(JSON.parse(JSON.stringify(game))));
    const decision = engine.chooseCpuDecision(game);
    const option = engine.options(game).find(candidate => candidate.id === decision.option_id);
    rolled = [];
    if (engine.status(game).activePlayer.type === "cpu") engine.cpuStep(game, rng);
    else if (decision.action === "roll") engine.roll(game, rng);
    else if (decision.action === "bank") engine.bank(game);
    else engine.selectHold(game, decision.option_id);
    steps.push(structuredClone({ action:decision.action, option:option ? signature(option) : null, rolled, view:view(game) }));
  }
  assert.ok(engine.validateSavedGame(JSON.parse(JSON.stringify(game))));
  assert.throws(() => engine.roll(game), /zilch_game_finished/);
  return { mode, strategy, opening, steps };
}
function checks() {
  const sequence = values => () => { assert.ok(values.length); return values.shift(); };
  for (let roll = 1; roll <= 6; roll += 1) {
    let strategyDraws = 0;
    const selected = engine.createGame({ mode:"cpu", strategy:"normal" }, sequence([6, 1]), () => { strategyDraws += 1; return roll; });
    assert.equal(selected.strategy, ["conservative", "normal", "aggressive"][(roll - 1) % 3]);
    assert.equal(strategyDraws, 1);
    assert.deepEqual(selected.startRolls, [{ you:6, cpu:1 }]);
    const restored = JSON.parse(JSON.stringify(selected));
    assert.ok(engine.validateSavedGame(restored));
    assert.equal(restored.strategy, selected.strategy);
  }
  const hold = (game, kind) => {
    const option = engine.options(game).find(candidate => candidate.combination_type === kind);
    assert.ok(option, kind);
    engine.selectHold(game, option.id);
  };
  const confirmation = engine.createGame();
  engine.roll(confirmation, sequence([1, 1, 1, 2, 3, 4]));
  hold(confirmation, "three_ones");
  assert.equal(confirmation.turn.round_points, 1000);
  assert.throws(() => engine.bank(confirmation), /zilch_confirmation_required/);
  engine.roll(confirmation, sequence([5, 2, 3]));
  hold(confirmation, "single_five");
  engine.bank(confirmation);
  assert.equal(confirmation.players[0].totalPoints, 1050);

  const hot = engine.createGame();
  engine.roll(hot, sequence([1, 2, 3, 4, 5, 6]));
  const stale = engine.options(hot).find(option => option.combination_type === "straight").id;
  engine.selectHold(hot, stale);
  assert.equal(hot.turn.round_points, 2000);
  assert.deepEqual(hot.turn.dice, [0, 0, 0, 0, 0, 0]);
  assert.equal(engine.status(hot).availableDiceCount, 6);
  assert.throws(() => engine.bank(hot), /zilch_confirmation_required/);
  engine.roll(hot, sequence([5, 2, 3, 4, 6, 2]));
  assert.throws(() => engine.selectHold(hot, stale), /zilch_stale_or_invalid_option/);
  hold(hot, "single_five");
  engine.bank(hot);
  assert.equal(hot.players[0].totalPoints, 2050);

  const loss = engine.createGame();
  loss.players[0].totalPoints = 800;
  for (let count = 1; count <= 6; count += 1) {
    engine.roll(loss, sequence([5, 2, 3, 4, 6, 2]));
    hold(loss, "single_five");
    engine.roll(loss, sequence([5, 2, 3, 4, 6]));
    hold(loss, "single_five");
    engine.roll(loss, sequence([5, 2, 3, 4]));
    assert.equal(loss.lastEvent.reason, "third_roll_minimum_not_reachable");
    assert.equal(loss.players[0].zilchStreak, count);
    assert.equal(loss.players[0].totalPoints, count >= 6 ? 0 : count >= 3 ? 300 : 800);
  }
  assert.equal(loss.lastEvent.penalty, 500);
  assert.equal(loss.stats.rolls, 18);

  const tie = engine.createGame({ mode:"cpu" }, sequence([6, 1]));
  tie.players.forEach(player => { player.totalPoints = 9800; });
  for (let count = 0; count < 2; count += 1) {
    engine.roll(tie, sequence([4, 4, 4, 2, 3, 6]));
    hold(tie, "three_of_a_kind");
    engine.bank(tie);
    assert.equal(tie.finished, count === 1);
  }
  assert.deepEqual(tie.winnerIds, ["you", "cpu"]);
  assert.equal(tie.players[0].totalPoints, 10200);

  const chase = engine.createGame({ mode:"cpu" }, sequence([6, 1]));
  chase.turn.player_id = "cpu";
  chase.turn.round_points = 400;
  chase.players[0].totalPoints = 11000;
  chase.players[1].totalPoints = 9900;
  chase.finalRound = { triggered_by:"you", pending_player_ids:["cpu"] };
  assert.equal(engine.chooseCpuDecision(chase).action, "roll");
  chase.turn.round_points = 1100;
  assert.equal(engine.chooseCpuDecision(chase).action, "bank");

  const saved = engine.createGame();
  saved.id = "root-owned-local-id";
  assert.ok(engine.validateSavedGame(saved));
  for (const bad of [null, {}, { ...saved, schemaVersion:2 }, { ...saved, turn:null }, { ...saved, stats:null }, { ...saved, players:[] }, { ...saved, finished:"false" }, { ...saved, finished:true, turn:null }, { ...saved, finalRound:{ pending_player_ids:["online-user"] } }, { ...saved, turn:{ ...saved.turn, dice:[7, 0, 0, 0, 0, 0] } }, { ...saved, players:[{ ...saved.players[0], totalPoints:10000 }] }]) assert.equal(engine.validateSavedGame(bad), false);
  assert.equal(engine.validateSavedGame({ ...tie, winnerIds:["you", "you"] }), false);
  const before = JSON.stringify(saved);
  assert.throws(() => engine.roll(saved, () => 0), /zilch_rng_invalid_result/);
  assert.equal(JSON.stringify(saved), before);
  assert.throws(() => engine.cpuStep(saved), /zilch_not_cpu_turn/);
  assert.throws(() => engine.createGame({ mode:"online" }), /zilch_invalid_play_mode/);
  return true;
}
let result;
if (request.operation === "scoring") result = request.cases.map(value => engine.scoringOptions(value.dice, value).map(signature));
else if (request.operation === "trace") result = request.cases.map(trace);
else if (request.operation === "checks") result = checks();
else throw new Error("Unknown fixture request");
process.stdout.write(JSON.stringify(result));
