const { openPasswordLogin, expectPasswordLoginClosed } = require("./password-login");
const { test, expect } = require("@playwright/test");

const PUBLIC_AUTH = {
  authenticated: false,
  user: null,
  game_access: { zilch_preview: false, zilch_public: false },
  registration: { email_enabled: true, turnstile_enabled: true, turnstile_site_key: "local-browser-fixture" },
};
const TURNSTILE_SCRIPT = /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?/;
const TURNSTILE_FIXTURE = `
  window.__turnstileFixture = { renders: 0, resets: [], removed: [], options: null, container: null };
  window.turnstile = {
    render(container, options) {
      window.__turnstileFixture.renders += 1;
      window.__turnstileFixture.options = options;
      window.__turnstileFixture.container = container;
      container.textContent = "Local verification fixture";
      return "local-registration-widget";
    },
    reset(widgetId) { window.__turnstileFixture.resets.push(widgetId); },
    remove(widgetId) {
      window.__turnstileFixture.removed.push(widgetId);
      window.__turnstileFixture.container.replaceChildren();
    }
  };
`;
const ACCOUNT_AUTH = {
  ...PUBLIC_AUTH,
  authenticated: true,
  user: { id: 12345, username: "LocalOnly", is_admin: false, preferences: {} },
};

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function serveTurnstile(route) {
  await route.fulfill({ contentType: "application/javascript", body: TURNSTILE_FIXTURE });
}

async function fillRegistration(page) {
  await page.fill('#registrationUsername', 'LocalOnly');
  await page.fill('#registrationEmail', 'local@example.test');
}

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page, baseURL }) => {
  // This fixture never talks to production accounts or real CAPTCHA services.
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL).hostname);
  await page.route("https://challenges.cloudflare.com/**", route => route.abort());
  await page.route("**/api/auth/me", route => route.fulfill({ json: PUBLIC_AUTH }));
});

test("anonymous lobby, guest controls and ordinary login focus do not request CAPTCHA", async ({ page }) => {
  const challengeRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).hostname === "challenges.cloudflare.com") challengeRequests.push(request.url());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expectPasswordLoginClosed(page);
  await expect(page.locator("#registrationChallenge")).toBeHidden();
  await page.fill("#playerName", "GuestPerformance");
  await page.getByRole("radio", { name: "1 Spieler, Solo" }).click();
  await openPasswordLogin(page);
  await page.fill("#loginUsername", "LocalOnly");
  await page.fill("#loginPassword", "local-password-123");
  await expect(page.locator("#createBtn")).toBeEnabled();
  expect(challengeRequests).toEqual([]);
  await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
});

test("Classic lobby paints while identity and handwriting fonts are stalled without a late font shift", async ({ page }, testInfo) => {
  const authGate = gate();
  const fontGate = gate();
  let fontRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("wuerfler_theme", "classic");
    window.__fontLayoutShifts = [];
    if (PerformanceObserver.supportedEntryTypes.includes("layout-shift")) {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) window.__fontLayoutShifts.push({ at: entry.startTime, value: entry.value });
        }
      }).observe({ type: "layout-shift", buffered: true });
    }
  });
  await page.route("**/api/auth/me", async route => {
    await authGate.promise;
    await route.fulfill({ json: PUBLIC_AUTH });
  });
  await page.route("**/static/kalam-classic-*.woff2*", async route => {
    fontRequests += 1;
    await fontGate.promise;
    await route.continue();
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("#createBtn")).toBeVisible({ timeout: 2000 });
    await expect(page.locator("#createBtn")).toBeEnabled();
    const contentVisibleAt = await page.evaluate(() => performance.now());
    expect(contentVisibleAt).toBeLessThan(2500);
    await expect.poll(() => fontRequests).toBeGreaterThan(0);
    // Deliberately exceed the optional font's first-paint window. Auth stays
    // blocked while the late fonts finish, isolating font-induced movement.
    await page.waitForTimeout(3000);
    const before = await page.locator("h1").boundingBox();
    const fontsReleasedAt = await page.evaluate(() => performance.now());
    fontGate.release();
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const after = await page.locator("h1").boundingBox();
    const lateCls = await page.evaluate(since => PerformanceObserver.supportedEntryTypes.includes("layout-shift")
      ? window.__fontLayoutShifts.filter(entry => entry.at >= since).reduce((sum, entry) => sum + entry.value, 0)
      : null, fontsReleasedAt);
    if (lateCls !== null) expect(lateCls).toBeLessThan(0.01);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
    await expect(page.locator("#createBtn")).toBeEnabled();
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
    await testInfo.attach("stalled-auth-font-metrics", {
      body: JSON.stringify({ contentVisibleAt, fontRequests, before, after, lateCls }),
      contentType: "application/json",
    });
  } finally {
    authGate.release();
    fontGate.release();
  }
});

