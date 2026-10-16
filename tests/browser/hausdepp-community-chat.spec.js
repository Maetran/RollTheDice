const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(new URL(baseURL).port).not.toBe('8000'));

test('all three community lobbies tag Hausdepp messages and share its quick filter in DE and EN', async ({ browser, baseURL }) => {
  const contexts = [];
  const pages = [];
  try {
    for (const path of ['/', '/zilch', '/hausdepp']) {
      const context = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 375, height: 812 } });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      if (!pages.slice(0, -1).length) {
        const registered = await page.request.post('/api/auth/register', {
          data: { username: 'hausdepp_chat_suite', password: 'community-chat-password-123' },
        });
        expect(registered.status()).toBe(201);
      }
      const login = await page.request.post('/api/auth/login', {
        data: { username: 'hausdepp_chat_suite', password: 'community-chat-password-123' },
      });
      expect(login.ok()).toBeTruthy();
      await page.addInitScript(() => {
        if (!localStorage.getItem('zdwa_language')) localStorage.setItem('zdwa_language', 'de');
        const NativeWebSocket = window.WebSocket;
        window.WebSocket = class extends NativeWebSocket {
          constructor(url, protocols) {
            super(url, protocols);
            if (String(url).includes('/ws/lobby-chat')) window.__labelledCommunitySocket = this;
          }
        };
      });
      await page.goto(path);
      await expect.poll(() => page.evaluate(() => window.__labelledCommunitySocket?.readyState === WebSocket.OPEN)).toBe(true);
      await expect(page.locator('[data-lobby-chat-filter="hausdepp"]')).toHaveText('Nur Hausdepp');
    }
    for (const [index, page] of pages.entries()) {
      await page.locator('[data-lobby-chat-input]').fill(`Gemeinsamer Chat · ${['zdwa', 'zilch', 'hausdepp'][index]}`);
      await page.locator('[data-lobby-chat-send]').click();
      for (const target of pages) await expect(target.locator('.lobby-chat__message:not(.lobby-chat__message--presence)')).toHaveCount(index + 1);
    }
    for (const page of pages) {
      await page.locator('[data-lobby-chat-filter="hausdepp"]').click();
      await expect(page.locator('.lobby-chat__message')).toHaveCount(1);
      await expect(page.locator('.lobby-chat__message')).toHaveAttribute('data-game-type', 'hausdepp');
      await expect(page.locator('.lobby-chat__game-badge')).toHaveText('hausdepp');
      await expect(page.locator('.lobby-chat__text')).toHaveText('Gemeinsamer Chat · hausdepp');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await page.locator('[data-lobby-chat-filter="all"]').click();
      await expect(page.locator('.lobby-chat__message:not(.lobby-chat__message--presence)')).toHaveCount(3);
    }
    // Reconnect the same eligible account in English: its frozen history and
    // game tags survive; changing language does not send another chat message.
    const house = pages[2];
    const user = (await (await house.request.get('/api/auth/me')).json()).user;
    const languageSaved = await house.request.put('/api/auth/preferences/language', {
      headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: 'en' },
    });
    expect(languageSaved.ok()).toBeTruthy();
    await house.reload();
    await expect(house.locator('[data-lobby-chat-filter="hausdepp"]')).toHaveText('Hausdepp only');
    await house.locator('[data-lobby-chat-filter="hausdepp"]').click();
    await expect(house.locator('.lobby-chat__message')).toHaveCount(1);
    await expect(house.locator('.lobby-chat__game-badge')).toHaveText('hausdepp');
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
