const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
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

test('accepting from a table preserves the document and history replaces only its table transport', async ({ page }) => {
  const fixture = await setup(page);
  const source = await fixture.create(), target = await fixture.create();
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__rematchNavigationSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); window.__rematchNavigationSockets.push(this); }
    };
  });
  await page.goto(`/hausdepp/spiel/${source}`);
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  const documentToken = await page.evaluate(() => {
    window.__rematchDocumentToken = crypto.randomUUID();
    window.__rematchSwitches = [];
    window.addEventListener('hausdepp:table-switch', event => window.__rematchSwitches.push(event.detail));
    return window.__rematchDocumentToken;
  });
  fixture.queue([invitation(target)]);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
  await page.locator('[data-dialog-action=accept]').click();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  expect(await page.evaluate(() => window.__rematchDocumentToken)).toBe(documentToken);
  expect(await page.evaluate(id => window.__rematchNavigationSockets.find(socket => socket.url.endsWith(`/ws/${id}`)).readyState, source)).toBe(3);
  // Late events from the old socket must never stop or repaint the new table.
  await page.evaluate(id => {
    const old = window.__rematchNavigationSockets.find(socket => socket.url.endsWith(`/ws/${id}`));
    old.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ error: 'stale source', fatal: true }) }));
    old.dispatchEvent(new CloseEvent('close', { code: 1006 }));
  }, source);
  await expect(page.locator('#hausdeppConnection')).toHaveText('Verbunden');
  await expect(page.locator('#hausdeppActionError')).toBeEmpty();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${source}$`));
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${target}$`));
  await expect(page.locator('#hausdeppWaiting')).toBeVisible();
  expect(await page.evaluate(() => window.__rematchDocumentToken)).toBe(documentToken);
  expect(await page.evaluate(() => window.__rematchSwitches.map(({ gameId, previousGameId }) => [gameId, previousGameId])))
    .toEqual([[target, source], [source, target], [target, source]]);
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
      if (handleDisabledHausdeppVoice(socket, message)) return;
      if (message.action === 'join_game') socket.send(JSON.stringify({ scoreboard: snapshot, player_id: self }));
      else sent.push(message);
    });
  });
  await page.reload();
  await expect(page.locator('#hausdeppRecreate')).toBeVisible();
  return { id, snapshot, sent, send: next => active.send(JSON.stringify({ scoreboard: next })) };
}

async function liveFinalCard(page, { beforeRenderer } = {}) {
  const fixture = await setup(page);
  await beforeRenderer?.(fixture);
  const source = await finishedRenderer(page, fixture);
  const playing = structuredClone(source.snapshot), self = playing._hausdepp.viewer_id;
  Object.assign(playing, { _finished: false });
  Object.assign(playing._hausdepp, {
    version: playing._hausdepp.version + 1, phase: 'playing', hand: ['hearts-6'],
    discard: ['leaves-6'], current_player_id: self, finished_order: [], loser_id: null,
    available_actions: ['play'], playable_cards: ['hearts-6'], last_event: { type: 'round_started' },
    draw_required: false, draw_urgent: false, pending_refills: [], pending_refill: null,
    stock_blocked_by: null, afterthrow: null, private_peek: [],
  });
  playing._hausdepp.players = playing._hausdepp.players.map(player => ({ ...player, finished: false, hand_count: 1 }));
  source.send(playing);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
  await expect.poll(() => source.sent.some(message => message.action === 'hausdepp_play')).toBe(true);
  const finished = structuredClone(playing);
  finished._finished = true;
  Object.assign(finished._hausdepp, {
    version: playing._hausdepp.version + 1, phase: 'finished', hand: [],
    discard: ['leaves-6', 'hearts-6'], current_player_id: null, finished_order: [self],
    loser_id: finished._hausdepp.players.find(player => player.id !== self).id,
    available_actions: [], playable_cards: [], last_event: { type: 'play', player_id: self, cards: ['hearts-6'] },
  });
  // Pause at creation so even a busy machine cannot land the accepted flight
  // before the assertion gets control; the real WAAPI animation remains in use.
  await page.evaluate(() => {
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (...args) {
      const animation = animate.apply(this, args);
      if (this.matches('.hd-deal-card:is([data-motion-type="play"], [data-motion-type="burn"])')) animation.pause();
      return animation;
    };
  });
  return { ...source, fixture, playing, finished, finish: () => source.send(finished) };
}

