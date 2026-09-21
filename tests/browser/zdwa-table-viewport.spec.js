const { test, expect } = require("@playwright/test");
const { expectFixedTable, expectReachable, expectCompleteScoreSheet } = require("./table-viewport");

for (const theme of ["light", "dark", "classic"]) {
  test(`ZDWA ${theme} keeps its table fixed and every score reachable across device sizes`, async ({ browser, baseURL, request }, testInfo) => {
    const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 440, height: 956 }, serviceWorkers: "block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
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
