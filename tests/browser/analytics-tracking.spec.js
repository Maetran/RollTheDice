const { test, expect } = require("@playwright/test");
const { buildSync } = require("esbuild");
const path = require("node:path");
const { randomBytes } = require("node:crypto");

const tracker = buildSync({
  entryPoints: [path.resolve(__dirname, "../../frontend/shared/analytics.js")],
  bundle: true, write: false, format: "iife", globalName: "ProductAnalytics",
}).outputFiles[0].text;

async function trackingFixture(page, { route = "/", game = "zdwa", dnt = false, gpc = false, beacon = false, referrer = "", userAgent = null, touchPoints = 0 } = {}) {
  const batches = [];
  await page.clock.install({ time: new Date("2026-10-04T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-04T00:00:01Z"));
  await page.addInitScript(({ dnt: enabledDnt, gpc: enabledGpc, beacon: enabledBeacon, referrer: initialReferrer, userAgent: ua, touchPoints: points }) => {
    Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: enabledDnt ? "1" : null });
    Object.defineProperty(navigator, "globalPrivacyControl", { configurable: true, value: enabledGpc });
    if (ua != null) Object.defineProperty(navigator, "userAgent", { configurable: true, value: ua });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: points });
    if (!enabledBeacon) Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: undefined });
    window.fixtureVisibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => window.fixtureVisibility });
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    Object.defineProperty(document, "referrer", { configurable: true, value: initialReferrer });
    const nativeInterval = window.setInterval;
    window.fixtureIntervals = 0;
    window.setInterval = (...args) => { window.fixtureIntervals += 1; return nativeInterval(...args); };
  }, { dnt, gpc, beacon, referrer, userAgent, touchPoints });
  await page.route("**/api/analytics/events", async request => {
    batches.push(JSON.parse(request.request().postData()));
    await request.fulfill({ status: 202, contentType: "application/json", body: '{"accepted":true}' });
  });
  await page.route("**/*", async request => {
    if (new URL(request.request().url()).pathname === "/api/analytics/events") {
      await request.fallback();
      return;
    }
    await request.fulfill({ contentType: "text/html", body: `<!doctype html><html data-game="${game}"><body>
      <input id="privateInput" value="SecretUserAndPassword">
      <button id="createBtn" data-id="private-room-id">Room secret and user name</button>
      <button data-game-mode="2">2 players</button>
      <button data-hardcore="true">Hardcore</button>
      <button id="untracked">Untracked text</button>
      <a id="rules" href="${game === "zilch" ? "/zilch" : ""}/regeln?token=PRIVATE#PrivateUser">Rules</a>
      <a id="account" href="/admin?token=PRIVATE">Administration</a>
      <button data-zilch-account-tab="statistics">Statistics</button>
      <button data-zilch-account-tab="settings">Settings</button>
      <button data-zilch-roll>Roll</button>
      <button data-zilch-bank>Bank</button>
      <button data-zilch-play-mode="cpu">CPU</button>
      <form id="zilchCreateForm"><input value="PrivateRoom"><button type="submit">Create</button></form>
      <script>document.querySelectorAll('a,form').forEach(element => element.addEventListener(element.tagName==='FORM'?'submit':'click', event => event.preventDefault()));</script>
      </body></html>` });
  });
  await page.goto(route);
  await page.addScriptTag({ content: `${tracker}\nProductAnalytics.initializeAnalytics();` });
  return { batches, events: () => batches.flatMap(batch => batch.events) };
}

async function tick(page, milliseconds) {
  await page.clock.runFor(milliseconds);
  await page.evaluate(() => Promise.resolve());
}

for (const preference of ["dnt", "gpc"]) {
  test(`analytics respects ${preference} without storage, timers, or requests`, async ({ page }) => {
    const fixture = await trackingFixture(page, { [preference]: true });
    await page.locator("#createBtn").click();
    await tick(page, 45000);
    expect(fixture.batches).toEqual([]);
    expect(await page.evaluate(() => window.fixtureIntervals)).toBe(0);
    expect(await page.evaluate(() => sessionStorage.getItem("rollthedice:analytics:tab:v1"))).toBeNull();
  });
}

