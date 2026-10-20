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
    { place: 1, display_name: 'Admin', wins: 12, rounds_played: 20, win_rate: 60, is_self: true, rank: { id: 'rank_02', name: { de: 'Bohr', en: 'Bohr' }, level: 2 } },
    { place: 1, display_name: '<Stammtischfreundin mit einem langen Namen>', wins: 12, rounds_played: 24, win_rate: 50, is_self: false, rank: { id: 'rank_03', name: { de: 'Newton', en: 'Newton' }, level: 3 } },
    { place: 3, display_name: 'Labelled renderer player', wins: 7, rounds_played: 13, win_rate: 53.8, is_self: false, rank: { id: 'rank_01', name: { de: 'Einstein', en: 'Einstein' }, level: 1 } },
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
    await expect(page.locator('.hd-leaderboard-name').nth(1)).toContainText('<Stammtischfreundin mit einem langen Namen>');
    await expect(page.locator('[data-player-rank]')).toHaveText(['Bohr', 'Newton', 'Einstein'].map(name => `${language === 'de' ? 'Aktueller Rang' : 'Current rank'}: ${name}`));
    await expect(page.locator('.hd-leaderboard-table script, .hd-leaderboard-table Stammtischfreundin')).toHaveCount(0);
    await expect(page.locator('.hd-leaderboard-table .is-self .hd-self-tag')).toHaveText(language === 'de' ? 'Du' : 'You');
    await expect(page.locator('#hausdeppLeaderboardScoring')).toContainText(language === 'de' ? 'Karten loswirst' : 'finish all your cards');
    await page.locator('#hausdeppLeaderboardSize').selectOption('2');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(1);
    expect(requests).toEqual([null, '2']);
    await page.locator('#hausdeppLeaderboardSize').selectOption('6');
    await expect(page.locator('.hd-leaderboard-table tbody tr')).toHaveCount(3);
    expect(requests.at(-1)).toBe('6');
    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await expect(page.locator('[data-player-rank=rank_03]')).toBeVisible();
    }
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

// Renderer-only feed data: the API returns account names, never IDs or rounds.
function labelledFeed(page = 1, difficulty = null) {
  const pool = [
    { unlocked_at: '2026-10-16T12:05:00+00:00', player: { display_name: '<Stammtischfreundin>', is_self: false },
      achievement: { id: 'hausdepp_32', name: { de: 'Zehn Gebote', en: 'Ten commandments' }, description: { de: 'In einer Runde alle vier Zehner selbst spielen.', en: 'Personally play all four tens in one round.' }, category: 'tens', points: 100, difficulty: 'hard' } },
    { unlocked_at: '2026-10-16T12:00:00+00:00', player: { display_name: 'Admin', is_self: true },
      achievement: { id: 'hausdepp_01', name: { de: 'Stuhl her!', en: 'Pull up a chair!' }, description: { de: 'Deine erste Runde abschliessen.', en: 'Complete your first round.' }, category: 'participation', points: 10, difficulty: 'easy' } },
  ];
  const items = difficulty ? pool.filter(item => item.achievement.difficulty === difficulty) : pool;
  const pages = difficulty ? 1 : 2;
  return { items: page === 1 ? items : [pool[1]], page, page_size: 20, total: difficulty ? items.length : 21, pages, has_previous: page > 1, has_next: page < pages, difficulty };
}

