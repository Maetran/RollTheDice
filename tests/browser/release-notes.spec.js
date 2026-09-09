const { test, expect } = require("@playwright/test");
const authored = require("../../app/release-notice.json");

test.use({ serviceWorkers: "block" });

async function signIn(page) {
  const admin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(admin.ok()).toBeTruthy();
  const adminUser = (await admin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": adminUser.csrf_token },
    data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
  });
  expect([201, 400]).toContain(created.status());
  await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": adminUser.csrf_token } });
  const response = await page.request.post("/api/auth/login", {
    data: { username: "Mani", password: "mani-preview-password-123" },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).user;
}

function release(index = 10, language = "de") {
  return {
    revision: index.toString(16).padStart(40, "0"),
    published_at: new Date(Date.UTC(2026, 8, 6, 10, index)).toISOString(),
    ...authored.player_notes[language], acknowledged: false, can_announce: true,
  };
}

async function returningGuest(scope) {
  await scope.addInitScript(revision => {
    const key = "rollthedice:release-notes:guest";
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify([revision]));
  }, release(9).revision);
}

async function expectGuestBaseline(page, revision, context = "zdwa") {
  await expect.poll(() => page.evaluate(game => {
    const value = localStorage.getItem(`rollthedice:release-notes:baseline:${game}`);
    return value ? JSON.parse(value) : null;
  }, context)).toEqual({ revision });
}

async function mockReleases(page, { viewer = null, count = 1, acknowledged = false, canPrompt = true } = {}) {
  const state = { viewer, canPrompt, latest: 10, fail: false, ackFail: false, gets: 0, posts: [], read: new Set(), held: null, holdNext: false };
  if (acknowledged) state.read.add(release().revision);
  await page.route("**/api/releases**", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      state.posts.push(request.postDataJSON());
      expect(request.headers()["x-csrf-token"]).toBeTruthy();
      if (state.ackFail) return route.fulfill({ status: 503, json: { detail: "unavailable" } });
      state.read.add(new URL(request.url()).pathname.split("/")[3]);
      if (state.holdAckNext) {
        state.holdAckNext = false;
        state.ackHeld = () => route.fulfill({ json: { ok: true } });
        return;
      }
      return route.fulfill({ json: { ok: true } });
    }
    state.gets += 1;
    const language = new URL(request.url()).searchParams.get("language");
    const releases = Array.from({ length: count }, (_, offset) => {
      const item = release(state.latest - offset, language === "en" ? "en" : "de");
      return { ...item, acknowledged: state.read.has(item.revision) };
    });
    const response = { viewer_id: state.viewer, releases, can_prompt: state.canPrompt };
    if (state.holdNext) {
      state.holdNext = false;
      state.held = () => route.fulfill({ json: response });
      return;
    }
    return route.fulfill(state.fail ? { status: 503, json: { detail: "unavailable" } } : { json: response });
  });
  return state;
}

test("a first-time guest starts without an update modal and sees only later releases", async ({ page }) => {
  const server = await mockReleases(page, { count: 10 });
  await page.goto("/");
  await expectGuestBaseline(page, release().revision);
  const dialog = page.locator(".release-notes-dialog");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Zock die Wand an – Würfelspiel online", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rollthedice:release-notes:guest"))).toBeNull();
  await page.reload();
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
  server.latest = 11;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveAttribute("data-revision", release(11).revision);
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await page.reload();
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
  expect(server.posts).toHaveLength(0);
});

test("a delayed first history request survives matching initial auth responses", async ({ page }) => {
  await page.addInitScript(() => {
    window.__releaseAuthEvents = 0;
    window.addEventListener("zdwa:auth-state", () => { window.__releaseAuthEvents += 1; });
  });
  const server = await mockReleases(page);
  server.holdNext = true;
  await page.goto("/");
  await expect.poll(() => Boolean(server.held)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__releaseAuthEvents)).toBeGreaterThan(0);
  await server.held();
  await expectGuestBaseline(page, release().revision);
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
  expect(server.gets).toBe(1);
});

