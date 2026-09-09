const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 844 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

function snapshot(activePlayerId, cpu) {
  const players = [
    { id: "p1", name: "Mani", type: "human", user_id: 2, connected: true },
    { id: "p2", name: cpu ? "CPU" : "PreviewFriend", type: cpu ? "cpu" : "human", user_id: cpu ? null : 3, connected: true, cpu_strategy: "conservative" },
  ];
  const boards = Object.fromEntries(players.map((player, index) => [player.id, {
    player_id: player.id,
    active: player.id === activePlayerId,
    connected: true,
    total_points: index ? 3200 : 6400,
    round_points: 0,
    zilch_streak: 0,
    rounds: Array.from({ length: 32 }, (_, round) => ({
      round: round + 1,
      event: "bank",
      points: index ? 100 : 200,
      total_after: (round + 1) * (index ? 100 : 200),
    })),
  }]));
  return {
    _game_type: "zilch", _name: "Punktebuch-Test", _mode: "2",
    _play_mode: cpu ? "cpu" : "multiplayer", _players: players.filter(player => player.type === "human"),
    _participants: players, _players_joined: 2, _expected: 2, _started: true,
    _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _gameplay_status: "playable",
    _turn: { player_id: activePlayerId }, _dice: [1, 2, 3, 4, 5, 6],
    _holds: [false, false, false, false, false, false], _rolls_used: 1,
    _zilch_start_roll: { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 2 }, winner_id: "p1", version: 2 },
    _zilch_final_round: { triggered_by: null, pending_player_ids: [] }, _chat_history: [],
    _zilch_boards: boards, _round_points: { p1: 0, p2: 0 }, _total_points: { p1: 6400, p2: 3200 },
    _zilch_turn_state: {
      turn_id: activePlayerId === "p1" ? 65 : 66, version: 1,
      phase: "awaiting_hold", roll_id: 1, rolls_used: 1,
      available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: 0, confirmation_required: false, confirmation_reasons: [],
      can_roll: false, can_select_hold: true, can_bank: false, bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: [{
      id: "single-one", combination_type: "single_one", dice_indices: [0], dice_values: [1], points: 100,
      label_key: "zilch.option.single_one", label_params: { count: 1 }, roll_id: 1,
      requires_confirmation: false, hot_dice: false, free_roll: false, all_available_dice: false,
    }],
    _zilch_last_event: null,
  };
}

async function installFixture(page, cpu) {
  const gameId = `lcars-notebook-${cpu ? "cpu" : "duel"}`;
  const html = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
  await page.route(`**/zilch/spiel/${gameId}`, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true,
    user: { id: 2, username: "Mani", csrf_token: "fixture-csrf", preferences: { preferred_language: "de" } },
    game_access: { zilch_preview: true, zilch_public: false },
  } }));
  await page.route(`**/api/games/${gameId}`, route => route.fulfill({ json: {
    exists: true, game_type: "zilch", name: "Punktebuch-Test", mode: "2", play_mode: cpu ? "cpu" : "multiplayer",
    locked: false, player_statuses: [],
  } }));
  await page.addInitScript(({ game, initial }) => {
    localStorage.setItem("zilch_theme", "lcars");
    class NotebookSocket {
      constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.listeners = new Map();
        if (new URL(url, location.href).pathname === `/ws/${game}`) {
          window.__pushNotebookSnapshot = next => this.emit("message", { data: JSON.stringify({ scoreboard: next }) });
          window.__pushNotebookFrame = payload => this.emit("message", { data: JSON.stringify(payload) });
        }
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type, listener) {
        this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
      }
      emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
      send(raw) {
        if (["join_game", "rejoin_game"].includes(JSON.parse(raw).action)) {
          setTimeout(() => this.emit("message", { data: JSON.stringify({ player_id: "p1", scoreboard: initial }) }), 0);
        }
      }
      close() { this.readyState = 3; this.emit("close", {}); }
    }
    Object.assign(NotebookSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = NotebookSocket;
  }, { game: gameId, initial: snapshot("p1", cpu) });
  await page.goto(`/zilch/spiel/${gameId}`);
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(2);
}

