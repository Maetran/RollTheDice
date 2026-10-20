const { test, expect } = require('@playwright/test');
const { mkdir, readFile } = require('node:fs/promises');

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
    device_software: [{ os: 'android', sessions: 61 }, { os: 'windows', sessions: 26 }, { os: 'macos', sessions: 16 }, { os: 'ios', sessions: 15 }, { os: 'ipados', sessions: 12 }, { os: 'unknown', sessions: 5 }],
    device_hardware: [{ device_family: 'android_phone', sessions: 58 }, { device_family: 'windows_pc', sessions: 26 }, { device_family: 'mac', sessions: 16 }, { device_family: 'iphone', sessions: 15 }, { device_family: 'ipad', sessions: 12 }, { device_family: 'unknown', sessions: 5 }, { device_family: 'android_tablet', sessions: 3 }],
    app_modes: [{ app_mode: 'browser', sessions: 90 }, { app_mode: 'pwa', sessions: 35 }, { app_mode: 'unknown', sessions: 10 }],
    pwa: { confirmed_installations: game === 'zilch' ? 2 : 7, first_detected_starts: game === 'zilch' ? 4 : 19 },
    browsers: [{ browser: 'chrome', sessions: 65 }, { browser: 'safari', sessions: 40 }, { browser: 'edge', sessions: 10 }, { browser: 'firefox', sessions: 7 }, { browser: 'unknown', sessions: 5 }, { browser: 'samsung_internet', sessions: 4 }, { browser: 'opera', sessions: 2 }, { browser: 'silk', sessions: 1 }, { browser: 'other', sessions: 1 }],
    browser_languages: [{ browser_language: 'de', sessions: 78 }, { browser_language: 'en', sessions: 25 }, { browser_language: 'fr', sessions: 15 }, { browser_language: 'unknown', sessions: 10 }, { browser_language: 'it', sessions: 7 }],
    request_traffic: {
      total: 1200, first_recorded_at: '2026-10-07T00:00:00Z', dropped: 0,
      countries: [{ country: 'CH', requests: 700 }, { country: 'DE', requests: 300 }, { country: 'ZZ', requests: 150 }, { country: 'US', requests: 50 }],
      statuses: [{ status_class: '2xx', requests: 1000 }, { status_class: '3xx', requests: 100 }, { status_class: '4xx', requests: 85 }, { status_class: '5xx', requests: 10 }, { status_class: 'other', requests: 5 }],
      agents: [{ agent_family: 'browser', requests: 760 }, { agent_family: 'googlebot', requests: 120 }, { agent_family: 'openai_bot', requests: 75 }, { agent_family: 'python_client', requests: 65 }, { agent_family: 'curl', requests: 40 }, { agent_family: 'bingbot', requests: 35 }, { agent_family: 'meta_bot', requests: 25 }, { agent_family: 'uptime_bot', requests: 20 }, { agent_family: 'unknown', requests: 15 }, { agent_family: 'node_client', requests: 10 }, { agent_family: 'go_client', requests: 8 }, { agent_family: 'other_bot', requests: 7 }, { agent_family: 'anthropic_bot', requests: 7 }, { agent_family: 'applebot', requests: 5 }, { agent_family: 'duckduckbot', requests: 4 }, { agent_family: 'google_other', requests: 2 }, { agent_family: 'yandexbot', requests: 1 }, { agent_family: 'baiduspider', requests: 1 }],
      channels: [{ channel: 'page', requests: 520 }, { channel: 'asset', requests: 420 }, { channel: 'api', requests: 250 }, { channel: 'other', requests: 10 }],
    },
    geography: [{ country: 'CH', sessions: 82, page_views: 210, active_seconds: 8000, games: { zdwa: 57, zilch: 35 }, share_percent: 60.7 }, { country: 'DE', sessions: 28, page_views: 73, active_seconds: 2800, games: { zdwa: 18, zilch: 13 }, share_percent: 20.7 }, { country: 'US', sessions: 8, page_views: 25, active_seconds: 1000, games: { zdwa: 6, zilch: 3 }, share_percent: 5.9 }, { country: 'GB', sessions: 5, page_views: 17, active_seconds: 650, games: { zdwa: 2, zilch: 4 }, share_percent: 3.7 }, { country: 'FR', sessions: 3, page_views: 10, active_seconds: 320, games: { zdwa: 2, zilch: 1 }, share_percent: 2.2 }, { country: 'ZZ', sessions: 9, page_views: 19, active_seconds: 600, games: { zdwa: 6, zilch: 4 }, share_percent: 6.7 }],
    geography_summary: { sessions: 135, known_sessions: 126, unknown_sessions: 9, known_countries: 5 },
    heatmap: Array.from({ length: 168 }, (_, index) => { const weekday = Math.floor(index / 24); const hour = index % 24; const active = Math.max(0, Math.round((Math.sin((hour - 9) * .32) + 1) * (weekday > 4 ? 3 : 2))); return { weekday, hour, page_views: active, sessions: Math.floor(active * .6), active_seconds: active * 53 }; }),
    journeys: { links: [{ from: '/', to: '/spiel', from_game: 'zdwa', to_game: 'zdwa', count: 29 }, { from: '/spiel', to: '/ergebnis', from_game: 'zdwa', to_game: 'zdwa', count: 21 }, { from: '/zilch', to: '/zilch/spiel', from_game: 'zilch', to_game: 'zilch', count: 16 }, { from: '/regeln', to: '/', from_game: 'zdwa', to_game: 'zdwa', count: 8 }, { from: '/ergebnis', to: '/spiel', from_game: 'zdwa', to_game: 'zdwa', count: 7 }, { from: '/', to: '/zilch', from_game: 'zdwa', to_game: 'zilch', count: 5 }], sample: { limit: 10000, page_views: 140, matching_page_views: 140, total_page_views: 354, truncated: true, method: 'latest_page_views', gap_limit_seconds: 1800, game_filter_applied: 'both_endpoints' } },
    comparison: { previous_period: { days, from: '2026-09-24T00:00:00Z', to: '2026-10-01T00:00:00Z' }, current_partial_day: true, previous_partial_day: false, previous_data_coverage: 'complete', coverage_basis: 'earliest_retained_event', overview: Object.fromEntries([['sessions', 135, 110], ['page_views', 354, 290], ['active_seconds', 13370, 10800], ['avg_active_seconds', 99, 98], ['completed_games', 35, 27]].map(([key, current, previous]) => [key, { current, previous, delta: current - previous, change_percent: (current - previous) / previous * 100 }])) },
    actions: [{ action: 'roll_dice', game: 'zdwa', count: 725 }, { action: 'roll_dice', game: 'zilch', count: 300 }, { action: 'score', game: 'zdwa', count: 169 }, { action: 'bank', game: 'zilch', count: 48 }, { action: 'create_game', game: 'zdwa', count: 19 }, { action: 'game_created', game: 'zdwa', count: 15, source: 'server' }, { action: 'open_rules', game: 'zdwa', count: 9 }],
    games: [{ game: 'zdwa', completed_games: 23, participants: 41, avg_duration_seconds: 732 }, { game: 'zilch', completed_games: 12, participants: 20, avg_duration_seconds: 490 }], modes: [{ game: 'zdwa', mode: '1', completed_games: 12 }, { game: 'zdwa', mode: '2', completed_games: 11 }, { game: 'zilch', mode: 'cpu', completed_games: 12 }],
    design_usage: {
      looks: [
        { look: 'zdwa:new:dark', game: 'zdwa', seconds: 11520, table_seconds: 8400 },
        { look: 'zdwa:new:light', game: 'zdwa', seconds: 7200, table_seconds: 5000 },
        { look: 'zilch:tavern', game: 'zilch', seconds: 6000, table_seconds: 4500 },
        { look: 'zdwa:old:classic', game: 'zdwa', seconds: 5400, table_seconds: 4800 },
        { look: 'zilch:lcars', game: 'zilch', seconds: 4000, table_seconds: 3000 },
        { look: 'zdwa:old:light', game: 'zdwa', seconds: 1800, table_seconds: 600 },
        { look: 'zdwa:new:classic', game: 'zdwa', seconds: 45, table_seconds: 45 },
      ].filter(row => game === 'all' || row.game === game),
      zdwa_account_choices: game === 'zilch' ? null : { new: 41, old: 9, answered: { new: 12, old: 7 }, never_asked_new: 29, awaiting_prompt: 15 },
      zdwa_design_mode: 'all', first_day: '2026-10-13', retention_days: 400,
    },
    hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, page_views: Math.max(0, Math.round(18 + Math.sin(hour * .34 - 3) * 18)), active_seconds: hour * 80 })),
    server: { cpu: { percent: 14.3, cores: 4, load1: .42, load5: .36, load15: .27, scope: 'host' }, memory: { used_bytes: 1740000000, total_bytes: 4294967296, percent: 40.5, scope: 'host' }, disk: { used_bytes: 13100000000, total_bytes: 42000000000, free_bytes: 28900000000, percent: 31.2, scope: 'data_filesystem' }, host_uptime_seconds: 1219985, app_uptime_seconds: 75694, process_memory_bytes: 115000000, active_rooms: 2, players_online: 5, measurement_at: '2026-10-07T14:35:00Z' },
  };
}

