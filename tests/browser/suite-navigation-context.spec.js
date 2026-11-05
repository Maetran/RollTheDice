const { test, expect } = require('@playwright/test');
const { player } = require('./helpers/watten-journey.cjs');

test.use({ serviceWorkers: 'block' });

// Every page marks exactly one main-menu context; the Watten area keeps one
// stable bar for Erfolge & Titel / Deine Partien / Rangliste.
async function currentMainEntry(page) {
  const current = page.locator('.suite-header__nav [aria-current="page"]');
  await expect(current).toHaveCount(1);
  return current;
}

async function areaBar(page, active) {
  // Measure the settled document, never one that is being left.
  await page.waitForLoadState('load');
  await expect(page.locator('[data-progress-loading]')).toHaveCount(0);
  const bar = page.locator('[data-ranking-navigation]');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveCount(1);
  await expect(bar.locator('a')).toHaveCount(3);
  await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
  await expect(bar.locator(`[data-ranking-destination="${active}"]`)).toHaveAttribute('aria-current', 'page');
  return bar.evaluate(node => {
    const box = node.getBoundingClientRect();
    return { top: Math.round(box.top + scrollY), height: Math.round(box.height), width: Math.round(box.width) };
  });
}

async function noHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
}

async function belowHeader(locator) {
  const geometry = await locator.evaluate(node => {
    const box = node.getBoundingClientRect();
    const header = document.querySelector('.suite-header').getBoundingClientRect();
    return { top: box.top, bottom: box.bottom, header: header.bottom, viewport: innerHeight };
  });
  expect(geometry.top, JSON.stringify(geometry)).toBeGreaterThanOrEqual(geometry.header - 1);
  expect(geometry.top, JSON.stringify(geometry)).toBeLessThan(geometry.viewport);
}

for (const language of ['de', 'en']) {
  for (const viewport of [{ width: 320, height: 640 }, { width: 1280, height: 800 }]) {
    test(`${language} ${viewport.width}px: Watten main menu, Spieler & Ranking and Konto keep one context through back, forward and reload`, async ({ browser, baseURL }, testInfo) => {
      const own = await player(browser, baseURL, language);
      const { page } = own;
      const ranking = language === 'de' ? 'Spieler & Ranking' : 'Players & Ranking';
      const account = language === 'de' ? 'Konto' : 'Account';
      try {
        await page.setViewportSize(viewport);
        await page.goto('/watten');
        await expect(await currentMainEntry(page)).toHaveAttribute('href', /^\/watten(\?lang=en)?$/);
        // Real main-menu click into Spieler & Ranking.
        await page.locator('.suite-header__nav a[href="/watten/rangliste"]').click();
        await expect(page).toHaveURL(/\/watten\/rangliste$/);
        await expect(await currentMainEntry(page)).toHaveText(ranking);
        const leaderboard = await areaBar(page, 'leaderboard');
        await expect(page.locator('[data-progress-scope=public]')).toBeVisible();
        await expect(page.locator('[data-progress-ranking]')).toBeVisible();
        await expect(page.locator('[data-progress-feed]')).toBeVisible();
        await noHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`ranking-${language}-${viewport.width}.png`) });

        await page.locator('[data-ranking-destination=progress]').click();
        await expect(page).toHaveURL(/\/watten\/konto\/fortschritt$/);
        await expect(await currentMainEntry(page)).toHaveText(ranking);
        const progress = await areaBar(page, 'progress');
        expect(progress).toEqual(leaderboard);
        await expect(page.locator('[data-progress-scope=private]')).toBeVisible();
        await expect(page.locator('.wt-progress-title')).toBeVisible();
        await expect(page.locator('.wt-achievement-collection')).toBeVisible();
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await noHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`progress-${language}-${viewport.width}.png`) });

        await page.locator('[data-ranking-destination=history]').click();
        await expect(page).toHaveURL(/\/watten\/konto\/verlauf$/);
        await expect(await currentMainEntry(page)).toHaveText(ranking);
        expect(await areaBar(page, 'history')).toEqual(leaderboard);
        await expect(page.locator('#statistics')).toBeVisible();
        await expect(page.locator('.wt-favorite-opponents')).toBeVisible();
        await expect(page.locator('.wt-progress-history')).toBeVisible();
        expect(await page.evaluate(() => scrollY)).toBe(0);
        await noHorizontalOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`history-${language}-${viewport.width}.png`) });

        await page.goBack();
        await expect(page).toHaveURL(/\/watten\/konto\/fortschritt$/);
        expect(await areaBar(page, 'progress')).toEqual(leaderboard);
        await page.goForward();
        await expect(page).toHaveURL(/\/watten\/konto\/verlauf$/);
        expect(await areaBar(page, 'history')).toEqual(leaderboard);
        await page.reload();
        expect(await areaBar(page, 'history')).toEqual(leaderboard);
        await expect(await currentMainEntry(page)).toHaveText(ranking);

        // Konto is the account settings; it links back to the player's values.
        await page.locator('.suite-header__nav [data-watten-account-link]').click();
        await expect(page).toHaveURL(/\/watten\/konto\/einstellungen$/);
        await expect(await currentMainEntry(page)).toHaveText(account);
        await expect(page.locator('[data-account-navigation] a')).toHaveCount(1);
        const links = page.locator('[data-watten-player-links]');
        await expect(links).toBeVisible();
        await noHorizontalOverflow(page);
        await links.locator('a[href="/watten/konto/fortschritt"]').click();
        await expect(page).toHaveURL(/\/watten\/konto\/fortschritt$/);
        await expect(await currentMainEntry(page)).toHaveText(ranking);
        await page.goBack();
        await expect(page).toHaveURL(/\/watten\/konto\/einstellungen$/);
        await expect(await currentMainEntry(page)).toHaveText(account);

        // Direct links: the collection and one achievement land visibly below
        // the sticky header; a single achievement is unfiltered, open and focused.
        await page.goto('/watten/konto/fortschritt#achievements');
        await belowHeader(page.locator('#achievements'));
        await page.goto('/watten/konto/fortschritt#watten_matches_1');
        await expect(page.locator('#watten_matches_1 details')).toHaveAttribute('open', '');
        await expect(page.locator('#watten_matches_1 summary')).toBeFocused();
        await belowHeader(page.locator('#watten_matches_1'));
        const before = await page.evaluate(() => scrollY);
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => scrollY)).toBe(before);
        // Former statistics links open the matching personal page.
        await page.goto('/watten/konto/fortschritt#statistics');
        await expect(page).toHaveURL(/\/watten\/konto\/verlauf#statistics$/);
        await expect(await currentMainEntry(page)).toHaveText(ranking);
        expect(own.traffic.errors).toEqual([]);
      } finally { await own.context.close(); }
    });
  }
}

