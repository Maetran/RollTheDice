const { test, expect } = require('@playwright/test');
const { startHausdeppCpuGame } = require('./hausdepp-create');
const { readFile } = require('node:fs/promises');
const { openPasswordLogin } = require('./password-login');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Public-release checks must use an isolated server').not.toBe('8000');
});

async function language(page, value) {
  await page.addInitScript(preferred => localStorage.setItem('zdwa_language', preferred), value);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
}

async function regularAccount(page, preferred = 'de') {
  const ownerLogin = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(ownerLogin.ok()).toBeTruthy();
  const owner = (await ownerLogin.json()).user;
  const username = `HousePublic${Date.now()}`;
  const initial = 'house-public-temporary-123';
  const password = 'house-public-final-123';
  const created = await page.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': owner.csrf_token },
    data: { username, temporary_password: initial, role: 'user' },
  });
  expect(created.status()).toBe(201);
  const signedIn = await page.request.post('/api/auth/login', { data: { username, password: initial } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  expect(user.is_owner).toBeFalsy();
  expect(user.is_admin).toBeFalsy();
  let headers = { 'X-CSRF-Token': user.csrf_token };
  expect((await page.request.post('/api/auth/change-password', {
    headers, data: { current_password: initial, new_password: password },
  })).ok()).toBeTruthy();
  const finalLogin = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(finalLogin.ok()).toBeTruthy();
  headers = { 'X-CSRF-Token': (await finalLogin.json()).user.csrf_token };
  expect((await page.request.put('/api/auth/preferences/language', {
    headers, data: { preferred_language: preferred },
  })).ok()).toBeTruthy();
  return { username, password, user, headers };
}

for (const preferred of ['de', 'en']) {
  test(`${preferred}: anonymous lobby and rules remain useful, responsive and free of private requests`, async ({ page }) => {
    await language(page, preferred);
    const privateReads = [];
    const sockets = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (/^\/api\/hausdepp\//.test(url.pathname) || url.pathname === '/api/games') privateReads.push(url.pathname);
    });
    page.on('websocket', socket => sockets.push(socket.url()));
    for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const response = await page.goto('/hausdepp');
      expect(response.status()).toBe(200);
      await expect(page).toHaveURL(/\/hausdepp$/);
      await expect(page.locator('html')).toHaveAttribute('lang', preferred);
      await expect(page.locator('#hausdeppSignIn')).toHaveText(preferred === 'de' ? /Anmelden/ : /Sign in/);
      await expect(page.locator('#hausdeppRegister')).toHaveText(preferred === 'de' ? 'Konto erstellen' : 'Create account');
      await expect(page.locator('#hausdeppCreateForm, #hausdeppRounds, #hausdeppLobbyChat')).toHaveCount(0);
      await expect(page.locator('.hd-lobby-cards .hausdepp-card').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('.hd-profile-button')).toBeHidden();
      for (const selector of ['#hausdeppSignIn', '#hausdeppRegister', '#hausdeppHeader .hd-nav a[href="/hausdepp/konto/einstellungen"]']) {
        const control = page.locator(selector);
        await expect(control).toBeVisible();
        const rect = await control.boundingBox();
        expect(rect).not.toBeNull();
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width + 1);
      }
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hausdepp.zockdiewandan.online/hausdepp');
    }
    await page.locator('.hd-welcome .hd-rules-link').click();
    await expect(page).toHaveURL(/\/hausdepp\/regeln$/);
    await expect(page.locator('.hd-rulebook')).toBeVisible();
    await expect(page.locator('#punkte-erfolge')).toContainText('136');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://hausdepp.zockdiewandan.online/hausdepp/regeln');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    expect(privateReads).toEqual([]);
    expect(sockets.filter(url => new URL(url).pathname !== '/ws/presence')).toEqual([]);
  });

  test(`${preferred}: ordinary account signs in from Hausdepp, plays and reaches all three game switchers`, async ({ page }) => {
    await language(page, preferred);
    const account = await regularAccount(page, preferred);
    expect((await page.request.post('/api/auth/logout', { headers: account.headers })).ok()).toBeTruthy();
    await page.goto('/hausdepp');
    await page.locator('#hausdeppRegister').click();
    await expect(page.locator('#zilchRegistrationForm')).toBeVisible();
    await expect(page.locator('#zilchLoginTitle')).toHaveText(preferred === 'de' ? 'Bei Hausdepp anmelden' : 'Sign in to Hausdepp');
    await expect(page.locator('.zilch-login-intro')).toContainText(preferred === 'de' ? 'Ein Konto für alle unsere Spiele' : 'One account for all our games');
    expect(new URL(page.url()).searchParams.get('return_to')).toBe('/hausdepp');
    await openPasswordLogin(page, true);
    await page.locator('#zilchLoginUsername').fill(account.username);
    await page.locator('#zilchLoginPassword').fill(account.password);
    await page.locator('#zilchLoginForm button[type="submit"]').click();
    await expect(page).toHaveURL(/\/hausdepp$/);
    await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.authenticated).toBe(true);
    expect(me.user.is_owner).toBeFalsy();
    expect(me.game_access.hausdepp_public).toBe(true);
    await startHausdeppCpuGame(page);
    await expect(page).toHaveURL(/\/hausdepp\/spiel\/[^/]+$/);
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
    for (let inspected = 0; inspected < 5; inspected += 1) {
      // The first dealer is random: a computer may cut instead of this account.
      await expect.poll(async () => await page.locator('#hausdeppTable').getAttribute('data-phase') !== 'peeking'
        || await page.locator('#hausdeppStock').isEnabled(), { timeout: 15000 }).toBe(true);
      const phase = await page.locator('#hausdeppTable').getAttribute('data-phase');
      if (phase !== 'peeking') break;
      await page.locator('#hausdeppStock').click();
      await expect.poll(() => page.locator('#hausdeppStock').isEnabled()
        .then(enabled => enabled || page.locator('#hausdeppTable').getAttribute('data-phase').then(value => value !== 'peeking'))).toBeTruthy();
    }
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    await expect(page.locator('#hausdeppHand [data-card-id]').first()).toBeVisible();
    // Model the public three-game chooser explicitly: the isolated server's
    // local Watten capability is outside this fixture. House login and gameplay
    // above used real, unmodified permissions and server state.
    const publicChooserAccess = { ...me.game_access, zilch_public: true, watten_preview: false };
    await page.route('**/api/auth/me', route => route.fulfill({
      json: { ...me, game_access: publicChooserAccess, user: { ...me.user, game_access: publicChooserAccess } },
    }));
    const zilchTemplate = await readFile('app/static/zilch-lobby.html', 'utf8');
    await page.route('**/zilch', route => route.fulfill({ contentType: 'text/html', body: zilchTemplate }));
    for (const destination of ['/', '/zilch', '/hausdepp']) {
      await page.goto(destination);
      await expect(page.locator('[data-game-switch]')).toBeVisible();
      await page.locator('[data-game-switch]').click();
      await expect(page.locator('#suiteGameMenu [data-game-entry="hausdepp"]')).toHaveAttribute('href', '/hausdepp');
      await expect(page.locator('#suiteGameMenu [data-game-entry]')).toHaveCount(3);
      await expect(page.locator('#suiteGameMenu [data-game-entry="watten"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await page.goto('/hausdepp/konto');
    await expect(page.locator('.hd-account-identity')).toContainText(account.username);
    await expect(page.locator('#hausdeppAchievementCount')).toContainText('136');
    await page.locator('.hd-account-settings a').click();
    await expect(page.locator('.hd-settings')).toBeVisible();
    await expect(page).toHaveURL(/\/hausdepp\/konto\/einstellungen$/);
    await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
    await page.locator('.hd-settings-footer a[href="/hausdepp"]').click();
    await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
    await page.locator('.hd-nav a[href="/hausdepp/rangliste"]').click();
    await expect(page.locator('#hausdeppLeaderboardSize')).toBeVisible();
  });

  test(`${preferred}: public discovery survives an unavailable identity service`, async ({ page }) => {
    await language(page, preferred);
    await page.route('**/api/auth/me', route => route.fulfill({ status: 503, json: { detail: 'labelled_auth_failure' } }));
    await page.goto('/hausdepp');
    await expect(page.locator('#hausdeppSignIn')).toBeVisible();
    await expect(page.locator('.hd-create [role="status"]')).toContainText(preferred === 'de' ? 'Anmeldestatus' : 'sign-in status');
    await page.locator('.hd-welcome .hd-rules-link').click();
    await expect(page.locator('.hd-rulebook')).toBeVisible();
  });
}

test('signing out in another tab removes the preceding account’s mounted data', async ({ page }) => {
  const account = await regularAccount(page);
  await page.goto('/hausdepp');
  await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
  const other = await page.context().newPage();
  try {
    await other.goto('/hausdepp/regeln');
    await other.bringToFront();
    expect((await other.request.post('/api/auth/logout', { headers: account.headers })).ok()).toBeTruthy();
    await page.bringToFront();
    // Headless tab activation need not emit window focus. Return the timer
    // handle before dispatching it: the real auth handler intentionally reloads.
    await page.evaluate(() => setTimeout(() => window.dispatchEvent(new Event('focus')), 0));
    await expect(page.locator('#hausdeppSignIn')).toBeVisible();
    await expect(page.locator('#hausdeppCreateForm, #hausdeppRounds, #hausdeppLobbyChat')).toHaveCount(0);
    await expect(page.locator('#hausdeppHeader')).not.toContainText(account.username);
  } finally { await other.close(); }
});

test('the shared login completes an allowlisted Hausdepp host continuation without contacting production', async ({ page, baseURL }) => {
  const account = await regularAccount(page);
  expect((await page.request.post('/api/auth/logout', { headers: account.headers })).ok()).toBeTruthy();
  const target = 'https://hausdepp.zockdiewandan.online/hausdepp/rangliste';
  // Inspect the real isolated redirect without following it to production.
  // Routing the continuation itself also avoids relying on browser interception
  // of a URL reached through an HTTP redirect chain.
  let productionRequested = false;
  let redirectTarget;
  await page.route('https://hausdepp.zockdiewandan.online/**', route => {
    productionRequested = true;
    return route.abort();
  });
  await page.route('**/auth/continue?app=hausdepp&**', async route => {
    const response = await route.fetch({ maxRedirects: 0 });
    expect(response.status()).toBe(303);
    redirectTarget = response.headers().location;
    await route.fulfill({ contentType: 'text/html', body: '<main>Labelled Hausdepp handoff inspected</main>' });
  });
  const continuation = '/auth/continue?app=hausdepp&path=%2Fhausdepp%2Frangliste';
  await page.goto(`/zilch/anmelden?return_to=${encodeURIComponent(continuation)}`);
  expect(new URL(page.url()).origin).toBe(baseURL);
  await openPasswordLogin(page, true);
  await page.locator('#zilchLoginUsername').fill(account.username);
  await page.locator('#zilchLoginPassword').fill(account.password);
  await page.locator('#zilchLoginForm button[type="submit"]').click();
  await expect(page.locator('main')).toHaveText('Labelled Hausdepp handoff inspected');
  expect(redirectTarget).toBe(target);
  expect(productionRequested).toBe(false);
});

test('anonymous no-JavaScript pages retain bilingual gameplay descriptions and real links', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    for (const path of ['/hausdepp', '/hausdepp/regeln']) {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
      await expect(page.locator('main [lang="de"]')).toContainText('Hausdepp');
      await expect(page.locator('main [lang="en"]')).toContainText('Hausdepp');
      await expect(page.locator('main')).toContainText('136');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    }
  } finally { await context.close(); }
});
