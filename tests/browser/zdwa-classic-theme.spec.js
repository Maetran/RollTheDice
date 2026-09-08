const { test, expect } = require("@playwright/test");

test("ZDWA cycles and retains Light, Dark, and Classic without changing game UI semantics", async ({ page, request }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem("wuerfler_theme")) localStorage.setItem("wuerfler_theme", "light");
  });

  await page.goto("/");
  const html = page.locator("html");
  const appearance = page.locator("[data-theme-toggle]").first();

  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(appearance).toHaveAttribute("data-theme-current", "light");
  await expect(appearance).toHaveAttribute(
    "aria-label",
    "Darstellung wechseln: Hell. Nächstes Design: Dunkel.",
  );

  await appearance.click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await expect(appearance).toHaveAttribute("data-theme-current", "dark");

  await appearance.click();
  await expect(html).toHaveAttribute("data-theme", "classic");
  await expect(appearance).toHaveAttribute("data-theme-current", "classic");
  await expect(appearance).toHaveAttribute(
    "aria-label",
    "Darstellung wechseln: Classic. Nächstes Design: Hell.",
  );
  await expect.poll(() => page.evaluate(() => localStorage.getItem("wuerfler_theme"))).toBe("classic");

  const lobbyLook = await page.evaluate(() => ({
    paper: getComputedStyle(document.body).backgroundImage,
    font: getComputedStyle(document.body).fontFamily,
    handwriting: getComputedStyle(document.documentElement).getPropertyValue("--classic-handwriting"),
  }));
  expect(lobbyLook.paper).toContain("radial-gradient");
  expect(lobbyLook.handwriting).toContain("Bradley Hand");
  expect(lobbyLook.font).toContain("Bradley Hand");

  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "classic");
  await page.evaluate(async () => {
    await window.ZDWA_I18N.setLanguage("en", { persist: false, reload: false });
    window.ZDWA_I18N.translateElement(document.body);
  });
  await appearance.click();
  await expect(html).toHaveAttribute("data-theme", "light");
  await expect(appearance).toHaveAttribute(
    "aria-label",
    "Change appearance: Light. Next design: Dark.",
  );

  await page.evaluate(() => localStorage.setItem("wuerfler_theme", "classic"));
  const created = await request.post("/api/games", {
    data: { name: "Classic table", mode: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const { game_id: gameId } = await created.json();

  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Classic`);
  await page.waitForSelector("#diceBar .dice-row > button.die");
  await expect(html).toHaveAttribute("data-theme", "classic");
  await page.locator("#roomHeaderMenuToggle").click();
  const roomAppearance = page.locator("#roomHeaderMenuPanel [data-theme-toggle]");
  await expect(roomAppearance).toHaveAttribute("data-theme-current", "classic");

  const roomLook = await page.evaluate(() => {
    const diceBar = getComputedStyle(document.querySelector("#diceBar"));
    const dieFace = getComputedStyle(document.querySelector("#diceBar .dice-row > button.die svg rect"));
    const scoreMat = getComputedStyle(document.querySelector(".player-card.me"));
    const scorePaper = getComputedStyle(document.querySelector(".player-card.me .table-wrap"));
    const scoreSheet = getComputedStyle(document.querySelector(".player-card.me .table-wrap > table.grid"));
    const scoreCell = document.querySelector(".player-card.me .table-wrap > table.grid td");
    const scoreLine = getComputedStyle(scoreCell);
    return {
      felt: diceBar.backgroundImage,
      feltColor: diceBar.backgroundColor,
      feltShadow: diceBar.boxShadow,
      dieFill: dieFace.fill,
      dieStroke: dieFace.stroke,
      scoreMat: scoreMat.backgroundImage,
      scoreMatColor: scoreMat.backgroundColor,
      scorePaperColor: scorePaper.backgroundColor,
      scoreSheetFont: scoreSheet.fontFamily,
      scoreSheetNumbers: scoreSheet.fontVariantNumeric,
      scoreInk: scoreLine.color,
      scoreLineImage: scoreLine.backgroundImage,
    };
  });
  expect(roomLook.felt).toContain("radial-gradient");
  expect(roomLook.felt).toContain("repeating-linear-gradient");
  expect(roomLook.feltColor).toBe("rgb(10, 91, 74)");
  expect(roomLook.feltShadow).toContain("inset");
  expect(roomLook.dieFill).toBe("rgb(246, 233, 201)");
  expect(roomLook.dieStroke).not.toBe("rgb(0, 0, 0)");
  expect(roomLook.scoreMat).toContain("radial-gradient");
  expect(roomLook.scoreMat).toContain("repeating-linear-gradient");
  expect(roomLook.scoreMatColor).toBe("rgb(10, 91, 74)");
  expect(roomLook.scorePaperColor).toBe("rgb(255, 247, 229)");
  expect(roomLook.scoreSheetFont).toContain("Noteworthy");
  expect(roomLook.scoreSheetNumbers).toBe("normal");
  expect(roomLook.scoreInk).toBe("rgb(18, 61, 117)");
  expect(roomLook.scoreLineImage).toContain("data:image/svg+xml");
  expect(roomLook.scoreLineImage).toContain("%23174a8b");

  // A multiplayer correction adds a real second row to the mobile action dock.
  // The same responsive state must reserve enough space above chat and keep the
  // final score row reachable on short screens.
  for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 480 }]) {
    await page.setViewportSize(viewport);
    const mobileLook = await page.evaluate(() => {
      const canvas = getComputedStyle(document.body);
      const header = getComputedStyle(document.querySelector(".room-header"));
      const dock = getComputedStyle(document.querySelector(".topbar"));
      const feedback = getComputedStyle(document.querySelector("#actionFeedback"));
      return {
        canvasColor: canvas.backgroundColor,
        canvasTexture: canvas.backgroundImage,
        headerColor: header.backgroundColor,
        dockColor: dock.backgroundColor,
        headerBackdrop: header.backdropFilter,
        feedbackColor: feedback.color,
      };
    });
    expect(mobileLook.canvasColor).toBe("rgb(10, 91, 74)");
    expect(mobileLook.canvasTexture).toContain("repeating-linear-gradient");
    expect(mobileLook.headerColor).toBe("rgb(10, 91, 74)");
    expect(mobileLook.dockColor).toBe("rgb(10, 91, 74)");
    expect(mobileLook.headerBackdrop).toBe("none");
    expect(mobileLook.feedbackColor).toBe("rgb(255, 244, 215)");

    const geometry = await page.locator(".dice-actions").evaluate((actions) => {
      actions.querySelector("#requestCorrectionBtn")?.remove();
      const button = document.createElement("button");
      button.id = "requestCorrectionBtn";
      button.className = "small";
      button.textContent = "Letzten Eintrag ändern";
      actions.append(button);
      const cssLength = (token) => {
        const probe = document.createElement("div");
        probe.style.cssText = `position:absolute; height:var(${token}); visibility:hidden;`;
        document.body.append(probe);
        const height = probe.getBoundingClientRect().height;
        probe.remove();
        return height;
      };
      const box = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      };
      return {
        correction: box("#requestCorrectionBtn"),
        dock: box(".topbar"),
        safeBottom: window.innerHeight - cssLength("--mobile-chatbar-h") - cssLength("--mobile-action-gap"),
      };
    });
    expect(geometry.correction.bottom).toBeLessThanOrEqual(geometry.dock.bottom - 8);
    expect(geometry.correction.bottom).toBeLessThanOrEqual(geometry.safeBottom - 8);
  }

  const finalRow = await page.locator(".dice-actions").evaluate((actions) => {
    if (!actions.querySelector("#requestCorrectionBtn")) {
      const button = document.createElement("button");
      button.id = "requestCorrectionBtn";
      button.className = "small";
      button.textContent = "Letzten Eintrag ändern";
      actions.append(button);
    }
    window.scrollTo(0, document.documentElement.scrollHeight);
    const row = document.querySelector(".player-card.me table.grid tbody tr:last-child").getBoundingClientRect();
    const dock = document.querySelector(".topbar").getBoundingClientRect();
    return { bottom: row.bottom, coveredFrom: dock.top };
  });
  expect(finalRow.bottom).toBeLessThanOrEqual(finalRow.coveredFrom - 4);
});
