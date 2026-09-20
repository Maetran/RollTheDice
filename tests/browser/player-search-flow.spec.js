const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function signIn(page) {
  const admin = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
  expect(admin.ok()).toBeTruthy();
  const headers = { "X-CSRF-Token": (await admin.json()).user.csrf_token };
  for (const username of ["Mani", "FinderFreshFriend"]) {
    const created = await page.request.post("/api/admin/users", {
      headers, data: { username, temporary_password: "mani-preview-password-123", role: username === "Mani" ? "admin" : "user" },
    });
    expect([201, 400]).toContain(created.status());
  }
  const login = await page.request.post("/api/auth/login", { data: { username: "Mani", password: "mani-preview-password-123" } });
  expect(login.ok()).toBeTruthy();
}

for (const game of [
  { name: "ZDWA", path: "/spieler", profile: "/spieler/FinderFreshFriend", account: "/konto" },
  { name: "Zilch", path: "/zilch/bestenlisten", profile: "/zilch/spieler/FinderFreshFriend", account: "/zilch/konto" },
]) {
  test(`${game.name} player selection completes the settings, finder, profile, and return flow`, async ({ page }, testInfo) => {
    await signIn(page);
    // Model an established account without changing the shared Mani password.
    // A required initial password change intentionally takes focus first.
    await page.route("**/api/auth/me", async route => {
      const response = await route.fetch();
      const auth = await response.json();
      await route.fulfill({ response, json: { ...auth, user: { ...auth.user, must_change_password: false } } });
    });
    const auth = await (await page.request.get("/api/auth/me")).json();
    const friendProfile = await (await page.request.get("/api/players/FinderFreshFriend")).json();
    await page.request.delete(`/api/web-push/allowlist/${friendProfile.player.id}`, {
      headers: { "X-CSRF-Token": auth.user.csrf_token }, data: { viewer_id: auth.user.id },
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${game.account}#settings`);
    const social = page.locator('details[data-account-section="social"]');
    if (await social.getAttribute("open") === null) await social.locator(":scope > summary").click();
    await social.getByRole("link", { name: "Spieler finden", exact: true }).click();
    const finder = page.locator("#player-search");
    const input = finder.getByRole("searchbox", { name: "Benutzername", exact: true });
    await expect(input).toBeFocused();
    await input.fill("FinderFresh");
    await finder.getByRole("button", { name: "Suchen", exact: true }).click();
    const friend = finder.getByRole("link", { name: "FinderFreshFriend", exact: game.name === "Zilch" });
    await expect(friend).toHaveAttribute("href", game.profile);
    await expect(page).toHaveURL(/#player-search$/);
    if (game.name === "Zilch") await expect(finder.locator("[data-rank-legend]")).toHaveCount(0);
    expect(await input.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await finder.screenshot({ path: testInfo.outputPath("player-finder.png") });
    await friend.click();
    await expect(page).toHaveURL(new RegExp(`${game.profile}$`));
    await page.getByRole("button", { name: "Zur Spielerauswahl hinzufügen", exact: true }).click();
    await expect(page.getByRole("button", { name: "Aus Spielerauswahl entfernen", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Spielerauswahl im Konto verwalten", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${game.account}\\?allowlist=1#settings$`));
    await expect(social).toHaveAttribute("open", "");
    await expect(social.getByRole("link", { name: "FinderFreshFriend", exact: true })).toBeVisible();
  });

  test(`${game.name} finder paginates, handles empty searches, and retries an unavailable request`, async ({ page }) => {
    await signIn(page);
    const players = Array.from({ length: 25 }, (_, index) => ({ id: 10000 + index, username: `Finder ${String(index + 1).padStart(2, "0")}` }));
    let failNext = false;
    const queries = [];
    await page.route("**/api/players/search?**", async route => {
      const params = new URL(route.request().url()).searchParams;
      const query = params.get("query");
      const offset = Number(params.get("offset"));
      const limit = Number(params.get("limit"));
      queries.push({ query, offset, limit });
      if (failNext) {
        failNext = false;
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ json: { players: query === "missing" ? [] : players.slice(offset, offset + limit) } });
    });
    await page.goto(game.path);
    const finder = page.locator("#player-search");
    await finder.getByRole("button", { name: "Alle Spieler anzeigen" }).click();
    await expect(finder.locator(".player-result")).toHaveCount(20);
    failNext = true;
    await finder.getByRole("button", { name: "Weitere Spieler laden" }).click();
    await expect(finder.getByRole("status")).toContainText("Die Spielersuche ist gerade nicht erreichbar.");
    await expect(finder.locator(".player-result")).toHaveCount(20);
    await finder.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(finder.locator(".player-result")).toHaveCount(25);
    await expect(finder.getByRole("button", { name: "Weitere Spieler laden" })).toBeHidden();
    expect(queries).toContainEqual({ query: "", offset: 20, limit: 21 });
    await finder.getByRole("searchbox").fill("missing");
    await finder.getByRole("button", { name: "Suchen", exact: true }).click();
    await expect(finder.locator(".player-result")).toHaveCount(0);
    await expect(finder.getByRole("status")).toContainText("Keine Spieler gefunden.");
    failNext = true;
    await finder.getByRole("button", { name: "Alle Spieler anzeigen" }).click();
    await expect(finder.getByRole("status")).toContainText("Die Spielersuche ist gerade nicht erreichbar.");
    await finder.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(finder.locator(".player-result")).toHaveCount(20);
    await expect(finder.getByRole("searchbox")).toHaveValue("");
  });
}

test("Zilch finder is translated and remains usable in LCARS", async ({ page }, testInfo) => {
  await signIn(page);
  await page.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json: { ...auth, user: { ...auth.user, preferences: { ...auth.user.preferences, preferred_language: "en" } } } });
  });
  await page.addInitScript(() => { localStorage.setItem("zilch_theme", "lcars"); });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/zilch/bestenlisten#player-search");
  const finder = page.locator("#player-search");
  await expect(finder.getByRole("searchbox", { name: "Username", exact: true })).toBeFocused();
  await expect(finder.getByRole("button", { name: "Show all players" })).toBeVisible();
  await finder.getByRole("button", { name: "Show all players" }).click();
  await expect(finder.getByRole("status")).toContainText("Players shown:");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "lcars");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await finder.screenshot({ path: testInfo.outputPath("player-finder-lcars.png") });
});
