const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block', viewport: { width: 1600, height: 1000 } });

const OVERLAY = '.hd-surprise-layer';
const HAND = ['hearts-6', 'bells-U', 'acorns-10'];
const EFFECTS = ['star', 'hammer', 'ufo', 'portal', 'dragon', 'kraken', 'clock', 'blackhole'];
const STORY_STAGES = {
  star: ['star', 'rays', 'constellation'], hammer: ['hammer', 'impact', 'shockwave'], ufo: ['ufo', 'beam'],
  portal: ['portal', 'bridge'], dragon: ['dragon', 'breath', 'flame'], kraken: ['tentacle', 'ink'],
  clock: ['freeze', 'clock', 'mouse'], blackhole: ['hole', 'blackout', 'wood-stage', 'void'],
};
const STORY_TIME = { star: 1000, hammer: 1150, ufo: 1600, portal: 2000, dragon: 1750, kraken: 1550, clock: 2650, blackhole: 900 };

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Surprise tests require the disposable browser server').not.toBe('8000');
});

async function initializeClient(page) {
  await page.addInitScript(() => {
    localStorage.setItem('zdwa_language', 'de');
    window.__tableVibrations = [];
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: pattern => {
      window.__tableVibrations.push(pattern); return true;
    } });
  });
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
}