for (const registrationClick of [false, true]) {
  test(`delayed signed-in identity does not start a hidden CAPTCHA (${registrationClick ? "registration click" : "restored login focus"})`, async ({ page }) => {
    const authGate = gate();
    let challengeRequests = 0;
    let registrationRequests = 0;
    await page.route("**/api/auth/me", async route => {
      await authGate.promise;
      await route.fulfill({ json: ACCOUNT_AUTH });
    });
    await page.route(TURNSTILE_SCRIPT, async route => {
      challengeRequests += 1;
      await serveTurnstile(route);
    });
    await page.route("**/api/auth/register", async route => {
      registrationRequests += 1;
      await route.fulfill({ status: 403, json: { detail: "captcha_required" } });
    });
    try {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await openPasswordLogin(page);
      await page.locator("#loginUsername").focus();
      if (registrationClick) {
        await fillRegistration(page);
        await page.click("#registerBtn");
        await expect(page.locator("#registerBtn")).toBeDisabled();
      }
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("#createBtn")).toBeEnabled();
      expect(challengeRequests).toBe(0);
      authGate.release();
      await expect(page.locator("#authBadge")).toContainText("LocalOnly");
      await expect(page.locator("#loginForm")).toBeHidden();
      await expect(page.locator("#registrationChallenge")).toBeHidden();
      await expect(page.locator("#registerBtn")).toBeEnabled();
      await expect(page.locator("#loginError")).toBeEmpty();
      await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
      expect(challengeRequests).toBe(0);
      expect(registrationRequests).toBe(0);
    } finally {
      authGate.release();
    }
  });
}

test("ordinary successful login makes no CAPTCHA request", async ({ page }) => {
  let signedIn = false;
  let challengeRequests = 0;
  await page.route(TURNSTILE_SCRIPT, async route => {
    challengeRequests += 1;
    await serveTurnstile(route);
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: signedIn ? ACCOUNT_AUTH : PUBLIC_AUTH }));
  await page.route("**/api/auth/login", async route => {
    signedIn = true;
    await route.fulfill({ json: ACCOUNT_AUTH });
  });
  await page.goto("/");
  await openPasswordLogin(page);
  await page.fill("#loginUsername", "LocalOnly");
  await page.fill("#loginPassword", "local-password-123");
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("LocalOnly");
  await expect(page.locator("#loginForm")).toBeHidden();
  expect(challengeRequests).toBe(0);
  await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
});

test("login cancels a pending registration script without rendering a hidden widget", async ({ page }) => {
  let signedIn = false;
  const scriptGate = gate();
  let challengeRequests = 0;
  let scriptSettled = false;
  let registrationRequests = 0;
  await page.route(TURNSTILE_SCRIPT, async route => {
    challengeRequests += 1;
    await scriptGate.promise;
    await serveTurnstile(route);
    scriptSettled = true;
  });
  await page.route("**/api/auth/me", route => route.fulfill({ json: signedIn ? ACCOUNT_AUTH : PUBLIC_AUTH }));
  await page.route("**/api/auth/login", async route => {
    signedIn = true;
    await route.fulfill({ json: ACCOUNT_AUTH });
  });
  await page.route("**/api/auth/register", async route => {
    registrationRequests += 1;
    await route.fulfill({ status: 403, json: { detail: "captcha_required" } });
  });
  try {
    await page.goto("/");
    await openPasswordLogin(page);
    await page.fill("#loginUsername", "LocalOnly");
    await page.fill("#loginPassword", "local-password-123");
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect.poll(() => challengeRequests).toBe(1);
    await expect(page.locator("#registerBtn")).toBeDisabled();
    await page.click("#loginForm button[type=submit]");
    await expect(page.locator("#authBadge")).toContainText("LocalOnly");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    await expect(page.locator("#registrationChallenge")).toBeHidden();
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
    scriptGate.release();
    await expect.poll(() => scriptSettled).toBe(true);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => window.__turnstileFixture?.renders || 0)).toBe(0);
    await expect(page.locator("#loginError")).toBeEmpty();
    expect(registrationRequests).toBe(0);
  } finally {
    scriptGate.release();
  }
});

