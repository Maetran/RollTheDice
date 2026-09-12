const { test, expect } = require("@playwright/test");
const { expectTextContrast } = require("./contrast");

test.use({ serviceWorkers: "block" });

async function createAccount(page, username, language = "de") {
  const adminResponse = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(adminResponse.ok()).toBeTruthy();
  const admin = (await adminResponse.json()).user;
  const password = "achievement-navigation-password-123";
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    // These disposable accounts are on the private browser-test allowlist.
    data: { username, temporary_password: password, role: "user" },
  });
  expect(created.status()).toBe(201);
  const signedIn = await page.request.post("/api/auth/login", { data: { username, password } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  if (language === "en") {
    const response = await page.request.put("/api/auth/preferences/language", {
      headers: { "X-CSRF-Token": user.csrf_token }, data: { preferred_language: language },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.addInitScript(lang => localStorage.setItem("zdwa_language", lang), language);
}

async function unlockedKeys(page) {
  const response = await page.request.get("/api/zilch/achievements");
  expect(response.ok()).toBeTruthy();
  const profile = await response.json();
  return profile.unlocked.map(award => award.key);
}

for (const [language, theme] of [["de", "light"], ["en", "light"], ["de", "lcars"], ["en", "lcars"]]) {
  test(`history is discoverable from the account and earned only on opening it (${language}, ${theme})`, async ({ page }, testInfo) => {
    await createAccount(page, `History_${language}_${theme}`, language);
    await page.addInitScript(value => localStorage.setItem("zilch_theme", value), theme);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await unlockedKeys(page)).not.toContain("zilch.history_viewed");

    await page.goto("/zilch");
    await page.locator("#zilchNavigation a[href='/zilch/konto']").click();
    const statisticsTab = page.getByRole("tab", { name: language === "en" ? "Statistics" : "Statistiken", exact: true });
    await statisticsTab.click();
    const history = page.getByRole("button", { name: language === "en" ? "Your history" : "Deine Historie", exact: true });
    await expect(history).toBeVisible();
    await expect(history).toHaveAttribute("data-zilch-navigate", "/zilch/historie");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expectTextContrast(history);
    expect(await history.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(32);
    await page.screenshot({ path: testInfo.outputPath("history-entry.png") });
    expect(await unlockedKeys(page)).not.toContain("zilch.history_viewed");

    // Loading/reloading statistics must not stand in for visiting the history.
    await page.reload();
    await statisticsTab.click();
    expect(await unlockedKeys(page)).not.toContain("zilch.history_viewed");
    await history.click();
    await expect(page).toHaveURL(/\/zilch\/historie$/);
    const historyHeading = page.getByRole("heading", { name: language === "en" ? "Completed games" : "Abgeschlossene Spiele", exact: true });
    await expect(historyHeading).toBeVisible();
    await expectTextContrast(historyHeading);
    await page.screenshot({ path: testInfo.outputPath("history-page.png") });
    await expect(page.locator("meta[name='robots']")).toHaveAttribute("content", /noindex/);
    expect(await unlockedKeys(page)).toContain("zilch.history_viewed");

    await page.locator("#zilchNavigation a[href='/zilch/konto']").click();
    await page.getByRole("tab", { name: language === "en" ? "Achievements" : "Erfolge", exact: true }).click();
    await expect(page.getByRole("article", { name: language === "en" ? "Looking Back · Unlocked" : "Rückblick · Freigeschaltet", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#zilchNavigation a[href='/zilch/regeln']").click();
    await expect(page.locator(".zilch-rules-section").filter({ hasText: language === "en" ? "Account → Statistics → Your history" : "Konto → Statistiken → Deine Historie" })).toBeVisible();
  });
}

test("new settings and collection awards appear when returning to the achievements tab without reloading", async ({ page }) => {
  await createAccount(page, "FreshZilchAwards");
  await page.goto("/zilch/konto");
  const achievementsTab = page.getByRole("tab", { name: "Erfolge", exact: true });
  await achievementsTab.click();
  await expect(page.getByRole("article", { name: "Auf Schatzsuche · Freigeschaltet", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Gesprächig · Gesperrt", exact: true })).toBeVisible();
  expect(await unlockedKeys(page)).not.toContain("zilch.chat_settings_saved");
  await page.evaluate(() => { window.achievementPageMarker = "same-document"; });

  await page.getByRole("tab", { name: "Einstellungen", exact: true }).click();
  await page.locator("[data-account-section='social'] > summary").click();
  await page.locator("#zilchLobbyChatPreferencesForm input[name='zilchLobbyChatPopups']").uncheck();
  await page.locator("#zilchLobbyChatPreferencesForm button[type='submit']").click();
  await expect(page.locator("#zilchLobbyChatPreferencesMessage")).toHaveText("Lobby-Chat-Einstellung gespeichert.");
  expect(await unlockedKeys(page)).toContain("zilch.chat_settings_saved");
  await achievementsTab.click();
  await expect(page.getByRole("article", { name: "Gesprächig · Freigeschaltet", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Feinjustiert · Freigeschaltet", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.achievementPageMarker)).toBe("same-document");
});

test("history remains accessible when statistics are temporarily unavailable", async ({ page }) => {
  await createAccount(page, "HistoryStatsOffline");
  await page.route("**/api/zilch/statistics", route => route.fulfill({ status: 503, json: { detail: "unavailable" } }));
  await page.goto("/zilch/konto");
  await page.getByRole("tab", { name: "Statistiken", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Zilch-Statistiken nicht verfügbar", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Deine Historie", exact: true }).click();
  await expect(page.locator("#zilchAllResultsHistory")).toContainText("Noch keine abgeschlossenen Zilch-Partien");
  expect(await unlockedKeys(page)).toContain("zilch.history_viewed");
});