async function mockedDashboard(page, language, options = {}) {
  await page.addInitScript(language => localStorage.setItem('zdwa_language', language), language);
  const state = { calls: [], fail: false, empty: false, permitted: true, userId: 7, liveSessions: 4, authCalls: 0, coverage: 'complete', unknownOnly: false, cpuUnavailable: false, contextUnknown: false, requestsUnmeasured: false, requestOriginsUnknown: false, requestDropped: 0, design: 'measured', designMode: 'all', ...options };
  // This fixture supplies representative telemetry for visual/interaction QA.
  // Authorization is separately tested below against the real backend.
  await page.route('**/admin/dashboard', async route => route.fulfill({ contentType: 'text/html', body: await readFile('app/static/dashboard.html', 'utf8') }));
  await page.route('**/api/auth/me', route => {
    state.authCalls += 1;
    return route.fulfill({ json: { authenticated: true, user: { id: state.userId, username: 'GrantedViewer', is_founder: false, is_admin: false, can_view_analytics: state.permitted, analytics_access: state.permitted, preferences: { preferred_language: language } } } });
  });
  await page.route('**/api/admin/analytics?*', async route => {
    const query = new URL(route.request().url()).searchParams;
    const game = query.get('game');
    const days = Number(query.get('days'));
    state.calls.push({ game, days });
    if (!state.permitted) return route.fulfill({ status: 403, json: { detail: 'Forbidden' } });
    if (state.fail) return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
    const data = sampleAnalytics(game, days);
    if (state.voiceUsage !== undefined) {
      data.available_games = ['zdwa', 'zilch', 'hausdepp'];
      data.voice_usage = ['all', 'hausdepp'].includes(game) ? state.voiceUsage : null;
    }
    data.overview.live_sessions = state.liveSessions;
    data.generated_at = new Date(Date.parse(data.generated_at) + (state.calls.length - 1) * 30000).toISOString();
    data.server.measurement_at = data.generated_at;
    data.comparison.previous_data_coverage = state.coverage;
    data.request_traffic.dropped = state.requestDropped;
    if (state.requestsUnmeasured) data.request_traffic = { total: 0, countries: [], statuses: [], agents: [], channels: [], first_recorded_at: null, dropped: 0 };
    if (state.requestOriginsUnknown && !state.requestsUnmeasured) data.request_traffic.countries = [{ country: 'ZZ', requests: 1200 }];
    if (state.cpuUnavailable) data.server.cpu.percent = null;
    if (state.contextUnknown) {
      data.app_modes = [{ app_mode: 'unknown', sessions: 135 }];
      data.browsers = [{ browser: 'unknown', sessions: 135 }];
      data.browser_languages = [{ browser_language: 'unknown', sessions: 135 }];
    }
    if (state.unknownOnly) {
      data.countries = [{ country: 'ZZ', sessions: 135 }];
      data.geography = [{ country: 'ZZ', sessions: 135, page_views: 354, active_seconds: 13370, games: { zdwa: 90, zilch: 55 }, share_percent: 100 }];
      data.geography_summary = { sessions: 135, known_sessions: 0, unknown_sessions: 135, known_countries: 0 };
    }
    if (state.design === 'unmeasured') data.design_usage = { ...data.design_usage, looks: [], first_day: null };
    if (state.design === 'quiet') data.design_usage = { ...data.design_usage, looks: [] };
    if (state.design === 'zdwa-only') data.design_usage.looks = data.design_usage.looks.filter(row => row.game === 'zdwa');
    if (state.design === 'unanswered' && data.design_usage.zdwa_account_choices) data.design_usage.zdwa_account_choices = { new: 50, old: 0, answered: { new: 0, old: 0 }, never_asked_new: 50, awaiting_prompt: 31 };
    data.design_usage.zdwa_design_mode = state.designMode;
    if (state.empty) {
      data.pwa = { confirmed_installations: 0, first_detected_starts: 0 };
      Object.assign(data.overview, { sessions: 0, page_views: 0, active_seconds: 0, avg_active_seconds: 0, live_sessions: 0 });
      for (const key of ['daily', 'pages', 'referrers', 'devices', 'device_software', 'device_hardware', 'app_modes', 'browsers', 'browser_languages', 'countries', 'actions', 'hourly', 'geography', 'heatmap']) data[key] = [];
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
  if (state.permitted) await expect(page.locator('#connectionLabel')).toHaveText(language === 'en' ? 'Telemetry connected' : 'Telemetrie verbunden');
  return state;
}

async function expectDashboardFits(page, width) {
  const geometry = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth, controls: [...document.querySelectorAll('a,button,select,summary')].filter(item => item.checkVisibility()).map(item => { const box = item.getBoundingClientRect(); return { text: item.textContent, left: box.left, right: box.right, height: box.height }; }) }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  for (const item of geometry.controls) {
    expect(item.left, JSON.stringify(item)).toBeGreaterThanOrEqual(-1);
    expect(item.right, JSON.stringify(item)).toBeLessThanOrEqual(width + 1);
    expect(item.height, JSON.stringify(item)).toBeGreaterThanOrEqual(40);
  }
}

async function expectReadableResponsivePlot(page, id) {
  const readGeometry = () => page.locator(`#${id}`).evaluate(element => {
    const svg = element.querySelector('svg');
    const box = svg.getBoundingClientRect();
    const fonts = [...svg.querySelectorAll('.chart-axis')].map(label => {
      const matrix = label.getScreenCTM();
      return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.c, matrix.d);
    });
    return { width: element.clientWidth, height: element.clientHeight, svgWidth: box.width, svgHeight: box.height, viewWidth: svg.viewBox.baseVal.width, viewHeight: svg.viewBox.baseVal.height, fonts };
  });
  await expect.poll(async () => {
    const geometry = await readGeometry();
    return Math.max(Math.abs(geometry.viewWidth - geometry.width), Math.abs(geometry.viewHeight - geometry.height), Math.abs(geometry.svgWidth - geometry.viewWidth), Math.abs(geometry.svgHeight - geometry.viewHeight));
  }, { message: `${id} redraws at its available size after resize` }).toBeLessThanOrEqual(2);
  const geometry = await readGeometry();
  expect(Math.abs(geometry.viewWidth - geometry.width), `${id} viewBox fills available width`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.viewHeight - geometry.height), `${id} viewBox fills available height`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.svgWidth - geometry.viewWidth), `${id} labels keep their intended horizontal scale`).toBeLessThanOrEqual(2);
  expect(Math.abs(geometry.svgHeight - geometry.viewHeight), `${id} has no vertical letterboxing`).toBeLessThanOrEqual(2);
  expect(geometry.fonts.length).toBeGreaterThan(0);
  for (const font of geometry.fonts) expect(font, `${id} effective axis font size`).toBeGreaterThanOrEqual(11);
}

async function expectPannableReadableChart(page, id, minimumWidth) {
  const geometry = await page.locator(`#${id}`).evaluate(element => {
    const svg = element.querySelector('svg');
    const fonts = [...svg.querySelectorAll('text')].map(label => {
      const matrix = label.getScreenCTM();
      return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.c, matrix.d);
    });
    element.scrollLeft = element.scrollWidth;
    const panned = element.scrollLeft;
    element.scrollLeft = 0;
    return { overflow: getComputedStyle(element).overflowX, width: element.clientWidth, scrollWidth: element.scrollWidth, svgWidth: svg.getBoundingClientRect().width, panned, fonts };
  });
  expect(geometry.overflow, `${id} provides its own horizontal pan`).toBe('auto');
  expect(geometry.svgWidth).toBeGreaterThanOrEqual(minimumWidth);
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.width);
  expect(geometry.panned).toBeGreaterThan(0);
  expect(geometry.fonts.length).toBeGreaterThan(0);
  for (const font of geometry.fonts) expect(font, `${id} effective label font size`).toBeGreaterThanOrEqual(11);
}

async function serverPathPointCounts(page) {
  return page.locator('#serverTrend svg path[stroke]').evaluateAll(paths => paths.map(path => ({ stroke: path.getAttribute('stroke'), points: (path.getAttribute('d').match(/[ML]/g) || []).length })));
}