test("login removes an active widget and retired callbacks cannot restore a token after logout", async ({ page }) => {
  let signedIn = false;
  const registrations = [];
  await page.route("**/api/auth/me", route => route.fulfill({ json: signedIn ? ACCOUNT_AUTH : PUBLIC_AUTH }));
  await page.route("**/api/auth/login", async route => {
    signedIn = true;
    await route.fulfill({ json: ACCOUNT_AUTH });
  });
  await page.route("**/api/auth/logout", async route => {
    signedIn = false;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route(TURNSTILE_SCRIPT, serveTurnstile);
  await page.route("**/api/auth/register", async route => {
    registrations.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { detail: "captcha_invalid" } });
  });
  await page.goto("/");
  await openPasswordLogin(page);
  await page.fill("#loginUsername", "LocalOnly");
  await page.fill("#loginPassword", "local-password-123");
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect(page.locator("#registrationChallenge")).toHaveText("Local verification fixture");
  await page.evaluate(() => { window.__retiredTurnstileOptions = window.__turnstileFixture.options; });
  await page.click("#loginForm button[type=submit]");
  await expect(page.locator("#authBadge")).toContainText("LocalOnly");
  await expect(page.locator("#registrationChallenge")).toBeHidden();
  await expect(page.locator("#registrationChallenge")).toBeEmpty();
  expect(await page.evaluate(() => window.__turnstileFixture.removed)).toEqual(["local-registration-widget"]);
  expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual([]);
  await page.click("#logoutBtn");
  await expectPasswordLoginClosed(page);
  await openPasswordLogin(page);
  await page.fill("#loginPassword", "local-password-123");
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect.poll(() => page.evaluate(() => window.__turnstileFixture.renders)).toBe(2);
  await page.evaluate(() => window.__retiredTurnstileOptions.callback("retired-token"));
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
  expect(registrations).toEqual([]);
  await page.evaluate(() => window.__turnstileFixture.options.callback("current-token"));
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect(page.locator("#loginError")).toContainText("abgelaufen oder ungültig");
  expect(registrations).toHaveLength(1);
  expect(registrations[0].turnstile_token).toBe("current-token");
  expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual(["local-registration-widget"]);
});

test("explicit registration shares one deferred widget and requires a fresh token", async ({ page }) => {
  const scriptGate = gate();
  let scriptRequests = 0;
  const registrations = [];
  await page.route(TURNSTILE_SCRIPT, async route => {
    scriptRequests += 1;
    await scriptGate.promise;
    await serveTurnstile(route);
  });
  await page.route("**/api/auth/register", async route => {
    registrations.push(route.request().postDataJSON());
    await route.fulfill({ status: 400, json: { detail: "captcha_invalid" } });
  });
  try {
    await page.goto("/");
    await openPasswordLogin(page);
    await page.fill("#loginUsername", "LocalOnly");
    await page.fill("#loginPassword", "local-password-123");
    expect(scriptRequests).toBe(0);
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect(page.locator("#registerBtn")).toBeDisabled();
    expect(scriptRequests).toBe(1);
    expect(registrations).toEqual([]);
    scriptGate.release();
    await expect(page.locator("#registrationChallenge")).toHaveText("Local verification fixture");
    await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
    expect(await page.evaluate(() => window.__turnstileFixture.renders)).toBe(1);
    expect(await page.evaluate(() => window.__turnstileFixture.options.action)).toBe("register");
    await page.evaluate(() => window.__turnstileFixture.options.callback("first-local-token"));
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toContainText("abgelaufen oder ungültig");
    expect(registrations).toHaveLength(1);
    expect(registrations[0].turnstile_token).toBe("first-local-token");
    expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual(["local-registration-widget"]);

    await fillRegistration(page);

    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
    expect(registrations).toHaveLength(1);
    expect(scriptRequests).toBe(1);
  } finally {
    scriptGate.release();
  }
});

