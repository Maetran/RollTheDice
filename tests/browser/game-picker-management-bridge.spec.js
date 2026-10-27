const { test, expect } = require("@playwright/test");
const { openPasswordLogin } = require("./password-login");

test.use({ serviceWorkers: "block" });

test("installed Hausdepp dashboard bridge returns through the real sign-in form without leaving its origin", async ({ page, baseURL }) => {
  const origin = new URL(baseURL).origin;
  expect(new URL(origin).hostname).toBe("127.0.0.1");
  const dashboardPath = "/zdwa/admin/dashboard";
  const loginPath = "/zdwa/anmelden";
  const loginQuery = "?return_to=%2Fzdwa%2Fadmin%2Fdashboard";
  const documents = [];
  const externalRequests = [];
  page.on("request", request => {
    if (new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  await page.route(url => url.origin !== origin, route => route.abort("blockedbyclient"));
  await page.addInitScript(() => {
    localStorage.setItem("zdwa_language", "de");
    sessionStorage.setItem("rollthedice:pwa-entry:v1", "hausdepp");
    Object.defineProperty(Navigator.prototype, "standalone", { configurable: true, get: () => true });
  });
  // Only the two document GETs use production host semantics. Their actual
  // URLs, cookies, assets and every real auth/analytics API stay on this
  // disposable loopback server; no request reaches the production host.
  await page.route(url => url.origin === origin && [dashboardPath, loginPath].includes(url.pathname), async route => {
    const request = route.request();
    if (request.method() !== "GET" || !request.isNavigationRequest()) return route.continue();
    const response = await route.fetch({
      headers: { ...request.headers(), host: "hausdepp.zockdiewandan.online" }, maxRedirects: 0,
    });
    documents.push({
      path: new URL(request.url()).pathname,
      status: response.status(), location: response.headers().location || null,
      cache: response.headers()["cache-control"], robots: response.headers()["x-robots-tag"],
    });
    await route.fulfill({ response });
  });

  await page.goto(dashboardPath);
  await expect(page).toHaveURL(`${origin}${loginPath}${loginQuery}`);
  expect(documents).toContainEqual({
    path: dashboardPath, status: 303, location: `${loginPath}${loginQuery}`,
    cache: "no-store", robots: "noindex, nofollow",
  });
  // Playwright routes only the first request in an HTTP redirect chain.
  // Reopen the verified local destination once so the login document receives
  // the same Host fixture; its real UI, cookie login and return stay untouched.
  await page.goto(`${loginPath}${loginQuery}`);
  await expect(page.locator("html")).toHaveAttribute("data-zdwa-pwa-bridge", "true");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("data-pwa-product", "hausdepp");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /\/hausdepp-manifest\.webmanifest\?/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/hausdepp-apple-touch-icon-180-v2\.png\?/);

  await openPasswordLogin(page, true);
  await page.locator("#zilchLoginUsername").fill("Admin");
  await page.locator("#zilchLoginPassword").fill("temporary-password-123");
  const telemetry = page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/analytics"
    && response.request().method() === "GET");
  const [loginResponse] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/login"
      && response.request().method() === "POST"),
    page.locator('#zilchLoginForm button[type="submit"]').click(),
  ]);
  expect(loginResponse.ok()).toBe(true);
  expect((await loginResponse.json()).user.is_founder).toBe(true);
  await expect(page).toHaveURL(`${origin}${dashboardPath}`);
  const dataResponse = await telemetry;
  expect(dataResponse.ok()).toBe(true);
  expect((await dataResponse.json()).period.game).toBe("all");
  await expect(page.locator("#connectionLabel")).toHaveText(/Telemetrie verbunden|Telemetry connected/);
  await expect(page.locator("#dashboardData")).toBeVisible();
  await expect(page.locator("#dashboardData")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator("#overviewMetrics .metric-card").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-zdwa-pwa-bridge", "true");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("data-pwa-product", "hausdepp");
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /\/hausdepp-manifest\.webmanifest\?/);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/hausdepp-apple-touch-icon-180-v2\.png\?/);
  await expect(page.locator(".mission-brand")).toHaveAttribute("href", "/zdwa");
  await expect(page.locator(".account-link")).toHaveAttribute("href", "/zdwa/konto");
  expect(documents).toContainEqual({ path: dashboardPath, status: 200, location: null,
    cache: "no-store", robots: "noindex, nofollow" });
  expect(externalRequests).toEqual([]);
});