async function expectReadableNexusLabels(page) {
  const labels = await page.locator('.mission-brand small, .nexus-wordmark, .hour-label, .hour-total, .geo-stage-hint, .geo-pause, .page-row').evaluateAll(elements => elements.map(element => ({
    text: element.textContent.trim().slice(0, 80),
    size: parseFloat(getComputedStyle(element).fontSize),
  })));
  expect(labels.length).toBeGreaterThan(40);
  for (const label of labels) expect(label.size, JSON.stringify(label)).toBeGreaterThanOrEqual(11);
}

for (const language of ['de', 'en']) {
  for (const design of ['mission', 'lcars', 'nexus']) {
    test(`${language}: voice usage reports remain explicit and readable in ${design}`, async ({ page }, testInfo) => {
      const usage = {
        source: 'browser_transport_payload', first_reported_at: '2026-10-01T12:00:00Z',
        last_reported_at: '2026-10-07T14:30:00Z', retention_days: 400,
        period: { received_bytes: 24000000, sent_bytes: 12000000, reports: 42 },
        month: { from: '2026-10-01', received_bytes: 1500000000, sent_bytes: 600000000, reports: 1234 },
        daily: [{ day: '2026-10-05', received_bytes: 0, sent_bytes: 0, reports: 0 },
          { day: '2026-10-06', received_bytes: 0, sent_bytes: 0, reports: 2 },
          { day: '2026-10-07', received_bytes: 24000000, sent_bytes: 12000000, reports: 40 }],
      };
      const state = await mockedDashboard(page, language, { voiceUsage: usage });
      await page.locator('#dashboardDesign').selectOption(design);
      const panel = page.locator('#voiceUsagePanel');
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(language === 'en' ? 'Received this calendar month' : 'Empfangen im laufenden Monat');
      await expect(panel).toContainText(language === 'en' ? 'not Cloudflare billing' : 'Keine Cloudflare-Abrechnung');
      await expect(page.locator('#voiceUsageSummary')).toContainText('24 MB');
      const rows = page.locator('#voiceUsageDaily tbody tr');
      await expect(rows.nth(0)).toContainText('—');
      await expect(rows.nth(1)).toContainText('0 B');
      await expect(page.locator('#voiceUsageUpdated')).toContainText('42');
      if (design === 'nexus') {
        await panel.locator('.favorite-toggle').click();
        await expect(page.locator('#dashboardFavoritesGrid #voiceUsagePanel')).toHaveCount(1);
      }
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await panel.scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        expect(await page.locator('#voiceUsageDaily .data-scroll').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        const path = `/tmp/rtd-voice-usage-${design}-${language}-${width}.png`;
        await panel.screenshot({ path });
        await testInfo.attach(`voice-usage-${design}-${width}`, { path, contentType: 'image/png' });
      }
      await page.locator('#dashboardGame').selectOption('zilch');
      await expect(panel).toBeHidden();
      await expect(page.locator('#voiceUsageSummary')).toBeEmpty();
      state.voiceUsage = { ...usage, first_reported_at: null, last_reported_at: null, daily: [] };
      await page.locator('#dashboardGame').selectOption('all');
      await expect(panel).toContainText(language === 'en' ? 'Missing reports do not prove zero usage' : 'Fehlende Meldungen sind kein Beleg für null Verbrauch');
      await expect(page.locator('#voiceUsageDaily')).toBeEmpty();
      state.permitted = false;
      await page.locator('#dashboardRefresh').click();
      await expect(panel).toBeHidden();
      await expect(page.locator('#voiceUsageSummary')).toBeEmpty();
    });
  }
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
    await expect(page.locator('#deviceSoftwareRanks')).toContainText('Android');
    await expect(page.locator('#deviceSoftwareRanks')).toContainText('iPadOS');
    await expect(page.locator('#deviceSoftwareRanks')).toContainText(language === 'en' ? 'Unknown' : 'Unbekannt');
    await expect(page.locator('#deviceHardwareRanks')).toContainText('iPad');
    await expect(page.locator('#deviceHardwareRanks')).toContainText('iPhone');
    await expect(page.locator('#deviceHardwareRanks')).toContainText(language === 'en' ? 'Android phone' : 'Android-Smartphone');
    await expect(page.locator('#deviceDetailNote')).toBeVisible();
    await expect(page.locator('#deviceDetailNote')).toContainText(language === 'en' ? 'Older visits remain unknown' : 'Ältere Besuche bleiben unbekannt');
    await expect(page.locator('#appModeRanks')).toContainText(language === 'en' ? 'PWA / app window' : 'PWA / Appfenster');
    await expect(page.locator('#pwaInstalledCount')).toHaveText('7');
    await expect(page.locator('#pwaFirstOpenCount')).toHaveText('19');
    await expect(page.locator('.pwa-growth-panel')).toContainText(language === 'en' ? 'Confirmed PWA installations' : 'Bestätigte PWA-Installationen');
    await expect(page.locator('.pwa-growth-panel')).toContainText(language === 'en' ? 'First detected PWA launches' : 'Erstmals erkannte PWA-Starts');
    await expect(page.locator('.pwa-growth-panel')).toContainText(language === 'en' ? 'not added together' : 'nicht addiert');
    await expect(page.locator('#browserRanks')).toContainText('Chrome / Chromium');
    await expect(page.locator('#browserLanguageRanks')).toContainText(language === 'en' ? 'German' : 'Deutsch');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1080 : 1000 });
      await expectDashboardFits(page, width);
      await page.locator('#missionTitle').click();
      await page.screenshot({ path: `/tmp/rtd-dashboard-${language}-${width}.png`, fullPage: true });
      await testInfo.attach(`mocked-telemetry-${language}-${width}`, { path: `/tmp/rtd-dashboard-${language}-${width}.png`, contentType: 'image/png' });
    }
    await page.locator('#dashboardDays').selectOption('30');
    await page.locator('#dashboardGame').selectOption('zilch');
    await expect.poll(() => state.calls.at(-1)).toEqual({ game: 'zilch', days: 30 });
    await expect(page.locator('#gameCards .game-card')).toHaveCount(1);
    await expect(page.locator('#pwaInstalledCount')).toHaveText('2');
    await expect(page.locator('#pwaFirstOpenCount')).toHaveText('4');
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
    await expect(page.locator('#pwaInstalledCount')).toHaveText('7');
    state.fail = false;
    await page.locator('#dashboardRetry').click();
    await expect(page.locator('#dashboardMessage')).toBeHidden();
    state.empty = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#dailyChart')).toContainText(language === 'en' ? 'No measurements yet' : 'Noch keine Messwerte');
    await expect(page.locator('#gameCards')).toContainText('23');
    await expect(page.locator('#countryNote')).toContainText(language === 'en' ? 'no IP geolocation' : 'keine IP-Geolokalisierung');
    await expect(page.locator('#serverGauges .gauge-number').first()).toHaveText('—');
    await expect(page.locator('#pwaInstalledCount')).toHaveText('0');
    await expect(page.locator('#pwaFirstOpenCount')).toHaveText('0');
    await expect(page.locator('#appModeChart, #browserRanks, #browserLanguageRanks').first()).toContainText(language === 'en' ? 'No measurements yet' : 'Noch keine Messwerte');
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
    for (const id of ['appModeChart', 'appModeRanks', 'browserRanks', 'browserLanguageRanks', 'requestTrafficSummary', 'requestCountryRanks', 'requestStatusRanks', 'requestAgentRanks', 'requestChannelRanks', 'requestRecordedAt', 'requestDroppedNote']) await expect(viewer.locator(`#${id}`)).toBeEmpty();
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
  await expect.poll(() => state.authCalls).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('#dashboardData')).toBeHidden();
  await page.clock.fastForward(90001);
  expect(state.calls).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.authCalls).toBe(4);
  await expect.poll(() => state.calls.length).toBe(2);
  await expect(page.locator('#dashboardData')).toBeVisible();
  await page.clock.fastForward(30001);
  await expect.poll(() => state.calls.length).toBe(3);
  await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => state.authCalls).toBe(5);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  state.permitted = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.authCalls).toBe(6);
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
  await expect(page.locator('#deviceSoftwareRanks')).toBeEmpty();
  await expect(page.locator('#deviceHardwareRanks')).toBeEmpty();
  for (const id of ['appModeChart', 'appModeRanks', 'pwaInstalledCount', 'pwaFirstOpenCount', 'browserRanks', 'browserLanguageRanks', 'requestTrafficSummary', 'requestCountryRanks', 'requestStatusRanks', 'requestAgentRanks', 'requestChannelRanks', 'requestRecordedAt', 'requestDroppedNote']) await expect(page.locator(`#${id}`)).toBeEmpty();
  state.permitted = false;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.locator('#dashboardMessage')).toContainText('Ask the founder for access');
  await expect(page.locator('#dashboardData')).toBeHidden();
});

