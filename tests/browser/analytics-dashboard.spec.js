const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

function sampleAnalytics(game = 'all', days = 7) {
  const daily = Array.from({ length: 7 }, (_, index) => ({ date: `2026-10-0${index + 1}`, sessions: [9, 14, 11, 26, 19, 32, 24][index], page_views: [21, 40, 27, 70, 52, 83, 61][index], active_seconds: 800 + index * 370, completed_games: 2 + index }));
  return {
    generated_at: '2026-10-07T14:35:00Z', period: { days, game, from: '2026-10-01T00:00:00Z', to: '2026-10-07T14:35:00Z' },
    collection: { first_seen_at: '2026-10-01T10:00:00Z', retention_days: 90, session_scope: 'anonymous_tab', country_source: 'cloudflare_verified_peer', queued: 0, dropped: 0, stored_events: 4200, event_cap: 200000, cap_reached: false },
    overview: { sessions: 135, page_views: 354, active_seconds: 13370, avg_active_seconds: 99, live_sessions: 4, completed_games: 35, game_clicks: 1270 }, daily,
    pages: [{ page: '/spiel', game: 'zdwa', views: 135, sessions: 44, active_seconds: 9140, avg_active_seconds: 208 }, { page: '/zilch/spiel', game: 'zilch', views: 97, sessions: 31, active_seconds: 7430, avg_active_seconds: 240 }, { page: '/', game: 'zdwa', views: 82, sessions: 63, active_seconds: 2300, avg_active_seconds: 37 }, { page: '/zilch', game: 'zilch', views: 40, sessions: 28, active_seconds: 740, avg_active_seconds: 26 }],
    referrers: [{ source: 'direct', sessions: 70 }, { source: 'google.ch', sessions: 38 }, { source: 'internal', sessions: 18 }, { source: 'duckduckgo.com', sessions: 9 }],
    devices: [{ device: 'mobile', sessions: 76 }, { device: 'desktop', sessions: 42 }, { device: 'tablet', sessions: 17 }], countries: [{ country: 'CH', sessions: 95 }, { country: 'DE', sessions: 31 }, { country: 'ZZ', sessions: 9 }],
    actions: [{ action: 'roll_dice', game: 'zdwa', count: 725 }, { action: 'roll_dice', game: 'zilch', count: 300 }, { action: 'score', game: 'zdwa', count: 169 }, { action: 'bank', game: 'zilch', count: 48 }, { action: 'create_game', game: 'zdwa', count: 19 }, { action: 'game_created', game: 'zdwa', count: 15, source: 'server' }, { action: 'open_rules', game: 'zdwa', count: 9 }],
    games: [{ game: 'zdwa', completed_games: 23, participants: 41, avg_duration_seconds: 732 }, { game: 'zilch', completed_games: 12, participants: 20, avg_duration_seconds: 490 }], modes: [{ game: 'zdwa', mode: '1', completed_games: 12 }, { game: 'zdwa', mode: '2', completed_games: 11 }, { game: 'zilch', mode: 'cpu', completed_games: 12 }],
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, page_views: Math.max(0, Math.round(18 + Math.sin(hour * .34 - 3) * 18)), active_seconds: hour * 80 })),
    server: { cpu: { percent: 14.3, cores: 4, load1: .42, load5: .36, load15: .27, scope: 'host' }, memory: { used_bytes: 1740000000, total_bytes: 4294967296, percent: 40.5, scope: 'host' }, disk: { used_bytes: 13100000000, total_bytes: 42000000000, free_bytes: 28900000000, percent: 31.2, scope: 'data_filesystem' }, host_uptime_seconds: 1219985, app_uptime_seconds: 75694, process_memory_bytes: 115000000, active_rooms: 2, players_online: 5, measurement_at: '2026-10-07T14:35:00Z' },
  };
}

async function mockedDashboard(page, language) {
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  const state = { calls: [], fail: false, empty: false, permitted: true, authCalls: 0 };
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
    if (state.empty) {
      Object.assign(data.overview, { sessions: 0, page_views: 0, active_seconds: 0, avg_active_seconds: 0, live_sessions: 0 });
      for (const key of ['daily', 'pages', 'referrers', 'devices', 'countries', 'actions', 'hourly']) data[key] = [];
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
