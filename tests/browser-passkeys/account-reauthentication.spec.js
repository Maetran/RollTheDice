const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

const authenticatorOptions = {
  protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
  hasResidentKey: true, hasUserVerification: true, isUserVerified: true,
  automaticPresenceSimulation: true,
};

for (const product of ['zdwa', 'zilch']) {
  for (const language of ['de', 'en']) {
    test(`${product}: account changes prefer native passkeys and keep password fallback (${language})`, async ({ page, context }, testInfo) => {
      // The local Uvicorn server trusts its loopback test proxy. Give each
      // account a distinct documentation-only client IP, preserving the real
      // production rate limit while exercising many ceremonies in one suite.
      await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `192.0.2.${product === 'zilch' ? 20 : 10}${language === 'en' ? 2 : 1}` });
      const username = `Reauth_${product}_${language}`;
      const password = 'reauth-browser-password-123';
      const adminLogin = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
      const admin = (await adminLogin.json()).user;
      const registered = await page.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': admin.csrf_token }, data: { username, temporary_password: 'temporary-reauth-password' } });
      expect(registered.status()).toBe(201);
      const firstLogin = await page.request.post('/api/auth/login', { data: { username, password: 'temporary-reauth-password' } });
      const user = (await firstLogin.json()).user;
      const headers = { 'X-CSRF-Token': user.csrf_token };
      expect((await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } })).ok()).toBe(true);
      expect((await page.request.post('/api/auth/change-password', { headers, data: { current_password: 'temporary-reauth-password', new_password: password } })).ok()).toBe(true);
      expect((await page.request.post('/api/auth/login', { data: { username, password } })).ok()).toBe(true);
      // Enable only the email UI. Every email delivery mutation stays local to
      // this fixture; backend signature/target validation has dedicated tests.
      await page.route('**/api/auth/me', async route => {
        const response = await route.fetch();
        const payload = await response.json();
        await route.fulfill({ response, json: { ...payload, registration: { ...payload.registration, email_enabled: true } } });
      });
      let pendingEmail = null;
      const emailRequests = [];
      await page.route('**/api/auth/email', async route => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON();
          emailRequests.push(body);
          pendingEmail = body.email;
          return route.fulfill({ json: { ok: true } });
        }
        return route.fulfill({ json: { delivery_available: true, email_confirmed: false, pending_email: pendingEmail } });
      });
      const mutations = [];
      page.on('request', request => {
        if (request.method() === 'POST' && /\/api\/auth\/(change-username|change-password|passkeys\/registration\/options)$/.test(new URL(request.url()).pathname)) {
          mutations.push({ path: new URL(request.url()).pathname, body: request.postDataJSON() });
        }
      });
      const client = await context.newCDPSession(page);
      await client.send('WebAuthn.enable');
      let { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions });
      let secondAuthenticator;
      try {
        await page.goto(`${product === 'zilch' ? '/zilch/konto' : '/konto'}#settings`);
        const keys = page.locator('[data-passkey-settings]');
        const add = keys.locator('button[type=submit]');
        await keys.locator('[name=current_password]').fill(password);
        await keys.locator('[name=label]').fill('First device');
        await add.click();
        await expect(keys.locator('[data-passkey-list]')).toContainText('First device');
        await expect(keys.locator('[name=current_password]')).toBeHidden();
        const identity = page.locator('[data-username-settings]');
        await page.locator('[data-account-action=profile] > summary').click();
        await identity.locator('[name=username]').fill(`${username}_new`);
        await expect(identity.locator('[data-account-verification]')).toHaveAttribute('data-verification-method', 'passkey');
        await expect(identity.locator('[name=current_password]')).toBeHidden();
        expect(await identity.locator('form').evaluate(form => form.checkValidity())).toBe(true);

        // Cancellation must leave both account and mutation count unchanged.
        await page.evaluate(() => {
          window.originalCredentialGet = navigator.credentials.get.bind(navigator.credentials);
          navigator.credentials.get = () => Promise.reject(new DOMException('Cancelled by the user', 'NotAllowedError'));
        });
        const beforeCancel = mutations.length;
        await identity.locator('button[type=submit]').click();
        await expect(identity.getByRole('status')).toContainText(language === 'en' ? 'Nothing changed' : 'Es wurde nichts geändert');
        expect(mutations).toHaveLength(beforeCancel);
        expect((await (await page.request.get('/api/auth/me')).json()).user.username).toBe(username);
        await page.evaluate(() => { navigator.credentials.get = window.originalCredentialGet; });
        await identity.locator('button[type=submit]').click();
        await expect(identity.getByRole('status')).toContainText(language === 'en' ? 'Username changed' : 'Benutzername geändert');
        const rename = mutations.find(entry => entry.path.endsWith('change-username'));
        expect(rename.body.current_password).toBeUndefined();
        expect(rename.body.passkey.credential.response.signature).toBeTruthy();
        const renamedUser = (await (await page.request.get('/api/auth/me')).json()).user;
        expect(renamedUser.id).toBe(user.id);
        expect(renamedUser.username).toBe(`${username}_new`);

        // The explicit fallback is usable, and switching back removes hidden
        // required controls from validation before another real assertion.
        await identity.locator('[data-verification-switch]').click();
        await expect(identity.locator('[name=current_password]')).toBeVisible();
        await identity.locator('[name=current_password]').fill(password);
        await identity.locator('[name=username]').fill(`${username}_pw`);
        await identity.locator('button[type=submit]').click();
        await expect(identity.getByRole('status')).toContainText(language === 'en' ? 'Username changed' : 'Benutzername geändert');
        expect(mutations.at(-1).body.current_password).toBe(password);
        await identity.locator('[data-verification-switch]').click();
        await expect(identity.locator('[name=current_password]')).toBeDisabled();

        const email = page.locator('[data-email-settings]');
        await expect(email.locator('[data-account-verification]')).toHaveAttribute('data-verification-method', 'passkey');
        await email.locator('[name=email]').fill('passkey-confirmed@example.test');
        await email.locator('button[type=submit]').click();
        await expect(email).toContainText('passkey-confirmed@example.test');
        expect(emailRequests).toHaveLength(1);
        expect(emailRequests[0].current_password).toBeUndefined();
        expect(emailRequests[0].passkey.credential.response.signature).toBeTruthy();

        // Reauthenticate using the first device, then present a fresh device
        // for enrollment. Existing-key exclusion stays enabled end to end.
        await page.route('**/api/auth/passkeys/registration/options', async route => {
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          expect(route.request().postDataJSON().passkey).toBeTruthy();
          await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
          authenticatorId = null;
          secondAuthenticator = (await client.send('WebAuthn.addVirtualAuthenticator', { options: authenticatorOptions })).authenticatorId;
          await route.fulfill({ response });
        }, { times: 1 });
        await keys.locator('[name=label]').fill('Second device');
        await add.click();
        await expect(keys.locator('[data-passkey-list] li')).toHaveCount(2);
        page.once('dialog', dialog => dialog.accept());
        await keys.locator('[data-passkey-list] li').filter({ hasText: 'First device' }).getByRole('button').click();
        await expect(keys.locator('[data-passkey-list] li')).toHaveCount(1);
        await expect(keys.locator('[data-passkey-list]')).toContainText('Second device');

        await page.locator('[data-account-action=password] > summary').click();
        const passwordForm = page.locator(product === 'zilch' ? '#zilchPasswordForm' : '#passwordForm');
        await expect(passwordForm.locator('[data-account-verification]')).toHaveAttribute('data-verification-method', 'passkey');
        await expect(passwordForm.locator('[name=current_password]')).toBeHidden();
        const nextPassword = 'changed-with-passkey-123';
        await page.locator(product === 'zilch' ? '#zilchNewPassword' : '#newPassword').fill(nextPassword);
        await page.locator(product === 'zilch' ? '#zilchConfirmPassword' : '#confirmPassword').fill(nextPassword);
        await testInfo.attach('passkey-first-account', { body: await passwordForm.screenshot({ path: `/tmp/passkey-first-${product}-${language}.png` }), contentType: 'image/png' });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await passwordForm.locator('button[type=submit]').click();
        await expect(page.locator(product === 'zilch' ? '#zilchPasswordMessage' : '#passwordMessage')).toContainText(language === 'en' ? 'Password changed' : 'Passwort geändert');
        const change = mutations.find(entry => entry.path.endsWith('change-password'));
        expect(change.body.current_password).toBeUndefined();
        expect(change.body.passkey.credential.response.signature).toBeTruthy();
        expect((await page.request.post('/api/auth/login', { data: { username: `${username}_pw`, password: nextPassword } })).ok()).toBe(true);
      } finally {
        if (authenticatorId) await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
        if (secondAuthenticator) await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: secondAuthenticator });
        await client.detach();
      }
    });
  }
}

