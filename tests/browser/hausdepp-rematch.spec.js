const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
test.beforeAll(({ baseURL }) => expect(['8000', '8001']).not.toContain(new URL(baseURL).port));

async function setup(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.rematchRestore = { headers, language: user.preferences.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 0 } }));
  let queue = [], failures = 0;
  const actions = [], connections = [];
  page.on('websocket', socket => connections.push(socket.url()));
  await page.route('**/api/hausdepp/invitations', route => route.fulfill({ json: { invitations: queue } }));
  await page.route('**/api/hausdepp/invitations/*/*', async route => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1);
    actions.push(action);
    if (failures-- > 0) return route.fulfill({ status: 503, json: { detail: 'temporary' } });
    const invitation = queue[0];
    queue = [];
    await route.fulfill({ json: action === 'accept' ? { game_id: invitation.game_id, url: 'https://external.invalid/' } : { ok: true } });
  });
  async function create(players = 3, cpus = 1) {
    const response = await page.request.post('/api/games', { headers, data: {
      name: 'Browser Test · Wieder am Tisch', mode: String(players), game_type: 'hausdepp', play_mode: cpus ? 'cpu' : 'multiplayer', cpu_count: cpus,
    } });
    expect(response.ok()).toBeTruthy();
    return (await response.json()).game_id;
  }
  return { user, create, actions, connections, queue(value) { queue = value; }, fail(value) { failures = value; } };
}

const invitation = id => ({ id: 'a'.repeat(32), game_id: id, url: 'https://external.invalid/',
  sender: { id: 900, username: 'Seppl' }, name: '<img src=x onerror=alert(1)>', players: 3, cpu_count: 1,
  tournament: true, locked: true, expires_at: new Date(Date.now() + 15 * 60_000).toISOString() });

test.afterEach(async ({ page }) => {
  if (page.rematchRestore) await page.request.put('/api/auth/preferences/language', {
    headers: page.rematchRestore.headers, data: { preferred_language: page.rematchRestore.language },
  });
});

for (const language of ['de', 'en']) {
  test(`${language}: invitation explains the table, waits for consent and accepts into a real waiting room`, async ({ page }, info) => {
    const fixture = await setup(page, language);
    const target = await fixture.create();
    fixture.queue([invitation(target)]);
    await page.goto('/hausdepp/konto');
    const dialog = page.locator('#appDialog');
    await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-rematch');
    await expect(page.locator('#appDialogMessage')).toBeVisible();
    await expect(dialog).toContainText('Seppl');
    await expect(dialog).toContainText('<img src=x onerror=alert(1)>');
    await expect(dialog.locator('img,script')).toHaveCount(0);
    await expect(dialog).toContainText(language === 'de' ? '3 Plätze' : '3 seats');
    await expect(dialog).toContainText(language === 'de' ? '1 Computer' : 'Computers: 1');
    await expect(dialog).toContainText(language === 'de' ? 'Stammtischturnier' : 'Table tournament');
    await expect(dialog).toContainText(language === 'de' ? 'Passwort' : 'password');
    expect(fixture.actions).toEqual([]);
    expect(fixture.connections.some(url => url.endsWith(`/ws/${target}`))).toBe(false);
    for (const [width, height] of [[320, 568], [844, 390], [1440, 900]]) {
      await page.setViewportSize({ width, height });
      const geometry = await dialog.evaluate(node => {
        const r = node.getBoundingClientRect();
        return { fits: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
          overflow: node.scrollWidth > node.clientWidth, buttons: [...node.querySelectorAll('button')].map(button => button.getBoundingClientRect().height) };
      });
      expect(geometry.fits).toBe(true); expect(geometry.overflow).toBe(false);
      for (const size of geometry.buttons) expect(size).toBeGreaterThanOrEqual(44);
      if (language === 'de') await page.screenshot({ path: info.outputPath(`rematch-${width}x${height}.png`) });
    }
    await page.locator('[data-dialog-action=accept]').click();
    await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
    await expect(page.locator('#hausdeppWaiting')).toBeVisible();
    await expect(page.locator('#hausdeppWaitingSeats li')).toHaveCount(3);
    await expect(page.locator('#hausdeppWaitingSeats').getByText('Computer', { exact: true })).toHaveCount(1);
    expect(fixture.actions).toEqual(['accept']);
  });

  test(`${language}: closing does not decline; an explicit decline stays on the current page`, async ({ page }) => {
    const fixture = await setup(page, language);
    fixture.queue([invitation(await fixture.create())]);
    await page.goto('/hausdepp');
    await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
    await page.keyboard.press('Escape');
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    expect(fixture.actions).toEqual([]);
    await page.reload();
    await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
    await page.locator('[data-dialog-action=decline]').click();
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    await expect(page).toHaveURL(/\/hausdepp$/);
    expect(fixture.actions).toEqual(['decline']);
  });
}