async function canvasSignature(page) {
  return page.locator('.geo-canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let signature = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 212) {
      signature = Math.imul(signature ^ pixels[offset], 16777619);
      signature = Math.imul(signature ^ pixels[offset + 1], 16777619);
      signature = Math.imul(signature ^ pixels[offset + 2], 16777619);
    }
    return signature >>> 0;
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: LCARS preserves analysis selections, fits every viewport and persists without extra telemetry requests`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1080 });
    const state = await mockedDashboard(page, language);
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'mission');
    await expect(page.getByRole('combobox', { name: language === 'en' ? 'Dashboard design' : 'Dashboard-Design', exact: true })).toHaveValue('mission');
    await page.locator('#dashboardMotion').click();
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#serverTrend svg')).toBeVisible();
    await page.locator('#dailyCursor').focus();
    await page.keyboard.press('Home');
    await page.locator('#heatmapDay').selectOption('5');
    await page.locator('#heatmapHour').selectOption('18');
    await page.locator('#heatmapMetric').selectOption('active_seconds');
    await page.locator('#pageFocus').selectOption('1');
    await page.locator('#journeyFocus').selectOption('2');
    await page.locator('.geo-view-switch').getByRole('button', { name: language === 'en' ? 'World map' : 'Weltkarte', exact: true }).click();
    await page.locator('[data-country="US"]').click();
    await expectPaintedMap(page);
    const missionMap = await canvasSignature(page);
    const trend = await page.locator('#serverTrend').innerHTML();
    const queries = state.calls.length;
    await page.locator('#dashboardDesign').selectOption('lcars');
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'lcars');
    await expect.poll(() => canvasSignature(page)).not.toBe(missionMap);
    await expect(page.locator('#geographyViz')).toHaveAttribute('data-view', 'map');
    await expect(page.locator('.geo-country-title')).toHaveText(language === 'en' ? 'United States' : 'Vereinigte Staaten');
    await expect(page.locator('.geo-detail-metrics dd').first()).toHaveText('8');
    await expect(page.locator('#dailySelection')).toContainText('21');
    await expect(page.locator('#heatmapDay')).toHaveValue('5');
    await expect(page.locator('#heatmapHour')).toHaveValue('18');
    await expect(page.locator('#heatmapMetric')).toHaveValue('active_seconds');
    await expect(page.locator('#pageFocus')).toHaveValue('1');
    await expect(page.locator('#journeyFocus')).toHaveValue('2');
    await expect(page.locator('#pageDetail')).toContainText('97');
    await expect(page.locator('#journeyDetail')).toContainText('16');
    await expect(page.locator('#deviceSoftwareRanks')).toContainText('iPadOS');
    await expect(page.locator('#deviceHardwareRanks')).toContainText(language === 'en' ? 'Android phone' : 'Android-Smartphone');
    await expect(page.locator('#appModeRanks')).toContainText('35');
    await expect(page.locator('#browserRanks')).toContainText('Chrome / Chromium');
    await expect(page.locator('#browserRanks')).toContainText('Safari / WebKit');
    await expect(page.locator('#browserLanguageRanks')).toContainText(language === 'en' ? 'German' : 'Deutsch');
    expect(await page.locator('#serverTrend').innerHTML()).toBe(trend);
    expect(state.calls).toHaveLength(queries);
    expect(await page.evaluate(() => localStorage.getItem('rollthedice:dashboard:design'))).toBe('lcars');
    await page.locator('.geo-view-switch').getByRole('button', { name: language === 'en' ? 'Globe' : 'Globus', exact: true }).click();
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1080 : 1000 });
      await page.locator('#geography').scrollIntoViewIfNeeded();
      await expectDashboardFits(page, width);
      await expectPaintedMap(page);
      await page.locator('#missionTitle').click();
      await expect(page.locator('.skip-link')).not.toBeFocused();
      const path = `/tmp/rtd-dashboard-lcars-${language}-${width}.png`;
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`mocked-lcars-${language}-${width}`, { path, contentType: 'image/png' });
    }
    expect(state.calls).toHaveLength(queries);
    await page.reload();
    await expect(page.locator('#connectionLabel')).toHaveText(language === 'en' ? 'Telemetry connected' : 'Telemetrie verbunden');
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'lcars');
    await expect(page.locator('#dashboardDesign')).toHaveValue('lcars');
    await expect(page.locator('#dashboardMotion')).toHaveAttribute('aria-pressed', 'true');
    expect(state.calls).toHaveLength(queries + 1);
    await page.locator('#dashboardDesign').selectOption('mission');
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'mission');
    expect(await page.evaluate(() => localStorage.getItem('rollthedice:dashboard:design'))).toBe('mission');
    expect(state.calls).toHaveLength(queries + 1);
  });

  test(`${language}: all designs keep globe, map and charts interactive under pause and reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const state = await mockedDashboard(page, language);
    for (const design of ['mission', 'lcars', 'nexus']) {
      await page.locator('#dashboardDesign').selectOption(design);
      await page.locator('#dashboardMotion').click();
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
      await expect(page.locator('.geo-pause')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('.geo-view-switch').getByRole('button', { name: language === 'en' ? 'World map' : 'Weltkarte', exact: true }).click();
      await page.locator('[data-country="DE"]').click();
      await expect(page.locator('.geo-country-title')).toHaveText(language === 'en' ? 'Germany' : 'Deutschland');
      await expectPaintedMap(page);
      await page.locator('.geo-pause').click();
      await expect(page.locator('#dashboardMotion')).toHaveAttribute('aria-pressed', 'false');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await expect(page.locator('#dashboardMotion')).toBeDisabled();
      await expect(page.locator('#dashboardMotion')).toContainText(language === 'en' ? 'Reduced motion enabled' : 'Reduzierte Bewegung aktiv');
      await expect(page.locator('.geo-pause')).toBeDisabled();
      await page.locator('.geo-view-switch').getByRole('button', { name: language === 'en' ? 'Globe' : 'Globus', exact: true }).click();
      await page.locator('[data-country="FR"]').click();
      await expect(page.locator('.geo-country-title')).toHaveText(language === 'en' ? 'France' : 'Frankreich');
      await expectPaintedMap(page);
      await page.locator('#heatmapDay').selectOption('6');
      await page.locator('#heatmapHour').selectOption('20');
      await expect(page.locator('#heatmapSelection')).toContainText(language === 'en' ? 'Sunday' : 'Sonntag');
      await expect(page.locator('#heatmapSelection')).toContainText('20:00 UTC');
      await page.locator('[data-series="sessions"]').click();
      await expect(page.locator('#dailyChart .chart-line')).toHaveCount(1);
      await page.locator('[data-series="sessions"]').click();
      await expect(page.locator('#dailyChart .chart-line')).toHaveCount(2);
      await page.locator('#geography').scrollIntoViewIfNeeded();
      await expectDashboardFits(page, 390);
      await page.locator('#missionTitle').click();
      await page.screenshot({ path: `/tmp/rtd-dashboard-${design}-${language}-reduced.png`, fullPage: true });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await expect(page.locator('#dashboardMotion')).toBeEnabled();
      // Removing the OS preference makes the control available; it preserves
      // the safe paused state until the viewer explicitly resumes motion.
      if (await page.locator('#dashboardMotion').getAttribute('aria-pressed') === 'true') await page.locator('#dashboardMotion').click();
      await expect(page.locator('#dashboardMotion')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.geo-pause')).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'running');
    }
    expect(state.calls).toHaveLength(1);
  });
}

test('design remains usable when browser storage rejects preference reads and writes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === 'rollthedice:dashboard:design') throw new DOMException('Blocked for browser test', 'SecurityError');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'rollthedice:dashboard:design') throw new DOMException('Blocked for browser test', 'SecurityError');
      return setItem.call(this, key, value);
    };
  });
  const state = await mockedDashboard(page, 'en');
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'mission');
  await page.locator('#dashboardDesign').selectOption('lcars');
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'lcars');
  await page.locator('[data-country="US"]').click();
  await expect(page.locator('.geo-detail-metrics dd').first()).toHaveText('8');
  expect(state.calls).toHaveLength(1);
  await page.reload();
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'mission');
  await expect(page.locator('#dashboardDesign')).toHaveValue('mission');
  expect(state.calls).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('unknown stored design falls back to Mission Control and can be replaced by LCARS', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('rollthedice:dashboard:design')) localStorage.setItem('rollthedice:dashboard:design', 'unsupported');
  });
  await mockedDashboard(page, 'en');
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'mission');
  await expect(page.locator('#dashboardDesign')).toHaveValue('mission');
  await page.locator('#dashboardDesign').selectOption('lcars');
  await page.reload();
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
  await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'lcars');
  await expect(page.locator('#dashboardDesign')).toHaveValue('lcars');
});