async function roomFixture(page, effect, { spectator = false, reduced = false, crowded = false, scorched = false } = {}) {
  await initializeClient(page);
  if (reduced) await page.emulateMedia({ reducedMotion: 'reduce' });
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const created = await page.request.post('/api/games', {
    headers: { 'X-CSRF-Token': user.csrf_token },
    data: { name: 'Renderer-Test · Gemeinsame Tischüberraschung', mode: crowded ? '6' : '2', game_type: 'hausdepp',
      play_mode: 'cpu', cpu_count: crowded ? 5 : 1 },
  });
  expect(created.ok()).toBeTruthy();
  const gameId = (await created.json()).game_id, room = `/hausdepp/spiel/${gameId}`;
  let actual;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) actual = message.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
  const self = actual._hausdepp.viewer_id;
  const remote = actual._hausdepp.players.find(player => player.id !== self).id;
  // A real local projection supplies the complete renderer contract. Only the
  // mocked sockets receive these display states; cards and awards never change
  // on the disposable server as a result of a synthetic surprise or card ACK.
  const base = structuredClone(actual);
  Object.assign(base, { _paused: false, _finished: false, _aborted: false, _hausdepp_tournament: null,
    _hausdepp_table_surprises: { round_number: 1, effect }, _hausdepp_table_effects: { scorched_cards: scorched } });
  Object.assign(base._hausdepp, { phase: 'playing', hand: [...HAND], discard: ['leaves-6'], deck_count: 14,
    burned_count: 0, current_player_id: self, available_actions: ['play', 'pickup', 'gamble'],
    playable_cards: [...HAND], afterthrow: null, pending_refill: null, pending_refills: [],
    draw_required: false, draw_urgent: false, stock_blocked_by: null, private_peek: [],
    peek: { player_id: self, success: false, complete: true }, deal: null,
    last_event: { type: 'round_started' }, finished_order: [], loser_id: null });
  base._hausdepp.players = base._hausdepp.players.map(player => ({ ...player, hand_count: 3, finished: false }));
  const clients = [];
  const addClient = async (clientPage, viewer, isSpectator = false, initialized = false) => {
    if (!initialized) await initializeClient(clientPage);
    const board = structuredClone(base);
    board._hausdepp.viewer_id = isSpectator ? null : viewer;
    if (isSpectator) Object.assign(board._hausdepp, { hand: [], playable_cards: [], available_actions: [] });
    const client = { page: clientPage, board, viewer, commands: [], socket: null };
    await clientPage.routeWebSocket(new RegExp(`/ws/${gameId}$`), socket => {
      client.socket = socket;
      socket.onMessage(raw => {
        const command = JSON.parse(String(raw));
        if (['join_game', 'spectate_game'].includes(command.action)) socket.send(JSON.stringify({
          ...(isSpectator ? {} : { player_id: viewer }), scoreboard: client.board,
        }));
        else client.commands.push(command);
      });
    });
    await clientPage.goto(`${room}${isSpectator ? '/zuschauen' : ''}`);
    await expect(clientPage.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    if (await clientPage.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await clientPage.locator('#chatToggle').click();
    clients.push(client);
    return client;
  };
  const first = await addClient(page, self, spectator, true);
  const send = (client, payload) => client.socket.send(JSON.stringify(payload));
  const broadcast = payload => { for (const client of clients) send(client, payload); };
  const emit = (selected = effect, { id = 'labelled-surprise-1', actor = self, round = 1, game = gameId, consume = true } = {}) => {
    const offer = { round_number: round, effect: null };
    if (consume) for (const client of clients) client.board._hausdepp_table_surprises = offer;
    const tableEffects = selected === 'dragon' ? { scorched_cards: true } : null;
    if (tableEffects) for (const client of clients) client.board._hausdepp_table_effects = tableEffects;
    broadcast({ hausdepp_table_surprise: { id, game_id: game, round_number: round, actor_id: actor, effect: selected },
      ...(consume ? { hausdepp_table_surprises: offer } : {}), ...(tableEffects ? { hausdepp_table_effects: tableEffects } : {}) });
  };
  return { gameId, self, remote, room, first, addClient, clients, send, emit };
}

async function settleMessages(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function expectStory(layer, effect) {
  await expect(layer).toHaveAttribute('data-effect', effect);
  for (const stage of STORY_STAGES[effect]) await expect.poll(() => layer.locator(`[data-stage="${stage}"]`).count(),
    `${effect}: ${stage} story part`).toBeGreaterThan(0);
  const hosts = layer.locator('[data-source-kind]');
  if (!['star', 'dragon'].includes(effect)) expect(await hosts.count()).toBeGreaterThan(0);
  expect(await hosts.count()).toBeLessThanOrEqual(24);
  expect(await layer.locator('[data-stage]').count()).toBeLessThanOrEqual(180);
  expect(await hosts.evaluateAll(elements => elements.every(element => element.inert && element.tabIndex < 0
    && getComputedStyle(element).pointerEvents === 'none'
    && !element.querySelector('[id], [onclick], [data-card-id], [data-action], [data-hausdepp-action], button, a[href], input, select, textarea')))).toBe(true);
  await expect.poll(() => hosts.locator('[data-card-id]').count()).toBe(0);
  if (effect === 'ufo') {
    const abducted = layer.locator('[data-abducted="true"]');
    expect(await abducted.count()).toBeGreaterThanOrEqual(2);
    expect(await abducted.count()).toBeLessThanOrEqual(3);
    expect(await layer.locator('[data-abducted="true"][data-source-kind="card"]').count()).toBeGreaterThan(0);
  }
  if (effect === 'portal') {
    await expect(layer.locator('[data-stage="portal"]')).toHaveCount(2);
    await expect(layer.locator('[data-traveller="true"]')).toHaveCount(2);
  }
  if (effect === 'kraken') expect(await layer.locator('[data-taken="true"][data-source-kind="burned"]').count()).toBeGreaterThan(0);
  if (effect === 'dragon') {
    expect(await layer.locator('[data-stage="flame"]').count()).toBeGreaterThanOrEqual(HAND.length);
  }
}

for (const effect of EFFECTS) {
  test(`${effect}: two room clients show one server event and only the local hammer vibrates`, async ({ page }) => {
    const fixture = await roomFixture(page, effect);
    const otherPage = await page.context().newPage();
    const other = await fixture.addClient(otherPage, fixture.remote);
    const prop = page.locator(`[data-prop="${effect}"]:visible`);
    await expect(prop).toBeEnabled();
    const box = await prop.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(300);
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    expect(fixture.first.commands).toEqual([]);
    expect(other.commands).toEqual([]);
    await prop.click();
    await expect.poll(() => fixture.first.commands.filter(command => command.action === 'hausdepp_table_surprise').length).toBe(1);
    expect(fixture.first.commands[0]).toEqual({ action: 'hausdepp_table_surprise', effect, round_number: 1 });
    await expect(page.locator(OVERLAY)).toHaveCount(0);
    fixture.emit();
    for (const client of fixture.clients) {
      await expect(client.page.locator(OVERLAY)).toHaveCount(1);
      expect(await client.page.locator(OVERLAY).evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
      await expect(client.page.locator('#hausdeppHand [data-card-id]')).toHaveCount(HAND.length);
      await expect(client.page.locator(`[data-prop="${effect}"]:visible`)).toHaveCount(0);
    }
    if (effect === 'hammer') await expect.poll(() => page.evaluate(() => window.__tableVibrations.length)).toBe(1);
    expect(await page.evaluate(() => window.__tableVibrations)).toEqual(effect === 'hammer' ? [[35, 30, 65]] : []);
    expect(await otherPage.evaluate(() => window.__tableVibrations)).toEqual([]);
    expect(other.commands).toEqual([]);
    await otherPage.close();
  });
}

test('old events are ignored, one round cannot replay, and reload renders no past surprise', async ({ page }) => {
  const fixture = await roomFixture(page, 'star');
  fixture.emit('star', { id: 'old-round', round: 0, consume: false });
  fixture.emit('star', { id: 'other-room', game: 'unrelated-labelled-room', consume: false });
  await settleMessages(page);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await page.locator('[data-prop="star"]:visible').click();
  fixture.emit();
  await expect(page.locator(OVERLAY)).toHaveCount(1);
  await page.locator(OVERLAY).evaluate(element => { window.__firstTableSurprise = element; });
  fixture.emit('star', { id: 'labelled-surprise-1' });
  fixture.emit('hammer', { id: 'second-event-same-round' });
  await settleMessages(page);
  await expect(page.locator(OVERLAY)).toHaveCount(1);
  expect(await page.locator(OVERLAY).evaluate(element => element === window.__firstTableSurprise)).toBe(true);
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 10000 });
  fixture.emit('ufo', { id: 'later-event-same-round' });
  await settleMessages(page);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator(EFFECTS.map(effect => `[data-prop="${effect}"]:visible`).join(', '))).toHaveCount(0);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await page.evaluate(() => window.__tableVibrations)).toEqual([]);
});

