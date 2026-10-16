const { test, expect } = require("@playwright/test");
const { expectFixedTable, expectReachable, expectCompleteScoreSheet } = require("./table-viewport");

function focusSnapshot({ team = false } = {}) {
  const players = ["Anna", "Ben", "Clara", "David"].map((name, index) => ({ id:`p${index + 1}`, name }));
  return {
    _name:"Turn table focus", _mode:team ? "2v2" : "4", _hardcore:false,
    _players:players, _players_joined:4, _expected:4, _started:true,
    _finished:false, _aborted:false, _paused:false, _manual_pause:false,
    _offline_players:[], _connected:Object.fromEntries(players.map(player => [player.id, true])),
    _turn:{ player_id:"p1", roll_index:1 }, _dice:[2, 2, 3, 4, 5],
    _holds:[false, false, false, false, false], _rolls_used:1, _rolls_max:3,
    _scoreboards:Object.fromEntries(players.map(player => [player.id, {}])),
    _admin_edits:{}, _superadmin_active:false, _announced_row4:null,
    _announced_by:null, _announced_board:null, _correction:{ active:false },
    _teams:team ? [{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }] : [],
    _scoreboards_by_team:team ? { A:{}, B:{} } : {},
    _results:null, _last_write_public:{}, _has_last:{}, _auto_single:false,
    _chat_history:[], suggestions:[],
  };
}

async function focusFixture(page, state) {
  let socket;
  await page.routeWebSocket(/\/ws\/table-focus-fixture$/, connected => {
    socket = connected;
    connected.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (["join_game", "rejoin_game"].includes(message.action)) {
        connected.send(JSON.stringify({ player_id:"p1", resume_token:"table-focus-fixture" }));
        connected.send(JSON.stringify({ scoreboard:state }));
      }
    });
  });
  await page.goto("/spiel/table-focus-fixture?name=Anna");
  await expect(page.locator("#diceBar .die")).toHaveCount(5);
  return { push:next => socket.send(JSON.stringify({ scoreboard:next })) };
}

const focusBoard = (page, boardId) => page.locator(`.player-card[data-board-id="${boardId}"]`);

async function selectFocusBoard(page, boardId) {
  const grid = page.locator(".players-grid");
  // Dispatch the horizontal gesture separately from its native scroll result:
  // Playwright's touchscreen API cannot drag on both Chromium and WebKit.
  await grid.dispatchEvent("pointerdown", { pointerId:1, pointerType:"touch", clientX:300, clientY:100 });
  await grid.dispatchEvent("pointermove", { pointerId:1, pointerType:"touch", buttons:1, clientX:100, clientY:100 });
  await grid.evaluate((element, id) => {
    const card = element.querySelector(`[data-board-id="${id}"]`);
    const left = element.scrollLeft + card.getBoundingClientRect().left - element.getBoundingClientRect().left;
    element.scrollTo({ left, behavior:"instant" });
  }, boardId);
  await grid.dispatchEvent("pointerup", { pointerId:1, pointerType:"touch", clientX:100, clientY:100 });
  await expect(focusBoard(page, boardId)).toBeInViewport({ ratio:.95 });
}

