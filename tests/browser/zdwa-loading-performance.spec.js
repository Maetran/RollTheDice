const { test, expect } = require("@playwright/test");

const PUBLIC_AUTH = {
  authenticated: false,
  user: null,
  game_access: { zilch_preview: false, zilch_public: false },
  registration: { turnstile_enabled: true, turnstile_site_key: "local-browser-fixture" },
};
const TURNSTILE_SCRIPT = /https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?/;
const TURNSTILE_FIXTURE = `
  window.__turnstileFixture = { renders: 0, resets: [], options: null };
  window.turnstile = {
    render(container, options) {
      window.__turnstileFixture.renders += 1;
      window.__turnstileFixture.options = options;
      container.textContent = "Local verification fixture";
      return "local-registration-widget";
    },
    reset(widgetId) { window.__turnstileFixture.resets.push(widgetId); }
  };
`;

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function serveTurnstile(route) {
  await route.fulfill({ contentType: "application/javascript", body: TURNSTILE_FIXTURE });
}

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

test.beforeEach(async ({ page, baseURL }) => {
  // This fixture never talks to production accounts or real CAPTCHA services.
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(new URL(baseURL).hostname);
  await page.route("https://challenges.cloudflare.com/**", route => route.abort());
  await page.route("**/api/auth/me", route => route.fulfill({ json: PUBLIC_AUTH }));
});

test("anonymous lobby and guest controls do not request registration CAPTCHA", async ({ page }) => {
  const challengeRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).hostname === "challenges.cloudflare.com") challengeRequests.push(request.url());
  });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("#loginForm")).toBeVisible();
  await expect(page.locator("#registrationChallenge")).toBeHidden();
  await page.fill("#playerName", "GuestPerformance");
  await page.getByRole("radio", { name: "1 Spieler, Solo" }).click();
  await expect(page.locator("#createBtn")).toBeEnabled();
  expect(challengeRequests).toEqual([]);
  await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
});

test("account intent shares one deferred widget and registration requires a fresh token", async ({ page }) => {
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
    await page.fill("#loginUsername", "LocalOnly");
    await page.fill("#loginPassword", "local-password-123");
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
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toContainText("abgelaufen oder ungültig");
    expect(registrations).toHaveLength(1);
    expect(registrations[0].turnstile_token).toBe("first-local-token");
    expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual(["local-registration-widget"]);

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
    await route.fulfill({ json: {
      ...PUBLIC_AUTH,
      authenticated: true,
      user: { id: 12345, username: "LocalOnly", is_admin: false, preferences: {} },
    } });
  });
  await page.goto("/");
  await page.fill("#loginUsername", "LocalOnly");
  await page.fill("#loginPassword", "local-password-123");
  await expect(page.locator("#registrationChallenge")).toHaveText("Local verification fixture");
  for (const callback of ["expired-callback", "error-callback", "timeout-callback"]) {
    await page.evaluate(name => {
      window.__turnstileFixture.options.callback("discard-local-token");
      window.__turnstileFixture.options[name]();
    }, callback);
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toHaveText("Bitte bestätige zuerst, dass du kein Bot bist.");
    expect(registrations).toEqual([]);
  }
  await page.evaluate(() => window.__turnstileFixture.options.callback("fresh-local-token"));
  await page.click("#registerBtn");
  await expect(page.locator("#authBadge")).toContainText("LocalOnly");
  await expect(page.locator("#loginForm")).toBeHidden();
  expect(registrations).toHaveLength(1);
  expect(registrations[0].turnstile_token).toBe("fresh-local-token");
  expect(await page.evaluate(() => window.__turnstileFixture.resets)).toEqual(["local-registration-widget"]);
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
    await page.fill("#loginUsername", "LocalOnly");
    await page.fill("#loginPassword", "local-password-123");
    await expect.poll(() => scriptRequests).toBe(1);
    scriptGate.release();
    await expect(page.locator("#loginError")).toContainText("Sicherheitsprüfung ist momentan nicht erreichbar");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
    await page.click("#loginForm button[type=submit]");
    await expect(page.locator("#loginError")).toHaveText("Benutzername oder Passwort ist falsch.");
    expect(loginRequests).toBe(1);
    expect(scriptRequests).toBe(1);

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
    await page.click("#registerBtn");
    await expect(page.locator("#loginError")).toContainText("Sicherheitsprüfung ist momentan nicht erreichbar");
    await expect(page.locator("#registerBtn")).toBeEnabled();
    expect(registrationRequests).toBe(0);
    await expect(page.locator("script[data-rollthedice-turnstile]")).toHaveCount(0);
  });
}
