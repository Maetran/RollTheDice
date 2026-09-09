const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

test.describe.configure({ mode: "parallel" });

const PLAYERS = [
  { id: "p1", name: "Mani", user_id: 42, connected: true, type: "human" },
  { id: "p2", name: "PreviewFriend", user_id: 43, connected: true, type: "human" },
];

function snapshot({ phase = "awaiting_rolls", rolls = {}, version = 0, tied = false, attempts = [] } = {}) {
  const resolved = phase === "resolved";
  return {
    _game_type: "zilch", _name: "Startwurfprobe", _players: PLAYERS, _participants: PLAYERS,
    _play_mode: "multiplayer", _mode: "2", _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false,
    _offline_players: [], _target_score: 10000, _chat_history: [], _gameplay_status: "playable",
    _zilch_ruleset: "zilch-house-v1", _zilch_final_round: null,
    _zilch_start_roll: {
      phase, rolls, version, tied, attempts, player_ids: ["p1", "p2"],
      pending_player_ids: resolved ? [] : ["p1", "p2"].filter(id => !rolls[id]),
      winner_id: resolved ? "p1" : null, attempt: tied ? attempts.length + 1 : Math.max(1, attempts.length),
    },
    _turn: resolved ? { player_id: "p1" } : null,
    _dice: [0, 0, 0, 0, 0, 0], _holds: [false, false, false, false, false, false], _rolls_used: 0,
    _zilch_boards: Object.fromEntries(PLAYERS.map(player => [player.id, {
      player_id: player.id, connected: true, active: resolved && player.id === "p1",
      total_points: 0, round_points: 0, zilch_streak: 0, rounds: [],
    }])),
    _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 0, p2: 0 },
    _zilch_turn_state: resolved ? {
      turn_id: 1, version: 0, phase: "ready_to_roll", roll_id: 0, rolls_used: 0,
      available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: 0, confirmation_required: false, confirmation_reasons: [],
      can_roll: true, can_select_hold: false, can_bank: false,
      bank_block_reason: "zilch_bank_minimum_not_reached",
    } : null,
    _zilch_quick_holds: [],
  };
}

function resolvedSnapshot() {
  const rolls = { p1: 6, p2: 3 };
  const next = snapshot({ phase: "resolved", rolls, version: 2, attempts: [{ attempt: 1, rolls }] });
  next._zilch_last_event = {
    type: "start_roll_resolved", player_id: "p2", value: 3, attempt: 1, winner_id: "p1", resolved: true,
  };
  return next;
}

async function openFixture(browser, baseURL, { playerId = "p1", theme = "lcars", initial = snapshot() } = {}) {
  const context = await browser.newContext({
    baseURL, serviceWorkers: "block", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  const page = await context.newPage();
  const gameId = `opening-roll-${playerId}-${theme}`;
  const shell = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
  const player = PLAYERS.find(candidate => candidate.id === playerId);
  // Browser-only projections exercise shipped HTML, CSS and JavaScript. No
  // fixture endpoint, server state, real account or access policy is changed.
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: player.user_id, username: player.name, role: "user", preferences: { preferred_language: "de" } },
    game_access: { zilch_preview: true, zilch_public: false },
  } }));
  await page.route(`**/api/games/${gameId}`, route => route.fulfill({ json: {
    exists: true, game_type: "zilch", name: "Startwurfprobe", mode: "2", play_mode: "multiplayer",
    locked: false, participants: PLAYERS, player_statuses: PLAYERS,
  } }));
  await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({ status: 200, contentType: "text/html", body: shell }));
  await page.addInitScript(({ appearance, localPlayerId, firstSnapshot, fixtureGameId }) => {
    localStorage.setItem("zilch_theme", appearance);
    localStorage.setItem("zdwa_language", "de");
    const snapshotKey = `start-roll-fixture:${fixtureGameId}`;
    if (!sessionStorage.getItem(snapshotKey)) sessionStorage.setItem(snapshotKey, JSON.stringify(firstSnapshot));
    window.__startRollMessages = [];
    class FixtureWebSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.listeners = new Map();
        if (new URL(url, window.location.href).pathname === `/ws/${fixtureGameId}`) {
          window.__startRollPush = payload => {
            if (payload.scoreboard) sessionStorage.setItem(snapshotKey, JSON.stringify(payload.scoreboard));
            this.emit("message", { data: JSON.stringify(payload) });
          };
        }
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type, callback) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(callback);
        this.listeners.set(type, listeners);
      }
      emit(type, event) {
        for (const listener of this.listeners.get(type) || []) listener(event);
      }
      send(raw) {
        if (raw === "ping") return;
        const message = JSON.parse(raw);
        window.__startRollMessages.push(message);
        if (["join_game", "rejoin_game"].includes(message.action)) {
          this.emit("message", { data: JSON.stringify({ player_id: localPlayerId, resume_token: "start-roll-fixture" }) });
          this.emit("message", { data: JSON.stringify({ scoreboard: JSON.parse(sessionStorage.getItem(snapshotKey)) }) });
        }
      }
      close() { this.readyState = 3; this.emit("close", {}); }
    }
    FixtureWebSocket.CONNECTING = 0;
    FixtureWebSocket.OPEN = 1;
    FixtureWebSocket.CLOSING = 2;
    FixtureWebSocket.CLOSED = 3;
    window.WebSocket = FixtureWebSocket;
  }, { appearance: theme, localPlayerId: playerId, firstSnapshot: initial, fixtureGameId: gameId });
  await page.clock.install({ time: new Date("2026-09-09T10:00:00Z") });
  await page.goto(`/zilch/spiel/${gameId}`);
  await expect(page.locator(".zilch-play-layout")).toBeVisible();
  await page.clock.pauseAt(new Date("2026-09-09T10:01:00Z"));
  return { context, page };
}

