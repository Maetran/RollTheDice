const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ name, secret, userRole }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username: name, temporary_password: secret, role: userRole }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { name: username, secret: password, userRole: role });
}

async function signInAsPreviewMani(page) {
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  expect([201, 400]).toContain(mani.status);
  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("#authBadge")).toContainText("Mani");
}

async function persistLanguageForFixture(page, language) {
  // The chooser reloads after persistence. This spec exercises the game
  // switch, while dedicated localization tests cover the chooser itself. Set
  // both persistence layers without making the current document navigate.
  // `page.request` shares the authenticated browser-context cookies but is
  // independent of a page navigation already being settled by the app.
  const me = await page.request.get("/api/auth/me", { headers: { "Cache-Control": "no-store" } });
  expect(me.ok()).toBeTruthy();
  const auth = await me.json();
  const csrf = auth?.user?.csrf_token;
  expect(auth?.authenticated).toBeTruthy();
  expect(csrf).toBeTruthy();
  const response = await page.request.put("/api/auth/preferences/language", {
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    data: { preferred_language: language },
  });
  expect(response.status()).toBe(200);
  await page.addInitScript(preferredLanguage => {
    localStorage.setItem("zdwa_language", preferredLanguage);
  }, language);
}

async function gotoAfterLanguageSync(page, destination) {
  const destinationPath = new URL(destination, page.url()).pathname;
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await page.goto(destination, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).pathname === destinationPath) return;
    } catch (error) {
      lastError = error;
      if (!/ERR_ABORTED|interrupted by another navigation/i.test(String(error))) throw error;
    }
  }
  throw lastError || new Error(`Could not settle on ${destination}`);
}

async function restoreGermanPreference(page) {
  // This spec uses the same preview account as later Zilch fixtures. Reset
  // it even when an assertion fails, without a second navigation in cleanup.
  try {
    const me = await page.request.get("/api/auth/me", { headers: { "Cache-Control": "no-store" } });
    if (!me.ok()) return;
    const auth = await me.json();
    const csrf = auth?.user?.csrf_token;
    if (!auth?.authenticated || !csrf) return;
    await page.request.put("/api/auth/preferences/language", {
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      data: { preferred_language: "de" },
    });
  } catch {
    // Do not replace an original assertion error when its page was torn down.
  }
}

test.afterEach(async ({ page }) => {
  await restoreGermanPreference(page);
});

async function switchControlGeometry(locator) {
  return locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      width: box.width,
      height: box.height,
      paddingTop: style.paddingTop,
      paddingRight: style.paddingRight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
    };
  });
}

async function controlHeights(locator) {
  return locator.evaluateAll(elements => elements
    .filter(element => element.getClientRects().length)
    .map(element => element.getBoundingClientRect().height));
}

function expectUniformHeaderControls(heights) {
  expect(heights.length).toBeGreaterThan(1);
  expect(heights, `Header control heights: ${heights.join(", ")}`).toEqual(heights.map(() => 36));
}

test("the permission-gated game switch is available across ZDWA and in its active room", async ({ page }) => {
  await page.goto("/regeln");
  const anonymousSwitch = page.locator("[data-game-switch]");
  await expect(anonymousSwitch).toBeHidden();
  await expect(anonymousSwitch).toBeDisabled();
  await expect(anonymousSwitch).toHaveAttribute("aria-hidden", "true");

  await signInAsPreviewMani(page);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect(page.locator("[data-game-switch] .game-switch-icon--zilch")).toHaveText("Z");
  expectUniformHeaderControls(await controlHeights(page.locator(".app-nav-tools :is([data-language-switcher], [data-theme-toggle], [data-game-switch])")));
  const zdwaDesktopSwitch = await switchControlGeometry(page.locator("[data-game-switch]"));
  await Promise.all([
    page.waitForURL(/\/zilch$/),
    page.locator("[data-game-switch]").click(),
  ]);
  const zilchDesktopSwitch = await switchControlGeometry(page.locator(".zilch-header [data-game-switch]"));
  expect(zilchDesktopSwitch).toEqual(zdwaDesktopSwitch);
  expectUniformHeaderControls(await controlHeights(page.locator(".zilch-header-tools :is([data-language-switcher], [data-game-switch])")));
  await Promise.all([
    page.waitForURL(url => url.pathname === "/"),
    page.locator(".zilch-header [data-game-switch]").click(),
  ]);

  const destinations = [
    "/",
    "/spieler",
    "/spieler/Mani",
    "/regeln",
    "/rangabzeichen",
    "/konto",
    "/admin",
    "/ergebnis/not-present",
  ];
  for (const destination of destinations) {
    await page.goto(destination);
    await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
    const switchButton = page.locator("[data-game-switch]");
    await expect(switchButton).toBeVisible();
    await expect(switchButton).toBeEnabled();
    await expect(switchButton).toHaveAttribute("aria-hidden", "false");
    await expect(switchButton).toHaveAttribute("aria-label", /^(?:Zilch öffnen|Open Zilch) \(Alt\+Shift\+Z\)$/);
    await expect(switchButton.locator(".game-switch-icon--zilch")).toHaveText("Z");
  }

  await page.goto("/");
  await persistLanguageForFixture(page, "en");
  await gotoAfterLanguageSync(page, "/regeln");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("[data-game-switch]")).toHaveAttribute("aria-label", "Open Zilch (Alt+Shift+Z)");
  await persistLanguageForFixture(page, "de");
  await gotoAfterLanguageSync(page, "/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("#authBadge")).toContainText("Mani");
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+$/),
    page.click("#createBtn"),
  ]);
  await expect(page.locator("#diceBar")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const roomSwitch = page.locator(".room-header [data-game-switch]");
  await expect(roomSwitch).toBeVisible();
  await expect(roomSwitch).toBeEnabled();
  await expect(roomSwitch.locator(".game-switch-icon--zilch")).toHaveText("Z");
  const zdwaMobileSwitch = await switchControlGeometry(roomSwitch);
  const geometry = await roomSwitch.evaluate(element => {
    const button = element.getBoundingClientRect();
    const header = element.closest(".room-header").getBoundingClientRect();
    return {
      buttonLeft: button.left,
      buttonRight: button.right,
      buttonHeight: button.height,
      headerLeft: header.left,
      headerRight: header.right,
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    };
  });
  expect(geometry.buttonHeight).toBeGreaterThanOrEqual(28);
  expect(geometry.buttonLeft).toBeGreaterThanOrEqual(geometry.headerLeft);
  expect(geometry.buttonRight).toBeLessThanOrEqual(geometry.headerRight);
  expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
  expectUniformHeaderControls(await controlHeights(page.locator(".room-header > button")));

  await Promise.all([
    page.waitForURL(/\/zilch$/),
    roomSwitch.click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  const zilchMobileSwitch = await switchControlGeometry(page.locator(".zilch-header [data-game-switch]"));
  expect(zilchMobileSwitch).toEqual(zdwaMobileSwitch);
  expectUniformHeaderControls(await controlHeights(page.locator(".zilch-header-tools :is([data-language-switcher], [data-game-switch])")));
});
