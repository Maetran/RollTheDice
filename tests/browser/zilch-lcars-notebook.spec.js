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

async function expectBothNotebooks(page, { scrollable = true, totals = [6400, 3200] } = {}) {
  const geometry = await page.evaluate(() => {
    const notebook = document.querySelector(".zilch-score-notebook").getBoundingClientRect();
    const dock = document.querySelector(".zilch-dice-dock").getBoundingClientRect();
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
        const center = document.elementFromPoint(header.left + header.width / 2, header.top + header.height / 2);
        const style = getComputedStyle(board);
        return {
          id: board.dataset.zilchBoardId, top: bounds.top, bottom: bounds.bottom,
          left: bounds.left, right: bounds.right, height: bounds.height,
          headerTop: header.top, headerBottom: header.bottom,
          totalTop: totalBounds.top, totalBottom: totalBounds.bottom,
          totalText: total.textContent, historyHeight: log.clientHeight,
          historyScrollHeight: log.scrollHeight, pointerEvents: style.pointerEvents,
          transform: style.transform, headerUncovered: board.contains(center),
          activeColor: getComputedStyle(board.querySelector("header")).borderBottomColor,
        };
      }),
    };
  });
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expect(geometry.notebook.bottom).toBeLessThanOrEqual(geometry.dockTop + 1);
  for (const board of geometry.boards) {
    expect(board.height, board.id).toBeGreaterThan(0);
    expect(board.top, board.id).toBeGreaterThanOrEqual(geometry.notebook.top - 1);
    expect(board.bottom, board.id).toBeLessThanOrEqual(geometry.notebook.bottom + 1);
    expect(board.left, board.id).toBeGreaterThanOrEqual(geometry.notebook.left - 1);
    expect(board.right, board.id).toBeLessThanOrEqual(geometry.notebook.right + 1);
    expect(board.headerUncovered, `${board.id} header is occluded`).toBe(true);
    expect(board.totalTop, board.id).toBeGreaterThanOrEqual(board.top);
    expect(board.totalBottom, board.id).toBeLessThanOrEqual(board.bottom);
    expect(board.historyHeight, `${board.id} needs a readable history row`).toBeGreaterThanOrEqual(20);
    if (scrollable) expect(board.historyScrollHeight).toBeGreaterThan(board.historyHeight);
    expect(board.pointerEvents).toBe("auto");
    expect(board.transform).toBe("none");
  }
  expect(geometry.boards[0].activeColor).not.toBe(geometry.boards[1].activeColor);
  const [first, second] = geometry.boards;
  expect(first.bottom <= second.top + 1 || first.right <= second.left + 1).toBe(true);
  for (const [index, playerId] of ["p1", "p2"].entries()) {
    const total = page.locator(`[data-zilch-board-id="${playerId}"] .zilch-notebook-total`);
    expect((await total.textContent()).replace(/\D/g, "")).toBe(String(totals[index]));
  }
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
        await expectBothNotebooks(page, { scrollable: false, totals: [400, 800] });
        for (const playerId of ["p1", "p2"]) {
          const written = page.locator(`[data-zilch-round-log="${playerId}"] > li:not(.zilch-notebook-entry--blank)`).last();
          const writtenScore = await written.evaluate(entry => {
            const log = entry.parentElement.getBoundingClientRect();
            const text = [...entry.querySelectorAll(".zilch-notebook-entry__change, strong")].map(element => {
              const bounds = element.getBoundingClientRect();
              return { top: bounds.top, bottom: bounds.bottom };
            });
            return { log: { top: log.top, bottom: log.bottom }, text };
          });
          for (const text of writtenScore.text) {
            expect(text.top, `${playerId}'s latest points at ${viewport.width}×${viewport.height}`).toBeGreaterThanOrEqual(writtenScore.log.top - 1);
            expect(text.bottom, `${playerId}'s latest points at ${viewport.width}×${viewport.height}`).toBeLessThanOrEqual(writtenScore.log.bottom + 1);
          }
          await expect(page.locator(`[data-zilch-round-log="${playerId}"] > .zilch-notebook-entry--blank:visible`)).toHaveCount(0);
        }
      }
    }
  } finally {
    await context.close();
  }
});

for (const cpu of [false, true]) {
  test(`LCARS ${cpu ? "CPU" : "multiplayer"} keeps both score histories and totals visible on every turn`, async ({ browser, baseURL }, testInfo) => {
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
              await expectBothNotebooks(page);
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
        const screenshot = testInfo.outputPath(`both-notebooks-${viewport.width}x${viewport.height}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`both-notebooks-${viewport.width}x${viewport.height}`, { path: screenshot, contentType: "image/png" });
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot("p2", cpu));
      const humanLog = page.locator('[data-zilch-round-log="p1"]');
      const opponentLog = page.locator('[data-zilch-round-log="p2"]');
      await humanLog.evaluate(log => { log.scrollTop = 0; });
      await opponentLog.evaluate(log => { log.scrollTop = log.scrollHeight; });
      await page.evaluate(next => window.__pushNotebookSnapshot(next), snapshot("p2", cpu));
      await expect.poll(() => humanLog.evaluate(log => log.scrollTop)).toBe(0);
      expect(await opponentLog.evaluate(log => log.scrollHeight - log.scrollTop - log.clientHeight)).toBeLessThan(2);
      await humanLog.hover();
      await page.mouse.wheel(0, 100);
      await expect.poll(() => humanLog.evaluate(log => log.scrollTop)).toBeGreaterThan(0);
      const screenshot = testInfo.outputPath("both-notebooks-mobile-pwa.png");
      await page.screenshot({ path: screenshot });
      await testInfo.attach("both-notebooks-mobile-pwa", { path: screenshot, contentType: "image/png" });
    } finally {
      await context.close();
    }
  });
}
