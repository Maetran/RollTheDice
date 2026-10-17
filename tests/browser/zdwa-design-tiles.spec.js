const { test, expect } = require("@playwright/test");

// Design 2026 puts one tile per player (per team in 2v2) in the room header:
// avatar, name, live total and a brass mark for the turn. A tap shows that
// sheet; the roll count sits on the roll button. The header keeps a visible
// bottom rule and the active sheet's frame keeps a gap below it
// (frontend/styles/design-2026/table-top.css, room/board-navigation.js).

test.describe.configure({ mode: "parallel" });

const PHONE = { width: 390, height: 844 };

// With accounts, p1 is an admin with a rank and every player has a profile.
function tileSnapshot({ names = ["Anna", "Ben"], team = false, hardcore = false, accounts = false } = {}) {
  const players = names.map((name, index) => ({
    id: `p${index + 1}`, name,
    ...(accounts ? {
      user_id: index + 1, username: name, is_admin: index === 0,
      achievement_rank: index === 0
        ? { key: "expert", title: "Expert", stars: 3, points: 1200, points_possible: 4000 }
        : { key: "newbie", title: "Newbie", stars: 0, points: 0, points_possible: 4000 },
    } : {}),
  }));
  // Bottom rows only (no bonus): the expected totals are plain sums.
  const boards = [
    { "0,down": 3, "13,free": 52 },
    { "14,up": 66 },
    { "12,ang": 35 },
    {},
  ];
  return {
    _name: "Tile fixture", _mode: team ? "2v2" : String(players.length), _hardcore: hardcore,
    _players: players, _players_joined: players.length, _expected: players.length, _started: true,
    _finished: false, _aborted: false, _paused: false, _manual_pause: false,
    _offline_players: [], _connected: Object.fromEntries(players.map(player => [player.id, true])),
    _turn: { player_id: "p1", roll_index: 1 }, _dice: [2, 4, 2, 1, 2],
    _holds: [false, false, false, false, false], _rolls_used: hardcore ? 0 : 1, _rolls_max: hardcore ? 1 : 3,
    _scoreboards: Object.fromEntries(players.map((player, index) => [player.id, { ...boards[index] }])),
    _admin_edits: {}, _superadmin_active: false, _announced_row4: null,
    _announced_by: null, _announced_board: null, _correction: { active: false },
    _teams: team ? [{ id: "A", name: "Team A", members: ["p1", "p3"] }, { id: "B", name: "Team B", members: ["p2", "p4"] }] : [],
    _scoreboards_by_team: team ? { A: { "0,down": 3, "13,free": 52 }, B: { "14,up": 66 } } : {},
    _results: null, _last_write_public: {}, _has_last: {}, _auto_single: false,
    _chat_history: [], suggestions: [],
  };
}

async function openRoom(browser, baseURL, { viewport = PHONE, mobile = true, theme = "light", design = "2026", language = "de", state, spectator = false }) {
  const context = await browser.newContext({ baseURL, viewport, isMobile: mobile, hasTouch: mobile, serviceWorkers: "block" });
  await context.addInitScript(([themeValue, designValue, languageValue]) => {
    localStorage.setItem("wuerfler_theme", themeValue);
    localStorage.setItem("zdwa_language", languageValue);
    localStorage.removeItem("zdwa_design_override");
    if (designValue === "old") localStorage.setItem("zdwa_design", "old");
  }, [theme, design, language]);
  const page = await context.newPage();
  let socket;
  await page.routeWebSocket(/\/ws\/design-tiles-fixture$/, connected => {
    socket = connected;
    connected.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === "spectate_game") connected.send(JSON.stringify({ scoreboard: state }));
      if (["join_game", "rejoin_game"].includes(message.action)) {
        connected.send(JSON.stringify({ player_id: "p1", resume_token: "design-tiles-fixture" }));
        connected.send(JSON.stringify({ scoreboard: state }));
      }
    });
  });
  await page.goto(`/spiel/design-tiles-fixture?name=Anna${spectator ? "&spectator=1" : ""}`);
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
  if (design === "2026") await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  else await expect(page.locator("html")).not.toHaveAttribute("data-design", "2026");
  return { context, page, push: next => socket.send(JSON.stringify({ scoreboard: next })) };
}

