const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const leaderboard = {
  stats: {
    games_played: 42,
    average_points: {
      normal: { average_points: 543.5, recent_average_points: 560, trend: 'up', trend_games: 3 },
      hc: { average_points: 321, recent_average_points: 300, trend: 'down', trend_games: 3 },
    },
  },
};

for (const language of ['de', 'en']) {
  for (const design of ['old', '2026']) {
    test(`ZDWA community statistics live under Players & Ranking (${language}, ${design})`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 375, height: 812 });
      await page.addInitScript(({ language, design }) => {
        localStorage.setItem('zdwa_language', language);
        localStorage.setItem('zdwa_design', design);
      }, { language, design });
      await page.route('**/api/games', route => route.fulfill({ json: { games: [], online_users: 3 } }));
      await page.route('**/api/leaderboard', route => route.fulfill({ json: leaderboard }));
      await page.goto('/');
      await expect(page.locator('#onlineUsers, #gamesPlayed')).toHaveCount(0);
      await expect(page.locator('#recentTable tbody tr').first()).toContainText(language === 'en' ? 'No entries' : 'Keine Einträge');
      await page.locator('.app-nav-link[href="/spieler"]').click();
      const stats = page.locator('.community-stats');
      await expect(stats.getByRole('heading')).toHaveText(language === 'en' ? 'Community statistics' : 'Community-Statistik');
      await expect(stats.locator('#onlineUsers')).toHaveText('3');
      await expect(stats.locator('#gamesPlayed')).toHaveText('42');
      await expect(stats.locator('#avgNormalPoints')).toHaveText('543.5');
      await expect(stats.locator('#avgHardcorePoints')).toHaveText('321');
      await expect(stats.locator('#avgNormalTrend')).toHaveAttribute('aria-label', language === 'en'
        ? 'Positive trend (avg. last 3: 560)' : 'Trend positiv (Ø letzte 3: 560)');
      await expect(stats.locator('#avgHardcoreTrend')).toHaveClass(/avg-down/);
      const layout = await stats.evaluate(element => ({ right: element.getBoundingClientRect().right, scroll: document.documentElement.scrollWidth }));
      expect(layout.right).toBeLessThanOrEqual(375);
      expect(layout.scroll).toBeLessThanOrEqual(375);
      expect(errors).toEqual([]);
    });
  }
}

test('community statistics refresh independently and clear unavailable values', async ({ page }) => {
  await page.clock.install();
  let failed = false;
  await page.route('**/api/games', route => route.fulfill({ json: { games: [], online_users: failed ? 5 : 3 } }));
  await page.route('**/api/leaderboard', route => failed
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: leaderboard }));
  await page.goto('/spieler');
  await expect(page.locator('#gamesPlayed')).toHaveText('42');
  await expect(page.locator('#onlineUsers')).toHaveText('3');
  failed = true;
  await page.clock.fastForward(10_100);
  await expect(page.locator('#onlineUsers')).toHaveText('5');
  await expect(page.locator('#gamesPlayed')).toHaveText('—');
  await expect(page.locator('#avgNormalPoints')).toHaveText('—');
  await expect(page.locator('#avgHardcorePoints')).toHaveText('—');
  await expect(page.locator('#avgNormalTrend')).toHaveAttribute('aria-label', 'Zu wenig Daten');
});
