const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers:"block", viewport:{ width:440, height:956 }, hasTouch:true, isMobile:true });

async function signInPreviewFriend(page, language) {
  const admin = await page.request.post("/api/auth/login", { data:{ username:"Admin", password:"temporary-password-123" } });
  expect(admin.ok()).toBe(true);
  const created = await page.request.post("/api/admin/users", {
    headers:{ "X-CSRF-Token":(await admin.json()).user.csrf_token },
    data:{ username:"PreviewFriend", temporary_password:"preview-friend-password-123", role:"user" },
  });
  expect([201, 400]).toContain(created.status());
  const login = await page.request.post("/api/auth/login", { data:{ username:"PreviewFriend", password:"preview-friend-password-123" } });
  expect(login.ok()).toBe(true);
  const preferences = await page.request.put("/api/auth/preferences/language", {
    headers:{ "X-CSRF-Token":(await login.json()).user.csrf_token }, data:{ preferred_language:language },
  });
  expect(preferences.ok()).toBe(true);
  // Reuse the established-account projection used by the other navigation
  // specs. Documents, links, permissions and the return health check are real.
  await page.route("**/api/auth/me", async route => {
    const response = await route.fetch();
    const auth = await response.json();
    await route.fulfill({ response, json:{ ...auth, user:{ ...auth.user, must_change_password:false } } });
  });
  await page.addInitScript(value => localStorage.setItem("zdwa_language", value), language);
}

for (const product of [
  { game:"zdwa", lobby:"/", rules:"/regeln", entry:"/offline-spielen" },
  { game:"zilch", lobby:"/zilch", rules:"/zilch/regeln", entry:"/zilch/offline-spielen" },
]) {
  for (const language of ["de", "en"]) {
    test(`${product.game} ${language}: lobby and rules lead to gated offline play and back to the same lobby`, async ({ page, baseURL }) => {
      await signInPreviewFriend(page, language);
      const offlineLabel = language === "en" ? "Play offline" : "Offline spielen";
      const noAwards = language === "en" ? /no achievements.*leaderboard/i : /keine Erfolge.*Ranglisten/i;
      const onlineAwards = language === "en" ? /achievements.*leaderboards.*available/i : /Erfolge.*Bestenlisten.*verfügbar/i;
      await page.goto(product.lobby);

      for (const source of ["lobby", "rules"]) {
        if (source === "rules") {
          await page.getByRole("link", { name:language === "en" ? "Rules" : "Regeln", exact:true }).first().click();
          await expect(page).toHaveURL(new URL(product.rules, baseURL).href);
        }
        const entryLink = page.getByRole("link", { name:offlineLabel, exact:true });
        await expect(entryLink).toHaveAttribute("href", product.entry);
        await entryLink.click();
        await expect(page).toHaveURL(new URL(product.entry, baseURL).href);
        await expect(page.locator("html")).toHaveAttribute("data-game", product.game);
        await expect(page.locator(".practice-workspace")).toHaveCount(0);
        await page.locator('[data-action="start"]').click();
        await expect(page.locator("#appDialog")).toContainText(noAwards);
        await page.locator('[data-dialog-action="cancel"]').click();
        await expect(page.locator(".practice-workspace")).toHaveCount(0);
        await page.locator('[data-action="start"]').click();
        await page.locator('[data-dialog-action="confirm"]').click();
        await expect(page.locator(".practice-workspace")).toBeVisible();

        await page.goBack();
        await expect(page.locator("#appDialog")).toContainText(onlineAwards);
        await page.locator('[data-dialog-action="cancel"]').click();
        await expect(page).toHaveURL(new URL(product.entry, baseURL).href);
        await expect(page.locator(".practice-workspace")).toBeVisible();
        await page.locator("#practiceOnline").click();
        await expect(page.locator("#appDialog")).toContainText(onlineAwards);
        await page.locator('[data-dialog-action="confirm"]').click();
        await expect(page).toHaveURL(new URL(product.lobby, baseURL).href);
        await expect(page.getByRole("link", { name:offlineLabel, exact:true })).toBeVisible();
      }
    });
  }
}