const tile = (page, boardId) => page.locator(`#roomPlayerTiles .room-player-tile[data-board-id="${boardId}"]`);
const sheet = (page, boardId) => page.locator(`.player-card[data-board-id="${boardId}"]`);

test("ZDWA 2026 phone: one tile per player with live totals, the turn mark and the roll count", async ({ browser, baseURL }) => {
  const state = tileSnapshot();
  const { context, page, push } = await openRoom(browser, baseURL, { state });
  try {
    await expect(page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(2);
    await expect(page.locator("#roomPlayerTiles")).toHaveAttribute("aria-label", "Spielzettel wählen");
    await expect(tile(page, "p1").locator(".room-player-tile-name")).toHaveText("Anna");
    await expect(tile(page, "p1").locator(".room-player-tile-total")).toHaveText("55");
    await expect(tile(page, "p2").locator(".room-player-tile-total")).toHaveText("66");
    // The tile carries the sheet's total, so the sheet does not repeat it.
    await expect(sheet(page, "p1").locator(".pc-total")).toHaveText("Total: 55");
    await expect(sheet(page, "p1").locator(".pc-total")).toBeHidden();
    await expect(tile(page, "p1").locator("img.player-avatar")).toBeVisible();
    await expect(tile(page, "p1")).toHaveClass(/\bis-turn\b/);
    await expect(tile(page, "p1")).toHaveClass(/\bis-me\b/);
    await expect(tile(page, "p1").locator(".room-player-tile-turn")).toHaveText("am Zug");
    await expect(tile(page, "p2")).not.toHaveClass(/\bis-turn\b/);
    await expect(tile(page, "p2").locator(".room-player-tile-turn")).toHaveCount(0);
    await expect(tile(page, "p1")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "p2")).toHaveAttribute("aria-pressed", "false");
    // The turn text stays for screen readers only; the dice tray shows rolls.
    await expect(page.locator("#headerTurnStatus")).toContainText("Würfe: 1/3");
    expect((await page.locator("#headerTurnStatus").boundingBox()).width).toBeLessThanOrEqual(1);
    await expect(page.locator("#rollBtnInline .roll-count-text")).toHaveText("1/3");
    await expect(page.locator("#rollBtnInline .roll-count-pips i")).toHaveCount(3);
    await expect(page.locator("#rollBtnInline .roll-count-pips i.is-used")).toHaveCount(1);
    await expect(page.locator("#rollBtnInline .roll-count")).toBeVisible();
    // Header actions keep working next to the tiles.
    await expect(page.locator("#roomHeaderMenuToggle")).toBeVisible();
    await expect(page.locator("#backToLobbyBtn")).toBeVisible();

    Object.assign(state, { _rolls_used: 2, _turn: { player_id: "p1", roll_index: 2 } });
    push(state);
    await expect(page.locator("#rollBtnInline .roll-count-text")).toHaveText("2/3");
    await expect(page.locator("#rollBtnInline .roll-count-pips i.is-used")).toHaveCount(2);

    // Writing a score updates the total; the next turn moves the mark and the
    // view follows the active sheet.
    state._scoreboards.p1["15,up"] = 60;
    Object.assign(state, { _turn: { player_id: "p2", roll_index: 0 }, _rolls_used: 0, _dice: [0, 0, 0, 0, 0] });
    push(state);
    await expect(tile(page, "p1").locator(".room-player-tile-total")).toHaveText("115");
    await expect(tile(page, "p2")).toHaveClass(/\bis-turn\b/);
    await expect(tile(page, "p1")).not.toHaveClass(/\bis-turn\b/);
    await expect(sheet(page, "p2")).toBeInViewport({ ratio: .95 });
    await expect(tile(page, "p2")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "p1")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#rollBtnInline .roll-count-text")).toHaveText("0/3");
  } finally { await context.close(); }
});

