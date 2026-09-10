const { test, expect } = require("@playwright/test");

const CLASSIC_FONT = /\/static\/[^/?]*classic[^/?]*\.woff2(?:\?.*)?$/;
const HANDWRITING = "ZDWA Classic Hand";

test.describe.configure({ mode: "parallel" });
test.use({ serviceWorkers: "block" });

async function createGame(request, mode = 1) {
  const response = await request.post("/api/games", {
    data: { name: "Classic refinement regression", mode },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).game_id;
}

async function setClassic(context) {
  await context.addInitScript(() => localStorage.setItem("wuerfler_theme", "classic"));
}

async function enterRoom(page, gameId, name = "Anna") {
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=${name}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".player-card.me table.grid")).toBeVisible();
  await expect(page.locator("#diceBar button.die")).toHaveCount(5);
}

function luminance(value) {
  const components = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return components[0] * 0.2126 + components[1] * 0.7152 + components[2] * 0.0722;
}

function contrast(ink, surface) {
  const values = [luminance(ink), luminance(surface)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

async function paint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

test("Classic ships its handwriting locally and softens paper without sacrificing readable ink", async ({ page, context, request }, testInfo) => {
  await setClassic(context);
  const fontRequests = [];
  page.on("response", response => {
    if (CLASSIC_FONT.test(response.url())) fontRequests.push({ url: response.url(), status: response.status() });
  });
  await enterRoom(page, await createGame(request));
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() => {
    const paper = document.querySelector(".player-card.me .table-wrap");
    const cell = document.querySelector(".player-card.me td.cell");
    const button = document.querySelector("#roomHeaderMenuToggle");
    return {
      paper: getComputedStyle(paper).backgroundColor,
      ink: getComputedStyle(cell).color,
      font: getComputedStyle(cell).fontFamily,
      buttonInk: getComputedStyle(button).color,
      buttonPaper: getComputedStyle(button).backgroundColor,
      faces: [...document.fonts].map(face => ({ family: face.family, status: face.status, display: face.display })),
      externalFontRequests: performance.getEntriesByType("resource").filter(entry => /\.(?:woff2?|ttf)(?:\?|$)/.test(entry.name) && new URL(entry.name).origin !== location.origin).map(entry => entry.name),
    };
  });
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const font of fontRequests) {
    expect(font.status).toBe(200);
    expect(new URL(font.url).searchParams.get("v")).toMatch(/^[a-f0-9]{8,}$/);
  }
  expect(styles.font).toContain(HANDWRITING);
  expect(styles.faces).toEqual(expect.arrayContaining([
    expect.objectContaining({ family: expect.stringContaining(HANDWRITING), status: "loaded", display: "optional" }),
  ]));
  expect(styles.externalFontRequests).toEqual([]);
  expect(luminance(styles.paper)).toBeLessThan(luminance("rgb(255, 247, 229)") * 0.85);
  expect(contrast(styles.ink, styles.paper)).toBeGreaterThanOrEqual(4.5);
  expect(contrast(styles.buttonInk, styles.buttonPaper)).toBeGreaterThanOrEqual(4.5);
  await testInfo.attach("classic-paper-and-font.json", { body: JSON.stringify(styles, null, 2), contentType: "application/json" });
  await testInfo.attach("classic-desktop.png", { body: await page.screenshot({ path: testInfo.outputPath("classic-desktop.png") }), contentType: "image/png" });
  for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator("#roomHeaderMenuToggle").click();
    await page.locator("#rankLegendSheetOpen").click();
    await expect(page.locator(".rank-legend-title").first()).toBeVisible();
    const legend = await page.locator(".rank-legend-title, .rank-legend-minimum").evaluateAll(elements => elements.map(element => ({
      text: element.textContent,
      font: getComputedStyle(element).fontFamily,
      width: element.clientWidth,
      contentWidth: element.scrollWidth,
    })));
    for (const label of legend) {
      expect(label.font).toContain(HANDWRITING);
      expect(label.contentWidth, label.text).toBeLessThanOrEqual(label.width + 1);
    }
    const screenshotName = `classic-legend-${viewport.width}x${viewport.height}.png`;
    await testInfo.attach(screenshotName, { body: await page.screenshot({ path: testInfo.outputPath(screenshotName) }), contentType: "image/png" });
    await page.locator("#rankLegendSheetClose").click();
  }
});

