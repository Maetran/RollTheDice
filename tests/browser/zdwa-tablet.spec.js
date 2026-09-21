const { test, expect } = require("@playwright/test");
const { expectFixedTable, expectReachable, expectCompleteScoreSheet } = require("./table-viewport");

const TABLET = "(any-pointer: coarse) and (min-width: 768px) and (min-height: 601px) and (max-width: 1600px)";
const sizes = [{ width:1024, height:1366 }, { width:1366, height:1024 }, { width:820, height:1180 }, { width:768, height:1024 }, { width:1024, height:768 }];

function snapshot(count = 2, mode = String(count)) {
  const players = ["Anna", "Ben", "Clara", "David"].slice(0, count).map((name, index) => ({ id:`p${index + 1}`, name }));
  return {
    _name:"Tablet table", _mode:mode, _hardcore:false,
    _players:players, _players_joined:count, _expected:count, _started:true,
    _finished:false, _aborted:false, _paused:false, _manual_pause:false, _offline_players:[],
    _connected:Object.fromEntries(players.map(player => [player.id, true])),
    _turn:{ player_id:"p1", roll_index:1 }, _dice:[2, 2, 3, 4, 5], _holds:[false, false, false, false, false],
    _rolls_used:1, _rolls_max:3,
    _scoreboards:Object.fromEntries(players.map(player => [player.id, { "0,down":3 }])),
    _admin_edits:{}, _superadmin_active:false, _announced_row4:null, _announced_by:null,
    _announced_board:null, _correction:{ active:false },
    _teams:mode === "2v2" ? [{ id:"A", name:"Anna und Clara", members:["p1", "p3"] }, { id:"B", name:"Ben und David", members:["p2", "p4"] }] : [],
    _scoreboards_by_team:mode === "2v2" ? { A:{ "0,down":3 }, B:{ "0,down":3 } } : {},
    _results:null, _last_write_public:{}, _has_last:{}, _auto_single:false, _chat_history:[],
    suggestions:[{ type:"MAX", label:"Gutes Maximum", points:16, eligible:true }],
  };
}

async function fixture(page, initial) {
  const actions = [];
  let socket;
  await page.routeWebSocket(/\/ws\/tablet-fixture$/, connected => {
    socket = connected;
    connected.onMessage(raw => {
      const message = JSON.parse(String(raw));
      actions.push(message);
      if (["join_game", "rejoin_game"].includes(message.action)) {
        connected.send(JSON.stringify({ player_id:"p1", resume_token:"tablet-fixture" }));
        connected.send(JSON.stringify({ scoreboard:initial }));
      }
    });
  });
  await page.goto("/spiel/tablet-fixture?name=Anna");
  await expect(page.locator(".player-card.me")).toBeVisible();
  return { actions, push:next => socket.send(JSON.stringify({ scoreboard:next })) };
}

