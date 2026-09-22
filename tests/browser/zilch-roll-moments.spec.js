const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

function table({ actor = "p1", cpu = false, opening = false } = {}) {
  const players = [
    { id: "p1", name: "DiceReader", user_id: 42, connected: true, type: "human" },
    { id: "p2", name: cpu ? "Tischgeist" : "DiceFriend", user_id: cpu ? null : 43, connected: true, type: cpu ? "cpu" : "human" },
  ];
  return {
    _game_type: "zilch", _name: "Wurfmomente", _players: players, _participants: players,
    _play_mode: cpu ? "cpu" : "multiplayer", _mode: "2", _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false,
    _offline_players: [], _target_score: 10000, _chat_history: [], _gameplay_status: "playable",
    _zilch_ruleset: "zilch-house-v1", _zilch_final_round: null,
    _zilch_start_roll: {
      phase: opening ? "awaiting_rolls" : "resolved", rolls: opening ? {} : { p1: 6, p2: 3 }, version: opening ? 0 : 2,
      player_ids: ["p1", "p2"], pending_player_ids: opening ? ["p1", "p2"] : [], winner_id: opening ? null : "p1", attempt: 1,
    },
    _turn: opening ? null : { player_id: actor }, _dice: [0, 0, 0, 0, 0, 0], _rolls_used: 0,
    _zilch_boards: Object.fromEntries(players.map(player => [player.id, {
      player_id: player.id, connected: true, active: !opening && player.id === actor,
      total_points: 9000, round_points: 0, zilch_streak: 0, rounds: [],
    }])),
    _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 9000, p2: 9000 },
    _zilch_turn_state: opening ? null : {
      turn_id: 17, version: 0, phase: "ready_to_roll", roll_id: 0, rolls_used: 0,
      available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: 0, confirmation_required: false, confirmation_reasons: [],
      can_roll: true, can_select_hold: false, can_bank: false,
    },
    _zilch_quick_holds: [],
  };
}

function rolled(previous, rollId = 1) {
  return {
    ...previous, _dice: [1, 2, 3, 4, 5, 6], _rolls_used: rollId,
    _zilch_turn_state: { ...previous._zilch_turn_state, roll_id: rollId, version: rollId, phase: "awaiting_hold", can_roll: false, can_select_hold: true },
    _zilch_last_event: { type: "roll", player_id: previous._turn.player_id, turn_id: 17, roll_id: rollId },
  };
}