test("ZDWA 2026 phone: a tile tap shows that sheet for the turn; the turn tile resumes following", async ({ browser, baseURL }) => {
  const state = tileSnapshot({ names: ["Anna", "Alexandra-Sophie von Hohenberg", "Clara-Marie Schneider", "David"] });
  const { context, page, push } = await openRoom(browser, baseURL, { state });
  try {
    await expect(page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(4);
    await expect(tile(page, "p3").locator(".room-player-tile-total")).toHaveText("35");
    await expect(tile(page, "p4").locator(".room-player-tile-total")).toHaveText("0");
    // Four tiles with long names fit next to the header actions.
    const fit = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect();
      const totals = [...document.querySelectorAll(".room-player-tile")].map(element => {
        const total = element.querySelector(".room-player-tile-total").getBoundingClientRect();
        const outer = element.getBoundingClientRect();
        return total.width > 0 && total.left >= outer.left && total.right <= outer.right;
      });
      return {
        pageWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
        tilesRight: box("#roomPlayerTiles").right,
        menuLeft: box("#roomHeaderMenuToggle").left,
        leaveRight: box("#backToLobbyBtn").right,
        totals,
      };
    });
    expect(fit.pageWidth).toBeLessThanOrEqual(fit.viewport);
    expect(fit.tilesRight).toBeLessThanOrEqual(fit.menuLeft);
    expect(fit.leaveRight).toBeLessThanOrEqual(fit.viewport);
    expect(fit.totals).toEqual([true, true, true, true]);

    await tile(page, "p3").tap();
    await expect(sheet(page, "p3")).toBeInViewport({ ratio: .95 });
    await expect(tile(page, "p3")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "p1")).toHaveAttribute("aria-pressed", "false");
    // The tile of the sheet in view has its own edge, apart from the brass
    // turn edge and the plain edge of the other tiles.
    const edges = await page.evaluate(() => Object.fromEntries(["p1", "p3", "p4"].map(id => [
      id, getComputedStyle(document.querySelector(`#roomPlayerTiles [data-board-id="${id}"]`)).borderTopColor,
    ])));
    expect(edges.p3).not.toBe(edges.p1);
    expect(edges.p3).not.toBe(edges.p4);
    // Dice and rolls of the current turn keep the chosen sheet.
    state._holds = [true, false, false, false, false];
    push(state);
    await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
    Object.assign(state, { _dice: [6, 4, 2, 1, 2], _rolls_used: 2, _turn: { player_id: "p1", roll_index: 2 } });
    push(state);
    await expect(page.locator("#rollBtnInline .roll-count-text")).toHaveText("2/3");
    await expect(sheet(page, "p3")).toBeInViewport({ ratio: .95 });
    await expect(tile(page, "p3")).toHaveAttribute("aria-pressed", "true");

    // The tile of the active sheet goes back and follows the game again.
    await tile(page, "p1").tap();
    await expect(sheet(page, "p1")).toBeInViewport({ ratio: .95 });
    await expect(tile(page, "p1")).toHaveAttribute("aria-pressed", "true");
    state._scoreboards.p1["15,free"] = 60;
    Object.assign(state, { _turn: { player_id: "p2", roll_index: 0 }, _rolls_used: 0, _dice: [0, 0, 0, 0, 0] });
    push(state);
    await expect(sheet(page, "p2")).toBeInViewport({ ratio: .95 });
    await expect(tile(page, "p2")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "p2")).toHaveClass(/\bis-turn\b/);
  } finally { await context.close(); }
});