for (const cpu of [false, true]) {
  test(`LCARS ${cpu ? "CPU" : "multiplayer"} visibly slides both ways without restarting on repeated frames or chat`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
    const page = await context.newPage();
    try {
      await installFixture(page, cpu);
      await enableStandaloneStyles(page);
      for (const active of ["p2", "p1"]) {
        const motion = await page.evaluate(async next => {
          const read = () => [...document.querySelectorAll("[data-zilch-board-id]")].map(board => {
            const bounds = board.getBoundingClientRect();
            const animation = board.getAnimations().find(item => item.playState === "running");
            return {
              id: board.dataset.zilchBoardId, top: bounds.top,
              historyVisibility: getComputedStyle(board.querySelector("ol")).visibility,
              animation: animation ? {
                name: animation.animationName,
                progress: animation.effect.getComputedTiming().progress,
                duration: animation.effect.getTiming().duration,
              } : null,
            };
          });
          const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
          window.__pushNotebookSnapshot(next);
          await frame();
          const start = read();
          await new Promise(resolve => setTimeout(resolve, 110));
          const beforeRefresh = read();
          // Real same-turn socket frames recreate the notebook. They must
          // continue the existing slide instead of replaying its first frame.
          window.__pushNotebookSnapshot(next);
          await frame();
          const afterRefresh = read();
          window.__pushNotebookFrame({ chat: {
            from_id: "p2", sender: "PreviewFriend", text: "Weiter geht's!",
            ts: "2026-09-09T08:00:00+00:00", kind: "chat",
          } });
          await frame();
          const afterChat = read();
          await new Promise(resolve => setTimeout(resolve, 100));
          const later = read();
          const running = [...document.querySelectorAll("[data-zilch-board-id]")]
            .flatMap(board => board.getAnimations({ subtree: true })).filter(animation => (
              animation.playState === "running" && /^zilch-lcars-sheet-/.test(animation.animationName)
            ));
          await Promise.all(running.map(animation => animation.finished.catch(() => {})));
          await frame();
          const end = read();
          // The transition has genuinely elapsed; do not advance CSS time
          // independently of the application's performance.now() timestamp.
          window.__pushNotebookSnapshot(next);
          await frame();
          const settledRefresh = read();
          return { start, beforeRefresh, afterRefresh, afterChat, later, end, settledRefresh };
        }, snapshot(active, cpu));
        const incoming = phase => motion[phase].find(board => board.id === active);
        const outgoing = phase => motion[phase].find(board => board.id !== active);
        for (const board of motion.start) {
          expect(board.animation, `${board.id} needs a running slide`).not.toBeNull();
          expect(board.animation.duration).toBeGreaterThanOrEqual(300);
          expect(board.animation.duration).toBeLessThanOrEqual(800);
        }
        expect(incoming("start").animation.name).toBe("zilch-lcars-sheet-open");
        expect(outgoing("start").animation.name).toBe("zilch-lcars-sheet-close");
        expect(incoming("beforeRefresh").top).toBeLessThan(incoming("start").top - 2);
        expect(outgoing("beforeRefresh").top).toBeGreaterThan(outgoing("start").top + 2);
        for (const playerId of ["p1", "p2"]) {
          const before = motion.beforeRefresh.find(board => board.id === playerId).animation.progress;
          for (const phase of ["afterRefresh", "afterChat"]) {
            const current = motion[phase].find(board => board.id === playerId).animation;
            expect(current, `${playerId} slide survives ${phase}`).not.toBeNull();
            expect(current.progress, `${playerId} slide must not restart`).toBeGreaterThanOrEqual(before - 0.05);
          }
        }
        expect(incoming("later").top).toBeLessThan(incoming("afterRefresh").top - 2);
        expect(outgoing("later").top).toBeGreaterThan(outgoing("afterRefresh").top + 2);
        for (const phase of ["start", "beforeRefresh", "afterRefresh", "afterChat", "later"]) {
          expect(outgoing(phase).historyVisibility, `the leaving sheet keeps its score ink during ${phase}`).toBe("visible");
          expect(incoming(phase).historyVisibility).toBe("visible");
        }
        expect(outgoing("end").historyVisibility).toBe("hidden");
        for (const board of motion.settledRefresh) expect(board.animation).toBeNull();
        await expectSlidingNotebook(page, active);
        await testInfo.attach(`slide-${active}.json`, { body: JSON.stringify(motion, null, 2), contentType: "application/json" });
      }
      await page.reload();
      await expect(page.locator('[data-zilch-board-id="p1"]')).toHaveClass(/is-active/);
      const replaying = await page.locator("[data-zilch-board-id]").evaluateAll(boards => boards
        .flatMap(board => board.getAnimations({ subtree: true })).filter(animation => animation.playState === "running").length);
      expect(replaying, "reloading an already running game must not replay an old switch").toBe(0);
      await expectSlidingNotebook(page, "p1");
    } finally {
      await context.close();
    }
  });
}

