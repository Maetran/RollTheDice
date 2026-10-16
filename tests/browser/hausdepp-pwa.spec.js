const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'PWA tests must use an isolated server').not.toBe('8000');
});

async function owner(page, language = 'de') {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  await page.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: language },
  });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  return user;
}

async function waitForHausdeppWorker(page) {
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toMatch(/\/hausdepp-sw\.js$/);
  const registrations = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration => ({
    scope: new URL(registration.scope).pathname,
    worker: new URL(registration.active.scriptURL).pathname,
  })));
  expect(registrations).toEqual([{ scope: '/hausdepp', worker: '/hausdepp-sw.js' }]);
}

test('real Hausdepp worker stays narrow and never caches private content or cards', async ({ page, context }) => {
  await owner(page);
  await page.goto('/hausdepp');
  await waitForHausdeppWorker(page);
  for (const path of ['/hausdepp/konto', '/hausdepp/regeln', '/hausdepp/rangliste']) {
    await page.goto(path);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('data-pwa-product', 'hausdepp');
  }
  const fetched = await page.evaluate(async () => Promise.all([
    '/api/hausdepp/account', '/api/hausdepp/results', '/api/hausdepp/leaderboard', '/static/hausdepp/cards-source.jpg',
  ].map(async path => ({ path, ok: (await fetch(path)).ok }))));
  expect(fetched.every(response => response.ok)).toBe(true);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);

  await context.setOffline(true);
  const response = await page.goto('/hausdepp/spiel/offline-private-table');
  expect(response.status()).toBe(503);
  await expect(page.locator('h1')).toHaveText('Hausdepp');
  await expect(page.locator('main')).toContainText('Für Hausdepp brauchst du eine Internetverbindung');
  await expect(page.locator('main')).toContainText('Hausdepp needs an internet connection');
  await expect(page.locator('main')).not.toContainText('Admin');
  await expect(page.locator('svg, img, input, [data-card-id]')).toHaveCount(0);
  await expect(page.locator('a')).toHaveAttribute('href', '/hausdepp');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  expect(await page.evaluate(() => fetch('/api/hausdepp/account').then(() => true).catch(() => false))).toBe(false);

  await context.setOffline(false);
  await page.locator('a').click();
  await expect(page).toHaveURL(/\/hausdepp$/);
  await expect(page.locator('#hausdeppApp')).not.toContainText('Hausdepp needs an internet connection');
});

for (const language of ['de', 'en']) {
  test(`${language}: the real Hausdepp worker requests a visible system invitation with its table link`, async ({ page, context, baseURL }) => {
    await owner(page, language);
    await page.goto('/hausdepp');
    await waitForHausdeppWorker(page);
    const worker = context.serviceWorkers().find(candidate => new URL(candidate.url()).pathname === '/hausdepp-sw.js');
    expect(worker).toBeTruthy();
    const title = language === 'en' ? 'Hausdepp is looking for players' : 'Hausdepp sucht Mitspieler';
    const body = language === 'en' ? 'Resi is waiting for you. Join in!' : 'Resi wartet auf dich. Sei dabei!';
    const tag = `hausdepp-invitation-browser-${language}`;
    // The installed worker handles a PushEvent. Headless Chromium denies native
    // notification permission here, so capture the showNotification boundary;
    // this does not claim delivery on an actual OS or contact a push recipient.
    const notifications = await worker.evaluate(async payload => {
      const notifications = [];
      const showNotification = self.registration.showNotification;
      self.registration.showNotification = async (title, options) => notifications.push({ title, ...options });
      try {
        const event = new PushEvent('push', { data: JSON.stringify(payload) });
        let completion;
        Object.defineProperty(event, 'waitUntil', { value: promise => { completion = promise; } });
        self.dispatchEvent(event);
        await completion;
        return notifications;
      } finally {
        self.registration.showNotification = showNotification;
      }
    }, { title, body, tag, url: '/hausdepp/spiel/invitation-browser-proof' });
    expect(notifications).toEqual([{
      title, body, tag,
      icon: '/static/icons/hausdepp-icon-192-v2.png',
      badge: '/static/icons/hausdepp-icon-192-v2.png',
      renotify: false, data: { url: `${baseURL}/hausdepp/spiel/invitation-browser-proof` },
    }]);
  });

  test(`${language}: Hausdepp installs with its own icon and shows the shared update toast`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await owner(page, language);
    await page.goto('/hausdepp');
    await waitForHausdeppWorker(page);
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#173e34');
    const manifestLink = page.locator('link[rel="manifest"]');
    await expect(manifestLink).toHaveAttribute('crossorigin', 'use-credentials');
    await expect(manifestLink).toHaveAttribute('href', new RegExp(`/hausdepp-manifest${language === 'en' ? '-en' : ''}\\.webmanifest`));
    const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel="manifest"]').href)).json());
    expect(manifest.short_name).toBe('Hausdepp');
    expect(manifest.lang).toBe(language);
    expect(manifest.start_url).toBe('/hausdepp?pwa=hausdepp');
    for (const icon of manifest.icons) expect((await page.request.get(icon.src)).ok()).toBe(true);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /hausdepp-apple-touch-icon-180-v2\.png/);

    await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: async () => { window.__hausdeppInstallPrompted = true; } });
      window.dispatchEvent(event);
    });
    const install = page.locator('.app-toast-action', { hasText: language === 'en' ? 'Install' : 'Installieren' });
    await expect(install).toBeVisible();
    await install.click();
    expect(await page.evaluate(() => window.__hausdeppInstallPrompted)).toBe(true);

    await page.evaluate(() => window.HAUSDEPP_PWA.showUpdate({
      waiting: { postMessage: message => { window.__hausdeppUpdateMessage = message; } },
    }));
    const update = page.locator('.app-toast', { hasText: language === 'en' ? 'A new version is available.' : 'Eine neue Version ist verfügbar.' });
    await expect(update).toBeVisible();
    const geometry = await update.evaluate(node => {
      const region = node.parentElement;
      const rect = node.getBoundingClientRect();
      return { fixed: getComputedStyle(region).position, top: rect.top, right: rect.right,
        actionHeight: node.querySelector('.app-toast-action').getBoundingClientRect().height };
    });
    expect(geometry.fixed).toBe('fixed');
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.top).toBeLessThan(100);
    expect(geometry.right).toBeLessThanOrEqual(390);
    expect(geometry.actionHeight).toBeGreaterThanOrEqual(44);
    await update.getByRole('button', { name: language === 'en' ? 'Update now' : 'Jetzt aktualisieren' }).click();
    expect(await page.evaluate(() => window.__hausdeppUpdateMessage)).toEqual({ type: 'SKIP_WAITING' });
    const navigation = page.waitForEvent('load');
    await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
    await navigation;
    await expect(page).toHaveURL(/\/hausdepp$/);
  });
}