test('a spectator cannot request a surprise even if a malformed offer reaches the renderer', async ({ page }) => {
  const fixture = await roomFixture(page, 'hammer', { spectator: true });
  const hammer = page.locator('[data-prop="hammer"]:visible');
  await expect(hammer).toBeVisible();
  await hammer.dispatchEvent('click');
  await settleMessages(page);
  expect(fixture.first.commands).toEqual([]);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await page.evaluate(() => window.__tableVibrations)).toEqual([]);
});

test('reduced motion disables requests and shows only a still, gently fading symbol without vibration', async ({ page }) => {
  const fixture = await roomFixture(page, 'hammer', { reduced: true });
  const hammer = page.locator('[data-prop="hammer"]:visible');
  await expect(hammer).toBeDisabled();
  await hammer.dispatchEvent('click');
  fixture.emit();
  expect(fixture.first.commands).toEqual([]);
  const layer = page.locator(OVERLAY);
  await expect(layer).toBeVisible();
  const animations = await layer.evaluate(element => element.getAnimations({ subtree: true }).map(animation => ({
    frames: animation.effect.getKeyframes(), iterations: animation.effect.getTiming().iterations,
  })));
  expect(animations.length).toBeGreaterThan(0);
  for (const animation of animations) {
    for (const property of ['transform', 'translate', 'rotate', 'scale', 'left', 'right', 'top', 'bottom', 'width', 'height', 'offsetDistance']) {
      expect(new Set(animation.frames.map(frame => frame[property]).filter(value => value !== undefined)).size).toBeLessThanOrEqual(1);
    }
    const opacity = animation.frames.map(frame => Number(frame.opacity)).filter(value => Number.isFinite(value));
    const rises = opacity.slice(1).filter((value, index) => value > opacity[index]).length;
    expect(rises).toBeLessThanOrEqual(1);
    expect(animation.iterations).toBe(1);
  }
  expect(await page.evaluate(() => window.__tableVibrations)).toEqual([]);
  await expect(layer).toHaveCount(0, { timeout: 6000 });
});

test('a hidden local client does not animate or vibrate when its hammer event arrives', async ({ page }) => {
  const fixture = await roomFixture(page, 'hammer');
  await page.locator('[data-prop="hammer"]:visible').click();
  await expect.poll(() => fixture.first.commands.length).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  fixture.emit();
  await settleMessages(page);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  expect(await page.evaluate(() => window.__tableVibrations)).toEqual([]);
});