async function push(page, next, event = next._zilch_last_event) {
  await page.evaluate(payload => window.__startRollPush(payload), { scoreboard: next, zilch_event: event });
}

async function expectDie(page, playerId, value) {
  const row = page.locator(`[data-start-roll-player="${playerId}"]`);
  const die = row.locator(`.zilch-start-roll-die[data-start-roll-value="${value}"]`);
  await expect(die).toBeVisible();
  await expect(die.locator("svg.zilch-die__face")).toHaveCount(1);
  await expect(die.locator(".zilch-die__pips circle")).toHaveCount(value);
  await expect(die).toHaveAttribute("aria-label", new RegExp(String(value)));
}

async function gameplayMessages(page) {
  return page.evaluate(() => window.__startRollMessages.filter(message => [
    "zilch_start_roll", "zilch_roll_dice", "zilch_bank_points", "zilch_select_hold",
  ].includes(message.action)));
}

for (const { playerId, theme } of [
  { playerId: "p1", theme: "lcars" },
  { playerId: "p2", theme: "lcars" },
  { playerId: "p1", theme: "light" },
]) {
  test(`${theme} ${playerId} sees both opening dice before the first turn, without replaying the pause on reload`, async ({ browser, baseURL }, testInfo) => {
    const { context, page } = await openFixture(browser, baseURL, { playerId, theme });
    try {
      await expect(page.locator("[data-zilch-start-roll]")).toBeEnabled();
      const first = snapshot({ rolls: { p1: 6 }, version: 1 });
      await push(page, first, { type: "start_roll", player_id: "p1", value: 6, attempt: 1, resolved: false });
      await expectDie(page, "p1", 6);
      await expect(page.locator('[data-start-roll-player="p2"] .zilch-start-roll-die')).toHaveCount(0);
      if (playerId === "p2") {
        await expect(page.locator("[data-zilch-start-roll]")).toBeEnabled();
        await page.locator("[data-zilch-start-roll]").evaluate(button => button.click());
        expect(await gameplayMessages(page)).toEqual([
          expect.objectContaining({ action: "zilch_start_roll", start_roll_version: 1 }),
        ]);
      } else await expect(page.locator("[data-zilch-start-roll]")).toBeDisabled();

      const resolved = resolvedSnapshot();
      await push(page, resolved);
      const result = page.locator(".zilch-start-roll[data-start-roll-result]");
      await expect(result).toBeVisible();
      await expectDie(page, "p1", 6);
      await expectDie(page, "p2", 3);
      await expect(page.locator("[data-zilch-start-roll]")).toBeDisabled();
      await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
      const screenshotPath = testInfo.outputPath("opening-result.png");
      await page.screenshot({ path: screenshotPath });
      await testInfo.attach("opening-result", { path: screenshotPath, contentType: "image/png" });
      const beforeShortcut = await gameplayMessages(page);
      await page.keyboard.press("Space");
      await page.keyboard.press("b");
      expect(await gameplayMessages(page)).toEqual(beforeShortcut);

      await page.clock.runFor(600);
      // Repeated snapshots and chat are common during reconnects. They must
      // neither dismiss the readable result nor keep restarting its timer.
      await push(page, resolved);
      await page.evaluate(() => window.__startRollPush({ chat: {
        from_id: "p2", sender: "PreviewFriend", text: "Guter Start!", ts: "2026-09-09T10:01:00Z", kind: "chat",
      } }));
      await page.clock.runFor(550);
      await expect(result).toBeVisible();
      await expectDie(page, "p2", 3);
      await page.clock.runFor(100);
      await expect(result).toHaveCount(0);
      if (playerId === "p1") await expect(page.locator("[data-zilch-roll]")).toBeEnabled();
      else await expect(page.locator("[data-zilch-roll]")).toBeDisabled();

      await page.clock.resume();
      await page.reload();
      await expect(page.locator(".zilch-play-layout")).toBeVisible();
      await expect(page.locator(".zilch-start-roll")).toHaveCount(0);
      if (playerId === "p1") await expect(page.locator("[data-zilch-roll]")).toBeEnabled();
    } finally { await context.close(); }
  });
}

