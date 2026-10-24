const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });
const password = "private-account-fixture-password";
const finalPassword = `${password}-final`;
const products = [
  { name: "zdwa", path: "/konto", privateRead: "/api/users/me/statistics", nameSelector: "#accountName", form: "#passwordForm", guest: /^\/$/ },
  { name: "zilch", path: "/zilch/konto", privateRead: "/api/zilch/statistics", nameSelector: ".zilch-account-session__name", form: "#zilchPasswordForm", guest: /^\/zilch\/anmelden/ },
];

async function createAccount(context, name) {
  const administrator = await context.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(administrator.ok()).toBe(true);
  const admin = (await administrator.json()).user;
  const created = await context.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username: name, temporary_password: password, role: "user" },
  });
  expect(created.status()).toBe(201);
  const signed = await context.request.post("/api/auth/login", { data: { username: name, password } });
  expect(signed.ok()).toBe(true);
  const user = (await signed.json()).user;
  const changed = await context.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": user.csrf_token },
    data: { current_password: password, new_password: finalPassword },
  });
  expect(changed.ok()).toBe(true);
}

for (const product of products) {
  test(`${product.name} account discards the previous viewer after another tab signs out or switches account`, async ({ page, context }) => {
    const a = `Privacy_${product.name}_A`, b = `Privacy_${product.name}_B`;
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await createAccount(context, a);
    await createAccount(context, b);
    const other = await context.newPage();
    for (const action of ["logout", "switch"]) {
      const signed = await context.request.post("/api/auth/login", { data: { username: a, password: finalPassword } });
      expect(signed.ok()).toBe(true);
      await page.goto(`${product.path}#settings`);
      await expect(page.locator(product.nameSelector)).toContainText(a);
      await expect(page.locator(product.form)).toHaveCount(1);
      await other.goto("/");
      const identity = await other.evaluate(async ({ action, b, password }) => {
        const before = await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json());
        const response = await fetch(action === "switch" ? "/api/auth/login" : "/api/auth/logout", {
          method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": before.user.csrf_token },
          ...(action === "switch" ? { body: JSON.stringify({ username: b, password }) } : {}),
        });
        return { status: response.status, me: await fetch("/api/auth/me", { cache: "no-store" }).then(response => response.json()) };
      }, { action, b, password: finalPassword });
      expect(identity.status).toBe(200);
      expect(identity.me.authenticated).toBe(action === "switch");
      if (action === "switch") expect(identity.me.user.username).toBe(b);
      // Bring-to-front itself may focus; register the network observation first.
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/me");
      await page.bringToFront();
      await page.evaluate(() => dispatchEvent(new Event("focus")));
      await refreshed;
      if (action === "switch") {
        await expect(page.locator(product.nameSelector)).toContainText(b);
        await expect(page.locator(product.form)).toHaveCount(1);
        if (product.name === "zilch") await expect(page.locator("#zilchAccount")).toContainText(b);
      } else {
        await expect.poll(() => new URL(page.url()).pathname).toMatch(product.guest);
        await expect(page.locator(product.form)).toHaveCount(0);
      }
      await expect.poll(async () => (await page.locator("#accountName, .zilch-account-session__name, #zilchAccount").allTextContents()).join("\n")).not.toContain(a);
      expect(errors).toEqual([]);
    }
    if (product.name === "zilch") {
      // Own sign-out keeps the F3 retry and remains the sole navigation owner.
      await page.route("**/api/auth/logout", route => route.fulfill({ status: 503, json: { detail: "local fixture failure" } }));
      await page.locator("#zilchAccountLogout").click();
      await expect(page.locator("[data-zilch-logout-message]")).toBeVisible();
      await expect(page.locator("#zilchAccountLogout")).toBeEnabled();
      await expect(page.locator(product.nameSelector)).toContainText(b);
      await page.unroute("**/api/auth/logout");
      const me = await context.request.get("/api/auth/me").then(response => response.json());
      const destination = me.game_access?.zilch_public || me.user?.game_access?.zilch_public ? "/zilch" : "/";
      const navigations = [];
      page.on("request", request => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(new URL(request.url()).pathname);
      });
      await page.locator("#zilchAccountLogout").click();
      await expect.poll(() => new URL(page.url()).pathname).toBe(destination);
      await page.waitForLoadState("domcontentloaded");
      expect(navigations).toEqual([destination]);
      expect(errors).toEqual([]);
      await expect.poll(async () => (await page.locator("#accountName, .zilch-account-session__name, #zilchAccount").allTextContents()).join("\n")).not.toContain(b);
    }
  });
  test(`${product.name} synthetic persisted lifecycle clears private DOM before a held real response completes`, async ({ page, context }) => {
    const name = `Privacy_lifecycle_${product.name}`;
    await createAccount(context, name);
    expect((await context.request.post("/api/auth/login", { data: { username: name, password: finalPassword } })).ok()).toBe(true);
    let captured;
    const capturedResponse = new Promise(resolve => { captured = resolve; });
    let release;
    const released = new Promise(resolve => { release = resolve; });
    await page.route(`**${product.privateRead}`, async route => {
      // Fetch the real A projection while A is the current server session.
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      captured();
      await released;
      await route.fulfill({ response });
    });
    await page.addInitScript(path => {
      window.__privacyDocument = crypto.randomUUID();
      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (new URL(String(args[0]), location.href).pathname === path) {
          const json = response.json.bind(response);
          response.json = async () => {
            const result = await json();
            requestAnimationFrame(() => { window.__privatePayloadConsumed = true; });
            return result;
          };
        }
        return response;
      };
    }, product.privateRead);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${product.path}#statistics`, { waitUntil: "domcontentloaded" });
    await expect(page.locator(product.nameSelector)).toContainText(name);
    await capturedResponse;
    const before = await page.evaluate(() => window.__privacyDocument);
    // Deterministic handler contract, not a claim that Chromium used BFCache.
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect(page.locator(product.form)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(name);
    if (product.name === "zilch") await expect(page.locator("#zilchAccount")).toBeEmpty();
    release();
    // Observe consumption of this held private response, not unrelated streams.
    await page.waitForFunction(() => window.__privatePayloadConsumed === true);
    await expect(page.locator(product.form)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(name);
    expect(errors).toEqual([]);
    await page.unroute(`**${product.privateRead}`);
    const freshDocument = page.waitForEvent("domcontentloaded");
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await freshDocument;
    expect(await page.evaluate(() => window.__privacyDocument)).not.toBe(before);
    await expect(page.locator(product.nameSelector)).toContainText(name);
    await expect(page.locator(product.form)).toHaveCount(1);
    expect(errors).toEqual([]);
  });
}