for (const theme of ["light", "dark", "classic"]) {
  test(`ZDWA tablet ${theme}: readable sheets and edge controls in both orientations`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport:sizes[0], isMobile:true, hasTouch:true, serviceWorkers:"block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
    const page = await context.newPage();
    try {
      const initial = snapshot();
      const server = await fixture(page, initial);
      for (const viewport of sizes) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(query => matchMedia(query).matches, TABLET)).toBe(true);
        await expectFixedTable(page, [".room-header", ".players-grid", ".topbar"]);
        for (const selector of ["#rollBtnInline", "#announceBtnInline", "#diceBar .die[data-i='0']", "#roomHeaderMenuToggle", "#chatToggle"]) await expectReachable(page, selector);
        const boxes = await page.evaluate(() => {
          const rect = selector => { const b = document.querySelector(selector).getBoundingClientRect(); return { x:b.x, y:b.y, width:b.width, height:b.height, right:b.right, bottom:b.bottom }; };
          return { sheet:rect(".player-card.me"), other:rect(".player-card:not(.me)"), die:rect("#diceBar .die"), roll:rect("#rollBtnInline"), announce:rect("#announceBtnInline"), cell:rect(".player-card.me td.cell[data-row='1'][data-field='free']") };
        });
        expect(boxes.sheet.width).toBeGreaterThan(viewport.width * .42);
        expect(boxes.sheet.right).toBeLessThan(boxes.other.x);
        expect(boxes.other.right).toBeLessThanOrEqual(viewport.width);
        expect(boxes.cell.height).toBeGreaterThan(0);
        expect(boxes.die.width).toBeGreaterThanOrEqual(44);
        expect(boxes.die.width).toBeLessThanOrEqual(60);
        expect(boxes.roll.height).toBeGreaterThanOrEqual(48);
        expect(boxes.roll.x + boxes.roll.width / 2).toBeGreaterThan(viewport.width * .78);
        expect(boxes.announce.x).toBeLessThan(viewport.width * .1);
        expect(boxes.roll.y).toBeGreaterThan(viewport.height * .75);
        await expectCompleteScoreSheet(page, ".player-card.me .table-wrap", {
          minWritableRowHeight:viewport.height >= 1180 ? 38 : 21.25,
          minFixedRowHeight:14,
          minFontSize:theme === "classic" && viewport.height < 1180 ? 11.8 : 12,
        });
        await expect(page.locator(".player-card.me .tablet-sheet-scroll-hint")).toHaveCount(0);
        const lastRow = page.locator(".player-card.me table.grid tbody tr:last-child");
        await expect(lastRow).toBeInViewport();
        const lastWritable = page.locator(".player-card.me td.cell[data-row='15'][data-field='free']");
        await expectReachable(page, ".player-card.me td.cell[data-row='15'][data-field='free']");
        await expectReachable(page, ".player-card.me table.grid thead th:nth-child(2)");
        await expectReachable(page, "#rollBtnInline");
        await page.screenshot({ path:testInfo.outputPath(`${theme}-${viewport.width}x${viewport.height}.png`) });
      }
      await page.locator("#diceBar .die").first().tap();
      await expect.poll(() => server.actions.some(action => action.action === "set_hold")).toBe(true);
      await page.locator("#announceBtnInline").tap();
      await expect(page.locator("#mobileAnnouncePicker")).toBeVisible();
      await expectReachable(page, ".mobile-announce-option[data-field='poker']");
      await page.locator(".mobile-announce-option[data-field='poker']").tap();
      await expect.poll(() => server.actions.some(action => action.action === "announce_row4" && action.field === "poker")).toBe(true);
      server.push({ ...initial, _rolls_used:0, _turn:{ player_id:"p2", roll_index:0 }, _has_last:{ p1:true }, _can_request_correction:{ p1:true } });
      await expectReachable(page, "#requestCorrectionBtn");
      await page.locator("#requestCorrectionBtn").tap();
      await expect.poll(() => server.actions.some(action => action.action === "request_correction")).toBe(true);
      await page.locator("#roomHeaderMenuToggle").tap();
      await page.locator("#rulesSheetOpen").tap();
      await expectReachable(page, "#rulesSheetClose");
      await page.locator("#rulesSheetClose").tap();
      await page.locator("#chatToggle").tap();
      await page.locator("#chatInput").fill("Tablet chat draft");
      await page.setViewportSize({ width:1024, height:520 });
      await expectReachable(page, "#chatInput");
      await expectReachable(page, "#chatSend");
      await expect(page.locator("#chatInput")).toHaveValue("Tablet chat draft");
    } finally { await context.close(); }
  });

  test(`ZDWA tablet ${theme}: complete portrait sheets fit with PWA safe areas and team headings`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport:{ width:820, height:1180 }, isMobile:true, hasTouch:true, serviceWorkers:"block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
    const page = await context.newPage();
    try {
      const server = await fixture(page, snapshot());
      await page.addStyleTag({ content:"body.room-page { --room-safe-top:24px; --room-safe-bottom:20px; }" });
      for (const mode of ["2", "2v2"]) {
        if (mode === "2v2") server.push(snapshot(4, mode));
        await expect(page.locator(".player-card")).toHaveCount(2);
        await expect(page.locator(".tablet-sheet-scroll-hint")).toHaveCount(0);
        for (const card of await page.locator(".player-card").all()) {
          await expectCompleteScoreSheet(page, `.player-card[data-board-id='${await card.getAttribute("data-board-id")}'] .table-wrap`, {
            minWritableRowHeight:38,
            minFixedRowHeight:14,
            minFontSize:12,
          });
          await expect(card.locator("table.grid tbody tr:last-child")).toBeInViewport();
          // WebKit rounds the table's last border to a fractional pixel;
          // verify the actual bottom edge with one physical CSS pixel slack.
          expect(await card.evaluate(element => {
            const last = element.querySelector("table.grid tbody tr:last-child").getBoundingClientRect();
            const sheet = element.querySelector(".table-wrap").getBoundingClientRect();
            return last.bottom - sheet.bottom;
          })).toBeLessThanOrEqual(1);
          expect(await card.locator("td.cell[data-row='15'][data-field='free']").evaluate(cell => cell.getBoundingClientRect().height)).toBeGreaterThan(0);
        }
        await expectReachable(page, "#rollBtnInline");
        await expectReachable(page, "#chatToggle");
        await page.screenshot({ path:testInfo.outputPath(`${theme}-${mode}-pwa.png`) });
      }
    } finally { await context.close(); }
  });
}