test("LCARS reduced motion switches directly to the same maximized sheet and compact opponent rail", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page, true);
    await enableStandaloneStyles(page);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      for (const active of ["p2", "p1"]) {
        await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot(active, true));
        await expectSlidingNotebook(page, active);
        const animations = await page.locator("[data-zilch-board-id]").evaluateAll(boards => boards
          .flatMap(board => board.getAnimations({ subtree: true })).filter(animation => animation.playState === "running").length);
        expect(animations).toBe(0);
        await expectLatestWrittenScore(page, active);
      }
    }
  } finally {
    await context.close();
  }
});

async function enableStandaloneStyles(page) {
  const changed = await page.evaluate(() => {
    let count = 0;
    const visit = rules => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) {
          rule.media.mediaText = "all";
          count += 1;
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    return count;
  });
  expect(changed).toBeGreaterThan(0);
}

async function settleNotebook(page) {
  await page.evaluate(async () => {
    const animations = [...document.querySelectorAll("[data-zilch-board-id]")]
      .flatMap(board => board.getAnimations({ subtree: true })).filter(animation => (
        animation.playState === "running" && /^zilch-lcars-sheet-/.test(animation.animationName)
      ));
    await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
    // Let both the compositor transform and the child visibility animation
    // commit their final paint before measuring the compact rail in WebKit.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

async function expectSlidingNotebook(page, activePlayerId, { scrollable = true, totals = [6400, 3200], activeCue = true } = {}) {
  const geometry = await page.evaluate(() => {
    const notebook = document.querySelector(".zilch-score-notebook").getBoundingClientRect();
    const dock = document.querySelector(".zilch-dice-dock").getBoundingClientRect();
    const visibleHeight = element => {
      const style = getComputedStyle(element);
      if (style.visibility === "hidden" || style.display === "none") return 0;
      const bounds = element.getBoundingClientRect();
      return Math.max(0, Math.min(bounds.bottom, notebook.bottom) - Math.max(bounds.top, notebook.top));
    };
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
      notebook: { top: notebook.top, bottom: notebook.bottom, left: notebook.left, right: notebook.right },
      dockTop: dock.top,
      boards: [...document.querySelectorAll("[data-zilch-board-id]")].map(board => {
        const bounds = board.getBoundingClientRect();
        const header = board.querySelector("header").getBoundingClientRect();
        const total = board.querySelector(".zilch-notebook-total");
        const totalBounds = total.getBoundingClientRect();
        const log = board.querySelector("ol");
        const style = getComputedStyle(board);
        return {
          id: board.dataset.zilchBoardId, top: bounds.top, bottom: bounds.bottom,
          left: bounds.left, right: bounds.right, height: bounds.height,
          visibleHeight: visibleHeight(board),
          headerTop: header.top, headerBottom: header.bottom,
          totalTop: totalBounds.top, totalBottom: totalBounds.bottom,
          totalLeft: totalBounds.left, totalRight: totalBounds.right,
          totalText: total.textContent, historyHeight: visibleHeight(log),
          footerHeight: visibleHeight(board.querySelector("footer")),
          historyScrollHeight: log.scrollHeight, pointerEvents: style.pointerEvents,
          historyAnimations: log.getAnimations().map(animation => ({
            name: animation.animationName, state: animation.playState,
            progress: animation.effect.getComputedTiming().progress,
            currentTime: animation.currentTime, delay: animation.effect.getTiming().delay,
          })),
          transform: style.transform,
          activeColor: getComputedStyle(board.querySelector("header")).borderBottomColor,
        };
      }),
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.notebook.bottom).toBeLessThanOrEqual(geometry.dockTop + 1);
  const active = geometry.boards.find(board => board.id === activePlayerId);
  const inactive = geometry.boards.find(board => board.id !== activePlayerId);
  for (const board of geometry.boards) {
    expect(board.visibleHeight, board.id).toBeGreaterThan(0);
    expect(board.top, board.id).toBeGreaterThanOrEqual(geometry.notebook.top - 1);
    expect(board.left, board.id).toBeGreaterThanOrEqual(geometry.notebook.left - 1);
    expect(board.right, board.id).toBeLessThanOrEqual(geometry.notebook.right + 1);
    expect(board.headerTop, board.id).toBeGreaterThanOrEqual(geometry.notebook.top - 1);
    expect(board.headerBottom, `${board.id} name must remain visible`).toBeLessThanOrEqual(geometry.notebook.bottom + 1);
    expect(board.totalTop, board.id).toBeGreaterThanOrEqual(board.top);
    expect(board.totalBottom, `${board.id} total must remain visible`).toBeLessThanOrEqual(geometry.notebook.bottom + 1);
    expect(board.totalLeft, board.id).toBeGreaterThanOrEqual(geometry.notebook.left);
    expect(board.totalRight, board.id).toBeLessThanOrEqual(geometry.notebook.right + 1);
  }
  expect(active.visibleHeight).toBeGreaterThan(inactive.visibleHeight + 12);
  expect(active.bottom).toBeLessThanOrEqual(inactive.headerTop + 1);
  expect(active.headerTop).toBeLessThan(inactive.headerTop);
  expect(active.historyHeight, "the maximized player needs a readable history row").toBeGreaterThanOrEqual(16);
  if (scrollable) expect(active.historyScrollHeight).toBeGreaterThan(active.historyHeight);
  expect(active.pointerEvents).toBe("auto");
  expect(inactive.visibleHeight, "the other player is only a compact bottom rail").toBeLessThanOrEqual(64);
  expect(inactive.historyHeight, JSON.stringify(inactive.historyAnimations)).toBe(0);
  expect(inactive.footerHeight).toBe(0);
  if (activeCue) expect(active.activeColor).not.toBe(inactive.activeColor);
  for (const [index, playerId] of ["p1", "p2"].entries()) {
    const total = page.locator(`[data-zilch-board-id="${playerId}"] .zilch-notebook-total`);
    expect((await total.textContent()).replace(/\D/g, "")).toBe(String(totals[index]));
  }
}

test("LCARS awaiting the opening rolls keeps the first sheet above a readable second-player rail", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page, false);
    await enableStandaloneStyles(page);
    const waiting = snapshot("p1", false);
    waiting._turn = null;
    waiting._dice = [0, 0, 0, 0, 0, 0];
    waiting._rolls_used = 0;
    waiting._zilch_turn_state = null;
    waiting._zilch_quick_holds = [];
    waiting._zilch_start_roll = {
      phase: "awaiting_rolls", player_ids: ["p1", "p2"], pending_player_ids: ["p1", "p2"],
      rolls: {}, winner_id: null, version: 0,
    };
    for (const playerId of ["p1", "p2"]) {
      waiting._zilch_boards[playerId] = {
        ...waiting._zilch_boards[playerId], active: false, rounds: [], total_points: 0,
      };
      waiting._total_points[playerId] = 0;
    }
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.evaluate(next => window.__pushNotebookSnapshot(next), waiting);
      await expect(page.locator("[data-zilch-start-roll]")).toBeVisible();
      await expect(page.locator(".zilch-notebook-player.is-active")).toHaveCount(0);
      await expectSlidingNotebook(page, "p1", { scrollable: false, totals: [0, 0], activeCue: false });
    }
  } finally {
    await context.close();
  }
});