async function landAcceptedFlight(flight) {
  await flight.evaluate(element => {
    const animation = element.getAnimations()[0];
    const frames = animation.effect.getKeyframes();
    const end = frames.at(-1).transform;
    const arrival = frames.find(frame => frame.transform === end && frame.computedOffset > 0);
    const timing = animation.effect.getTiming();
    animation.currentTime = timing.delay + timing.duration * arrival.computedOffset + 1;
    animation.pause();
    window.__finalFlightLandedAt = performance.now();
  });
}

test('the final result waits until the actual last card lands, then pauses without waiting for its fade', async ({ page }) => {
  const source = await liveFinalCard(page);
  source.finish();
  const flight = page.locator('.hd-deal-card[data-motion-type="play"]');
  await expect(flight).toHaveCount(1);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  // Stretch the real accepted animation beyond any guessed presentation timer.
  await page.waitForTimeout(900);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await landAcceptedFlight(flight);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  const pause = await page.evaluate(() => performance.now() - window.__finalFlightLandedAt);
  expect(pause).toBeGreaterThanOrEqual(700);
  expect(pause).toBeLessThan(1500);
  // The landed picture is deliberately paused before its rest/fade ends.
  await expect(flight).toHaveCount(1);
  await flight.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await expect(flight).toHaveCount(0);
  // Hydrating the same completed table has no flight and needs no replay pause.
  await page.reload();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'finished');
  expect(await page.locator('#hausdeppResult').isVisible()).toBe(true);
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
});

test('a quiet live final state still gets a reading pause when the last launch has already landed', async ({ page }) => {
  const source = await liveFinalCard(page);
  await page.locator('.hd-deal-card[data-motion-type="launch"]').evaluate(element =>
    element.getAnimations().forEach(animation => animation.finish()));
  // A skipped server version is intentionally hydrated without a second flight.
  source.finished._hausdepp.version++;
  source.finish();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'finished');
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  expect(await page.locator('#hausdeppResult').isVisible()).toBe(false);
  await expect(page.locator('#hausdeppResult')).toBeVisible();
});

test('a final four-of-a-kind waits for the last card to reach the cleared stack', async ({ page }) => {
  const source = await liveFinalCard(page);
  source.playing._hausdepp.version++;
  source.playing._hausdepp.discard = ['leaves-6', 'bells-6', 'acorns-6'];
  source.send(source.playing);
  await expect(page.locator('#hausdeppPileCount')).toContainText('3');
  Object.assign(source.finished._hausdepp, {
    version: source.playing._hausdepp.version + 1, discard: [], burned_count: 4,
    last_event: { type: 'play', player_id: source.playing._hausdepp.viewer_id,
      cards: ['hearts-6'], burn_reason: 'four_of_a_kind', burned_count: 4 },
  });
  source.finish();
  const play = page.locator('.hd-deal-card[data-motion-type="play"]');
  const cleared = page.locator('.hd-deal-card[data-motion-type="burn"]');
  await expect(play).toHaveCount(1);
  await expect(cleared).toHaveCount(4);
  await landAcceptedFlight(play);
  // Landing on the public pile alone is insufficient: the final clear follows.
  await page.waitForTimeout(900);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  for (const flight of await cleared.all()) await landAcceptedFlight(flight);
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  const pause = await page.evaluate(() => performance.now() - window.__finalFlightLandedAt);
  expect(pause).toBeGreaterThanOrEqual(700);
  expect(pause).toBeLessThan(1500);
});