test("a tied opening roll shows both matching dice before permitting the next attempt", async ({ browser, baseURL }) => {
  const initial = snapshot({ rolls: { p1: 4 }, version: 1 });
  const { context, page } = await openFixture(browser, baseURL, { playerId: "p2", initial });
  try {
    const tied = snapshot({ version: 2, tied: true, attempts: [{ attempt: 1, rolls: { p1: 4, p2: 4 } }] });
    await push(page, tied, { type: "start_roll_tie", player_id: "p2", value: 4, attempt: 1, resolved: false });
    const result = page.locator(".zilch-start-roll[data-start-roll-result]");
    await expect(result).toBeVisible();
    await expect(result).toContainText("Gleichstand");
    await expectDie(page, "p1", 4);
    await expectDie(page, "p2", 4);
    await expect(page.locator("[data-zilch-start-roll]")).toBeDisabled();
    await page.keyboard.press("Space");
    expect(await gameplayMessages(page)).toEqual([]);
    await page.clock.runFor(1150);
    await expect(result).toBeVisible();
    await page.clock.runFor(100);
    await expect(result).toHaveCount(0);
    await expect(page.locator(".zilch-start-roll-die")).toHaveCount(0);
    await expect(page.locator("[data-zilch-start-roll]")).toBeEnabled();
    await page.locator("[data-zilch-start-roll]").evaluate(button => button.click());
    expect(await gameplayMessages(page)).toEqual([
      expect.objectContaining({ action: "zilch_start_roll", start_roll_version: 2 }),
    ]);
  } finally { await context.close(); }
});

test("a newer server turn received during the opening result is retained without extending the pause", async ({ browser, baseURL }) => {
  const initial = snapshot({ rolls: { p1: 6 }, version: 1 });
  const { context, page } = await openFixture(browser, baseURL, { initial });
  try {
    await push(page, resolvedSnapshot());
    await page.clock.runFor(600);
    const newer = resolvedSnapshot();
    newer._dice = [1, 2, 3, 4, 5, 6];
    newer._rolls_used = 1;
    newer._zilch_turn_state = {
      ...newer._zilch_turn_state, phase: "awaiting_hold", version: 1, roll_id: 1, rolls_used: 1,
      can_roll: false, can_select_hold: true,
    };
    newer._zilch_last_event = { type: "roll", player_id: "p1" };
    await push(page, newer);
    await expectDie(page, "p1", 6);
    await expectDie(page, "p2", 3);
    await page.clock.runFor(650);
    await expect(page.locator(".zilch-start-roll")).toHaveCount(0);
    const dice = page.locator(".zilch-dice .zilch-die");
    await expect(dice).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      await expect(dice.nth(index).locator(".zilch-die__pips circle")).toHaveCount(index + 1);
    }
    await expect(dice.first()).toBeEnabled();
  } finally { await context.close(); }
});

test("reconnecting from a stale opening snapshot directly to a later turn does not replay the opening pause", async ({ browser, baseURL }) => {
  const initial = snapshot({ rolls: { p1: 6 }, version: 1 });
  const { context, page } = await openFixture(browser, baseURL, { initial });
  try {
    await expect(page.locator(".zilch-start-roll")).toBeVisible();
    const current = resolvedSnapshot();
    current._dice = [1, 2, 3, 4, 5, 6];
    current._rolls_used = 2;
    current._zilch_turn_state = {
      ...current._zilch_turn_state, phase: "awaiting_hold", version: 3, roll_id: 2, rolls_used: 2,
      can_roll: false, can_select_hold: true,
    };
    current._zilch_quick_holds = [{
      id: "reconnect-single-one", combination_type: "single_one", dice_indices: [0], dice_values: [1],
      points: 100, label_key: "zilch.option.single_one", label_params: { count: 1 }, roll_id: 2,
      requires_confirmation: false, hot_dice: false, free_roll: false, all_available_dice: false,
      follow_up_actions: ["zilch_roll_dice"],
    }];
    current._zilch_last_event = { type: "roll", player_id: "p1" };
    // A reconnect supplies the latest snapshot, not every missed event. Its
    // old resolved start-roll data must not hide the already active turn.
    await page.evaluate(scoreboard => window.__startRollPush({ scoreboard }), current);
    await expect(page.locator(".zilch-start-roll")).toHaveCount(0);
    const dice = page.locator(".zilch-dice .zilch-die");
    await expect(dice).toHaveCount(6);
    for (let index = 0; index < 6; index += 1) {
      await expect(dice.nth(index).locator(".zilch-die__pips circle")).toHaveCount(index + 1);
    }
    // Time is still frozen: these controls must work immediately, without
    // first consuming a misleading 1200 ms opening-result timer.
    await expect(dice.first()).toBeEnabled();
    await dice.first().evaluate(button => button.click());
    await expect(dice.first()).toHaveAttribute("aria-pressed", "true");
  } finally { await context.close(); }
});
