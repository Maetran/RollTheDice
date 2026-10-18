const { test, expect, request } = require('@playwright/test');

const HOUSE = 'https://hausdepp.zockdiewandan.online';
const APEX = 'https://zockdiewandan.online';
const port = Number(process.env.ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT || 8054);

async function localTransport(context, suffix, allowedOrigins = [HOUSE]) {
  const transport = await request.newContext();
  const unexpected = [];
  const relay = { unexpected, dispose: () => transport.dispose(), beforeFulfill: null };
  await context.route('**/*', async route => {
    const original = route.request();
    const target = new URL(original.url());
    if (!allowedOrigins.includes(target.origin)) { unexpected.push(target.href); return route.abort(); }
    const headers = { ...await original.allHeaders(), host: target.host, 'x-forwarded-proto': 'https', 'x-forwarded-for': `192.0.2.${suffix}` };
    delete headers['content-length'];
    const upstream = new URL(`${target.pathname}${target.search}`, `http://127.0.0.1:${port}`);
    const response = await transport.fetch(upstream.href, { method: original.method(), headers, data: original.postDataBuffer() || undefined, maxRedirects: 0 });
    if (relay.beforeFulfill) await relay.beforeFulfill(target, response);
    await route.fulfill({ response });
  });
  for (const origin of allowedOrigins) await context.routeWebSocket(`${origin.replace('https:', 'wss:')}/**`, () => {});
  return relay;
}

async function expectAppleIcon(page) {
  const link = page.locator('link[rel="apple-touch-icon"]');
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('sizes', '180x180');
  await expect(link).toHaveAttribute('type', 'image/png');
  const href = await link.getAttribute('href');
  expect(href).toMatch(/hausdepp-apple-touch-icon-180-v2\.png\?v=[a-f0-9]{12}$/);
  const decoded = await page.evaluate(async src => {
    const image = new Image(); image.src = src; await image.decode();
    return [image.naturalWidth, image.naturalHeight];
  }, href);
  expect(decoded).toEqual([180, 180]);
}

// Account settings are collapsed rows; open the row that holds a control first.
async function openSettingsRow(page, selector) {
  const row = page.locator('details.hd-settings-item').filter({ has: page.locator(selector) });
  if (!(await row.evaluate(element => element.open))) await row.locator('> summary').click();
}

