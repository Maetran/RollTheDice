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

async function switchContentGeometry(locator, targetLabel) {
  return locator.evaluate((button, labelText) => {
    const icon = button.querySelector("svg.game-switch-icon");
    const label = [...button.querySelectorAll("span")].find(element => (
      element.textContent.trim() === labelText
    ));
    if (!icon || !label) return null;
    const iconBox = icon.getBoundingClientRect();
    const labelBox = label.getBoundingClientRect();
    return {
      iconWidth: iconBox.width,
      iconHeight: iconBox.height,
      labelWidth: labelBox.width,
      labelHeight: labelBox.height,
      horizontalGap: labelBox.left - iconBox.right,
      verticalCenterDelta: Math.abs(
        (iconBox.top + iconBox.height / 2) - (labelBox.top + labelBox.height / 2),
      ),
      labelDisplay: getComputedStyle(label).display,
      labelPosition: getComputedStyle(label).position,
    };
  }, targetLabel);
}

function expectDesktopSwitchContent(layout) {
  expect(layout).not.toBeNull();
  expect(layout.iconWidth).toBeGreaterThan(0);
  expect(layout.iconHeight).toBeGreaterThan(0);
  expect(layout.labelWidth).toBeGreaterThan(0);
  expect(layout.labelHeight).toBeGreaterThan(0);
  expect(layout.horizontalGap).toBeGreaterThanOrEqual(3);
  expect(layout.verticalCenterDelta).toBeLessThanOrEqual(1.5);
}

function expectCompactSwitchContent(layout) {
  expect(layout).not.toBeNull();
  expect(layout.iconWidth).toBeGreaterThan(0);
  expect(layout.iconHeight).toBeGreaterThan(0);
  expect(
    layout.labelDisplay === "none"
      || (layout.labelWidth <= 1 && layout.labelHeight <= 1 && layout.labelPosition === "absolute"),
  ).toBeTruthy();
}

test.describe("installed PWA account navigation", () => {
  test.use({ serviceWorkers: "block" });

  for (const source of ["zilch", "zdwa"]) {
    test(`${source} PWA keeps the other game's account after switching`, async ({ page, baseURL }) => {
      await signInAsPreviewMani(page);
      const hostname = source === "zilch" ? "zilch.zockdiewandan.online" : "zockdiewandan.online";
      const origin = `https://${hostname}`;
      const cookies = await page.context().cookies(baseURL);
      await page.context().addCookies(cookies.map(cookie => ({ ...cookie, domain: hostname })));
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
      });
      // Exercise the real documents, auth refresh and generated bundles with
      // production Host routing, but never contact production or its sockets.
      await page.routeWebSocket("**/*", socket => socket.close());
      await page.route(`${origin}/**`, async route => {
        const url = new URL(route.request().url());
        const response = await route.fetch({
          url: `${baseURL}${url.pathname}${url.search}`,
          headers: { ...route.request().headers(), host: hostname },
          maxRedirects: 0,
        });
        await route.fulfill({ response });
      });
      await page.goto(`${origin}/`);
      await expect(page.locator("[data-game-switch]")).toBeEnabled();
      await page.locator("[data-game-switch]").click();
      const destination = source === "zilch" ? "zdwa" : "zilch";
      await expect(page).toHaveURL(`${origin}/${destination}`);
      await expect(page.locator("html")).toHaveAttribute("data-game", destination);
      const accountLink = source === "zilch"
        ? page.locator("#headerAccountLink")
        : page.getByRole("navigation", { name: "Zilch-Navigation" }).getByRole("link", { name: "Konto", exact: true });
      await expect(accountLink).toHaveAttribute("href", `/${destination}/konto`);
      await accountLink.click();
      await expect(page).toHaveURL(`${origin}/${destination}/konto`);
      await expect(page.locator("html")).toHaveAttribute("data-game", destination);
      await expect(page.getByRole("heading", { name: "Push-Benachrichtigungen", exact: true })).toBeVisible();
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-game", destination);
      // Attribute changes and individually inserted links are handled too.
      if (destination === "zdwa") {
        await page.evaluate(() => {
          const link = document.createElement("a");
          link.id = "late-account-link";
          link.href = "/konto";
          document.body.append(link);
        });
        await expect(page.locator("#late-account-link")).toHaveAttribute("href", "/zdwa/konto");
        await page.locator("#late-account-link").evaluate(link => { link.href = "/regeln"; });
        await expect(page.locator("#late-account-link")).toHaveAttribute("href", "/zdwa/regeln");
      }
      await page.goto(`${origin}/${destination}/spieler/Admin`);
      await expect(page.locator("html")).toHaveAttribute("data-game", destination);
      await expect(page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true })).toBeEnabled();
      await expect(page.getByRole("link", { name: "Spielerauswahl im Konto verwalten", exact: true })).toHaveAttribute("href", `/${destination}/konto#settings`);
      if (source === "zilch") {
        // The clean Zilch profile and the ZDWA bridge use the same account.
        await page.goto(`${origin}/spieler/Admin`);
        await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
        await expect(page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true })).toBeEnabled();
        await expect(page.getByRole("link", { name: "Spielerauswahl im Konto verwalten", exact: true })).toHaveAttribute("href", "/konto#settings");
      }
    });
  }
});

