const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

for (const product of ["zdwa", "zilch"]) {
  for (const destination of ["issues", "changelog"]) {
    test(`${product} earns the GitHub achievement from the app even with an external browser session (${destination})`, async ({ page, context }) => {
      const name = `GitHub_${product}_${destination}`;
      const password = "github-fixture-password-123";
      const adminLogin = await page.request.post("/api/auth/login", { data: { username: "Admin", password: "temporary-password-123" } });
      expect(adminLogin.ok()).toBe(true);
      const admin = (await adminLogin.json()).user;
      const created = await page.request.post("/api/admin/users", {
        headers: { "X-CSRF-Token": admin.csrf_token }, data: { username: name, temporary_password: password, role: "admin" },
      });
      expect(created.status()).toBe(201);
      const login = await page.request.post("/api/auth/login", { data: { username: name, password } });
      const user = (await login.json()).user;
      const changed = await page.request.post("/api/auth/change-password", {
        headers: { "X-CSRF-Token": user.csrf_token }, data: { current_password: password, new_password: `${password}-final` },
      });
      expect(changed.ok()).toBe(true);
      expect((await page.request.post("/api/auth/login", { data: { username: name, password: `${password}-final` } })).ok()).toBe(true);
      await page.route("**/api/releases**", route => route.fulfill({ json: { releases: [], can_prompt: false } }));
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { get: () => true });
      });
      const unlocked = async () => {
        const zdwa = await (await page.request.get(`/api/players/${name}`)).json();
        const zilch = await (await page.request.get("/api/zilch/achievements")).json();
        return [
          zdwa.player.achievements.unlocked.some(item => item.key === "github_clicked"),
          zilch.unlocked.some(item => item.key === "zilch.github_clicked"),
        ];
      };
      const path = product === "zilch" ? "/zilch/konto" : "/konto";
      await page.goto(`${path}#settings`);
      const help = page.locator('details[data-account-section="help"]');
      await help.locator(":scope > summary").click();
      await page.locator(".release-notes-support > summary").click();
      const link = page.locator(`a[href="/go/github/${destination}"]`);
      await expect(link).toBeVisible();
      expect(await unlocked()).toEqual([false, false]);

      const target = destination === "issues"
        ? "https://github.com/Maetran/RollTheDice/issues"
        : "https://github.com/Maetran/RollTheDice/blob/master/CHANGELOG.md";
      // Model an external browser without the app's login. Its redirect cannot
      // earn anything: only the authenticated POST from the clicked app can.
      await context.route("**/go/github/*", route => route.fulfill({
        contentType: "text/html", body: `<meta http-equiv="refresh" content="0;url=${target}">`,
      }));
      await context.route("https://github.com/**", route => route.fulfill({ contentType: "text/html", body: "<h1>GitHub destination</h1>" }));
      const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/account/engagement/github/${destination}`) && response.request().method() === "POST");
      const popupPromise = page.waitForEvent("popup");
      await link.click();
      expect((await responsePromise).ok()).toBe(true);
      const popup = await popupPromise;
      await expect(popup).toHaveURL(target);
      await popup.close();
      expect(await unlocked()).toEqual([true, true]);
      await page.locator(product === "zilch" ? '[data-zilch-account-tab="achievements"]' : "#achievementsTab").click();
      await expect(page.locator(product === "zilch" ? ".zilch-achievement-card.is-unlocked" : ".achievement-card.unlocked").filter({ hasText: "Neugierig geblieben" })).toBeVisible();
    });
  }
}
