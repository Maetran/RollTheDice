const { test, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const { expectReachable } = require("./table-viewport");

// Keep these tests portable to a shallow CI checkout. The release-specific
// before/after comparison is a separate audit against the frozen phone build.
const tabletQuery = "(any-pointer: coarse) and (min-width: 768px) and (min-height: 600px) and (max-width: 1600px)";
const devices = [
  { name: "iphone-max", width: 440, height: 956, touch: true },
  { name: "phone", width: 390, height: 844, touch: true },
  { name: "small-phone", width: 320, height: 568, touch: true },
  { name: "phone-landscape", width: 956, height: 440, touch: true },
  { name: "mouse-desktop", width: 1366, height: 1024, touch: false },
];

function zdwaSnapshot() {
  return {
    _game_type: "zdwa", _name: "Tablet boundary", _mode: "3", _hardcore: false,
    _players: [{ id: "p1", name: "Anna" }, { id: "p2", name: "Ben" }, { id: "p3", name: "Clara" }],
    _players_joined: 3, _expected: 3, _started: true, _finished: false,
    _aborted: false, _paused: false, _manual_pause: false, _offline_players: [],
    _connected: { p1: true, p2: true, p3: true }, _turn: { player_id: "p1", roll_index: 1 },
    _dice: [1, 1, 3, 4, 5], _holds: [true, true, false, false, false],
    _rolls_used: 1, _rolls_max: 3,
    _scoreboards: { p1: { "0,down": 3, "1,down": 6 }, p2: { "0,down": 4 }, p3: { "0,down": 2 } },
    _admin_edits: {}, _superadmin_active: false, _announced_row4: null,
    _announced_by: null, _announced_board: null, _correction: { active: false },
    _teams: [], _scoreboards_by_team: {}, _results: null, _last_write_public: {},
    _has_last: { p1: false, p2: false, p3: false }, _auto_single: false, _chat_history: [], suggestions: [],
  };
}

function zilchSnapshot() {
  const players = [{ id: "p1", name: "Anna", connected: true }, { id: "p2", name: "Ben", connected: true }];
  const board = (id, points, active) => ({
    player_id: id, connected: true, active, total_points: points,
    round_points: active ? 500 : 0, zilch_streak: 0,
    rounds: Array.from({ length: 12 }, (_, index) => ({ round: index + 1, event: "bank", points: 400 + index * 50 })),
  });
  return {
    _game_type: "zilch", _name: "Tablet boundary", _players: players,
    _participants: players.map(player => ({ ...player, type: "human" })),
    _play_mode: "multiplayer", _mode: "2", _players_joined: 2, _expected: 2,
    _started: true, _finished: false, _aborted: false, _paused: false,
    _offline_players: [], _target_score: 10000, _zilch_ruleset: "zilch-house-v1",
    _zilch_start_roll: { phase: "resolved", player_ids: ["p1", "p2"], pending_player_ids: [], rolls: { p1: 6, p2: 3 }, winner_id: "p1", version: 2 },
    _zilch_final_round: null, _chat_history: [], _gameplay_status: "playable",
    _turn: { player_id: "p1" }, _dice: [1, 1, 1, 5, 2, 6],
    _holds: [false, false, false, false, false, false], _rolls_used: 1,
    _zilch_boards: { p1: board("p1", 4200, true), p2: board("p2", 3600, false) },
    _round_points: { p1: 500, p2: 0 }, _total_points: { p1: 4200, p2: 3600 },
    _zilch_turn_state: {
      turn_id: 11, version: 5, phase: "awaiting_hold", roll_id: 8, rolls_used: 1,
      available_dice_indices: [0, 1, 2, 3, 4, 5], held_dice_indices: [], committed_holds: [],
      round_points: 500, confirmation_required: false, confirmation_reasons: [],
      can_roll: false, can_select_hold: true, can_bank: false, bank_block_reason: "zilch_hold_required",
    },
    _zilch_quick_holds: [
      { id: "three-ones", combination_type: "three_ones", dice_indices: [0, 1, 2], dice_values: [1, 1, 1], points: 1000, label_key: "zilch.option.three_ones", label_params: {}, roll_id: 8, requires_confirmation: true, hot_dice: false, free_roll: false, all_available_dice: false, follow_up_actions: ["zilch_roll_dice"] },
      { id: "single-five", combination_type: "single_five", dice_indices: [3], dice_values: [5], points: 50, label_key: "zilch.option.single_five", label_params: { count: 1 }, roll_id: 8, requires_confirmation: false, hot_dice: false, free_roll: false, all_available_dice: false, follow_up_actions: ["zilch_roll_dice"] },
    ],
    _zilch_last_event: { type: "roll" },
  };
}

async function gameFixture(browser, baseURL, { game, theme, device, disableTabletStyles = false }) {
  const context = await browser.newContext({
    baseURL, viewport: { width: device.width, height: device.height },
    hasTouch: device.touch, isMobile: device.touch, serviceWorkers: "block", reducedMotion: "reduce",
  });
  await context.addInitScript(({ gameName, themeName }) => {
    localStorage.setItem(gameName === "zilch" ? "zilch_theme" : "wuerfler_theme", themeName);
    localStorage.setItem("zdwa_language", "de");
  }, { gameName: game, themeName: theme });
  const page = await context.newPage();
  let disabledTabletRules = 0;
  await page.route(/\/static\/[^?]+\.css(?:\?.*)?$/, async route => {
    const response = await route.fetch();
    // Optional fonts may permanently choose fallback on the first paint.
    // Both comparison contexts use the exact bundled font after loading;
    // source typography and layout declarations remain unchanged.
    let body = (await response.text()).replace(/font-display:\s*optional/g, "font-display:block");
    if (disableTabletStyles) {
      body = body.replace(/@media\s*([^{}]+)\{/g, (rule, condition) => {
        if (condition.includes("any-pointer") && condition.includes("768px") && condition.includes("600px")) {
          disabledTabletRules += 1;
          return "@media not all{";
        }
        return rule;
      });
    }
    await route.fulfill({ response, body });
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: {
    authenticated: false, user: null,
    game_access: { zilch_preview: true, zilch_public: true },
    registration: { turnstile_enabled: false, email_enabled: false }, passkeys: { enabled: false },
  } }));
  const gameId = `tablet-boundary-${game}`;
  await page.route(`**/api/games/${gameId}*`, route => route.fulfill({ json: {
    exists: true, game_type: game, name: "Tablet boundary", mode: game === "zilch" ? "2" : "3", locked: false, player_statuses: [],
  } }));
  const filename = game === "zilch" ? "app/static/zilch.html" : "app/static/room.html";
  const url = game === "zilch" ? `/zilch/spiel/${gameId}` : `/spiel/${gameId}?name=Anna`;
  await page.route(`**/${game === "zilch" ? "zilch/" : ""}spiel/${gameId}*`, async route => {
    await route.fulfill({ status: 200, contentType: "text/html", body: await fs.readFile(filename) });
  });
  await page.routeWebSocket(new RegExp(`/ws/${gameId}$`), socket => {
    socket.onMessage(raw => {
      if (["join_game", "rejoin_game"].includes(JSON.parse(String(raw)).action)) {
        socket.send(JSON.stringify({ player_id: "p1", resume_token: "boundary-fixture" }));
        socket.send(JSON.stringify({ scoreboard: game === "zilch" ? zilchSnapshot() : zdwaSnapshot() }));
      }
    });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.locator(game === "zilch" ? ".zilch-die" : "#diceBar .die")).toHaveCount(game === "zilch" ? 6 : 5);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  return { context, page, disabledTabletRules };
}

async function geometry(page, game) {
  return page.evaluate(({ gameName, query }) => {
    const round = value => Math.round(value * 100) / 100;
    const roots = gameName === "zilch"
      ? ".zilch-header, .zilch-play-layout, .zilch-notebook-player, .zilch-recommendations, .zilch-dice-dock, .zilch-chat"
      : ".room-header, #scoreOut, .players-grid, .player-card, .table-wrap, .topbar, .suggestions-area, .chat-panel";
    const controls = "button, input, select, .player-card td, .player-card th, .zilch-notebook-player li, .zilch-header a";
    const elements = [...new Set(document.querySelectorAll(`${roots}, ${controls}`))].filter(element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      // The closed chat retains offscreen DOM for reopening and may lazily
      // load fonts there. Only rendered on-screen geometry is a boundary.
      return style.display !== "none" && style.visibility !== "hidden"
        && box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
        && box.right > 0 && box.left < innerWidth;
    });
    return {
      tablet: matchMedia(query).matches,
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, scrollY },
      elements: elements.map(element => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          tag: element.tagName, id: element.id, text: element.innerText?.trim().replace(/\s+/g, " ") || "",
          rect: [box.x, box.y, box.width, box.height].map(round),
          style: Object.fromEntries(["display", "position", "gridTemplateColumns", "flexDirection", "gap", "padding", "fontSize", "lineHeight", "borderRadius", "backgroundColor", "color"].map(key => [key, style[key]])),
        };
      }),
    };
  }, { gameName: game, query: tabletQuery });
}

