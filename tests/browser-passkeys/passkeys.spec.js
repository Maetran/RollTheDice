const { test, expect } = require("@playwright/test");
const { openPasswordLogin } = require("../browser/password-login");

const temporaryPassword = "temporary-account-password";
const password = "passkey-browser-password-123";

async function createAccount(page, username, language) {
  await page.addInitScript(lang => localStorage.setItem('zdwa_language', lang), language);
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

test('Zilch subdomain landing creates a native passkey account without an apex handoff', async ({ page, context, baseURL }) => {
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': '192.0.2.5' });
  const zilchOrigin = new URL(baseURL);
  zilchOrigin.hostname = `zilch.${zilchOrigin.hostname}`;
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true,
  } });
  try {
    await page.goto(zilchOrigin.href);
    await page.locator('#zilchLandingRegistrationUsername').fill('SubdomainSignup');
    const verification = page.waitForResponse(response => response.url().endsWith('/api/auth/passkeys/signup/verify'));
    const [options] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith('/api/auth/passkeys/signup/options')),
      page.locator('[data-registration-form] button[type="submit"]').click(),
    ]);
    expect(options.status()).toBe(200);
    expect((await verification).status()).toBe(201);
    await expect(page.locator('.zilch-lobby-identity strong')).toHaveText('SubdomainSignup');
    expect(new URL(page.url()).origin).toBe(zilchOrigin.origin);
    expect(new URL(page.url()).pathname).toBe('/');
    const identity = await (await page.request.get(new URL('/api/auth/me', zilchOrigin).href)).json();
    expect(identity.authenticated).toBe(true);
    expect(identity.user.has_password).toBe(false);
    expect(identity.passkeys.has_credentials).toBe(true);
    const credentials = (await client.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
    expect(credentials).toHaveLength(1);
    expect(credentials[0].rpId).toBe('rollthedice.localhost');
    const accountDocument = await page.request.get(new URL('/konto', zilchOrigin).href);
    expect(accountDocument.status()).toBe(200);
    expect(await accountDocument.text()).toContain('name="robots" content="noindex');
    const inventory = await (await page.request.get(new URL('/api/auth/passkeys', zilchOrigin).href)).json();
    expect(inventory.credentials).toHaveLength(1);
  } finally {
    await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
    await client.detach().catch(() => {});
  }
});

async function logout(page) {
  const auth = await (await page.request.get("/api/auth/me")).json();
  const response = await page.request.post("/api/auth/logout", { headers: { "X-CSRF-Token": auth.user.csrf_token } });
  expect(response.ok()).toBeTruthy();
}

async function passwordLogin(page, product, username) {
  const zilch = product === "zilch";
  await page.goto(zilch ? "/zilch/anmelden?return_to=/zilch/konto" : "/");
  await openPasswordLogin(page, zilch);
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
        const prompt = page.locator("[data-passkey-prompt]");
        await expect(prompt).toBeVisible();
        const promptLink = prompt.locator("[data-passkey-prompt-link]");
        const promptDestination = new URL(await promptLink.getAttribute("href"), page.url());
        expect(promptDestination.pathname).toBe(product === "zilch" ? "/zilch/konto" : "/konto");
        expect(promptDestination.searchParams.get("passkey")).toBe("1");
        expect(promptDestination.hash).toBe("#settings");
        await promptLink.click();
        await expect(page.locator("details[data-account-section=access]")).toHaveAttribute("open", "");
        await expect(page.locator("details[data-account-action=profile]")).not.toHaveAttribute("open", "");
        await expect(page.locator("details[data-account-action=password]")).not.toHaveAttribute("open", "");
        const settings = page.locator("details[data-account-section=access] [data-passkey-settings]");
        const currentPassword = settings.locator('[name="current_password"]');
        await expect(currentPassword).toBeVisible();
        await expect(currentPassword).toBeFocused();
        await currentPassword.fill(password);
        await settings.locator('[name="label"]').fill("Browser test device");
        await settings.getByRole("button", { name: language === "en" ? "Add passkey" : "Passkey hinzufügen" }).click();
        await expect(settings.locator("[data-passkey-list]")).toContainText("Browser test device");
        await expect(settings.locator("[data-passkey-message]")).toContainText(language === "en" ? "Passkey saved" : "Passkey gespeichert");
        await expect(currentPassword).toHaveValue("");
        await expect(prompt).toBeHidden();
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
        await expect(passwordForm).toBeHidden();
        const fallback = page.locator(product === "zilch" ? "#zilchPasswordLogin > summary" : "#passwordLogin > summary");
        await expect(fallback).toBeVisible();
        expect((await login.boundingBox()).y).toBeLessThan((await fallback.boundingBox()).y);
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
        await expect(prompt).toBeHidden();

        await page.goto(accountPath.replace("#settings", "?passkey=1#settings"));
        await expect(settings.locator("button[type=submit]")).toBeFocused();
        await expect(currentPassword).toBeHidden();
        await expect(settings.locator("[data-account-verification]")).toHaveAttribute("data-verification-method", "passkey");
        page.once("dialog", dialog => dialog.accept());
        await settings.locator("[data-remove-passkey]").click();
        await expect(settings.locator("[data-passkey-list] li")).toHaveCount(0);
        await expect(settings.locator("[data-passkey-message]")).toContainText(language === "en" ? "Passkey removed" : "Passkey entfernt");
        await expect(prompt).toBeHidden();
        expect((await (await page.request.get("/api/auth/passkeys")).json()).credentials).toEqual([]);
        await logout(page);
        await passwordLogin(page, product, username);
        await expect(prompt).toBeHidden();
        expect((await (await page.request.get("/api/auth/me")).json()).user.id).toBe(userId);
      } finally {
        await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
        await client.detach();
      }
    });
  }
}

