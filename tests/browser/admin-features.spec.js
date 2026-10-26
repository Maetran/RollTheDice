const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

test('owner manages availability and beta labels; admin has read-only controls at mobile and desktop widths', async ({ browser }, info) => {
  const ownerContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const admin = await adminContext.newPage();
  let original;
  let csrf;
  let originalLanguage;
  try {
    const login = await owner.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
    expect(login.ok()).toBeTruthy();
    const identity = (await login.json()).user;
    csrf = identity.csrf_token;
    originalLanguage = identity.preferences?.preferred_language || 'de';
    expect(identity.is_owner).toBe(true);
    const headers = { 'X-CSRF-Token': csrf };
    original = await (await owner.request.get('/api/admin/features')).json();
    await owner.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: 'en' } });
    const username = `FeatureAdmin${Date.now()}`;
    expect((await owner.request.post('/api/admin/users', { headers, data: {
      username, temporary_password: 'feature-admin-password-123', role: 'admin',
    } })).status()).toBe(201);
    expect((await admin.request.post('/api/auth/login', { data: { username, password: 'feature-admin-password-123' } })).ok()).toBeTruthy();
    for (const page of [owner, admin]) await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto('/admin');
    await owner.locator('[data-admin-panel="featuresPanel"]').click();
    const row = owner.locator('[data-feature-key="watten.schoeneres"]');
    await expect(row.locator('select')).toBeEnabled();
    await row.locator('select').selectOption('public');
    await row.locator('[name="beta"]').check();
    await row.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(owner.locator('#featureFeedback')).toHaveText('Saved. Games in progress keep their rules.');
    expect((await (await owner.request.get('/api/features')).json()).features['watten.schoeneres']).toMatchObject({ status: 'public', beta: true, can_select: true });
    const watten = owner.locator('[data-game-beta="watten"]');
    await watten.locator('[name="beta"]').uncheck();
    await watten.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(owner.locator('#featureFeedback')).toHaveText('Saved. Games in progress keep their rules.');
    expect((await (await owner.request.get('/api/features')).json()).games.watten.beta).toBe(false);
    expect(await owner.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await owner.evaluate(() => window.scrollTo(0, 0));
    await owner.screenshot({ path: info.outputPath('owner-features-mobile.png'), fullPage: true });
    await owner.locator('[data-admin-panel="featureAuditPanel"]').click();
    await expect(owner.locator('#featureAuditRows')).toContainText('Schöneres');
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.goto('/admin');
    await admin.locator('[data-admin-panel="featuresPanel"]').click();
    await expect(admin.locator('[data-feature-key="watten.schoeneres"] select')).toBeDisabled();
    await expect(admin.locator('[data-game-beta="watten"] input')).toBeDisabled();
    await admin.screenshot({ path: info.outputPath('admin-features-desktop.png'), fullPage: true });
    const adminIdentity = (await (await admin.request.get('/api/auth/me')).json()).user;
    const settings = await (await admin.request.get('/api/admin/features')).json();
    const current = settings.features.find(feature => feature.key === 'watten.schoeneres');
    expect((await admin.request.put('/api/admin/features/watten.schoeneres', {
      headers: { 'X-CSRF-Token': adminIdentity.csrf_token }, data: { version: current.version, status: 'off', beta: false },
    })).status()).toBe(403);
  } finally {
    if (original && csrf) {
      const latest = await (await owner.request.get('/api/admin/features')).json();
      const headers = { 'X-CSRF-Token': csrf };
      const previous = original.features.find(feature => feature.key === 'watten.schoeneres');
      const current = latest.features.find(feature => feature.key === 'watten.schoeneres');
      expect((await owner.request.put('/api/admin/features/watten.schoeneres', { headers,
        data: { version: current.version, status: previous.status, beta: previous.beta },
      })).ok()).toBeTruthy();
      expect((await owner.request.put('/api/admin/features/games/watten/beta', { headers,
        data: { version: latest.games.find(game => game.key === 'watten').version, beta: original.games.find(game => game.key === 'watten').beta },
      })).ok()).toBeTruthy();
      await owner.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: originalLanguage } });
    }
    await Promise.all([ownerContext.close(), adminContext.close()]);
  }
});

test('audit fetch failures remain visible in the open history panel', async ({ page }) => {
  expect((await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } })).ok()).toBeTruthy();
  await page.goto('/admin');
  await page.route('**/api/admin/features', route => route.fulfill({ status: 503, json: { detail: 'feature_settings_unavailable' } }));
  try {
    await page.locator('[data-admin-panel="featureAuditPanel"]').click();
    await expect(page.locator('#featureAuditFeedback')).toBeVisible();
    await expect(page.locator('#featureAuditFeedback')).not.toBeEmpty();
    await expect(page.locator('#featureAuditRows li')).toHaveCount(0);
  } finally {
    await page.unroute('**/api/admin/features');
  }
  await page.locator('#reloadFeatureAudit').click();
  await expect(page.locator('#featureAuditFeedback')).toBeEmpty();
});

test('a real account switch retires the mounted owner form before any further feature write', async ({ page }) => {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  const owner = (await login.json()).user;
  const username = `FeatureSwitch${Date.now()}`;
  const password = 'feature-switch-password-123';
  const created = await page.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': owner.csrf_token },
    data: { username, temporary_password: password, role: 'admin' } });
  expect(created.status()).toBe(201);
  await page.goto('/admin');
  await page.locator('[data-admin-panel="featuresPanel"]').click();
  await expect(page.locator('[data-feature-key="watten.schoeneres"] select')).toBeEnabled();
  const writes = [];
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/api/admin/features/')) writes.push(request.url()); });
  expect((await page.request.post('/api/auth/login', { data: { username, password } })).ok()).toBeTruthy();
  await page.evaluate(async () => {
    const { loadAuth } = await import('/static/auth.js');
    await loadAuth({ refresh: true });
  });
  await expect(page.locator('#featureGroups')).toBeEmpty();
  await expect(page.locator('#featureFeedback')).not.toBeEmpty();
  expect(writes).toEqual([]);
});
