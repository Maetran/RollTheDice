const { test, expect } = require("@playwright/test");
const { expectFixedTable, expectReachable } = require("./table-viewport");

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
      for (const viewport of [{ width: 440, height: 956 }, { width: 390, height: 844 }, { width: 320, height: 480 }, { width: 844, height: 390 }, { width: 1024, height: 1366 }]) {
        await page.setViewportSize(viewport);
        await expectFixedTable(page, [".room-header", ".players-grid", ".topbar"]);
        await expectReachable(page, "#rollBtnInline");
        await expectReachable(page, "#announceBtnInline");
        const lastRow = page.locator(".player-card.me table.grid tbody tr:last-child");
        await lastRow.scrollIntoViewIfNeeded();
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
      expect(readingPosition).toBeGreaterThan(50);
      const beforeHold = snapshots;
      await page.locator("#diceBar .die").first().click();
      await expect.poll(() => snapshots).toBeGreaterThan(beforeHold);
      await expect(page.locator("#diceBar .die").first()).toHaveAttribute("aria-pressed", "true");
      // The server replaces the sheet during the hold response. A one-shot
      // evaluate can retain the detached old node, whose scrollTop is zero.
      await expect(sheet).toHaveJSProperty("scrollTop", readingPosition);
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
