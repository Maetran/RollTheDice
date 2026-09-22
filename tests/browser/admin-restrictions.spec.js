const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

for (const language of ['de', 'en']) {
  test(`admin sets and removes an explicit account restriction (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
    const body = await readFile(path.join(__dirname, '../../app/static/admin.html'), 'utf8');
    await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body }));
    await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated: true, user: {
      id: 1, username: 'ContactAdmin', role: 'admin', is_admin: true, csrf_token: 'fixture', preferences: {},
    }, game_access: { zilch_preview: true }, passkeys: { enabled: false } } }));
    const admin = { id: 1, username: 'ContactAdmin', role: 'admin', is_active: true, bans: [] };
    const player = { id: 2, username: 'RegularPlayer', role: 'user', is_active: true, bans: [] };
    await page.route('**/api/admin/users?*', route => route.fulfill({ json: { users: [admin, player] } }));
    const posted = [], revoked = [];
    await page.route('**/api/admin/users/2/bans', async route => {
      const payload = route.request().postDataJSON(); posted.push(payload);
      const ban = { id: posted.length, scope: payload.scope, reason: payload.reason, created_at: new Date().toISOString(), expires_at: payload.days === null ? null : new Date(Date.now() + payload.days * 86400000).toISOString() };
      player.bans = [ban];
      await route.fulfill({ json: { ban } });
    });
    await page.route('**/api/admin/users/2/bans/*', async route => {
      revoked.push(route.request().method()); player.bans = [];
      await route.fulfill({ json: { ok: true } });
    });
    await page.goto('/admin');
    await page.locator('[data-admin-panel="usersPanel"]').click();
    const row = page.locator('tr[data-user-id="2"]');
    const adminRow = page.locator('tr[data-user-id="1"]');
    await adminRow.locator('[data-ban-editor] summary').click();
    await expect(adminRow.locator('[data-ban-editor]')).toContainText(language === 'en' ? 'Change the admin role' : 'Ändere zuerst die Adminrolle');
    await expect(adminRow.locator('[data-ban-form]')).toHaveCount(0);
    await row.locator('[data-ban-editor] summary').click();
    await row.locator('select[name="scope"]').selectOption('help');
    await row.locator('select[name="days"]').selectOption('14');
    await row.locator('textarea[name="reason"]').fill('Repeated <misuse>');
    await row.locator('[data-ban-form] button[type="submit"]').click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toEqual({ scope: 'help', days: 14, reason: 'Repeated <misuse>' });
    await expect(row.locator('.admin-ban-list')).toContainText('Repeated <misuse>');
    await expect(row.locator('.admin-ban-list misuse')).toHaveCount(0);
    await page.reload();
    await page.locator('[data-admin-panel="usersPanel"]').click();
    await expect(row.locator('.admin-ban-list')).toContainText(language === 'en' ? 'Admin help blocked' : 'Adminhilfe gesperrt');
    await row.locator('[data-revoke-ban="help"]').click();
    await expect.poll(() => revoked).toEqual(['DELETE']);
    await expect(row.locator('.admin-ban-controls')).toContainText(language === 'en' ? 'No active restrictions' : 'Keine aktiven Sperren');
    await row.locator('select[name="scope"]').selectOption('play');
    await row.locator('select[name="days"]').selectOption('permanent');
    await row.locator('textarea[name="reason"]').fill('Repeated rule violations');
    await row.locator('[data-ban-form] button[type="submit"]').click();
    await expect.poll(() => posted.length).toBe(2);
    expect(posted[1]).toEqual({ scope: 'play', days: null, reason: 'Repeated rule violations' });
    await expect(row.locator('.admin-ban-list')).toContainText(language === 'en' ? 'Permanently' : 'Dauerhaft');
    await expect(page.locator('#adminMessage')).toHaveText(language === 'en' ? 'Restriction applied.' : 'Sperre wurde gesetzt.');
  });
}
