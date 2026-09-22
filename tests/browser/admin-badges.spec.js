const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });
const admin = { id: 701, username: 'BadgeAdmin', is_admin: true };

async function publicFixture(page, language) {
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  await page.route('**/api/auth/me', route => route.fulfill({ json: {
    authenticated: false, user: null, game_access: { zilch_preview: true, zilch_public: true },
  } }));
  await page.route('**/api/avatars/701*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="#147"/></svg>' }));
}

for (const language of ['de', 'en']) {
  for (const product of ['zdwa', 'zilch']) {
    test(`${product} profile shows the admin contact label outside achievements (${language})`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await publicFixture(page, language);
      if (product === 'zdwa') {
        await page.route('**/api/players/BadgeAdmin', route => route.fulfill({ json: { player: {
          ...admin, statistics: { overall: {}, normal: {}, hardcore: {}, abandoned: {} }, recent_games: [],
          achievements: { unlocked: [], locked: [], points_earned: 0, points_possible: 0 },
        } } }));
        await page.goto('/spieler/BadgeAdmin');
      } else {
        const body = await readFile(path.join(__dirname, '../../app/static/zilch.html'), 'utf8');
        await page.route('**/zilch/spieler/BadgeAdmin', route => route.fulfill({ contentType: 'text/html', body }));
        await page.route('**/api/zilch/players/BadgeAdmin/achievements', route => route.fulfill({ json: {
          player: admin, points: 0, points_possible: 0, categories: [], unlocked: [], locked: [],
        } }));
        await page.route('**/api/zilch/achievement-ranks', route => route.fulfill({ json: { ranks: [] } }));
        await page.goto('/zilch/spieler/BadgeAdmin');
      }
      await expect(page.locator('.admin-contact-label')).toHaveText(language === 'en' ? 'Admin · Contact for questions' : 'Admin · Ansprechperson bei Fragen');
      await expect(page.locator('.player-admin-badge')).toHaveCount(0);
    });
  }
}

test('admin avatar shield is opt-in and role changes preserve the decoded image', async ({ page }) => {
  await publicFixture(page, 'en');
  await page.goto('/regeln');
  const result = await page.evaluate(async () => {
    const { avatarMarkup, replaceChildrenPreservingAvatars } = await import('/static/avatar.js');
    const mount = document.createElement('div'); document.body.append(mount);
    const admin = { user_id: 701, is_admin: true };
    const options = { avatarKey: 'contact', showAdminBadge: true };
    replaceChildrenPreservingAvatars(mount, avatarMarkup(admin, options));
    const image = mount.querySelector('img'); image.loading = 'eager'; await image.decode();
    const label = mount.querySelector('.player-admin-badge')?.getAttribute('aria-label');
    replaceChildrenPreservingAvatars(mount, avatarMarkup({ ...admin, is_admin: false }, options));
    const preserved = image === mount.querySelector('img') && image.complete && image.naturalWidth > 0;
    const unmarked = mount.querySelector('.player-admin-badge') === null;
    const defaults = document.createElement('div');
    defaults.innerHTML = avatarMarkup(admin) + avatarMarkup({ user_id: 701, role: 'admin' }, options)
      + avatarMarkup({ name: 'Admin', is_admin: true }, options) + avatarMarkup({ ...admin, type: 'cpu' }, options);
    return { label, preserved, unmarked, excluded: defaults.querySelectorAll('.player-admin-badge').length };
  });
  expect(result).toEqual({ label: 'Admin · Contact for questions', preserved: true, unmarked: true, excluded: 0 });
});
