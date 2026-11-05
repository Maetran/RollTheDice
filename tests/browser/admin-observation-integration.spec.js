const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('real owner manages observation policy and deletion through the admin UI', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const owner = (await login.json()).user;
  expect(owner.is_owner).toBe(true);
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), owner.preferences?.preferred_language || 'de');
  const headers = { 'X-CSRF-Token': owner.csrf_token, 'X-Account-Expected-Id': String(owner.id) };
  const username = `ObsTest${Date.now()}`;
  const created = await page.request.post('/api/admin/users', { headers,
    data: { username, temporary_password: 'observation-test-password-123', role: 'user' } });
  expect(created.status()).toBe(201);
  const player = (await created.json()).user;
  const read = async () => {
    const response = await page.request.get('/api/admin/observation', { headers });
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['cache-control']).toContain('no-store');
    return response.json();
  };
  const original = await read();
  try {
    await page.goto('/admin');
    await page.locator('[data-admin-panel="featuresPanel"]').click();
    const area = page.locator('[data-observation-panel]');
    await expect(area.locator('[data-observation-form]')).toBeVisible();
    await expect(area.locator('[name="enabled"]')).toBeEnabled();

    // Global mode starts recording for all tables with a human participant.
    await area.locator('[name="enabled"]').check();
    await area.locator('[name="mode"]').selectOption('all');
    const saveAll = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/observation' && response.request().method() === 'PUT');
    await area.locator('[data-observation-form] button[type="submit"]').click();
    expect((await saveAll).ok()).toBeTruthy();
    await expect.poll(async () => (await read()).enabled).toBe(true);
    expect((await read()).mode).toBe('all');

    // The player search and selection use the real endpoint and persisted IDs.
    await area.locator('[name="mode"]').selectOption('selected');
    await area.locator('[name="query"]').fill(username);
    await area.locator('[data-observation-search]').click();
    await area.locator(`[data-observation-add="${player.id}"]`).click();
    const saveSelection = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/observation' && response.request().method() === 'PUT');
    await area.locator('[data-observation-form] button[type="submit"]').click();
    expect((await saveSelection).ok()).toBeTruthy();
    await expect.poll(async () => (await read()).selected_players.map(item => item.id)).toEqual([player.id]);
    expect((await read()).mode).toBe('selected');

    // Switching off is persisted immediately when the form is saved.
    await area.locator('[name="enabled"]').uncheck();
    const saveOff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/observation' && response.request().method() === 'PUT');
    await area.locator('[data-observation-form] button[type="submit"]').click();
    expect((await saveOff).ok()).toBeTruthy();
    await expect.poll(async () => (await read()).enabled).toBe(false);

    // Deletion is a separate explicit action and also switches observation off.
    await area.locator('[name="enabled"]').check();
    const saveOn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/observation' && response.request().method() === 'PUT');
    await area.locator('[data-observation-form] button[type="submit"]').click();
    expect((await saveOn).ok()).toBeTruthy();
    await expect.poll(async () => (await read()).enabled).toBe(true);
    const beforeDelete = await read();
    await area.locator('[data-observation-delete] summary').click();
    await expect(area.locator('[data-observation-delete-button]')).toBeDisabled();
    await area.locator('[data-observation-confirm]').check();
    const deleted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/observation/recordings' && response.request().method() === 'DELETE');
    await area.locator('[data-observation-delete-button]').click();
    const result = await deleted;
    expect(result.ok()).toBeTruthy();
    expect((await result.json()).version).toBe(beforeDelete.version + 1);
    await expect.poll(async () => (await read()).enabled).toBe(false);
    expect((await read()).selected_players.map(item => item.id)).toEqual([player.id]);
    expect((await (await page.request.get('/api/admin/observation/recordings', { headers })).json()).items).toEqual([]);
    await expect(area.locator('[name="enabled"]')).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    const current = await read();
    const restored = await page.request.put('/api/admin/observation', { headers, data: {
      enabled: original.enabled, mode: original.mode,
      selected_user_ids: original.selected_players.map(item => item.id), version: current.version,
    } });
    expect(restored.ok()).toBeTruthy();
  }
});