test('failed acceptance stays in the dialog and retries once without unsafe navigation', async ({ page }) => {
  const fixture = await setup(page);
  const target = await fixture.create();
  fixture.queue([invitation(target)]); fixture.fail(1);
  await page.goto('/hausdepp');
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
  await page.locator('[data-dialog-action=accept]').click();
  await expect(page.locator('#appDialog [role=alert]')).toContainText('Bitte versuche es nochmals');
  await expect(page).toHaveURL(/\/hausdepp$/);
  await expect(page.locator('[data-dialog-action=decline]')).toBeEnabled();
  await page.locator('[data-dialog-action=accept]').click();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
  expect(fixture.actions).toEqual(['accept', 'accept']);
});

test('hidden tabs release the invitation lock and a native pile dialog has priority without declining', async ({ page }) => {
  const fixture = await setup(page);
  fixture.queue([invitation(await fixture.create())]);
  await page.goto('/hausdepp');
  const modal = page.locator('#appDialogBackdrop');
  await expect(modal).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(modal).toBeHidden();
  await expect.poll(() => page.evaluate(async () => (await navigator.locks.query()).held.length)).toBe(0);
  expect(fixture.actions).toEqual([]);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(modal).toBeVisible();
  await page.evaluate(() => {
    const inspector = document.createElement('dialog');
    inspector.id = 'testPileInspector'; inspector.textContent = 'Paket ansehen';
    document.body.append(inspector); inspector.showModal();
  });
  await expect(modal).toBeHidden();
  expect(fixture.actions).toEqual([]);
  await page.evaluate(() => document.getElementById('testPileInspector').remove());
  await expect(modal).toBeVisible();
  expect(fixture.actions).toEqual([]);
});

async function finishedRenderer(page, fixture) {
  const id = await fixture.create(2, 1);
  let board;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) board = message.scoreboard; } catch {}
  }));
  await page.goto(`/hausdepp/spiel/${id}`);
  await expect.poll(() => Boolean(board?._hausdepp?.viewer_id)).toBe(true);
  const snapshot = structuredClone(board), self = snapshot._hausdepp.viewer_id;
  Object.assign(snapshot, { _finished: true, _aborted: false, _paused: false, _hausdepp_tournament: null });
  Object.assign(snapshot._hausdepp, { phase: 'finished', hand: [], discard: [], deck_count: 0,
    available_actions: [], playable_cards: [], current_player_id: null, finished_order: [self],
    loser_id: snapshot._hausdepp.players.find(player => player.id !== self).id, deal: null });
  const sent = [];
  let active;
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    active = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === 'join_game') socket.send(JSON.stringify({ scoreboard: snapshot, player_id: self }));
      else sent.push(message);
    });
  });
  await page.reload();
  await expect(page.locator('#hausdeppRecreate')).toBeVisible();
  return { id, snapshot, sent, send: next => active.send(JSON.stringify({ scoreboard: next })) };
}

for (const language of ['de', 'en']) {
  test(`${language}: create again uses the source ID, suppresses double clicks and enters the returned waiting room`, async ({ page }) => {
    const fixture = await setup(page, language);
    const source = await finishedRenderer(page, fixture);
    const target = await fixture.create();
    let calls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(`**/api/hausdepp/games/${source.id}/rematch`, async route => {
      calls++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({});
      await gate;
      await route.fulfill({ json: { game_id: target, url: 'https://external.invalid/', created: true, requires_acceptance: false } });
    });
    const recreate = page.locator('#hausdeppRecreate');
    await expect(recreate).toHaveText(language === 'de' ? 'Neu erstellen' : 'Create again');
    await recreate.click();
    await expect(recreate).toBeDisabled();
    expect(calls).toBe(1);
    release();
    await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
    await expect(page.locator('#hausdeppWaiting')).toBeVisible();
    expect(calls).toBe(1);
  });
}

