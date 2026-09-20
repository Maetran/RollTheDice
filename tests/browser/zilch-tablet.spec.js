const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { expectFixedTable, expectReachable } = require("./table-viewport");

function tabletSnapshot({ mode = "multiplayer", active = "p1", choices = true, longHistory = true } = {}) {
  const players = [
    { id: "p1", name: "Mani", type: "human", user_id: 2, connected: true },
    ...(mode === "solo" ? [] : [{ id: "p2", name: mode === "cpu" ? "Würfelwirt" : "PreviewFriend", type: mode === "cpu" ? "cpu" : "human", user_id: 3, connected: true }]),
  ];
  return {
    _game_type: "zilch", _name: "Tablet-Tisch", _mode: mode === "solo" ? "1" : "2", _play_mode: mode,
    _players: players.filter(player => player.type === "human"), _participants: players,
    _players_joined: players.length, _expected: players.length, _started: true,
    _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _gameplay_status: "playable",
    _turn: { player_id: active }, _dice: choices ? [1, 1, 1, 5, 5, 5] : [0, 0, 0, 0, 0, 0],
    _holds: [false, false, false, false, false, false], _rolls_used: choices ? 1 : 0,
    _zilch_start_roll: { phase: "resolved", player_ids: players.map(player => player.id), pending_player_ids: [], rolls: { p1: 6, p2: 2 }, winner_id: "p1", version: 2 },
    _zilch_final_round: { triggered_by: null, pending_player_ids: [] }, _chat_history: [],
    _zilch_boards: Object.fromEntries(players.map((player, index) => [player.id, {
      player_id: player.id, active: player.id === active, connected: true,
      total_points: index ? 3200 : 6400, round_points: player.id === active ? 400 : 0, zilch_streak: 0,
      rounds: longHistory ? Array.from({ length: 32 }, (_, round) => ({
        round: round + 1, event: "bank", points: index ? 100 : 200, total_after: (round + 1) * (index ? 100 : 200),
      })) : [],
    }])),
    _round_points: { p1: 400, p2: 0 }, _total_points: { p1: 6400, p2: 3200 },
    _zilch_turn_state: {
      turn_id: active === "p1" ? 65 : 66, version: 1, phase: choices ? "awaiting_hold" : "ready_to_roll",
      roll_id: 1, rolls_used: choices ? 1 : 0, available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: 400, confirmation_required: false, confirmation_reasons: [],
      can_roll: !choices, can_select_hold: choices, can_bank: !choices, bank_block_reason: choices ? "zilch_hold_required" : "",
    },
    _zilch_quick_holds: choices ? [
      ["three-ones", "three_ones", [0, 1, 2], [1, 1, 1], 1000],
      ["three-fives", "three_of_a_kind", [3, 4, 5], [5, 5, 5], 500],
      ["two-ones", "single_one", [0, 1], [1, 1], 200],
      ["two-fives", "single_five", [3, 4], [5, 5], 100],
      ["one", "single_one", [0], [1], 100],
      ["five", "single_five", [3], [5], 50],
    ].map(([id, type, indices, values, points]) => ({
      id, combination_type: type, dice_indices: indices, dice_values: values, points,
      label_key: `zilch.option.${type}`, label_params: { count: values.length, face: values[0] }, roll_id: 1,
      requires_confirmation: false, hot_dice: false, free_roll: false, all_available_dice: false,
      follow_up_actions: ["zilch_roll_dice", "zilch_bank_points"],
    })).concat([{
      id: "all-scoring", combination_type: "combined", dice_indices: [0, 1, 2, 3, 4, 5], dice_values: [1, 1, 1, 5, 5, 5], points: 1500,
      label_key: "zilch.option.combined", label_params: { component_count: 2 }, roll_id: 1,
      components: [{ combination_type: "three_ones" }, { combination_type: "three_of_a_kind" }],
      requires_confirmation: true, hot_dice: true, free_roll: true, all_available_dice: true,
      follow_up_actions: ["zilch_roll_dice"],
    }]) : [],
    _zilch_last_event: null,
  };
}

