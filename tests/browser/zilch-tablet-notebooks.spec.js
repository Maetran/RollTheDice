const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const { expectFixedTable, expectReachable } = require("./table-viewport");

const tabletSizes = [
  { width: 1024, height: 600 }, { width: 1024, height: 768 },
  { width: 1180, height: 820 }, { width: 1366, height: 1024 },
  { width: 768, height: 1024 }, { width: 820, height: 1180 },
];

function snapshot(opening = true) {
  const players = [{ id: "p1", name: "Anna", user_id: 42, connected: true }, { id: "p2", name: "CPU", type: "cpu", cpu_strategy: "balanced", connected: true }];
  return {
    _game_type: "zilch", _name: "Tablet scorepads", _players: players,
    _participants: players.map(player => ({ type: "human", ...player })),
    _play_mode: "cpu", _mode: "2", _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false, _offline_players: [],
    _target_score: 10000, _zilch_ruleset: "zilch-house-v1", _chat_history: [], _gameplay_status: "playable",
    _zilch_start_roll: opening
      ? { phase: "awaiting_rolls", player_ids: ["p1", "p2"], pending_player_ids: ["p1", "p2"], rolls: {}, winner_id: null, tied: true, version: 3 }
      : { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 3 }, winner_id: "p1", version: 4 },
    _zilch_final_round: null, _turn: { player_id: "p1" },
    _dice: opening ? Array(6).fill(0) : [1, 1, 1, 5, 2, 6], _holds: Array(6).fill(false), _rolls_used: opening ? 0 : 1,
    _zilch_boards: Object.fromEntries(players.map((player, index) => [player.id, {
      player_id: player.id, active: !index, connected: true, total_points: opening ? 0 : index ? 8000 : 9000,
      round_points: !opening && !index ? 500 : 0, zilch_streak: 0,
      rounds: opening ? [] : Array.from({ length: 12 }, (_, i) => ({ round: i + 1, event: "bank", points: 500 })),
    }])),
    _round_points: { p1: opening ? 0 : 500, p2: 0 }, _total_points: { p1: opening ? 0 : 9000, p2: opening ? 0 : 8000 },
    _zilch_turn_state: {
      turn_id: 11, version: 5, phase: opening ? "ready_to_roll" : "awaiting_hold", roll_id: 8, rolls_used: opening ? 0 : 1,
      available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: opening ? 0 : 500, confirmation_required: false, confirmation_reasons: [],
      can_roll: false, can_select_hold: !opening, can_bank: false, bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: opening ? [] : [{ id: "three-ones", combination_type: "three_ones", dice_indices: [0, 1, 2], dice_values: [1, 1, 1], points: 1000, label_key: "zilch.option.three_ones", label_params: {}, roll_id: 8, requires_confirmation: true, hot_dice: false, free_roll: false, all_available_dice: false, follow_up_actions: ["zilch_roll_dice"] }],
    _zilch_last_event: opening ? null : { type: "roll" },
  };
}

async function fixture(browser, baseURL, theme, language, opening = true) {
  const context = await browser.newContext({ baseURL, viewport: tabletSizes[0], hasTouch: true, isMobile: true, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.addInitScript(({ theme, language }) => {
    localStorage.setItem("zilch_theme", theme);
    localStorage.setItem("zdwa_language", language);
  }, { theme, language });
  const page = await context.newPage();
  await page.route("**/api/**", route => route.fulfill({ json: {} }));
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: true, user: { id: 42, username: "Anna", role: "user", csrf_token: "tablet-token", preferred_language: language },
    game_access: { zilch_preview: true, zilch_public: true }, registration: {}, passkeys: { enabled: false },
  } }));
  const id = "tablet-scorepads";
  await page.route(`**/api/games/${id}*`, route => route.fulfill({ json: { exists: true, game_type: "zilch", name: "Tablet scorepads", mode: "2", play_mode: "cpu", locked: false, player_statuses: [] } }));
  await page.route(`**/zilch/spiel/${id}`, route => readFile("app/static/zilch.html").then(body => route.fulfill({ status: 200, contentType: "text/html", body })));
  const actions = [];
  let activeSocket;
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    activeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game"].includes(message.action)) {
        socket.send(JSON.stringify({ player_id: "p1", resume_token: "tablet-scorepads" }));
        socket.send(JSON.stringify({ scoreboard: snapshot(opening) }));
      }
    });
  });
  await page.goto(`/zilch/spiel/${id}`);
  await expect(page.locator(".zilch-notebook-player")).toHaveCount(2);
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await page.evaluate(() => document.fonts.ready);
  return { context, page, actions, update: state => activeSocket.send(JSON.stringify({ scoreboard: state })) };
}

