const { test, expect } = require("@playwright/test");

// Design 2026 "Retro" is the Classic theme on the 2026 layout: paper score
// sheet with brass point previews and a felt dice dock, drawn in Classic's
// handwriting, ink, felt and ivory dice (frontend/styles/design-2026/retro.css).
const HANDWRITING = "ZDWA Classic Hand";
const FELT_TEXTURE = "data:image/svg+xml";

test.describe.configure({ mode: "parallel" });
test.use({ serviceWorkers: "block" });

async function createGame(request) {
  const response = await request.post("/api/games", { data: { name: "Retro design regression", mode: 1 } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).game_id;
}

async function useRetro(context) {
  await context.addInitScript(() => {
    localStorage.setItem("wuerfler_theme", "classic");
    localStorage.removeItem("zdwa_design_override");
  });
}

async function enterRoom(page, gameId) {
  await page.goto(`/spiel/${encodeURIComponent(gameId)}?name=Retro`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".player-card.me table.grid")).toBeVisible();
  await expect(page.locator("#diceBar button.die")).toHaveCount(5);
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "classic");
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

// Keyboard focus on a control in the felt dock, measured against the felt
// (the outline sits outside the control, on the dock). Pressing Tab first sets
// keyboard modality, so the programmatic focus is :focus-visible. A resize
// can re-render the dock right after focusing, so focus again until it holds.
async function dockFocus(page, selector) {
  const control = page.locator(selector);
  let focus;
  await expect.poll(async () => {
    await page.keyboard.press("Tab");
    await control.focus();
    focus = await control.evaluate(element => {
      const style = getComputedStyle(element);
      return {
        visible: element.matches(":focus-visible"),
        style: style.outlineStyle,
        width: parseFloat(style.outlineWidth),
        color: style.outlineColor,
        felt: getComputedStyle(element.closest(".topbar")).backgroundColor,
      };
    });
    return focus.visible;
  }).toBe(true);
  return focus;
}

function expectReadableDockFocus(focus) {
  expect(focus).toMatchObject({ visible: true, style: "solid" });
  expect(focus.width).toBeGreaterThanOrEqual(2);
  // Felt brass of the held dice, not the darker paper brass (1.7:1 on felt).
  expect(focus.color).toBe("rgb(227, 181, 82)");
  expect(contrast(focus.color, focus.felt)).toBeGreaterThanOrEqual(3);
}