test("Classic remains visible with a blocked font and does not jump when it finally arrives", async ({ browser, baseURL, request }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await setClassic(context);
  const page = await context.newPage();
  let releaseFont;
  const gate = new Promise(resolve => { releaseFont = resolve; });
  let requested = false;
  let completed = false;
  await page.addInitScript(() => {
    window.__classicShifts = [];
    window.__classicFirstTable = null;
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__classicShifts.push({ time: entry.startTime, value: entry.value });
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
    const inspect = () => {
      if (document.querySelector(".player-card.me table.grid")?.getBoundingClientRect().height) {
        window.__classicFirstTable = performance.now();
      } else requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
  await page.route(CLASSIC_FONT, async route => {
    requested = true;
    await gate;
    await route.continue();
    completed = true;
  });
  try {
    await enterRoom(page, await createGame(request));
    await expect.poll(() => requested).toBe(true);
    await expect.poll(() => page.evaluate(() => window.__classicFirstTable)).not.toBeNull();
    expect(await page.evaluate(() => window.__classicFirstTable)).toBeLessThan(2000);
    expect(completed).toBe(false);
    // This is intentionally longer than font-display's short block period.
    await page.waitForTimeout(1200);
    await paint(page);
    const positions = () => page.evaluate(() => [
      ".player-card.me .pc-name", ".player-card.me .table-wrap", "#roomHeaderMenuToggle", "#rollBtnInline",
    ].map(selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { selector, x, y, width, height };
    }));
    const before = await positions();
    const releaseTime = await page.evaluate(() => performance.now());
    releaseFont();
    await expect.poll(() => completed).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await paint(page);
    const after = await positions();
    for (let index = 0; index < before.length; index += 1) {
      for (const axis of ["x", "y", "width", "height"]) {
        expect(Math.abs(after[index][axis] - before[index][axis]), `${before[index].selector}: late font ${axis}`).toBeLessThan(1);
      }
    }
    const shifts = await page.evaluate(time => window.__classicShifts.filter(entry => entry.time >= time), releaseTime);
    expect(shifts.reduce((total, shift) => total + shift.value, 0)).toBeLessThan(0.01);
    await testInfo.attach("classic-delayed-font.json", { body: JSON.stringify({ before, after, shifts }, null, 2), contentType: "application/json" });
  } finally {
    releaseFont();
    await context.close();
  }
});

test("Classic felt covers coarse-pointer landscape and tablets while the pad stays on top", async ({ browser, baseURL, request }, testInfo) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 }, serviceWorkers: "block" });
  await setClassic(context);
  const page = await context.newPage();
  try {
    await enterRoom(page, await createGame(request));
    for (const viewport of [{ width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const surfaces = await page.evaluate(() => {
        const inspect = selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return { selector, color: style.backgroundColor, image: style.backgroundImage };
        };
        return {
          coarse: matchMedia("(pointer: coarse)").matches,
          surfaces: ["body", ".room-header", ".topbar", "#diceBar", ".player-card.me"].map(inspect),
          paper: inspect(".player-card.me .table-wrap"),
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
        };
      });
      expect(surfaces.coarse).toBe(true);
      for (const surface of surfaces.surfaces) {
        expect(surface.image, surface.selector).toContain("data:image/svg+xml");
        expect(surface.image, surface.selector).not.toContain("repeating-linear-gradient");
        expect(surface.color, surface.selector).toBe(surfaces.surfaces[0].color);
      }
      expect(surfaces.paper.color).not.toBe(surfaces.surfaces[0].color);
      expect(surfaces.width).toBeLessThanOrEqual(surfaces.viewport + 1);
      const screenshotName = `classic-felt-${viewport.width}x${viewport.height}.png`;
      await testInfo.attach(screenshotName, { body: await page.screenshot({ path: testInfo.outputPath(screenshotName) }), contentType: "image/png" });
    }
  } finally {
    await context.close();
  }
});