async function controlHeights(locator) {
  return locator.evaluateAll(elements => elements
    .filter(element => element.getClientRects().length)
    .map(element => element.getBoundingClientRect().height));
}

function expectUniformHeaderControls(heights) {
  expect(heights.length).toBeGreaterThan(1);
  expect(heights, `Header control heights: ${heights.join(", ")}`).toEqual(heights.map(() => 36));
}

test("the permission-gated game switch is available across ZDWA pages but absent in its active room", async ({ page }) => {
  await page.goto("/regeln");
  const anonymousSwitch = page.locator("[data-game-switch]");
  await expect(anonymousSwitch).toBeHidden();
  await expect(anonymousSwitch).toBeDisabled();
  await expect(anonymousSwitch).toHaveAttribute("aria-hidden", "true");

  await signInAsPreviewMani(page);

  await page.setViewportSize({ width: 1024, height: 800 });
  const zdwaSwitch = page.locator("[data-game-switch]");
  await expect(zdwaSwitch.locator("svg.game-switch-icon")).toBeVisible();
  await expect(zdwaSwitch).toContainText("Zilch");
  expectDesktopSwitchContent(await switchContentGeometry(zdwaSwitch, "Zilch"));
  expectUniformHeaderControls(await controlHeights(page.locator(".app-nav-tools :is([data-language-switcher], [data-theme-toggle], [data-game-switch])")));
  const zdwaDesktopSwitch = await switchControlGeometry(zdwaSwitch);
  await Promise.all([
    page.waitForURL(/\/zilch$/),
    page.locator("[data-game-switch]").click(),
  ]);
  const zilchSwitch = page.locator(".zilch-header [data-game-switch]");
  await expect(zilchSwitch.locator("svg.game-switch-icon")).toBeVisible();
  await expect(zilchSwitch).toContainText("ZDWA");
  expectDesktopSwitchContent(await switchContentGeometry(zilchSwitch, "ZDWA"));
  const zilchDesktopSwitch = await switchControlGeometry(zilchSwitch);
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
    await expect(switchButton.locator("svg.game-switch-icon")).toBeVisible();
    await expect(switchButton).toContainText("Zilch");
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
  await page.setViewportSize({ width: 390, height: 844 });
  const compactZdwaSwitch = page.locator("[data-game-switch]");
  await expect(compactZdwaSwitch.locator("svg.game-switch-icon")).toBeVisible();
  expectCompactSwitchContent(await switchContentGeometry(compactZdwaSwitch, "Zilch"));
  await page.setViewportSize({ width: 720, height: 844 });
  await expect(compactZdwaSwitch.locator("svg.game-switch-icon")).toBeVisible();
  expectCompactSwitchContent(await switchContentGeometry(compactZdwaSwitch, "Zilch"));
  await page.setViewportSize({ width: 1024, height: 800 });
  await Promise.all([
    page.waitForURL(/\/spiel\/[^/?]+$/),
    page.click("#createBtn"),
  ]);
  await expect(page.locator("#diceBar")).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const roomPath = new URL(page.url()).pathname;
  await expect(page.locator(".room-header [data-game-switch]")).toHaveCount(0);
  const leaveGame = page.locator("#backToLobbyBtn");
  await expect(leaveGame).toBeVisible();
  const geometry = await leaveGame.evaluate(element => {
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
  expectUniformHeaderControls(await controlHeights(page.locator(".room-header button")));
  await page.keyboard.press("Alt+Shift+Z");
  await page.waitForTimeout(150);
  expect(new URL(page.url()).pathname).toBe(roomPath);
});
