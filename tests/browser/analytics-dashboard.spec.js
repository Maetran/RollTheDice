const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

function sampleAnalytics(game = 'all', days = 7) {
  const daily = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-0${index + 1}`, sessions: [9, 14, 11, 26, 19, 32, 24][index], page_views: [21, 40, 27, 70, 52, 83, 61][index], active_seconds: 800 + index * 370, completed_games: 2 + index }));
  return {
    generated_at: '2026-10-07T14:35:00Z', period: { days, game, from: '2026-10-01T00:00:00Z', to: '2026-10-07T14:35:00Z' },
    collection: { first_seen_at: '2026-09-18T10:00:00Z', retention_days: 90, session_scope: 'anonymous_tab', country_source: 'cloudflare_verified_peer', queued: 0, dropped: 0, stored_events: 4200, event_cap: 200000, cap_reached: false },
    overview: { sessions: 135, page_views: 354, active_seconds: 13370, avg_active_seconds: 99, live_sessions: 4, completed_games: 35, game_clicks: 1270 }, daily,
    pages: [{ page: '/spiel', game: 'zdwa', views: 135, sessions: 44, active_seconds: 9140, avg_active_seconds: 208 }, { page: '/zilch/spiel', game: 'zilch', views: 97, sessions: 31, active_seconds: 7430, avg_active_seconds: 240 }, { page: '/', game: 'zdwa', views: 82, sessions: 63, active_seconds: 2300, avg_active_seconds: 37 }, { page: '/zilch', game: 'zilch', views: 40, sessions: 28, active_seconds: 740, avg_active_seconds: 26 }],
    referrers: [{ source: 'direct', sessions: 70 }, { source: 'google.ch', sessions: 38 }, { source: 'internal', sessions: 18 }, { source: 'duckduckgo.com', sessions: 9 }],
    devices: [{ device: 'mobile', sessions: 76 }, { device: 'desktop', sessions: 42 }, { device: 'tablet', sessions: 17 }], countries: [{ country: 'CH', sessions: 82 }, { country: 'DE', sessions: 28 }, { country: 'ZZ', sessions: 9 }, { country: 'US', sessions: 8 }, { country: 'GB', sessions: 5 }, { country: 'FR', sessions: 3 }],
    geography: [{ country: 'CH', sessions: 82, page_views: 210, active_seconds: 8000, games: { zdwa: 57, zilch: 35 }, share_percent: 60.7 }, { country: 'DE', sessions: 28, page_views: 73, active_seconds: 2800, games: { zdwa: 18, zilch: 13 }, share_percent: 20.7 }, { country: 'US', sessions: 8, page_views: 25, active_seconds: 1000, games: { zdwa: 6, zilch: 3 }, share_percent: 5.9 }, { country: 'GB', sessions: 5, page_views: 17, active_seconds: 650, games: { zdwa: 2, zilch: 4 }, share_percent: 3.7 }, { country: 'FR', sessions: 3, page_views: 10, active_seconds: 320, games: { zdwa: 2, zilch: 1 }, share_percent: 2.2 }, { country: 'ZZ', sessions: 9, page_views: 19, active_seconds: 600, games: { zdwa: 6, zilch: 4 }, share_percent: 6.7 }],
    geography_summary: { sessions: 135, known_sessions: 126, unknown_sessions: 9, known_countries: 5 },
    heatmap: Array.from({ length: 168 }, (_, index) => { const weekday = Math.floor(index / 24); const hour = index % 24; const active = Math.max(0, Math.round((Math.sin((hour - 9) * .32) + 1) * (weekday > 4 ? 3 : 2))); return { weekday, hour, page_views: active, sessions: Math.floor(active * .6), active_seconds: active * 53 }; }),
    journeys: { links: [{ from: '/', to: '/spiel', from_game: 'zdwa', to_game: 'zdwa', count: 29 }, { from: '/spiel', to: '/ergebnis', from_game: 'zdwa', to_game: 'zdwa', count: 21 }, { from: '/zilch', to: '/zilch/spiel', from_game: 'zilch', to_game: 'zilch', count: 16 }, { from: '/regeln', to: '/', from_game: 'zdwa', to_game: 'zdwa', count: 8 }, { from: '/ergebnis', to: '/spiel', from_game: 'zdwa', to_game: 'zdwa', count: 7 }, { from: '/', to: '/zilch', from_game: 'zdwa', to_game: 'zilch', count: 5 }], sample: { limit: 10000, page_views: 140, matching_page_views: 140, total_page_views: 354, truncated: true, method: 'latest_page_views', gap_limit_seconds: 1800, game_filter_applied: 'both_endpoints' } },
    comparison: { previous_period: { days, from: '2026-09-24T00:00:00Z', to: '2026-10-01T00:00:00Z' }, current_partial_day: true, previous_partial_day: false, previous_data_coverage: 'complete', coverage_basis: 'earliest_retained_event', overview: Object.fromEntries([['sessions', 135, 110], ['page_views', 354, 290], ['active_seconds', 13370, 10800], ['avg_active_seconds', 99, 98], ['completed_games', 35, 27]].map(([key, current, previous]) => [key, { current, previous, delta: current - previous, change_percent: (current - previous) / previous * 100 }])) },
    actions: [{ action: 'roll_dice', game: 'zdwa', count: 725 }, { action: 'roll_dice', game: 'zilch', count: 300 }, { action: 'score', game: 'zdwa', count: 169 }, { action: 'bank', game: 'zilch', count: 48 }, { action: 'create_game', game: 'zdwa', count: 19 }, { action: 'game_created', game: 'zdwa', count: 15, source: 'server' }, { action: 'open_rules', game: 'zdwa', count: 9 }],
    games: [{ game: 'zdwa', completed_games: 23, participants: 41, avg_duration_seconds: 732 }, { game: 'zilch', completed_games: 12, participants: 20, avg_duration_seconds: 490 }], modes: [{ game: 'zdwa', mode: '1', completed_games: 12 }, { game: 'zdwa', mode: '2', completed_games: 11 }, { game: 'zilch', mode: 'cpu', completed_games: 12 }],
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, page_views: Math.max(0, Math.round(18 + Math.sin(hour * .34 - 3) * 18)), active_seconds: hour * 80 })),
    server: { cpu: { percent: 14.3, cores: 4, load1: .42, load5: .36, load15: .27, scope: 'host' }, memory: { used_bytes: 1740000000, total_bytes: 4294967296, percent: 40.5, scope: 'host' }, disk: { used_bytes: 13100000000, total_bytes: 42000000000, free_bytes: 28900000000, percent: 31.2, scope: 'data_filesystem' }, host_uptime_seconds: 1219985, app_uptime_seconds: 75694, process_memory_bytes: 115000000, active_rooms: 2, players_online: 5, measurement_at: '2026-10-07T14:35:00Z' },
  };
}

async function mockedDashboard(page, language) {
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  const state = { calls: [], fail: false, empty: false, permitted: true, authCalls: 0, coverage: 'complete', unknownOnly: false, cpuUnavailable: false };
  // This fixture supplies representative telemetry for visual/interaction QA.
  // Authorization is separately tested below against the real backend.
  await page.route('**/admin/dashboard', async route => route.fulfill({ contentType: 'text/html', body: await readFile('app/static/dashboard.html', 'utf8') }));
  await page.route('**/api/auth/me', route => {
    state.authCalls += 1;
    return route.fulfill({ json: { authenticated: true, user: { id: 7, username: 'GrantedViewer', is_founder: false, is_admin: false, can_view_analytics: state.permitted, analytics_access: state.permitted, preferences: { preferred_language: language } } } });
  });
  await page.route('**/api/admin/analytics?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const game = query.get('game');
    const days = Number(query.get('days'));
    state.calls.push({ game, days });
    if (state.fail) return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
    const data = sampleAnalytics(game, days);
    data.generated_at = new Date(Date.parse(data.generated_at) + (state.calls.length - 1) * 30000).toISOString();
    data.server.measurement_at = data.generated_at;
    data.comparison.previous_data_coverage = state.coverage;
    if (state.cpuUnavailable) data.server.cpu.percent = null;
    if (state.unknownOnly) {
      data.countries = [{ country: 'ZZ', sessions: 135 }];
      data.geography = [{ country: 'ZZ', sessions: 135, page_views: 354, active_seconds: 13370, games: { zdwa: 90, zilch: 55 }, share_percent: 100 }];
      data.geography_summary = { sessions: 135, known_sessions: 0, unknown_sessions: 135, known_countries: 0 };
    }
    if (state.empty) {
      Object.assign(data.overview, { sessions: 0, page_views: 0, active_seconds: 0, avg_active_seconds: 0, live_sessions: 0 });
      for (const key of ['daily', 'pages', 'referrers', 'devices', 'countries', 'actions', 'hourly', 'geography', 'heatmap']) data[key] = [];
      data.journeys.links = [];
      data.journeys.sample = { page_views: 0, total_page_views: 0, truncated: false };
      data.collection.first_seen_at = null;
      data.collection.country_source = 'unavailable';
      data.server.cpu.percent = null;
      data.server.host_uptime_seconds = null;
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/admin/dashboard');
  await expect(page.locator('#connectionLabel')).toHaveText(language === 'en' ? 'Telemetry connected' : 'Telemetrie verbunden');
  return state;
}

for (const language of ['de', 'en']) {
  test(`${language}: mocked analytics charts are readable on mobile, tablet and desktop`, async ({ page }, testInfo) => {
    const state = await mockedDashboard(page, language);
    await expect(page.locator('label[for="dashboardGame"]')).toHaveText(language === 'en' ? 'Game filter' : 'Spiel filtern');
    await expect(page.locator('#overviewMetrics')).toContainText('135');
    await expect(page.locator('#dailyChart svg')).toHaveAttribute('role', 'img');
    await expect(page.locator('#referrerRanks')).toContainText('google.ch');
    await expect(page.locator('#countryRanks')).toContainText(language === 'en' ? 'Switzerland' : 'Schweiz');
    await expect(page.locator('#countryRanks')).toContainText(language === 'en' ? 'Unknown' : 'Unbekannt');
    await expect(page.locator('#actionRanks')).toContainText(language === 'en' ? 'Roll' : 'Würfeln');
    await expect(page.locator('#gameCards')).toContainText('23');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1080 : 1000 });
      const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, controls: [...document.querySelectorAll('a,button,select,summary')].filter(item => item.checkVisibility()).map(item => { const box = item.getBoundingClientRect(); return { text: item.textContent, left: box.left, right: box.right, height: box.height }; }) }));
      expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
      for (const item of geometry.controls) {
        expect(item.left, JSON.stringify(item)).toBeGreaterThanOrEqual(-1);
        expect(item.right, JSON.stringify(item)).toBeLessThanOrEqual(width + 1);
        expect(item.height, JSON.stringify(item)).toBeGreaterThanOrEqual(40);
      }
      await page.screenshot({ path: `/tmp/rtd-dashboard-${language}-${width}.png`, fullPage: true });
      await testInfo.attach(`mocked-telemetry-${language}-${width}`, { path: `/tmp/rtd-dashboard-${language}-${width}.png`, contentType: 'image/png' });
    }
    await page.locator('#dashboardDays').selectOption('30');
    await page.locator('#dashboardGame').selectOption('zilch');
    await expect.poll(() => state.calls.at(-1)).toEqual({ game: 'zilch', days: 30 });
    await expect(page.locator('#gameCards .game-card')).toHaveCount(1);
    await expect(page.locator('#gameCards')).toContainText('Zilch');
    await page.locator('#dailyTable').locator('..').locator('summary').click();
    await expect(page.locator('#dailyTable table')).toBeVisible();
    await expect(page.locator('#dailyTable table tbody tr')).toHaveCount(7);
    await page.locator('a[href="#server"]').focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#server$/);
    await expect(page.locator('#serverTitle')).toBeInViewport();
  });

  test(`${language}: failed refresh keeps previous values, retry and honest empty states work`, async ({ page }) => {
    const state = await mockedDashboard(page, language);
    state.fail = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#dashboardMessage')).toBeVisible();
    await expect(page.locator('#dashboardMessage')).toContainText(language === 'en' ? 'last measurements remain visible' : 'letzten Messwerte bleiben sichtbar');
    await expect(page.locator('#overviewMetrics')).toContainText('135');
    state.fail = false;
    await page.locator('#dashboardRetry').click();
    await expect(page.locator('#dashboardMessage')).toBeHidden();
    state.empty = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#dailyChart')).toContainText(language === 'en' ? 'No measurements yet' : 'Noch keine Messwerte');
    await expect(page.locator('#gameCards')).toContainText('23');
    await expect(page.locator('#countryNote')).toContainText(language === 'en' ? 'no IP geolocation' : 'keine IP-Geolokalisierung');
    await expect(page.locator('#serverGauges .gauge-number').first()).toHaveText('—');
    await page.screenshot({ path: `/tmp/rtd-dashboard-empty-${language}.png`, fullPage: true });
  });
}

test('real founder grants a regular account access through user management; owner status does not grant access', async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  let founder;
  let viewerId;
  let csrf;
  let originalLanguage;
  try {
    [founder] = await Promise.all(contexts.slice(0, 1).map(context => context.newPage()));
    const viewer = await contexts[1].newPage();
    const owner = await contexts[2].newPage();
    const login = await founder.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
    expect(login.ok()).toBeTruthy();
    const root = (await login.json()).user;
    csrf = root.csrf_token;
    originalLanguage = root.preferences?.preferred_language || 'de';
    expect(root).toMatchObject({ is_founder: true, can_view_analytics: true });
    const timestamp = Date.now().toString().slice(-10);
    const viewerName = `DashboardViewer${timestamp}`;
    const ownerName = `DashboardOwner${timestamp}`;
    const password = 'dashboard-browser-password-123';
    for (const [page, username, role] of [[viewer, viewerName, 'user'], [owner, ownerName, 'admin']]) {
      const created = await founder.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': csrf }, data: { username, temporary_password: password, role } });
      expect(created.status()).toBe(201);
      const firstLogin = await page.request.post('/api/auth/login', { data: { username, password } });
      expect(firstLogin.ok()).toBeTruthy();
      const user = (await firstLogin.json()).user;
      expect((await page.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': user.csrf_token }, data: { current_password: password, new_password: `${password}-final` } })).ok()).toBeTruthy();
      expect((await page.request.post('/api/auth/login', { data: { username, password: `${password}-final` } })).ok()).toBeTruthy();
      if (role === 'user') viewerId = user.id;
      else expect((await founder.request.put(`/api/admin/users/${user.id}/ownership`, { headers: { 'X-CSRF-Token': csrf }, data: {} })).ok()).toBeTruthy();
      expect((await page.request.get('/api/admin/analytics')).status()).toBe(403);
      expect((await page.request.get('/admin/dashboard')).status()).toBe(403);
      await page.goto('/admin/dashboard');
      await expect(page.locator('body')).toContainText('Mission Control');
      await expect(page.locator('a[href="/konto"]')).toBeVisible();
    }
    expect((await owner.request.get('/api/auth/me')).ok()).toBeTruthy();
    const ownerState = (await (await owner.request.get('/api/auth/me')).json()).user;
    expect(ownerState).toMatchObject({ is_owner: true, can_view_analytics: false });
    expect((await owner.request.put(`/api/admin/users/${viewerId}/analytics-access`, { headers: { 'X-CSRF-Token': ownerState.csrf_token }, data: { enabled: true } })).status()).toBe(403);
    await founder.goto('/admin/dashboard');
    await expect(founder.locator('#connectionLabel')).toHaveText(/Telemetrie verbunden|Telemetry connected/);
    await founder.goto('/admin');
    await founder.locator('[data-admin-panel="usersPanel"]').click();
    await founder.locator('#userQuery').fill(viewerName);
    const card = founder.locator(`[data-user-id="${viewerId}"]`);
    await expect(card).toBeVisible();
    await card.locator(':scope > summary').click();
    await card.locator('[data-analytics-access="grant"]').click();
    await expect(card.locator('[data-analytics-access="revoke"]')).toBeVisible();
    expect((await viewer.request.get('/api/admin/analytics')).status()).toBe(200);
    await viewer.goto('/konto');
    await expect(viewer.locator('#accountDashboardLink')).toBeVisible();
    await viewer.locator('#accountDashboardLink').click();
    await expect(viewer).toHaveURL(/\/admin\/dashboard$/);
    await expect(viewer.locator('#connectionLabel')).toHaveText(/Telemetrie verbunden|Telemetry connected/);
    expect((await (await viewer.request.get('/api/auth/me')).json()).user).toMatchObject({ is_admin: false, is_owner: false, analytics_access: true });
    await founder.screenshot({ path: '/tmp/rtd-dashboard-real-permission.png' });
    await viewer.screenshot({ path: '/tmp/rtd-dashboard-real-viewer.png', fullPage: true });
    await card.locator('[data-analytics-access="revoke"]').click();
    await expect(card.locator('[data-analytics-access="grant"]')).toBeVisible();
    expect((await viewer.request.get('/api/admin/analytics')).status()).toBe(403);
    await viewer.locator('#dashboardRefresh').click();
    await expect(viewer.locator('#dashboardData')).toBeHidden();
    await expect(viewer.locator('#dashboardMessage')).toContainText(/Gründer um Zugriff|founder for access/);
  } finally {
    if (viewerId && csrf) await founder.request.put(`/api/admin/users/${viewerId}/analytics-access`, { headers: { 'X-CSRF-Token': csrf }, data: { enabled: false } });
    if (csrf) await founder.request.put('/api/auth/preferences/language', { headers: { 'X-CSRF-Token': csrf }, data: { preferred_language: originalLanguage } });
    await Promise.all(contexts.map(context => context.close()));
  }
});

test('anonymous dashboard entry returns to Mission Control after the real login form', async ({ page }) => {
  await page.goto('/admin/dashboard');
  await expect(page).toHaveURL(/\/zilch\/anmelden\?return_to=%2Fadmin%2Fdashboard$/);
  await page.locator('#zilchPasswordLogin > summary').click();
  await page.locator('#zilchLoginUsername').fill('Admin');
  await page.locator('#zilchLoginPassword').fill('temporary-password-123');
  await page.locator('#zilchLoginForm button[type="submit"]').click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.locator('#connectionLabel')).toHaveText(/Telemetrie verbunden|Telemetry connected/);
});

test('mocked telemetry refreshes every 30 seconds and pauses while the document is hidden', async ({ page }) => {
  await page.clock.install();
  const state = await mockedDashboard(page, 'en');
  expect(state.calls).toHaveLength(1);
  await page.clock.fastForward(30001);
  await expect.poll(() => state.calls.length).toBe(2);
  await page.evaluate(() => {
    window.dashboardTestHidden = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.dashboardTestHidden });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.fastForward(90001);
  expect(state.calls).toHaveLength(2);
  await page.evaluate(() => {
    window.dashboardTestHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => state.calls.length).toBe(3);
});

test('restored dashboard rechecks access before revealing cached values and restarts only one refresh timer', async ({ page }) => {
  await page.clock.install();
  const state = await mockedDashboard(page, 'en');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('#dashboardData')).toBeHidden();
  await page.clock.fastForward(90001);
  expect(state.calls).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.authCalls).toBe(2);
  await expect.poll(() => state.calls.length).toBe(2);
  await expect(page.locator('#dashboardData')).toBeVisible();
  await page.clock.fastForward(30001);
  await expect.poll(() => state.calls.length).toBe(3);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  state.permitted = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.authCalls).toBe(3);
  await expect(page.locator('#dashboardData')).toBeHidden();
  await expect(page.locator('#dashboardMessage')).toContainText('Ask the founder for access');
  await page.clock.fastForward(90001);
  expect(state.calls).toHaveLength(3);
});

for (const language of ['de', 'en']) {
  test(`${language}: daily cursor, legend, UTC heatmap, page bubbles and measured journeys expose exact details`, async ({ page }) => {
    const state = await mockedDashboard(page, language);
    await page.locator('#dailyCursor').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#dailySelection')).toContainText('9');
    await expect(page.locator('#dailySelection')).toContainText('21');
    await page.locator('[data-series="sessions"]').click();
    await expect(page.locator('[data-series="sessions"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#dailyChart .chart-line')).toHaveCount(1);
    await page.locator('[data-series="page_views"]').click();
    await expect(page.locator('[data-series="page_views"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-series="sessions"]').click();
    await expect(page.locator('#dailyChart .chart-line')).toHaveCount(2);
    await page.locator('#heatmapDay').selectOption('5');
    await page.locator('#heatmapHour').selectOption('18');
    await expect(page.locator('#heatmapSelection')).toContainText(language === 'en' ? 'Saturday' : 'Samstag');
    await expect(page.locator('#heatmapSelection')).toContainText('18:00 UTC');
    await expect(page.locator('#activityHeatmap rect.is-selected')).toHaveAttribute('data-weekday', '5');
    await page.locator('#heatmapMetric').selectOption('active_seconds');
    await expect(page.locator('#activityHeatmap rect')).toHaveCount(168);
    await page.locator('#pageFocus').selectOption('1');
    await expect(page.locator('#pageDetail')).toContainText('Zilch');
    await expect(page.locator('#pageDetail')).toContainText('97');
    await expect(page.locator('#pageBubbles [data-page-index="1"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#pageBubbles [data-page-index="0"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#pageFocus')).toHaveValue('0');
    await page.locator('#journeyFocus').selectOption('2');
    await expect(page.locator('#journeyDetail')).toContainText('Zilch');
    await expect(page.locator('#journeyDetail')).toContainText('16');
    await expect(page.locator('#journeySample')).toContainText(language === 'en' ? 'Sample of the latest page views' : 'Stichprobe der neuesten Seitenaufrufe');
    state.coverage = 'partial';
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#overviewMetrics .metric-card').nth(1)).toContainText(language === 'en' ? 'Previous period incomplete' : 'Vorperiode unvollständig');
    await expect(page.locator('#overviewMetrics .metric-card').nth(1).locator('.metric-delta')).not.toContainText('%');
    await expect(page.locator('#overviewMetrics .metric-card').last().locator('.metric-delta')).toContainText('%');
    state.cpuUnavailable = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#serverTrend svg path[stroke="#f4c77b"]')).toHaveCount(1);
    await expect(page.locator('#serverTrendNote')).toContainText(language === 'en' ? 'since this dashboard was opened' : 'seit dem Öffnen dieses Dashboards');
  });
}

async function expectPaintedMap(page) {
  await expect.poll(() => page.locator('.geo-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    for (let offset = 0; offset < pixels.length; offset += Math.max(4, Math.floor(pixels.length / 16000 / 4) * 4)) colors.add(`${pixels[offset]}:${pixels[offset + 1]}:${pixels[offset + 2]}`);
    return colors.size;
  })).toBeGreaterThan(20);
}

test('globe and flat map select real country aggregates, synchronize pause and remain interactive with reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockedDashboard(page, 'en');
  await page.locator('#geography').scrollIntoViewIfNeeded();
  await expectPaintedMap(page);
  await page.locator('.geo-view-switch').getByRole('button', { name: 'World map', exact: true }).click();
  await expect(page.locator('#geographyViz')).toHaveAttribute('data-view', 'map');
  await page.locator('[data-country="US"]').click();
  await expect(page.locator('.geo-country-title')).toHaveText('United States');
  await expect(page.locator('.geo-detail-metrics dd').first()).toHaveText('8');
  await page.locator('#dashboardMotion').click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
  await expect(page.locator('.geo-pause')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-country="DE"]').click();
  await expect(page.locator('.geo-country-title')).toHaveText('Germany');
  await expectPaintedMap(page);
  await page.locator('.geo-pause').click();
  await expect(page.locator('#dashboardMotion')).toHaveAttribute('aria-pressed', 'false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('#dashboardMotion')).toBeDisabled();
  await expect(page.locator('#dashboardMotion')).toContainText('Reduced motion enabled');
  await expect(page.locator('.geo-pause')).toBeDisabled();
  await page.locator('.geo-view-switch').getByRole('button', { name: 'Globe', exact: true }).click();
  await page.locator('[data-country="FR"]').click();
  await expect(page.locator('.geo-country-title')).toHaveText('France');
  await expectPaintedMap(page);
  await page.screenshot({ path: '/tmp/rtd-dashboard-map-reduced.png', fullPage: true });
});

test('unknown origins stay without map points; revoked and cached documents release private graph data', async ({ page }) => {
  const state = await mockedDashboard(page, 'en');
  state.unknownOnly = true;
  await page.locator('#dashboardRefresh').click();
  await expect(page.locator('.geo-summary strong').first()).toHaveText('0');
  await expect(page.locator('.geo-summary strong').last()).toHaveText('135');
  await expect(page.locator('.geo-empty')).toBeVisible();
  await expect(page.locator('.geo-country-row')).toHaveCount(1);
  await page.locator('[data-country="ZZ"]').click();
  await expect(page.locator('.geo-detail-tag')).toContainText('Without a map point');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('#dashboardData')).toBeHidden();
  await expect(page.locator('.geo-country-row')).toHaveCount(0);
  await expect(page.locator('#dailyChart svg, #pageBubbles svg, #journeyFlow svg, #serverTrend svg')).toHaveCount(0);
  state.permitted = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#dashboardMessage')).toContainText('Ask the founder for access');
  await expect(page.locator('#dashboardData')).toBeHidden();
});