for (const [game, themes] of [["zdwa", ["light", "dark", "classic"]], ["zilch", ["light", "lcars"]]]) {
  for (const theme of themes) {
    test(`${game} ${theme}: tablet styles and affordances stay outside phones and mouse desktop`, async ({ browser, baseURL }, testInfo) => {
      test.setTimeout(120000);
      for (const device of devices) {
        const withoutTabletStyles = await gameFixture(browser, baseURL, { game, theme, device, disableTabletStyles: true });
        const current = await gameFixture(browser, baseURL, { game, theme, device });
        try {
          const before = await geometry(withoutTabletStyles.page, game);
          expect(before.tablet, device.name).toBe(false);
          await expect(current.page.locator(".tablet-column-guide:visible, .tablet-board-navigation:visible, .zilch-tablet-guide:visible, .zilch-recommendations--tablet-only:visible")).toHaveCount(0);
          expect(withoutTabletStyles.disabledTabletRules, "the tablet stylesheet was actually loaded").toBeGreaterThan(0);
          // A restored optional font can complete its grid measurement after
          // fonts.ready. Compare the settled layout, retaining exact equality.
          await expect(async () => {
            const settledBefore = await geometry(withoutTabletStyles.page, game);
            const after = await geometry(current.page, game);
            expect(after, `${game} ${theme} ${device.name}: tablet CSS cannot alter the layout`).toEqual(settledBefore);
          }).toPass({ timeout: 5000, intervals: [100, 250, 500] });
          await current.page.screenshot({ path: testInfo.outputPath(`${device.name}-current.png`), animations: "disabled" });
        } finally {
          await withoutTabletStyles.context.close();
          await current.context.close();
        }
      }
    });

    test(`${game} ${theme}: touch tablet controls activate only inside both size boundaries`, async ({ browser, baseURL }) => {
      const current = await gameFixture(browser, baseURL, { game, theme, device: { width: 1366, height: 1024, touch: true } });
      try {
        expect(await current.page.evaluate(query => matchMedia(query).matches, tabletQuery)).toBe(true);
        const helper = game === "zilch" ? ".zilch-tablet-guide" : ".tablet-board-navigation";
        await expect(current.page.locator(helper)).toBeVisible();
        const controls = game === "zilch" ? ["[data-zilch-roll]", "[data-zilch-bank]"] : ["#rollBtnInline", "#announceBtnInline"];
        for (const selector of controls) {
          await expectReachable(current.page, selector);
          const box = await current.page.locator(selector).boundingBox();
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        for (const viewport of [{ width: 1366, height: 599 }, { width: 767, height: 1024 }, { width: 1601, height: 1024 }]) {
          await current.page.setViewportSize(viewport);
          expect(await current.page.evaluate(query => matchMedia(query).matches, tabletQuery)).toBe(false);
          await expect(current.page.locator(helper)).toBeHidden();
        }
        await current.page.setViewportSize({ width: 1366, height: 1024 });
        await expect(current.page.locator(helper)).toBeVisible();
      } finally { await current.context.close(); }
    });
  }
}