test("a stale guest history response cannot hide an account update after initial auth", async ({ page }) => {
  await page.addInitScript(() => {
    window.__releaseAuthEvents = 0;
    window.addEventListener("zdwa:auth-state", () => { window.__releaseAuthEvents += 1; });
  });
  const authRequests = [];
  await page.route("**/api/auth/me", route => { authRequests.push(route); });
  const server = await mockReleases(page);
  server.holdNext = true;
  await page.goto("/");
  await expect.poll(() => Boolean(server.held) && authRequests.length > 0).toBe(true);
  const user = await signIn(page);
  const auth = await (await page.request.get("/api/auth/me")).json();
  server.viewer = user.id;
  await page.unroute("**/api/auth/me");
  await Promise.all(authRequests.map(route => route.fulfill({ json: auth })));
  await expect.poll(() => page.evaluate(() => window.__releaseAuthEvents)).toBeGreaterThan(0);
  await server.held();
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("rollthedice:release-notes:baseline:zdwa"))).toBeNull();
  expect(server.gets).toBe(2);
});

test("history accepts a session change without a local auth event and does not retry endlessly", async ({ page }) => {
  const user = await signIn(page);
  const server = await mockReleases(page, { viewer: user.id });
  await page.goto("/");
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
  const gets = server.gets;
  // Another tab can sign out, or a session can expire, without this page
  // dispatching zdwa:auth-state. The history endpoint owns its current viewer.
  server.viewer = null;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expectGuestBaseline(page, release().revision);
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
  expect(server.gets).toBe(gets + 1);
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  expect(server.gets).toBe(gets + 2);
  server.viewer = user.id;
  await page.evaluate(account => window.dispatchEvent(new CustomEvent("zdwa:auth-state", {
    detail: { authenticated: true, user: account },
  })), user);
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
  expect(server.gets).toBe(gets + 3);
});

test("a language change during the initial request reloads the recap in the selected language", async ({ page }) => {
  await returningGuest(page);
  const server = await mockReleases(page);
  server.holdNext = true;
  await page.goto("/");
  await expect.poll(() => Boolean(server.held)).toBe(true);
  await page.evaluate(() => window.ZDWA_I18N.setLanguage("en", { persist: false, reload: false }));
  await server.held();
  const dialog = page.locator(".release-notes-dialog");
  await expect(dialog.getByRole("heading")).toHaveText(authored.player_notes.en.title);
  await expect(dialog.locator("li")).toHaveText(authored.player_notes.en.changes);
  expect(server.gets).toBe(2);
});

test("a failed first history request establishes no baseline before a successful retry", async ({ page }) => {
  const server = await mockReleases(page);
  server.fail = true;
  await page.goto("/");
  await expect.poll(() => server.gets).toBeGreaterThan(0);
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  expect(await page.evaluate(() => localStorage.getItem("rollthedice:release-notes:baseline:zdwa"))).toBeNull();
  server.fail = false;
  await expect.poll(async () => {
    await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
    return page.evaluate(() => Boolean(localStorage.getItem("rollthedice:release-notes:baseline:zdwa")));
  }).toBe(true);
  await expectGuestBaseline(page, release().revision);
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
});

test("returning guest acknowledgement persists, later defers, and only the latest release is announced", async ({ page }) => {
  await returningGuest(page);
  const server = await mockReleases(page, { count: 10 });
  await page.goto("/");
  const dialog = page.locator(".release-notes-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Später", exact: true }).click();
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window.ZDWA_RELEASE_NOTES))).toBe(true);
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
  expect(server.posts).toHaveLength(0);
  server.latest = 11;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveAttribute("data-revision", release(11).revision);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(dialog).toBeVisible();
});