for (const language of ['de', 'en']) {
  test(`${language}: Hausdepp native passkey settings, username and backup password share the same account`, async ({ page, context }, testInfo) => {
    const relay = await localTransport(context, language === 'de' ? 51 : 52);
    await context.addInitScript(language => { localStorage.setItem('zdwa_language', language); Object.defineProperty(navigator, 'standalone', { value: true }); }, language);
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    try {
      await page.goto(`${HOUSE}/hausdepp/anmelden?return_to=%2Fhausdepp%2Fkonto%2Feinstellungen`);
      await expectAppleIcon(page);
      await page.locator('#zilchRegistrationUsername').fill(`HouseSettings_${language}`);
      await page.locator('#zilchRegisterButton').click();
      await expect(page).toHaveURL(`${HOUSE}/hausdepp/konto/einstellungen`);
      await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
      await expectAppleIcon(page);
      await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Kontoeinstellungen' : 'Account settings');
      await expect(page.locator('[data-passkey-list] li')).toHaveCount(1);
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await openSettingsRow(page, '[data-game-tour-settings]');
      const tours = page.locator('[data-game-tour-settings]');
      await expect(tours.getByRole('heading')).toHaveText(language === 'de' ? 'Einsteigertouren' : 'Beginner tours');
      await expect(tours.locator('[data-tour-action=start]')).toHaveCount(3);
      await expect(tours.locator('[data-tour-action=view]')).toHaveCount(3);
      for (const enabled of [false, true]) {
        const savedTour = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/tours` && r.request().method() === 'PUT');
        await tours.locator('[data-tour-enabled]').setChecked(enabled);
        expect((await savedTour).status()).toBe(200);
      }
      await tours.locator('[data-tour-action=view][data-tour-game=hausdepp]').click();
      await expect(page.locator('[data-game-tour]')).toBeVisible();
      await expect(page).toHaveURL(`${HOUSE}/hausdepp/konto/einstellungen`);
      await page.locator('[data-tour-close]').click();
      const account = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()));
      await openSettingsRow(page, '[data-passkey-form]');
      await page.locator('[data-passkey-form] input[name=label]').fill('House device backup');
      // Model switching to a second device after the existing credential has
      // authenticated this account. The server correctly excludes the first
      // credential; creating it again on the same device must be refused.
      relay.beforeFulfill = async (target, response) => {
        if (target.pathname === '/api/auth/passkeys/registration/options' && response.status() === 200) {
          await client.send('WebAuthn.clearCredentials', { authenticatorId });
          relay.beforeFulfill = null;
        }
      };
      const added = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/passkeys/registration/verify`);
      await page.locator('[data-passkey-form] button[type=submit]').click();
      expect((await added).status()).toBe(200);
      await expect(page.locator('[data-passkey-list] li')).toHaveCount(2);
      await openSettingsRow(page, '[data-username-form]');
      const usernameForm = page.locator('[data-username-form]');
      await usernameForm.locator('input[name=username]').fill(`HouseRenamed_${language}`);
      const renamed = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/change-username`);
      await usernameForm.locator('button[type=submit]').click();
      expect((await renamed).status()).toBe(200);
      await expect(page.locator('[data-username-message]')).toContainText(language === 'de' ? 'Benutzername geändert' : 'Username changed');
      const changed = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()));
      expect(changed.user.id).toBe(account.user.id);
      expect(changed.user.username).toBe(`HouseRenamed_${language}`);
      await openSettingsRow(page, '#hausdeppLanguageForm');
      const languageForm = page.locator('#hausdeppLanguageForm');
      await languageForm.locator('select').selectOption(language);
      const savedLanguage = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/preferences/language`);
      // Saving the language always reloads the page. Continue only on the
      // reloaded settings page, never on the document that is going away.
      const reloaded = page.waitForEvent('load');
      await languageForm.locator('button').click();
      expect((await savedLanguage).status()).toBe(200);
      await reloaded;
      await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Kontoeinstellungen' : 'Account settings');
      await openSettingsRow(page, '#hausdeppChatForm');
      const chatForm = page.locator('#hausdeppChatForm');
      await chatForm.locator('input[name=enabled]').uncheck();
      const savedChat = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/preferences/lobby-chat`);
      await chatForm.locator('button').click();
      expect((await savedChat).status()).toBe(200);
      await openSettingsRow(page, '#hausdeppPasswordForm');
      const passwordForm = page.locator('#hausdeppPasswordForm');
      await passwordForm.locator('input[name=password]').fill('house-backup-password-123');
      await passwordForm.locator('input[name=confirmation]').fill('house-backup-password-123');
      await page.screenshot({ path: testInfo.outputPath('hausdepp-settings.png'), fullPage: true });
      const saved = page.waitForResponse(r => r.url() === `${HOUSE}/api/auth/change-password`);
      await passwordForm.locator('button[type=submit]').click();
      expect((await saved).status()).toBe(200);
      await expect(page).toHaveURL(`${HOUSE}/hausdepp/anmelden?return_to=%2Fhausdepp%2Fkonto%2Feinstellungen`);
      await expect(page.locator('#zilchPasskeyLoginButton')).toBeVisible();
      await page.locator('#zilchPasswordLogin > summary').click();
      await page.locator('#zilchLoginUsername').fill(`HouseRenamed_${language}`);
      await page.locator('#zilchLoginPassword').fill('house-backup-password-123');
      await page.locator('#zilchLoginForm button[type=submit]').click();
      await expect(page).toHaveURL(`${HOUSE}/hausdepp/konto/einstellungen`);
      const restored = await page.evaluate(() => fetch('/api/auth/me').then(r => r.json()));
      expect(restored.user.id).toBe(account.user.id);
      expect(restored.user.has_password).toBe(true);
      await openSettingsRow(page, '[data-game-tour-settings]');
      await page.locator('[data-tour-action=start][data-tour-game=hausdepp]').click();
      await expect(page).toHaveURL(`${HOUSE}/hausdepp`);
      await expect(page.locator('.game-tour-entry')).toBeVisible();
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('rollthedice.tours.v1.start.hausdepp')))).toBe(true);
      await page.locator('[data-tour-cancel-entry]').click();
      await expect(page.locator('.game-tour-entry')).toHaveCount(0);
      await page.goto(`${HOUSE}/hausdepp/konto/einstellungen`);
      // A request still running when the session ends gets 401 and drops the
      // cached identity before the logout response arrives. Hold that response
      // until such a request (here the start-notice setting) has seen the ended
      // session; signing out must still stay in Hausdepp instead of ZDWA.
      const friendActivity = page.locator('[data-friend-activity-settings] form');
      await expect(friendActivity.locator('button[type=submit]')).toBeEnabled();
      relay.beforeFulfill = async target => {
        if (target.pathname !== '/api/auth/logout') return;
        relay.beforeFulfill = null;
        const ended = page.waitForResponse(r => r.url() === `${HOUSE}/api/friend-activity/preferences` && r.status() === 401);
        await friendActivity.evaluate(form => form.requestSubmit());
        await ended;
        await expect(friendActivity.locator('button[type=submit]')).toBeEnabled();
      };
      const logoutNavigations = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) logoutNavigations.push(frame.url()); });
      await page.locator('#hausdeppLogout').click();
      await expect(page).toHaveURL(`${HOUSE}/hausdepp`);
      await expect(page.locator('#hausdeppSignIn')).toBeVisible();
      expect(logoutNavigations).toEqual([`${HOUSE}/hausdepp`]);
      expect(relay.unexpected).toEqual([]);
    } finally {
      await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await client.detach().catch(() => {}); await relay.dispose();
    }
  });

  test(`${language}: legacy apex House recovery and email registration retain only the inner allowed destination`, async ({ page, context }) => {
    const relay = await localTransport(context, language === 'de' ? 61 : 62, [APEX, HOUSE]);
    await context.addInitScript(language => { localStorage.setItem('zdwa_language', language); }, language);
    await context.route('**/api/auth/me', route => route.fulfill({ json: {
      authenticated: false, user: null, passkeys: { enabled: false },
      registration: { email_enabled: true, turnstile_enabled: false }, game_access: { hausdepp_public: true },
    } }));
    const registrations = [], resets = [];
    await context.route('**/api/auth/register', route => {
      registrations.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
    await context.route('**/api/auth/password-reset', route => {
      resets.push(route.request().postDataJSON());
      return route.fulfill({ status: 202, json: { accepted: true } });
    });
    await context.route('**/api/auth/password-reset/inspect', route => route.fulfill({ json: { valid: false } }));
    await context.route('**/api/auth/email/inspect', route => route.fulfill({ json: { valid: true } }));
    await context.route('**/api/auth/email/confirm', route => route.fulfill({ json: { ok: true } }));
    try {
      for (const target of ['/hausdepp/konto/einstellungen', '/hausdepp/spiel/legacy-invite?seat=2']) {
        const continuation = `/auth/continue?${new URLSearchParams({ app: 'hausdepp', path: target })}`;
        await page.goto(`${APEX}/zilch/anmelden?return_to=${encodeURIComponent(continuation)}`);
        await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
        const forgot = `${APEX}/passwort-vergessen?app=hausdepp&lang=${language}&return_to=${encodeURIComponent(target)}`;
        await expect(page.locator('#zilchForgotPassword')).toHaveAttribute('href', forgot);
        await page.locator('#zilchRegistrationUsername').fill(`LegacyHouse_${language}`);
        await page.locator('#zilchRegistrationEmail').fill(`legacy-${language}@example.test`);
        await page.locator('#zilchRegisterButton').click();
        await expect.poll(() => registrations.length).toBe(resets.length + 1);
        expect(registrations.at(-1)).toMatchObject({ account_app: 'hausdepp', return_to: target, preferred_language: language });
        await page.locator('#zilchPasswordLogin > summary').click();
        await page.locator('#zilchForgotPassword').click();
        await expect(page).toHaveURL(forgot);
        await page.locator('[data-forgot-form] input[name=email]').fill(`legacy-${language}@example.test`);
        await page.locator('[data-forgot-form] button[type=submit]').click();
        await expect.poll(() => resets.length).toBe(registrations.length);
        expect(resets.at(-1)).toMatchObject({ account_app: 'hausdepp', return_to: target, preferred_language: language });
        const parameters = new URLSearchParams({ app: 'hausdepp', lang: language, return_to: continuation });
        await page.goto(`${APEX}/passwort-zuruecksetzen?${parameters}#token=legacy-local-only-test-token-123`);
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.locator('[data-email-action] a').last()).toHaveAttribute('href', `/hausdepp/anmelden?lang=${language}&app=hausdepp&return_to=${encodeURIComponent(target)}`);
        await page.goto(`${APEX}/email-bestaetigen?${parameters}#token=legacy-local-only-test-token-123`);
        await page.locator('[data-email-action] > button').click();
        await expect(page.locator('[data-email-action] a.primary')).toHaveAttribute('href', target);
      }
      expect(relay.unexpected).toEqual([]);
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await relay.dispose(); }
  });

  test(`${language}: recovery, confirmation and errors preserve Hausdepp identity without leaking tokens`, async ({ page, context }) => {
    const relay = await localTransport(context, language === 'de' ? 53 : 54);
    await context.addInitScript(language => { localStorage.setItem('zdwa_language', language); }, language);
    const posts = [];
    await context.route('**/api/auth/password-reset', async route => { posts.push(route.request().postDataJSON()); await route.fulfill({ status: 202, json: { accepted: true } }); });
    await context.route('**/api/auth/password-reset/inspect', route => route.fulfill({ json: { valid: true } }));
    await context.route('**/api/auth/password-reset/complete', route => route.fulfill({ json: { ok: true } }));
    await context.route('**/api/auth/registration/inspect', route => route.fulfill({ json: { valid: true } }));
    await context.route('**/api/auth/registration/complete', route => route.fulfill({ json: { authenticated: true } }));
    await context.route('**/api/auth/email/inspect', route => route.fulfill({ json: { valid: true } }));
    await context.route('**/api/auth/email/confirm', route => route.fulfill({ json: { ok: true } }));
    try {
      const returnTo = '/hausdepp/konto/einstellungen';
      await page.goto(`${HOUSE}/hausdepp/anmelden?return_to=${encodeURIComponent(returnTo)}`);
      await page.locator('#zilchPasswordLogin > summary').click();
      await page.locator('#zilchForgotPassword').click();
      await expect(page).toHaveURL(`${HOUSE}/passwort-vergessen?app=hausdepp&lang=${language}&return_to=${encodeURIComponent(returnTo)}`);
      await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
      await page.locator('input[name=email]').fill('house@example.test');
      await page.locator('[data-forgot-form] button').click();
      await expect(page.locator('[data-message]')).toContainText(language === 'de' ? 'Falls die Adresse' : 'If the address');
      expect(posts).toEqual([{ email: 'house@example.test', preferred_language: language, account_app: 'hausdepp', return_to: returnTo }]);
      for (const path of ['/registrierung/bestaetigen', '/passwort-zuruecksetzen', '/email-bestaetigen']) {
        await page.goto(`${HOUSE}${path}?app=hausdepp&lang=${language}&return_to=${encodeURIComponent(returnTo)}#token=only-local-test-token-123456`);
        await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page).not.toHaveURL(/token=/);
        await expect(page.locator('a[href*=token]')).toHaveCount(0);
        if (path !== '/email-bestaetigen') {
          await page.locator('input[name=password]').fill('new-local-password-123');
          await page.locator('input[name=confirmation]').fill('new-local-password-123');
        }
        await page.locator('[data-email-action] button[type=submit], [data-email-action] > button').click();
        const success = page.locator('[data-email-action] a.primary');
        await expect(success).toHaveCount(1);
        await expect(success).toHaveAttribute('href', path === '/passwort-zuruecksetzen' ? `/hausdepp/anmelden?lang=${language}&app=hausdepp&return_to=${encodeURIComponent(returnTo)}` : returnTo);
      }
      await page.goto(`${HOUSE}/passwort-zuruecksetzen?app=hausdepp&lang=${language}&return_to=${encodeURIComponent('//evil.example')}`);
      await expect(page.getByRole('alert')).toBeVisible();
      await expect(page.locator('[data-email-action] a').last()).toHaveAttribute('href', `/hausdepp/anmelden?lang=${language}&app=hausdepp`);
      expect(relay.unexpected).toEqual([]);
    } finally { await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await relay.dispose(); }
  });
}
