const { test, expect } = require('@playwright/test');
const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

async function setup(page, language = 'de', { cpuCount = 2, freshActor = false } = {}) {
  const response = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(response.ok()).toBeTruthy();
  let user = (await response.json()).user;
  if (freshActor) {
    // Real forfeitures earn a durable Zonk. Keep that result and its pending
    // notice on this test's own account, away from the suite's shared Admin.
    const username = `DepartureActor${language}${Date.now()}`;
    const temporary = 'departure-actor-temporary-123', password = 'departure-actor-final-123';
    const created = await page.request.post('/api/admin/users', { headers: { 'X-CSRF-Token': user.csrf_token },
      data: { username, temporary_password: temporary, role: 'user' } });
    expect(created.status()).toBe(201);
    const initial = await page.request.post('/api/auth/login', { data: { username, password: temporary } });
    expect(initial.ok()).toBeTruthy();
    const initialUser = (await initial.json()).user;
    const changed = await page.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': initialUser.csrf_token },
      data: { current_password: temporary, new_password: password } });
    expect(changed.ok()).toBeTruthy();
    const login = await page.request.post('/api/auth/login', { data: { username, password } });
    expect(login.ok()).toBeTruthy();
    user = (await login.json()).user;
  }
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.departureOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
  await page.route('**/api/hausdepp/invitations', route => route.fulfill({ json: { invitations: [] } }));
  const sent = [], received = [];
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => { try { sent.push(JSON.parse(String(payload))); } catch {} });
    socket.on('framereceived', ({ payload }) => { try { received.push(JSON.parse(String(payload))); } catch {} });
  });
  const created = await page.request.post('/api/games', { headers,
    data: { name: 'Departure browser test', game_type: 'hausdepp', mode: '3', play_mode: 'cpu', cpu_count: cpuCount, tournament: true } });
  expect(created.ok(), await created.text()).toBeTruthy();
  const id = (await created.json()).game_id;
  return { id, sent, received, room: `/hausdepp/spiel/${id}` };
}

test.afterEach(async ({ page }) => {
  if (page.departureOwner) await page.request.put('/api/auth/preferences/language', {
    headers: page.departureOwner.headers, data: { preferred_language: page.departureOwner.language },
  });
});