test("ZDWA 2026 2v2: one tile per team names both members and rings the active teammate", async ({ browser, baseURL }) => {
  const state = tileSnapshot({ names: ["Anna", "Ben", "Clara", "David"], team: true });
  const { context, page } = await openRoom(browser, baseURL, { theme: "dark", state });
  try {
    await expect(page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(2);
    await expect(tile(page, "A").locator(".room-player-tile-name")).toHaveText("Anna & Clara");
    await expect(tile(page, "B").locator(".room-player-tile-name")).toHaveText("Ben & David");
    await expect(tile(page, "A").locator(".room-player-tile-total")).toHaveText("55");
    await expect(tile(page, "B").locator(".room-player-tile-total")).toHaveText("66");
    await expect(tile(page, "A")).toHaveClass(/\bis-turn\b/);
    await expect(tile(page, "A").locator("img.player-avatar")).toHaveCount(2);
    await expect(tile(page, "A").locator(".room-player-tile-active img.player-avatar")).toHaveCount(1);
    await expect(tile(page, "B").locator(".room-player-tile-active")).toHaveCount(0);
    await expect(tile(page, "A")).toHaveAttribute("title", "Team A: Anna & Clara");
  } finally { await context.close(); }
});

test("ZDWA 2026 phone: the sheet heading keeps rank, admin badge and profile link next to the tiles", async ({ browser, baseURL }) => {
  // Manuel's iPhone with two players, on the opponent's turn.
  const duel = tileSnapshot({ names: ["Mani", "Sandra"], accounts: true });
  duel._turn = { player_id: "p2", roll_index: 1 };
  const one = await openRoom(browser, baseURL, { viewport: { width: 440, height: 956 }, theme: "dark", state: duel });
  try {
    await expect(sheet(one.page, "p2")).toBeInViewport({ ratio: .95 });
    await expect(sheet(one.page, "p2").locator(".pc-head")).toBeVisible();
    await expect(sheet(one.page, "p2").locator(".pc-head .player-rank")).toBeVisible();
    await expect(sheet(one.page, "p2").locator(".pc-head a.player-name-label")).toBeVisible();
    await expect(sheet(one.page, "p2").locator(".pc-total")).toBeHidden();
    // The tiles stand in for the header turn text and keep its admin badge.
    await expect(tile(one.page, "p1").locator(".player-admin-badge")).toBeVisible();
    await expect(tile(one.page, "p2").locator(".player-admin-badge")).toHaveCount(0);
    await tile(one.page, "p1").tap();
    await expect(sheet(one.page, "p1")).toBeInViewport({ ratio: .95 });
    await expect(sheet(one.page, "p1").locator(".pc-head .player-rank")).toBeVisible();
    await expect(sheet(one.page, "p1").locator(".pc-head .player-rank")).toContainText("Expert");
    await expect(sheet(one.page, "p1").locator(".pc-head .player-admin-badge")).toBeVisible();
  } finally { await one.context.close(); }

  const team = await openRoom(browser, baseURL, { theme: "dark", state: tileSnapshot({ names: ["Mani", "Sandra", "Luca", "David"], team: true, accounts: true }) });
  try {
    const members = sheet(team.page, "A").locator(".pc-members");
    await expect(members).toBeVisible();
    await expect(members.locator(".player-rank")).toHaveCount(2);
    await expect(members.locator(".player-rank").first()).toBeVisible();
    await expect(members.locator("a.player-name-label").first()).toBeVisible();
    await expect(members.locator(".player-admin-badge")).toBeVisible();
    await expect(tile(team.page, "A").locator(".player-admin-badge")).toBeVisible();
  } finally { await team.context.close(); }
});

test("ZDWA 2026 phones: four tiles with four-digit totals fit from 360px; a 320px row fades where it scrolls", async ({ browser, baseURL }) => {
  const names = ["Anna", "Alexandra-Sophie von Hohenberg", "Clara-Marie Schneider", "David"];
  const big = () => {
    const state = tileSnapshot({ names });
    state._scoreboards.p4 = { "13,free": 1288 };
    return state;
  };
  for (const viewport of [{ width: 360, height: 640 }, { width: 375, height: 667 }]) {
    const { context, page } = await openRoom(browser, baseURL, { viewport, theme: "dark", state: big() });
    try {
      await expect(tile(page, "p4").locator(".room-player-tile-total")).toHaveText("1288");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const fit = await page.evaluate(() => {
        const row = document.getElementById("roomPlayerTiles");
        return {
          scroll: row.scrollWidth, client: row.clientWidth, overflow: row.dataset.overflow || "",
          totals: [...row.querySelectorAll(".room-player-tile-score")].map(score => score.scrollWidth <= score.clientWidth),
          menuLeft: document.getElementById("roomHeaderMenuToggle").getBoundingClientRect().left,
          lastRight: row.lastElementChild.getBoundingClientRect().right,
        };
      });
      const label = `${viewport.width}x${viewport.height}`;
      expect(fit.scroll, label).toBeLessThanOrEqual(fit.client);
      expect(fit.overflow, label).toBe("");
      expect(fit.totals, label).toEqual([true, true, true, true]);
      expect(fit.lastRight, label).toBeLessThanOrEqual(fit.menuLeft);
    } finally { await context.close(); }
  }

  const { context, page } = await openRoom(browser, baseURL, { viewport: { width: 320, height: 568 }, theme: "dark", state: big() });
  try {
    const row = page.locator("#roomPlayerTiles");
    await expect(row).toHaveAttribute("data-overflow", "end");
    expect(await row.evaluate(element => getComputedStyle(element).maskImage || getComputedStyle(element).webkitMaskImage)).toContain("gradient");
    await row.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expect(row).toHaveAttribute("data-overflow", "start");
  } finally { await context.close(); }
});

test("ZDWA 2026: team and long names widen their tile where the header has room", async ({ browser, baseURL }) => {
  const { context, page } = await openRoom(browser, baseURL, {
    viewport: { width: 820, height: 1180 }, theme: "dark",
    state: tileSnapshot({ names: ["Mani", "Sandra", "Luca", "Alexandra-Sophie"], team: true }),
  });
  try {
    await expect(tile(page, "A").locator(".room-player-tile-turn")).toBeVisible();
    const names = await page.evaluate(() => [...document.querySelectorAll(".room-player-tile-name")]
      .map(name => name.scrollWidth <= name.clientWidth));
    expect(names).toEqual([true, true]);
  } finally { await context.close(); }
});

test("ZDWA 2026: the connection pill drops below the header instead of covering a tile", async ({ browser, baseURL }) => {
  for (const device of [{ viewport: PHONE, mobile: true }, { viewport: { width: 1280, height: 800 }, mobile: false }]) {
    const { context, page } = await openRoom(browser, baseURL, { ...device, theme: "light", state: tileSnapshot() });
    try {
      await expect(page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(2);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (const text of ["Verbunden", "Verbindung wird wiederhergestellt …"]) {
        const boxes = await page.evaluate(value => {
          const pill = document.getElementById("connectionStatus");
          pill.dataset.state = "reconnecting";
          pill.textContent = value;
          pill.hidden = false;
          const box = element => element.getBoundingClientRect().toJSON();
          return { pill: box(pill), header: box(document.querySelector(".room-header")), tiles: [...document.querySelectorAll(".room-player-tile")].map(box), viewport: innerWidth };
        }, text);
        const label = `${device.viewport.width} ${text}`;
        expect(boxes.pill.top, label).toBeGreaterThanOrEqual(boxes.header.bottom);
        expect(boxes.pill.right, label).toBeLessThanOrEqual(boxes.viewport);
        expect(boxes.pill.left, label).toBeGreaterThanOrEqual(0);
        for (const box of boxes.tiles) {
          const overlap = Math.min(box.right, boxes.pill.right) > Math.max(box.left, boxes.pill.left)
            && Math.min(box.bottom, boxes.pill.bottom) > Math.max(box.top, boxes.pill.top);
          expect(overlap, label).toBe(false);
        }
      }
    } finally { await context.close(); }
  }
});

test("ZDWA 2026: during a reconnect the pill passes under the beginner tour card", async ({ browser, baseURL }) => {
  for (const device of [{ viewport: PHONE, mobile: true }, { viewport: { width: 1280, height: 800 }, mobile: false }]) {
    const { context, page } = await openRoom(browser, baseURL, { ...device, theme: "light", state: tileSnapshot() });
    try {
      const tour = page.locator("[data-game-tour]");
      await expect(tour).toBeVisible();
      const covered = await page.evaluate(() => {
        const pill = document.getElementById("connectionStatus");
        pill.dataset.state = "reconnecting";
        pill.textContent = "Verbindung unterbrochen – neuer Versuch …";
        pill.hidden = false;
        // The pill ignores pointers, so hit testing alone would look through it;
        // let it take hits here to measure which layer is painted on top.
        pill.style.pointerEvents = "auto";
        const card = document.querySelector("[data-game-tour]");
        const close = card.querySelector("[data-tour-close], [data-tour-dismiss]").getBoundingClientRect();
        const progress = card.querySelector("h2, .game-tour-progress").getBoundingClientRect();
        const inCard = (x, y) => !!document.elementFromPoint(x, y)?.closest("[data-game-tour]");
        return {
          close: inCard(close.left + close.width / 2, close.top + close.height / 2),
          heading: inCard(progress.right - 4, progress.top + progress.height / 2),
        };
      });
      expect(covered, `${device.viewport.width}`).toEqual({ close: true, heading: true });
    } finally { await context.close(); }
  }
});

test("ZDWA 2026: viewing another sheet through its tile keeps the tour highlight on screen", async ({ browser, baseURL }) => {
  const { context, page } = await openRoom(browser, baseURL, { theme: "light", state: tileSnapshot() });
  try {
    const tour = page.locator("[data-game-tour]");
    await page.locator("[data-tour-start]").click();
    for (const step of ["hold", "roll", "write"]) {
      await page.locator("[data-tour-next]").click();
      await expect(tour).toHaveAttribute("data-tour-step", step);
    }
    await expect(page.locator(".player-card.me td.cell.game-tour-target")).toHaveCount(1);
    await tile(page, "p2").click();
    await expect(tile(page, "p2")).toHaveAttribute("aria-pressed", "true");
    await expect(sheet(page, "p2")).toBeInViewport({ ratio: .95 });
    // The own sheet left the screen: the step points at what is visible
    // instead of a cell outside the grid, and the tour stays open.
    await expect(page.locator(".player-card.me .game-tour-target, .player-card.me.game-tour-target")).toHaveCount(0);
    await expect(page.locator(".game-tour-target")).toBeInViewport();
    await expect(tour).toHaveAttribute("data-tour-step", "write");
  } finally { await context.close(); }
});

test("ZDWA 2026 solo and spectators: tiles without a turn race, taps still show sheets", async ({ browser, baseURL }) => {
  const solo = await openRoom(browser, baseURL, { state: tileSnapshot({ names: ["Anna"] }) });
  try {
    await expect(solo.page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(1);
    await expect(tile(solo.page, "p1").locator(".room-player-tile-total")).toHaveText("55");
    await expect(tile(solo.page, "p1")).not.toHaveClass(/\bis-turn\b/);
    await expect(solo.page.locator(".room-player-tile-turn")).toHaveCount(0);
    await expect(tile(solo.page, "p1")).toHaveAttribute("aria-pressed", "true");
  } finally { await solo.context.close(); }

  const watch = await openRoom(browser, baseURL, { state: tileSnapshot(), spectator: true });
  try {
    await expect(watch.page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(2);
    await expect(watch.page.locator("#roomPlayerTiles .room-player-tile.is-me")).toHaveCount(0);
    await expect(tile(watch.page, "p1")).toHaveClass(/\bis-turn\b/);
    await tile(watch.page, "p2").tap();
    await expect(sheet(watch.page, "p2")).toBeInViewport({ ratio: .95 });
    await expect(tile(watch.page, "p2")).toHaveAttribute("aria-pressed", "true");
  } finally { await watch.context.close(); }
});

// The header rule stays visible and the active sheet's frame keeps a gap.
for (const theme of ["light", "dark", "classic"]) {
  test(`ZDWA 2026 ${theme}: the active sheet frame stays below a visible header rule on phone, tablet and desktop`, async ({ browser, baseURL }) => {
    for (const device of [
      { viewport: PHONE, mobile: true },
      { viewport: { width: 430, height: 932 }, mobile: true },
      { viewport: { width: 820, height: 1180 }, mobile: true },
      { viewport: { width: 1280, height: 800 }, mobile: false },
    ]) {
      const { context, page } = await openRoom(browser, baseURL, { ...device, theme, state: tileSnapshot() });
      try {
        await expect(page.locator("#roomPlayerTiles .room-player-tile")).toHaveCount(2);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const geometry = await page.evaluate(() => {
          const header = document.querySelector(".room-header");
          const card = document.querySelector(".player-card.turn");
          const headerBox = header.getBoundingClientRect();
          const cardBox = card.getBoundingClientRect();
          const style = getComputedStyle(header);
          const x = Math.min(Math.max(cardBox.left + cardBox.width / 2, headerBox.left + 4), headerBox.right - 4);
          const hit = document.elementFromPoint(x, headerBox.bottom - .5);
          const tiles = document.getElementById("roomPlayerTiles").getBoundingClientRect();
          return {
            borderWidth: parseFloat(style.borderBottomWidth),
            borderColor: style.borderBottomColor,
            headerBottom: headerBox.bottom,
            cardTop: cardBox.top,
            hitInHeader: !!hit?.closest(".room-header"),
            tilesInHeader: tiles.top >= headerBox.top - 4 && tiles.bottom <= headerBox.bottom + 4,
            pageWidth: document.documentElement.scrollWidth,
            viewport: innerWidth,
          };
        });
        const label = `${theme} ${device.viewport.width}x${device.viewport.height}`;
        expect(geometry.borderWidth, label).toBeGreaterThanOrEqual(1);
        expect(geometry.borderColor, label).not.toMatch(/rgba\([^)]*,\s*0\)|transparent/);
        // The 2px brass frame sits outside the card box; at least 4px stay free.
        expect(geometry.cardTop - 2 - geometry.headerBottom, label).toBeGreaterThanOrEqual(4);
        expect(geometry.hitInHeader, label).toBe(true);
        expect(geometry.tilesInHeader, label).toBe(true);
        expect(geometry.pageWidth, label).toBeLessThanOrEqual(geometry.viewport);
        await expect(page.locator("#rollBtnInline")).toBeInViewport();
      } finally { await context.close(); }
    }
  });
}

test("ZDWA previous design keeps its header text and sheet totals without tiles", async ({ browser, baseURL }) => {
  const { context, page } = await openRoom(browser, baseURL, { design: "old", state: tileSnapshot() });
  try {
    await expect(page.locator("#roomPlayerTiles")).toBeHidden();
    await expect(page.locator("#rollBtnInline .roll-count")).toBeHidden();
    await expect(page.locator("#headerTurnStatus")).toBeVisible();
    await expect(page.locator("#headerTurnStatus")).toContainText("Würfe: 1/3");
    await expect(page.locator(".player-card.turn .pc-total")).toBeVisible();
    await expect(page.locator(".player-card.turn .pc-head")).toBeVisible();
  } finally { await context.close(); }
});

test("ZDWA 2026 in English: tile labels, turn mark and the Hardcore rule", async ({ browser, baseURL }) => {
  const { context, page } = await openRoom(browser, baseURL, {
    viewport: { width: 1280, height: 800 }, mobile: false, language: "en", state: tileSnapshot({ hardcore: true }),
  });
  try {
    await expect(page.locator("#roomPlayerTiles")).toHaveAttribute("aria-label", "Choose score sheet");
    await expect(tile(page, "p1").locator(".room-player-tile-turn")).toHaveText("to play");
    await expect(tile(page, "p1").locator(".room-player-tile-turn")).toBeVisible();
    await expect(tile(page, "p1").locator(".room-player-tile-name")).toHaveText("Anna");
    await expect(page.locator("#rollBtnInline")).toHaveCount(0);
    await expect(page.locator(".tray-mode-note")).toHaveText("Hardcore: 1 roll, no holding");
    await expect(page.locator(".tray-mode-note")).toBeVisible();
    const note = await page.locator(".tray-mode-note").boundingBox();
    const first = await page.locator("#diceBar .die").first().boundingBox();
    const last = await page.locator("#diceBar .die").last().boundingBox();
    // Wide trays name the rule beside the dice, where the roll button stands
    // in the other modes; the dice stay centred and no row is added, so the
    // whole Hardcore sheet keeps fitting at 1280x800.
    expect(note.x).toBeGreaterThanOrEqual(last.x + last.width);
    expect(note.y).toBeGreaterThanOrEqual(first.y - 1);
    expect(note.y + note.height).toBeLessThanOrEqual(first.y + first.height + 1);
    const layout = await page.evaluate(() => {
      const bar = document.getElementById("diceBar").getBoundingClientRect();
      const dice = [...document.querySelectorAll("#diceBar .die")].map(die => die.getBoundingClientRect());
      const wrap = document.querySelector(".player-card.turn .table-wrap");
      return {
        centre: (dice[0].left + dice[4].right) / 2 - (bar.left + bar.right) / 2,
        noteRight: document.querySelector(".tray-mode-note").getBoundingClientRect().right - bar.right,
        sheetScroll: wrap.scrollHeight - wrap.clientHeight,
      };
    });
    expect(Math.abs(layout.centre)).toBeLessThanOrEqual(2);
    expect(layout.noteRight).toBeLessThanOrEqual(0);
    expect(layout.sheetScroll).toBeLessThanOrEqual(1);
  } finally { await context.close(); }

  // The phone action dock shows the rule in the action row below the dice.
  const phone = await openRoom(browser, baseURL, { language: "en", state: tileSnapshot({ hardcore: true }) });
  try {
    await expect(phone.page.locator(".tray-mode-note")).toBeVisible();
    const note = await phone.page.locator(".tray-mode-note").boundingBox();
    const first = await phone.page.locator("#diceBar .die").first().boundingBox();
    expect(note.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    await expect(phone.page.locator(".tray-mode-note")).toBeInViewport();
  } finally { await phone.context.close(); }
});
