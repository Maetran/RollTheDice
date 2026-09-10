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
  expect(lobbyLook.handwriting).toContain("ZDWA Classic Hand");
  expect(lobbyLook.font).toContain("ZDWA Classic Hand");

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
  expect(roomLook.felt).toContain("data:image/svg+xml");
  expect(roomLook.felt).not.toContain("repeating-linear-gradient");
  expect(roomLook.feltShadow).toContain("inset");
  expect(roomLook.dieFill).not.toBe("rgb(255, 255, 255)");
  expect(roomLook.dieStroke).not.toBe("rgb(0, 0, 0)");
  expect(roomLook.scoreMat).toContain("radial-gradient");
  expect(roomLook.scoreMat).toContain("data:image/svg+xml");
  expect(roomLook.scoreMatColor).toBe(roomLook.feltColor);
  expect(roomLook.scorePaperColor).not.toBe("rgb(255, 247, 229)");
  expect(roomLook.scoreSheetFont).toContain("ZDWA Classic Hand");
  expect(roomLook.scoreSheetNumbers).toBe("normal");
  expect(roomLook.scoreLineImage).toContain("data:image/svg+xml");

  // The announced (❗) column is the final table header. Its paper wash must
  // match the three score-column headers rather than losing the gradient to a
  // last-column body-cell edge treatment.
  const scoreHeaders = page.locator(
    ".player-card.me table.grid > thead > tr > th:not(.sticky)",
  );
  const headerBackgrounds = await scoreHeaders.evaluateAll((headers) =>
    headers.map((header) => {
      const style = getComputedStyle(header);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
      };
    }),
  );
  expect(headerBackgrounds).toHaveLength(4);
  for (const otherHeader of headerBackgrounds.slice(0, 3)) {
    expect(headerBackgrounds[3]).toEqual(otherHeader);
  }

  // The separate refinement spec exercises an actual two-guest correction,
  // including a legal roll/write and the resulting real server-owned action.
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
    expect(mobileLook.canvasColor).toBe(roomLook.feltColor);
    expect(mobileLook.canvasTexture).toContain("data:image/svg+xml");
    expect(mobileLook.headerColor).toBe(roomLook.feltColor);
    expect(mobileLook.dockColor).toBe(roomLook.feltColor);
    expect(mobileLook.headerBackdrop).toBe("none");
    expect(mobileLook.feedbackColor).toBe("rgb(233, 220, 192)");
  }
});