for (const language of ['de', 'en']) {
  test(`${language}: real active departure is confirmed, stops local audio and returns to the lobby`, async ({ page }) => {
    const app = await setup(page, language, { freshActor: true });
    let closedContexts = 0;
    await page.exposeFunction('__departureContextClosed', () => { closedContexts++; });
    await page.addInitScript(() => {
      const NativeContext = window.AudioContext || window.webkitAudioContext;
      window.AudioContext = class extends NativeContext {
        close() { void window.__departureContextClosed(); return super.close(); }
      };
    });
    await page.goto(app.room);
    const leave = page.locator('#hausdeppLeaveGame');
    await expect(leave).toBeVisible();
    await expect(leave).toHaveAccessibleName(language === 'de' ? 'Turnier verlassen' : 'Leave tournament');
    for (const [width, height] of [[320, 740], [390, 844], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      await expect(leave).toBeInViewport();
      const bounds = await leave.boundingBox(); expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    await page.locator('#hausdeppSound').click();
    await expect(page.locator('#hausdeppSound')).toHaveAttribute('aria-pressed', 'true');
    let warning;
    page.once('dialog', async dialog => { warning = dialog.message(); await dialog.dismiss(); });
    await leave.click();
    expect(warning).toContain(language === 'de' ? 'keine EP' : 'no XP');
    expect(warning).toContain(language === 'de' ? 'Die anderen spielen weiter' : 'The others keep playing');
    expect(warning).toContain(language === 'de' ? 'früherer Runden bleiben erhalten' : 'previous rounds are kept');
    expect(app.sent.some(message => message.action === 'hausdepp_leave_game')).toBe(false);
    page.once('dialog', dialog => dialog.accept());
    await leave.click();
    await expect(page).toHaveURL(url => url.pathname === '/hausdepp');
    const departure = app.sent.filter(message => message.action === 'hausdepp_leave_game');
    expect(departure).toHaveLength(1); expect(Number.isSafeInteger(departure[0].version)).toBe(true);
    expect(app.sent.some(message => message.action === 'end_game')).toBe(false);
    expect(app.received.some(message => message.left_hausdepp_game === true)).toBe(true);
    await expect.poll(() => closedContexts).toBeGreaterThanOrEqual(1);
    await page.goto('/hausdepp/konto#erfolge');
    await page.locator('#hausdeppAchievementCategory').selectOption('zonk');
    const zonk = page.locator('[data-achievement-id="hausdepp_136"]');
    await expect(zonk).toBeVisible(); await expect(zonk).toHaveClass(/is-unlocked/);
    await expect(zonk.locator('.hd-achievement-points')).toHaveText(language === 'de' ? '0 EP' : '0 XP');
  });
}

test('a regularly finished hand can leave between tournament rounds without a forfeiture warning', async ({ page }) => {
  const app = await setup(page); await page.goto(app.room);
  await expect(page.locator('#hausdeppLeaveGame')).toBeVisible();
  const board = structuredClone(app.received.findLast(message => message.scoreboard?._hausdepp).scoreboard);
  const self = board._hausdepp.viewer_id, others = board._hausdepp.players.filter(player => player.id !== self), loser = others.at(-1).id;
  Object.assign(board, { _finished: true, _aborted: false, _paused: false,
    _departure_permissions: { can_leave: true, forfeits_round: false, ends_tournament_participation: true } });
  Object.assign(board._hausdepp_tournament, { round_complete: true, completed: false, can_start_next_round: true });
  Object.assign(board._hausdepp, { phase: 'finished', hand: [], deck_count: 0, discard: [], available_actions: [], playable_cards: [],
    current_player_id: null, loser_id: loser, finished_order: [self, ...others.filter(player => player.id !== loser).map(player => player.id)],
    pending_refills: [], pending_refill: null, afterthrow: null, draw_required: false, draw_urgent: false, stock_blocked_by: null });
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player, finished: player.id !== loser, hand_count: player.id === loser ? 1 : 0 }));
  await page.routeWebSocket(new RegExp(`/ws/${app.id}$`), socket => socket.onMessage(raw => {
    const message = JSON.parse(String(raw));
    if (handleDisabledHausdeppVoice(socket, message)) return;
    if (message.action === 'join_game') socket.send(JSON.stringify({ player_id: self, scoreboard: board }));
  }));
  await page.reload();
  const leave = page.locator('#hausdeppLeaveGameResult'); await expect(leave).toBeVisible();
  let warning;
  page.once('dialog', async dialog => { warning = dialog.message(); await dialog.dismiss(); });
  await leave.click();
  expect(warning).toContain('reguläres Rundenergebnis'); expect(warning).not.toContain('keine EP');
  expect(warning).toContain('früherer Runden bleiben erhalten');
  await expect(page).toHaveURL(app.room);
});

test('history keeps remaining and withdrawn outcomes distinct from regular finishes', async ({ page }) => {
  await setup(page);
  const response = await page.request.get('/api/hausdepp/account');
  expect(response.ok()).toBeTruthy();
  const account = await response.json();
  account.history = { next_cursor: null, rounds: [{ game_id: 'labelled-remaining-round', name: 'Labelled departure outcome',
    finished_at: '2026-10-20T12:00:00Z', outcome: 'remaining', finished_position: null, participant_count: 2, cpu_count: 0,
    participants: [{ id: 'self', name: 'Admin', outcome: 'remaining', finished_position: null, is_cpu: false },
      { id: 'other', name: 'Labelled former player', outcome: 'withdrawn', finished_position: null, is_cpu: false }] }] };
  await page.route('**/api/hausdepp/account?*', route => route.fulfill({ json: account }));
  await page.goto('/hausdepp/konto#runden');
  const row = page.locator('[data-round-id="labelled-remaining-round"]');
  await expect(row.locator('.hd-outcome')).toHaveText('Verblieben');
  await row.locator('summary').click();
  await expect(row.locator('.hd-history-players li')).toHaveText(['AdminVerblieben', 'Labelled former playerAusgestiegen']);
  await expect(row).not.toContainText('Fertig');
  await expect(row).not.toContainText('Ausstiegsposition');
});

