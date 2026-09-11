const { test, expect } = require("@playwright/test");

// Run with ROLLTHEDICE_ZILCH_ACCESS_MODE=public to cover normal public accounts.
for (const product of ["zdwa", "zilch"]) {
  for (const language of ["de", "en"]) {
    test(`${product} username changes preserve the account (${language})`, async ({ page }, testInfo) => {
      const original = `Rename_${product}_${language}`;
      const renamed = `${original}_new`;
      const password = "username-browser-password";
      const admin = await page.request.post("/api/auth/login", {
        data: { username: "Admin", password: "temporary-password-123" },
      });
      expect(admin.ok()).toBeTruthy();
      const adminIdentity = (await admin.json()).user;
      const created = await page.request.post("/api/admin/users", {
        headers: { "X-CSRF-Token": adminIdentity.csrf_token },
        data: { username: original, temporary_password: password },
      });
      expect(created.ok()).toBeTruthy();
      const signedIn = await page.request.post("/api/auth/login", { data: { username: original, password } });
      const identity = (await signedIn.json()).user;
      expect((await page.request.put("/api/auth/preferences/language", {
        headers: { "X-CSRF-Token": identity.csrf_token },
        data: { preferred_language: language },
      })).ok()).toBeTruthy();
      const accountPath = product === "zilch" ? "/zilch/konto" : "/konto";
      await page.goto(`${accountPath}#settings`);
      const settings = page.locator("[data-username-settings]");
      const name = settings.locator('[name="username"]');
      const secret = settings.locator('[name="current_password"]');
      const save = settings.getByRole("button", { name: language === "en" ? "Save username" : "Benutzername speichern" });
      const message = settings.getByRole("status");
      await expect(name).toHaveValue(original);
      await expect(save).toBeVisible();
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

      await name.fill(renamed);
      await secret.fill("wrong-password");
      await save.click();
      await expect(message).toContainText(language === "en" ? "current password is incorrect" : "aktuelle Passwort ist falsch");
      await secret.fill(password);
      await name.fill("Admin");
      await save.click();
      await expect(message).toContainText(language === "en" ? "already taken" : "bereits vergeben");
      await name.fill(renamed);
      await save.click();
      await expect(message).toContainText(language === "en" ? "Username changed" : "Benutzername geändert");
      await expect(secret).toHaveValue("");
      await expect(page.locator(product === "zilch" ? ".zilch-account-head__identity h1" : "#accountName")).toContainText(renamed);
      if (product === "zdwa") await expect(page.locator("#publicProfileLink")).toHaveAttribute("href", `/spieler/${renamed}`);
      const me = await (await page.request.get("/api/auth/me")).json();
      expect(me.user.id).toBe(identity.id);
      expect(me.user.username).toBe(renamed);
      expect(me.user.csrf_token).toBe(identity.csrf_token);
      await page.setViewportSize({ width: 390, height: 844 });
      await settings.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await testInfo.attach(`${product}-${language}-username`, { body: await settings.screenshot(), contentType: "image/png" });
      await page.reload();
      await expect(name).toHaveValue(renamed);
      await page.goto(`${product === "zilch" ? "/konto" : "/zilch/konto"}#settings`);
      await expect(page.locator('[data-username-settings] [name="username"]')).toHaveValue(renamed);
      const oldLogin = await page.request.post("/api/auth/login", { data: { username: original, password } });
      expect(oldLogin.status()).toBe(401);
      const newLogin = await page.request.post("/api/auth/login", { data: { username: renamed.toLowerCase(), password } });
      expect(newLogin.ok()).toBeTruthy();
      expect((await newLogin.json()).user.id).toBe(identity.id);
    });
  }
}