for (const product of [
  { name: "ZDWA", lobby: "/", account: "/konto#settings", other: "/zilch/konto#settings" },
  { name: "Zilch", lobby: "/zilch", account: "/zilch/konto#settings", other: "/konto#settings" },
]) {
  test(`${product.name} mobile recap, account-wide acknowledgement and ten-entry settings history`, async ({ page }, testInfo) => {
    const user = await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    const server = await mockReleases(page, { viewer: user.id, count: 10 });
    await page.goto(product.lobby);
    const dialog = page.locator(".release-notes-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("li")).toHaveCount(authored.player_notes.de.changes.length);
    const button = dialog.getByRole("button", { name: "Verstanden", exact: true });
    await expect(button).toBeFocused();
    const buttonBox = await button.boundingBox();
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(844);
    expect(buttonBox.height).toBeGreaterThanOrEqual(44);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath("release-popup-mobile.png") });
    await button.click();
    await expect(dialog).toHaveCount(0);
    expect(server.posts).toEqual([{ viewer_id: user.id }]);
    await page.goto(product.account);
    const history = page.locator("[data-release-history]");
    await expect(history.locator("details")).toHaveCount(10);
    await expect(dialog).toHaveCount(0);
    await history.locator("summary").first().click();
    await expect(history.locator("details").first().locator("li")).toHaveCount(authored.player_notes.de.changes.length);
    await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
    await expect(history.locator("details").first()).toHaveAttribute("open", "");
    const support = page.locator(".release-notes-support");
    await expect(support.locator("a").first()).toBeHidden();
    await support.locator("summary").click();
    await expect(support.getByRole("link", { name: "Problem auf GitHub melden" })).toHaveAttribute("href", "/go/github/issues");
    await expect(support.getByRole("link", { name: "Ausführliche Versionshistorie auf GitHub" })).toHaveAttribute("rel", "noopener noreferrer");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => document.activeElement?.blur());
    await history.locator("details").first().screenshot({ path: testInfo.outputPath("release-history-mobile.png") });
    await page.goto(product.other);
    await expect(page.locator("[data-release-history] details")).toHaveCount(10);
    await expect(dialog).toHaveCount(0);
    expect(server.posts).toHaveLength(1);
  });

  test(`${product.name} failed acknowledgement stays visible and can be retried`, async ({ page }) => {
    const user = await signIn(page);
    const server = await mockReleases(page, { viewer: user.id });
    server.ackFail = true;
    await page.goto(product.lobby);
    const dialog = page.locator(".release-notes-dialog");
    await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
    await expect(dialog.getByRole("status")).toContainText("Bestätigung konnte nicht gespeichert werden.");
    await expect(dialog.getByRole("button", { name: "Verstanden", exact: true })).toBeEnabled();
    server.ackFail = false;
    await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(server.posts).toHaveLength(2);
  });

  test(`${product.name} account history and help are fully English`, async ({ page }) => {
    const user = await signIn(page);
    const auth = await (await page.request.get("/api/auth/me")).json();
    await page.route("**/api/auth/me", route => route.fulfill({ json: { ...auth,
      user: { ...auth.user, preferences: { ...auth.user.preferences, preferred_language: "en" } },
    } }));
    await mockReleases(page, { viewer: user.id });
    await page.goto(product.account);
    const dialog = page.locator(".release-notes-dialog");
    await expect(dialog.getByRole("heading")).toHaveText(authored.player_notes.en.title);
    await expect(dialog.locator("li")).toHaveText(authored.player_notes.en.changes);
    await dialog.getByRole("button", { name: "Got it", exact: true }).click();
    await expect(page.getByRole("heading", { name: "News & versions", exact: true })).toBeVisible();
    await page.locator(".release-notes-support summary").click();
    await expect(page.getByRole("link", { name: "Report a problem on GitHub" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Detailed version history on GitHub" })).toBeVisible();
    await expect(page.locator(".release-notes-support")).toContainText("You need a GitHub account");
  });
}

test("stale history responses cannot undo a successful acknowledgement", async ({ page }) => {
  const user = await signIn(page);
  const server = await mockReleases(page, { viewer: user.id });
  await page.goto("/konto#settings");
  const dialog = page.locator(".release-notes-dialog");
  await expect(dialog).toBeVisible();
  server.holdNext = true;
  await page.evaluate(() => { void window.ZDWA_RELEASE_NOTES.refresh(); });
  await expect.poll(() => Boolean(server.held)).toBe(true);
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const gets = server.gets;
  await server.held();
  await expect.poll(() => server.gets).toBeGreaterThan(gets);
  await expect(dialog).toHaveCount(0);
});

test("a new release stays open when an older acknowledgement finishes saving", async ({ page }) => {
  const user = await signIn(page);
  const server = await mockReleases(page, { viewer: user.id });
  server.holdAckNext = true;
  await page.goto("/konto#settings");
  const dialog = page.locator(".release-notes-dialog");
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await expect.poll(() => Boolean(server.ackHeld)).toBe(true);
  server.latest = 11;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveAttribute("data-revision", release(11).revision);
  await server.ackHeld();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("data-revision", release(11).revision);
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(server.posts).toHaveLength(2);
});

test("history failures have retry and required-password prompts suppress release popups", async ({ page }) => {
  const user = await signIn(page);
  const server = await mockReleases(page, { viewer: user.id, canPrompt: false });
  server.fail = true;
  await page.goto("/konto#settings");
  await expect(page.locator("[data-release-history]")).toContainText("Neuigkeiten sind gerade nicht erreichbar.");
  server.fail = false;
  await page.getByRole("button", { name: "Neuigkeiten erneut laden" }).click();
  await expect(page.locator("[data-release-history] details")).toHaveCount(1);
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
  server.canPrompt = true;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
});

test("an existing modal takes priority and the release follows after it closes", async ({ page }) => {
  const server = await mockReleases(page, { count: 0 });
  await page.goto("/");
  await expectGuestBaseline(page, null);
  await page.evaluate(() => {
    const modal = document.createElement("dialog");
    modal.id = "otherModal";
    modal.textContent = "Another dialog";
    document.body.appendChild(modal);
    modal.showModal();
  });
  await page.unroute("**/api/releases**");
  await page.route("**/api/releases**", route => route.fulfill({ json: {
    viewer_id: server.viewer, releases: [release()], can_prompt: true,
  } }));
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
  await page.evaluate(() => document.getElementById("otherModal").close());
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
});

test("game-room and rules entry points never mount release popups", async ({ page }) => {
  await signIn(page);
  const server = await mockReleases(page);
  for (const path of ["/regeln", "/zilch/regeln", "/spiel/release-test-missing", "/zilch/spiel/release-test-missing"]) {
    await page.goto(path);
    await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
    expect(await page.evaluate(() => Boolean(window.ZDWA_RELEASE_NOTES))).toBe(false);
  }
  expect(server.gets).toBe(0);
});

test("guest notes are text-only and still dismiss when browser storage is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key.startsWith("rollthedice:release-notes:")) throw new DOMException("Storage blocked", "SecurityError");
      return original.call(this, key, value);
    };
  });
  const literal = '<img src=x onerror="window.releaseNoteInjected=true">';
  let latest = 10;
  await page.route("**/api/releases**", route => route.fulfill({ json: {
    viewer_id: null, can_prompt: true, releases: [{ ...release(latest), title: literal, changes: [literal] }],
  } }));
  await page.goto("/");
  const dialog = page.locator(".release-notes-dialog");
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
  latest = 11;
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog.getByRole("heading")).toHaveText(literal);
  await expect(dialog.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.releaseNoteInjected)).toBeUndefined();
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await page.evaluate(() => window.ZDWA_RELEASE_NOTES.refresh());
  await expect(dialog).toHaveCount(0);
});

test("guest acknowledgement never hides a signed-in account's release note", async ({ page }) => {
  await returningGuest(page);
  const server = await mockReleases(page);
  await page.goto("/");
  await page.locator(".release-notes-dialog").getByRole("button", { name: "Verstanden", exact: true }).click();
  const user = await signIn(page);
  server.viewer = user.id;
  await page.goto("/konto#settings");
  const dialog = page.locator(".release-notes-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Verstanden", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(server.posts).toEqual([{ viewer_id: user.id }]);
});

test("guest acknowledgements synchronize across open tabs", async ({ page, context }) => {
  await returningGuest(context);
  await context.route("**/api/releases**", route => route.fulfill({ json: {
    viewer_id: null, can_prompt: true, releases: [release()],
  } }));
  await page.goto("/");
  await expect(page.locator(".release-notes-dialog")).toBeVisible();
  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator(".release-notes-dialog")).toBeVisible();
  await other.locator(".release-notes-dialog").getByRole("button", { name: "Verstanden", exact: true }).click();
  await expect(other.locator(".release-notes-dialog")).toHaveCount(0);
  await page.bringToFront();
  await expect(page.locator(".release-notes-dialog")).toHaveCount(0);
});
