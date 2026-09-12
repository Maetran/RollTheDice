const { test, expect } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const LCARS_FONT = /\/static\/antonio-lcars-v1\.(?:ttf|woff2)(?:\?.*)?$/;
const PUBLIC_AUTH = {
  authenticated: false,
  user: null,
  game_access: { zilch_preview: true, zilch_public: true },
};

function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function installPaintObserver(page, theme = "lcars") {
  await page.addInitScript(appearance => {
    localStorage.setItem("zilch_theme", appearance);
    const metrics = { firstHeading: null, firstContent: null, shifts: [], lcp: [] };
    window.__zilchLoadingMetrics = metrics;
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) metrics.shifts.push({ time: entry.startTime, value: entry.value });
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        metrics.lcp.push({ time: entry.startTime, tag: entry.element?.tagName, text: entry.element?.textContent });
      }
    }).observe({ type: "largest-contentful-paint", buffered: true });
    const inspect = () => {
      const heading = document.querySelector(".zilch-intro--lobby h1");
      const form = document.querySelector("#zilchCreateForm");
      if (metrics.firstHeading === null && heading?.getBoundingClientRect().height) {
        metrics.firstHeading = performance.now();
      }
      if (heading?.getBoundingClientRect().height && form?.getBoundingClientRect().height) {
        metrics.firstContent = performance.now();
      } else requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  }, theme);
}

async function installPublicLobbyFixture(page) {
  // Exercise the shipped public document and bundles without changing the
  // shared browser-test server's fail-closed preview audience. Backend tests
  // cover which routes may receive this server-owned capability marker.
  const template = await readFile(path.join(__dirname, "../../app/static/zilch-lobby.html"), "utf8");
  const body = template.includes('data-zilch-public-lobby="true"')
    ? template
    : template.replace("data-zilch-root", 'data-zilch-root data-zilch-public-lobby="true"');
  await page.route("**/zilch", route => route.fulfill({ status: 200, contentType: "text/html", body }));
  await page.route("**/api/games?**", route => route.fulfill({ json: { games: [] } }));
  await page.route("**/api/zilch/leaderboards?**", route => route.fulfill({ json: { entries: [] } }));
}