async function openTabletFixture(page, { theme, mode = "multiplayer", spectator = false, language = "de" }) {
  const gameId = `tablet-${theme}-${mode}`;
  const routePath = `/zilch/spiel/${gameId}${spectator ? "/zuschauen" : ""}`;
  const html = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
  await page.route(`**${routePath}`, route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true, user: { id: 2, username: "Mani", csrf_token: "fixture-csrf", preferences: { preferred_language: language } },
    game_access: { zilch_preview: true, zilch_public: true },
  } }));
  await page.route(`**/api/games/${gameId}`, route => route.fulfill({ json: {
    exists: true, game_type: "zilch", name: "Tablet-Tisch", mode: mode === "solo" ? "1" : "2", play_mode: mode, locked: false, player_statuses: [],
  } }));
  await page.addInitScript(({ game, initial, initialTheme, lang }) => {
    localStorage.setItem("zilch_theme", initialTheme);
    localStorage.setItem("zdwa_language", lang);
    window.__tabletMessages = [];
    class TabletSocket {
      constructor(url) {
        this.url = url; this.readyState = 0; this.listeners = new Map();
        if (new URL(url, location.href).pathname === `/ws/${game}`) window.__tabletPush = next => this.emit("message", { data: JSON.stringify({ scoreboard: next }) });
        setTimeout(() => { this.readyState = 1; this.emit("open", {}); }, 0);
      }
      addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
      emit(type, event) { for (const listener of this.listeners.get(type) || []) listener(event); }
      send(raw) {
        const message = JSON.parse(raw);
        window.__tabletMessages.push(message);
        if (["join_game", "rejoin_game", "spectate_game"].includes(message.action)) {
          setTimeout(() => this.emit("message", { data: JSON.stringify({ player_id: "p1", scoreboard: initial }) }), 0);
        }
      }
      close() { this.readyState = 3; this.emit("close", {}); }
    }
    Object.assign(TabletSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = TabletSocket;
  }, { game: gameId, initial: tabletSnapshot({ mode }), initialTheme: theme, lang: language });
  await page.goto(routePath);
  await expect(page.locator("[data-zilch-board-id]")).toHaveCount(mode === "solo" ? 1 : 2);
}