test("expired and failed challenges cannot register before a new successful challenge", async ({ page }) => {
  const registrations = [];
  await page.route(TURNSTILE_SCRIPT, serveTurnstile);
  await page.route("**/api/auth/register", async route => {
    registrations.push(route.request().postDataJSON());
    await route.fulfill({ status: 202, json: { accepted: true } });
  });
  await page.goto("/");
  await openPasswordLogin(page);
  await page.fill("#loginUsername", "LocalOnly");
  await page.fill("#loginPassword", "local-password-123");
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect(page.locator("#registrationChallenge")).toHaveText("Local verification fixture");
  for (const callback of ["expired-callback", "error-callback", "timeout-callback"]) {
    await page.evaluate(name => {
      window.__turnstileFixture.options.callback("discard-local-token");
      window.__turnstileFixture.options[name]();
    }, callback);
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
    expect(registrations).toEqual([]);
  }
  await page.evaluate(() => window.__turnstileFixture.options.callback("fresh-local-token"));
  await fillRegistration(page);
  await page.click("#registerBtn");
  await expect(page.locator("#loginError")).toContainText("Bestätigungslink");
  await expect(page.locator("#loginForm")).toBeVisible();
  expect(registrations).toHaveLength(1);
  expect(registrations[0].turnstile_token).toBe("fresh-local-token");
  expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual(["local-registration-widget"]);
  expect(await page.evaluate(() => window.__turnstileFixture.removed)).toEqual([]);
});

test("a failed deferred script can be retried and never blocks ordinary login", async ({ page }) => {
  const scriptGate = gate();
  let scriptRequests = 0;
  let loginRequests = 0;
  let registrationRequests = 0;
  await page.route(TURNSTILE_SCRIPT, async route => {
    scriptRequests += 1;
    if (scriptRequests === 1) {
      await scriptGate.promise;
      await route.abort();
    } else await serveTurnstile(route);
  });
  await page.route("**/api/auth/register", async route => {
    registrationRequests += 1;
    await route.fulfill({ status: 403, json: { detail: "captcha_required" } });
  });
  await page.route("**/api/auth/login", async route => {
    loginRequests += 1;
    await route.fulfill({ status: 401, json: { detail: "invalid_credentials" } });
  });
  try {
    await page.goto("/");
    await openPasswordLogin(page);
    await page.fill("#loginUsername", "LocalOnly");
    await page.fill("#loginPassword", "local-password-123");
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect.poll(() => scriptRequests).toBe(1);
    scriptGate.release();
    await expect(page.locator("#loginError")).toContainText("Sicherheitsprüfung ist momentan nicht erreichbar");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
    await page.click("#loginForm button[type=submit]");
    await expect(page.locator("#loginError")).toHaveText("Benutzername oder Passwort ist falsch.");
    expect(loginRequests).toBe(1);
    expect(scriptRequests).toBe(1);

    await fillRegistration(page);

    await page.click("#registerBtn");
    await expect(page.locator("#registrationChallenge")).toHaveText("Local verification fixture");
    await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
    expect(scriptRequests).toBe(2);
    expect(registrationRequests).toBe(0);
    expect(await page.evaluate(() => window.__turnstileFixture.renders)).toBe(1);
  } finally {
    scriptGate.release();
  }
});

test("registration waits for the security configuration and fails closed if it is unavailable", async ({ page }) => {
  const authGate = gate();
  let registrationRequests = 0;
  await page.route("**/api/auth/me", async route => {
    await authGate.promise;
    await route.fulfill({ status: 503, json: { detail: "unavailable" } });
  });
  await page.route("**/api/auth/register", async route => {
    registrationRequests += 1;
    await route.fulfill({ status: 403, json: { detail: "captcha_required" } });
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect(page.locator("#registerBtn")).toBeDisabled();
    expect(registrationRequests).toBe(0);
    authGate.release();
    await expect(page.locator("#loginError")).toContainText("Sicherheitsprüfung ist momentan nicht erreichbar");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    expect(registrationRequests).toBe(0);
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
  } finally {
    authGate.release();
  }
});

for (const [description, registration] of [
  ["missing configuration", null],
  ["invalid enabled flag", { turnstile_enabled: "false" }],
  ["missing sitekey", { turnstile_enabled: true }],
]) {
  test(`registration rejects ${description}`, async ({ page }) => {
    let registrationRequests = 0;
    await page.route("**/api/auth/me", route => route.fulfill({ json: { ...PUBLIC_AUTH, registration } }));
    await page.route("**/api/auth/register", async route => {
      registrationRequests += 1;
      await route.fulfill({ status: 403, json: { detail: "captcha_required" } });
    });
    await page.goto("/");
    await fillRegistration(page);
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toContainText("Sicherheitsprüfung ist momentan nicht erreichbar");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    expect(registrationRequests).toBe(0);
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
  });
}