async function settlePaint(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function box(page) {
  return page.locator(".zilch-intro--lobby h1").evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
}

async function attachMetrics(page, testInfo) {
  await testInfo.attach("loading-performance.json", {
    body: JSON.stringify(await page.evaluate(() => window.__zilchLoadingMetrics), null, 2),
    contentType: "application/json",
  });
}

test("public LCARS lobby paints while auth and the font are stalled, without a late layout jump", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const authGate = gate();
  const fontGate = gate();
  let authFinished = false;
  let fontRequested = false;
  let fontFinished = false;
  const privateRequests = [];
  page.on("request", request => {
    if (/\/api\/(?:lobby-chat|zilch\/(?:account|statistics|achievements|awards))/.test(request.url())) {
      privateRequests.push(request.url());
    }
  });
  await installPaintObserver(page);
  await installPublicLobbyFixture(page);
  await page.route("**/api/auth/me", async route => {
    await authGate.promise;
    authFinished = true;
    await route.fulfill({ json: PUBLIC_AUTH });
  });
  await page.route(LCARS_FONT, async route => {
    fontRequested = true;
    await fontGate.promise;
    await route.continue();
    fontFinished = true;
  });
  try {
    await page.goto("/zilch", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zilch-intro--lobby h1")).toBeVisible({ timeout: 1000 });
    await expect(page.locator("#zilchCreateForm")).toBeVisible({ timeout: 1000 });
    await expect.poll(() => page.evaluate(() => window.__zilchLoadingMetrics.firstContent)).not.toBeNull();
    expect(await page.evaluate(() => window.__zilchLoadingMetrics.firstContent)).toBeLessThan(1500);
    expect(authFinished).toBe(false);
    await expect.poll(() => fontRequested).toBe(true);
    expect(privateRequests).toEqual([]);
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeDisabled();
    const heading = await page.locator(".zilch-intro--lobby h1").elementHandle();
    const before = await box(page);
    const beforeRelease = await page.evaluate(() => performance.now());

    // Keep the request blocked well beyond Chromium's font block period.
    // Auth remains unresolved, so any later movement is isolated to the font.
    await page.waitForTimeout(3500);
    fontGate.release();
    await expect.poll(() => fontFinished).toBe(true);
    await page.evaluate(() => document.fonts.ready);
    await settlePaint(page);
    await page.waitForTimeout(150);
    const afterFont = await box(page);
    for (const axis of ["x", "y", "width", "height"]) {
      expect(Math.abs(afterFont[axis] - before[axis]), `late font changed heading ${axis}`).toBeLessThan(1);
    }
    const lateFontCls = await page.evaluate(since => window.__zilchLoadingMetrics.shifts
      .filter(entry => entry.time >= since).reduce((sum, entry) => sum + entry.value, 0), beforeRelease);
    expect(lateFontCls).toBeLessThan(0.02);
    const lastLcp = await page.evaluate(() => window.__zilchLoadingMetrics.lcp.at(-1));
    expect(lastLcp?.time, "main content paint must not wait for the delayed font").toBeLessThan(1500);

    authGate.release();
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeEnabled();
    await settlePaint(page);
    expect(await heading.evaluate(element => element.isConnected)).toBe(true);
    expect(await box(page)).toEqual(afterFont);
    const lateCls = await page.evaluate(since => window.__zilchLoadingMetrics.shifts
      .filter(entry => entry.time >= since).reduce((sum, entry) => sum + entry.value, 0), beforeRelease);
    expect(lateCls).toBeLessThan(0.02);
    await attachMetrics(page, testInfo);
  } finally {
    authGate.release();
    fontGate.release();
    await context.close();
  }
});

test("the public Zilch heading paints even when both application scripts are stalled", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const scriptGate = gate();
  const authGate = gate();
  let authRequested = false;
  await installPaintObserver(page);
  await installPublicLobbyFixture(page);
  await page.route(/\/static\/(?:shell|zilch)\.js(?:\?.*)?$/, async route => {
    await scriptGate.promise;
    await route.continue();
  });
  await page.route("**/api/auth/me", async route => {
    authRequested = true;
    await authGate.promise;
    await route.fulfill({ json: PUBLIC_AUTH });
  });
  try {
    await page.goto("/zilch", { waitUntil: "commit" });
    await expect(page.locator(".zilch-intro--lobby h1")).toBeVisible({ timeout: 1000 });
    await expect.poll(() => page.evaluate(() => window.__zilchLoadingMetrics.firstHeading)).not.toBeNull();
    expect(await page.evaluate(() => window.__zilchLoadingMetrics.firstHeading)).toBeLessThan(1500);
    expect(authRequested).toBe(false);
    const heading = await page.locator(".zilch-intro--lobby h1").elementHandle();
    await page.waitForTimeout(3500);
    scriptGate.release();
    await expect(page.locator("#zilchCreateForm")).toBeVisible({ timeout: 1500 });
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeDisabled();
    expect(await heading.evaluate(element => element.isConnected)).toBe(true);
    authGate.release();
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeEnabled();
    expect(await heading.evaluate(element => element.isConnected)).toBe(true);
    await settlePaint(page);
    expect(await page.evaluate(() => window.__zilchLoadingMetrics.shifts
      .reduce((sum, entry) => sum + entry.value, 0))).toBeLessThan(0.1);
    await attachMetrics(page, testInfo);
  } finally {
    scriptGate.release();
    authGate.release();
    await context.close();
  }
});

test("a blocked LCARS font cannot hide the public lobby while auth is pending", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const authGate = gate();
  await installPaintObserver(page);
  await installPublicLobbyFixture(page);
  await page.route("**/api/auth/me", async route => {
    await authGate.promise;
    await route.fulfill({ json: PUBLIC_AUTH });
  });
  await page.route(LCARS_FONT, route => route.abort("failed"));
  try {
    await page.goto("/zilch", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zilch-intro--lobby h1")).toBeVisible({ timeout: 1000 });
    await expect(page.locator("#zilchCreateForm")).toBeVisible();
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__zilchLoadingMetrics.firstContent)).not.toBeNull();
    expect(await page.evaluate(() => window.__zilchLoadingMetrics.firstContent)).toBeLessThan(1500);
    await attachMetrics(page, testInfo);
    await page.locator('[data-zilch-play-mode="cpu"]').click();
    await page.locator("#zilchCpuStrategySelect").selectOption("aggressive");
    authGate.release();
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeEnabled();
    await expect(page.locator('[data-zilch-play-mode="cpu"]')).toHaveAttribute("aria-checked", "true");
    await expect(page.locator("#zilchCpuStrategySelect")).toHaveValue("aggressive");
  } finally {
    authGate.release();
    await context.close();
  }
});