async function expectLatestWrittenScore(page, playerId) {
  const written = page.locator(`[data-zilch-round-log="${playerId}"] > li:not(.zilch-notebook-entry--blank)`).last();
  const writtenScore = await written.evaluate(entry => {
    const log = entry.parentElement.getBoundingClientRect();
    const text = [...entry.querySelectorAll(".zilch-notebook-entry__change, strong")].map(element => {
      const bounds = element.getBoundingClientRect();
      return { top: bounds.top, bottom: bounds.bottom };
    });
    return { log: { top: log.top, bottom: log.bottom }, text };
  });
  expect(writtenScore.text.length).toBeGreaterThan(0);
  for (const text of writtenScore.text) {
    expect(text.top, `${playerId}'s latest points`).toBeGreaterThanOrEqual(writtenScore.log.top - 1);
    expect(text.bottom, `${playerId}'s latest points`).toBeLessThanOrEqual(writtenScore.log.bottom + 1);
  }
  await expect(page.locator(`[data-zilch-round-log="${playerId}"] > .zilch-notebook-entry--blank:visible`)).toHaveCount(0);
}

test("LCARS follows each player's latest written score instead of the other player's blank paper rows", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  try {
    await installFixture(page, true);
    await enableStandaloneStyles(page);
    let version = 1;
    for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 844 }, { width: 667, height: 375 }]) {
      await page.setViewportSize(viewport);
      for (const active of ["p1", "p2"]) {
        const next = snapshot(active, true);
        for (const [index, playerId] of ["p1", "p2"].entries()) {
          const board = next._zilch_boards[playerId];
          board.rounds = board.rounds.slice(0, index ? 8 : 2);
          board.total_points = board.rounds.at(-1).total_after;
          next._total_points[playerId] = board.total_points;
        }
        next._zilch_turn_state.version = ++version;
        next._zilch_turn_state.roll_id = version;
        next._zilch_last_event = { type: "roll" };
        await page.locator("[data-zilch-round-log]").evaluateAll(logs => {
          for (const log of logs) log.scrollTop = 0;
        });
        await page.evaluate(value => window.__pushNotebookSnapshot(value), next);
        await expect(page.locator(`[data-zilch-board-id="${active}"]`)).toHaveClass(/is-active/);
        await settleNotebook(page);
        await expectSlidingNotebook(page, active, { scrollable: false, totals: [400, 800] });
        await expectLatestWrittenScore(page, active);
      }
    }
  } finally {
    await context.close();
  }
});