for (const language of ['de', 'en']) {
  test(`${language}: NEXUS favorites move live KPI and chart controls, persist, and preserve the existing designs`, async ({ page }) => {
    const state = await mockedDashboard(page, language);
    const favoriteKey = 'rollthedice:dashboard:favorites:7';
    const liveId = 'metric-live-sessions';
    const chartId = 'panel-traffic';
    const live = page.locator(`[data-favorite-id="${liveId}"]`);
    const chart = page.locator(`[data-favorite-id="${chartId}"]`);
    const star = id => page.locator(`[data-favorite-toggle="${id}"]`);
    await expect(page.locator('#dashboardFavorites')).toBeHidden();
    await expect(page.locator('#overviewMetrics .metric-card')).toHaveCount(6);
    await page.locator('#dashboardDesign').selectOption('nexus');
    await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', 'nexus');
    await expect(page.locator('#dashboardFavorites')).toBeVisible();
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(0);
    const favoriteItems = await page.locator('[data-favorite-id]').count();
    expect(favoriteItems).toBe(await page.locator('article.panel, .metric-card').count());
    await expect(page.locator('[data-favorite-toggle]')).toHaveCount(favoriteItems);
    await expect(star(liveId)).toHaveAccessibleName(language === 'en' ? /favorite.*active visits/i : /Favorit.*Aktive Besuche/);
    await chart.evaluate(element => { window.dashboardPinnedChart = element; });
    await star(liveId).click();
    await star(chartId).click();
    await expect(page.locator(`#dashboardFavoritesGrid > [data-favorite-id="${liveId}"]`)).toBeVisible();
    await expect(page.locator(`#dashboardFavoritesGrid > [data-favorite-id="${chartId}"]`)).toBeVisible();
    await expect(star(liveId)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(chartId)).toHaveAttribute('aria-pressed', 'true');
    await expect(star(chartId)).toHaveAccessibleName(language === 'en' ? /remove.*favorite/i : /Aus Favoriten entfernen/);
    await page.locator('#dailyCursor').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#dailySelection')).toContainText('21');
    await page.locator('[data-series="sessions"]').click();
    await expect(page.locator('#dailyChart .chart-line')).toHaveCount(1);
    await page.locator('#dailyTable').locator('..').locator('summary').click();
    await expect(page.locator('#dailyTable table tbody tr')).toHaveCount(7);
    state.liveSessions = 13;
    await page.locator('#dashboardRefresh').click();
    await expect(live.locator('.metric-value')).toHaveText('13');
    await expect(page.locator('#dailyChart .chart-line')).toHaveCount(1);
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(2);
    expect(await chart.evaluate(element => element === window.dashboardPinnedChart)).toBeTruthy();
    const identity = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
      const favoriteIds = [...document.querySelectorAll('[data-favorite-id]')].map(element => element.dataset.favoriteId);
      return { idsUnique: ids.length === new Set(ids).size, favoriteIdsUnique: favoriteIds.length === new Set(favoriteIds).size };
    });
    expect(identity).toEqual({ idsUnique: true, favoriteIdsUnique: true });
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), favoriteKey)).toEqual([liveId, chartId]);
    const calls = state.calls.length;
    for (const design of ['mission', 'lcars']) {
      await page.locator('#dashboardDesign').selectOption(design);
      await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', design);
      await expect(page.locator('#dashboardFavorites')).toBeHidden();
      await expect(page.locator('#overviewMetrics > [data-favorite-id]').first()).toHaveAttribute('data-favorite-id', liveId);
      await expect(page.locator('.traffic-grid > .traffic-panel')).toBeVisible();
      await expect(star(chartId)).toBeHidden();
      expect(await chart.evaluate(element => element === window.dashboardPinnedChart)).toBeTruthy();
      await expect(page.locator('#dailyChart .chart-line')).toHaveCount(1);
    }
    expect(state.calls).toHaveLength(calls);
    await page.locator('#dashboardDesign').selectOption('nexus');
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(2);
    await page.reload();
    await expect(page.locator('#connectionLabel')).toHaveText(language === 'en' ? 'Telemetry connected' : 'Telemetrie verbunden');
    await expect(page.locator('#dashboardDesign')).toHaveValue('nexus');
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(2);
    await expect(live.locator('.metric-value')).toHaveText('13');
    await star(chartId).click();
    await expect(page.locator('.traffic-grid > .traffic-panel')).toBeVisible();
    await expect(star(chartId)).toHaveAttribute('aria-pressed', 'false');
    await star(liveId).click();
    await expect(page.locator('#overviewMetrics > [data-favorite-id]').first()).toHaveAttribute('data-favorite-id', liveId);
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), favoriteKey)).toEqual([]);
  });

  test(`${language}: NEXUS favorites and controls fit phones, tablet orientations and desktop`, async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await mockedDashboard(page, language);
    await page.locator('#dashboardDesign').selectOption('nexus');
    await page.locator('#dashboardMotion').click();
    if (language === 'de') {
      await mkdir('.impeccable/review', { recursive: true });
      await page.setViewportSize({ width: 1440, height: 1080 });
      await page.locator('#missionTitle').click();
      await page.screenshot({ path: '.impeccable/review/desktop-empty.png', fullPage: true });
      await page.screenshot({ path: '.impeccable/review/desktop-empty-viewport.png' });
    }
    await page.locator('[data-favorite-toggle="metric-live-sessions"]').click();
    await page.locator('[data-favorite-toggle="panel-traffic"]').click();
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#serverTrend svg')).toBeVisible();
    const serverPoints = await serverPathPointCounts(page);
    await page.locator('#dailyCursor').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('#dashboardFavoritesTitle')).toHaveText(language === 'en' ? 'Your focus' : 'Dein Fokus');
    await expect(page.locator('#dashboardFavoritesGrid .metric-label')).toContainText(language === 'en' ? 'Active visits' : 'Aktive Besuche');
    await expect(page.locator('#dashboardFavoritesGrid .traffic-panel h3')).toHaveText(language === 'en' ? 'Visits & page views' : 'Besuche & Seitenaufrufe');
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: width >= 1024 ? 1080 : 1000 });
      await page.locator('#missionTitle').click();
      await expectDashboardFits(page, width);
      await expect(page.locator('#dashboardFavoritesGrid .metric-card')).toBeVisible();
      await expect(page.locator('#dashboardFavoritesGrid .traffic-panel')).toBeVisible();
      await expectReadableNexusLabels(page);
      await expect(page.locator('#dailySelection')).toContainText('21');
      expect(await serverPathPointCounts(page)).toEqual(serverPoints);
      if (width <= 390) {
        await expectReadableResponsivePlot(page, 'dailyChart');
        await expectReadableResponsivePlot(page, 'serverTrend');
        await expectPannableReadableChart(page, 'activityHeatmap', 700);
        await expectPannableReadableChart(page, 'pageBubbles', 680);
        await expectPannableReadableChart(page, 'journeyFlow', 720);
      }
      const path = `/tmp/rtd-dashboard-nexus-${language}-${width}.png`;
      await page.screenshot({ path, fullPage: true });
      await testInfo.attach(`mocked-nexus-${language}-${width}`, { path, contentType: 'image/png' });
      if (language === 'de') {
        const name = { 320: 'narrow', 390: 'mobile', 768: 'tablet', 1024: 'tablet-landscape', 1440: 'desktop' }[width];
        await page.screenshot({ path: `.impeccable/review/${name}.png`, fullPage: true });
        await page.screenshot({ path: `.impeccable/review/${name}-viewport.png` });
      }
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('#dashboardMotion')).toBeDisabled();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await page.locator('#dailyCursor').focus();
    await page.keyboard.press('Home');
    await expect(page.locator('#dailySelection')).toContainText('21');
    await page.locator('#dashboardDesign').selectOption('mission');
    await expect(page.locator('#dailyChart svg')).toHaveAttribute('viewBox', '0 0 720 230');
    await expect(page.locator('#serverTrend svg')).toHaveAttribute('viewBox', '0 0 720 137');
    expect(await serverPathPointCounts(page)).toEqual(serverPoints);
  });
}

