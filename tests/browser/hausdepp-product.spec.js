const { isHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function productAccount(page, language = 'de') {
  // Private account pages require a completed native password setup. Never
  // change the shared bootstrap Admin password used by the other test files.
  const bootstrap = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(bootstrap.ok()).toBeTruthy();
  const administrator = (await bootstrap.json()).user;
  const username = `HouseProduct${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const temporary = 'house-product-temporary-123', password = 'house-product-final-123';
  const created = await page.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': administrator.csrf_token }, data: { username, temporary_password: temporary, role: 'user' },
  });
  expect(created.status()).toBe(201);
  const initial = await page.request.post('/api/auth/login', { data: { username, password: temporary } });
  expect(initial.ok()).toBeTruthy();
  const firstUser = (await initial.json()).user;
  expect(firstUser.must_change_password).toBe(true);
  expect((await page.request.post('/api/auth/change-password', {
    headers: { 'X-CSRF-Token': firstUser.csrf_token }, data: { current_password: temporary, new_password: password },
  })).ok()).toBeTruthy();
  const signedIn = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(signedIn.ok()).toBeTruthy();
  const user = (await signedIn.json()).user;
  expect(user.must_change_password).toBe(false);
  expect(user.is_owner).toBe(false); expect(user.is_admin).toBe(false);
  const headers = { 'X-CSRF-Token': user.csrf_token };
  expect((await page.request.put('/api/auth/preferences/language', {
    headers, data: { preferred_language: language },
  })).ok()).toBeTruthy();
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  return headers;
}

function accountFixture(language) {
  const makeRound = (index, outcome) => ({
    game_id: `labelled-history-${index}`, name: `${language === 'de' ? 'Testansicht' : 'Test view'} <Tisch ${index}>`,
    finished_at: `2026-10-${String(index).padStart(2, '0')}T12:00:00+00:00`,
    player_id: 'self', outcome, finished_position: outcome === 'finished' ? 1 : null,
    participant_count: 2, cpu_count: 1,
    participants: [
      { id: 'self', name: 'Admin', is_cpu: false, outcome, finished_position: outcome === 'finished' ? 1 : null },
      { id: 'cpu-1', name: 'CPU 1', is_cpu: true, outcome: outcome === 'finished' ? 'hausdepp' : 'finished', finished_position: outcome === 'finished' ? null : 1 },
    ],
  });
  return {
    schema_version: 1, game_type: 'hausdepp',
    statistics: { rounds_played: 37, hausdepp_rounds: 12, finished_rounds: 25, last_finished_at: '2026-10-16T12:00:00+00:00' },
    history: { rounds: [makeRound(16, 'finished'), makeRound(15, 'hausdepp')], next_cursor: 'labelled-next-page' },
    scoring: { available: false }, achievements: { available: false, direction: 'clever_to_hausdepp' },
  };
}

for (const language of ['de', 'en']) {
  test(`${language}: dedicated account keeps private results and common settings reachable`, async ({ page }) => {
    await productAccount(page, language);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/hausdepp/konto');
    await expect(page.locator('main[data-page="account"]')).toBeVisible();
    await expect(page.locator('#hausdeppAccountStats')).toBeVisible();
    await expect(page.locator('#hausdeppHistory')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('.hd-nav a[href="/hausdepp/konto"][aria-current="page"]')).toBeVisible();
    const account = await page.request.get('/api/hausdepp/account');
    expect(account.status()).toBe(200);
    expect(account.headers()['cache-control']).toBe('no-store');
    expect((await account.json()).achievements.available).toBe(true);
    await page.locator('.hd-account-settings a[href="/hausdepp/konto/einstellungen"]').click();
    await expect(page).toHaveURL(/\/hausdepp\/konto\/einstellungen$/);
    await expect(page.locator('.hd-settings')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
    expect(errors).toEqual([]);
  });

  test(`${language}: labelled legacy history paginates without inventing points or links`, async ({ page }) => {
    await productAccount(page, language);
    const fixture = accountFixture(language);
    await page.route('**/api/hausdepp/account?**', async route => {
      const next = new URL(route.request().url()).searchParams.has('before');
      const data = structuredClone(fixture);
      if (next) data.history = { rounds: [{ ...fixture.history.rounds[0], game_id: 'labelled-history-14', name: 'Older <round>' }], next_cursor: null };
      await route.fulfill({ json: data });
    });
    await page.goto('/hausdepp/konto');
    await expect(page.locator('#hausdeppAccountStats')).toContainText('37');
    await expect(page.locator('#hausdeppHistory')).toContainText('<Tisch 16>');
    await expect(page.locator('#hausdeppHistory script, #hausdeppHistory Tisch')).toHaveCount(0);
    await expect(page.locator('#hausdeppHistory a[href*="/spiel/"]')).toHaveCount(0);
    await page.locator('#hausdeppHistoryMore').click();
    await expect(page.locator('#hausdeppHistory')).toContainText('Older <round>');
    await expect(page.locator('#hausdeppHistoryMore')).toBeHidden();
    await expect(page.locator('#hausdeppHistory')).toContainText('<Tisch 16>');
    await expect(page.locator('body')).toContainText(language === 'de' ? /Hausdepp/ : /Hausdepp/);
  });

  test(`${language}: rules explain timing and connect every section anchor`, async ({ page }) => {
    await productAccount(page, language);
    await page.goto('/hausdepp/regeln');
    await expect(page.locator('h1')).toContainText('Hausdepp');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const text = await page.locator('main').innerText();
    expect(text).toMatch(language === 'de' ? /Nachwerfen/ : /additional|throw|adding|add more/i);
    expect(text).toMatch(language === 'de' ? /drei|3/ : /three|3/);
    expect(text).toMatch(language === 'de' ? /Zocken|zocken/ : /chance/i);
    const targets = await page.locator('main a[href^="#"]').evaluateAll(links => links.map(link => link.hash.slice(1)));
    expect(targets.length).toBeGreaterThan(3);
    for (const id of targets) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index, follow$/);
  });
}

test('account load failure recovers through its visible retry action', async ({ page }) => {
  await productAccount(page);
  let failed = false;
  await page.route('**/api/hausdepp/account?**', async route => {
    if (!failed) { failed = true; await route.fulfill({ status: 503, json: { detail: 'labelled_test_failure' } }); }
    else await route.fulfill({ json: { ...accountFixture('de'), history: { rounds: [], next_cursor: null } } });
  });
  await page.goto('/hausdepp/konto');
  await page.locator('#hausdeppAccountRetry').click();
  await expect(page.locator('#hausdeppAccountStats')).toContainText('37');
  await expect(page.locator('#hausdeppHistoryMore')).toBeHidden();
});

test('suite switch reaches ZDWA and returns to the public Hausdepp lobby', async ({ page }) => {
  await productAccount(page);
  await page.goto('/hausdepp/konto');
  await page.locator('[data-game-switch]').click();
  await page.locator('#suiteGameMenu').getByRole('link', { name: 'ZDWA', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.locator('[data-game-switch]').click();
  await page.locator('#suiteGameMenu').getByRole('link', { name: 'Hausdepp', exact: true }).click();
  await expect(page).toHaveURL(/\/hausdepp$/);
  await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
});

test('suite switch is visibly disabled while the second auth refresh is pending', async ({ page }) => {
  await productAccount(page);
  let authRequests = 0;
  let refreshHeld = false;
  let releaseRefresh;
  const pendingRefresh = new Promise(resolve => { releaseRefresh = resolve; });
  await page.route('**/api/auth/me', async route => {
    if (++authRequests === 2) {
      refreshHeld = true;
      await pendingRefresh;
    }
    await route.continue();
  });
  try {
    await page.goto('/hausdepp/konto');
    await expect.poll(() => refreshHeld).toBe(true);
    const switchButton = page.locator('[data-game-switch]');
    await expect(switchButton).toBeVisible();
    await expect(switchButton).toBeDisabled();
    await expect(page.locator('#suiteGameMenu')).toHaveCount(0);

    releaseRefresh();
    await expect(switchButton).toBeEnabled();
    await switchButton.click();
    await page.locator('#suiteGameMenu').getByRole('link', { name: 'ZDWA', exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  } finally {
    releaseRefresh();
  }
});

test('waiting table retains real seats and the lobby resumes the same account seat', async ({ page }) => {
  const headers = await productAccount(page);
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Waiting product test', mode: '3', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).game_id;
  await page.goto(`/hausdepp/spiel/${id}`);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  await expect(page.locator('#hausdeppWaitingCount')).toHaveText('Noch 1 frei.');
  await expect(page.locator('#hausdeppWaitingSeats > li')).toHaveCount(3);
  await expect(page.locator('#hausdeppCopyTable')).toBeEnabled();
  await expect.poll(async () => {
    const game = await (await page.request.get(`/api/games/${id}`)).json();
    return game.participants?.filter(player => !player.is_cpu).length;
  }).toBe(1);
  const participants = (await (await page.request.get(`/api/games/${id}`)).json()).participants;
  const computer = participants.find(player => player.is_cpu);
  expect(computer.name).not.toMatch(/^CPU \d+$/);
  await expect(page.locator('main')).toContainText(computer.name);
  await page.goto('/hausdepp');
  const row = page.locator(`article[data-table-id="${id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Waiting product test');
  await row.locator(`a[href="/hausdepp/spiel/${id}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${id}$`));
  const game = await (await page.request.get(`/api/games/${id}`)).json();
  expect(game.participants.filter(player => !player.is_cpu)).toHaveLength(1);
});