test('a real participant leaves two other players in the same playable table with no forfeited-round XP', async ({ page, browser, baseURL }) => {
  test.setTimeout(45000);
  const app = await setup(page, 'de', { cpuCount: 1 });
  const guestContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
  try {
    const guest = await guestContext.newPage(), username = `Departure${Date.now()}`;
    const temporary = 'departure-temporary-password-123', password = 'departure-fixture-password-123';
    const created = await page.request.post('/api/admin/users', { headers: page.departureOwner.headers,
      data: { username, temporary_password: temporary, role: 'user' } });
    expect(created.status()).toBe(201);
    const initial = await guest.request.post('/api/auth/login', { data: { username, password: temporary } });
    expect(initial.ok()).toBeTruthy();
    const initialUser = (await initial.json()).user;
    const changed = await guest.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': initialUser.csrf_token },
      data: { current_password: temporary, new_password: password } });
    expect(changed.ok()).toBeTruthy();
    const login = await guest.request.post('/api/auth/login', { data: { username, password } });
    expect(login.ok()).toBeTruthy();
    await guest.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
    await guest.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
    await guest.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
    await page.goto(app.room); await guest.goto(app.room);
    const board = () => app.received.findLast(message => message.scoreboard?._hausdepp)?.scoreboard?._hausdepp;
    await expect.poll(() => Boolean(board())).toBe(true);
    // Complete actual private bottom peeks through the designated person's UI.
    for (let step = 0; step < 24 && board().phase !== 'playing'; step++) {
      const previous = board().version;
      if (await page.locator('#hausdeppStock').isEnabled()) await page.locator('#hausdeppStock').click();
      else if (await guest.locator('#hausdeppStock').isEnabled()) await guest.locator('#hausdeppStock').click();
      await expect.poll(() => board().version).toBeGreaterThan(previous);
    }
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    const person = board().players.find(player => player.name === username);
    expect(person.hand_count).toBeGreaterThan(0);
    const priorBurned = board().burned_count, removedCards = person.hand_count;
    guest.once('dialog', dialog => dialog.accept());
    await guest.locator('#hausdeppLeaveGame').click();
    await expect(guest).toHaveURL(url => url.pathname === '/hausdepp');
    await expect.poll(() => board().players.find(player => player.id === person.id).withdrawn).toBe(true);
    expect(board().players.find(player => player.id === person.id).hand_count).toBe(0);
    expect(board().burned_count).toBeGreaterThanOrEqual(priorBurned + removedCards);
    await expect(page).toHaveURL(app.room);
    await expect(page.locator(`[data-player-id="${person.id}"] .hd-seat-count`)).toHaveText('Ausgestiegen');
    const acceptedBefore = app.received.filter(message => message.hausdepp_command?.accepted).length;
    await expect.poll(() => board().current_player_id === board().viewer_id
      && board().available_actions.some(action => ['play', 'pickup', 'gamble'].includes(action))).toBe(true);
    const actions = board().available_actions;
    if (actions.includes('gamble')) await page.locator('#hausdeppStock').click();
    else if (actions.includes('play')) await page.locator(`[data-card-id="${board().playable_cards[0]}"]`).click();
    else await page.locator('#hausdeppPile').click();
    await expect.poll(() => app.received.filter(message => message.hausdepp_command?.accepted).length).toBeGreaterThan(acceptedBefore);
    await guest.goto('/hausdepp/konto#erfolge'); await guest.reload();
    const progress = await guest.request.get('/api/hausdepp/account');
    expect(progress.ok()).toBeTruthy();
    const account = await progress.json();
    expect(account.scoring.round_points).toBe(0); expect(account.scoring.points).toBe(0);
    expect(account.history.rounds).toHaveLength(0);
    expect(account.achievements.items.filter(item => item.unlocked).map(item => item.id)).toEqual(['hausdepp_136']);
    await guest.locator('#hausdeppAchievementCategory').selectOption('zonk');
    await expect(guest.locator('[data-achievement-id="hausdepp_136"] .hd-achievement-points')).toHaveText('0 EP');
  } finally { await guestContext.close(); }
});