for (const viewport of [{ width:390, height:900 }, { width:700, height:440 }]) {
  test(`ZDWA ${viewport.width}x${viewport.height}: manual table focus lasts until any player change, then follows remote dice`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport, isMobile:true, hasTouch:true, serviceWorkers:"block" });
    const page = await context.newPage();
    try {
      const state = focusSnapshot();
      const server = await focusFixture(page, state);
      await expect(focusBoard(page, "p1")).toBeInViewport({ ratio:.95 });
      await selectFocusBoard(page, "p3");
      for (const change of [
        { _holds:[true, false, false, false, false] },
        { _dice:[2, 6, 3, 1, 5], _turn:{ player_id:"p1", roll_index:2 }, _rolls_used:2 },
        { _announced_row4:"2", _announced_by:"p1", _announced_board:"p1" },
      ]) {
        Object.assign(state, change);
        server.push(state);
        if (change._holds) await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
        if (change._rolls_used) await expect(page.locator("#headerTurnStatus")).toContainText("2/3");
        if (change._announced_row4) await expect(page.locator("#announceBtnInline")).toHaveText("Schreiben");
        await expect(focusBoard(page, "p3")).toBeInViewport({ ratio:.95 });
      }
      // A turn can change without a newly filled cell, for example when a
      // player leaves or a corrected snapshot replaces the prior board.
      Object.assign(state, { _turn:{ player_id:"p2", roll_index:0 }, _rolls_used:0,
        _dice:[0, 0, 0, 0, 0], _holds:[false, false, false, false, false] });
      server.push(state);
      await expect(page.locator(".player-card.turn")).toHaveAttribute("data-board-id", "p2");
      await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
      Object.assign(state, { _turn:{ player_id:"p2", roll_index:1 }, _rolls_used:1, _dice:[4, 2, 1, 6, 3] });
      server.push(state);
      await expect(page.locator(".player-card.turn")).toHaveAttribute("data-board-id", "p2");
      await expect(page.locator("#headerTurnStatus")).toContainText("1/3");
      await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
      await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
      await selectFocusBoard(page, "p4");
      state._scoreboards.p2["0,free"] = 4;
      Object.assign(state, { _turn:{ player_id:"p1", roll_index:0 }, _rolls_used:0, _dice:[0, 0, 0, 0, 0] });
      server.push(state);
      await expect(focusBoard(page, "p1")).toBeInViewport({ ratio:.95 });
    } finally { await context.close(); }
  });
}

test("ZDWA phone: a native finger swipe selects another table until the next turn", async ({ browser, baseURL }) => {
  test.skip(browser.browserType().name() !== "chromium", "Native touch dragging uses Chromium's input protocol; the portable gesture cases cover WebKit.");
  const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const state = focusSnapshot();
    const server = await focusFixture(page, state);
    await expect(focusBoard(page, "p1")).toBeInViewport({ ratio:.95 });
    const heading = await focusBoard(page, "p1").locator(".pc-head").boundingBox();
    const input = await context.newCDPSession(page);
    const touch = x => [{ x, y:heading.y + heading.height / 2 }];
    await input.send("Input.dispatchTouchEvent", { type:"touchStart", touchPoints:touch(330) });
    for (const x of [280, 230, 180, 130, 80, 30]) {
      await input.send("Input.dispatchTouchEvent", { type:"touchMove", touchPoints:touch(x) });
      await page.waitForTimeout(30);
    }
    await input.send("Input.dispatchTouchEvent", { type:"touchEnd", touchPoints:[] });
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
    state._holds = [true, false, false, false, false];
    server.push(state);
    await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
    Object.assign(state, { _turn:{ player_id:"p3", roll_index:0 }, _rolls_used:0 });
    server.push(state);
    await expect(focusBoard(page, "p3")).toBeInViewport({ ratio:.95 });
    await input.detach();
  } finally { await context.close(); }
});

test("ZDWA mobile: a snapshot received during delayed turn scrolling still reaches the active table", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const state = focusSnapshot();
    const server = await focusFixture(page, state);
    await selectFocusBoard(page, "p4");
    const oldPosition = await page.locator(".players-grid").evaluate(grid => grid.scrollLeft);
    const followingStarted = page.evaluate(oldLeft => new Promise(resolve => {
      const handler = event => {
        const grid = event.target;
        if (!(grid instanceof Element) || !grid.matches(".players-grid")) return;
        if (grid.querySelector(".player-card.turn")?.dataset.boardId !== "p2") return;
        const card = grid.querySelector('[data-board-id="p2"]');
        const remaining = card.getBoundingClientRect().left - grid.getBoundingClientRect().left;
        if (grid.scrollLeft < oldLeft - 2 && Math.abs(remaining) > 40) {
          document.removeEventListener("scroll", handler, true);
          resolve();
        }
      };
      document.addEventListener("scroll", handler, true);
    }), oldPosition);
    state._scoreboards.p1["0,free"] = 4;
    Object.assign(state, { _turn:{ player_id:"p2", roll_index:0 }, _rolls_used:0, _dice:[0, 0, 0, 0, 0] });
    server.push(state);
    await followingStarted;
    Object.assign(state, { _turn:{ player_id:"p2", roll_index:1 }, _rolls_used:1, _dice:[3, 1, 2, 5, 6] });
    server.push(state);
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
    await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
  } finally { await context.close(); }
});