for (const cpu of [false, true]) {
  test(`LCARS ${cpu ? "CPU" : "multiplayer"} maximizes the active history above the opponent's compact total rail`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    const page = await context.newPage();
    try {
      await installFixture(page, cpu);
      for (const standalone of [false, true]) {
        if (standalone) await enableStandaloneStyles(page);
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          for (const active of ["p1", "p2"]) {
            await test.step(`${viewport.width}×${viewport.height}, ${standalone ? "standalone" : "browser"}, ${active} active`, async () => {
              await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot(active, cpu));
              await expect(page.locator(`[data-zilch-board-id="${active}"]`)).toHaveClass(/is-active/);
              await settleNotebook(page);
              await expectSlidingNotebook(page, active);
              await expectLatestWrittenScore(page, active);
            });
          }
        }
      }

      for (const viewport of [{ width: 1440, height: 900 }, { width: 667, height: 375 }]) {
        await page.setViewportSize(viewport);
        const next = snapshot("p2", cpu);
        next._zilch_turn_state.version = viewport.width;
        next._zilch_turn_state.roll_id = viewport.width;
        next._zilch_last_event = { type: "roll" };
        await page.evaluate(value => window.__pushNotebookSnapshot(value), next);
        await settleNotebook(page);
        const screenshot = testInfo.outputPath(`both-notebooks-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`both-notebooks-${viewport.width}x${viewport.height}`, { path: screenshot, contentType: "image/png" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot("p1", cpu));
      await settleNotebook(page);
      const humanLog = page.locator('[data-zilch-round-log="p1"]');
      await humanLog.evaluate(log => { log.scrollTop = 0; });
      await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot("p1", cpu));
      await expect.poll(() => humanLog.evaluate(log => log.scrollTop)).toBe(0);
      await humanLog.hover();
      await page.mouse.wheel(0, 100);
      await expect.poll(() => humanLog.evaluate(log => log.scrollTop)).toBeGreaterThan(0);
      const newRoll = snapshot("p1", cpu);
      newRoll._zilch_turn_state.roll_id = 99;
      newRoll._zilch_turn_state.version = 99;
      newRoll._zilch_last_event = { type: "roll" };
      await page.evaluate(next => window.__pushNotebookSnapshot(next), newRoll);
      await expectLatestWrittenScore(page, "p1");
      const screenshot = testInfo.outputPath("both-notebooks-mobile-pwa.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("both-notebooks-mobile-pwa", { path: screenshot, contentType: "image/png" });
    } finally {
      await context.close();
    }
  });
}