test("Zilch's authorized HTML owns one destination when the session ends before its account bundle starts", async ({ page, context }, testInfo) => {
  const name = "Privacy_initial_zilch";
  await createAccount(context, name);
  expect((await context.request.post("/api/auth/login", { data: { username: name, password: finalPassword } })).ok()).toBe(true);
  let bundleRequested;
  const requested = new Promise(resolve => { bundleRequested = resolve; });
  let release;
  const released = new Promise(resolve => { release = resolve; });
  await page.route(/\/static\/zilch\.js(?:\?.*)?$/, async route => {
    bundleRequested();
    await released;
    await route.fallback();
  });
  const errors = [], navigations = [];
  page.on("pageerror", error => errors.push(error.message));
  const document = await page.goto("/zilch/konto#settings", { waitUntil: "commit" });
  expect(document.status()).toBe(200);
  await requested;
  // Settle the real shared auth read while A is still signed in, then end that
  // actual server session before the held account module can initialize.
  const initial = await page.evaluate(async () => (await import("/static/auth.js")).loadAuth({ refresh: true }));
  expect(initial.user.username).toBe(name);
  const ended = await context.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": initial.user.csrf_token } });
  expect(ended.ok()).toBe(true);
  const guest = await context.request.get("/api/auth/me").then(response => response.json());
  expect(guest.authenticated).toBe(false);
  const destination = guest.game_access?.zilch_public ? "/zilch/anmelden" : "/";
  page.on("request", request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) navigations.push(new URL(request.url()).pathname);
  });
  try {
    release();
    await page.waitForURL(url => url.pathname === destination, { waitUntil: "domcontentloaded", timeout: 5000 });
    expect(navigations).toEqual([destination]);
    expect(errors).toEqual([]);
  } finally {
    await testInfo.attach("initial-account-identity-order", {
      body: JSON.stringify({ authorizedDocumentStatus: document.status(), guestBeforeBundle: !guest.authenticated, destination, navigations, errors }),
      contentType: "application/json",
    });
  }
});