test("the public hero respects English before the delayed Zilch application arrives", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const scriptGate = gate();
  await installPaintObserver(page);
  await page.addInitScript(() => localStorage.setItem("zdwa_language", "en"));
  await installPublicLobbyFixture(page);
  await page.route("**/api/auth/me", route => route.fulfill({ json: PUBLIC_AUTH }));
  // The shared translation bundle may load normally. Zilch's module must
  // not become a prerequisite for translating the server-rendered content.
  await page.route(/\/static\/zilch\.js(?:\?.*)?$/, async route => {
    await scriptGate.promise;
    await route.continue();
  });
  try {
    await page.goto("/zilch", { waitUntil: "commit" });
    const intro = page.locator(".zilch-intro--lobby");
    const title = "Zilch die Wand an – Play the dice game online";
    await expect(intro.locator("h1")).toHaveText(title, { timeout: 1000 });
    await expect(intro.locator(".eyebrow")).toHaveText("Roll online");
    await expect(intro.locator("h1 + p")).toContainText("Choose a seat at the table");
    await expect(intro.locator(".zilch-intro-help a")).toHaveText("Zilch rules and scoring table");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("#zilchCreateForm")).toHaveCount(0);
    const heading = await intro.locator("h1").elementHandle();
    await page.waitForTimeout(3500);
    scriptGate.release();
    await expect(page.locator("#zilchCreateForm")).toBeVisible();
    await expect(intro.locator("h1")).toHaveText(title);
    expect(await heading.evaluate(element => element.isConnected)).toBe(true);
  } finally {
    scriptGate.release();
    await context.close();
  }
});

test("the optional LCARS font loads only when LCARS is selected", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  const fontRequests = [];
  page.on("request", request => {
    if (LCARS_FONT.test(request.url())) fontRequests.push(request.url());
  });
  await installPaintObserver(page, "light");
  await installPublicLobbyFixture(page);
  await page.route("**/api/auth/me", route => route.fulfill({ json: PUBLIC_AUTH }));
  try {
    await page.goto("/zilch");
    await expect(page.locator("#zilchCreateForm")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await settlePaint(page);
    expect(fontRequests).toEqual([]);
    await page.locator("[data-theme-toggle]").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
    await expect.poll(() => fontRequests.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("an unavailable auth endpoint keeps the public lobby readable but cannot create a game", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  const createRequests = [];
  await installPaintObserver(page);
  await installPublicLobbyFixture(page);
  await page.route("**/api/auth/me", route => route.abort("failed"));
  await page.route("**/api/games", route => {
    createRequests.push(route.request().method());
    return route.fulfill({ status: 503, json: {} });
  });
  try {
    await page.goto("/zilch", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".zilch-intro--lobby h1")).toBeVisible({ timeout: 1000 });
    await expect(page.locator("#zilchCreateForm button[type=submit]")).toBeDisabled();
    await expect(page.locator("#zilchCreateError")).not.toBeEmpty();
    // Guard the handler as well as the visual disabled state: keyboard or
    // scripted submit must not race an unconfirmed identity/CSRF bootstrap.
    await page.locator("#zilchCreateForm").evaluate(form => form.requestSubmit());
    await settlePaint(page);
    expect(createRequests).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/zilch");
  } finally {
    await context.close();
  }
});

test("early public rendering never exposes an unconfirmed private account page", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: "block" });
  const page = await context.newPage();
  const authGate = gate();
  try {
    const denied = await context.request.get("/zilch/konto");
    expect(denied.status()).toBe(401);
    // Also exercise the client guard if an already-open private shell survives
    // session expiry. No account request may start before /me confirms access.
    const body = await readFile(path.join(__dirname, "../../app/static/zilch.html"), "utf8");
    await page.route("**/zilch/konto", route => route.fulfill({ status: 200, contentType: "text/html", body }));
    const privateRequests = [];
    page.on("request", request => {
      if (new URL(request.url()).pathname.startsWith("/api/zilch/")) privateRequests.push(request.url());
    });
    await page.route("**/api/auth/me", async route => {
      await authGate.promise;
      await route.fulfill({ json: { authenticated: false, user: null, game_access: { zilch_preview: false, zilch_public: false } } });
    });
    await page.goto("/zilch/konto", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await expect(page.locator("#zilchCreateForm, [id^=zilchAccountPanel-]")).toHaveCount(0);
    expect(privateRequests).toEqual([]);
    authGate.release();
    await page.waitForURL(url => url.pathname === "/");
    expect(privateRequests).toEqual([]);
  } finally {
    authGate.release();
    await context.close();
  }
});