async function openTable(browser, baseURL, { initial = table(), spectator = false, reducedMotion = "no-preference", mobile = false, theme = "light" } = {}) {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block", reducedMotion,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile });
  const page = await context.newPage();
  const gameId = "roll-moments-fixture";
  const gameRoute = `/zilch/spiel/${gameId}${spectator ? "/zuschauen" : ""}`;
  const resultRoute = `/zilch/ergebnis/${gameId}`;
  const shell = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true, user: { id: 42, username: "DiceReader", role: "user", preferences: { preferred_language: "de" } },
    game_access: { zilch_preview: true, zilch_public: false },
  } }));
  await page.route(`**/api/games/${gameId}`, route => route.fulfill({ json: {
    exists: true, game_type: "zilch", name: "Wurfmomente", mode: "2", play_mode: initial._play_mode,
    locked: false, participants: initial._participants, player_statuses: initial._players,
  } }));
  await page.route(`**${gameRoute}`, route => route.fulfill({ contentType: "text/html", body: shell }));
  await page.route(`**${resultRoute}`, route => route.fulfill({ contentType: "text/html", body: '<main id="resultReached">Saved result</main>' }));
  await page.addInitScript(({ initialSnapshot, fixtureGameId, appearance }) => {
    localStorage.setItem("zilch_theme", appearance);
    localStorage.setItem("zdwa_language", "de");
    window.__rollMessages = [];
    window.__rollConnections = 0;
    class FixtureSocket {
      constructor(url) {
        this.readyState = 0;
        this.listeners = new Map();
        this.game = new URL(url, location.href).pathname === `/ws/${fixtureGameId}`;
        if (this.game) {
          window.__rollConnections += 1;
          window.__rollPush = payload => this.emit("message", { data: JSON.stringify(payload) });
          window.__rollClose = () => this.close();
        }
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
      emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
      send(raw) {
        if (!this.game || raw === "ping") return;
        const message = JSON.parse(raw);
        window.__rollMessages.push(message);
        if (["join_game", "rejoin_game", "spectate_game"].includes(message.action)) {
          this.emit("message", { data: JSON.stringify({ ...(message.action === "spectate_game" ? {} : { player_id: "p1" }), scoreboard: initialSnapshot }) });
        }
      }
      close() { this.readyState = 3; this.emit("close", {}); }
    }
    Object.assign(FixtureSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = FixtureSocket;
  }, { initialSnapshot: initial, fixtureGameId: gameId, appearance: theme });
  await page.clock.install({ time: new Date("2026-09-22T12:00:00Z") });
  await page.goto(gameRoute);
  await expect(page.locator(".zilch-play-layout")).toBeVisible();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
  return { context, page, gameId, gameRoute, resultRoute };
}

async function push(page, snapshot, event = snapshot._zilch_last_event) {
  await page.evaluate(payload => window.__rollPush(payload), { scoreboard: snapshot, zilch_event: event });
}

const faces = page => page.locator(".zilch-dice .zilch-die__pips").evaluateAll(groups => groups.map(group => group.querySelectorAll("circle").length));

for (const perspective of ["self", "opponent", "cpu", "spectator"]) {
  test(`${perspective}: every actual throw shakes longer, including identical dice, without replaying on chat or duplicate frames`, async ({ browser, baseURL }) => {
    const initial = table({ actor: perspective === "self" ? "p1" : "p2", cpu: perspective === "cpu" });
    const { context, page } = await openTable(browser, baseURL, { initial, spectator: perspective === "spectator", mobile: perspective === "cpu", theme: perspective === "cpu" ? "lcars" : perspective === "opponent" ? "dark" : "light" });
    try {
      await expect(page.locator(".zilch-dice")).not.toHaveClass(/is-landing/);
      if (perspective === "self") {
        await page.locator("[data-zilch-roll]").evaluate(button => button.click());
        await expect(page.locator(".zilch-dice")).toHaveClass(/is-rolling/);
      }
      const next = rolled(initial);
      await push(page, next);
      await expect(page.locator(".zilch-dice")).toHaveClass(/is-landing/);
      expect(await faces(page)).toEqual([1, 2, 3, 4, 5, 6]);
      const animation = await page.locator(".zilch-die").first().evaluate(die => ({
        name: getComputedStyle(die).animationName, duration: getComputedStyle(die).animationDuration,
        transforms: die.getAnimations()[0].effect.getKeyframes().map(frame => frame.transform),
      }));
      expect(animation.name).toBe("zilch-die-land");
      expect(animation.duration).toBe("0.6s");
      expect(animation.transforms.some(transform => transform.includes("19deg"))).toBe(true);
      await page.clock.runFor(300);
      await page.evaluate(() => window.__rollPush({ chat: { from_id: "p2", sender: "DiceFriend", text: "Weiter!", ts: "2026-09-22T12:00:00Z" } }));
      await push(page, next);
      expect(await page.locator(".zilch-die").first().evaluate(die => getComputedStyle(die).animationDelay)).toBe("-0.3s");
      await page.clock.runFor(351);
      await push(page, next);
      await expect(page.locator(".zilch-dice")).not.toHaveClass(/is-landing/);
      await push(page, rolled(next, 2));
      await expect(page.locator(".zilch-dice")).toHaveClass(/is-landing/);
      expect(await faces(page)).toEqual([1, 2, 3, 4, 5, 6]);
    } finally { await context.close(); }
  });
}

test("opening dice animate for each participant and reduced motion disables all shaking", async ({ browser, baseURL }) => {
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const initial = table({ cpu: true, opening: true });
    const { context, page } = await openTable(browser, baseURL, { initial, reducedMotion });
    try {
      const first = { ...initial, _zilch_start_roll: { ...initial._zilch_start_roll, rolls: { p1: 6 }, pending_player_ids: ["p2"], version: 1 } };
      await push(page, first, { type: "start_roll", player_id: "p1", value: 6, attempt: 1 });
      const expected = reducedMotion === "reduce" ? "none" : "zilch-die-land";
      await expect(page.locator('[data-start-roll-player="p1"] .zilch-start-roll-die')).toHaveCSS("animation-name", expected);
      await page.clock.runFor(700);
      const next = { ...table({ cpu: true }), _zilch_start_roll: { ...first._zilch_start_roll, rolls: { p1: 6, p2: 3 }, pending_player_ids: [], version: 2, phase: "resolved", winner_id: "p1" } };
      await push(page, next, { type: "start_roll_resolved", player_id: "p2", value: 3, attempt: 1 });
      await expect(page.locator('[data-start-roll-player="p1"] .zilch-start-roll-die')).toHaveCSS("animation-name", "none");
      await expect(page.locator('[data-start-roll-player="p2"] .zilch-start-roll-die')).toHaveCSS("animation-name", expected);
      await page.clock.runFor(1250);
      await push(page, rolled(next));
      await expect(page.locator(".zilch-die").first()).toHaveCSS("animation-name", expected);
    } finally { await context.close(); }
  }
});