test('NEXUS keyboard stars reveal the moved control on pin and unpin while refresh preserves reading position', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await mockedDashboard(page, 'en');
  await page.locator('#dashboardDesign').selectOption('nexus');
  const action = page.locator('[data-favorite-id="panel-actions"]');
  const star = page.locator('[data-favorite-toggle="panel-actions"]');
  await action.evaluate(element => { window.dashboardActionParent = element.parentElement; });
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    await star.scrollIntoViewIfNeeded();
    await star.focus();
    await expect(star).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(1000);
    await page.keyboard.press('Enter');
    await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id="panel-actions"]')).toBeVisible();
    await expect(star).toBeFocused();
    await expect(star).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await expect(star).toBeFocused();
    await expect(star).toBeInViewport();
    expect(await action.evaluate(element => element.parentElement === window.dashboardActionParent)).toBeTruthy();
    // The explicit toggle may scroll smoothly. Measure refresh only once that
    // user-triggered movement has settled, rather than sampling mid-animation.
    await page.evaluate(() => { window.dashboardScrollProbe = { top: scrollY, steadyFrames: 0 }; });
    await page.waitForFunction(() => {
      const probe = window.dashboardScrollProbe;
      probe.steadyFrames = Math.abs(scrollY - probe.top) < .5 ? probe.steadyFrames + 1 : 0;
      probe.top = scrollY;
      return probe.steadyFrames >= 3;
    });
    const beforeRefresh = await page.evaluate(() => scrollY);
    await page.evaluate(() => document.getElementById('dashboardRefresh').click());
    await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
    expect(Math.abs(await page.evaluate(() => scrollY) - beforeRefresh)).toBeLessThanOrEqual(2);
    await expect(star).toBeFocused();
  }
});

test('NEXUS favorites are scoped to the viewer and private values clear on pagehide and access revocation', async ({ page }) => {
  const state = await mockedDashboard(page, 'en');
  await expect.poll(() => state.authCalls).toBe(2);
  await page.locator('#dashboardDesign').selectOption('nexus');
  await page.locator('[data-favorite-toggle="metric-live-sessions"]').click();
  await page.locator('[data-favorite-toggle="panel-traffic"]').click();
  const firstViewer = await page.evaluate(() => localStorage.getItem('rollthedice:dashboard:favorites:7'));
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.locator('#dashboardData')).toBeHidden();
  await expect(page.locator('#dashboardFavoritesGrid .metric-value, #dashboardFavoritesGrid svg')).toHaveCount(0);
  state.userId = 8;
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect.poll(() => state.authCalls).toBe(4);
  await expect(page.locator('#dashboardData')).toBeVisible();
  await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(0);
  await page.locator('[data-favorite-toggle="panel-traffic"]').click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rollthedice:dashboard:favorites:8')))).toEqual(['panel-traffic']);
  expect(await page.evaluate(() => localStorage.getItem('rollthedice:dashboard:favorites:7'))).toBe(firstViewer);
  await page.reload();
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
  await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(1);
  await expect(page.locator('#dashboardFavoritesGrid > .traffic-panel')).toBeVisible();
  state.permitted = false;
  await page.locator('#dashboardRefresh').click();
  await expect(page.locator('#dashboardMessage')).toContainText('Ask the founder for access');
  await expect(page.locator('#dashboardData')).toBeHidden();
  await expect(page.locator('#dashboardFavoritesGrid .metric-value, #dashboardFavoritesGrid svg')).toHaveCount(0);
  await expect(page.locator('#dailyChart')).toBeEmpty();
  await expect(page.locator('#overviewMetrics')).toBeEmpty();
});

test('denied NEXUS entry never loads private favorites or telemetry', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('rollthedice:dashboard:design', 'nexus');
    localStorage.setItem('rollthedice:dashboard:favorites:7', JSON.stringify(['metric-live-sessions', 'panel-traffic']));
  });
  const state = await mockedDashboard(page, 'en', { permitted: false });
  await expect(page.locator('#dashboardMessage')).toContainText('Ask the founder for access');
  await expect(page.locator('#dashboardData')).toBeHidden();
  await expect(page.locator('#dashboardFavoritesGrid .metric-value, #dashboardFavoritesGrid svg')).toHaveCount(0);
  await expect(page.locator('#dailyChart')).toBeEmpty();
  await expect(page.locator('#overviewMetrics')).toBeEmpty();
  expect(state.calls).toHaveLength(0);
});

test('NEXUS section navigation and restored fragments reach the real pinned server panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockedDashboard(page, 'en');
  await page.locator('#dashboardDesign').selectOption('nexus');
  await page.locator('[data-favorite-toggle="panel-server"]').click();
  const server = page.locator('#dashboardFavoritesGrid > .server-panel');
  await expect(server).toBeVisible();
  await page.locator('.mission-sections a[href="#server"]').focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#server$/);
  await expect(server).toBeInViewport();
  expect(await server.evaluate(element => element.contains(document.activeElement))).toBeTruthy();
  expect(await server.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(220);
  await page.reload();
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
  await expect(page).toHaveURL(/#server$/);
  await expect(server).toBeInViewport();
  expect(await server.evaluate(element => element.getBoundingClientRect().top)).toBeLessThan(220);
  await page.locator('#dashboardDesign').selectOption('mission');
  await expect(page.locator('#server > .server-panel')).toBeVisible();
  await page.locator('.mission-sections a[href="#server"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#serverTitle')).toBeInViewport();
});

test('NEXUS design and favorites work in memory when preference storage is blocked', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ['getItem', 'setItem']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (key, ...args) {
        if (key === 'rollthedice:dashboard:design' || key.startsWith('rollthedice:dashboard:favorites:')) throw new DOMException('Blocked for browser test', 'SecurityError');
        return original.call(this, key, ...args);
      };
    }
  });
  const state = await mockedDashboard(page, 'en');
  await page.locator('#dashboardDesign').selectOption('nexus');
  await page.locator('[data-favorite-toggle="metric-live-sessions"]').click();
  await page.locator('[data-favorite-toggle="panel-traffic"]').click();
  await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(2);
  state.liveSessions = 19;
  await page.locator('#dashboardRefresh').click();
  await expect(page.locator('#dashboardFavoritesGrid .metric-value')).toHaveText('19');
  await page.locator('#dashboardDesign').selectOption('mission');
  await expect(page.locator('#overviewMetrics .metric-card')).toHaveCount(6);
  await page.locator('#dashboardDesign').selectOption('nexus');
  await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
  await expect(page.locator('#dashboardDesign')).toHaveValue('mission');
  await page.locator('#dashboardDesign').selectOption('nexus');
  await expect(page.locator('#dashboardFavoritesGrid > [data-favorite-id]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const language of ['de', 'en']) {
  test(`${language}: PWA launch, browser and browser-language shares stay separate from game UI language in both designs`, async ({ page }, testInfo) => {
    const state = await mockedDashboard(page, language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('#appModeChart .launch-orbit>span')).toContainText('25.9');
    await expect(page.locator('#appModeRanks li').filter({ hasText: language === 'en' ? 'PWA / app window' : 'PWA / Appfenster' })).toContainText('35');
    await expect(page.locator('#appModeRanks li').filter({ hasText: language === 'en' ? 'Browser tab' : 'Browser-Tab' })).toContainText('90');
    await expect(page.locator('#appModeRanks li').filter({ hasText: language === 'en' ? 'Unknown' : 'Unbekannt' })).toContainText('10');
    await expect(page.locator('#browserRanks')).toContainText('Chrome / Chromium');
    await expect(page.locator('#browserRanks')).toContainText('Samsung Internet');
    await expect(page.locator('#browserRanks')).toContainText('Amazon Silk');
    await expect(page.locator('#browserLanguageRanks li').first()).toContainText(language === 'en' ? 'German' : 'Deutsch');
    await expect(page.locator('#browserLanguageRanks li').first()).toContainText('78');
    await expect(page.locator('.language-panel .panel-footnote')).toHaveText(language === 'en' ? 'Browser language is independent of the language selected in the game.' : 'Die Browsersprache ist unabhängig von der gewählten Sprache im Spiel.');
    await expect(page.locator('.launch-panel .panel-footnote')).toContainText(language === 'en' ? 'not the number of installed apps' : 'nicht Anzahl installierter Apps');
    await expect(page.locator('.context-measurement-note')).toContainText(language === 'en' ? 'including unknown information' : 'einschließlich unbekannter Angaben');
    await page.locator('#dashboardMotion').click();
    const counts = await page.locator('#appModeRanks, #browserRanks, #browserLanguageRanks').allTextContents();
    for (const design of ['mission', 'lcars']) {
      await page.locator('#dashboardDesign').selectOption(design);
      expect(await page.locator('#appModeRanks, #browserRanks, #browserLanguageRanks').allTextContents()).toEqual(counts);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectDashboardFits(page, width);
        await page.locator('#browserLanguageTitle').click();
        await expect(page.locator('.skip-link')).not.toBeFocused();
        const path = `/tmp/rtd-dashboard-context-${design}-${language}-${width}.png`;
        await page.locator('.client-context-grid').screenshot({ path, style: '.skip-link:not(:focus){visibility:hidden}' });
        await testInfo.attach(`mocked-context-${design}-${language}-${width}`, { path, contentType: 'image/png' });
        const pwaPath = `/tmp/rtd-dashboard-pwa-${design}-${language}-${width}.png`;
        await page.locator('.pwa-growth-panel').screenshot({ path: pwaPath, style: '.skip-link:not(:focus){visibility:hidden}' });
        await testInfo.attach(`mocked-pwa-${design}-${language}-${width}`, { path: pwaPath, contentType: 'image/png' });
      }
    }
    expect(state.calls).toHaveLength(1);
    state.contextUnknown = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#appModeChart .launch-orbit>span')).toHaveText('—');
    await expect(page.locator('#appModeChart')).toContainText(language === 'en' ? 'Launch context unknown' : 'Startkontext unbekannt');
    for (const id of ['appModeRanks', 'browserRanks', 'browserLanguageRanks']) {
      await expect(page.locator(`#${id} li`)).toHaveCount(1);
      await expect(page.locator(`#${id}`)).toContainText(language === 'en' ? 'Unknown' : 'Unbekannt');
      await expect(page.locator(`#${id}`)).toContainText('135');
    }
  });
}

