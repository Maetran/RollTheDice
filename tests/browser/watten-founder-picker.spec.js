const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

test.afterEach(async ({ page }) => {
  // Native navigation can start one more real identity projection after the
  // visible assertions finish. Complete page-owned handlers before teardown
  // disposes their responses; handler failures still fail the test.
  await page.unrouteAll({ behavior: "wait" });
});

// Browser coverage uses the explicitly enabled local preview. The real
// production Founder/Host/HTTP/WS audience is checked against disposable DBs in
// test_watten_founder_access.py and test_watten_founder_preview.py.
async function signedInPreview(page, language) {
  const login = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(login.ok()).toBeTruthy();
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
  const state = { private: true };
  await page.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    // Combine the real private Watten capability with the supported public
    // Zilch UI, like game-picker.spec.js. This isolated server keeps Zilch's
    // actual APIs private; the projection grants no server access to them.
    const access = { ...auth.game_access, zilch_public: true,
      watten_preview: state.private && auth.game_access?.watten_preview === true };
    await route.fulfill({ response, json: {
      ...auth, game_access: access,
      user: { ...auth.user, game_access: access, must_change_password: false,
        preferences: { ...auth.user.preferences, preferred_language: language } },
    } });
  });
  return state;
}

async function confirmedChooser(page) {
  await page.waitForFunction(() => Boolean(window.ZDWA_APP_MODE?.initialized));
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  const trigger = page.locator("[data-game-switch]");
  await expect(trigger).toBeEnabled();
  await trigger.click();
  await expect(page.locator("#suiteGameMenu")).toBeVisible();
  return page.locator('#suiteGameMenu [data-game-entry="watten"]');
}

test("a final private capability confirmation appends Watten without closing the public chooser or moving focus", async ({ page }) => {
  await signedInPreview(page, "en");
  let reads = 0, released = false;
  const pending = [];
  // The initial identity enables the public choices. Hold every following /me
  // until the menu is open, including the decisive private-capability read.
  await page.route("**/api/auth/me", route => {
    reads += 1;
    if (reads === 1 || released) return route.fallback();
    pending.push(route);
  });
  try {
    await page.goto("/regeln");
    await expect.poll(() => pending.length).toBeGreaterThan(0);
    const trigger = page.locator("[data-game-switch]");
    await expect(trigger).toBeEnabled();
    await trigger.click();
    const menu = page.locator("#suiteGameMenu");
    await expect(menu).toBeVisible();
    await expect(menu.locator("[data-game-entry]")).toHaveCount(3);
    await expect(menu.locator('[data-game-entry="watten"]')).toHaveCount(0);
    const hausdepp = menu.locator('[data-game-entry="hausdepp"]');
    await hausdepp.focus();
    const panelNode = await menu.elementHandle(), linkNode = await hausdepp.elementHandle();
    released = true;
    await Promise.all(pending.splice(0).map(route => route.fallback()));
    const watten = menu.locator('[data-game-entry="watten"]');
    await expect(watten).toBeVisible();
    await expect(watten).toHaveAttribute("href", "/watten");
    await expect(menu.locator("[data-game-entry]")).toHaveCount(4);
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await menu.evaluate((node, previous) => node === previous, panelNode)).toBe(true);
    expect(await hausdepp.evaluate((node, previous) => node === previous, linkNode)).toBe(true);
    await expect(hausdepp).toBeFocused();
    await hausdepp.click();
    await expect(page).toHaveURL(/\/hausdepp$/);
    await panelNode.dispose();
    await linkNode.dispose();
  } finally {
    released = true;
    await Promise.all(pending.splice(0).map(route => route.fallback()));
  }
});

for (const language of ["de", "en"]) {
  test(`${language}: fresh private preview is discoverable and usable in both phone orientations`, async ({ page }, testInfo) => {
    await signedInPreview(page, language);
    await page.goto("/regeln");
    for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(viewport);
      const entry = await confirmedChooser(page);
      await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(4);
      await expect(entry).toHaveAttribute("href", "/watten");
      await expect(entry).toContainText(language === "de" ? "Private Vorschau" : "Private preview");
      await entry.scrollIntoViewIfNeeded();
      await expect(entry).toBeVisible();
      expect((await entry.boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath(`private-picker-${viewport.width}x${viewport.height}.png`) });
      await page.keyboard.press("Escape");
      await expect(page.locator("#suiteGameMenu")).toHaveCount(0);
      await expect(page.locator("[data-game-switch]")).toBeFocused();
    }
    const entry = await confirmedChooser(page);
    await entry.click();
    await expect(page).toHaveURL(/\/watten(?:\?|$)/);
    await expect(page.locator("[data-watten-create]")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", language);
    const nativeTrigger = page.locator("#wattenSuitePicker");
    await expect(nativeTrigger).toBeEnabled();
    await expect(nativeTrigger).toContainText("Watten");
    await nativeTrigger.click();
    await expect(page.locator('#suiteGameMenu [data-game-entry="watten"]')).toHaveAttribute("aria-current", "page");
    await page.keyboard.press("Escape");
    await expect(nativeTrigger).toBeFocused();
  });
}

test("losing the preview closes its mobile modal and discards a late activity response", async ({ page }) => {
  const state = await signedInPreview(page, "de");
  await page.setViewportSize({ width: 320, height: 568 });
  let pending;
  await page.route("**/api/game-activity", route => {
    if (!pending) { pending = route; return; }
    return route.fulfill({ json: { games: { zdwa: { players: 0 }, zilch: { players: 0 }, hausdepp: { players: 0 } } } });
  });
  await page.goto("/regeln");
  const entry = await confirmedChooser(page);
  await expect(entry).toBeVisible();
  await expect.poll(() => Boolean(pending)).toBe(true);
  state.private = false;
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect(page.locator("#suiteGameMenu")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  expect(await page.evaluate(() => [...document.body.children].some(node => node.inert))).toBe(false);
  await pending.fulfill({ json: { games: { watten: { players: 987 }, zdwa: { players: 0 } } } }).catch(() => {});
  await page.evaluate(() => window.ZDWA_APP_MODE.refresh());
  await page.locator("[data-game-switch]").click();
  await expect(page.locator('#suiteGameMenu [data-game-entry="watten"]')).toHaveCount(0);
  await expect(page.locator("#suiteGameMenu [data-game-entry]")).toHaveCount(3);
  await expect(page.locator("#suiteGameMenu")).not.toContainText("987");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
  expect(await page.evaluate(() => [...document.body.children].some(node => node.inert))).toBe(false);
});