test("real multiplayer correction and final score remain reachable on short Classic screens", async ({ browser, baseURL, request }, testInfo) => {
  const firstContext = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const secondContext = await browser.newContext({ baseURL, serviceWorkers: "block" });
  await setClassic(firstContext);
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();
  try {
    const gameId = await createGame(request, 2);
    await enterRoom(first, gameId, "Anna");
    await enterRoom(second, gameId, "Ben");
    await expect(first.locator("#rollBtnInline")).toBeEnabled();
    await first.locator("#rollBtnInline").click();
    // Any face on the genuine random roll yields positive points in its own
    // numbered free-column cell, avoiding a synthetic score or strike dialog.
    await expect(first.locator("#diceBar .die.shaking")).toHaveCount(0);
    const face = await first.locator("#diceBar .die svg").first().locator("circle").count();
    expect(face).toBeGreaterThanOrEqual(1);
    expect(face).toBeLessThanOrEqual(6);
    const target = first.locator(`.player-card.me td.cell[data-row="${face - 1}"][data-field="free"]`);
    await expect(target).toHaveClass(/clickable/);
    await target.click();
    await expect(first.locator("#requestCorrectionBtn")).toBeEnabled();
    await expect(target).not.toHaveText("");
    await expect(second.locator("#rollBtnInline")).toBeEnabled();

    for (const viewport of [{ width: 320, height: 480 }, { width: 390, height: 480 }, { width: 844, height: 390 }]) {
      await first.setViewportSize(viewport);
      await first.locator("#requestCorrectionBtn").scrollIntoViewIfNeeded();
      await expect(first.locator("#requestCorrectionBtn")).toBeInViewport();
      const correction = await first.locator("#requestCorrectionBtn").evaluate(button => {
        const box = button.getBoundingClientRect();
        const middle = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return { top: box.top, bottom: box.bottom, height: innerHeight, clickable: button.contains(middle) };
      });
      expect(correction.top).toBeGreaterThanOrEqual(0);
      expect(correction.bottom).toBeLessThanOrEqual(correction.height);
      expect(correction.clickable).toBe(true);
      const lastScore = first.locator(".player-card.me table.grid tbody tr:last-child");
      await lastScore.scrollIntoViewIfNeeded();
      await first.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      const row = await lastScore.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const dock = document.querySelector(".topbar");
        const fixed = ["fixed", "sticky"].includes(getComputedStyle(dock).position);
        const dockBox = dock.getBoundingClientRect();
        const visible = Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
        return { bottom: bounds.bottom, visible, coveredFrom: fixed ? dockBox.top : innerHeight };
      });
      expect(row.visible).toBeGreaterThan(5);
      expect(row.bottom).toBeLessThanOrEqual(row.coveredFrom - 4);
      const screenshotName = `classic-real-correction-${viewport.width}x${viewport.height}.png`;
      await testInfo.attach(screenshotName, { body: await first.screenshot({ path: testInfo.outputPath(screenshotName) }), contentType: "image/png" });
    }
    // The real server accepts the visible action, rather than a test-created
    // element merely fitting into the available CSS space.
    await first.locator("#requestCorrectionBtn").click();
    await expect(first.locator("#requestCorrectionBtn")).toBeHidden();
    await expect(second.locator("#rollBtnInline")).toBeDisabled();
  } finally {
    await secondContext.close();
    await firstContext.close();
  }
});

test("Classic refinements and font downloads stay out of Light, Dark, and Zilch", async ({ browser, baseURL }) => {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
    await context.addInitScript(value => localStorage.setItem("wuerfler_theme", value), theme);
    const page = await context.newPage();
    const fonts = [];
    page.on("request", request => { if (CLASSIC_FONT.test(request.url())) fonts.push(request.url()); });
    try {
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily)).not.toContain(HANDWRITING);
      expect(fonts).toEqual([]);
      await page.evaluate(() => {
        localStorage.setItem("wuerfler_theme", "classic");
        localStorage.setItem("zilch_theme", "lcars");
      });
      await page.goto("/zilch/anmelden");
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
      expect(await page.locator("body").evaluate(element => getComputedStyle(element).fontFamily)).not.toContain(HANDWRITING);
      expect(fonts).toEqual([]);
    } finally {
      await context.close();
    }
  }
});