for (const theme of ["light", "lcars"]) {
  test(`Zilch ${theme} tablet uses both histories and reachable touch actions in both orientations`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
    const page = await context.newPage();
    try {
      await openTabletFixture(page, { theme });
      for (const viewport of [{ width: 1024, height: 1366 }, { width: 1366, height: 1024 }, { width: 820, height: 1180 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1180, height: 820 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator(".zilch-tablet-guide")).toBeVisible();
        await expectFixedTable(page, [".zilch-header", ".zilch-play-layout", ".zilch-dice-dock"]);
        for (const selector of ["[data-zilch-roll]", "[data-zilch-bank]", "[data-zilch-combined-score]", "#zilchLeaveGameBtn", "[data-zilch-chat-toggle]"]) await expectReachable(page, selector);
        const histories = await page.locator("[data-zilch-board-id]").evaluateAll(boards => boards.map(board => {
          const rect = board.getBoundingClientRect();
          const list = board.querySelector("ol");
          const point = list.getBoundingClientRect();
          const hit = document.elementFromPoint(point.x + point.width / 2, point.y + point.height / 2);
          return { x: rect.x, right: rect.right, y: rect.y, height: rect.height, visible: getComputedStyle(list).visibility, reachable: list.contains(hit) };
        }));
        expect(histories[0].right).toBeLessThanOrEqual(histories[1].x);
        for (const history of histories) { expect(history.visible).toBe("visible"); expect(history.reachable).toBe(true); expect(history.height).toBeGreaterThan(160); }
        const bank = await page.locator("[data-zilch-bank]").boundingBox();
        const roll = await page.locator("[data-zilch-roll]").boundingBox();
        const die = await page.locator(".zilch-die").first().boundingBox();
        const layout = await page.locator(".zilch-play-layout").boundingBox();
        const dock = await page.locator(".zilch-dice-dock").boundingBox();
        expect(dock.y - layout.y - layout.height, "tablet uses the available area above its touch dock").toBeLessThan(24);
        expect(bank.height).toBeGreaterThanOrEqual(60);
        expect(roll.height).toBeGreaterThanOrEqual(60);
        expect(bank.x).toBeLessThan(viewport.width * .2);
        expect(roll.x + roll.width).toBeGreaterThan(viewport.width * .8);
        expect(die.width).toBeGreaterThanOrEqual(48);
        expect(die.width).toBeLessThanOrEqual(65);
        await expect(page.locator(".zilch-recommendation__shortcut").first()).toBeHidden();
        // Every orientation shares the phone's vertical order. The strongest
        // choice starts at the lower edge above the combined scoring action;
        // a short rail scrolls its alternatives without moving the touch dock.
        await expectReachable(page, '[data-zilch-recommendation="three-ones"]');
        const choiceLayout = await page.locator("[data-zilch-recommendation]").evaluateAll(choices => choices.map(choice => {
          const rect = choice.getBoundingClientRect();
          return { id: choice.dataset.zilchRecommendation, top: rect.top, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
        }));
        expect([...choiceLayout].sort((a, b) => a.top - b.top).map(choice => choice.id)).toEqual(choiceLayout.map(choice => choice.id).reverse());
        const combined = await page.locator("[data-zilch-combined-score]").boundingBox();
        expect(combined.y - choiceLayout[0].bottom).toBeGreaterThanOrEqual(0);
        expect(combined.y - choiceLayout[0].bottom).toBeLessThanOrEqual(16);
        for (const choice of choiceLayout) {
          expect(choice.height).toBeGreaterThanOrEqual(64);
          expect(Math.abs(choice.left - choiceLayout[0].left)).toBeLessThanOrEqual(1);
          expect(Math.abs(choice.width - choiceLayout[0].width)).toBeLessThanOrEqual(1);
          const selector = `[data-zilch-recommendation="${choice.id}"]`;
          await page.locator(selector).scrollIntoViewIfNeeded();
          await expectReachable(page, selector);
          expect((await page.locator(".zilch-dice-dock").boundingBox()).y).toBeCloseTo(dock.y, 0);
        }
        await page.locator(".zilch-recommendations__rail").evaluate(rail => { rail.scrollTop = 0; });
        await expectReachable(page, '[data-zilch-recommendation="three-ones"]');
        // Internal history scrolling never moves the overall touch table.
        await page.locator('[data-zilch-board-id="p2"] ol').evaluate(list => { list.scrollTop = 0; });
        await expect.poll(() => page.locator('[data-zilch-board-id="p2"] ol').evaluate(list => list.scrollTop)).toBe(0);
        await page.screenshot({ path: testInfo.outputPath(`tablet-${viewport.width}x${viewport.height}.png`) });
      }
      await page.setViewportSize({ width: 1024, height: 1366 });
      for (const choice of await page.locator("[data-zilch-recommendation]").all()) {
        await choice.scrollIntoViewIfNeeded();
        const id = await choice.getAttribute("data-zilch-recommendation");
        await expectReachable(page, `[data-zilch-recommendation="${id}"]`);
      }
      await page.locator('[data-zilch-recommendation="one"]').tap();
      await expect(page.locator('[data-zilch-die-index="0"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("[data-zilch-bank]")).toBeEnabled();
      await page.locator("[data-zilch-bank]").tap();
      expect(await page.evaluate(() => window.__tabletMessages.some(message => message.action === "zilch_bank_points" && message.option_id === "one"))).toBe(true);
      // Exercise the actual installed-PWA CSS branches, which Playwright
      // cannot request through display-mode emulation.
      await page.evaluate(() => {
        const visit = rules => {
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule && rule.conditionText.includes("display-mode: standalone")) rule.media.mediaText = "all";
            if (rule.cssRules) visit(rule.cssRules);
          }
        };
        for (const sheet of document.styleSheets) visit(sheet.cssRules);
      });
      await expectFixedTable(page, [".zilch-play-layout", ".zilch-dice-dock"]);
      await expectReachable(page, "[data-zilch-roll]");
      // Orientation/keyboard changes retain chat drafts and leave mobile
      // compact layout available when there is no tablet-height viewport.
      await page.locator("[data-zilch-chat-toggle]").tap();
      await page.locator("#zilchChatInput").fill("Tablet-Entwurf");
      await page.setViewportSize({ width: 1024, height: 500 });
      await expectReachable(page, "#zilchChatInput");
      await expectReachable(page, "#zilchChatForm button[type=submit]");
      await expect(page.locator("#zilchChatInput")).toHaveValue("Tablet-Entwurf");
      await expect(page.locator(".zilch-tablet-guide")).toBeHidden();
    } finally { await context.close(); }
  });

  test(`Zilch ${theme} tablet preserves solo CPU spectator and turn transitions`, async ({ browser, baseURL }, testInfo) => {
    for (const mode of ["solo", "cpu", "multiplayer"]) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1366, height: 1024 }, hasTouch: true, isMobile: true, serviceWorkers: "block" });
      const page = await context.newPage();
      try {
        await openTabletFixture(page, { theme, mode, spectator: mode === "multiplayer", language: "en" });
        await expect(page.locator(".zilch-tablet-guide")).toContainText("Next step");
        await expectFixedTable(page, [".zilch-play-layout", ".zilch-dice-dock"]);
        await page.evaluate(next => window.__tabletPush(next), tabletSnapshot({ mode, active: mode === "solo" ? "p1" : "p2", choices: false }));
        await expectReachable(page, "[data-zilch-roll]");
        await expect(page.locator(".zilch-tablet-guide")).toBeVisible();
        if (mode !== "solo") {
          await expect(page.locator("[data-zilch-roll]")).toBeDisabled();
          await expect(page.locator('[data-zilch-board-id="p1"] ol')).toBeVisible();
          await expect(page.locator('[data-zilch-board-id="p2"] ol')).toBeVisible();
        }
        await page.screenshot({ path: testInfo.outputPath(`${mode}.png`) });
      } finally { await context.close(); }
    }
  });

  test(`Zilch ${theme} tablet enhancement stays off on phones and mouse-only desktop`, async ({ browser, baseURL }) => {
    for (const device of [
      { viewport: { width: 440, height: 956 }, hasTouch: true, isMobile: true },
      { viewport: { width: 956, height: 440 }, hasTouch: true, isMobile: true },
      { viewport: { width: 1366, height: 1024 }, hasTouch: false },
    ]) {
      const context = await browser.newContext({ baseURL, serviceWorkers: "block", ...device });
      const page = await context.newPage();
      try {
        await openTabletFixture(page, { theme });
        await expect(page.locator(".zilch-tablet-guide")).toBeHidden();
        expect(await page.locator('[data-zilch-board-id="p1"]').evaluate(board => getComputedStyle(board).position)).toBe("absolute");
      } finally { await context.close(); }
    }
  });
}
