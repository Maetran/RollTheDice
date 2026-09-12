const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function newAccount(page, username) {
  const adminResponse = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  const admin = (await adminResponse.json()).user;
  const password = "achievement-reachability-password-123";
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username, temporary_password: password, role: "user" },
  });
  expect(created.status()).toBe(201);
  const signedIn = await page.request.post("/api/auth/login", { data: { username, password } });
  const user = (await signedIn.json()).user;
  const finalPassword = `${password}-final`;
  const changed = await page.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": user.csrf_token },
    data: { current_password: password, new_password: finalPassword },
  });
  expect(changed.ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/login", { data: { username, password: finalPassword } })).ok()).toBeTruthy();
  await page.route("**/api/releases**", route => route.fulfill({
    json: { viewer_id: user.id, releases: [], can_prompt: false },
  }));
  return username;
}

async function ownAwards(page, username) {
  const profile = await page.request.get(`/api/players/${encodeURIComponent(username)}`);
  return (await profile.json()).player.achievements.unlocked.map(item => item.key);
}

test("ZDWA only awards rendered visible history and refreshes achievements without more statistics visits", async ({ page }) => {
  const username = await newAccount(page, "HistoryVisibleOnly");
  const counts = { history: 0, statistics: 0, recorded: 0 };
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/users/me/game-history") counts.history += 1;
    if (path === "/api/users/me/statistics") counts.statistics += 1;
    if (path === "/api/account/engagement/history") counts.recorded += 1;
  });
  await page.goto("/konto#settings");
  await expect(page.locator("#settingsPanel")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-account-tab-ready", "true");
  expect(await ownAwards(page, username)).not.toContain("history_viewed");
  expect(await ownAwards(page, username)).not.toContain("statistics_viewed");
  expect(counts).toEqual({ history: 0, statistics: 0, recorded: 0 });

  await page.locator("#statisticsTab").click();
  await expect.poll(() => counts.recorded).toBe(1);
  await expect.poll(async () => ownAwards(page, username)).toContain("history_viewed");
  await page.locator("#achievementsTab").click();
  await expect(page.locator("#unlockedAchievements")).toContainText("Rückblick");
  await expect(page.locator("#lockedAchievements")).not.toContainText("Rückblick");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#unlockedAchievements")).toContainText("Auf Schatzsuche");
  await page.locator("#settingsTab").click();
  await page.locator("#statisticsTab").click();
  await expect(page.locator("#historyChart")).toBeVisible();
  expect(counts).toEqual({ history: 1, statistics: 1, recorded: 1 });
});

test("failed ZDWA history loading earns nothing and can be retried visibly", async ({ page }) => {
  const username = await newAccount(page, "HistoryFailedLoad");
  let fail = true;
  await page.route("**/api/users/me/game-history?**", route => fail
    ? route.fulfill({ status: 503, json: { detail: "unavailable" } })
    : route.continue());
  await page.goto("/konto#statistics");
  await expect(page.locator("#historyChart")).toContainText("Verlauf konnte nicht geladen werden.");
  expect(await ownAwards(page, username)).not.toContain("history_viewed");
  fail = false;
  await page.locator("#settingsTab").click();
  await page.locator("#statisticsTab").click();
  await expect.poll(async () => ownAwards(page, username)).toContain("history_viewed");
});

test("a delayed history response does not award a view while another account tab is open", async ({ page }) => {
  const username = await newAccount(page, "HistoryDelayedView");
  let held;
  await page.route("**/api/users/me/game-history?**", route => { held = route; });
  await page.goto("/konto#statistics");
  await expect.poll(() => Boolean(held)).toBe(true);
  await page.locator("#settingsTab").click();
  await held.fulfill({ json: {
    games: [], mode: "normal", selection: "10",
    summary: { games: 0, points_total: 0, normal: { games: 0 }, hardcore: { games: 0 } },
  } });
  await expect(page.locator("#historyChart")).not.toContainText("Laden…");
  expect(await ownAwards(page, username)).not.toContain("history_viewed");
  await page.locator("#statisticsTab").click();
  await expect.poll(async () => ownAwards(page, username)).toContain("history_viewed");
});
