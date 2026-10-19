const { test, expect } = require('@playwright/test');
const path = require('node:path');

// These tests deliberately hold/replace auth responses. Browser routing does
// not intercept requests forwarded by a worker; the separate PWA spec covers
// the actual network-only worker, offline state and installed identity.
test.use({ serviceWorkers: 'block' });

async function openSection(page, selector) {
  const row = page.locator('details').filter({ has: page.locator(selector) });
  if (!await row.evaluate(node => node.open)) await row.locator('summary').click();
}

for (const language of ['de', 'en']) {
  test(`Watten ${language}: local native passkey account, shared settings, backup and logout race`, async ({ page, context, baseURL }, testInfo) => {
    // Distinct simulated visitors keep real signup rate limits enabled.
    await context.setExtraHTTPHeaders({ 'X-Forwarded-For': language === 'de' ? '192.0.2.201' : '192.0.2.202' });
    await context.addInitScript(language => {
      if (!localStorage.getItem('zdwa_language')) localStorage.setItem('zdwa_language', language);
    }, language);
    const foreign = [];
    const sockets = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) { foreign.push(url.href); return route.abort(); }
      return route.continue();
    });
    page.on('websocket', socket => sockets.push(socket.url()));
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    try {
      await page.goto('/watten');
      await expect(page.locator('h1')).toHaveText('Watten');
      await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', 'watten');
      await page.goto('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
      await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Bei Watten anmelden' : 'Sign in to Watten');
      await page.locator('#wattenRegistrationUsername').fill(`WattenNative_${language}`);
      await page.locator('#wattenRegistrationMethod').selectOption('passkey');
      const signed = page.waitForResponse(response => response.url().endsWith('/api/auth/passkeys/signup/verify'));
      await page.locator('[data-registration-form] button[type=submit]').click();
      expect((await signed).status()).toBe(201);
      await expect(page).toHaveURL(`${baseURL}/watten/konto/einstellungen`);
      await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Kontoeinstellungen' : 'Account settings');
      await expect(page.locator('[data-passkey-list] li')).toHaveCount(1);
      // Friend settings can still refresh the old document's identity while
      // reload starts. Keep auth unavailable until the new page shows its
      // error, rather than consuming a one-shot failure on that old request.
      const authUnavailable = route => route.fulfill({ status: 503, body: '{}' });
      await page.route('**/api/auth/me', authUnavailable);
      try {
        await page.reload();
        await expect(page.locator('[role=alert]')).toBeVisible();
      } finally {
        await page.unroute('**/api/auth/me', authUnavailable);
      }
      await page.locator('main > button').click();
      await expect(page.locator('[data-passkey-list] li')).toHaveCount(1);
      const initial = await (await page.request.get('/api/auth/me')).json();
      expect(initial.user.has_password).toBe(false);
      expect((await client.send('WebAuthn.getCredentials', { authenticatorId })).credentials[0].rpId).toBe('rollthedice.localhost');
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      await openSection(page, '[data-username-form]');
      await page.locator('[data-username-form] input[name=username]').fill(`WattenRenamed_${language}`);
      await page.locator('[data-username-form] button[type=submit]').click();
      await expect(page.locator('[data-account-name]')).toHaveText(`WattenRenamed_${language}`);
      expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(initial.user.id);
      await openSection(page, '[data-avatar-upload]');
      await page.locator('[data-avatar-upload] input[type=file]').setInputFiles(path.join(__dirname, '../../app/static/icons/icon-192.png'));
      const uploaded = page.waitForResponse(response => response.url().endsWith('/api/account/avatar') && response.request().method() === 'PUT');
      await page.locator('[data-avatar-upload] button').first().click();
      expect((await uploaded).status()).toBe(200);
      await openSection(page, '[data-language]');
      await page.locator('[data-language] select').selectOption(language);
      const reloaded = page.waitForEvent('load');
      await page.locator('[data-language] button').click();
      await reloaded;
      await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Kontoeinstellungen' : 'Account settings');
      await openSection(page, '[data-password]');
      await page.locator('[data-password] input[name=password]').fill('watten-backup-password-123');
      await page.locator('[data-password] input[name=confirmation]').fill('watten-backup-password-123');
      await page.locator('[data-password] button[type=submit]').click();
      await expect(page).toHaveURL(`${baseURL}/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen`);
      await page.locator('[data-login] input[name=username]').fill(`WattenRenamed_${language}`);
      await page.locator('[data-login] input[name=password]').fill('watten-backup-password-123');
      await page.locator('[data-login] button[type=submit]').click();
      await expect(page).toHaveURL(`${baseURL}/watten/konto/einstellungen`);
      expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(initial.user.id);
      await page.route('**/api/auth/logout', async route => {
        const response = await route.fetch();
        // A second bundle sees the invalidated session before logout returns.
        // Its 401 clears the shared in-memory identity cache.
        expect(await page.evaluate(async () => {
          const auth = await import('/static/auth.js');
          return (await auth.apiFetch('/api/auth/email')).status;
        })).toBe(401);
        await route.fulfill({ response });
      });
      const navigations = [];
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations.push(frame.url()); });
      await page.locator('[data-logout]').click();
      await expect(page).toHaveURL(`${baseURL}/watten`);
      expect(navigations).toEqual([`${baseURL}/watten`]);
      await page.goto('/watten/anmelden?return_to=%2Fwatten%2Fkonto%2Feinstellungen');
      await page.locator('[data-passkey-login]').click();
      await expect(page).toHaveURL(`${baseURL}/watten/konto/einstellungen`);
      expect((await (await page.request.get('/api/auth/me')).json()).user.id).toBe(initial.user.id);
      expect(sockets).toEqual([]);
      expect(foreign).toEqual([]);
      expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.map(item => new URL(item.scope).pathname)))).toEqual([]);
      for (const viewport of [{ width: 320, height: 844 }, { width: 568, height: 320 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: testInfo.outputPath(`watten-settings-${viewport.width}x${viewport.height}.png`), fullPage: true });
      }
      // An external account change is first observed by an already pending
      // identity refresh. Keep navigation cancellable to exercise the old
      // document's outstanding mutation deterministically.
      const previous = (await (await page.request.get('/api/auth/me')).json()).user;
      expect((await page.request.post('/api/auth/logout', { headers: { 'X-CSRF-Token': previous.csrf_token } })).status()).toBe(200);
      // A late 401 removes the cached A identity without notifying the page.
      expect(await page.evaluate(async () => (await (await import('/static/auth.js')).apiFetch('/api/auth/email')).status)).toBe(401);
      const other = await page.request.post('/api/auth/register', { headers: {
        Origin: baseURL, 'X-Forwarded-For': language === 'de' ? '192.0.2.211' : '192.0.2.212',
      }, data: { username: `WattenOther_${language}`, password: 'other-account-password-123' } });
      expect(other.status()).toBe(201);
      const otherUser = (await other.json()).user;
      await page.evaluate(() => navigation.addEventListener('navigate', event => event.preventDefault()));
      let release;
      const held = new Promise(resolve => { release = resolve; });
      let identitySeen;
      const observed = new Promise(resolve => { identitySeen = resolve; });
      await page.route('**/api/auth/me', async route => {
        const response = await route.fetch();
        identitySeen();
        await held;
        await route.fulfill({ response });
      }, { times: 1 });
      await page.evaluate(() => { void import('/static/auth.js').then(auth => auth.loadAuth({ refresh: true })); });
      await observed;
      await openSection(page, '[data-language]');
      await page.locator('[data-language] select').selectOption('en');
      const wrongMutations = [];
      page.on('request', request => { if (request.url().endsWith('/api/auth/preferences/language')) wrongMutations.push(request.url()); });
      await page.locator('[data-language] button').click();
      release();
      await expect(page.locator('#wattenAccount')).toBeEmpty();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const afterSwitch = await (await page.request.get('/api/auth/me')).json();
      expect(afterSwitch.user.id).toBe(otherUser.id);
      expect(afterSwitch.user.preferences.preferred_language).toBe('de');
      expect(wrongMutations).toEqual([]);
    } finally {
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await client.detach().catch(() => {});
    }
  });

  test(`Watten ${language}: invalid local recovery token has a bounded native return`, async ({ page, baseURL }) => {
    await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
    await page.goto('/passwort-zuruecksetzen?app=watten&return_to=%2F%2Fevil.invalid%2F#token=invalid-local-token-1234567890');
    await expect(page.locator('[role=alert]')).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/passwort-zuruecksetzen?app=watten&return_to=%2F%2Fevil.invalid%2F`);
    const login = page.getByRole('link', { name: language === 'de' ? 'Zur Anmeldung' : 'Go to sign in' });
    await expect(login).toHaveAttribute('href', /\/watten\/anmelden\?lang=(?:de|en)&app=watten&return_to=%2Fwatten%2Fkonto%2Feinstellungen$/);
    await login.click();
    await expect(page.locator('h1')).toHaveText(language === 'de' ? 'Bei Watten anmelden' : 'Sign in to Watten');
    expect(new URL(page.url()).origin).toBe(new URL(baseURL).origin);
  });
}

test('Watten local account entry stays useful without JavaScript or identity requests', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const identityRequests = [];
  const page = await context.newPage();
  page.on('request', request => { if (request.url().includes('/api/auth/')) identityRequests.push(request.url()); });
  try {
    await page.goto(`${baseURL}/watten`);
    await expect(page.locator('h1')).toHaveText('Watten');
    await expect(page.getByRole('link', { name: 'Anmelden / Sign in' })).toHaveAttribute('href', '/watten/anmelden');
    await expect(page.getByText('Watten is not available yet. You can manage your account here.')).toBeVisible();
    expect(identityRequests).toEqual([]);
    await page.goto(`${baseURL}/watten/anmelden`);
    await expect(page.getByText('Für Anmeldung und Kontoeinstellungen brauchst du JavaScript.')).toBeVisible();
    await expect(page.getByText('You need JavaScript to sign in and manage your account settings.')).toBeVisible();
  } finally { await context.close(); }
});

test('Watten settings clear before BFCache and reload without reusing an old identity response', async ({ page, baseURL }) => {
  const created = await page.request.post('/api/auth/register', { headers: { Origin: baseURL, 'X-Forwarded-For': '192.0.2.221' },
    data: { username: 'WattenCacheA', password: 'cache-account-password-123' } });
  expect(created.status()).toBe(201);
  await page.goto('/watten/konto/einstellungen');
  await expect(page.locator('[data-account-name]')).toHaveText('WattenCacheA');
  let releaseOld;
  let releaseNew;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  const newGate = new Promise(resolve => { releaseNew = resolve; });
  let oldSeen;
  let newSeen;
  let oldFulfilled;
  const oldObserved = new Promise(resolve => { oldSeen = resolve; });
  const newObserved = new Promise(resolve => { newSeen = resolve; });
  const oldResponseFulfilled = new Promise(resolve => { oldFulfilled = resolve; });
  let requests = 0;
  try {
    await page.route('**/api/auth/me', async route => {
      const requestNumber = ++requests;
      const response = await route.fetch();
      // Keep plain response data while the test holds it across account changes.
      // A navigation may otherwise dispose the fetched APIResponse first.
      const payload = { status: response.status(), headers: response.headers(), body: await response.body() };
      if (requestNumber === 1) { oldSeen(); await oldGate; }
      if (requestNumber === 2) { newSeen(); await newGate; }
      await route.fulfill(payload);
      if (requestNumber === 1) oldFulfilled();
    });
    await page.evaluate(() => {
      window.__wattenOldIdentityRequest = import('/static/auth.js').then(auth => auth.loadAuth({ refresh: true }));
    });
    await oldObserved;
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect(page.locator('#wattenAccount')).toBeEmpty();
    const other = await page.request.post('/api/auth/register', { headers: { Origin: baseURL, 'X-Forwarded-For': '192.0.2.222' },
      data: { username: 'WattenCacheB', password: 'cache-other-password-123' } });
    expect(other.status()).toBe(201);
    releaseOld();
    await oldResponseFulfilled;
    await page.evaluate(() => window.__wattenOldIdentityRequest);
    // Consuming the delayed A response must not repopulate the hidden document.
    await expect(page.locator('#wattenAccount')).toBeEmpty();
    await expect(page.locator('[data-account-name]')).toHaveCount(0);
    const loaded = page.waitForEvent('load');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await loaded;
    await newObserved;
    await expect(page.locator('[data-account-name]')).toHaveCount(0);
    await expect(page.locator('#wattenAccount')).not.toContainText('WattenCacheA');
    releaseNew();
    await expect(page.locator('[data-account-name]')).toHaveText('WattenCacheB');
  } finally {
    releaseOld();
    releaseNew();
    // Settings may start another identity refresh after rendering B. Finish
    // its route handler before Playwright disposes the request context.
    await page.unrouteAll({ behavior: 'wait' });
  }
});
