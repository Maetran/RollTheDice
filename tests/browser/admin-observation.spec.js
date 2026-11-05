const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

async function setup(page, { language = 'de', owner = true } = {}) {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  const state = { user: { id: 7, username: 'Owner', role: 'admin', is_admin: true, is_owner: owner,
    is_founder: owner, csrf_token: 'csrf-observation', preferences: { preferred_language: language } },
  policy: { viewer_id: 7, can_manage: owner, enabled: false, mode: 'all', version: 0, retention_days: 365, selected_players: [] }, writes: [], deletes: [], exports: [], conflict: false };
  const body = await readFile(path.join(__dirname, '../../app/static/admin.html'), 'utf8');
  await page.route('**/api/**', route => route.fulfill({ json: { users: [], games: [], participants: [] } }));
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated: true, user: state.user, game_access: {}, passkeys: {} } }));
  await page.route('**/api/admin/features', route => route.fulfill({ json: { viewer_id: 7, can_manage: owner, features: [], games: [], audit: [] } }));
  await page.route('**/api/admin/observation', route => {
    expect(route.request().headers()['x-account-expected-id']).toBe('7');
    if (route.request().method() === 'PUT') {
      expect(route.request().headers()['x-csrf-token']).toBe('csrf-observation');
      const data = route.request().postDataJSON(); state.writes.push(data);
      if (state.conflict) return route.fulfill({ status: 409, json: { detail: 'observation_conflict' } });
      state.policy = { ...state.policy, enabled: data.enabled, mode: data.mode, version: data.version + 1,
        selected_players: data.selected_user_ids.map(id => ({ id, username: id === 42 ? 'Expert <One>' : 'Other' })) };
    }
    return route.fulfill({ json: state.policy });
  });
  await page.route('**/api/admin/observation/players?*', route => route.fulfill({ json: { players: [{ id: 42, username: 'Expert <One>' }] } }));
  await page.route('**/api/admin/observation/recordings', route => {
    expect(route.request().headers()['x-csrf-token']).toBe('csrf-observation');
    state.deletes.push(route.request().postDataJSON()); state.policy = { ...state.policy, enabled: false, version: state.policy.version + 1 };
    return route.fulfill({ json: { deleted: 1, version: state.policy.version } });
  });
  await page.route('**/api/admin/observation/recordings?*', route => {
    state.exports.push(route.request().url());
    return route.fulfill({ json: { items: [{ id: 'abc123', game_type: 'hausdepp', status: 'completed' }], next_cursor: null } });
  });
  await page.route('**/api/admin/observation/recordings/*/events?*', route => {
    state.exports.push(route.request().url());
    return route.fulfill({ json: { items: [{ sequence: 1, actor_kind: 'human', action: 'play' }], next_after: null } });
  });
  await page.goto('/admin');
  await page.locator('[data-admin-panel="featuresPanel"]').click();
  await expect(page.locator('[data-observation-form]')).toBeVisible();
  return state;
}

for (const language of ['de', 'en']) {
  test(`${language}: configure, export, and explicitly delete recordings on mobile`, async ({ page }) => {
    const state = await setup(page, { language });
    const area = page.locator('[data-observation-panel]');
    await expect(area).toContainText('365');
    await area.locator('[name="enabled"]').check();
    await area.locator('[name="mode"]').selectOption('selected');
    await expect(area.locator('[data-observation-selection]')).toContainText(language === 'de' ? 'bei anderen Menschen nur öffentliche Züge' : 'only public moves are recorded for other humans');
    await area.locator('[name="query"]').fill('Expert');
    await area.locator('[name="query"]').press('Enter');
    await area.locator('[data-observation-add="42"]').click();
    await expect(area.locator('[data-observation-selected]')).toContainText('Expert <One>');
    await expect(area.locator('[data-observation-selected] one')).toHaveCount(0);
    await area.locator('[data-observation-form] button[type="submit"]').click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0]).toEqual({ enabled: true, mode: 'selected', selected_user_ids: [42], version: 0 });
    await expect(area.locator('[data-observation-selected]')).toContainText('Expert <One>');
    const dimensions = await area.evaluate(element => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
      controls: [...element.querySelectorAll('button, input:not([type=checkbox]), select')].filter(node => node.checkVisibility()).map(node => {
        const box = node.getBoundingClientRect(); return { left: box.left, right: box.right, height: box.height };
      }) }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
    for (const box of dimensions.controls) { expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeLessThanOrEqual(321); expect(box.height).toBeGreaterThanOrEqual(44); }
    await expect(area.locator('[data-observation-export-notice]')).toContainText(language === 'de' ? 'kein gemeinsamer Stichtag' : 'not a single point-in-time snapshot');
    const download = page.waitForEvent('download');
    await area.locator('[data-observation-export]').click();
    const saved = await download; expect(saved.suggestedFilename()).toBe('spielbeobachtung.json');
    const stream = await saved.createReadStream(); let file = '';
    for await (const part of stream) file += part;
    const exported = JSON.parse(file);
    expect(exported.export_notice.de).toContain('kein gemeinsamer Stichtag');
    expect(exported.export_notice.en).toContain('not a single point-in-time snapshot');
    expect(exported.recordings[0].events).toHaveLength(1);
    expect(state.exports).toHaveLength(2);
    await area.locator('[data-observation-delete] summary').click();
    await expect(area.locator('[data-observation-delete-button]')).toBeDisabled();
    await area.locator('[data-observation-confirm]').check();
    await area.locator('[data-observation-delete-button]').click();
    await expect.poll(() => state.deletes.length).toBe(1);
    expect(state.deletes[0]).toEqual({ version: 1 });
    await expect(area.locator('[name="enabled"]')).not.toBeChecked();
  });
}

test('non-owner can inspect settings but cannot alter, search, export or delete', async ({ page }) => {
  await setup(page, { owner: false });
  const area = page.locator('[data-observation-panel]');
  await expect(area.locator('[name="enabled"]')).toBeDisabled();
  await expect(area.locator('[name="mode"]')).toBeDisabled();
  await expect(area.locator('[data-observation-export]')).toBeDisabled();
  await area.locator('[data-observation-delete] summary').click();
  await expect(area.locator('[data-observation-confirm]')).toBeDisabled();
});

test('a changed identity invalidates the panel and blocks subsequent writes', async ({ page }) => {
  const state = await setup(page);
  state.user = { ...state.user, id: 8 };
  await page.locator('[data-observation-form] button[type="submit"]').click();
  await expect(page.locator('[data-observation-form]')).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});


test('owner removes selected players and sees conflicts without claiming a save', async ({ page }) => {
  const state = await setup(page);
  const area = page.locator('[data-observation-panel]');
  await area.locator('[name="mode"]').selectOption('selected');
  await area.locator('[name="query"]').fill('Expert');
  await area.locator('[data-observation-search]').click();
  await area.locator('[data-observation-add="42"]').click();
  await area.locator('[data-observation-remove="42"]').click();
  await expect(area.locator('[data-observation-remove]')).toHaveCount(0);
  await area.locator('[data-observation-form] button[type="submit"]').click();
  await expect.poll(() => state.writes.length).toBe(1);
  expect(state.writes[0]).toEqual({ enabled: false, mode: 'selected', selected_user_ids: [], version: 0 });
  state.conflict = true;
  await area.locator('[name="enabled"]').check();
  await area.locator('[data-observation-form] button[type="submit"]').click();
  await expect(area.locator('[data-observation-status]')).toContainText('inzwischen geändert');
  expect(state.writes[1]).toEqual({ enabled: true, mode: 'selected', selected_user_ids: [], version: 1 });
});