test('a deferred achievement popup waits until the final card has landed and the result is shown', async ({ page }) => {
  let release, returned = false;
  const barrier = new Promise(resolve => { release = resolve; });
  const source = await liveFinalCard(page, { beforeRenderer: async () => {
    let reads = 0;
    await page.route('**/api/hausdepp/progress-notices', async route => {
      if (!reads++) await barrier;
      returned = true;
      await route.fulfill({ json: { revision: 9001, notices: [{
        key: 'achievement:hausdepp_01', kind: 'achievement', points: 10,
        name: { de: 'Erste Runde', en: 'First round' },
        condition: { de: 'Eine Runde abschliessen.', en: 'Finish a round.' },
        reason: { de: 'Gespeichert.', en: 'Saved.' },
      }] } });
    });
  } });
  release();
  await expect.poll(() => returned).toBe(true);
  // The request was begun at the preceding safe boundary but completed in play.
  await page.waitForTimeout(250);
  source.finish();
  const flight = page.locator('.hd-deal-card[data-motion-type="play"]');
  await expect(flight).toHaveCount(1);
  await page.waitForTimeout(900);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await landAcceptedFlight(flight);
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-achievement');
});

test('a rematch invitation cannot cover the last card flight or the reading pause', async ({ page }) => {
  const source = await liveFinalCard(page);
  source.fixture.queue([invitation(await source.fixture.create())]);
  source.finish();
  const flight = page.locator('.hd-deal-card[data-motion-type="play"]');
  await expect(flight).toHaveCount(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForTimeout(900);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await landAcceptedFlight(flight);
  await expect(page.locator('#appDialogBackdrop')).toBeHidden();
  await expect(page.locator('#hausdeppResult')).toBeVisible();
  await expect(page.locator('#appDialog')).toHaveAttribute('data-kind', 'hausdepp-rematch');
});

test('reduced motion shows the final result directly without a synthetic flight delay', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const source = await liveFinalCard(page);
  source.finish();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'finished');
  expect(await page.locator('#hausdeppResult').isVisible()).toBe(true);
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
});

test('hiding the table cancels the flight pause instead of replaying it when returning', async ({ page }) => {
  const source = await liveFinalCard(page);
  source.finish();
  await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  expect(await page.locator('#hausdeppResult').isVisible()).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(await page.locator('#hausdeppResult').isVisible()).toBe(true);
});

test('a new round cancels a pending final result instead of covering the live table later', async ({ page }) => {
  const source = await liveFinalCard(page);
  source.finish();
  const flight = page.locator('.hd-deal-card[data-motion-type="play"]');
  await expect(flight).toHaveCount(1);
  await flight.evaluate(element => element.getAnimations().forEach(animation => animation.pause()));
  const next = structuredClone(source.playing);
  next._hausdepp.version = source.finished._hausdepp.version + 1;
  source.send(next);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await flight.evaluate(element => element.getAnimations().forEach(animation => animation.finish()));
  await page.waitForTimeout(900);
  await expect(page.locator('#hausdeppResult')).toBeHidden();
  await expect(page.locator('#hausdeppHand [data-card-id="hearts-6"]')).toBeVisible();
});

