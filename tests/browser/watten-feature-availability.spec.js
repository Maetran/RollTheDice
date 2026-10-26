const { test, expect } = require('@playwright/test');
const { player, openCreator, create, action } = require('./helpers/watten-journey.cjs');

const KEYS = ['schoeneres', 'schlagwechsel', 'critical', 'show_rechter', 'trick_history', 'open_partner_hand'].map(key => `watten.${key}`);

async function ownerSession(browser, baseURL, language = 'de') {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  const login = await context.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  expect(user.is_owner).toBe(true);
  const originalLanguage = user.preferences?.preferred_language || 'de';
  expect((await context.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  await page.addInitScript(value => { if (!localStorage.getItem('zdwa_language')) localStorage.setItem('zdwa_language', value); }, language);
  return { context, page, user, async close() {
    try {
      await context.request.put('/api/auth/preferences/language', {
        headers: { 'X-CSRF-Token': user.csrf_token }, data: { preferred_language: originalLanguage },
      });
    } finally { await context.close(); }
  } };
}

async function settings(owner) {
  const response = await owner.context.request.get('/api/admin/features');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).features;
}

async function setFeature(owner, key, status, beta = false) {
  const current = (await settings(owner)).find(entry => entry.key === key);
  const response = await owner.context.request.put(`/api/admin/features/${key}`, {
    headers: { 'X-CSRF-Token': owner.user.csrf_token }, data: { status, beta, version: current.version },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

async function internalScope(owner, run) {
  const original = (await settings(owner)).filter(entry => KEYS.includes(entry.key));
  try {
    for (const entry of original) await setFeature(owner, entry.key, 'internal');
    await run();
  } finally {
    for (const entry of original) await setFeature(owner, entry.key, entry.status, entry.beta);
  }
}

for (const language of ['de', 'en']) {
  test(`${language}: real owner and admin choose internal features; regular players see only current published beta options`, async ({ browser, baseURL }, info) => {
    const owner = await ownerSession(browser, baseURL, language);
    const admin = await player(browser, baseURL, language, { role: 'admin' });
    const ordinary = await player(browser, baseURL, language);
    try {
      await internalScope(owner, async () => {
        for (const staff of [owner, admin]) {
          await staff.page.goto(`/watten?lang=${language}`);
          const form = await openCreator(staff.page);
          await form.locator('[data-watten-advanced] > summary').click();
          for (const key of KEYS) await expect(form.locator(`[data-watten-create-feature="${key}"]`)).toBeVisible();
          await expect(form.locator('[data-watten-feature-beta]:visible')).toHaveCount(0);
        }
        await ordinary.page.goto(`/watten?lang=${language}`);
        const form = await openCreator(ordinary.page);
        await expect(form.locator('button[type=submit]')).toBeEnabled();
        await expect(form.locator('[data-watten-advanced]')).toBeHidden();
        await expect(form.locator('[data-watten-create-feature]:visible')).toHaveCount(0);
        await ordinary.page.locator('[data-watten-create-close]').click();

        await setFeature(owner, 'watten.schoeneres', 'public', true);
        const published = await openCreator(ordinary.page);
        await published.locator('[data-watten-advanced] > summary').click();
        await expect(published.locator('[name=schoeneres_enabled]')).toBeVisible();
        await expect(published.locator('[data-watten-feature-beta="watten.schoeneres"]')).toBeVisible();
        await expect(published.locator('[data-watten-create-feature]:visible')).toHaveCount(1);
        await published.locator('[name=schoeneres_enabled]').check();
        for (const viewport of [{ width: 393, height: 852 }, { width: 768, height: 1024 }, { width: 1440, height: 1000 }]) {
          await ordinary.page.setViewportSize(viewport);
          expect(await ordinary.page.locator('[data-watten-create-dialog]').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
        }
        await ordinary.page.screenshot({ path: info.outputPath(`published-beta-${language}.png`) });
        await ordinary.page.locator('[data-watten-create-close]').click();

        const reopened = await openCreator(ordinary.page);
        await expect(reopened.locator('button[type=submit]')).toBeEnabled();
        await expect(reopened.locator('[name=schoeneres_enabled]')).toBeChecked();
        await ordinary.page.locator('[data-watten-create-close]').click();

        await setFeature(owner, 'watten.schoeneres', 'off');
        const disabled = await openCreator(ordinary.page);
        await expect(disabled.locator('button[type=submit]')).toBeEnabled();
        await expect(disabled.locator('[name=schoeneres_enabled]')).not.toBeChecked();
        await expect(disabled.locator('[data-watten-advanced]')).toBeHidden();
      });
    } finally { await Promise.allSettled([owner.close(), admin.context.close(), ordinary.context.close()]); }
  });
}

test('a seated nonhost admin activates internal options at an ordinary host table and everyone receives legal gameplay choices', async ({ browser, baseURL }) => {
  const owner = await ownerSession(browser, baseURL);
  const host = await player(browser, baseURL);
  const admin = await player(browser, baseURL, 'en', { role: 'admin' });
  const players = [host, admin];
  try {
    await internalScope(owner, async () => {
      await create(players, { count: 2, target: 15, start: false });
      await expect(host.page.locator('[data-watten-table-features]')).toHaveCount(0);
      const controls = admin.page.locator('[data-watten-table-features]');
      await expect(controls).toBeVisible();
      await controls.locator(':scope > summary').click();
      for (const [key, recipeField] of [['schoeneres', 'schoeneres_enabled'], ['schlagwechsel', 'schlagwechsel_enabled']]) {
        await controls.locator(`[data-feature="watten.${key}"]`).click();
        await expect.poll(() => players.every(item => item.traffic.snapshot.room.recipe[recipeField] === true)).toBe(true);
      }
      await host.page.locator('[data-watten-command=start]').click();
      await expect.poll(() => players.every(item => item.traffic.snapshot.started && item.traffic.snapshot.engine)).toBe(true);
      await expect.poll(() => host.traffic.snapshot.engine.actions.includes('request_schoeneres')).toBe(true);
      await host.page.locator('[data-watten-preplay-options] > summary').click();
      await host.page.locator('[data-watten-action=request_schoeneres]').click();
      await expect(admin.page.locator('[data-watten-preplay-pending=schoeneres]')).toBeVisible();
      await action(players, 'preplay_accept');
      expect(host.traffic.commands.some(command => command.kind === 'request_schoeneres')).toBe(true);
      expect(host.traffic.errors).toEqual([]); expect(admin.traffic.errors).toEqual([]);
    });
  } finally { await Promise.allSettled([owner.close(), ...players.map(item => item.context.close())]); }
});

test('unavailable policy keeps selectors closed, offers a retry and sanitizes a revoked favorite', async ({ browser, baseURL }) => {
  const owner = await ownerSession(browser, baseURL);
  const ordinary = await player(browser, baseURL, 'en');
  try {
    await internalScope(owner, async () => {
      await setFeature(owner, 'watten.schoeneres', 'public', true);
      await ordinary.page.goto('/watten?lang=en');
      const form = await openCreator(ordinary.page);
      await form.locator('[data-watten-advanced] > summary').click();
      await form.locator('[name=schoeneres_enabled]').check();
      await form.locator('.wt-create-favorite > summary').click();
      await form.locator('[data-watten-favorite-action=save]').click();
      await expect.poll(async () => (await (await ordinary.context.request.get('/api/watten/favorite')).json()).recipe?.schoeneres_enabled).toBe(true);
      await ordinary.page.locator('[data-watten-create-close]').click();
      await setFeature(owner, 'watten.schoeneres', 'internal');

      await ordinary.page.route('**/api/features', route => route.fulfill({ status: 503, json: { detail: 'temporarily_unavailable' } }));
      const unavailable = await openCreator(ordinary.page);
      await expect(unavailable.locator('[data-watten-feature-status]')).toHaveText('Feature availability could not be loaded. Advanced features remain off.');
      await expect(unavailable.locator('[data-watten-advanced]')).toBeHidden();
      await expect(unavailable.locator('[name=schoeneres_enabled]')).not.toBeChecked();
      await ordinary.page.unroute('**/api/features');
      await unavailable.locator('[data-watten-features-retry]').click();
      await expect(unavailable.locator('[data-watten-feature-availability]')).toBeHidden();
      await unavailable.locator('[data-watten-create-back]').click();
      await ordinary.page.locator('[data-watten-create-favourite]').click();
      await expect(unavailable.locator('[name=schoeneres_enabled]')).not.toBeChecked();
      await expect(unavailable.locator('[data-watten-create-error]')).toHaveText('Unavailable features were removed from this preset.');
      await unavailable.locator('button[type=submit]').click();
      await expect(ordinary.page).toHaveURL(/\/watten\/spiel\/[0-9a-f]{16}$/);
      await expect.poll(() => ordinary.traffic.snapshot?.room.recipe.schoeneres_enabled).toBe(false);
      expect(ordinary.traffic.errors).toEqual([]);
    });
  } finally { await Promise.allSettled([owner.close(), ordinary.context.close()]); }
});

test('creator and waiting-room staff controls disable rules incompatible with the current table', async ({ browser, baseURL }) => {
  const owner = await ownerSession(browser, baseURL);
  const admin = await player(browser, baseURL, 'en', { role: 'admin' });
  try {
    await internalScope(owner, async () => {
      await admin.page.goto('/watten?lang=en');
      const form = await openCreator(admin.page);
      await form.locator('[data-watten-advanced] > summary').click();
      const swap = form.locator('[name=schlagwechsel_enabled]');
      await expect(swap).toBeDisabled();
      await expect(form.locator('[data-watten-schlagwechsel-help]')).toHaveText('Strike swap is only available in open normal play with two or four players.');
      await form.locator('[name=blind]').uncheck();
      await expect(swap).toBeDisabled();
      await form.locator('[name=determination][value=normal] + span').click();
      await expect(swap).toBeEnabled();
      await swap.check();
      await form.locator('[name=determination][value=ladinisch] + span').click();
      await expect(swap).toBeDisabled(); await expect(swap).not.toBeChecked();
      await admin.page.locator('[data-watten-create-close]').click();

      for (const { count, determination, unavailable } of [
        { count: 2, determination: 'normal', unavailable: ['open_partner_hand'] },
        { count: 3, determination: 'normal', unavailable: ['schoeneres', 'schlagwechsel'] },
        { count: 4, unavailable: ['open_partner_hand', 'schlagwechsel'] },
        { count: 2, determination: 'ladinisch', unavailable: ['open_partner_hand', 'schlagwechsel'] },
      ]) {
        await create([admin], { count, determination, cpuFill: true, start: false });
        const controls = admin.page.locator('[data-watten-table-features]');
        await controls.locator(':scope > summary').click();
        for (const key of unavailable) {
          await expect(controls.locator(`[data-feature="watten.${key}"]`)).toBeDisabled();
          expect(admin.traffic.snapshot.room.feature_controls[`watten.${key}`].can_enable).toBe(false);
        }
        await expect(controls.locator('[data-feature="watten.show_rechter"]')).toBeEnabled();
        const legacyFavorite = count === 3 ? { ...admin.traffic.snapshot.room.recipe, schlagwechsel_enabled: true } : null;
        await admin.page.locator('[data-watten-command=leave-waiting]').click();
        await expect(admin.page).toHaveURL(/\/watten$/);
        if (legacyFavorite) {
          // Historical recipes already carried the inert strike-swap rule.
          // Loading that preference must still work; a new table clears it.
          const saved = await admin.context.request.put('/api/watten/favorite', {
            headers: { 'X-CSRF-Token': admin.user.csrf_token, 'X-Watten-Expected-Account-Id': String(admin.user.id) },
            data: { recipe: legacyFavorite },
          });
          expect(saved.ok()).toBeTruthy();
          await admin.page.reload();
          const restored = await openCreator(admin.page, { favorite: true });
          await expect(restored.locator('[name=count][value="3"]')).toBeChecked();
          await expect(restored.locator('[name=schlagwechsel_enabled]')).toBeDisabled();
          await expect(restored.locator('[name=schlagwechsel_enabled]')).not.toBeChecked();
          expect((await (await admin.context.request.get('/api/watten/favorite')).json()).recipe.schlagwechsel_enabled).toBe(true);
          await admin.page.locator('[data-watten-create-close]').click();
        }
      }
      expect(admin.traffic.errors).toEqual([]);
    });
  } finally { await Promise.allSettled([owner.close(), admin.context.close()]); }
});
