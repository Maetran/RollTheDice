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
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
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
  test(`${language}: real active departure is confirmed, stops local audio and returns to the lobby`, async ({ page }, testInfo) => {
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
    const systemDialogs = [];
    page.on('dialog', dialog => { systemDialogs.push(dialog.message()); void dialog.dismiss(); });
    const dialog = page.locator('#appDialog[data-kind="hausdepp-departure"]');
    const cancel = dialog.locator('[data-dialog-action="cancel"]');
    const confirm = dialog.locator('[data-dialog-action="confirm"]');
    const close = dialog.locator('#appDialogClose');
    for (const [index, [width, height]] of [[320, 568], [375, 812], [844, 390], [1440, 900]].entries()) {
      await page.setViewportSize({ width, height });
      await leave.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAccessibleName(language === 'de' ? 'Turnier verlassen' : 'Leave tournament');
      await expect(cancel).toHaveText(language === 'de' ? 'Am Tisch bleiben' : 'Stay at the table');
      await expect(cancel).toBeFocused();
      const warning = await dialog.locator('#appDialogMessage').innerText();
      expect(warning).toContain(language === 'de' ? 'keine EP' : 'no XP');
      expect(warning).toContain(language === 'de' ? 'Die anderen spielen weiter' : 'The others keep playing');
      expect(warning).toContain(language === 'de' ? 'früherer Runden bleiben erhalten' : 'previous rounds are kept');
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
      for (const button of [cancel, confirm, close]) {
        await button.scrollIntoViewIfNeeded();
        await expect(button).toBeInViewport();
        const target = await button.boundingBox();
        expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
      }
      if (width === 375 || width === 844) await page.screenshot({ path: testInfo.outputPath(`departure-dialog-${language}-${width}x${height}.png`) });
      if (index === 1) {
        await confirm.focus(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab'); await expect(confirm).toBeFocused();
        await page.keyboard.press('Escape');
      } else if (index === 2) await close.click();
      else if (index === 3) await page.locator('#appDialogBackdrop').click({ position: { x: 2, y: 2 } });
      else await cancel.click();
      await expect(dialog).not.toBeVisible(); await expect(leave).toBeFocused();
      expect(app.sent.some(message => message.action === 'hausdepp_leave_game')).toBe(false);
    }
    expect(systemDialogs).toEqual([]);
    // The real CPUs may still be lifting the stock while the cancelled dialogs
    // are checked. Confirm only after the human owns a stable decision window;
    // a departure sent during a CPU transition is correctly rejected as stale.
    const board = () => app.received.findLast(message => message.scoreboard?._hausdepp)?.scoreboard?._hausdepp;
    await expect.poll(() => {
      const current = board();
      return Boolean(current && current.current_player_id === current.viewer_id
        && current.available_actions.length && !current.afterthrow
        && !current.pending_refill && current.pending_refills.length === 0);
    }).toBe(true);
    await expect(leave).toBeEnabled();
    const confirmedVersion = board().version;
    await leave.click();
    await expect(dialog).toBeVisible();
    await confirm.click();
    await expect(page).toHaveURL(url => url.pathname === '/hausdepp');
    const departure = app.sent.filter(message => message.action === 'hausdepp_leave_game');
    expect(departure).toHaveLength(1); expect(departure[0].version).toBe(confirmedVersion);
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
  await leave.click();
  const dialog = page.locator('#appDialog[data-kind="hausdepp-departure"]');
  await expect(dialog).toBeVisible();
  const warning = await dialog.locator('#appDialogMessage').innerText();
  expect(warning).toContain('reguläres Rundenergebnis'); expect(warning).not.toContain('keine EP');
  expect(warning).toContain('früherer Runden bleiben erhalten');
  await dialog.locator('[data-dialog-action="cancel"]').click();
  await expect(dialog).not.toBeVisible();
  await expect(leave).toBeFocused();
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
    await guest.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
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
    await guest.locator('#hausdeppLeaveGame').click();
    await guest.locator('#appDialog[data-kind="hausdepp-departure"] [data-dialog-action="confirm"]').click();
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
    else if (actions.includes('play')) await page.locator(`#hausdeppHand button[data-card-id="${board().playable_cards[0]}"]`).click();
    else {
      await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-pickup-available', 'true');
      await page.locator('#hausdeppPile').click();
    }
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

for (const language of ['de', 'en']) {
  for (const stage of ['waiting', 'active']) {
    test(`${language}: a spectator leaves a real ${stage} table locally across display sizes`, async ({ page, browser, baseURL }, testInfo) => {
      const app = await setup(page, language, { cpuCount: stage === 'waiting' ? 1 : 2 });
      await page.goto(app.room);
      await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', stage === 'waiting' ? 'waiting' : 'peeking');
      // A spectator owns no seat. Reusing the host's account would resume its
      // waiting table after the return to the lobby and open a new player socket.
      const username = `DWatch${language}${stage}${Date.now()}`;
      const temporary = 'departure-watcher-temporary-123', password = 'departure-watcher-final-123';
      const created = await page.request.post('/api/admin/users', { headers: page.departureOwner.headers,
        data: { username, temporary_password: temporary, role: 'user' } });
      expect(created.status()).toBe(201);
      const watcherContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      try {
        const watcher = await watcherContext.newPage(), sent = [], received = [], dialogs = [];
        const initial = await watcher.request.post('/api/auth/login', { data: { username, password: temporary } });
        expect(initial.ok()).toBeTruthy();
        const initialUser = (await initial.json()).user;
        const changed = await watcher.request.post('/api/auth/change-password', { headers: { 'X-CSRF-Token': initialUser.csrf_token },
          data: { current_password: temporary, new_password: password } });
        expect(changed.ok()).toBeTruthy();
        const login = await watcher.request.post('/api/auth/login', { data: { username, password } });
        expect(login.ok()).toBeTruthy();
        const user = (await login.json()).user;
        const languagePreference = await watcher.request.put('/api/auth/preferences/language', { headers: { 'X-CSRF-Token': user.csrf_token },
          data: { preferred_language: language } });
        expect(languagePreference.ok()).toBeTruthy();
        await watcher.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
        await watcher.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
        await watcher.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
        await watcher.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
        watcher.on('dialog', dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
        watcher.on('websocket', socket => {
          if (!socket.url().endsWith(`/ws/${app.id}`)) return;
          socket.on('framesent', ({ payload }) => { try { sent.push(JSON.parse(String(payload))); } catch {} });
          socket.on('framereceived', ({ payload }) => { try { received.push(JSON.parse(String(payload))); } catch {} });
        });
        await watcher.goto(`${app.room}/zuschauen`);
        await expect.poll(() => received.some(message => message.scoreboard)).toBe(true);
        await expect.poll(() => app.received.filter(message => message.spectator?.event === 'joined' && message.spectator.name === username).length).toBe(1);
        const leave = watcher.locator('#hausdeppLeaveGame');
        await expect(leave).toHaveAccessibleName(language === 'de' ? 'Tisch verlassen' : 'Leave table');
        await expect(leave).toBeEnabled();
        for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1440, 900]]) {
          await watcher.setViewportSize({ width, height });
          await expect(leave).toBeInViewport();
          const bounds = await leave.boundingBox();
          expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
          const headerBounds = await watcher.locator('.hd-header').boundingBox();
          expect(bounds.y).toBeGreaterThanOrEqual(headerBounds.y + headerBounds.height);
          expect(bounds.y + bounds.height).toBeLessThanOrEqual(height);
          expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
          expect(await leave.evaluate(button => {
            const box = button.getBoundingClientRect();
            for (const x of [box.left + 2, box.left + box.width / 2, box.right - 2]) {
              for (const y of [box.top + 2, box.top + box.height / 2, box.bottom - 2]) {
                if (!button.contains(document.elementFromPoint(x, y))) return false;
              }
            }
            return true;
          })).toBe(true);
          await leave.click({ trial: true });
          expect(await watcher.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
          if (width === 320 || width === 844) await watcher.screenshot({ path: testInfo.outputPath(`spectator-exit-${width}x${height}.png`) });
        }
        const previous = (await (await page.request.get(`/api/games/${app.id}`)).json());
        await leave.click();
        await expect(watcher).toHaveURL(url => url.pathname === '/hausdepp');
        // A full navigation can discard Chromium's old DevTools socket-close
        // event. The host's real departure event proves server-side cleanup.
        await expect.poll(() => app.received.filter(message => message.spectator?.event === 'left' && message.spectator.name === username).length).toBe(1);
        expect(dialogs).toEqual([]);
        await expect(watcher.locator('#appDialogBackdrop')).not.toBeVisible();
        expect(sent.filter(message => typeof message.action === 'string').map(message => message.action)).toEqual(['spectate_game']);
        const current = await (await page.request.get(`/api/games/${app.id}`)).json();
        // The running game may deal cards or advance CPUs during navigation.
        // Leaving the spectator view must preserve seats and departure status.
        const seats = participants => participants.map(player => ({ id: player.id, user_id: player.user_id,
          is_cpu: player.is_cpu, connected: player.connected, withdrawn: player.withdrawn, departed: player.departed }));
        expect(previous.participants.length).toBeGreaterThan(0);
        expect(seats(current.participants)).toEqual(seats(previous.participants));
        expect(current.started).toBe(previous.started); expect(current.finished).toBe(previous.finished);
        expect(current.aborted).toBe(previous.aborted);
        await expect(page).toHaveURL(app.room);
      } finally { await watcherContext.close(); }
    });
  }
}
