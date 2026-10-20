const { test, expect } = require('@playwright/test');

const ENTRY_KEY = 'rollthedice:pwa-entry:v1';

async function waitForWattenWorker(page) {
  await page.evaluate(() => window.WATTEN_PWA.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toContain('/watten-sw.js');
}

for (const language of ['de', 'en']) {
  test(`Watten ${language}: actual local manifest, icon decoding and bounded install action`, async ({ page }) => {
    await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
    await page.goto('/watten');
    await waitForWattenWorker(page);
    const manifest = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]');
      return { href: link.href, data: await (await fetch(link.href)).json() };
    });
    expect(new URL(manifest.href).pathname).toBe(`/watten-manifest${language === 'en' ? '-en' : ''}.webmanifest`);
    expect(manifest.data).toMatchObject({ id: '/watten', start_url: '/watten?pwa=watten', scope: '/', lang: language });
    expect(await page.evaluate(async () => {
      const icon = new Image();
      icon.src = document.querySelector('link[rel=apple-touch-icon]').href;
      await icon.decode();
      return [icon.naturalWidth, icon.naturalHeight];
    })).toEqual([180, 180]);
    const install = page.getByRole('button', { name: language === 'de' ? 'Watten installieren' : 'Install Watten' });
    await expect(install).toBeHidden();
    await page.evaluate(() => {
      window.__installCalls = 0;
      const event = new Event('beforeinstallprompt', { cancelable: true });
      Object.defineProperty(event, 'prompt', { value: async () => { window.__installCalls += 1; } });
      window.dispatchEvent(event);
    });
    await expect(install).toBeVisible();
    await install.click();
    expect(await page.evaluate(() => window.__installCalls)).toBe(1);
    await expect(install).toBeHidden();
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.map(item => new URL(item.scope).pathname)))).toEqual(['/watten']);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  });
}

test('Watten actual worker replaces a private account only with neutral offline copy and reconnects', async ({ page, context, baseURL }) => {
  await page.goto('/watten');
  await waitForWattenWorker(page);
  const registration = await page.request.post('/api/auth/register', {
    headers: { Origin: baseURL, 'X-Forwarded-For': '192.0.2.231' },
    data: { username: 'WattenPwaOffline', password: 'watten-offline-account-123' },
  });
  expect(registration.status()).toBe(201);
  await page.goto('/watten/konto/einstellungen');
  await expect(page.locator('[data-account-name]')).toHaveText('WattenPwaOffline');
  await context.setOffline(true);
  const response = await page.reload();
  expect(response.status()).toBe(503);
  expect(response.headers()['cache-control']).toBe('no-store');
  await expect(page.getByText('Watten needs an internet connection.', { exact: false })).toBeVisible();
  await expect(page.getByText('Kontodaten werden nicht offline gespeichert.', { exact: false })).toBeVisible();
  expect(await page.locator('input, [data-account-name]').count()).toBe(0);
  expect(await page.content()).not.toContain('WattenPwaOffline');
  expect(await page.evaluate(async () => fetch('/api/auth/me').then(() => true, () => false))).toBe(false);
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Erneut verbinden / Reconnect' }).click();
  await expect(page.locator('h1')).toHaveText('Watten');
});

test('Watten activates a waiting narrow worker only after the explicit update action', async ({ page }) => {
  await page.goto('/watten');
  await waitForWattenWorker(page);
  await page.evaluate(() => navigator.serviceWorker.register('/watten-sw.js?preview-update-check=1', { scope: '/watten', updateViaCache: 'none' }));
  const update = page.getByRole('button', { name: 'Watten aktualisieren' });
  await expect(update).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).not.toContain('preview-update-check');
  const reloaded = page.waitForEvent('load');
  await update.click();
  await reloaded;
  await expect(page.locator('h1')).toHaveText('Watten');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toContain('preview-update-check=1');
  expect(await page.evaluate(() => caches.keys())).toEqual([]);
});

for (const owner of ['zdwa', 'hausdepp', 'zilch', 'watten']) {
  test(`Watten keeps the installed ${owner} identity through native account and recovery pages`, async ({ page, baseURL }) => {
    const localOrigin = owner === 'zilch' ? baseURL.replace('://rollthedice.', '://zilch.rollthedice.') : baseURL;
    await page.addInitScript(({ key, owner }) => {
      Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true });
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, owner);
    }, { key: ENTRY_KEY, owner });
    await page.goto(`${localOrigin}/watten${owner === 'watten' ? '?pwa=watten' : ''}`);
    await waitForWattenWorker(page);
    const prefix = owner === 'zdwa' ? '' : `${owner}-`;
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', owner);
    expect(await page.evaluate(key => sessionStorage.getItem(key), ENTRY_KEY)).toBe(owner);
    expect((await page.request.get(`${localOrigin}/${prefix}manifest.webmanifest`)).status()).toBe(200);
    // Recovery is outside the narrow worker but inside the manifest's scope.
    await page.goto(`${localOrigin}/passwort-vergessen?app=watten`);
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', owner);
    expect(await page.evaluate(key => sessionStorage.getItem(key), ENTRY_KEY)).toBe(owner);
    expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then(items => items.map(item => new URL(item.scope).pathname)))).toEqual(['/watten']);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  });
}

for (const owner of ['zdwa', 'hausdepp', 'zilch']) {
  test(`installed ${owner} retains identity after the narrow worker claims and storage becomes unavailable`, async ({ page, context, baseURL }) => {
    const localOrigin = owner === 'zilch' ? baseURL.replace('://rollthedice.', '://zilch.rollthedice.') : baseURL;
    await context.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }));
    await page.goto(localOrigin);
    // Model the established installed owner, then enter the actual account
    // document. Its new narrow worker claims the next full navigation.
    await page.evaluate(({ key, owner }) => sessionStorage.setItem(key, owner), { key: ENTRY_KEY, owner });
    await page.goto(`${localOrigin}/watten`);
    await waitForWattenWorker(page);
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', owner);
    await context.addInitScript(() => Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new DOMException('Storage unavailable', 'SecurityError'); } }));
    for (const pathname of ['/watten/anmelden', '/watten', '/passwort-vergessen?app=watten']) {
      await page.goto(localOrigin + pathname);
      await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', owner);
      expect(await page.evaluate(() => window.name)).toBe(`${ENTRY_KEY}:${owner}`);
    }
    // The existing suite lifecycle reads the same non-private fallback.
    await page.goto(`${localOrigin}/`);
    expect(await page.evaluate(() => window.name)).toBe(`${ENTRY_KEY}:${owner}`);
    if (owner !== 'zdwa') await expect(page.locator('link[rel=manifest]')).toHaveAttribute('data-pwa-product', owner);
  });
}