for (const lastAction of ["bank", "zilch"]) {
  test(`${lastAction}: final dice remain readable before the existing result route, even with finalization frames and socket closure`, async ({ browser, baseURL }) => {
    const initial = rolled(table());
    const { context, page, gameId, gameRoute, resultRoute } = await openTable(browser, baseURL, { initial });
    try {
      const event = lastAction === "zilch"
        ? { type: "zilch", player_id: "p1", rolled_dice: [2, 3, 4, 6, 2, 3], held_dice_indices: [], penalty: 0 }
        : { type: "bank", player_id: "p1", points: 1000 };
      const terminal = { ...initial, _finished: true, _finalization_pending: true, _dice: [0, 0, 0, 0, 0, 0],
        _zilch_outcome: { winner_id: "p1", winner_ids: ["p1"], reason: "target_reached" },
        _zilch_last_event: event, _zilch_result: { game_id: gameId, result_url: resultRoute },
        _zilch_boards: { ...initial._zilch_boards, p1: { ...initial._zilch_boards.p1, rounds: [{ round: 1, event: lastAction, total_after: 10000 }], total_points: 10000 } },
      };
      await push(page, terminal);
      await expect(page.locator(".zilch-dice")).toBeVisible();
      expect(await faces(page)).toEqual(lastAction === "zilch" ? event.rolled_dice : initial._dice);
      await expect(page.locator(".zilch-result-summary")).toHaveCount(0);
      await page.clock.runFor(500);
      const persisted = { ...terminal, _finalization_pending: false };
      await push(page, persisted);
      await page.evaluate(() => window.__rollClose());
      await page.clock.runFor(lastAction === "zilch" ? 1499 : 499);
      await expect(page).toHaveURL(new RegExp(`${gameRoute}$`));
      await expect(page.locator(".zilch-dice")).toBeVisible();
      expect(await faces(page)).toEqual(lastAction === "zilch" ? event.rolled_dice : initial._dice);
      expect(await page.evaluate(() => window.__rollConnections)).toBe(1);
      await page.clock.runFor(5);
      await expect(page).toHaveURL(new RegExp(`${resultRoute}$`));
      await expect(page.locator("#resultReached")).toBeVisible();
    } finally { await context.close(); }
  });
}
