const { test, expect } = require("@playwright/test");
const { openPasswordLogin } = require("./password-login");

test.use({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });

async function signInPreviewPlayer(page, language) {
  const admin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(admin.ok()).toBeTruthy();
  const identity = (await admin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": identity.csrf_token },
    data: { username: "Mani", temporary_password: "mani-preview-password-123", role: "admin" },
  });
  expect([201, 400]).toContain(created.status());
  const signedIn = await page.request.post("/api/auth/login", {
    data: { username: "Mani", password: "mani-preview-password-123" },
  });
  expect(signedIn.ok()).toBeTruthy();
  const player = (await signedIn.json()).user;
  const preference = await page.request.put("/api/auth/preferences/language", {
    headers: { "X-CSRF-Token": player.csrf_token }, data: { preferred_language: language },
  });
  expect(preference.ok()).toBeTruthy();
}

test("a signed-out private history bookmark returns through login to its requested page", async ({ page }) => {
  await signInPreviewPlayer(page, "de");
  await page.context().clearCookies();
  await page.goto("/zilch/historie");
  await expect(page).toHaveURL(/\/zilch\/anmelden\?return_to=%2Fzilch%2Fhistorie$/);
  await openPasswordLogin(page, true);
  await page.fill("#zilchLoginUsername", "Mani");
  await page.fill("#zilchLoginPassword", "mani-preview-password-123");
  await page.locator("#zilchLoginForm button[type=submit]").click();
  await expect(page).toHaveURL(/\/zilch\/historie$/);
  await expect(page.locator("#zilchAllResultsHistory")).toBeVisible();
});

for (const language of ["de", "en"]) {
  for (const theme of ["light", "lcars"]) {
    test(`stale Zilch game and result links recover in ${language}, ${theme}`, async ({ page }) => {
      await signInPreviewPlayer(page, language);
      await page.addInitScript(({ language, theme }) => {
        localStorage.setItem("zdwa_language", language);
        localStorage.setItem("zilch_theme", theme);
      }, { language, theme });
      const heading = language === "de" ? "Dieser Zilch-Link ist nicht verfügbar." : "This Zilch link is unavailable.";
      const lobbyLabel = language === "de" ? "Zur Zilch-Lobby" : "Back to Zilch lobby";
      const historyLabel = language === "de" ? "Deine Historie" : "Your history";
      for (const kind of ["spiel", "ergebnis"]) {
        const response = await page.goto(`/zilch/${kind}/expired-navigation-link`);
        expect(response.status()).toBe(404);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
        await expect(page.getByRole("link", { name: lobbyLabel, exact: true })).toHaveAttribute("href", "/zilch");
        await expect(page.getByRole("link", { name: historyLabel, exact: true })).toHaveAttribute("href", "/zilch/historie");
        for (const action of await page.locator(".zilch-unavailable-actions a").all()) {
          expect((await action.boundingBox()).height).toBeGreaterThanOrEqual(44);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await page.screenshot({ path: `/tmp/rollthedice-zilch-unavailable-${language}-${theme}.png` });
      await page.getByRole("link", { name: historyLabel, exact: true }).click();
      await expect(page).toHaveURL(/\/zilch\/historie$/);
      await expect(page.locator("#zilchAllResultsHistory")).toBeVisible();
      await page.goto("/zilch/spiel/expired-navigation-link");
      await page.getByRole("link", { name: lobbyLabel, exact: true }).click();
      await expect(page).toHaveURL(/\/zilch$/);
      await expect(page.locator("#zilchCreateForm")).toBeVisible();
    });
  }
}