test("ZDWA mobile team: manual focus resets when the next player shares the same team table", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const state = focusSnapshot({ team:true });
    const server = await focusFixture(page, state);
    await expect(focusBoard(page, "A")).toBeInViewport({ ratio:.95 });
    await selectFocusBoard(page, "B");
    state._turn = { player_id:"p3", roll_index:0 };
    state._rolls_used = 0;
    server.push(state);
    await expect(page.locator("#headerTurnStatus")).toContainText("Clara");
    await expect(focusBoard(page, "A")).toBeInViewport({ ratio:.95 });
    Object.assign(state, { _turn:{ player_id:"p3", roll_index:1 }, _rolls_used:1, _dice:[6, 3, 2, 5, 4] });
    server.push(state);
    await expect(page.locator("#headerTurnStatus")).toContainText("1/3");
    await expect(focusBoard(page, "A")).toBeInViewport({ ratio:.95 });
  } finally { await context.close(); }
});

test("ZDWA mobile: tapping a table and vertical scrolling during the writing delay keep automatic follow", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const state = focusSnapshot();
    const server = await focusFixture(page, state);
    state._scoreboards.p1["0,free"] = 4;
    Object.assign(state, { _turn:{ player_id:"p2", roll_index:0 }, _rolls_used:0, _dice:[0, 0, 0, 0, 0] });
    server.push(state);
    await expect(page.locator(".player-card.turn")).toHaveAttribute("data-board-id", "p2");
    await focusBoard(page, "p1").locator(".pc-name").tap();
    await page.locator(".players-grid").dispatchEvent("wheel", { deltaX:1, deltaY:120 });
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
  } finally { await context.close(); }
});

