const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

const selectionSource = fs.readFileSync(path.join(__dirname, '../../frontend/hausdepp/hand-selection.js'), 'utf8');
const selectionModule = `data:text/javascript;base64,${Buffer.from(selectionSource).toString('base64')}`;
const HAND = ['hearts-U', 'bells-U', 'leaves-A'];
const VIEWPORTS = [[320, 568], [360, 740], [390, 844], [568, 320], [740, 360], [844, 390], [768, 1024], [1024, 768], [1440, 900]];

function context(patch = {}) {
  return { key: 'table:1:10', roundKey: 'table:1', version: 10, phase: 'playing', action: 'play',
    hand: [...HAND], playable: [...HAND], pending: false, viewer: 'self', event: { type: 'play', player_id: 'other' },
    identity: 'unchanged hand, actions, current player, afterthrow and public pile', ...patch };
}

test('selection state keeps only equal ranks and consumes an atomic selection once', async () => {
  const { createHandSelection } = await import(selectionModule);
  const selection = createHandSelection();
  selection.sync(context()); selection.toggle();
  // One tap picks every playable card of that rank; another tap takes one out.
  expect(selection.select(HAND[0])).toBe(true);
  expect(selection.cards).toEqual(HAND.slice(0, 2));
  expect(selection.select(HAND[2])).toBe(false);
  expect(selection.select(HAND[1])).toBe(true);
  expect(selection.cards).toEqual([HAND[0]]);
  expect(selection.select(HAND[1])).toBe(true);
  expect(selection.take()).toEqual({ action: 'play', cards: HAND.slice(0, 2) });
  expect(selection.take()).toBeNull();
  selection.select(HAND[2]); selection.select(HAND[2]);
  expect(selection.cards).toEqual([]);
  selection.select(HAND[0]); selection.cancel();
  expect(selection.enabled).toBe(false);
  expect(selection.cards).toEqual([]);
});

test('selection state retains duplicate snapshots and only a proved foreign refill across versions', async () => {
  const { createHandSelection } = await import(selectionModule);
  for (const [event, version, identity, retained] of [
    [{ type: 'play', player_id: 'other' }, 10, context().identity, true],
    [{ type: 'draw', player_id: 'other' }, 11, context().identity, true],
    [{ type: 'draw', player_id: 'self' }, 11, context().identity, false],
    [{ type: 'draw' }, 11, context().identity, false],
    [{ type: 'draw', player_id: 'other' }, 12, context().identity, false],
    [{ type: 'draw', player_id: 'other' }, 11, 'different turn or public pile', false],
    [{ type: 'play', player_id: 'other' }, 11, context().identity, false],
  ]) {
    const selection = createHandSelection();
    selection.sync(context()); selection.toggle(); selection.select(HAND[0]);
    selection.sync(context({ key: `table:1:${version}`, version, identity, event }));
    expect(selection.cards, JSON.stringify({ event, version, identity })).toEqual(retained ? HAND.slice(0, 2) : []);
  }
});

test('expired follow-up, lost cards, changed legality and a later regained turn never restore a selection', async () => {
  const { createHandSelection } = await import(selectionModule);
  const selection = createHandSelection();
  selection.sync(context({ action: 'afterthrow' })); selection.toggle(); selection.select(HAND[0]);
  selection.sync(context({ key: 'table:1:11', version: 11, action: null, playable: [], identity: 'next player played' }));
  expect(selection.notice).toBe('multiAfterthrowExpired');
  selection.sync(context({ key: 'table:1:12', version: 12 }));
  expect(selection.take()).toBeNull();
  for (const patch of [{ hand: HAND.slice(1) }, { playable: HAND.slice(1) }, { identity: 'another rank' }, { roundKey: 'table:2', key: 'table:2:10' }]) {
    selection.sync(context()); selection.select(HAND[0]); selection.sync(context(patch));
    expect(selection.cards).toEqual([]);
  }
  selection.sync(context({ phase: 'peeking' }));
  expect(selection.enabled).toBe(false);
});