for (const product of ['zdwa', 'zilch']) {
  for (const language of ['de', 'en']) {
    test(`${product}: landing creates a native passkey account and adds a password backup (${language})`, async ({ page, context }) => {
      const username = `Signup_${product}_${language}`;
      // The local Uvicorn trusts its loopback proxy. Give these independent
      // players independent reserved addresses without loosening rate limits.
      const clientAddress = 1 + (product === 'zilch' ? 2 : 0) + (language === 'en' ? 1 : 0);
      await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${clientAddress}` });
      await page.addInitScript(lang => localStorage.setItem('zdwa_language', lang), language);
      const client = await context.newCDPSession(page);
      await client.send('WebAuthn.enable');
      const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
        automaticPresenceSimulation: true,
      } });
      try {
        const landing = product === 'zilch' ? '/zilch' : '/';
        await page.goto(landing);
        const form = page.locator(product === 'zilch' ? '[data-registration-form]' : '#registrationForm');
        await expect(form).toBeVisible();
        await form.locator(product === 'zilch' ? '[data-registration-username]' : '#registrationUsername').fill(username);
        await expect(form.locator(product === 'zilch' ? '[data-registration-method]' : '#registrationMethod')).toHaveValue('passkey');
        await expect(form.locator(product === 'zilch' ? '[data-registration-email]' : '#registrationEmail')).toBeHidden();
        await expect(form.locator(product === 'zilch' ? '[data-registration-password]' : '#registrationPassword')).toBeHidden();
        const verification = page.waitForResponse(response => response.url().endsWith('/api/auth/passkeys/signup/verify'));
        const [options] = await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/api/auth/passkeys/signup/options')),
          form.locator('button[type="submit"]').click(),
        ]);
        expect(options.status()).toBe(200);
        expect((await verification).status()).toBe(201);
        await expect(page.locator(product === 'zilch' ? '.zilch-lobby-identity strong' : '#authBadge')).toContainText(username);
        expect(new URL(page.url()).pathname).toBe(landing);
        const identity = await (await page.request.get('/api/auth/me')).json();
        expect(identity.authenticated).toBe(true);
        expect(identity.user.has_password).toBe(false);
        expect(identity.passkeys.has_credentials).toBe(true);
        const credentials = (await client.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
        expect(credentials).toHaveLength(1);
        expect(credentials[0].isResidentCredential).toBe(true);

        // A passkey-only player cannot remove their only working sign-in.
        await page.goto(product === 'zilch' ? '/zilch/konto?passkey=1#settings' : '/konto?passkey=1#settings');
        const settings = page.locator('details[data-account-section=access] [data-passkey-settings]');
        await expect(settings.locator('[data-passkey-list] li')).toHaveCount(1);
        page.once('dialog', dialog => dialog.accept());
        await settings.locator('[data-remove-passkey]').click();
        await expect(settings.locator('[data-passkey-list] li')).toHaveCount(1);
        await expect(settings.locator('[data-passkey-message]')).toContainText(language === 'en' ? 'backup password' : 'Backup-Passwort');

        // The backup can be added with the existing passkey, with no invented
        // current password, and afterwards works as an independent login.
        const passwordDisclosure = page.locator('details[data-account-action=password]');
        await passwordDisclosure.locator(':scope > summary').click();
        const passwordForm = page.locator(product === 'zilch' ? '#zilchPasswordForm' : '#passwordForm');
        await expect(passwordForm.locator('[name="current_password"]')).toBeHidden();
        await expect(passwordForm.locator('[data-account-verification]')).toHaveAttribute('data-verification-method', 'passkey');
        await passwordForm.locator(product === 'zilch' ? '#zilchNewPassword' : '#newPassword').fill(password);
        await passwordForm.locator(product === 'zilch' ? '#zilchConfirmPassword' : '#confirmPassword').fill(password);
        await Promise.all([
          page.waitForResponse(response => response.url().endsWith('/api/auth/change-password') && response.status() === 200),
          passwordForm.locator('button[type="submit"]').click(),
        ]);
        await page.waitForURL(url => !url.pathname.endsWith('/konto'));
        await passwordLogin(page, product, username);
        const backedUp = await (await page.request.get('/api/auth/me')).json();
        expect(backedUp.user.id).toBe(identity.user.id);
        expect(backedUp.user.has_password).toBe(true);
        expect(backedUp.passkeys.has_credentials).toBe(true);
      } finally {
        await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
        await client.detach().catch(() => {});
      }
    });
  }
}
