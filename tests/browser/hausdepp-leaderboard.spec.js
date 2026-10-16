const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function owner(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.hausdeppLeaderboardOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
}

test.afterEach(async ({ page }) => {
  const saved = page.hausdeppLeaderboardOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', { headers: saved.headers, data: { preferred_language: saved.language } });
});

// Explicit renderer-only leaderboard data: no test writes wins, identities or
// progress into the running private account database.
const labelledLeaderboard = {
  schema_version: 1, game_type: 'hausdepp', ranking: 'finished_rounds', players: null, total_players: 3,
  win_definition: {
    de: 'Jede abgeschlossene Runde, in der du alle Karten loswirst, zählt als Sieg.',
    en: 'Every completed round in which you finish all your cards counts as a win.',
  },
  entries: [
    { place: 1, display_name: 'Admin', wins: 12, rounds_played: 20, win_rate: 60, is_self: true },
    { place: 1, display_name: '<Stammtischfreundin mit einem langen Namen>', wins: 12, rounds_played: 24, win_rate: 50, is_self: false },
    { place: 3, display_name: 'Labelled renderer player', wins: 7, rounds_played: 13, win_rate: 53.8, is_self: false },
  ],
};

for (const language of ['de', 'en']) {
  test(`${language}: real private leaderboard is linked from the lobby and account`, async ({ page }) => {
    await owner(page, language);
    await page.goto('/hausdepp');
    await page.locator('.hd-nav a[href="/hausdepp/rangliste"]').click();
    await expect(page).toHaveURL(/\/hausdepp\/rangliste$/);
    await expect(page.locator('main[data-page="leaderboard"]')).toBeVisible();
    await expect(page.locator('#hausdeppLeaderboardSize')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    const response = await page.request.get('/api/hausdepp/leaderboard?limit=50');
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-store');
    expect((await response.json()).ranking).toBe('finished_rounds');
    await page.locator('a[href="/hausdepp/konto"]').last().click();
    await page.locator('.hd-account-shortcuts a[href="/hausdepp/rangliste"]').click();
    await expect(page).toHaveURL(/\/hausdepp\/rangliste$/);
  });

  test(`${language}: labelled leaderboard preserves shared places, escaped names and table-size filters`, async ({ page }) => {
    await owner(page, language);
    const requests = [];
    await page.route('**/api/hausdepp/leaderboard?**', route => {
      const query = new URL(route.request().url()).searchParams;
      requests.push(query.get('players'));
      const data = structuredClone(labelledLeaderboard);
      data.players = query.has('players') ? Number(query.get('players')) : null;
      if (data.players === 2) { data.entries = [data.entries[0]]; data.total_players = 1; }
      return route.fulfill({ json: data });
    });
    await page.goto('/hausdepp/rangliste');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.hd-leaderboard-place')).toHaveText(['1.', '1.', '3.']);
    await expect(page.locator('.hd-leaderboard-name').nth(1)).toHaveText('<Stammtischfreundin mit einem langen Namen>');
    await expect(page.locator('.hd-leaderboard-table script, .hd-leaderboard-table Stammtischfreundin')).toHaveCount(0);
    await expect(page.locator('.is-self .hd-self-tag')).toHaveText(language === 'de' ? 'Du' : 'You');
    await expect(page.locator('#hausdeppLeaderboardScoring')).toContainText(language === 'de' ? 'Karten loswirst' : 'finish all your cards');
    await page.locator('#hausdeppLeaderboardSize').selectOption('2');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(1);
    expect(requests).toEqual([null, '2']);
    await page.locator('#hausdeppLeaderboardSize').selectOption('6');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(3);
    expect(requests.at(-1)).toBe('6');
  });
}

test('leaderboard load errors offer a visible retry and an honest empty state', async ({ page }) => {
  await owner(page);
  let attempts = 0;
  await page.route('**/api/hausdepp/leaderboard?**', route => {
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 503, json: { detail: 'labelled-renderer-failure' } } : { json: { ...labelledLeaderboard, entries: [], total_players: 0 } });
  });
  await page.goto('/hausdepp/rangliste');
  await expect(page.locator('#hausdeppLeaderboardError')).toBeVisible();
  await page.locator('#hausdeppLeaderboardRetry').click();
  await expect(page.locator('#hausdeppLeaderboardRows')).toContainText('Dieser Zettel ist noch leer.');
  await expect(page.locator('#hausdeppLeaderboardError')).toBeHidden();
});

test('capture labelled leaderboard across portrait and landscape', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_ACHIEVEMENTS_CAPTURE !== '1', 'One explicit responsive evidence batch.');
  await owner(page);
  await page.route('**/api/hausdepp/leaderboard?**', route => route.fulfill({ json: labelledLeaderboard }));
  await mkdir('.impeccable/review', { recursive: true });
  for (const [name, width, height] of [['phone-portrait', 390, 844], ['phone-landscape', 844, 390], ['narrow-phone', 320, 568], ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768], ['desktop-landscape', 1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.goto('/hausdepp/rangliste');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(3);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await page.locator('#hausdeppLeaderboardSize').boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: `.impeccable/review/hausdepp-leaderboard-labelled-${name}.png`, fullPage: true });
  }
});
