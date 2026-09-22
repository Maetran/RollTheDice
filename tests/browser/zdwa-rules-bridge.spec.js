const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

for (const fixture of [
  { language: "de", viewport: { width: 1440, height: 900 }, heading: "Zock die Wand an: Spielregeln" },
  { language: "en", viewport: { width: 390, height: 844 }, heading: "Zock die Wand an: Game Rules" },
]) {
  test(`Zilch PWA keeps embedded ZDWA rules when opening and reopening in ${fixture.language}`, async ({ page, request, baseURL }, testInfo) => {
    const created = await request.post("/api/games", {
      data: { name: `Rules bridge ${fixture.language}`, mode: 1 },
    });
    expect(created.ok()).toBeTruthy();
    const { game_id: gameId } = await created.json();
    const hostname = "zilch.zockdiewandan.online";
    const origin = `https://${hostname}`;
    const nginx = await readFile(path.join(__dirname, "../../deploy/nginx/rollthedice.conf"), "utf8");
    const policies = [...nginx.matchAll(/add_header\s+Content-Security-Policy\s+"([^"]+)"\s+always;/g)].map(match => match[1]);
    const policy = policies.find(value => value.includes("script-src"));
    expect(policy, "the application Nginx CSP must be present").toBeTruthy();

    await page.setViewportSize(fixture.viewport);
    await page.addInitScript(language => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
      localStorage.setItem("zdwa_language", language);
      localStorage.setItem("wuerfler_theme", "light");
    }, fixture.language);

    // Every browser request is intercepted. The apparent production host is
    // served exclusively by the local test server; no production HTTP or
    // WebSocket connection is made, including unexpected cross-origin links.
    const sockets = [];
    // Keep the isolated client-side socket open during the UI assertions so
    // an artificial reconnect banner cannot obscure the desktop menu.
    await page.routeWebSocket("**/*", socket => sockets.push(socket));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) {
        await route.abort();
        return;
      }
      const response = await route.fetch({
        url: `${baseURL}${url.pathname}${url.search}`,
        headers: { ...route.request().headers(), host: hostname },
        maxRedirects: 0,
      });
      if ([301, 302, 303, 307, 308].includes(response.status())) {
        // A browser HTTP redirect chain would bypass route interception.
        // Reissue verified same-origin redirects as intercepted navigations.
        const target = new URL(response.headers().location, url);
        expect(target.origin).toBe(origin);
        const escapedTarget = target.href.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: `<!doctype html><meta http-equiv="refresh" content="0;url=${escapedTarget}">`,
        });
        return;
      }
      const headers = { ...response.headers() };
      if (route.request().resourceType() === "document") headers["content-security-policy"] = policy;
      await route.fulfill({ response, headers });
    });

    try {
      await page.goto(`${origin}/zdwa/spiel/${encodeURIComponent(gameId)}?name=RulesBridge`);
      await expect(page.locator("html")).toHaveAttribute("data-game", "zdwa");
      const roomURL = page.url();
      const frame = page.frameLocator("#rulesFrame");
      for (let opening = 0; opening < 2; opening += 1) {
        await page.locator("#roomHeaderMenuToggle").click();
        await page.locator("#rulesSheetOpen").click();
        await expect(page.locator("#rulesSheet")).toBeVisible();
        await expect(page.locator("#rulesFrame")).toHaveAttribute("src", "/zdwa/regeln?embed=1");
        await expect(frame.getByRole("heading", { name: fixture.heading, exact: true })).toBeVisible();
        await expect(frame.locator("html")).toHaveAttribute("data-game", "zdwa");
        await expect(frame.locator("body")).toHaveClass(/embedded-rules/);
        expect(await frame.locator("html").evaluate(() => location.href)).toBe(`${origin}/zdwa/regeln?embed=1`);
        if (opening === 0) await page.screenshot({ path: testInfo.outputPath(`zdwa-rules-bridge-${fixture.language}.png`) });
        await page.locator("#rulesSheetClose").click();
        await expect(page.locator("#rulesSheet")).toBeHidden();
        await expect(page.locator("#rulesSheetBackdrop")).toBeHidden();
        await expect(page).toHaveURL(roomURL);
      }
    } finally {
      for (const socket of sockets) socket.close();
    }
  });
}