async function fixture(page, language) {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.selectionOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // Renderer-only scenarios; real beginner tours remain in game-tours.spec.
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: true, games: {} } }));
  const created = await page.request.post('/api/games', { headers, data: {
    name: 'Renderer-Test · Atomare Mehrfachauswahl', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 5,
  } });
  expect(created.ok()).toBeTruthy();
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  let actual;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const value = JSON.parse(String(payload)); if (value.scoreboard?._hausdepp) actual = value.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
  const board = structuredClone(actual), self = board._hausdepp.viewer_id;
  const remote = board._hausdepp.players.find(player => player.id !== self).id;
  Object.assign(board, { _paused: false, _finished: false, _aborted: false, _hausdepp_tournament: null });
  Object.assign(board._hausdepp, {
    phase: 'playing', hand: [...HAND], discard: ['leaves-6'], current_player_id: self,
    deck_count: 14, burned_count: 0, available_actions: ['play', 'pickup', 'gamble'], playable_cards: [...HAND],
    afterthrow: null, pending_refill: null, pending_refills: [], draw_required: false, draw_urgent: false,
    stock_blocked_by: null, private_peek: [], peek: { player_id: self, success: false, complete: true },
    deal: null, last_event: { type: 'round_started' }, finished_order: [], loser_id: null,
  });
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player, hand_count: 3, finished: false }));
  let socket;
  const commands = [];
  await page.routeWebSocket(new RegExp(`/ws/${room.split('/').pop()}$`), active => {
    socket = active;
    active.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (message.action === 'join_game') active.send(JSON.stringify({ player_id: self, scoreboard: board }));
      else commands.push(message);
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await page.locator('#chatToggle').click();
  return { board, self, remote, commands, send: next => socket.send(JSON.stringify({ scoreboard: next })) };
}

test.afterEach(async ({ page }) => {
  const saved = page.selectionOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', { headers: saved.headers, data: { preferred_language: saved.language } });
});

const card = (page, id) => page.locator(`#hausdeppHand button[data-card-id="${id}"]`);

for (const language of ['de', 'en']) {
  test(`${language}: ordinary tapping still plays immediately and multi-select sends one atomic matching command`, async ({ page }) => {
    const state = await fixture(page, language);
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAccessibleName(language === 'de' ? 'Mehrere Karten auswählen' : 'Select multiple cards');
    await card(page, HAND[0]).click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards }))).toEqual([{ action: 'hausdepp_play', cards: [HAND[0]] }]);
    // A fresh renderer entry resets the pending command without a fabricated server ACK.
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    state.commands.length = 0;
    await page.locator('#hausdeppMultiToggle').click();
    await card(page, HAND[0]).click();
    expect(state.commands).toEqual([]);
    await expect(card(page, HAND[0])).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, HAND[1])).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, HAND[2])).toBeDisabled();
    const play = page.locator('#hausdeppMultiPlay');
    await expect(play).toHaveText(language === 'de' ? '2 Karten legen' : 'Play 2 cards');
    await card(page, HAND[1]).click();
    await expect(card(page, HAND[1])).toHaveAttribute('aria-pressed', 'false');
    await expect(play).toHaveText(language === 'de' ? '1 Karte legen' : 'Play 1 card');
    await card(page, HAND[1]).click();
    await expect(play).toHaveText(language === 'de' ? '2 Karten legen' : 'Play 2 cards');
    if (process.env.HAUSDEPP_SELECTION_SCREENSHOTS === '1') {
      await page.screenshot({ path: test.info().outputPath(`selection-two-${language}-390x844.png`) });
    }
    await play.click();
    expect(state.commands.map(({ action, cards, version }) => ({ action, cards, version }))).toEqual([
      { action: 'hausdepp_play', cards: HAND.slice(0, 2), version: state.board._hausdepp.version },
    ]);
    await expect(play).toBeDisabled();
    await expect(card(page, HAND[2])).toBeDisabled();
    await page.locator('#hausdeppMultiToggle').click();
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAttribute('aria-pressed', 'false');
    expect(state.commands).toHaveLength(1);
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    state.commands.length = 0;
    const four = structuredClone(state.board);
    four._hausdepp.hand = ['hearts-U', 'bells-U', 'leaves-U', 'acorns-U', 'leaves-A'];
    four._hausdepp.playable_cards = [...four._hausdepp.hand];
    four._hausdepp.version += 1;
    state.send(four);
    await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(5);
    await page.locator('#hausdeppMultiToggle').click();
    await card(page, four._hausdepp.hand[0]).click();
    await expect(play).toHaveText(language === 'de' ? '4 Karten legen' : 'Play 4 cards');
    await play.click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards: [...cards].sort() }))).toEqual([
      { action: 'hausdepp_play', cards: four._hausdepp.hand.slice(0, 4).sort() },
    ]);
  });

  test(`${language}: a foreign refill preserves selection but a CPU play expires follow-up and later turns stay empty`, async ({ page }) => {
    const state = await fixture(page, language);
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { current_player_id: state.remote, available_actions: ['afterthrow'],
      playable_cards: HAND.slice(0, 2), afterthrow: { player_id: state.self, rank: 'U' } });
    next._name = 'Renderer-Test · Nachwurfrecht';
    s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppRoomName')).toHaveText(next._name);
    await page.locator('#hausdeppMultiToggle').click();
    await card(page, HAND[0]).click();
    next._name = 'Renderer-Test · Fremder Pflichtnachzug';
    s.version += 1; s.last_event = { type: 'draw', player_id: state.remote, drawn_count: 1 }; state.send(next);
    await expect(page.locator('#hausdeppRoomName')).toHaveText(next._name);
    await expect(card(page, HAND[0])).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#hausdeppMultiPlay').click();
    expect(state.commands.map(({ action, cards, version }) => ({ action, cards, version }))).toEqual([
      { action: 'hausdepp_afterthrow', cards: HAND.slice(0, 2), version: s.version },
    ]);
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    state.commands.length = 0;
    // Re-establish the same public renderer opportunity, then let the CPU act.
    state.send(next);
    await expect(page.locator('#hausdeppRoomName')).toHaveText(next._name);
    await page.locator('#hausdeppMultiToggle').click(); await card(page, HAND[0]).click();
    s.version += 1; Object.assign(s, { available_actions: [], playable_cards: [], afterthrow: null,
      discard: [...s.discard, 'acorns-K'], last_event: { type: 'play', player_id: state.remote, cards: ['acorns-K'] } });
    state.send(next);
    await expect(page.locator('#hausdeppMultiNotice')).toHaveText(language === 'de'
      ? 'Nachwurfrecht vorbei – Auswahl aufgehoben.' : 'Your follow-up window has closed — selection cleared.');
    await expect(page.locator('#hausdeppHand [aria-pressed="true"]')).toHaveCount(0);
    s.version += 1; Object.assign(s, { current_player_id: state.self, available_actions: ['play', 'pickup', 'gamble'], playable_cards: [...HAND] });
    state.send(next);
    await expect(page.locator('#hausdeppMultiPlay')).toBeDisabled();
    expect(state.commands).toEqual([]);
  });

  test(`${language}: multi-select fits the fixed six-player window with 44px controls and a scrollable large hand`, async ({ page }) => {
    const state = await fixture(page, language);
    const next = structuredClone(state.board);
    const allCards = ['hearts', 'bells', 'leaves', 'acorns'].flatMap(suit => ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'].map(rank => `${suit}-${rank}`));
    next._hausdepp.hand = allCards.filter(id => id !== 'leaves-6');
    next._hausdepp.playable_cards = [...next._hausdepp.hand];
    next._hausdepp.players.find(player => player.id === state.self).hand_count = 35;
    next._hausdepp.version += 1;
    state.send(next);
    await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(35);
    await page.locator('#hausdeppMultiToggle').click();
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      for (const id of ['#hausdeppMultiToggle', '#hausdeppMultiPlay']) {
        const box = await page.locator(id).boundingBox();
        expect(box.width, `${language} ${width}×${height} ${id}`).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(-1); expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        expect(box.y).toBeGreaterThanOrEqual(-1); expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
      }
      const hand = page.locator('#hausdeppHand');
      if (process.env.HAUSDEPP_SELECTION_SCREENSHOTS === '1' && language === 'de' && [320, 568, 844, 1440].includes(width)) {
        await hand.evaluate(node => { node.scrollLeft = 0; });
        await page.screenshot({ path: test.info().outputPath(`selection-large-hand-${width}x${height}.png`) });
      }
      for (const edge of ['first', 'last']) {
        await hand.evaluate((node, side) => { node.scrollLeft = side === 'first' ? 0 : node.scrollWidth; }, edge);
        const target = page.locator('#hausdeppHand button')[edge]();
        await target.focus();
        await expect(target).toBeInViewport();
      }
      const metrics = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
      expect(metrics.width).toBeLessThanOrEqual(width + 1);
      if (width <= 1099) expect(metrics.height).toBeLessThanOrEqual(height + 1);
    }
    await page.locator('#hausdeppMultiToggle').click();
    await expect(page.locator('.hd-reactions')).toBeVisible();
    expect(state.commands).toEqual([]);
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: the peeker keeps seeing known bottom cards and auto-refill taps the stock once`, async ({ page }) => {
    const state = await fixture(page, language);
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { private_peek: ['hearts-A', 'bells-K'], private_peek_in_stock: ['hearts-A', 'bells-K'] });
    s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toHaveText(language === 'de' ? 'Unten: Ass · König' : 'Bottom: Ace · King');
    await expect(page.locator('#hausdeppStock')).toHaveAttribute('aria-label', language === 'de' ? /unten im Stapel/ : /bottom of the stock/);
    s.private_peek_in_stock = ['hearts-A']; s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toHaveText(language === 'de' ? 'Unten: Ass' : 'Bottom: Ace');
    s.private_peek_in_stock = []; s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toBeHidden();

    // Off by default: a due refill waits for the player's tap.
    Object.assign(s, { current_player_id: state.remote, available_actions: ['draw'], playable_cards: [],
      draw_required: true, draw_urgent: true, last_event: { type: 'play', player_id: state.self, cards: ['hearts-U'] } });
    s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppDrawAlert')).toBeVisible();
    await page.waitForTimeout(150);
    expect(state.commands.filter(command => command.action === 'hausdepp_draw')).toEqual([]);

    await page.locator('#hausdeppTools > summary').click();
    const toggle = page.locator('#hausdeppAutoRefill');
    await expect(toggle).not.toBeChecked();
    const saved = page.waitForResponse(response => response.url().endsWith('/api/auth/preferences/hausdepp') && response.ok());
    await toggle.check();
    await saved;
    await expect.poll(() => state.commands.filter(command => command.action === 'hausdepp_draw').length).toBe(1);
    expect(state.commands.at(-1).version).toBe(s.version);
    const me = await (await page.request.get('/api/auth/me')).json();
    expect(me.user.preferences.hausdepp_auto_refill).toBe(true);
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    await page.locator('#hausdeppTools > summary').click();
    await expect(page.locator('#hausdeppAutoRefill')).toBeChecked();
    await page.locator('#hausdeppAutoRefill').uncheck();
    await expect.poll(async () => (await (await page.request.get('/api/auth/me')).json()).user.preferences.hausdepp_auto_refill).toBe(false);
  });
}