test('a surprise rejection leaves a pending card command committed until its own acknowledgement', async ({ page }) => {
  const fixture = await roomFixture(page, 'hammer');
  await page.locator('[data-prop="hammer"]:visible').click();
  await expect.poll(() => fixture.first.commands.some(command => command.action === 'hausdepp_table_surprise')).toBe(true);
  const played = page.locator('#hausdeppHand [data-card-id="hearts-6"]');
  await played.click();
  await expect.poll(() => fixture.first.commands.some(command => command.action === 'hausdepp_play')).toBe(true);
  const command = fixture.first.commands.find(item => item.action === 'hausdepp_play');
  await expect(played).toHaveClass(/is-committed/);
  fixture.send(fixture.first, { error_code: 'hausdepp_table_surprise_rate_limited', error: 'hausdepp_table_surprise_rate_limited' });
  const hammer = page.locator('[data-prop="hammer"]:visible');
  await expect(hammer).toBeEnabled();
  await expect(played).toHaveClass(/is-committed/);
  await expect(page.locator('#hausdeppHand [data-card-id="bells-U"]')).toBeDisabled();
  await hammer.click();
  await expect.poll(() => fixture.first.commands.filter(item => item.action === 'hausdepp_table_surprise').length).toBe(2);
  fixture.send(fixture.first, { error_code: 'hausdepp_table_surprise_unavailable', error: 'hausdepp_table_surprise_unavailable',
    hausdepp_table_surprises: { round_number: 1, effect: 'hammer' } });
  await settleMessages(page);
  await expect(hammer).toBeEnabled();
  await expect(played).toHaveClass(/is-committed/);
  await expect(page.locator('#hausdeppHand [data-card-id="bells-U"]')).toBeDisabled();
  expect(fixture.first.commands.filter(item => item.action === 'hausdepp_play')).toHaveLength(1);
  const accepted = structuredClone(fixture.first.board);
  Object.assign(accepted._hausdepp, { version: accepted._hausdepp.version + 1, hand: HAND.slice(1),
    discard: ['leaves-6', 'hearts-6'], playable_cards: HAND.slice(1),
    last_event: { type: 'play', player_id: fixture.self, cards: ['hearts-6'] } });
  fixture.send(fixture.first, { scoreboard: accepted,
    hausdepp_command: { command_id: command.command_id, accepted: true, version: accepted._hausdepp.version } });
  await expect(page.locator('#hausdeppHand [data-card-id="hearts-6"]')).toHaveCount(0);
  await expect(page.locator('#hausdeppHand [data-card-id="bells-U"]')).toBeEnabled();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
});

async function playGeometry(page) {
  return page.locator('#hausdeppStock, #hausdeppPile, #hausdeppHand [data-card-id]').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { key: element.id || element.dataset.cardId, x: box.x, y: box.y, width: box.width, height: box.height };
  }));
}

function expectSameGeometry(actual, before) {
  expect(actual.map(box => box.key)).toEqual(before.map(box => box.key));
  for (let index = 0; index < actual.length; index += 1) {
    for (const field of ['x', 'y', 'width', 'height']) expect(actual[index][field]).toBeCloseTo(before[index][field], 1);
  }
}

async function isolatedBrowserClient(playwright, baseURL, browserName, viewport) {
  const browser = await playwright[browserName].launch();
  const context = await browser.newContext({ baseURL, viewport, serviceWorkers: 'block' });
  return { page: await context.newPage(), browser };
}

async function pauseSurpriseForCapture(page) {
  await page.evaluate(selector => {
    const original = Element.prototype.animate;
    window.__tableSurpriseCapture = { original, animations: [] };
    Element.prototype.animate = function (...args) {
      const animation = original.apply(this, args);
      if (this.closest(selector) || this.matches('.hd-table-decor .hd-prop-art')) {
        animation.pause();
        window.__tableSurpriseCapture.animations.push(animation);
      }
      return animation;
    };
  }, OVERLAY);
}

async function seekSurpriseCapture(page, time = 700) {
  return page.evaluate(async time => {
    const animations = window.__tableSurpriseCapture.animations;
    await Promise.all(animations.map(animation => animation.ready.catch(() => {})));
    for (const animation of animations) animation.currentTime = time;
    return animations.length;
  }, time);
}

async function resumeSurpriseCapture(page) {
  await page.evaluate(() => {
    const capture = window.__tableSurpriseCapture;
    Element.prototype.animate = capture.original;
    for (const animation of capture.animations) if (animation.playState === 'paused') animation.play();
    delete window.__tableSurpriseCapture;
  });
}

