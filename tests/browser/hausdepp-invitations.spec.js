const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
test.beforeAll(({ baseURL }) => expect(new URL(baseURL).port).not.toBe('8000'));

async function owner(page, language) {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.inviteOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  return headers;
}

test.afterEach(async ({ page }) => {
  if (page.inviteOwner) await page.request.put('/api/auth/preferences/language', {
    headers: page.inviteOwner.headers, data: { preferred_language: page.inviteOwner.language },
  });
});

async function waitingTable(page, headers) {
  const response = await page.request.post('/api/games', {
    headers, data: { name: 'Browser-Test · Einladung', mode: '2', game_type: 'hausdepp', play_mode: 'multiplayer', cpu_count: 0 },
  });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).game_id;
  await page.goto(`/hausdepp/spiel/${id}`);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  return { id, controls: page.locator('#hausdeppWaiting .hd-invitation') };
}

for (const language of ['de', 'en']) {
  test(`${language}: shared player call requires a click and preserves server cooldowns without sending a real push`, async ({ page }) => {
    const headers = await owner(page, language);
    await page.clock.install();
    const requests = [];
    await page.route('**/api/games/*/notify-open-seat', route => {
      requests.push(route.request().url());
      const count = requests.length;
      // Only the UI response is simulated. No service worker subscription,
      // notification permission or push dispatcher is contacted by this test.
      return route.fulfill(count === 2 ? { status: 429, json: { detail: {
        code: 'game_invite_cooldown', retry_after_seconds: 25,
      } } } : { json: { ok: true, notified: count > 2, retry_after_seconds: count > 2 ? 600 : 60 } });
    });
    const { id, controls } = await waitingTable(page, headers);
    const call = controls.locator('[data-invite-action="call"]');
    await expect(call).toBeEnabled();
    expect(requests).toEqual([]);
    await call.click();
    await expect(controls.locator('[data-invite-status]')).toHaveText(language === 'de'
      ? 'Aktuell konnte kein freigeschalteter Mitspieler per Push informiert werden.'
      : 'No eligible player could be notified by push right now.');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(`/api/games/${id}/notify-open-seat`);
    await expect(call).toBeDisabled();
    await expect(controls.locator('[data-invite-cooldown]')).toContainText('60');
    await page.clock.fastForward(60001);
    await expect(call).toBeEnabled();
    await call.click();
    await expect(controls.locator('[data-invite-status]')).toHaveClass(/is-error/);
    await expect(call).toBeDisabled();
    await expect(controls.locator('[data-invite-cooldown]')).toContainText('25');
    await page.clock.fastForward(25001);
    await expect(call).toBeEnabled();
    await call.click();
    await expect(controls.locator('[data-invite-status]')).toHaveText(language === 'de'
      ? 'Freigeschaltete Mitspieler mit aktivierten Push-Einladungen wurden informiert.'
      : 'Eligible players with push invitations enabled have been notified.');
    await expect(call).toBeDisabled();
    await expect(controls.locator('[data-invite-cooldown]')).toContainText('600');
    expect(requests).toHaveLength(3);
    await page.goto('/hausdepp');
    await expect(page.locator(`[data-table-id="${id}"] [data-invite-action="call"]`)).toBeVisible();
    expect(requests).toHaveLength(3);
  });

  test(`${language}: native share, copy and selected manual link use the same private table URL`, async ({ page }) => {
    const headers = await owner(page, language);
    await page.addInitScript(() => {
      window.testShares = []; window.testCopies = [];
      Object.defineProperty(navigator, 'share', { configurable: true, value: async data => window.testShares.push(data) });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async text => window.testCopies.push(text),
      } });
    });
    const calls = [];
    await page.route('**/api/games/*/notify-open-seat', route => {
      calls.push(route.request().url());
      return route.fulfill({ json: { ok: true, notified: false, retry_after_seconds: 60 } });
    });
    await page.setViewportSize({ width: 320, height: 568 });
    const { id, controls } = await waitingTable(page, headers);
    const share = controls.locator('[data-invite-action="share"]');
    await share.click();
    const shares = await page.evaluate(() => window.testShares);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ title: 'Hausdepp', url: `${new URL(page.url()).origin}/hausdepp/spiel/${id}` });
    expect(shares[0].text).toContain('Browser-Test · Einladung');
    await controls.locator('[data-invite-action="copy"]').click();
    expect(await page.evaluate(() => window.testCopies)).toEqual([shares[0].url]);
    await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true,
      value: async () => { throw new DOMException('Cancelled', 'AbortError'); } }));
    await share.click();
    expect(await page.evaluate(() => window.testCopies)).toHaveLength(1);
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Unavailable'); } } });
    });
    await share.click();
    const link = controls.locator('[data-invite-fallback] input');
    await expect(link).toBeVisible();
    await expect(link).toHaveValue(shares[0].url);
    await expect(link).toBeFocused();
    expect(await link.evaluate(input => input.selectionEnd - input.selectionStart)).toBe(shares[0].url.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    for (const button of await controls.locator('button:visible').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(calls).toEqual([]);
  });
}