test('an existing rematch requires this player’s explicit create click before accepting its reserved seat', async ({ page }) => {
  const fixture = await setup(page);
  const source = await finishedRenderer(page, fixture);
  const target = await fixture.create();
  fixture.queue([invitation(target)]);
  await page.route(`**/api/hausdepp/games/${source.id}/rematch`, route => route.fulfill({ json: {
    game_id: target, created: false, requires_acceptance: true, invitation_id: 'a'.repeat(32),
  } }));
  await page.locator('#hausdeppRecreate').click();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
  expect(fixture.actions).toEqual(['accept']);
});

test('leaving the page cancels an outstanding create response before it can accept or navigate', async ({ page }) => {
  const fixture = await setup(page);
  const source = await finishedRenderer(page, fixture);
  const target = await fixture.create();
  fixture.queue([invitation(target)]);
  let release, requested = false;
  const barrier = new Promise(resolve => { release = resolve; });
  await page.route(`**/api/hausdepp/games/${source.id}/rematch`, async route => {
    requested = true;
    await barrier;
    await route.fulfill({ json: { game_id: target, requires_acceptance: true, invitation_id: 'a'.repeat(32) } }).catch(() => {});
  });
  try {
    await page.locator('#hausdeppRecreate').click();
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    release();
    // The callback must not start its second, consent-granting request after
    // the page/account lifetime ends, even if the first HTTP reply arrives late.
    await expect(page.locator('#hausdeppRecreate')).toBeEnabled();
    expect(fixture.actions).toEqual([]);
    await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${source.id}$`));
  } finally { release(); }
});

test('a tournament interval keeps Next round and never replaces it with Create again', async ({ page }) => {
  const fixture = await setup(page);
  const source = await finishedRenderer(page, fixture);
  const board = structuredClone(source.snapshot);
  board._hausdepp_tournament = { round_number: 2, completed: false, can_start_next_round: true,
    letters: {}, losses: {}, tages_hausdepp_id: null };
  source.send(board);
  await expect(page.locator('#hausdeppNextRound')).toBeVisible();
  await expect(page.locator('#hausdeppRecreate')).toHaveCount(0);
  await page.locator('#hausdeppNextRound').click();
  await expect.poll(() => source.sent.some(message => message.action === 'hausdepp_next_round')).toBe(true);
});

for (const language of ['de', 'en']) {
  test(`${language}: timeout and aborted play release the table with a visible unscored ending and recreate action`, async ({ page }) => {
    const fixture = await setup(page, language);
    const source = await finishedRenderer(page, fixture);
    for (const phase of ['playing', 'peeking', 'waiting']) {
      const board = structuredClone(source.snapshot);
      Object.assign(board, { _aborted: true, _abort_reason: 'inactivity_timeout', _started: phase !== 'waiting' });
      if (phase === 'waiting') board._hausdepp = null;
      else board._hausdepp.phase = phase;
      source.send(board);
      await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'finished');
      await expect(page.locator('#hausdeppWaiting')).toBeHidden();
      await expect(page.locator('#hausdeppResult')).toBeVisible();
      await expect(page.locator('#hausdeppRecreate')).toBeVisible();
      await expect(page.locator('#hausdeppResult')).toContainText(language === 'de' ? /Wertung|Punkte/ : /scor|points/);
      for (const [width, height] of [[320, 568], [844, 390]]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.locator('#hausdeppResult').boundingBox();
        expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      }
    }
  });
}

test('an invitation waits during active play and resumes after a finished game, without accepting by itself', async ({ page }) => {
  const fixture = await setup(page);
  const source = await finishedRenderer(page, fixture);
  const board = structuredClone(source.snapshot);
  Object.assign(board, { _finished: false });
  board._hausdepp.phase = 'playing';
  source.send(board);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  fixture.queue([invitation(await fixture.create())]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  source.send(source.snapshot);
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
  expect(fixture.actions).toEqual([]);
});