test('browser language labels have a safe fallback without Intl.DisplayNames', async ({ page }) => {
  const state = await mockedDashboard(page, 'en');
  await page.evaluate(() => { Intl.DisplayNames = undefined; });
  await page.locator('#dashboardRefresh').click();
  await expect(page.locator('#browserLanguageRanks li').first()).toContainText('DE');
  await expect(page.locator('#browserLanguageRanks')).toContainText('Unknown');
  expect(state.calls).toHaveLength(2);
  await expect(page.locator('#connectionLabel')).toHaveText('Telemetry connected');
});

for (const language of ['de', 'en']) {
  test(`${language}: server request origins and declared clients stay independent of visits and game filters in both designs`, async ({ page }, testInfo) => {
    const state = await mockedDashboard(page, language);
    await expect(page.locator('#requestTrafficSummary .request-metric strong').first()).toHaveText(/1\D?200/);
    await expect(page.locator('#requestTrafficSummary .request-metric strong').nth(1)).toHaveText('85');
    await expect(page.locator('#requestTrafficSummary .request-metric strong').nth(2)).toHaveText('10');
    const firstStoredDay = await page.evaluate(() => new Intl.DateTimeFormat(window.ZDWA_I18N.locale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date('2026-10-07T00:00:00Z')));
    await expect(page.locator('#requestRecordedAt')).toHaveText(`${language === 'en' ? 'Earliest stored UTC day' : 'Frühester gespeicherter UTC-Tag'}: ${firstStoredDay}`);
    await expect(page.locator('#requestRecordedAt')).not.toContainText(/\d{2}:\d{2}/);
    const requestOrigin = page.locator('#requestCountryRanks li').first();
    await expect(requestOrigin).toContainText(language === 'en' ? 'Switzerland' : 'Schweiz');
    await expect(requestOrigin).toContainText('700');
    await expect(requestOrigin.locator('.country-flag')).toHaveText('🇨🇭');
    await expect(page.locator('.geo-detail-metrics dd').first()).toHaveText('82');
    await expect(page.locator('#requestAgentRanks li').filter({ hasText: 'Googlebot' })).toContainText('120');
    await expect(page.locator('#requestAgentRanks li')).toHaveCount(18);
    await expect(page.locator('#requestAgentRanks')).toContainText('Baiduspider');
    await expect(page.locator('#requestAgentRanks')).toContainText(language === 'en' ? 'Other Google identifiers' : 'Weitere Google-Kennungen');
    await expect(page.locator('#requestAgentRanks')).toContainText(language === 'en' ? 'Browser identifier' : 'Browserkennung');
    await expect(page.locator('.request-client-hint')).toHaveText(language === 'en' ? 'Self-declared · not verified' : 'Selbstangabe · nicht verifiziert');
    await expect(page.locator('.request-client-note')).toHaveText(language === 'en' ? 'Automated requests can pretend to be browsers.' : 'Automatisierte Aufrufe können Browser vortäuschen.');
    await expect(page.locator('#requestChannelRanks')).toContainText('API');
    await expect(page.locator('#requestChannelRanks')).toContainText('250');
    await expect(page.locator('.request-traffic-panel .panel-heading')).toContainText(language === 'en' ? 'independent of the game filter' : 'unabhängig vom Spielfilter');
    await page.locator('#dashboardGame').selectOption('zilch');
    await expect.poll(() => state.calls.at(-1)?.game).toBe('zilch');
    await expect(page.locator('#requestTrafficSummary .request-metric strong').first()).toHaveText(/1\D?200/);
    await expect(requestOrigin).toContainText('700');
    await page.locator('#dashboardMotion').click();
    for (const design of ['mission', 'lcars']) {
      await page.locator('#dashboardDesign').selectOption(design);
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectDashboardFits(page, width);
        await page.locator('#requestTrafficTitle').click();
        await expect(page.locator('.skip-link')).not.toBeFocused();
        const path = `/tmp/rtd-dashboard-requests-${design}-${language}-${width}.png`;
        await page.locator('.request-traffic-panel').screenshot({ path, style: '.skip-link:not(:focus){visibility:hidden}' });
        await testInfo.attach(`mocked-requests-${design}-${language}-${width}`, { path, contentType: 'image/png' });
      }
    }
    expect(state.calls).toHaveLength(2);
    state.requestOriginsUnknown = true;
    state.requestDropped = 11;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#requestCountryRanks li')).toHaveCount(1);
    await expect(page.locator('#requestCountryRanks')).toContainText(language === 'en' ? 'Unknown' : 'Unbekannt');
    await expect(page.locator('#requestCountryRanks .country-flag')).toHaveText('◇');
    await expect(page.locator('#requestDroppedNote')).toContainText('11');
    await expect(page.locator('#requestDroppedNote')).toBeVisible();
    state.requestsUnmeasured = true;
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#requestTrafficSummary')).toContainText(language === 'en' ? 'No request measurements yet' : 'Noch keine Anfrage-Messwerte');
    await expect(page.locator('#requestTrafficSummary .request-metric')).toHaveCount(0);
    await expect(page.locator('#requestBreakdown')).toBeHidden();
    await expect(page.locator('#requestCountryRanks')).toBeEmpty();
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: design usage compares visible time per design and look in both dashboard designs`, async ({ page }, testInfo) => {
    const en = language === 'en';
    const state = await mockedDashboard(page, language);
    const section = page.locator('#designs');
    await expect(section.locator('h2')).toHaveText(en ? 'Which design wins players over?' : 'Welches Design kommt an?');
    await expect(page.locator('.mission-sections a[href="#designs"]')).toHaveText('Designs');
    const zdwa = page.locator('.design-duel[data-game="zdwa"]');
    const zilch = page.locator('.design-duel[data-game="zilch"]');
    // ZDWA new: 11,520 + 7,200 + 45 s; previous: 5,400 + 1,800 s.
    await expect(zdwa.locator('.design-side.is-a')).toContainText(en ? 'New' : 'Neu');
    await expect(zdwa.locator('.design-side.is-a .design-share')).toHaveText('72.3%');
    await expect(zdwa.locator('.design-side.is-a .design-time')).toHaveText('5 h 12 min');
    await expect(zdwa.locator('.design-side.is-b .design-time')).toHaveText('2 h');
    await expect(zdwa.locator('.design-side.is-b')).toContainText(en ? 'Previous' : 'Bisher');
    await expect(zdwa.locator('.design-side.is-b .design-share')).toHaveText('27.7%');
    await expect(zdwa.locator('.design-side.is-b')).toContainText(`${en ? 'At the game table' : 'Am Spieltisch'}: 1 h 30 min`);
    await expect(zdwa.locator('.design-split')).toHaveAttribute('aria-label', en ? 'ZDWA: New 72.3%, Previous 27.7%' : 'ZDWA: Neu 72.3%, Bisher 27.7%');
    await expect(zilch.locator('.design-side.is-a')).toContainText(en ? 'Tavern table' : 'Wirtshaustisch');
    await expect(zilch.locator('.design-side.is-a .design-share')).toHaveText('60%');
    await expect(zilch.locator('.design-side.is-b')).toContainText('LCARS');
    const dark = page.locator('[data-look="zdwa:new:dark"]');
    await expect(dark).toContainText(en ? 'Dark' : 'Dunkel');
    await expect(dark.locator('.design-look-values .design-time')).toHaveText('3 h 12 min');
    await expect(dark.locator('.design-look-values .design-time')).toHaveAttribute('title', /^11\D?520 s$/);
    await expect(dark.locator('.design-look-values small')).toHaveText('44.4%');
    // Two labelled lines, no separator that could dangle at a line end.
    await expect(dark.locator('.design-look-split > .design-look-part')).toHaveText(en ? ['At the game table 2 h 20 min', 'Other pages 52 min'] : ['Am Spieltisch 2 h 20 min', 'Übrige Seiten 52 min']);
    await expect(dark.locator('.design-look-split')).not.toContainText('·');
    await expect(page.locator('[data-look="zdwa:old:classic"]')).toContainText('Classic');
    await expect(page.locator('[data-look="zdwa:old:dark"] .design-look-values')).toContainText('0 s');
    await expect(page.locator('[data-look="zdwa:new:classic"] .design-look-values .design-time')).toHaveText('45 s');
    await expect(page.locator('#designLooks .design-group h4 > span:first-child')).toHaveText(en ? ['ZDWA new', 'ZDWA previous', 'Zilch'] : ['ZDWA Neu', 'ZDWA Bisher', 'Zilch']);
    await expect(page.locator('#designAccounts')).toContainText(en ? 'Accounts with the new design' : 'Konten mit neuem Design');
    await expect(page.locator('#designAccounts .design-account.is-a strong')).toHaveText('41');
    await expect(page.locator('#designAccounts .design-account.is-b strong')).toHaveText('9');
    await expect(page.locator('#designAccounts .design-account.is-b dd small')).toHaveText('18%');
    // Every account starts with the new design: the default share is labelled
    // and the answers of pre-release accounts are shown on their own.
    await expect(page.locator('#designAccounts .design-account.is-a .design-account-detail')).toHaveText(en ? 'of these, never asked: 29' : 'davon nie gefragt: 29');
    const answers = page.locator('#designAccounts .design-answers');
    await expect(answers.locator('h4')).toHaveText(en ? 'Answers after the update' : 'Antwort nach dem Update');
    await expect(answers.locator('.design-answer.is-a')).toContainText(en ? 'Kept new' : 'Neu behalten');
    await expect(answers.locator('.design-answer.is-a strong')).toHaveText('12');
    await expect(answers.locator('.design-answer.is-b')).toContainText(en ? 'Back to previous' : 'Zurück zum bisherigen');
    await expect(answers.locator('.design-answer.is-b strong')).toHaveText('7');
    await expect(answers.locator('.design-answer.is-b small')).toHaveText('36.8%');
    await expect(answers.locator('.design-answers-note')).toContainText(en ? 'Not asked yet: 15.' : 'Noch nicht gefragt: 15.');
    await expect(page.locator('#designAccounts .design-mode-note')).toHaveCount(0);
    await expect(page.locator('#designAccountsPanel')).toContainText(en ? 'independent of the period' : 'unabhängig vom Zeitraum');
    await expect(page.locator('#designCollectionNote')).toHaveText(en ? 'Design usage recorded since 13/10/2026 (UTC). Retention: 400 days.' : 'Design-Nutzung erfasst seit 13.10.2026 (UTC). Aufbewahrung: 400 Tage.');
    await expect(section.locator('.design-notes')).toContainText(en ? 'without account, session or device' : 'ohne Konto, Sitzung oder Gerät');
    await expect(section.locator('.design-notes')).toContainText('Do Not Track');
    await expect(page.locator('.telemetry-footer')).toContainText(en ? 'anonymous daily design usage totals for 400 days' : 'anonyme Tagessummen der Design-Nutzung 400 Tage');
    await page.locator('#designTable').locator('..').locator('summary').click();
    await expect(page.locator('#designTable tbody tr')).toHaveCount(8);
    await expect(page.locator('#designTable tbody tr').first().locator('th, td')).toHaveText([en ? 'ZDWA new · Light' : 'ZDWA Neu · Hell', /^7\D?200$/, /^5\D?000$/, /^2\D?200$/, '27.7%']);
    await page.locator('#dashboardMotion').click();
    for (const design of ['mission', 'lcars']) {
      await page.locator('#dashboardDesign').selectOption(design);
      for (const width of [320, 390, 768, 960, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        await expectDashboardFits(page, width);
        const layout = await page.evaluate(() => ({
          notes: Math.min(...[...document.querySelectorAll('.design-notes p')].map(note => parseFloat(getComputedStyle(note).fontSize))),
          headings: [...document.querySelectorAll('#designLooks .design-group h4')].map(heading => Math.round(heading.getBoundingClientRect().height)),
          rows: [...document.querySelectorAll('#designLooks .design-look')].map(row => Math.round(row.getBoundingClientRect().height)),
        }));
        // Privacy notes stay readable on phones; group headings and look rows
        // keep one height so columns line up.
        expect(layout.notes).toBeGreaterThanOrEqual(9);
        expect(new Set(layout.headings).size).toBe(1);
        expect(new Set(layout.rows).size).toBe(1);
        const path = `/tmp/rtd-dashboard-designs-${design}-${language}-${width}.png`;
        await section.screenshot({ path, style: '.skip-link{visibility:hidden}' });
        await testInfo.attach(`mocked-designs-${design}-${language}-${width}`, { path, contentType: 'image/png' });
      }
    }
    await page.locator('#dashboardGame').selectOption('zilch');
    await expect.poll(() => state.calls.at(-1)?.game).toBe('zilch');
    await expect(page.locator('.design-duel')).toHaveCount(1);
    await expect(zilch).toBeVisible();
    await expect(page.locator('#designAccountsPanel')).toBeHidden();
    await expect(page.locator('#designLooks .design-group')).toHaveCount(1);
    await expect(page.locator('#designTable tbody tr')).toHaveCount(2);
    await page.locator('#dashboardGame').selectOption('zdwa');
    await expect.poll(() => state.calls.at(-1)?.game).toBe('zdwa');
    await expect(page.locator('#designLooks .design-group')).toHaveCount(2);
    await expect(page.locator('#designAccountsPanel')).toBeVisible();
    await page.locator('#dashboardGame').selectOption('all');
    state.design = 'zdwa-only';
    await page.locator('#dashboardRefresh').click();
    await expect(zilch).toContainText(en ? 'No visible time in the selected period' : 'Keine sichtbare Zeit im gewählten Zeitraum');
    await expect(zdwa.locator('.design-side.is-a .design-share')).toHaveText('72.3%');
    state.design = 'quiet';
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#designComparison')).toContainText(en ? 'No design measurements in this period' : 'Keine Design-Messwerte im Zeitraum');
    await expect(page.locator('#designLooksPanel')).toBeHidden();
    await expect(page.locator('#designAccountsPanel')).toBeVisible();
    state.design = 'unmeasured';
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#designComparison')).toContainText(en ? 'No design measurements yet' : 'Noch keine Design-Messwerte');
    await expect(page.locator('#designComparison')).toContainText(en ? 'Once people use the games, the visible time per design appears here.' : 'Sobald jemand die Spiele nutzt, erscheint hier die sichtbare Zeit je Design.');
    await expect(page.locator('#designCollectionNote')).toHaveText(en ? 'Design usage tracking starts with this release.' : 'Die Messung der Design-Nutzung beginnt mit diesem Release.');
    // The start sentence appears once, not in the empty state and the note.
    expect((await section.innerText()).split(en ? 'Design usage tracking starts with this release.' : 'Die Messung der Design-Nutzung beginnt mit diesem Release.').length).toBe(2);
    state.design = 'unanswered';
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#designAccounts .design-answers')).toContainText(en ? 'No answers yet' : 'Noch keine Antworten');
    await expect(page.locator('#designAccounts .design-answer')).toHaveCount(0);
    await expect(page.locator('#designAccounts .design-answers-note')).toContainText(en ? 'Not asked yet: 31.' : 'Noch nicht gefragt: 31.');
    // The stored choice only applies while the 2026 design is released for everyone.
    for (const [mode, text] of [['owner', en ? 'Design 2026 is currently released to owners only (ROLLTHEDICE_ZDWA_DESIGN=owner).' : 'Design 2026 ist derzeit nur für Owner freigegeben (ROLLTHEDICE_ZDWA_DESIGN=owner).'], ['off', en ? 'Design 2026 is currently switched off (ROLLTHEDICE_ZDWA_DESIGN=off).' : 'Design 2026 ist derzeit abgeschaltet (ROLLTHEDICE_ZDWA_DESIGN=off).']]) {
      state.designMode = mode;
      await page.locator('#dashboardRefresh').click();
      await expect(page.locator('#designAccounts .design-mode-note')).toContainText(text);
    }
    state.designMode = 'all';
    await page.locator('#dashboardRefresh').click();
    await expect(page.locator('#designAccounts .design-mode-note')).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    for (const id of ['designComparison', 'designAccounts', 'designLooks', 'designTable', 'designCollectionNote']) await expect(page.locator(`#${id}`)).toBeEmpty();
  });
}
