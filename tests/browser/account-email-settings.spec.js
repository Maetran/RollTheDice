const { test, expect } = require("@playwright/test");

test.use({ serviceWorkers: "block" });

async function createAccount(page, username, language) {
  const temporaryPassword = "mail-settings-temporary-password";
  const password = "mail-settings-final-password";
  const administrator = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(administrator.ok()).toBeTruthy();
  const admin = (await administrator.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": admin.csrf_token },
    data: { username, temporary_password: temporaryPassword },
  });
  expect(created.status()).toBe(201);
  const initial = await page.request.post("/api/auth/login", {
    data: { username, password: temporaryPassword },
  });
  expect(initial.ok()).toBeTruthy();
  const user = (await initial.json()).user;
  const headers = { "X-CSRF-Token": user.csrf_token };
  expect((await page.request.put("/api/auth/preferences/language", {
    headers, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/change-password", {
    headers, data: { current_password: temporaryPassword, new_password: password },
  })).ok()).toBeTruthy();
  expect((await page.request.post("/api/auth/login", {
    data: { username, password },
  })).ok()).toBeTruthy();
  return { user, password };
}

for (const product of ["zdwa", "zilch"]) {
  for (const language of ["de", "en"]) {
    test(`${product} email-enabled account shows setup, pending and confirmed status (${language})`, async ({ page }, testInfo) => {
      const { user, password } = await createAccount(page, `EmailSettings_${product}_${language}`, language);
      await page.route("**/api/auth/me", async route => {
        const response = await route.fetch();
        const auth = await response.json();
        await route.fulfill({ response, json: {
          ...auth, registration: { ...auth.registration, email_enabled: true },
        } });
      });
      await page.route("**/api/releases**", route => route.fulfill({
        json: { viewer_id: user.id, releases: [], can_prompt: false },
      }));
      let emailStatus = { delivery_available: true, email: null, email_confirmed: false, pending_email: null };
      const requests = [];
      // Intercept every email mutation: these UI tests never contact a provider
      // or enable sending on the isolated backend.
      await page.route("**/api/auth/email", async route => {
        if (route.request().method() === "POST") {
          const payload = route.request().postDataJSON();
          requests.push(payload);
          emailStatus = { ...emailStatus, pending_email: payload.email };
          await route.fulfill({ json: { ok: true } });
          return;
        }
        expect(route.request().method()).toBe("GET");
        await route.fulfill({ json: emailStatus });
      });
      await page.setViewportSize({ width: 375, height: 844 });
      await page.goto(`${product === "zilch" ? "/zilch/konto" : "/konto"}#settings`);
      const section = page.locator("[data-email-section]");
      const email = section.locator("[data-email-settings]");
      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(section).toBeVisible();
      await expect(section.getByRole("heading")).toHaveText(language === "de" ? "E-Mail-Adresse für Anmeldung" : "Email address for sign in");
      await expect(email).toContainText(language === "de"
        ? "Hinterlege eine bestätigte E-Mail-Adresse" : "Add a confirmed email address");
      await expect(page.locator("[data-passkey-section]")).toBeHidden();
      await expect(page.locator("details[data-account-action=profile] > summary")).toBeVisible();
      await email.locator('input[name="email"]').fill("new-mail@example.test");
      await email.locator('input[name="current_password"]').fill(password);
      await email.getByRole("button", { name: language === "de" ? "Bestätigungs-E-Mail senden" : "Send confirmation email" }).click();
      await expect(email).toContainText(language === "de" ? "Bestätigung ausstehend für" : "Confirmation pending for");
      await expect(email.locator("strong")).toHaveText("new-mail@example.test");
      await expect(email.locator('input[name="current_password"]')).toHaveValue("");
      expect(requests).toEqual([{ email: "new-mail@example.test", current_password: password }]);

      emailStatus = { delivery_available: true, email: "new-mail@example.test", email_confirmed: true, pending_email: null };
      await page.reload();
      await expect(email).toContainText(language === "de" ? "Bestätigte E-Mail-Adresse:" : "Confirmed email address:");
      await expect(email.locator("strong")).toHaveText("new-mail@example.test");
      await expect(email).not.toContainText(language === "de" ? "Bestätigung ausstehend für" : "Confirmation pending for");

      emailStatus = { ...emailStatus, pending_email: "replacement@example.test" };
      await page.reload();
      await expect(email.locator("strong")).toHaveText(["new-mail@example.test", "replacement@example.test"]);
      await expect(page.locator("details[data-account-section=access]")).toHaveAttribute("open", "");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await testInfo.attach(`${product}-${language}-account-email-status`, { body: await section.screenshot(), contentType: "image/png" });
      expect(requests).toHaveLength(1);
    });
  }
}