for (const language of ['de', 'en']) {
  test(`${language}: round progress needs no extra button, stays visible and silently retries on the next visit`, async ({ page }) => {
    const fixture = await setup(page, language);
    const account = await (await page.request.get('/api/hausdepp/account')).json();
    const revision = 9001;
    account.history = { rounds: [{ game_id: 'visible-round-receipt' }] };
    const achievement = account.achievements.items[0];
    account.presentation = { pending: {
      revision, points_earned: 2 + achievement.points, achievement_ids: [achievement.id], rank_up: false,
    } };
    await page.addInitScript(() => Object.defineProperty(document, 'hidden', {
      configurable: true, get: () => window.__roundSummaryHidden !== false,
    }));
    await page.route('**/api/hausdepp/account?limit=1', route => route.fulfill({ json: account }));
    let attempts = 0;
    await page.route('**/api/hausdepp/account/acknowledge', route => {
      expect(route.request().postDataJSON()).toEqual({ revision });
      attempts++;
      return route.fulfill({ status: attempts === 1 ? 503 : 200, json: { acknowledged: attempts > 1 } });
    });
    const source = await finishedRenderer(page, fixture);
    source.snapshot._hausdepp_round_summary = { round_id: 'visible-round-receipt', players: {
      [source.snapshot._hausdepp.viewer_id]: { xp: 2 + achievement.points, round_xp: 2,
        achievements: [{ id: achievement.id, points: achievement.points, name: achievement.name }] },
    } };
    // Hydrate a complete authoritative round summary; the account pending
    // receipt happens to cover exactly this round, so it can be confirmed.
    await page.reload();
    const notice = page.locator('#hausdeppRoundProgress');
    for (let visit = 0; visit < 2; visit++) {
      if (visit) await page.reload();
      await expect(notice).toBeVisible();
      await notice.scrollIntoViewIfNeeded();
      await expect(notice.locator('button, [role=alert]')).toHaveCount(0);
      await expect(notice.locator('.hd-round-earned')).toContainText(`+${2 + achievement.points} ${language === 'de' ? 'EP' : 'XP'}`);
      await expect(page.locator('.hd-result-places')).toContainText(achievement.name[language]);
      // Background tabs do not confirm a summary that has not been shown.
      expect(attempts).toBe(visit);
      await page.evaluate(() => {
        window.__roundSummaryHidden = false;
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect.poll(() => attempts).toBe(visit + 1);
      // Neither a failed receipt nor its retry removes the points or adds UI.
      await expect(notice).toBeVisible();
      await expect(notice.locator('button, [role=alert]')).toHaveCount(0);
      await expect(notice.locator('.hd-round-earned')).toContainText(`+${2 + achievement.points} ${language === 'de' ? 'EP' : 'XP'}`);
    }
    await expect(page).toHaveURL(new RegExp(`/hausdepp/spiel/${source.id}$`));
    await expect(page.locator('#hausdeppRecreate')).toBeVisible();
    await expect(page.locator('.hd-result-links a[href="/hausdepp"]')).toBeVisible();
    expect(attempts).toBe(2);
    const accountLink = page.locator('#hausdeppResult a[href="/hausdepp/konto#erfolge"]');
    await accountLink.click();
    await expect(page).toHaveURL(/\/hausdepp\/konto#erfolge$/);
    await expect(page.locator('#hausdeppAchievementsTitle')).toBeVisible();
  });

  test(`${language}: create again uses the source ID, suppresses double clicks and enters the returned waiting room`, async ({ page }) => {
    const fixture = await setup(page, language);
    const source = await finishedRenderer(page, fixture);
    const target = await fixture.create();
    const documentToken = await page.evaluate(() => {
      window.__rematchCreatorDocument = crypto.randomUUID();
      return window.__rematchCreatorDocument;
    });
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
    expect(await page.evaluate(() => window.__rematchCreatorDocument)).toBe(documentToken);
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
  test(`${language}: stopping a tournament retains the earned letters and explains that completed rounds stay scored`, async ({ page }) => {
    const fixture = await setup(page, language);
    const source = await finishedRenderer(page, fixture);
    const board = structuredClone(source.snapshot);
    const [first, second] = board._hausdepp.players;
    Object.assign(board, { _aborted: true, _started: true });
    board._hausdepp_tournament = { round_number: 3, completed: false, can_start_next_round: false,
      letters: { [first.id]: 'HA', [second.id]: 'H' }, losses: { [first.id]: 2, [second.id]: 1 }, tages_hausdepp_id: null };
    source.send(board);
    const result = page.locator('#hausdeppResult');
    await expect(result.locator('h2')).toHaveText(language === 'de' ? 'Turnier beendet.' : 'Tournament ended.');
    await expect(result).toContainText(language === 'de' ? 'ohne Tages-Hausdepp' : 'without a daily Hausdepp');
    await expect(result.locator('.hd-tournament-score li')).toHaveCount(2);
    await expect(result.locator('.hd-tournament-score li').first()).toContainText(first.name);
    await expect(result.locator('.hd-tournament-score li strong')).toHaveText(['HA', 'H']);
    await expect(result.locator('.hd-tournament-score .is-hausdepp')).toHaveCount(0);
    await expect(result.locator('a[href="/hausdepp/konto#erfolge"]')).toBeVisible();
    await expect(page.locator('#hausdeppRecreate')).toBeVisible();
    await expect(page.locator('#hausdeppNextRound, #hausdeppEndTournament')).toHaveCount(0);
    for (const [width, height] of [[320, 568], [844, 390]]) {
      await page.setViewportSize({ width, height });
      const bounds = await result.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1)).toBe(true);
    }
    expect(source.sent).toEqual([]);
  });

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
