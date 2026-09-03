const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ username, password, role }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username, temporary_password: password, role }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { username, password, role });
}

async function ensurePreviewAccounts(page) {
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  const preview = await createUser(page, "PreviewFriend", "preview-friend-password-123", "user");
  expect([201, 400]).toContain(mani.status);
  expect([201, 400]).toContain(preview.status);
}

async function enabledLocator(page, selector) {
  const locator = page.locator(selector);
  if (await locator.count() && await locator.first().isEnabled()) return locator.first();
  return null;
}

async function completeOpeningRoll(pages) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await pages[0].locator("[data-zilch-start-roll]").count() === 0) return;
    let clicked = false;
    for (const page of pages) {
      const button = await enabledLocator(page, "[data-zilch-start-roll]");
      if (!button) continue;
      await button.click();
      clicked = true;
      await page.waitForTimeout(120);
    }
    if (!clicked) await pages[0].waitForTimeout(180);
  }
  throw new Error("opening roll did not resolve after repeated attempts");
}

async function selectableQuickHold(pages, { preferNonHot = false } = {}) {
  const selectors = preferNonHot
    ? [".zilch-quick-hold:not(.zilch-quick-hold--hot)", ".zilch-quick-hold"]
    : [".zilch-quick-hold"];
  for (const selector of selectors) {
    for (const page of pages) {
      const quickHold = await enabledLocator(page, selector);
      if (quickHold) return { page, quickHold };
    }
  }
  return null;
}

async function rollUntilQuickHold(pages) {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const existing = await selectableQuickHold(pages, { preferNonHot: true });
    if (existing) return existing;
    for (const page of pages) {
      const roll = await enabledLocator(page, "[data-zilch-roll]");
      if (!roll) continue;
      await roll.click();
      // The shared server coordinator deliberately rate-limits successive
      // rolls. Waiting here also gives both WebSocket clients a snapshot.
      await page.waitForTimeout(680);
      const quickHold = await selectableQuickHold(pages, { preferNonHot: true });
      if (quickHold) return quickHold;
    }
    await pages[0].waitForTimeout(120);
  }
  throw new Error("no selectable Quick Hold appeared");
}

async function bankWhenPossible(pages) {
  for (let attempt = 0; attempt < 28; attempt += 1) {
    for (const page of pages) {
      const bank = await enabledLocator(page, "[data-zilch-bank]");
      if (bank) {
        await bank.click();
        await page.waitForTimeout(220);
        return page;
      }
    }
    const quickHold = await selectableQuickHold(pages, { preferNonHot: true });
    if (quickHold) {
      await quickHold.quickHold.press("Enter");
      await quickHold.page.waitForTimeout(180);
      continue;
    }
    await rollUntilQuickHold(pages);
  }
  throw new Error("could not reach a bankable Zilch turn");
}

async function visibleGameFacts(page) {
  return page.evaluate(() => ({
    boards: [...document.querySelectorAll("[data-zilch-board-id]")].map(board => ({
      id: board.dataset.zilchBoardId,
      // Number grouping differs deliberately between the German and English
      // contexts; compare the shown score values, not their locale glyph.
      values: [...board.querySelectorAll("dd")].map(value => value.textContent.replace(/[^0-9-]/g, "")),
    })),
    dice: [...document.querySelectorAll(".zilch-die__face")].map(face => face.dataset.value),
  }));
}