test('explicit spectator route sends a read-only action and receives no private hand', async ({ page }) => {
  const headers = await productAccount(page);
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Spectator product test', mode: '2', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
  });
  const id = (await created.json()).game_id;
  await page.goto(`/hausdepp/spiel/${id}`);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
  const commands = [], voiceCommands = [], states = [];
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => {
      try {
        const command = JSON.parse(String(payload));
        (isHausdeppVoice(command) ? voiceCommands : commands).push(command);
      } catch {}
    });
    socket.on('framereceived', ({ payload }) => { try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) states.push(message.scoreboard._hausdepp); } catch {} });
  });
  await page.goto(`/hausdepp/spiel/${id}/zuschauen`);
  await expect.poll(() => states.length).toBeGreaterThan(0);
  expect(commands.some(command => command.action === 'spectate_game')).toBe(true);
  expect(commands.some(command => command.action === 'join_game')).toBe(false);
  expect(states.at(-1).hand).toEqual([]);
  expect(states.at(-1).available_actions).toEqual([]);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(0);
});

test('capture product pages across responsive viewports', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_PRODUCT_CAPTURE !== '1', 'One explicit evidence batch after interactions pass.');
  const headers = await productAccount(page);
  await mkdir('.impeccable/review', { recursive: true });
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Responsive Wartetisch', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
  });
  const waitingId = (await created.json()).game_id;
  await page.goto(`/hausdepp/spiel/${waitingId}`);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  const sizes = [
    ['phone-portrait', 390, 844], ['phone-landscape', 844, 390],
    ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768],
    ['desktop-portrait', 900, 1440], ['desktop-landscape', 1440, 900],
  ];
  for (const [name, width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const [section, url] of [['lobby', '/hausdepp'], ['account', '/hausdepp/konto'], ['rules', '/hausdepp/regeln']]) {
      await page.goto(url);
      await expect(page.locator('body')).not.toHaveClass(/hd-loading/);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      expect(overflow, `${section} ${name} page overflow`).toBe(false);
      await page.screenshot({ path: `.impeccable/review/hausdepp-product-${section}-${name}.png`, fullPage: section !== 'rules' });
    }
    // Explicitly labelled renderer fixture supplements the real empty account.
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: accountFixture('de') }));
    await page.goto('/hausdepp/konto');
    await expect(page.locator('#hausdeppHistory')).toContainText('Testansicht');
    await page.screenshot({ path: `.impeccable/review/hausdepp-product-account-history-fixture-${name}.png`, fullPage: true });
    await page.unroute('**/api/hausdepp/account?**');
    if (['phone-portrait', 'phone-landscape', 'tablet-landscape'].includes(name)) {
      await page.goto(`/hausdepp/spiel/${waitingId}`);
      await expect(page.locator('#hausdeppWaiting')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
      await page.screenshot({ path: `.impeccable/review/hausdepp-product-waiting-${name}.png`, fullPage: true });
    }
  }
});