test("ZDWA tablet: arrow-selected tables stay selected for the turn and reset for the next player", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport:{ width:1024, height:1366 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const state = focusSnapshot();
    const server = await focusFixture(page, state);
    await page.locator(".tablet-board-navigation button:last-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("2–3 / 4");
    await page.locator(".tablet-board-navigation button:last-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("3–4 / 4");
    state._holds = [true, false, false, false, false];
    server.push(state);
    await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("3–4 / 4");
    Object.assign(state, { _turn:{ player_id:"p2", roll_index:0 }, _rolls_used:0 });
    server.push(state);
    await expect(page.locator(".player-card.turn")).toHaveAttribute("data-board-id", "p2");
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("2–3 / 4");
    Object.assign(state, { _turn:{ player_id:"p2", roll_index:1 }, _rolls_used:1, _dice:[1, 3, 6, 4, 2] });
    server.push(state);
    await expect(page.locator("#headerTurnStatus")).toContainText("1/3");
    await expect(focusBoard(page, "p2")).toBeInViewport({ ratio:.95 });
  } finally { await context.close(); }
});

for (const theme of ["light", "dark", "classic"]) {
  test(`ZDWA ${theme} keeps its table fixed and every score reachable across device sizes`, async ({ browser, baseURL, request }, testInfo) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 440, height: 956 }, serviceWorkers: "block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
    // The independently tested offer must not cover these table hit targets.
    await context.addInitScript(() => localStorage.setItem("rollthedice.tours.v1.guest", JSON.stringify({
      enabled: true, games: { zdwa: "dismissed", zilch: "dismissed", hausdepp: "dismissed" },
    })));
    await context.route("**/api/auth/tours/offer", route => route.fulfill({ json: {
      show: false, enabled: true, games: { zdwa: "dismissed", zilch: "dismissed", hausdepp: "dismissed" },
    } }));
    const page = await context.newPage();
    let snapshots = 0;
    page.on("websocket", socket => socket.on("framereceived", frame => {
      if (JSON.parse(frame.payload).scoreboard) snapshots += 1;
    }));
    try {
      const response = await request.post("/api/games", { data: { name: "Fixed table regression", mode: 1 } });
      expect(response.ok()).toBeTruthy();
      await page.goto(`/spiel/${(await response.json()).game_id}?name=Anna`);
      await expect(page.locator(".player-card.me table.grid")).toBeVisible();
      for (const viewport of [
        { width:320, height:480 }, { width:320, height:568 }, { width:367, height:703 },
        { width:390, height:844 }, { width:440, height:956 }, { width:600, height:960 },
        { width:956, height:440 }, { width:820, height:1180 },
        { width:768, height:600 }, { width:1024, height:1366 }, { width:1366, height:1024 },
      ]) {
        await page.setViewportSize(viewport);
        const safeArea = viewport.width === 440 && viewport.height === 956
          ? { top:59, bottom:34 }
          : (viewport.width === 320 && viewport.height === 568 ? { top:20, bottom:0 } : { top:0, bottom:0 });
        await page.evaluate(({ top, bottom }) => {
          document.body.style.setProperty("--room-safe-top", `${top}px`);
          document.body.style.setProperty("--room-safe-bottom", `${bottom}px`);
        }, safeArea);
        await expectFixedTable(page, [".room-header", ".players-grid", ".topbar"]);
        const tablet = viewport.width >= 768 && viewport.height >= 601;
        await expectCompleteScoreSheet(page, ".player-card.me .table-wrap", {
          minWritableRowHeight:tablet ? (viewport.height >= 1180 ? 38 : 22) : (viewport.height <= 480 ? 10.5 : (viewport.height < 600 ? 14 : 15)),
          minFixedRowHeight:tablet ? 14 : (viewport.height < 600 ? 10 : 15),
          minFontSize:tablet ? 12 : (viewport.height <= 480 ? 9.8 : 10),
        });
        await expectReachable(page, "#rollBtnInline");
        await expectReachable(page, "#announceBtnInline");
        await expectReachable(page, "#chatToggle");
        await expectReachable(page, "#roomHeaderMenuToggle");
        const lastRow = page.locator(".player-card.me table.grid tbody tr:last-child");
        await expect(lastRow).toBeInViewport();
        const visible = await lastRow.evaluate(row => {
          const box = row.getBoundingClientRect();
          const sheet = row.closest(".table-wrap").getBoundingClientRect();
          return Math.min(box.bottom, sheet.bottom) - Math.max(box.top, sheet.top);
        });
        expect(visible).toBeGreaterThan(10);
        await page.screenshot({ path: testInfo.outputPath(`table-${viewport.width}x${viewport.height}.png`) });
      }
      await page.setViewportSize({ width: 320, height: 480 });
      const beforeRoll = snapshots;
      await page.locator("#rollBtnInline").click();
      await expect.poll(() => snapshots).toBeGreaterThan(beforeRoll);
      await expect.poll(() => page.locator("#diceBar .die svg circle").count()).toBeGreaterThan(0);
      await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
      const sheet = page.locator(".player-card.me .table-wrap");
      await sheet.evaluate(element => { element.scrollTop = element.scrollHeight; });
      const readingPosition = await sheet.evaluate(element => element.scrollTop);
      expect(readingPosition).toBeLessThanOrEqual(1);
      const beforeHold = snapshots;
      await page.locator("#diceBar .die").first().click();
      await expect.poll(() => snapshots).toBeGreaterThan(beforeHold);
      await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
      await expectCompleteScoreSheet(page, ".player-card.me .table-wrap", {
        minWritableRowHeight:10.5,
        minFixedRowHeight:10,
        minFontSize:9.8,
      });
      await page.locator("#roomHeaderMenuToggle").click();
      await page.locator("#rulesSheetOpen").click();
      await expectReachable(page, "#rulesSheetClose");
      await expect(page.locator("#rulesFrame")).toBeVisible();
      await page.locator("#rulesSheetClose").click();
      await page.locator("#chatToggle").click();
      await page.locator("#chatInput").fill("Mein Entwurf bleibt sichtbar");
      await page.locator("#chatInput").focus();
      await page.setViewportSize({ width: 320, height: 340 });
      await expectReachable(page, "#chatInput");
      await expectReachable(page, "#chatSend");
      await expect(page.locator("#chatInput")).toHaveValue("Mein Entwurf bleibt sichtbar");
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    } finally { await context.close(); }
  });
}