test("Zilch is a separate permission-gated app mode and its hotkey respects inputs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();

  // The bootstrap admin is deliberately not the allowed preview identity.
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await expect(page.locator("[data-game-switch]")).toBeHidden();
  await ensurePreviewAccounts(page);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  const switchButton = page.locator("[data-game-switch]");
  await expect(switchButton).toBeVisible();
  await expect(page.locator("#createGameCard")).toBeVisible();
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);

  await Promise.all([
    page.waitForURL(/\/zilch$/),
    switchButton.click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator("[data-zilch-root]")).toBeVisible();
  await expect(page.locator("#createGameCard")).toHaveCount(0);
  await expect(page.locator("#zilchCreateForm")).toBeVisible();
  await expect(page.locator("#zilchMode")).toHaveCount(0);

  // Alt+Shift+Z is intentionally ignored while typing into a Zilch input.
  const lobbyUrl = page.url();
  await page.locator("#zilchGameName").focus();
  await page.keyboard.press("Alt+Shift+Z");
  await expect.poll(() => page.url()).toBe(lobbyUrl);

  await page.locator("#zilchGameName").evaluate(element => element.blur());
  await Promise.all([
    page.waitForURL(/\/$/),
    page.keyboard.press("Alt+Shift+Z"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  await expect(page.locator("#createGameCard")).toBeVisible();

  await page.locator("[data-game-switch]").click();
  await page.waitForURL(/\/zilch$/);
  await page.click("#zilchLogout");
  await page.waitForURL(/\/$/);
  await expect(page.locator("[data-game-switch]")).toBeHidden();
});

test("two explicitly allowed humans can create, rejoin, and play a private Zilch alpha", async ({ browser, page }) => {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  await ensurePreviewAccounts(page);

  const maniContext = await browser.newContext();
  const previewContext = await browser.newContext();
  const blockedContext = await browser.newContext();
  const mani = await maniContext.newPage();
  const preview = await previewContext.newPage();
  const blocked = await blockedContext.newPage();

  try {
    await mani.goto("/");
    await signIn(mani, "Mani", "mani-preview-password-123");
    await expect(mani.locator("#authBadge")).toContainText("Mani");
    await mani.locator("[data-game-switch]").click();
    await mani.waitForURL(/\/zilch$/);
    await mani.locator("#zilchGameName").fill("Zwei Menschen Alpha");
    await Promise.all([
      mani.waitForURL(/\/zilch\/spiel\/[^/]+$/),
      mani.locator("#zilchCreateForm button[type=submit]").click(),
    ]);
    const gamePath = new URL(mani.url()).pathname;
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(1);
    await expect(mani.locator("[data-zilch-start-roll]")).toHaveCount(0);

    await preview.goto("/");
    await signIn(preview, "PreviewFriend", "preview-friend-password-123");
    await expect(preview.locator("#authBadge")).toContainText("PreviewFriend");
    await Promise.all([
      preview.waitForNavigation({ waitUntil: "domcontentloaded" }),
      preview.locator("[data-language-switcher]").selectOption("en"),
    ]);
    await expect(preview.locator("html")).toHaveAttribute("lang", "en");
    await expect(preview.locator("[data-game-switch]")).toBeVisible();
    await preview.locator("[data-game-switch]").click();
    await preview.waitForURL(/\/zilch$/);
    await expect(preview.getByRole("heading", { name: "Zilch Preview" })).toBeVisible();
    await Promise.all([
      preview.waitForURL(new RegExp(`${gamePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`)),
      preview.locator(`a[href="${gamePath}"]`).click(),
    ]);

    await expect(mani.locator(".zilch-start-roll")).toBeVisible();
    await expect(preview.locator(".zilch-start-roll")).toBeVisible();
    await completeOpeningRoll([mani, preview]);
    await expect(mani.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(preview.locator("[data-zilch-start-roll]")).toHaveCount(0);
    await expect(mani.locator(".zilch-start-roll--resolved")).toBeVisible();
    await expect(preview.locator(".zilch-start-roll--resolved")).toBeVisible();
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(preview.locator("[data-zilch-board-id]")).toHaveCount(2);

    await mani.locator("#zilchChatInput").fill("server chat stays shared");
    await mani.locator("#zilchChatForm button[type=submit]").click();
    await expect(preview.locator("#zilchChatHistory")).toContainText("server chat stays shared");

    await mani.setViewportSize({ width: 1280, height: 900 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await mani.setViewportSize({ width: 390, height: 844 });
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    expect(await mani.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await mani.emulateMedia({ reducedMotion: "reduce" });

    const selected = await rollUntilQuickHold([mani, preview]);
    await selected.quickHold.press("Enter");
    await selected.page.waitForTimeout(220);
    // A full-dice special can legitimately reset the rack for Hot Dice;
    // ordinary holds mark dice unavailable. In both cases the selected card
    // disappears because the server moved to the next authoritative phase.
    await expect.poll(async () => selected.page.locator(".zilch-quick-hold").count()).toBe(0);
    expect(await visibleGameFacts(mani)).toEqual(await visibleGameFacts(preview));

    await mani.reload();
    await expect(mani.locator("[data-zilch-board-id]")).toHaveCount(2);
    await expect(mani.locator("[data-zilch-root]")).toBeVisible();

    const beforeBank = await mani.locator(".zilch-board--active").getAttribute("data-zilch-board-id");
    await bankWhenPossible([mani, preview]);
    await expect.poll(async () => mani.locator(".zilch-board--active").getAttribute("data-zilch-board-id")).not.toBe(beforeBank);

    await blocked.goto("/");
    await signIn(blocked, "Admin", "temporary-password-123");
    await expect(blocked.locator("#authBadge")).toContainText("Admin");
    await expect(blocked.locator("[data-game-switch]")).toBeHidden();
    const invisible = await blocked.evaluate(async () => (await fetch("/api/games?game_type=zilch")).json());
    expect(invisible.games).toEqual([]);
    const forbidden = await blocked.goto(gamePath);
    expect(forbidden?.status()).toBe(403);
  } finally {
    await maniContext.close();
    await previewContext.close();
    await blockedContext.close();
  }
});

test("direct Zilch URLs remain server-protected", async ({ page }) => {
  const response = await page.goto("/zilch");
  expect(response?.status()).toBe(401);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
  const rawStatic = await page.goto("/static/zilch.html");
  expect(rawStatic?.status()).toBe(404);
  await expect(page.locator("[data-zilch-root]")).toHaveCount(0);
});