test("device details classify coarse families and preserve hidden hardware as unknown", async ({ page }) => {
  await trackingFixture(page);
  const examples = [
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1", 5, "ipados", "ipad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", 5, "ipados", "ipad"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", 0, "macos", "mac"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148", 5, "ios", "iphone"],
    ["Mozilla/5.0 (Linux; Android 11; KFTRWI Build/RS) AppleWebKit/537.36 Silk/120.0 like Chrome/120.0 Safari/537.36", 5, "fireos", "fire_tablet"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Silk/44.1.54 like Chrome/44.0 Safari/537.36", 0, "unknown", "unknown"],
    ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36", 5, "android", "android_phone"],
    ["Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36", 5, "android", "android_tablet"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36", 0, "chromeos", "chromebook"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36", 0, "windows", "windows_pc"],
    ["Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/145.0", 0, "linux", "linux_pc"],
    ["Mozilla/5.0 (X11; FreeBSD amd64) Gecko/20100101 Firefox/145.0", 0, "unknown", "unknown"],
    ["Hidden browser", 0, "unknown", "unknown"],
  ];
  const actual = await page.evaluate(rows => rows.map(([userAgent, maxTouchPoints]) => ProductAnalytics.analyticsDeviceDetails({userAgent, maxTouchPoints})), examples);
  expect(actual).toEqual(examples.map(([, , os, device_family]) => ({os, device_family})));
  expect(JSON.stringify(actual)).not.toMatch(/Mozilla|18_6|KFTRWI|145\.0|touchPoints/);
});

for (const device of [
  { name: "iPad desktop mode", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15", touchPoints: 5, os: "ipados", family: "ipad", broad: "tablet" },
  { name: "Fire tablet", userAgent: "Mozilla/5.0 (Linux; Android 11; KFTRWI Build/RS) AppleWebKit/537.36 Silk/120.0 like Chrome/120.0 Safari/537.36", touchPoints: 5, os: "fireos", family: "fire_tablet", broad: "tablet" },
  { name: "narrow laptop viewport", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36", touchPoints: 0, os: "windows", family: "windows_pc", broad: "desktop" },
]) {
  test(`analytics sends only categories for ${device.name}`, async ({ page }) => {
    await page.setViewportSize({width:390,height:844});
    const fixture = await trackingFixture(page, device);
    await expect.poll(() => fixture.batches.length).toBe(1);
    expect(fixture.batches[0]).toMatchObject({device:device.broad,os:device.os,device_family:device.family});
    expect(JSON.stringify(fixture.batches)).not.toMatch(/Mozilla|KFTRWI|Build\/|maxTouchPoints|userAgent|Mac OS X|Windows NT/);
  });
}

test("analytics sends only normalized page categories and fixed meaningful actions", async ({ page }) => {
  const fixture = await trackingFixture(page, {
    route: "/spiel/PrivateRoom?token=VerySecret#PrivateUser",
    referrer: "https://google.ch/search?private=VerySecret#PrivateUser",
  });
  await expect.poll(() => fixture.events().filter(event => event.type === "page_view").length).toBe(1);
  await page.locator("#privateInput").fill("PrivateEmailAndPassword");
  await page.locator("#untracked").click();
  await page.locator("#account").click();
  await page.locator("[data-game-mode='2']").click();
  await page.locator("[data-hardcore='true']").click();
  await page.locator("#createBtn").click();
  await page.locator("#createBtn").click();
  await page.locator("#rules").click();
  await tick(page, 15000);
  await expect.poll(() => fixture.events().filter(event => event.type === "action").length).toBe(4);
  expect(fixture.events().filter(event => event.type === "action").map(event => event.action)).toEqual([
    "mode_duo", "mode_hardcore", "create_game", "open_rules",
  ]);
  expect(fixture.events().every(event => event.page === "/spiel")).toBe(true);
  expect(fixture.batches.every(batch => /^[a-f0-9]{32}$/.test(batch.session_id))).toBe(true);
  expect(fixture.batches.every(batch => batch.referrer === "google.ch")).toBe(true);
  expect(JSON.stringify(fixture.batches)).not.toMatch(/Private|VerySecret|SecretUser|Room secret|password|token|#/i);
});

test("analytics counts active visible time and excludes hidden and idle time", async ({ page }) => {
  const fixture = await trackingFixture(page);
  await tick(page, 30000);
  await page.evaluate(() => {
    window.fixtureVisibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick(page, 120000);
  const activeTime = () => fixture.events().reduce((total, event) => total + (event.active_ms || 0), 0);
  await expect.poll(activeTime).toBe(30000);
  await page.evaluate(() => {
    window.fixtureVisibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await tick(page, 120000);
  await expect.poll(activeTime).toBe(90000);
  await page.locator("#untracked").click();
  await tick(page, 15000);
  await expect.poll(activeTime).toBe(105000);
  expect(fixture.events().filter(event => event.type === "page_view")).toHaveLength(1);
});

test("analytics follows Zilch history navigation with no room IDs or duplicate hash views", async ({ page }) => {
  const fixture = await trackingFixture(page, { route: "/zilch", game: "zilch" });
  await page.locator("[data-zilch-play-mode='cpu']").click();
  await page.locator("#zilchCreateForm button").click();
  await page.evaluate(() => history.pushState(null, "", "/zilch/spiel/PrivateRoomOne?private=1"));
  await page.locator("[data-zilch-roll]").click();
  await page.locator("[data-zilch-bank]").click();
  await page.evaluate(() => history.replaceState(null, "", "#PrivateUser"));
  await page.evaluate(() => history.pushState(null, "", "/zilch/spiel/PrivateRoomTwo"));
  await page.evaluate(() => history.pushState(null, "", "/admin?token=PrivateToken"));
  const batchCount = fixture.batches.length;
  await page.locator("[data-zilch-roll]").click();
  await tick(page, 30000);
  expect(fixture.batches.length).toBe(batchCount);
  await page.evaluate(() => history.pushState(null, "", "/zilch/regeln"));
  await expect.poll(() => fixture.events().filter(event => event.type === "page_view").length).toBe(4);
  expect(fixture.events().filter(event => event.type === "page_view").map(event => event.page)).toEqual([
    "/zilch", "/zilch/spiel", "/zilch/spiel", "/zilch/regeln",
  ]);
  expect(fixture.events().filter(event => event.type === "action").map(event => event.action)).toEqual([
    "mode_computer", "create_game", "roll_dice", "bank",
  ]);
  expect(JSON.stringify(fixture.batches)).not.toMatch(/Private|token|admin|#/i);
});

test("analytics rotates tab sessions after inactivity and flushes with beacon on pagehide", async ({ page }) => {
  const fixture = await trackingFixture(page, { beacon: true });
  await expect.poll(() => fixture.batches.length).toBe(1);
  const initialSession = fixture.batches[0].session_id;
  await tick(page, 31 * 60000);
  await page.locator("#createBtn").click();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(() => fixture.batches.some(batch => batch.session_id !== initialSession)).toBe(true);
  const rotated = fixture.batches.filter(batch => batch.session_id !== initialSession);
  expect(rotated.flatMap(batch => batch.events).filter(event => event.type === "page_view")).toHaveLength(1);
  expect(rotated.flatMap(batch => batch.events).some(event => event.action === "create_game")).toBe(true);
});

test("account analytics captures only page category, engagement, and safe tab selection", async ({ page }) => {
  const fixture = await trackingFixture(page, { route: "/zilch/konto?token=PrivateToken#PrivateUser", game: "zilch" });
  await expect.poll(() => fixture.events().length).toBe(1);
  expect(fixture.events()[0]).toMatchObject({ page: "/zilch/konto", type: "page_view", mode: "unknown" });
  await page.locator("#privateInput").fill("MyPrivatePassword");
  await page.locator("[data-zilch-account-tab='statistics']").click();
  await page.locator("[data-zilch-account-tab='settings']").click();
  await tick(page, 15000);
  await expect.poll(() => fixture.events().filter(event => event.type === "action").map(event => event.action)).toEqual([
    "open_statistics", "open_settings",
  ]);
  expect(fixture.events().every(event => event.page === "/zilch/konto")).toBe(true);
  expect(JSON.stringify(fixture.batches)).not.toMatch(/Private|password|token|#/i);
});

test("private routes allocate no session or heartbeat and network failures never block play", async ({ page }) => {
  const fixture = await trackingFixture(page, { route: "/admin?token=PrivateToken" });
  await tick(page, 30000);
  expect(fixture.batches).toEqual([]);
  expect(await page.evaluate(() => window.fixtureIntervals)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.getItem("rollthedice:analytics:tab:v1"))).toBeNull();
  await page.route("**/api/analytics/events", request => request.abort("failed"));
  await page.evaluate(() => history.pushState(null, "", "/"));
  await page.locator("#createBtn").click();
  await tick(page, 30000);
  await expect(page.locator("#createBtn")).toBeEnabled();
});

test("analytics bounds action floods and batches to twenty events", async ({ page }) => {
  const fixture = await trackingFixture(page);
  await page.evaluate(() => {
    const controls = ["#createBtn", "[data-game-mode='2']", "[data-hardcore='true']", "#rules", "[data-zilch-roll]", "[data-zilch-bank]"];
    for (let second = 0; second < 20; second += 1) {
      setTimeout(() => controls.forEach(selector => {
        for (let duplicate = 0; duplicate < 5; duplicate += 1) document.querySelector(selector).click();
      }), second * 1000);
    }
  });
  await tick(page, 30000);
  await expect.poll(() => fixture.events().filter(event => event.type === "action").length).toBe(60);
  expect(fixture.batches.every(batch => batch.events.length <= 20)).toBe(true);
});

test("real browser visits reach the founder dashboard with normalized categories and engagement", async ({ page }) => {
  // This test uses the normal disposable Playwright app/database and real
  // built shell. It intentionally has no request interception or fake clock.
  const login = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(login.ok()).toBe(true);
  const identity = await login.json();
  expect(identity.user.is_founder).toBe(true);
  expect(identity.user.can_view_analytics).toBe(true);
  const initialResponse = await page.request.get("/api/admin/analytics?days=1&game=zdwa");
  expect(initialResponse.ok()).toBe(true);
  const initial = await initialResponse.json();
  const initialPlayers = initial.pages.find(row => row.page === "/spieler" && row.game === "zdwa");
  const sessionId = randomBytes(16).toString("hex");
  const privateMarker = `PrivateAnalytics-${randomBytes(8).toString("hex")}`;
  await page.addInitScript(id => {
    sessionStorage.setItem("rollthedice:analytics:tab:v1", JSON.stringify({ id, lastActivity: Date.now() }));
  }, sessionId);
  const batches = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname !== "/api/analytics/events") return;
    const body = request.postDataJSON();
    if (body?.session_id === sessionId) batches.push(body);
  });
  const viewAccepted = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/analytics/events"
    && response.request().postDataJSON()?.session_id === sessionId
    && response.request().postDataJSON()?.events.some(event => event.type === "page_view")
  ));
  await page.goto(`/spieler/Admin?token=${privateMarker}#${privateMarker}`);
  expect((await viewAccepted).status()).toBe(202);
  await expect.poll(() => batches.flatMap(batch => batch.events)
    .filter(event => event.type === "page_view").map(event => event.page)).toEqual(["/spieler"]);
  const device = batches[0];
  expect(typeof device.os).toBe("string");
  expect(typeof device.device_family).toBe("string");
  const initialSoftware = initial.device_software.find(row => row.os === device.os)?.sessions || 0;
  const initialHardware = initial.device_hardware.find(row => row.device_family === device.device_family)?.sessions || 0;
  const engagementAccepted = page.waitForResponse(response => (
    new URL(response.url()).pathname === "/api/analytics/events"
    && response.request().postDataJSON()?.session_id === sessionId
    && response.request().postDataJSON()?.events.some(event => event.type === "engagement" && event.active_ms > 0)
  ), { timeout: 25000 });
  await page.locator("h1").first().click();
  expect((await engagementAccepted).status()).toBe(202);
  expect(JSON.stringify(batches)).not.toContain(privateMarker);
  expect(batches.flatMap(batch => batch.events).every(event => event.page === "/spieler")).toBe(true);
  await expect.poll(async () => {
    const response = await page.request.get("/api/admin/analytics?days=1&game=zdwa");
    expect(response.ok()).toBe(true);
    const stats = await response.json();
    const players = stats.pages.find(row => row.page === "/spieler" && row.game === "zdwa");
    return Boolean(players && players.views >= (initialPlayers?.views || 0) + 1
      && players.active_seconds > (initialPlayers?.active_seconds || 0)
      && stats.overview.sessions >= initial.overview.sessions + 1
      && stats.device_software.some(row => row.os === device.os && row.sessions >= initialSoftware + 1)
      && stats.device_hardware.some(row => row.device_family === device.device_family && row.sessions >= initialHardware + 1));
  }, { timeout: 10000 }).toBe(true);
  const dashboard = await page.goto("/admin/dashboard");
  expect(dashboard.status()).toBe(200);
  await expect(page.locator("#dashboardMain")).toBeVisible();
});