test('the clock freezes its visual copies for two seconds before the animal mouse arrives', async ({ page }) => {
  const fixture = await roomFixture(page, 'clock');
  const before = await playGeometry(page);
  await pauseSurpriseForCapture(page);
  fixture.emit('clock', { actor: fixture.remote });
  const layer = page.locator(OVERLAY), freeze = layer.locator('[data-stage="freeze"]');
  await expect(freeze).toHaveAttribute('data-freeze-from', '120');
  await expect(freeze).toHaveAttribute('data-freeze-to', '2120');
  const plateau = await freeze.evaluate(element => {
    const animation = element.getAnimations()[0], frames = animation.effect.getKeyframes();
    return frames.filter(frame => Number(frame.opacity) === 1).map(frame => frame.offset * animation.effect.getTiming().duration);
  });
  expect(plateau[1] - plateau[0]).toBeCloseTo(2000, 4);
  let frozen;
  for (const time of [120, 1000, 2119]) {
    await seekSurpriseCapture(page, time);
    await expect(freeze).toHaveCSS('opacity', '1');
    const frame = await layer.locator('[data-source-kind="card"], [data-stage="clock"] .hd-hand').evaluateAll(elements =>
      elements.map(element => getComputedStyle(element).transform));
    if (frozen) expect(frame).toEqual(frozen);
    frozen = frame;
    expectSameGeometry(await playGeometry(page), before);
  }
  await seekSurpriseCapture(page, 2650);
  await expect(freeze).toHaveCSS('opacity', '0');
  const mouse = layer.locator('[data-stage="mouse"]');
  await expect(mouse).toBeVisible();
  expect(Number(await mouse.evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(.5);
  await expect(mouse.locator('.hd-mouse-leg-a, .hd-mouse-leg-b')).toHaveCount(2);
  expect(await mouse.locator('svg path').count()).toBeGreaterThan(5);
  expectSameGeometry(await playGeometry(page), before);
  expect(fixture.first.commands).toEqual([]);
  await resumeSurpriseCapture(page);
  await expect(layer).toHaveCount(0, { timeout: 6000 });
});

test('the singularity holds one continuous second of blackout and restores the live table', async ({ page }) => {
  const fixture = await roomFixture(page, 'blackhole');
  const before = await playGeometry(page);
  await pauseSurpriseForCapture(page);
  fixture.emit('blackhole', { actor: fixture.remote });
  const layer = page.locator(OVERLAY), blackout = layer.locator('[data-stage="blackout"]');
  await expect(blackout).toHaveAttribute('data-black-from', '1400');
  await expect(blackout).toHaveAttribute('data-black-to', '2400');
  const plateau = await blackout.evaluate(element => {
    const animation = element.getAnimations()[0], frames = animation.effect.getKeyframes();
    return frames.filter(frame => Number(frame.opacity) === 1).map(frame => frame.offset * animation.effect.getTiming().duration);
  });
  expect(plateau[1] - plateau[0]).toBeCloseTo(1000, 4);
  for (const time of [1400, 1900, 2400]) {
    await seekSurpriseCapture(page, time);
    await expect(blackout).toHaveCSS('opacity', '1');
    expectSameGeometry(await playGeometry(page), before);
  }
  await seekSurpriseCapture(page, 3101);
  await expect(blackout).toHaveCSS('opacity', '0');
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(HAND.length);
  expect(fixture.first.commands).toEqual([]);
  await resumeSurpriseCapture(page);
  await expect(layer).toHaveCount(0, { timeout: 6000 });
});

for (const [name, target] of [
  ['card', '#hausdeppHand [data-card-id="hearts-6"]'],
  ['stock', '#hausdeppStock'],
  ['pile', '#hausdeppPile'],
]) {
  test(`a blind ${name} tap dismisses the opaque blackout without issuing a game command`, async ({ page }) => {
    const fixture = await roomFixture(page, 'blackhole');
    await pauseSurpriseForCapture(page);
    fixture.emit('blackhole', { actor: fixture.remote });
    const layer = page.locator(OVERLAY);
    await expect(layer).toBeVisible();
    await seekSurpriseCapture(page, 1900);
    await expect(layer.locator('[data-stage="blackout"]')).toHaveCSS('opacity', '1');
    await page.locator(target).click();
    await expect(layer).toHaveCount(0);
    await settleMessages(page);
    expect(fixture.first.commands).toEqual([]);
    await resumeSurpriseCapture(page);
    await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
    await expect.poll(() => fixture.first.commands.filter(command => command.action === 'hausdepp_play').length).toBe(1);
    expect(fixture.first.commands).toHaveLength(1);
  });
}

test('dragon scorch persists through the same table round and rejoin while real cards remain playable', async ({ page }) => {
  const fixture = await roomFixture(page, 'dragon');
  const before = await playGeometry(page), table = page.locator('#hausdeppTable');
  await expect(table).toHaveAttribute('data-scorched-cards', 'false');
  fixture.emit('dragon', { actor: fixture.remote });
  await expect(table).toHaveClass(/hd-cards-scorched/);
  await expect(table).toHaveAttribute('data-scorched-cards', 'true');
  expectSameGeometry(await playGeometry(page), before);
  expect(await page.locator('#hausdeppHand [data-card-id]').evaluateAll(elements => elements.map(element => element.dataset.cardId))).toEqual(HAND);
  const scorch = await page.locator('#hausdeppHand [data-card-id]').first().evaluate(element => ({
    content: getComputedStyle(element, '::before').content, pointer: getComputedStyle(element, '::before').pointerEvents,
  }));
  expect(scorch.content).not.toBe('none');
  expect(scorch.pointer).toBe('none');
  const board = fixture.first.board;
  board._hausdepp_tournament = { round_number: 2, dealer_id: fixture.self, letters: {}, losses: {},
    completed: false, round_complete: false, can_start_next_round: false };
  board._hausdepp_table_surprises = { round_number: 2, effect: null };
  board._hausdepp.version += 1;
  fixture.send(fixture.first, { scoreboard: board });
  await settleMessages(page);
  await expect(table).toHaveAttribute('data-scorched-cards', 'true');
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await page.reload();
  await expect(table).toHaveAttribute('data-phase', 'playing');
  await expect(table).toHaveClass(/hd-cards-scorched/);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  const card = page.locator('#hausdeppHand [data-card-id="bells-U"]');
  await expect(card).toBeEnabled();
  await card.click();
  await expect.poll(() => fixture.first.commands.some(command => command.action === 'hausdepp_play')).toBe(true);
  expect(board._hausdepp.hand).toEqual(HAND);
  await roomFixture(page, 'star');
  await expect(table).toHaveAttribute('data-scorched-cards', 'false');
  await expect(table).not.toHaveClass(/hd-cards-scorched/);
});

test('a remote intermediate score update lets the clock story finish but local card input restores the live table', async ({ page }) => {
  const fixture = await roomFixture(page, 'clock');
  await pauseSurpriseForCapture(page);
  fixture.emit('clock', { actor: fixture.remote });
  const layer = page.locator(OVERLAY);
  await expect(layer).toBeVisible();
  await layer.evaluate(element => { window.__remoteUpdateStory = element; });
  await seekSurpriseCapture(page, 700);
  const board = fixture.first.board;
  board._hausdepp.version += 1;
  board._hausdepp.discard.push('leaves-9');
  board._hausdepp.players.find(player => player.id === fixture.remote).hand_count -= 1;
  board._hausdepp.last_event = { type: 'play', player_id: fixture.remote, cards: ['leaves-9'] };
  fixture.send(fixture.first, { scoreboard: board });
  await settleMessages(page);
  await expect(layer).toHaveCount(1);
  expect(await layer.evaluate(element => element === window.__remoteUpdateStory)).toBe(true);
  await seekSurpriseCapture(page, 2650);
  expect(Number(await layer.locator('[data-stage="mouse"]').evaluate(element => getComputedStyle(element).opacity))).toBeGreaterThan(.5);
  await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
  await expect(layer).toHaveCount(0);
  await expect.poll(() => fixture.first.commands.some(command => command.action === 'hausdepp_play')).toBe(true);
  await resumeSurpriseCapture(page);
});

test('active visual doubles clear on lifecycle changes and local keyboard input', async ({ page }) => {
  const fixture = await roomFixture(page, 'hammer');
  const endings = ['hidden', 'reduced', 'resize', 'local-keyboard', 'disconnect'];
  for (const [index, ending] of endings.entries()) {
    const round = index + 1, board = fixture.first.board;
    board._hausdepp_tournament = { round_number: round, dealer_id: fixture.self, letters: {}, losses: {},
      completed: false, round_complete: false, can_start_next_round: false };
    board._hausdepp_table_surprises = { round_number: round, effect: 'hammer' };
    board._hausdepp.version += 1;
    fixture.send(fixture.first, { scoreboard: board });
    await settleMessages(page);
    await pauseSurpriseForCapture(page);
    fixture.emit('hammer', { id: `cleanup-${ending}`, actor: fixture.remote, round });
    const layer = page.locator(OVERLAY);
    await expect(layer).toBeVisible();
    await seekSurpriseCapture(page, 1150);
    await expect.poll(() => layer.locator('[data-source-kind]').count()).toBeGreaterThan(0);
    const before = await playGeometry(page);
    if (ending === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    else if (ending === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    else if (ending === 'resize') await page.setViewportSize({ width: 1580, height: 1000 });
    else if (ending === 'disconnect') await page.locator('#hausdeppTable').evaluate(element => element.remove());
    else {
      await page.locator('#hausdeppHand [data-card-id="hearts-6"]').focus();
      await page.keyboard.press('Enter');
    }
    await expect(layer, `${ending}: no stale doubles`).toHaveCount(0);
    expect(await page.evaluate(() => window.__tableSurpriseCapture.animations.filter(animation => animation.playState === 'running').length)).toBe(0);
    await resumeSurpriseCapture(page);
    if (ending === 'hidden') await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (ending === 'reduced') await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (ending === 'resize') await page.setViewportSize({ width: 1600, height: 1000 });
    if (['hidden', 'reduced'].includes(ending)) expectSameGeometry(await playGeometry(page), before);
    expect(fixture.first.commands.filter(command => command.action === 'hausdepp_play')).toHaveLength(
      ['local-keyboard', 'disconnect'].includes(ending) ? 1 : 0);
    expect(fixture.first.commands.filter(command => command.action === 'hausdepp_table_surprise')).toEqual([]);
  }
});

for (const device of [
  { name: 'WebKit phone', browserName: 'webkit', viewport: { width: 390, height: 844 } },
  { name: 'Chromium landscape', browserName: 'chromium', viewport: { width: 844, height: 390 } },
  { name: 'Chromium tablet', browserName: 'chromium', viewport: { width: 1024, height: 768 } },
  { name: 'Chromium desktop', browserName: 'chromium', viewport: { width: 1600, height: 1000 } },
]) {
  test.describe(device.name, () => {
    test('all eight effects remain visible, clipped, input-transparent and leave every card and hit box in place', async ({ playwright, baseURL }) => {
      test.setTimeout(60000);
      const { page, browser } = await isolatedBrowserClient(playwright, baseURL, device.browserName, device.viewport);
      try {
      const fixture = await roomFixture(page, 'star');
      if (process.env.HAUSDEPP_CAPTURE === '1') await mkdir('/tmp/rollthedice-playful-surprises-qa', { recursive: true });
      for (const [index, effect] of EFFECTS.entries()) {
        const round = index + 1, board = fixture.first.board;
        board._hausdepp_tournament = { round_number: round, dealer_id: fixture.self, letters: {}, losses: {},
          completed: false, round_complete: false, can_start_next_round: false };
        board._hausdepp_table_surprises = { round_number: round, effect };
        board._hausdepp.version += 1;
        board._hausdepp.burned_count = effect === 'kraken' ? 4 : 0;
        fixture.send(fixture.first, { scoreboard: board });
        await settleMessages(page);
        const prop = page.locator(`[data-prop="${effect}"]:visible`);
        await expect(prop, `${effect}: reachable object`).toBeEnabled();
        const before = await playGeometry(page);
        await pauseSurpriseForCapture(page);
        fixture.emit(effect, { id: `labelled-${device.name}-${round}`, actor: fixture.remote, round });
        const layer = page.locator(OVERLAY);
        await expect(layer, `${effect}: visible effect`).toBeVisible();
        expect(await seekSurpriseCapture(page, STORY_TIME[effect])).toBeGreaterThan(0);
        await expect.poll(() => layer.evaluate((element, hero) => {
          const frame = element.getBoundingClientRect();
          return [...element.querySelectorAll(`[data-stage="${hero}"]`)].some(child => {
            const box = child.getBoundingClientRect(), style = getComputedStyle(child);
            return Number(style.opacity) > .5 && style.visibility !== 'hidden'
              && Math.min(box.right, frame.right, innerWidth) - Math.max(box.left, frame.left, 0) > 30
              && Math.min(box.bottom, frame.bottom, innerHeight) - Math.max(box.top, frame.top, 0) > 30;
          });
        }, effect === 'blackhole' ? 'hole' : effect), `${effect}: its central character is visible inside the table`).toBe(true);
        await expectStory(layer, effect);
        const geometry = await layer.evaluate(element => {
          const layerBox = element.getBoundingClientRect(), tableBox = document.getElementById('hausdeppTable').getBoundingClientRect();
          const rect = box => ({ left: box.left, right: box.right, top: box.top, bottom: box.bottom });
          return { layer: rect(layerBox), table: rect(tableBox), pointer: getComputedStyle(element).pointerEvents,
            clipping: getComputedStyle(element).overflow, pageWidth: document.documentElement.scrollWidth,
            childPointers: [...element.children].map(child => getComputedStyle(child).pointerEvents) };
        });
        expect(geometry.pointer).toBe('none');
        expect(geometry.childPointers.every(pointer => pointer === 'none')).toBe(true);
        expect(geometry.clipping).toBe('hidden');
        expect(geometry.layer.left).toBeGreaterThanOrEqual(Math.max(geometry.table.left, 0) - 1);
        expect(geometry.layer.top).toBeGreaterThanOrEqual(Math.max(geometry.table.top, 0) - 1);
        expect(geometry.layer.right).toBeLessThanOrEqual(Math.min(geometry.table.right, device.viewport.width) + 1);
        expect(geometry.layer.bottom).toBeLessThanOrEqual(Math.min(geometry.table.bottom, device.viewport.height) + 1);
        expect(geometry.pageWidth).toBeLessThanOrEqual(device.viewport.width + 1);
        expectSameGeometry(await playGeometry(page), before);
        const stock = await page.locator('#hausdeppStock').boundingBox();
        expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('#hausdeppStock')?.id,
          { x: stock.x + stock.width / 2, y: stock.y + stock.height / 2 })).toBe('hausdeppStock');
        if (process.env.HAUSDEPP_CAPTURE === '1') {
          await expect(layer).toHaveCount(1);
          await page.locator('#hausdeppTable').screenshot({
            path: `/tmp/rollthedice-playful-surprises-qa/${device.name.toLowerCase().replaceAll(' ', '-')}-${effect}.png`,
          });
        }
        await resumeSurpriseCapture(page);
        await expect(layer, `${effect}: complete cleanup`).toHaveCount(0, { timeout: 6000 });
        expectSameGeometry(await playGeometry(page), before);
      }
      expect(fixture.first.commands).toEqual([]);
      expect(await page.evaluate(() => window.__tableVibrations)).toEqual([]);
      } finally { await browser.close(); }
    });
  });
}

test('WebKit phone: the kraken body remains visible outside protected control cutouts', async ({ playwright, baseURL }) => {
  const { page, browser } = await isolatedBrowserClient(playwright, baseURL, 'webkit', { width: 390, height: 844 });
  try {
    const fixture = await roomFixture(page, 'kraken');
    fixture.first.board._hausdepp.burned_count = 4;
    fixture.first.board._hausdepp.version += 1;
    fixture.send(fixture.first, { scoreboard: fixture.first.board });
    await settleMessages(page);
    const before = await playGeometry(page);
    await pauseSurpriseForCapture(page);
    fixture.emit('kraken', { actor: fixture.remote });
    const layer = page.locator(OVERLAY);
    await expect(layer).toBeVisible();
    await seekSurpriseCapture(page, STORY_TIME.kraken);
    const visible = await layer.locator('[data-stage="kraken"]').evaluate(hero => {
      const body = hero.getBoundingClientRect(), screen = hero.closest('.hd-surprise-screen');
      const frame = screen.getBoundingClientRect(), clipping = getComputedStyle(screen).clipPath;
      const match = clipping.match(/^path\((?:(evenodd|nonzero),\s*)?["']([\s\S]*)["']\)$/);
      if (!match) return { visible: 0, samples: 25, clipping };
      const path = new Path2D(match[2]), context = document.createElement('canvas').getContext('2d');
      let visible = 0;
      // Sample the character's drawn central body, beyond mere transformed
      // bounds: an opaque control cutout can otherwise hide the entire animal.
      for (const dx of [.3, .4, .5, .6, .7]) for (const dy of [.3, .4, .5, .6, .7]) {
        const x = body.left + body.width * dx, y = body.top + body.height * dy;
        if (x >= Math.max(0, frame.left) && x <= Math.min(innerWidth, frame.right)
          && y >= Math.max(0, frame.top) && y <= Math.min(innerHeight, frame.bottom)
          && context.isPointInPath(path, x - frame.left, y - frame.top, match[1] || 'nonzero')) visible += 1;
      }
      return { visible, samples: 25, clipping };
    });
    expect(visible.clipping).toMatch(/^path\(/);
    expect(visible.visible, 'most of the kraken body must survive table clipping and control cutouts').toBeGreaterThanOrEqual(15);
    expectSameGeometry(await playGeometry(page), before);
    expect(fixture.first.commands).toEqual([]);
    await resumeSurpriseCapture(page);
    await expect(layer).toHaveCount(0, { timeout: 6000 });
  } finally { await browser.close(); }
});

test.describe('crowded phone offer', () => {
  test('the rare object stays touchable beside six occupied seats and the card hand', async ({ playwright, baseURL }) => {
    const { page, browser } = await isolatedBrowserClient(playwright, baseURL, 'webkit', { width: 390, height: 844 });
    try {
    const fixture = await roomFixture(page, 'clock', { crowded: true });
    await expect(page.locator('.hd-seat')).toHaveCount(5);
    const prop = page.locator('[data-prop="clock"]:visible');
    await expect(prop).toBeEnabled();
    const box = await prop.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y + box.height).toBeLessThanOrEqual(845);
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-prop="clock"]')?.dataset.prop,
      { x: box.x + box.width / 2, y: box.y + box.height / 2 })).toBe('clock');
    await prop.click();
    await expect.poll(() => fixture.first.commands.filter(command => command.action === 'hausdepp_table_surprise').length).toBe(1);
    expect(fixture.first.commands[0]).toEqual({ action: 'hausdepp_table_surprise', effect: 'clock', round_number: 1 });
    } finally { await browser.close(); }
  });
});
