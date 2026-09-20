const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

// Exercise the real workers with an isolated, anonymous HTTP fixture. No
// production account, push recipient or gameplay endpoint is involved.
async function workerServer(product, { backend } = {}) {
  const script = fs.readFileSync(path.join(__dirname, `../../app/static/${product === "zilch" ? "zilch-sw" : "sw"}.js`), "utf8");
  const requests = [];
  let disconnected = false;
  let legacyWorker = false;
  const server = http.createServer((request, response) => {
    if (disconnected) { request.socket.destroy(); return; }
    const pathname = new URL(request.url, "http://localhost").pathname;
    requests.push({ pathname, method:request.method });
    if (backend) {
      const upstream = http.request(new URL(request.url, backend), {
        method:request.method,
        headers:{ ...request.headers, host:product === "zilch" ? "zilch.zockdiewandan.online" : "zockdiewandan.online" },
      }, result => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.on("error", () => response.destroy());
      request.pipe(upstream);
      return;
    }
    if (pathname.endsWith("sw.js")) {
      response.writeHead(200, { "Content-Type":"text/javascript", "Service-Worker-Allowed":"/", "Cache-Control":"no-store" });
      response.end(legacyWorker ? "self.addEventListener('activate', event => event.waitUntil(self.clients.claim())); self.addEventListener('fetch', event => event.respondWith(fetch(event.request)));" : script);
      return;
    }
    if (pathname === "/cache-helper.js") {
      response.writeHead(200, { "Content-Type":"text/javascript" });
      response.end(fs.readFileSync(path.join(__dirname, "../../frontend/offline/cache.js"), "utf8"));
      return;
    }
    if (pathname.startsWith("/static/")) {
      response.writeHead(200, { "Content-Type":pathname.endsWith(".js") ? "text/javascript" : "text/plain" });
      response.end("/* public offline asset */");
      return;
    }
    if (pathname.endsWith("/offline-spielen")) {
      const game = pathname.startsWith("/zilch/") ? "zilch" : pathname.startsWith("/zdwa/") ? "zdwa" : product;
      response.writeHead(200, { "Content-Type":"text/html", "X-Robots-Tag":"noindex" });
      response.end(`<!doctype html><html data-game="${game}"><head><title>Offline entry</title></head><body><h1>Confirm offline play</h1><button>Activate</button></body></html>`);
      return;
    }
    response.writeHead(200, { "Content-Type":"text/html", "Cache-Control":"no-store" });
    response.end("<!doctype html><html><body><h1>Private online content</h1></body></html>");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    origin:`http://127.0.0.1:${server.address().port}`, requests,
    version:script.match(/const CACHE_VERSION = 'assets-([^']+)'/)[1],
    disconnect:value => { disconnected = value; }, legacy:value => { legacyWorker = value; },
    close:() => new Promise(resolve => server.close(resolve)),
  };
}

for (const product of ["zdwa", "zilch"]) {
  test(`${product} worker caches only local practice and starts offline with explicit entry`, async ({ browser, browserName }) => {
    const fixture = await workerServer(product);
    const context = await browser.newContext({ serviceWorkers:"allow" });
    const page = await context.newPage();
    try {
      await page.goto(fixture.origin);
      await page.evaluate(async productName => {
        await caches.open("runtime-assets-old");
        await caches.open("unrelated-cache");
        await navigator.serviceWorker.register(productName === "zilch" ? "/zilch-sw.js" : "/sw.js");
        await navigator.serviceWorker.ready;
      }, product);
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      const status = await page.evaluate(() => new Promise(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = event => resolve(event.data);
        navigator.serviceWorker.controller.postMessage({ type:"OFFLINE_STATUS" }, [channel.port2]);
      }));
      expect(status.ready).toBe(true);
      const cacheKeys = await page.evaluate(() => caches.keys());
      expect(cacheKeys).toContain("unrelated-cache");
      expect(cacheKeys).not.toContain("runtime-assets-old");

      await page.goto(`${fixture.origin}/konto`);
      await page.evaluate(async () => {
        await fetch("/api/auth/me");
        await fetch("/api/games", { method:"POST", body:"test-local-only" });
      });
      const cachePaths = await page.evaluate(async () => {
        const keys = await caches.keys();
        return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat();
      });
      expect(cachePaths).toContain("/offline-spielen");
      expect(cachePaths).toContain("/static/offline-play.js");
      expect(cachePaths.every(value => value.endsWith("/offline-spielen") || value.startsWith("/static/"))).toBe(true);
      expect(cachePaths).not.toContain("/konto");
      expect(cachePaths).not.toContain("/api/auth/me");

      // WebKit's protocol-level offline emulation rejects a new page before
      // its worker can respond. A disconnected HTTP transport exercises the
      // same fetch rejection in that engine without bypassing the worker.
      if (browserName === "webkit") fixture.disconnect(true);
      else await context.setOffline(true);
      // A fresh PWA window can reach the choice screen offline. Reloading an
      // online room also offers a choice, never stale online state.
      const freshPage = await context.newPage();
      await freshPage.goto(fixture.origin);
      await expect(freshPage.locator("h1")).toHaveText("Confirm offline play");
      await expect(freshPage.locator("html")).toHaveAttribute("data-game", product);
      await freshPage.goto(`${fixture.origin}/spiel/existing-online-game`);
      await expect(freshPage.locator("h1")).toHaveText("Confirm offline play");
      const otherPath = product === "zilch" ? "/zdwa/spiel/old" : "/zilch/spiel/old";
      await freshPage.goto(`${fixture.origin}${otherPath}`);
      await expect(freshPage.locator("html")).toHaveAttribute("data-game", product === "zilch" ? "zdwa" : "zilch");
      const asset = await freshPage.evaluate(() => fetch("/static/offline-play.js?v=new-version").then(response => response.text()));
      expect(asset).toContain("public offline asset");
      const apiResult = await freshPage.evaluate(() => fetch("/api/auth/me").then(response => response.status).catch(() => "network-error"));
      expect(apiResult).toBe(product === "zdwa" ? 503 : "network-error");
      await freshPage.reload();
      await expect(freshPage.locator("h1")).toHaveText("Confirm offline play");
      fixture.disconnect(false);
      await context.setOffline(false);
      await freshPage.goto(`${fixture.origin}/konto`);
      await expect(freshPage.locator("h1")).toHaveText("Private online content");
    } finally {
      await context.close();
      await fixture.close();
    }
  });

  test(`${product} offline preparation upgrades an old worker and verifies the current bundle`, async ({ browser }) => {
    const fixture = await workerServer(product);
    fixture.legacy(true);
    const context = await browser.newContext({ serviceWorkers:"allow" });
    const page = await context.newPage();
    try {
      await page.goto(fixture.origin);
      await page.evaluate(async productName => {
        await navigator.serviceWorker.register(productName === "zilch" ? "/zilch-sw.js" : "/sw.js");
        await navigator.serviceWorker.ready;
      }, product);
      await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
      const otherPage = await context.newPage();
      await otherPage.goto(`${fixture.origin}/spiel/still-online`);
      await otherPage.evaluate(() => { window.gameMarker = "same-game"; });
      fixture.legacy(false);
      const result = await page.evaluate(async ({ productName, version }) => {
        const manifest = document.createElement("link");
        manifest.rel = "manifest";
        manifest.href = productName === "zilch" ? "/zilch-manifest.webmanifest" : "/manifest.webmanifest";
        document.head.appendChild(manifest);
        const script = document.createElement("script");
        script.type = "application/json";
        script.src = `/static/offline-play.js?v=${version}`;
        document.head.appendChild(script);
        const { prepareOfflinePackage } = await import("/cache-helper.js");
        const statuses = [];
        const result = await prepareOfflinePackage(status => statuses.push(status));
        return { result, statuses, state:(await navigator.serviceWorker.getRegistration("/")).active.state };
      }, { productName:product, version:fixture.version });
      expect(result.result).toEqual({ supported:true, ready:true, version:`assets-${fixture.version}` });
      expect(result.statuses).toEqual([result.result]);
      expect(result.state).toBe("activated");
      expect(await otherPage.evaluate(() => window.gameMarker)).toBe("same-game");
      const wrongVersion = await page.evaluate(async () => {
        document.querySelector('script[src*="offline-play.js"]').src = "/static/offline-play.js?v=not-installed";
        const { prepareOfflinePackage } = await import("/cache-helper.js");
        return prepareOfflinePackage();
      });
      expect(wrongVersion.ready).toBe(false);
    } finally {
      await context.close();
      await fixture.close();
    }
  });

  test(`${product} actual practice package opens after network loss and requires activation again`, async ({ browser, browserName, baseURL }) => {
    const fixture = await workerServer(product, { backend:baseURL });
    const context = await browser.newContext({ serviceWorkers:"allow", viewport:{ width:440, height:956 }, hasTouch:true, isMobile:true });
    await context.addInitScript(() => localStorage.setItem("zdwa_language", "de"));
    const page = await context.newPage();
    try {
      await page.goto(`${fixture.origin}/offline-spielen`);
      await expect(page.locator("html")).toHaveAttribute("data-game", product);
      await expect(page.locator("#practiceCacheState")).toContainText("Für den nächsten Start ohne Internet bereit.", { timeout:20000 });
      await page.locator('[data-action="start"]').click();
      await expect(page.locator("#appDialog")).toContainText("keine Erfolge");
      await page.locator('[data-dialog-action="confirm"]').click();
      await expect(page.locator(".practice-workspace")).toBeVisible();
      expect(fixture.requests.some(request => request.pathname.startsWith("/api/"))).toBe(false);
      if (browserName === "webkit") fixture.disconnect(true);
      else await context.setOffline(true);
      const freshPage = await context.newPage();
      await freshPage.goto(fixture.origin);
      await expect(freshPage).toHaveURL(`${fixture.origin}/offline-spielen`);
      await expect(freshPage.locator("html")).toHaveAttribute("data-game", product);
      await expect(freshPage.locator(".practice-workspace")).toHaveCount(0);
      await freshPage.locator('[data-action="resume"]').click();
      await expect(freshPage.locator("#appDialog")).toContainText("keine Erfolge");
      await freshPage.locator('[data-dialog-action="confirm"]').click();
      await expect(freshPage.locator(".practice-workspace")).toBeVisible();
      await freshPage.reload();
      await expect(freshPage.locator(".practice-workspace")).toHaveCount(0);
      await expect(freshPage.locator('[data-action="resume"]')).toBeVisible();
    } finally {
      await context.close();
      await fixture.close();
    }
  });
}