for (const language of ['de', 'en']) {
  test(`${language}: latest achievements feed lists escaped names, filters and pages`, async ({ page }) => {
    await owner(page, language);
    await page.route('**/api/hausdepp/leaderboard?**', route => route.fulfill({ json: labelledLeaderboard }));
    const requests = [];
    await page.route('**/api/hausdepp/achievements/recent?**', route => {
      const query = new URL(route.request().url()).searchParams;
      requests.push(query.toString());
      return route.fulfill({ json: labelledFeed(Number(query.get('page')), query.get('difficulty')) });
    });
    await page.goto('/hausdepp/rangliste');
    const feed = page.locator('#hausdeppAchievementFeed');
    await expect(feed.locator('h2')).toHaveText(language === 'de' ? 'Neueste erreichte Erfolge' : 'Latest achievements earned');
    await expect(feed.locator('[data-feed-item]')).toHaveCount(2);
    await expect(feed.locator('.hd-feed-player').first()).toHaveText('<Stammtischfreundin>');
    await expect(feed.locator('h3').first()).toHaveText(language === 'de' ? 'Zehn Gebote' : 'Ten commandments');
    await expect(feed.locator('.hd-feed-difficulty').first()).toHaveText(language === 'de' ? 'Schwer' : 'Hard');
    await expect(feed.locator('.is-self .hd-self-tag')).toHaveText(language === 'de' ? 'Du' : 'You');
    await expect(feed.locator('a')).toHaveCount(0);
    await expect(page.locator('#hausdeppFeedStatus')).toHaveText(language === 'de' ? '21 Freischaltungen' : '21 unlocks');
    await expect(page.locator('#hausdeppFeedPage')).toHaveText(language === 'de' ? 'Seite 1 von 2' : 'Page 1 of 2');
    await expect(page.locator('#hausdeppFeedPrevious')).toBeDisabled();
    await page.locator('#hausdeppFeedNext').click();
    await expect(feed.locator('[data-feed-item]')).toHaveCount(1);
    await expect(page.locator('#hausdeppFeedNext')).toBeDisabled();
    await expect(feed.locator('h2')).toBeFocused();
    await feed.locator('[data-feed-difficulty="easy"]').click();
    await expect(feed.locator('[data-feed-difficulty="easy"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(feed.locator('[data-feed-item]')).toHaveCount(1);
    await expect(feed.locator('[data-feed-item-difficulty="easy"]')).toHaveCount(1);
    await expect(page.locator('#hausdeppFeedPagination')).toBeHidden();
    await feed.locator('[data-feed-difficulty="easy"]').click();
    await expect(feed.locator('[data-feed-difficulty="easy"]')).toHaveAttribute('aria-pressed', 'false');
    expect(requests).toEqual(['page=1', 'page=2', 'page=1&difficulty=easy', 'page=1']);
    for (const width of [320, 390, 1024]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      expect((await feed.locator('[data-feed-difficulty="hard"]').boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
  });
}

test('real latest achievements API answers the signed-in leaderboard', async ({ page }) => {
  await owner(page);
  await page.goto('/hausdepp/rangliste');
  const response = await page.request.get('/api/hausdepp/achievements/recent?page=1');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const data = await response.json();
  expect(Array.isArray(data.items)).toBe(true);
  for (const item of data.items) expect(Object.keys(item.player).sort()).toEqual(['display_name', 'is_self']);
  await expect(page.locator('#hausdeppFeedStatus, #hausdeppFeedList')).not.toHaveCount(0);
  await expect(page.locator('#hausdeppFeedList')).not.toHaveAttribute('aria-busy', 'true');
});

test('latest achievements feed errors offer a retry and an honest empty state', async ({ page }) => {
  await owner(page);
  await page.route('**/api/hausdepp/leaderboard?**', route => route.fulfill({ json: labelledLeaderboard }));
  let attempts = 0;
  await page.route('**/api/hausdepp/achievements/recent?**', route => {
    attempts += 1;
    return route.fulfill(attempts === 1 ? { status: 503, json: { detail: 'labelled-renderer-failure' } } : { json: { items: [], page: 1, page_size: 20, total: 0, pages: 0, has_previous: false, has_next: false, difficulty: null } });
  });
  await page.goto('/hausdepp/rangliste');
  await expect(page.locator('#hausdeppFeedError')).toBeVisible();
  await page.locator('#hausdeppFeedRetry').click();
  await expect(page.locator('#hausdeppFeedList')).toContainText('Noch keine passenden Erfolge.');
  await expect(page.locator('#hausdeppFeedError')).toBeHidden();
  await expect(page.locator('#hausdeppFeedPagination')).toBeHidden();
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