for (const product of ['zdwa', 'zilch']) {
  for (const language of ['de', 'en']) {
    test(`${product}: password recovery leads to passkey-first login (${language})`, async ({ page }) => {
      await page.route('**/api/auth/password-reset/inspect', route => route.fulfill({ json: { valid: true } }));
      for (const path of ['/passwort-vergessen', '/passwort-zuruecksetzen']) {
        const parameters = new URLSearchParams({ lang: language, ...(product === 'zilch' ? { app: product, return_to: '/zilch/konto#settings' } : {}) });
        await page.goto(`${path}?${parameters}${path.endsWith('zuruecksetzen') ? '#token=fixture-token' : ''}`);
        const link = page.locator('[data-passkey-recovery] a');
        await expect(link).toHaveText(language === 'en' ? 'Sign in with a passkey' : 'Mit Passkey anmelden');
        expect((await link.boundingBox()).y).toBeLessThan((await page.locator('form').boundingBox()).y);
        await link.click();
        await expect(page.locator(product === 'zilch' ? '#zilchPasskeyLoginButton' : '#passkeyLoginButton')).toBeVisible();
        await expect(page.locator(product === 'zilch' ? '#zilchLoginForm' : '#loginForm')).toBeHidden();
        if (product === 'zilch') expect(new URL(page.url()).searchParams.get('return_to')).toBe('/zilch/konto#settings');
      }
    });
  }
}
