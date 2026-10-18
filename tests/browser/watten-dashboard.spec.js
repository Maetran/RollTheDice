const { test, expect } = require('@playwright/test');
const { player } = require('./helpers/watten-journey.cjs');

test.use({ serviceWorkers: 'block', reducedMotion: 'reduce' });
const credentials = { username: 'Admin', password: 'temporary-password-123' };
const api = '/api/admin/analytics';
const nativeCard = page => page.locator('#gameCards [data-game="watten"]');
const numeric = (value, language) => new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'de-CH', {
  maximumFractionDigits: 0,
}).format(value);

function responseFor(page, game) {
  return page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === api && url.searchParams.get('game') === game;
  });
}

async function founder(page, language = 'de', design = 'mission') {
  const login = await page.request.post('/api/auth/login', { data: credentials });
  expect(login.ok()).toBeTruthy();
  const me = await (await page.request.get('/api/auth/me')).json();
  // This is the isolated server's real immutable founder seed, not a projected
  // /me fixture or a new permission. Fail clearly if the seed is unavailable.
  expect(me.authenticated).toBe(true);
  expect(me.user).toMatchObject({ is_founder: true, can_view_analytics: true });
  page.dashboardOwner = { language: me.user.preferences?.preferred_language || 'de', revoked: [] };
  expect((await page.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': me.user.csrf_token }, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  const proof = await page.request.get(`${api}?days=7&game=all`);
  expect(proof.status()).toBe(200);
  expect((await proof.json()).available_games).toContain('watten');
  await page.addInitScript(({ language, design }) => {
    if (!localStorage.getItem('zdwa_language')) localStorage.setItem('zdwa_language', language);
    localStorage.setItem('rollthedice:dashboard:design', design);
  }, { language, design });
  return me.user;
}

async function openNative(page) {
  const initial = responseFor(page, 'all');
  await page.goto('/admin/dashboard');
  expect((await initial).status()).toBe(200);
  await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#dashboardGame option[value=watten]')).toHaveCount(1);
  const response = responseFor(page, 'watten');
  await page.locator('#dashboardGame').selectOption('watten');
  const actual = await response;
  expect(actual.status()).toBe(200);
  const data = await actual.json();
  await expect(nativeCard(page)).toBeVisible();
  await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
  return data;
}

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
  if (!page.dashboardOwner) return;
  // Auth-race cases revoke the original session deliberately. Restore this
  // isolated seed account's language with a real new session during cleanup.
  const login = await page.request.post('/api/auth/login', { data: credentials });
  expect(login.ok()).toBeTruthy();
  const owner = (await login.json()).user;
  for (const id of page.dashboardOwner.revoked) {
    expect((await page.request.put(`/api/admin/users/${id}/analytics-access`, {
      headers: { 'X-CSRF-Token': owner.csrf_token }, data: { enabled: false },
    })).ok()).toBeTruthy();
  }
  expect((await page.request.put('/api/auth/preferences/language', {
    headers: { 'X-CSRF-Token': owner.csrf_token }, data: { preferred_language: page.dashboardOwner.language },
  })).ok()).toBeTruthy();
});

