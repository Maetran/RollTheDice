const { test, expect } = require("@playwright/test");

const temporaryPassword = "temporary-account-password";
const password = "passkey-browser-password-123";

async function createAccount(page, username, language) {
  const admin = await page.request.post("/api/auth/login", {
    data: { username: "Admin", password: "temporary-password-123" },
  });
  expect(admin.ok()).toBeTruthy();
  const administrator = (await admin.json()).user;
  const created = await page.request.post("/api/admin/users", {
    headers: { "X-CSRF-Token": administrator.csrf_token },
    data: { username, temporary_password: temporaryPassword },
  });
  expect(created.ok()).toBeTruthy();
  const initial = await page.request.post("/api/auth/login", { data: { username, password: temporaryPassword } });
  const identity = (await initial.json()).user;
  const preference = await page.request.put("/api/auth/preferences/language", {
    headers: { "X-CSRF-Token": identity.csrf_token }, data: { preferred_language: language },
  });
  expect(preference.ok()).toBeTruthy();
  const changed = await page.request.post("/api/auth/change-password", {
    headers: { "X-CSRF-Token": identity.csrf_token },
    data: { current_password: temporaryPassword, new_password: password },
  });
  expect(changed.ok()).toBeTruthy();
  return identity.id;
}

async function logout(page) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const response = await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": auth.user.csrf_token } });
  expect(response.ok()).toBeTruthy();
}

async function passwordLogin(page, product, username) {
  const zilch = product === "zilch";
  await page.goto(zilch ? "/zilch/anmelden?return_to=/zilch/konto" : "/");
  await page.locator(zilch ? "#zilchLoginUsername" : "#loginUsername").fill(username);
  await page.locator(zilch ? "#zilchLoginPassword" : "#loginPassword").fill(password);
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/auth/login") && response.status() === 200),
    page.locator(zilch ? "#zilchLoginForm button[type=submit]" : "#loginForm button[type=submit]").click(),
  ]);
  if (zilch) {
    await expect(page.locator(".zilch-account-head__identity h1")).toContainText(username);
    expect(new URL(page.url()).pathname).toBe("/zilch/konto");
  }
  else await expect(page.locator("#authBadge")).toContainText(username);
}

for (const product of ["zdwa", "zilch"]) {
  for (const language of ["de", "en"]) {
    test(`${product}: native passkey create, login, remove and password fallback (${language})`, async ({ page, context }, testInfo) => {
      const username = `Passkey_${product}_${language}`;
      const userId = await createAccount(page, username, language);
      const client = await context.newCDPSession(page);
      await client.send("WebAuthn.enable");
      const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal",
          hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      try {
        await passwordLogin(page, product, username);
        const accountPath = product === "zilch" ? "/zilch/konto#settings" : "/konto#settings";
        await page.goto(accountPath);
        await expect(page.locator("details[data-account-section=access]")).toHaveAttribute("open", "");
        await expect(page.locator("details[data-account-action=profile]")).not.toHaveAttribute("open", "");
        await expect(page.locator("details[data-account-action=password]")).not.toHaveAttribute("open", "");
        const settings = page.locator("details[data-account-section=access] [data-passkey-settings]");
        const currentPassword = settings.locator('[name="current_password"]');
        await expect(currentPassword).toBeVisible();
        await currentPassword.fill(password);
        await settings.locator('[name="label"]').fill("Browser test device");
        await settings.getByRole("button", { name: language === "en" ? "Add passkey" : "Passkey hinzufügen" }).click();
        await expect(settings.locator("[data-passkey-list]")).toContainText("Browser test device");
        await expect(settings.locator("[data-passkey-message]")).toContainText(language === "en" ? "Passkey saved" : "Passkey gespeichert");
        await expect(currentPassword).toHaveValue("");
        const credentials = (await client.send("WebAuthn.getCredentials", { authenticatorId })).credentials;
        expect(credentials).toHaveLength(1);
        expect(credentials[0].rpId).toBe("rollthedice.localhost");
        expect(credentials[0].isResidentCredential).toBe(true);
        await testInfo.attach(`${product}-${language}-passkey-settings`, { body: await settings.screenshot(), contentType: "image/png" });
        for (const [layout, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 375, height: 844 }]]) {
          await page.setViewportSize(viewport);
          await page.evaluate(() => {
            document.activeElement?.blur();
            window.scrollTo({ top: 0, behavior: "instant" });
          });
          await page.screenshot({ path: `/tmp/rollthedice-account-${product}-${language}-${layout}.png`, fullPage: true });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        await page.setViewportSize({ width: 1280, height: 720 });

        await logout(page);
        await page.goto(product === "zilch" ? "/zilch/anmelden?return_to=/zilch/konto" : "/");
        const login = page.locator(product === "zilch" ? "#zilchPasskeyLoginButton" : "#passkeyLoginButton");
        await expect(login).toBeVisible();
        const passwordForm = page.locator(product === "zilch" ? "#zilchLoginForm" : "#loginForm");
        expect((await login.boundingBox()).y).toBeLessThan((await passwordForm.boundingBox()).y);
        await Promise.all([
          page.waitForResponse(response => response.url().endsWith("/api/auth/passkeys/authentication/verify") && response.status() === 200),
          login.click(),
        ]);
        if (product === "zilch") {
          await expect(page.locator(".zilch-account-head__identity h1")).toContainText(username);
          expect(new URL(page.url()).pathname).toBe("/zilch/konto");
        }
        else await expect(page.locator("#authBadge")).toContainText(username);
        const authenticated = await (await page.request.get("/api/auth/me")).json();
        expect(authenticated.user.id).toBe(userId);

        await page.goto(accountPath);
        await currentPassword.fill(password);
        page.once("dialog", dialog => dialog.accept());
        await settings.locator("[data-remove-passkey]").click();
        await expect(settings.locator("[data-passkey-list] li")).toHaveCount(0);
        await expect(settings.locator("[data-passkey-message]")).toContainText(language === "en" ? "Passkey removed" : "Passkey entfernt");
        expect((await (await page.request.get("/api/auth/passkeys")).json()).credentials).toEqual([]);
        await logout(page);
        await passwordLogin(page, product, username);
        expect((await (await page.request.get("/api/auth/me")).json()).user.id).toBe(userId);
      } finally {
        await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
        await client.detach();
      }
    });
  }
}
