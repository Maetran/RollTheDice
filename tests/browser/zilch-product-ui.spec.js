const { test, expect } = require("@playwright/test");

async function signIn(page, username, password) {
  await page.fill("#loginUsername", username);
  await page.fill("#loginPassword", password);
  await page.click("#loginForm button[type=submit]");
}

async function createUser(page, username, password, role = "user") {
  return page.evaluate(async ({ username: name, password: secret, role: userRole }) => {
    const me = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.user.csrf_token },
      body: JSON.stringify({ username: name, temporary_password: secret, role: userRole }),
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  }, { username, password, role });
}

async function signInAsPreviewMani(page) {
  // Browser tests share a disposable database.  Provisioning is idempotent so
  // this file also works when another Zilch spec has already created Mani.
  await page.goto("/");
  await signIn(page, "Admin", "temporary-password-123");
  await expect(page.locator("#authBadge")).toContainText("Admin");
  const mani = await createUser(page, "Mani", "mani-preview-password-123", "admin");
  expect([201, 400]).toContain(mani.status);

  await page.click("#logoutBtn");
  await expect(page.locator("#loginForm")).toBeVisible();
  await signIn(page, "Mani", "mani-preview-password-123");
  await expect(page.locator("#authBadge")).toContainText("Mani");
  await expect(page.locator("[data-game-switch]")).toBeVisible();
}

function externalHttpOrigins(requests, origin) {
  return [...new Set(requests
    .map(request => request.url())
    .filter(url => /^https?:/i.test(url))
    .map(url => new URL(url).origin)
    .filter(requestOrigin => requestOrigin !== origin))];
}

test("private Zilch rules, history, and product navigation use the protected noindex shell", async ({ page }) => {
  const anonymousRules = await page.goto("/zilch/regeln");
  expect(anonymousRules?.status()).toBe(401);
  const anonymousHistory = await page.goto("/zilch/historie");
  expect(anonymousHistory?.status()).toBe(401);

  await signInAsPreviewMani(page);
  const requests = [];
  page.on("request", request => requests.push(request));

  const [rulesResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/zilch/rules" && response.status() === 200),
    page.goto("/zilch/regeln"),
  ]);
  expect(await rulesResponse.json()).toMatchObject({
    ruleset: "zilch-house-v1",
    dice_count: 6,
    target_score: 10000,
    bank_minimum: 400,
    third_roll_minimum: 300,
    confirmation_minimum: 50,
    third_zilch_penalty: 500,
    scoring: { straight: 2000, three_pairs: 500, nothing_bonus: 500 },
  });
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("[data-zilch-root]")).toBeVisible();
  await expect(page.locator("[data-zilch-ruleset=\"zilch-house-v1\"]")).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Zilch(?:-| )(?:Regeln|rules)$/i })).toBeVisible();
  await expect(page.locator("#zilchNavigation a[href='/zilch/regeln']")).toHaveAttribute("aria-current", "page");

  const navigation = await page.locator("#zilchNavigation a").evaluateAll(links => links.map(link => ({
    href: link.getAttribute("href"),
    text: link.textContent?.trim(),
  })));
  const hrefs = navigation.map(link => link.href);
  expect(hrefs).toEqual(expect.arrayContaining([
    "/zilch",
    "/zilch/historie",
    "/zilch/regeln",
    "/konto?return_to=zilch#settings",
  ]));
  // A clear return control for ZDWA may live in this list or in the shared
  // game-switch header.  Apart from that optional route, product navigation
  // must not advertise a future/non-functional Zilch area.
  expect(hrefs.filter(href => ![
    "/zilch",
    "/zilch/historie",
    "/zilch/regeln",
    "/konto?return_to=zilch#settings",
    "/",
  ].includes(href))).toEqual([]);
  expect(navigation.map(link => link.text)).not.toContain("Bestenlisten");
  expect(navigation.map(link => link.text)).not.toContain("Achievements");
  expect(page.locator("#createGameCard")).toHaveCount(0);

  await Promise.all([
    page.waitForURL(url => (
      url.pathname === "/konto"
      && url.searchParams.get("return_to") === "zilch"
      && url.hash === "#settings"
    )),
    page.locator("#zilchNavigation a[href='/konto?return_to=zilch#settings']").click(),
  ]);
  const returnToZilch = page.locator("#returnToZilch");
  await expect(returnToZilch).toBeVisible();
  await expect(returnToZilch).toHaveAttribute("href", "/zilch");
  await expect(page.locator("#settingsTab")).toHaveAttribute("aria-selected", "true");
  await Promise.all([
    page.waitForURL(/\/zilch$/),
    returnToZilch.click(),
  ]);
  await expect(page.locator("[data-zilch-root]")).toBeVisible();

  // Consume the body as soon as the response arrives. The app can issue a
  // navigation while route initialization finishes, which otherwise makes a
  // retained Playwright response body unavailable on WebKit/Chromium.
  const historyBody = page
    .waitForResponse(response => new URL(response.url()).pathname === "/api/zilch/results" && response.status() === 200)
    .then(response => response.json());
  await page.goto("/zilch/historie");
  expect(await historyBody).toHaveProperty("results");
  await expect(page.locator("#zilchAllResultsHistory")).toBeVisible();
  await expect(page.locator("#zilchNavigation a[href='/zilch/historie']")).toHaveAttribute("aria-current", "page");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  const origin = new URL(page.url()).origin;
  expect(externalHttpOrigins(requests, origin)).toEqual([]);
});

test("Zilch product navigation is keyboard-friendly, responsive, and localized without mounting ZDWA", async ({ page }) => {
  await signInAsPreviewMani(page);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/zilch$/),
    page.locator("[data-game-switch]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zilch");
  await expect(page.locator("#createGameCard")).toHaveCount(0);

  await page.setViewportSize({ width: 320, height: 844 });
  const navigation = page.locator("#zilchNavigation");
  const navigationList = page.locator("#zilchNavigation .zilch-nav-list");
  const toggle = page.locator("#zilchNavToggle");
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toHaveJSProperty("hidden", true);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The nav itself is a zero-height positioning wrapper on mobile. Its list
  // is the visible menu surface users interact with.
  await expect(navigation).toHaveJSProperty("hidden", false);
  await expect(navigationList).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(navigation).toHaveJSProperty("hidden", true);
  await expect(navigationList).toBeHidden();
  await expect(toggle).toBeFocused();

  const skipLink = page.locator(".zilch-skip-link");
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe("zilchContent");

  for (const width of [320, 375, 430]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const motionDuration = await page.locator(".zilch-skip-link").evaluate(element => (
    window.getComputedStyle(element).transitionDuration
  ));
  expect(Number.parseFloat(motionDuration)).toBeLessThanOrEqual(0.01);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("en"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("#zilchNavigation a[href='/zilch/regeln']")).toHaveText("Rules");

  await page.goto("/zilch/regeln");
  await expect(page.getByRole("heading", { name: /zilch.*rules/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /points/i })).toBeVisible();

  // Restore the account preference so this file does not leak a language
  // choice into later independent browser specs.
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }),
    page.locator("[data-language-switcher]").selectOption("de"),
  ]);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await Promise.all([
    page.waitForURL(/\/$/),
    page.locator("[data-game-switch]").click(),
  ]);
  await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
  await expect(page.locator("#createGameCard")).toBeVisible();
});