for (const language of ['de', 'en']) {
  for (const design of ['mission', 'lcars', 'nexus']) {
    test(`${language}/${design}: real founder-only native monitoring distinguishes unknown traffic from server counts on phones`, async ({ page }, testInfo) => {
      await founder(page, language, design);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const data = await openNative(page);
      expect(data.period).toMatchObject({ game: 'watten', timezone: 'UTC' });
      expect(data.available_games).toContain('watten');
      expect(data.metric_coverage).toMatchObject({ traffic: 'not_instrumented', request_traffic: 'sitewide',
        native_live_humans: 'distinct_authenticated_accounts', duration: 'validated_frozen_public_evidence' });
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(page.locator('body')).toHaveAttribute('data-dashboard-design', design);
      const row = data.games.find(item => item.game === 'watten');
      expect(row).toBeTruthy();
      const card = nativeCard(page);
      await expect(card.locator('.game-card-number')).toHaveText(numeric(row.completed_games, language));
      const cells = [
        ['Teilnahmen (Plätze inkl. Computer)', 'Participations (seats incl. computer)', row.participants],
        ['Dauer belegt', 'Duration recorded', row.duration_sample_count],
        ['Dauer unbekannt', 'Duration unknown', row.duration_unknown_count],
        ['Menschen verbunden', 'Humans connected', row.live.connected_humans],
        ['Computerplätze', 'Computer seats', row.live.cpu_seats],
        ['Erfasste Abbrüche', 'Recorded abandonments', row.abandoned_games],
      ];
      for (const [de, en, value] of cells) {
        const cell = card.locator('.game-card-details > span').filter({ hasText: language === 'de' ? de : en }).locator('strong');
        if (value === null) await expect(cell).toHaveText(/^—/);
        else await expect(cell).toHaveText(numeric(value, language)); // Includes actual measured zeros.
      }
      const duration = card.locator('[data-watten-duration]');
      if (row.duration_sample_count > 0) {
        await expect(duration).toContainText(language === 'de' ? 'Ø Partiedauer aus belegten Starts' : 'Avg. game duration from recorded starts');
        await expect(duration).toContainText(numeric(row.duration_sample_count, language));
      } else await expect(duration).toContainText(row.completed_games > 0
        ? (language === 'de' ? 'Keine Partie mit belegtem Start' : 'No game with a recorded start')
        : (language === 'de' ? 'Keine beendete Partie im Zeitraum.' : 'No completed game in this period.'));
      if (row.duration_unknown_count > 0) await expect(duration).toContainText(language === 'de' ? 'Ohne belegten Start' : 'Without a recorded start');
      if (row.duration_sample_truncated) await expect(duration).toContainText(numeric(row.duration_sample_limit, language));

      for (const metric of ['sessions', 'page-views', 'live-sessions', 'active-seconds', 'avg-active-seconds']) {
        await expect(page.locator(`[data-favorite-id="metric-${metric}"] .metric-value`)).toHaveText('—');
      }
      await expect(page.locator('#pwaInstalledCount')).toHaveText('—');
      await expect(page.locator('#pwaFirstOpenCount')).toHaveText('—');
      const unknown = language === 'de' ? 'Für Watten nicht erfasst' : 'Not measured for Watten';
      for (const id of ['dailyChart', 'hourlyChart', 'activityHeatmap', 'pageBubbles', 'journeyFlow']) {
        await expect(page.locator(`#${id}`)).toContainText(unknown);
        await expect(page.locator(`#${id} svg`)).toHaveCount(0);
      }
      await expect(page.locator('#geographyViz')).toBeHidden();
      await expect(page.locator('#geographyUnmeasured')).toBeVisible();
      await expect(page.locator('#geographyUnmeasured')).toContainText(unknown);
      await expect(page.locator('#geographyUnmeasured')).not.toContainText(language === 'de' ? 'Kartierte Länder' : 'Mapped countries');
      await expect(page.locator('#wattenMonitoringNote')).toContainText(language === 'de'
        ? 'HTTP-Anfragen und Serverressourcen gelten für die ganze Website'
        : 'HTTP requests and server resources cover the whole website');
      await expect(page.locator('#wattenMonitoringNote')).toContainText(language === 'de'
        ? 'CPU-Auslastung ist Hardwarelast' : 'CPU load is hardware load');
      await expect(page.locator('#serverGauges')).toContainText(language === 'de' ? 'CPU-Auslastung' : 'CPU usage');
      await expect(page.locator('label[for=dashboardDays]')).toContainText('UTC');
      await expect(page.locator('#requestTrafficSummary')).toContainText(language === 'de'
        ? 'Alle Spiele · Website gesamt' : 'All games · entire website');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        for (const control of await page.locator('#dashboardFilters select:visible, #dashboardRefresh:visible').all()) {
          const box = await control.boundingBox();
          expect(box.x).toBeGreaterThanOrEqual(-1);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
        }
        await page.locator('#games').screenshot({ path: testInfo.outputPath(`watten-dashboard-${language}-${design}-${viewport.width}x${viewport.height}.png`) });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('a real founder analytics response cannot install after a cookie-only account change', async ({ page, browser, baseURL }) => {
  const other = await player(browser, baseURL);
  const owner = await founder(page);
  let release;
  const released = new Promise(resolve => { release = resolve; });
  try {
    await openNative(page);
    let markHeld;
    const held = new Promise(resolve => { markHeld = resolve; });
    await page.route('**/api/admin/analytics?*', async route => {
      const response = await route.fetch(); // Authenticated, real A aggregate.
      expect(response.status()).toBe(200);
      markHeld();
      await released;
      await route.fulfill({ response });
    });
    await page.locator('#dashboardRefresh').click();
    await held;
    expect((await page.request.post('/api/auth/logout', {
      headers: { 'X-CSRF-Token': owner.csrf_token },
    })).ok()).toBeTruthy();
    const login = await page.request.post('/api/auth/login', {
      data: { username: other.user.username, password: 'watten-test-password-123-final' },
    });
    expect(login.ok()).toBeTruthy();
    const me = (await page.request.get('/api/auth/me'));
    expect((await me.json()).user).toMatchObject({ id: other.user.id, is_founder: false, can_view_analytics: false });
    expect((await page.request.get(`${api}?days=7&game=watten`)).status()).toBe(403);
    // Deliberately no synthetic auth-state/focus event: the body itself must
    // cause a fresh account check, not rely on another bundle noticing first.
    release();
    await expect(page.locator('#dashboardData')).toBeHidden();
    await expect(page.locator('#gameCards')).toBeEmpty();
    await expect(page.locator('#wattenMonitoringNote')).toHaveText('');
    await expect(page.locator('#dashboardMessage')).toBeVisible();
    await expect(page.locator('#dashboardGame option[value=watten]')).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); await other.context.close(); }
});

test('a persisted founder view clears synchronously and restores only a delegated account legacy scope', async ({ page, browser, baseURL }) => {
  const delegated = await player(browser, baseURL);
  const owner = await founder(page, 'en', 'nexus');
  try {
    // Existing, explicit founder-only delegation API; never grants founder or
    // Watten authority. The old analytics browser suite covers this same API.
    expect((await page.request.put(`/api/admin/users/${delegated.user.id}/analytics-access`, {
      headers: { 'X-CSRF-Token': owner.csrf_token }, data: { enabled: true },
    })).status()).toBe(200);
    page.dashboardOwner.revoked.push(delegated.user.id);
    await openNative(page);
    expect(await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      return { hidden: document.getElementById('dashboardData').hidden,
        cards: document.getElementById('gameCards').childElementCount,
        note: document.getElementById('wattenMonitoringNote').textContent };
    })).toEqual({ hidden: true, cards: 0, note: '' });
    expect((await page.request.post('/api/auth/logout', {
      headers: { 'X-CSRF-Token': owner.csrf_token },
    })).ok()).toBeTruthy();
    expect((await page.request.post('/api/auth/login', {
      data: { username: delegated.user.username, password: 'watten-test-password-123-final' },
    })).ok()).toBeTruthy();
    const me = (await (await page.request.get('/api/auth/me')).json()).user;
    expect(me).toMatchObject({ id: delegated.user.id, is_founder: false, can_view_analytics: true });
    expect((await page.request.get(`${api}?days=7&game=watten`)).status()).toBe(403);
    const allowed = await (await page.request.get(`${api}?days=7&game=all`)).json();
    expect(allowed.available_games).toEqual(['zdwa', 'zilch']);
    const fresh = page.waitForRequest(request => new URL(request.url()).pathname === '/api/auth/me');
    await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await fresh;
    await expect(page.locator('#dashboardData')).toBeVisible();
    await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#dashboardGame')).toHaveValue('all');
    await expect(page.locator('#dashboardGame option[value=watten]')).toHaveCount(0);
    await expect(nativeCard(page)).toHaveCount(0);
    await expect(page.locator('#wattenMonitoringNote')).toBeHidden();
    await expect(page.locator('#wattenMonitoringNote')).toHaveText('');
    expect(await page.locator('#gameCards [data-game]').evaluateAll(nodes => nodes.map(node => node.dataset.game)))
      .toEqual(['zdwa', 'zilch']);
  } finally { await delegated.context.close(); }
});

test('a delegated dashboard binds its analytics request across a cookie B to founder A to B round trip', async ({ page, browser, baseURL }) => {
  const delegated = await player(browser, baseURL);
  const owner = await founder(page);
  let release;
  const released = new Promise(resolve => { release = resolve; });
  let observed;
  try {
    expect((await page.request.put(`/api/admin/users/${delegated.user.id}/analytics-access`, {
      headers: { 'X-CSRF-Token': owner.csrf_token }, data: { enabled: true },
    })).status()).toBe(200);
    page.dashboardOwner.revoked.push(delegated.user.id);
    const loginB = () => page.request.post('/api/auth/login', {
      data: { username: delegated.user.username, password: 'watten-test-password-123-final' },
    });
    expect((await loginB()).ok()).toBeTruthy();
    const initial = responseFor(page, 'all');
    await page.goto('/admin/dashboard');
    const bResponse = await initial;
    expect(bResponse.status()).toBe(200);
    expect((await bResponse.json()).available_games).toEqual(['zdwa', 'zilch']);
    await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#gameCards .game-card')).toHaveCount(2);
    await expect(page.locator('#dashboardGame option[value=watten]')).toHaveCount(0);
    observed = await page.evaluateHandle(() => {
      const seen = [];
      const observer = new MutationObserver(() => {
        if (document.querySelector('#gameCards [data-game="watten"]')) seen.push('watten');
      });
      observer.observe(document.getElementById('gameCards'), { childList: true, subtree: true });
      return { seen, stop: () => observer.disconnect() };
    });

    let markHeld, first = null, nextScope = null;
    const held = new Promise(resolve => { markHeld = resolve; });
    await page.route('**/api/admin/analytics?*', async route => {
      const isFirst = first === null;
      if (isFirst) first = { expected: route.request().headers()['x-analytics-expected-account-id'] };
      const response = await route.fetch(); // No response/authority is fabricated.
      const body = await response.json();
      if (isFirst) {
        first.status = response.status();
        first.detail = body.detail;
        first.cacheControl = response.headers()['cache-control'];
        // Before the fix this real request returns A's private four-product
        // aggregate. After the fix the captured B binding rejects it first.
        if (response.status() === 200) expect(body.available_games).toContain('watten');
        else expect(response.status()).toBe(409);
        markHeld();
        await released;
      } else {
        expect(response.status()).toBe(200);
        nextScope = body.available_games;
      }
      await route.fulfill({ response });
    });
    // The mounted UI is still B. Cookie changes through real login API calls
    // do not publish this document's shared auth-state event.
    expect((await page.request.post('/api/auth/login', { data: credentials })).ok()).toBeTruthy();
    expect((await (await page.request.get('/api/auth/me')).json()).user)
      .toMatchObject({ id: owner.id, is_founder: true });
    await page.locator('#dashboardRefresh').click();
    await held;
    expect((await loginB()).ok()).toBeTruthy();
    expect((await (await page.request.get('/api/auth/me')).json()).user)
      .toMatchObject({ id: delegated.user.id, is_founder: false, can_view_analytics: true });
    release();
    await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#gameCards .game-card')).toHaveCount(2);
    await expect(nativeCard(page)).toHaveCount(0);
    await expect(page.locator('#dashboardGame option[value=watten]')).toHaveCount(0);
    await expect(page.locator('#wattenMonitoringNote')).toHaveText('');
    expect(await observed.evaluate(state => state.seen)).toEqual([]);
    expect(first).toEqual({ expected: String(delegated.user.id), status: 409,
      detail: 'analytics_account_changed', cacheControl: 'no-store' });
    await expect.poll(() => nextScope).toEqual(['zdwa', 'zilch']);
    await expect(page.locator('#dashboardData')).toBeVisible();
    await expect(page.locator('#dashboardData')).toHaveAttribute('aria-busy', 'false');
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
    if (observed) { await observed.evaluate(state => state.stop()); await observed.dispose(); }
    await delegated.context.close();
  }
});