async function expectInside(page, selector, parentSelector) {
  const bounds = await page.locator(selector).evaluateAll((elements, parentSelector) => elements.map(element => {
    const box = element.getBoundingClientRect();
    const parent = parentSelector ? element.closest(parentSelector).getBoundingClientRect() : { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
    return { text: element.textContent, inside: box.width > 0 && box.height > 0 && box.top >= parent.top - 1 && box.bottom <= parent.bottom + 1 && box.left >= parent.left - 1 && box.right <= parent.right + 1 };
  }), parentSelector);
  expect(bounds.length, selector).toBeGreaterThan(0);
  for (const box of bounds) expect(box.inside, `${selector}: ${box.text}`).toBe(true);
}

async function resizeTable(page, size) {
  await page.setViewportSize(size);
  // Mobile Chromium commits dynamic viewport units after setViewportSize.
  // Start the fixed-table interaction only once that rotation has painted.
  await expect.poll(() => page.locator(".zilch-shell--game").evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(size.height);
}

for (const theme of ["light", "lcars"]) for (const language of ["de", "en"]) {
  test(`tablet opening roll and independent scorepads fit ${theme} ${language}`, async ({ browser, baseURL }, testInfo) => {
    const { context, page, actions, update } = await fixture(browser, baseURL, theme, language);
    try {
      for (const size of tabletSizes) {
        await resizeTable(page, size);
        await expectFixedTable(page, [".zilch-header", ".zilch-play-layout", ".zilch-dice-dock"]);
        await expect(page.locator(".zilch-notebook-player footer")).toHaveCount(0);
        await expect(page.locator(".zilch-notebook-player header [data-zilch-total]")).toHaveCount(2);
        await expectInside(page, ".zilch-notebook-player header, .zilch-start-roll, .zilch-dice-dock, .zilch-chat");
        await expectInside(page, ".zilch-start-roll > *, [data-start-roll-player]", ".zilch-start-roll");
        await expect(page.locator("[data-start-roll-player]")).toHaveCount(2);
        await expectReachable(page, "[data-zilch-start-roll]");
        await expectReachable(page, "[data-zilch-roll]");
        await expectReachable(page, "[data-zilch-bank]");
        const pads = await page.locator(".zilch-notebook-player").evaluateAll(elements => elements.map(element => ({
          x: element.getBoundingClientRect().x, right: element.getBoundingClientRect().right,
          ring: getComputedStyle(element, "::before").backgroundImage,
        })));
        expect(pads[1].x - pads[0].right).toBeGreaterThanOrEqual(8);
        if (theme === "light") for (const pad of pads) expect(pad.ring).toContain("radial-gradient");
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${language}-${size.width}x${size.height}-opening.png`), animations: "disabled" });
      }
      await page.locator("[data-zilch-start-roll]").click();
      await expect.poll(() => actions.some(message => message.action === "zilch_start_roll")).toBe(true);
      // The CPU waiting label is longer than the player's roll action, and
      // a real result die takes more room than the initial waiting text.
      const cpuPending = snapshot();
      cpuPending._zilch_start_roll.rolls = { p1: 4 };
      cpuPending._zilch_start_roll.pending_player_ids = ["p2"];
      cpuPending._zilch_start_roll.version += 1;
      update(cpuPending);
      await expect(page.locator('[data-start-roll-value="4"]')).toBeVisible();
      await expect(page.locator("[data-zilch-start-roll]")).toBeDisabled();
      for (const size of [tabletSizes[0], tabletSizes[4]]) {
        await resizeTable(page, size);
        await expectInside(page, ".zilch-start-roll > *, [data-start-roll-player]", ".zilch-start-roll");
        await expectReachable(page, "[data-zilch-start-roll]");
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${language}-${size.width}x${size.height}-cpu-opening.png`), animations: "disabled" });
      }
    } finally { await context.close(); }
  });

  test(`projected bank total fits tablet and phone score tile ${theme} ${language}`, async ({ browser, baseURL }, testInfo) => {
    const { context, page } = await fixture(browser, baseURL, theme, language, false);
    try {
      for (const size of [...tabletSizes, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 956, height: 440 }, { width: 844, height: 390 }, { width: 667, height: 375 }]) {
        await resizeTable(page, size);
        await expect(page.locator("[data-zilch-bank-total]")).toBeVisible();
        await expectFixedTable(page, [".zilch-play-layout", ".zilch-dice-dock"]);
        await expectInside(page, ".zilch-turn-score");
        await expectInside(page, ".zilch-turn-score > *, .zilch-turn-score__bank-total > *", ".zilch-turn-score");
        const [score, dock] = await Promise.all([page.locator(".zilch-turn-score").boundingBox(), page.locator(".zilch-dice-dock").boundingBox()]);
        expect(score.y + score.height).toBeLessThanOrEqual(dock.y + 1);
        await expectReachable(page, "[data-zilch-roll]");
        await expectReachable(page, "[data-zilch-bank]");
        await page.screenshot({ path: testInfo.outputPath(`${theme}-${language}-${size.width}x${size.height}-playing.png`), animations: "disabled" });
      }
    } finally { await context.close(); }
  });
}