test("ZDWA tablet solo guide follows sheet progress and disappears on phones", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport:sizes[0], isMobile:true, hasTouch:true, serviceWorkers:"block" });
  await context.addInitScript(() => localStorage.setItem("zdwa_language", "en"));
  const page = await context.newPage();
  try {
    const initial = snapshot(1);
    const server = await fixture(page, initial);
    await expect(page.locator(".tablet-column-guide article")).toHaveCount(4);
    await expect(page.locator(".tablet-column-guide h2")).toHaveText("Your four columns");
    await expect(page.locator(".tablet-column-guide article b").first()).toHaveText("11");
    const next = structuredClone(initial);
    next._scoreboards.p1["1,down"] = 4;
    server.push(next);
    await expect(page.locator(".tablet-column-guide article b").first()).toHaveText("10");
    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      await expectReachable(page, "#rollBtnInline");
      await expectReachable(page, "#chatToggle");
      const guide = await page.locator(".tablet-column-guide").boundingBox();
      const sheet = await page.locator(".player-card.me").boundingBox();
      expect(guide.x).toBeGreaterThan(sheet.x + sheet.width);
      expect(guide.x + guide.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path:testInfo.outputPath(`solo-${viewport.width}x${viewport.height}.png`) });
    }
    for (const viewport of [{ width:440, height:956 }, { width:956, height:440 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator(".tablet-column-guide")).toHaveCount(0);
      await expect(page.locator(".tablet-board-navigation")).toHaveCount(0);
      expect(await page.evaluate(query => matchMedia(query).matches, TABLET)).toBe(false);
      await expectReachable(page, "#rollBtnInline");
    }
    await page.setViewportSize(sizes[0]);
    await expect(page.locator(".tablet-column-guide article b").first()).toHaveText("10");
    server.push({ ...next, _hardcore:true });
    await expect(page.locator(".tablet-column-guide article p").last()).toHaveText("Any order");
  } finally { await context.close(); }
});

test("ZDWA tablet four-player sheets can be reached without shrinking targets; team sheets stay side by side", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport:sizes[1], isMobile:true, hasTouch:true, serviceWorkers:"block" });
  const page = await context.newPage();
  try {
    const server = await fixture(page, snapshot(4));
    await expectReachable(page, ".tablet-board-navigation button:last-child");
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("1–2 / 4");
    await page.locator(".tablet-board-navigation button:last-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("2–3 / 4");
    await page.locator(".tablet-board-navigation button:last-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("3–4 / 4");
    await expect(page.locator(".tablet-board-navigation button:last-child")).toBeDisabled();
    await expect(page.locator(".player-card[data-board-id='p4'] .pc-head")).toBeInViewport();
    await page.screenshot({ path:testInfo.outputPath("four-player.png") });
    const sheetScroll = await page.locator(".players-grid").evaluate(grid => grid.scrollLeft);
    server.push(snapshot(4));
    await expect(page.locator(".players-grid")).toHaveJSProperty("scrollLeft", sheetScroll);
    await page.locator(".tablet-board-navigation button:first-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("2–3 / 4");
    await page.locator(".tablet-board-navigation button:first-child").tap();
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("1–2 / 4");
    const nextTurn = snapshot(4);
    nextTurn._scoreboards.p1["1,down"] = 4;
    nextTurn._turn = { player_id:"p4", roll_index:0 };
    nextTurn._rolls_used = 0;
    server.push(nextTurn);
    await expect(page.locator(".tablet-board-navigation span")).toHaveText("3–4 / 4");
    server.push(snapshot(4, "2v2"));
    await expect(page.locator(".player-card")).toHaveCount(2);
    await expect(page.locator(".tablet-board-navigation")).toHaveCount(0);
    await expect(page.locator(".pc-members")).toHaveCount(2);
    await expectReachable(page, "#rollBtnInline");
  } finally { await context.close(); }
});
