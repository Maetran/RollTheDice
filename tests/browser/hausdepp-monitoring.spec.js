const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function monitoring(page, { founder = true, language = 'de', design = 'mission' } = {}) {
  await page.addInitScript(({ language, design }) => {
    localStorage.setItem('zdwa_language', language);
    localStorage.setItem('rollthedice:dashboard:design', design);
  }, { language, design });
  const state = { founder, calls: [] };
  // Explicit representative aggregate projection for UI QA. Real authorization,
  // hidden totals and event persistence are checked in test_hausdepp_monitoring.py.
  await page.route('**/admin/dashboard', async route => route.fulfill({ contentType: 'text/html', body: await readFile('app/static/dashboard.html', 'utf8') }));
  await page.route('**/api/auth/me', route => route.fulfill({ json: { authenticated: true, user: {
    id: 7, username: 'Monitoring fixture', is_admin: state.founder, is_founder: state.founder,
    can_view_analytics: true, analytics_access: true, preferences: { preferred_language: language },
  } } }));
  await page.route('**/api/admin/analytics?*', route => {
    const game = new URL(route.request().url()).searchParams.get('game') || 'all';
    state.calls.push(game);
    if (game === 'hausdepp' && !state.founder) return route.fulfill({ status: 403, json: { detail: 'analytics_game_unavailable' } });
    const products = state.founder ? ['zdwa', 'zilch', 'hausdepp'] : ['zdwa', 'zilch'];
    const rows = products.filter(product => game === 'all' || game === product).map(product => ({
      game: product, completed_games: product === 'hausdepp' ? 9 : 4, participants: 27,
      avg_duration_seconds: product === 'hausdepp' ? null : 90, duration_sample_count: 0,
      abandoned_games: 2, completed_tournaments: product === 'hausdepp' ? 1 : null,
      live: { active_tables: 3, connected_humans: 2, cpu_seats: 4, active_tournaments: 2, interround_tables: 1 },
    }));
    return route.fulfill({ json: {
      generated_at: '2026-10-16T12:00:00Z', period: { game, days: 7 }, available_games: products,
      collection: { first_seen_at: null, retention_days: 90 },
      overview: { completed_games: rows.reduce((sum, row) => sum + row.completed_games, 0),
        sessions: 0, page_views: 0, live_sessions: 0, active_seconds: 0, avg_active_seconds: 0 },
      games: rows, daily: [], hourly: [], pages: [], geography: [], devices: [], heatmap: [],
      journeys: { links: [], sample: { page_views: 0, total_page_views: 0 } },
      design_usage: { looks: [] }, server: { active_rooms: 3, players_online: 2, cpu: {}, memory: {}, disk: {} },
    } });
  });
  await page.goto('/admin/dashboard');
  await expect(page.locator('#connectionLabel')).toHaveText(language === 'en' ? 'Telemetry connected' : 'Telemetrie verbunden');
  return state;
}

for (const design of ['mission', 'lcars', 'nexus']) {
  test(`founder Hausdepp aggregate card and filter work in ${design}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await monitoring(page, { design, language: 'en' });
    await expect(page.locator('#dashboardGame option[value="hausdepp"]')).toHaveCount(1);
    await expect(page.locator('#gameCards [data-game="hausdepp"]')).toContainText('Rounds completed');
    await page.locator('#dashboardGame').selectOption('hausdepp');
    const card = page.locator('#gameCards [data-game="hausdepp"]');
    await expect(page.locator('#gameCards .game-card')).toHaveCount(1);
    await expect(card.locator('.game-card-number')).toHaveText('9');
    for (const label of ['Live tables', 'Humans connected', 'Computer seats', 'Active tournaments', 'Between rounds', 'Tournaments completed', 'Recorded abandonments']) await expect(card).toContainText(label);
    await expect(card.locator('.game-card-details span').filter({ hasText: 'Avg. round duration' }).locator('strong')).toHaveText('—');
    await expect(page.locator('#hausdeppMonitoringNote')).toContainText('earlier abandonments are not backfilled');
    await expect(page.locator('[data-favorite-id="metric-sessions"] .metric-value')).toHaveText('—');
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', design);
    const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.scroll).toBeLessThanOrEqual(width.viewport);
    expect(errors).toEqual([]);
  });
}

test('German founder copy explains unknown historical data', async ({ page }) => {
  await monitoring(page);
  await page.locator('#dashboardGame').selectOption('hausdepp');
  await expect(page.locator('#gameCards')).toContainText('Rundenpausen');
  await expect(page.locator('#hausdeppMonitoringNote')).toContainText('ältere Abbrüche werden nicht nachgetragen');
});

test('delegated analytics access receives no Hausdepp option or card', async ({ page }) => {
  await monitoring(page, { founder: false });
  await expect(page.locator('#dashboardGame option[value="hausdepp"]')).toHaveCount(0);
  await expect(page.locator('#gameCards [data-game="hausdepp"]')).toHaveCount(0);
  await expect(page.locator('#hausdeppMonitoringNote')).toBeHidden();
});

test('a refreshed audience removes cached private cards and filter options', async ({ page }) => {
  const state = await monitoring(page);
  await expect(page.locator('#gameCards [data-game="hausdepp"]')).toHaveCount(1);
  state.founder = false;
  await page.locator('#dashboardRefresh').click();
  await expect(page.locator('#gameCards [data-game="hausdepp"]')).toHaveCount(0);
  await expect(page.locator('#dashboardGame option[value="hausdepp"]')).toHaveCount(0);
  await expect(page.locator('#hausdeppMonitoringNote')).toHaveText('');
});