test('signed-out Spieler & Ranking links return to the requested page after sign-in', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL, 'de');
  const { page, context, user } = own;
  try {
    await context.clearCookies();
    await page.goto('/watten/rangliste');
    await expect(page).toHaveURL(/\/watten\/anmelden\?return_to=%2Fwatten%2Frangliste$/);
    await expect(await currentMainEntry(page)).toHaveText('Konto');
    const form = page.locator('form[data-login]');
    await form.locator('[name=username]').fill(user.username);
    await form.locator('[name=password]').fill('watten-test-password-123-final');
    await form.locator('button[type=submit], button:not([type])').first().click();
    await expect(page).toHaveURL(/\/watten\/rangliste$/);
    await expect(await currentMainEntry(page)).toHaveText('Spieler & Ranking');
    await areaBar(page, 'leaderboard');
  } finally { await context.close(); }
});

test('Zilch history belongs to Konto and public award profiles to Spieler & Ranking', async ({ page }) => {
  const admin = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(admin.ok()).toBeTruthy();
  const headers = { 'X-CSRF-Token': (await admin.json()).user.csrf_token };
  for (const username of ['Mani', 'FinderFreshFriend']) {
    const created = await page.request.post('/api/admin/users', {
      headers, data: { username, temporary_password: 'mani-preview-password-123', role: username === 'Mani' ? 'admin' : 'user' },
    });
    expect([201, 400]).toContain(created.status());
  }
  expect((await page.request.post('/api/auth/login', { data: { username: 'Mani', password: 'mani-preview-password-123' } })).ok()).toBeTruthy();
  for (const [path, entry] of [['/zilch/historie', '/zilch/konto'], ['/zilch/spieler/FinderFreshFriend', '/zilch/bestenlisten'], ['/zilch/bestenlisten', '/zilch/bestenlisten']]) {
    // An established account; a required password change would take focus first.
    await page.route('**/api/auth/me', async route => {
      const response = await route.fetch();
      const auth = await response.json();
      await route.fulfill({ response, json: { ...auth, user: { ...auth.user, must_change_password: false } } });
    });
    try {
      await page.goto(path);
      await expect(await currentMainEntry(page)).toHaveAttribute('href', entry);
    } finally {
      // Finish page-owned response handlers before the next navigation or
      // fixture teardown disposes their API responses.
      await page.unrouteAll({ behavior: 'wait' });
    }
  }
});

// The private founder preview has no native Watten settings: its Konto entry
// opens the shared account's settings, which must lead back to Watten.
for (const language of ['de', 'en']) {
  test(`${language}: the shared account settings link back to Watten progress`, async ({ browser, baseURL }) => {
    const own = await player(browser, baseURL, language);
    const { page } = own;
    try {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.goto('/konto#settings');
      await expect(page.locator('#settingsTab')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#settingsPanel')).toBeVisible();
      const links = page.locator('#accountWattenLinks');
      await expect(links).toBeVisible();
      await expect(links.locator('h3')).toHaveText(language === 'de' ? 'Watten: Deine Spielwerte' : 'Watten: your game progress');
      await expect(links.locator('a')).toHaveText(language === 'de' ? ['Erfolge & Titel', 'Deine Partien'] : ['Achievements & titles', 'Your matches']);
      await noHorizontalOverflow(page);
      await links.locator('a[href="/watten/konto/verlauf"]').click();
      await expect(page).toHaveURL(/\/watten\/konto\/verlauf$/);
      await expect(await currentMainEntry(page)).toHaveAttribute('href', '/watten/rangliste');
      await areaBar(page, 'history');
      await page.goBack();
      await expect(page.locator('#settingsPanel')).toBeVisible();
      expect(own.traffic.errors).toEqual([]);
    } finally { await own.context.close(); }
  });
}