test("Classic varies pen lines and polished dice patina while holds and focus stay clear", async ({ page, context, request }, testInfo) => {
  await setClassic(context);
  let scoreFrames = 0;
  page.on("websocket", socket => socket.on("framereceived", frame => {
    if (JSON.parse(frame.payload).scoreboard) scoreFrames += 1;
  }));
  await enterRoom(page, await createGame(request));
  await page.locator("#rollBtnInline").click();
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
  const dice = page.locator("#diceBar .die");
  const appearance = await dice.evaluateAll(elements => elements.map(die => ({
    face: getComputedStyle(die.querySelector("svg rect")).fill,
    pips: getComputedStyle(die.querySelector("svg g")).fill,
    patina: getComputedStyle(die, "::before").backgroundImage,
    patinaEvents: getComputedStyle(die, "::before").pointerEvents,
    filter: getComputedStyle(die.querySelector("svg g")).filter,
  })));
  expect(new Set(appearance.map(die => die.face)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(appearance.map(die => die.patina)).size).toBeGreaterThanOrEqual(3);
  for (const die of appearance) {
    expect(die.patina).toContain("radial-gradient");
    expect(die.patinaEvents).toBe("none");
    expect(die.filter).toBe("none");
    expect(contrast(die.pips, die.face)).toBeGreaterThanOrEqual(4.5);
  }
  const lines = await page.locator(".player-card.me table.grid td.cell").evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundImage));
  expect(new Set(lines).size).toBeGreaterThanOrEqual(3);
  const firstDie = dice.first();
  let framesBeforeHold = scoreFrames;
  await firstDie.click();
  await expect.poll(() => scoreFrames).toBeGreaterThan(framesBeforeHold);
  await expect(firstDie).toHaveAttribute("aria-pressed", "true");
  await expect(firstDie).toHaveClass(/held/);
  await expect(dice).toHaveCount(5);
  framesBeforeHold = scoreFrames;
  await firstDie.click();
  await expect.poll(() => scoreFrames).toBeGreaterThan(framesBeforeHold);
  await expect(firstDie).toHaveAttribute("aria-pressed", "false");
  // Set keyboard modality before focusing; Safari's default Tab order skips
  // buttons unless Full Keyboard Access is enabled in the host OS.
  await page.keyboard.press("Tab");
  await firstDie.focus();
  const focus = await firstDie.evaluate(die => {
    const style = getComputedStyle(die);
    return { active: die === document.activeElement, width: parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focus).toMatchObject({ active: true, style: "solid" });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Tab");
  await page.locator("#roomHeaderMenuToggle").focus();
  const headerFocus = await page.locator("#roomHeaderMenuToggle").evaluate(button => {
    const style = getComputedStyle(button);
    return {
      active: button === document.activeElement,
      color: style.outlineColor,
      width: parseFloat(style.outlineWidth),
      style: style.outlineStyle,
      felt: getComputedStyle(document.querySelector(".room-header")).backgroundColor,
    };
  });
  expect(headerFocus).toMatchObject({ active: true, style: "solid" });
  expect(headerFocus.width).toBeGreaterThanOrEqual(2);
  expect(contrast(headerFocus.color, headerFocus.felt)).toBeGreaterThanOrEqual(3);
  await testInfo.attach("classic-patina-and-pen.json", { body: JSON.stringify({ appearance, lines, focus, headerFocus }, null, 2), contentType: "application/json" });
  await testInfo.attach("classic-dice.png", { body: await page.locator("#diceBar").screenshot({ path: testInfo.outputPath("classic-dice.png") }), contentType: "image/png" });
});