test("Classic short phones keep every score readable when suggestions appear after rolling", async ({ browser, baseURL, request }, testInfo) => {
  const context = await browser.newContext({ baseURL, hasTouch:true, isMobile:true, viewport:{ width:320, height:480 }, serviceWorkers:"block" });
  await context.addInitScript(() => localStorage.setItem("wuerfler_theme", "classic"));
  const page = await context.newPage();
  let snapshots = 0;
  page.on("websocket", socket => socket.on("framereceived", frame => {
    if (JSON.parse(frame.payload).scoreboard) snapshots += 1;
  }));
  try {
    const response = await request.post("/api/games", { data:{ name:"Classic compact suggestions", mode:1 } });
    expect(response.ok()).toBeTruthy();
    await page.goto(`/spiel/${(await response.json()).game_id}?name=Anna&__test=1`);
    await expect(page.locator(".player-card.me table.grid")).toBeVisible();
    await page.evaluate(async () => {
      await Promise.all([400, 700].map(weight => document.fonts.load(`${weight} 16px "ZDWA Classic Hand"`)));
      await document.fonts.ready;
    });
    const beforeRoll = snapshots;
    await page.locator("#rollBtnInline").click();
    await expect.poll(() => snapshots).toBeGreaterThan(beforeRoll);
    await expect.poll(() => page.locator("#diceBar .die svg circle").count()).toBeGreaterThan(0);
    await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
    const states = [
      [],
      [{ type:"KENTER", points:35, eligible:true }],
      [{ type:"MAX", points:25, eligible:true }, { type:"MIN", points:7, eligible:true }],
      [],
    ];
    for (const [index, suggestions] of states.entries()) {
      await page.evaluate(values => {
        window.__rtDebugRenderSuggestionsForSnapshot({ suggestions:values });
        window.dispatchEvent(new Event("resize"));
      }, suggestions);
      await expect(page.locator("#suggestions .suggestion-btn")).toHaveCount(suggestions.length);
      await expectCompleteScoreSheet(page, ".player-card.me .table-wrap", {
        minWritableRowHeight:10.5, minFixedRowHeight:10, minFontSize:9.8,
      });
      await expect.poll(() => page.locator(".player-card.me table.grid tbody tr:last-child").evaluate(row => {
        const box = row.getBoundingClientRect();
        const sheet = row.closest(".table-wrap").getBoundingClientRect();
        return Math.min(box.bottom, sheet.bottom) - Math.max(box.top, sheet.top);
      }), { message:"the complete bottom total remains readable when suggestions change" }).toBeGreaterThan(10);
      await expectReachable(page, "#rollBtnInline");
      await expectReachable(page, "#announceBtnInline");
      await expectReachable(page, "#chatToggle");
      await page.screenshot({ path:testInfo.outputPath(`classic-short-suggestions-${index}.png`) });
    }
  } finally { await context.close(); }
});