test("Retro lobby marks the chosen tile clearly and keeps the Hardcore fill", async ({ page, context }) => {
  await useRetro(context);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  const normal = page.locator(".mode-hardcore-row .choice-button:not(.hardcore-choice)");
  const hardcore = page.locator(".mode-hardcore-row .choice-button.hardcore-choice");
  await expect(normal).toHaveAttribute("aria-checked", "true");
  const tile = locator => locator.evaluate(element => {
    const style = getComputedStyle(element);
    return { fill: style.backgroundColor, edge: style.borderTopColor };
  });
  const chosen = await tile(normal);
  const open = await tile(hardcore);
  // The chosen sheet and its felt ring stand apart from the open paper slips
  // by more than hue: as in Light, the edges differ by at least 3:1.
  expect(contrast(chosen.edge, open.edge)).toBeGreaterThanOrEqual(3);
  expect(contrast(chosen.fill, open.fill)).toBeGreaterThanOrEqual(1.2);

  await hardcore.click();
  await expect(hardcore).toHaveAttribute("aria-checked", "true");
  const hardcoreSoft = await page.evaluate(() => {
    const probe = document.createElement("i");
    probe.style.background = "var(--hardcore-soft)";
    document.body.append(probe);
    const fill = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return fill;
  });
  // The fill eases in, so wait for it to settle.
  await expect.poll(async () => (await tile(hardcore)).fill).toBe(hardcoreSoft);
  expect(hardcoreSoft).not.toBe(chosen.fill);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("Retro draws the 2026 lobby and table in Classic paper, ink, felt and ivory", async ({ page, context, request }, testInfo) => {
  await useRetro(context);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-design", "2026");
  const hero = await page.locator(".lobby-intro h1").evaluate(element => {
    const style = getComputedStyle(element);
    return { font: style.fontFamily, tracking: parseFloat(style.letterSpacing) || 0 };
  });
  expect(hero.font).toContain(HANDWRITING);
  expect(hero.tracking).toBeGreaterThanOrEqual(0);

  await enterRoom(page, await createGame(request));
  const roll = page.locator("#rollBtnInline");
  if (await roll.isEnabled()) await roll.click();
  await expect(page.locator("#diceBar .die.shaking")).toHaveCount(0);
  await expect(page.locator(".player-card.me td.cell[data-preview-points]").first()).toBeVisible();

  const table = await page.evaluate(() => {
    const card = getComputedStyle(document.querySelector(".player-card.me"));
    const dock = getComputedStyle(document.querySelector(".room-page .topbar"));
    const tray = getComputedStyle(document.querySelector("#diceBar"));
    const cell = document.querySelector(".player-card.me td.cell[data-preview-points]:not([data-preview-points='0'])")
      || document.querySelector(".player-card.me td.cell[data-preview-points]");
    const preview = getComputedStyle(cell, "::after");
    return {
      cardImage: card.backgroundImage,
      cardColor: card.backgroundColor,
      dockImage: dock.backgroundImage,
      dockColor: dock.backgroundColor,
      trayColor: tray.backgroundColor,
      sheetFont: getComputedStyle(document.querySelector(".player-card.me table.grid td.cell")).fontFamily,
      previewFont: preview.fontFamily,
      previewStyle: preview.fontStyle,
      previewWeight: preview.fontWeight,
      previewInk: preview.color,
      previewPaper: getComputedStyle(cell).backgroundColor,
      faces: [...document.querySelectorAll("#diceBar .die svg rect")].map(rect => getComputedStyle(rect).fill),
      patina: getComputedStyle(document.querySelector("#diceBar .die"), "::before").backgroundImage,
    };
  });
  // Paper sheet, not Classic's felt mat; the dock carries the felt fibres.
  expect(table.cardImage).not.toContain(FELT_TEXTURE);
  expect(table.cardColor).not.toBe(table.dockColor);
  expect(table.dockImage).toContain(FELT_TEXTURE);
  expect(table.trayColor).toBe("rgba(0, 0, 0, 0)");
  expect(table.sheetFont).toContain(HANDWRITING);
  expect(table.previewFont).toContain(HANDWRITING);
  expect(table.previewStyle).toBe("normal");
  // Pencilled, not inked: previews never outweigh the written blue scores.
  expect(table.previewWeight).toBe("400");
  expect(contrast(table.previewInk, table.previewPaper)).toBeGreaterThanOrEqual(4.5);
  expect(new Set(table.faces).size).toBeGreaterThanOrEqual(3);
  expect(table.patina).toContain("radial-gradient");

  const firstDie = page.locator("#diceBar .die").first();
  await firstDie.click();
  await expect(firstDie).toHaveClass(/held/);
  // The server-confirmed hold rebuilds the optimistic die; resolve its live CSS.
  await expect(firstDie).toHaveCSS("box-shadow", /rgb\(227, 181, 82\)/);
  expectReadableDockFocus(await dockFocus(page, "#diceBar .die >> nth=1"));
  expectReadableDockFocus(await dockFocus(page, "#rollBtnInline"));

  // Announced and last written fields use the 2026 marks, never Classic's
  // ochre ring that would read like the brass best-field ring.
  const marks = await page.evaluate(() => {
    const empty = [...document.querySelectorAll(".player-card.me td.cell:not(.compute)")]
      .filter(cell => !cell.textContent.trim());
    const [announced, written] = empty;
    announced.classList.add("announced");
    written.classList.add("last-write");
    const result = {
      announcedShadow: getComputedStyle(announced).boxShadow,
      announcedInk: getComputedStyle(announced).color,
      announcedPaper: getComputedStyle(announced).backgroundColor,
      writtenShadow: getComputedStyle(written).boxShadow,
    };
    announced.classList.remove("announced");
    written.classList.remove("last-write");
    return result;
  });
  expect(marks.announcedShadow).toContain("inset");
  expect(contrast(marks.announcedInk, marks.announcedPaper)).toBeGreaterThanOrEqual(4.5);
  expect(marks.writtenShadow).toBe("none");
  await testInfo.attach("retro-table.png", { body: await page.screenshot({ path: testInfo.outputPath("retro-table.png") }), contentType: "image/png" });
});

// Phones, a coarse-pointer landscape phone and a tablet: the sizes the
// previous design's Classic specs guarded before they were pinned to it.
const TOUCH_VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 844, height: 390 },
  { width: 820, height: 1180 },
];

test("Retro phones and tablets keep Classic's continuous felt with readable header, visible focus and no sideways scroll", async ({ browser, baseURL, request }, testInfo) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await useRetro(context);
  const page = await context.newPage();
  try {
    await enterRoom(page, await createGame(request));
    for (const viewport of TOUCH_VIEWPORTS) {
      await page.setViewportSize(viewport);
      const look = await page.evaluate(() => {
        const inspect = selector => {
          const style = getComputedStyle(document.querySelector(selector));
          return { image: style.backgroundImage, color: style.backgroundColor, ink: style.color };
        };
        return {
          header: inspect(".room-header"),
          status: inspect(".header-turn-status"),
          dock: inspect(".room-page .topbar"),
          sheet: inspect(".player-card.me"),
          width: document.documentElement.scrollWidth,
          viewport: innerWidth,
        };
      });
      expect(look.header.image).toContain(FELT_TEXTURE);
      expect(look.dock.image).toContain(FELT_TEXTURE);
      expect(look.sheet.image).not.toContain(FELT_TEXTURE);
      expect(contrast(look.status.ink, look.header.color)).toBeGreaterThanOrEqual(4.5);
      expect(look.width).toBeLessThanOrEqual(look.viewport + 1);
      expectReadableDockFocus(await dockFocus(page, "#diceBar .die >> nth=2"));
      const name = `retro-touch-${viewport.width}x${viewport.height}.png`;
      await testInfo.attach(name, { body: await page.screenshot({ path: testInfo.outputPath(name) }), contentType: "image/png" });
    }
  } finally {
    await context.close();
  }
});
