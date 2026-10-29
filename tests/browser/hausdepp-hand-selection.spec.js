const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
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

test('a lower quartet needs its exact permitted group while ordinary singles remain immediate', async () => {
  const { createHandSelection } = await import(selectionModule);
  const quartet = ['hearts-6', 'bells-6', 'leaves-6', 'acorns-6'];
  const selection = createHandSelection();
  selection.sync(context({ hand: [...quartet, 'hearts-A'], playable: ['hearts-A'], playableGroups: [quartet] }));
  expect(selection.startWith(quartet[0])).toBe(true);
  expect(selection.cards.sort()).toEqual([...quartet].sort());
  expect(selection.canPlay).toBe(true);
  for (const card of quartet.slice(1)) {
    selection.select(card);
    expect(selection.canPlay, `${selection.cards.length} lower cards cannot clear a higher rank`).toBe(false);
    expect(selection.take()).toBeNull();
    expect(selection.notice).toBe('multiQuartetRequired');
  }
  for (const card of quartet.slice(1)) selection.select(card);
  expect(selection.take()).toEqual({ action: 'play', cards: quartet });
  expect(selection.take()).toBeNull();
  expect(selection.startWith('hearts-A')).toBe(true);
  expect(selection.take()).toEqual({ action: 'play', cards: ['hearts-A'] });
});

test('quartet opportunities expire with their permission and malformed groups grant no new cards', async () => {
  const { createHandSelection } = await import(selectionModule);
  const quartet = ['hearts-6', 'bells-6', 'leaves-6', 'acorns-6'];
  for (const groups of [[quartet.slice(0, 3)], [[...quartet.slice(0, 3), quartet[0]]], [[...quartet.slice(0, 3), 'acorns-7']]]) {
    const selection = createHandSelection();
    selection.sync(context({ hand: quartet, playable: [], playableGroups: groups }));
    expect(selection.startWith(quartet[0])).toBe(false);
  }
  const selection = createHandSelection();
  const opportunity = context({ hand: quartet, playable: [], playableGroups: [quartet] });
  selection.sync(opportunity); selection.startWith(quartet[0]);
  selection.sync({ ...opportunity, playableGroups: [] });
  expect(selection.cards).toEqual([]);
  expect(selection.take()).toBeNull();
  selection.sync(opportunity); selection.startWith(quartet[0]);
  selection.sync({ ...opportunity, action: null, key: 'later-turn', identity: 'another player' });
  expect(selection.cards).toEqual([]);
  expect(selection.startWith(quartet[0])).toBe(false);
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
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
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
      if (handleDisabledHausdeppVoice(active, message)) return;
      if (message.action === 'join_game') active.send(JSON.stringify({ player_id: self, scoreboard: board }));
      else commands.push(message);
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await page.locator('#chatToggle').click();
  return { board, self, remote, commands, send: next => socket.send(JSON.stringify({ scoreboard: next })),
    raw: payload => socket.send(JSON.stringify(payload)) };
}

test.afterEach(async ({ page }) => {
  const saved = page.selectionOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', { headers: saved.headers, data: { preferred_language: saved.language } });
});

const card = (page, id) => page.locator(`#hausdeppHand button[data-card-id="${id}"]`);

for (const [language, viewport] of [['de', { width: 390, height: 844 }], ['en', { width: 1440, height: 900 }]]) {
  test(`${language}: lower quartet taps require four-card confirmation and never send illegal singles`, async ({ page }) => {
    const state = await fixture(page, language);
    await page.setViewportSize(viewport);
    const quartet = ['hearts-6', 'bells-6', 'leaves-6', 'acorns-6'];
    Object.assign(state.board._hausdepp, { version: state.board._hausdepp.version + 2,
      four_of_a_kind_as_ten: true, hand: [...quartet, 'hearts-A'], playable_cards: ['hearts-A'], playable_groups: [quartet],
      discard: ['bells-K'], available_actions: ['play', 'pickup'], last_event: { type: 'round_started' } });
    state.send(state.board);
    await expect(card(page, quartet[0])).toBeEnabled();
    await expect(page.locator('#hausdeppTableRule')).toHaveText(language === 'de' ? '4 Gleiche = 10' : '4 of a kind = 10');
    await card(page, quartet[0]).click();
    expect(state.commands).toEqual([]);
    await expect(page.locator('#hausdeppHand [aria-pressed=true]')).toHaveCount(4);
    const play = page.locator('#hausdeppMultiPlay');
    await expect(play).toBeEnabled();
    for (const id of quartet.slice(1)) {
      await card(page, id).click();
      await expect(play).toBeDisabled();
      await expect(page.locator('#hausdeppMultiNotice')).toContainText(language === 'de' ? 'Nur alle vier' : 'Only all four');
      expect(state.commands).toEqual([]);
    }
    for (const id of quartet.slice(1)) await card(page, id).click();
    await expect(play).toHaveText(language === 'de' ? '4 Karten legen' : 'Play 4 cards');
    await play.click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards: [...cards].sort() })))
      .toEqual([{ action: 'hausdepp_play', cards: [...quartet].sort() }]);
    // The same opportunity is still usable through the existing hold gesture.
    await page.reload();
    await expect(card(page, quartet[0])).toBeEnabled();
    state.commands.length = 0;
    const box = await card(page, quartet[0]).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down(); await page.waitForTimeout(520); await page.mouse.up();
    await expect(page.locator('#hausdeppHand [aria-pressed=true]')).toHaveCount(4);
    expect(state.commands).toEqual([]);
    await page.locator('#hausdeppMultiToggle').click();
    await card(page, 'hearts-A').click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards }))).toEqual([{ action: 'hausdepp_play', cards: ['hearts-A'] }]);
  });
}

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
    // One selection serves one throw: the mode ends by itself.
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAttribute('aria-pressed', 'false');
    await expect(card(page, HAND[2])).toBeDisabled();
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

  test(`${language}: holding a card selects its whole rank for one throw, then taps play singly again`, async ({ page }) => {
    const state = await fixture(page, language);
    const held = card(page, HAND[0]);
    const box = await held.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
    await page.mouse.down();
    await page.waitForTimeout(520);
    await page.mouse.up();
    // The long press itself sends nothing and does not play the held card.
    expect(state.commands).toEqual([]);
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, HAND[0])).toHaveAttribute('aria-pressed', 'true');
    await expect(card(page, HAND[1])).toHaveAttribute('aria-pressed', 'true');
    await card(page, HAND[1]).click();
    await expect(card(page, HAND[1])).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#hausdeppMultiPlay').click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards }))).toEqual([{ action: 'hausdepp_play', cards: [HAND[0]] }]);
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAttribute('aria-pressed', 'false');
    // A short tap after a fresh renderer entry plays immediately again.
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
    state.commands.length = 0;
    await card(page, HAND[1]).click();
    expect(state.commands.map(({ action, cards }) => ({ action, cards }))).toEqual([{ action: 'hausdepp_play', cards: [HAND[1]] }]);
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
    await page.setViewportSize({ width: 375, height: 812 });
    const state = await fixture(page, language);
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { private_peek: ['hearts-A', 'bells-K'], private_peek_in_stock: ['hearts-A', 'bells-K'] });
    s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toHaveText(language === 'de' ? 'Unten: Ass · König' : 'Bottom: Ace · King');
    await expect(page.locator('#hausdeppStock')).toHaveAttribute('aria-label', language === 'de' ? /unten im Stapel/ : /bottom of the stock/);
    // The seen cards peek out from under the stock as a fan: on screen,
    // behind the stock, clear of the cleared-cards stack, and without a label.
    const layout = await page.evaluate(() => {
      const box = node => node.getBoundingClientRect();
      const fan = [...document.querySelectorAll('#hausdeppKnownBottomCards .hausdepp-card')].map(box);
      const stock = box(document.getElementById('hausdeppStock'));
      const burned = box(document.querySelector('.hd-burned'));
      const label = box(document.getElementById('hausdeppKnownBottom'));
      return { count: fan.length, left: Math.min(...fan.map(rect => rect.left)), bottom: Math.max(...fan.map(rect => rect.bottom)),
        under: getComputedStyle(document.getElementById('hausdeppKnownBottomCards')).zIndex < getComputedStyle(document.getElementById('hausdeppStock')).zIndex,
        peeks: fan.every(rect => rect.left < stock.left && rect.right > stock.left), burnedTop: burned.top, labelArea: label.width * label.height };
    });
    expect(layout.count).toBe(2);
    expect(layout.left).toBeGreaterThanOrEqual(0);
    expect(layout.under).toBe(true);
    expect(layout.peeks).toBe(true);
    expect(layout.bottom).toBeLessThanOrEqual(layout.burnedTop);
    expect(layout.labelArea).toBeLessThanOrEqual(1);
    s.private_peek_in_stock = ['hearts-A']; s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toHaveText(language === 'de' ? 'Unten: Ass' : 'Bottom: Ace');
    s.private_peek_in_stock = []; s.version += 1; state.send(next);
    await expect(page.locator('#hausdeppKnownBottom')).toBeHidden();

    // Refilling is mandatory and automatic for everyone: no setting, one tap.
    await page.locator('#hausdeppTools > summary').click();
    await expect(page.locator('#hausdeppAutoRefill')).toHaveCount(0);
    await page.locator('#hausdeppTools > summary').click();
    Object.assign(s, { current_player_id: state.remote, available_actions: ['draw'], playable_cards: [],
      draw_required: true, draw_urgent: true, last_event: { type: 'play', player_id: state.self, cards: ['hearts-U'] } });
    s.version += 1; state.send(next);
    await expect.poll(() => state.commands.filter(command => command.action === 'hausdepp_draw').length).toBe(1);
    expect(state.commands.at(-1).version).toBe(s.version);
    await page.waitForTimeout(150);
    expect(state.commands.filter(command => command.action === 'hausdepp_draw')).toHaveLength(1);
  });
}

test.describe('own card flights and follow-up timing', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a tap launches exactly one card at once and the accepted state continues that same card', async ({ page }) => {
    const state = await fixture(page, 'de');
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.hd-deal-card')) animation.pause();
        return animation;
      };
    });
    await card(page, HAND[0]).click();
    // Before any server reply: one face is already flying and the slot is empty.
    await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCount(1);
    await expect(card(page, HAND[0])).toHaveCSS('visibility', 'hidden');
    const launched = await page.locator('.hd-deal-card[data-motion-type="launch"]').elementHandle();
    const command = state.commands.at(-1);
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { version: s.version + 1, hand: HAND.slice(1), discard: [...s.discard, HAND[0]],
      current_player_id: state.remote, available_actions: ['afterthrow'], playable_cards: [HAND[1]],
      afterthrow: { player_id: state.self, rank: 'U' },
      last_event: { type: 'play', player_id: state.self, cards: [HAND[0]] } });
    state.send(next);
    state.raw({ hausdepp_command: { command_id: command.command_id, accepted: true, version: s.version } });
    await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
    // The flight is the very element launched at the tap, never a second copy.
    expect(await launched.evaluate(node => node.isConnected && node.dataset.motionType)).toBe('play');
    await expect(page.locator('.hd-deal-card[data-motion-type="play"], .hd-deal-card[data-motion-type="launch"]')).toHaveCount(1);
    // ACKs and same-version paints keep paper on landing, while a legal own
    // follow-up is already tappable during that same physical flight.
    state.send(next);
    await expect(card(page, HAND[1])).toBeEnabled();
    await expect(page.locator('#hausdeppStock')).toBeDisabled();
    await page.waitForTimeout(1000);
    const packet = await page.locator('#hausdeppPile').evaluate(node => ({
      count: Number(node.dataset.cardCount), opacity: Number(getComputedStyle(node).opacity),
      cards: [...node.querySelectorAll('[data-card-id]')].map(card => ({
        id: card.dataset.cardId, opacity: Number(getComputedStyle(card).opacity),
        wrapperOpacity: Number(getComputedStyle(card.parentElement).opacity),
      })),
      oldPictures: document.querySelectorAll('.hd-deal-card[data-motion-type="pile-rest"]').length,
    }));
    expect(packet).toMatchObject({ count: 1, opacity: 1, oldPictures: 0 });
    expect(packet.cards.map(card => card.id)).toEqual(state.board._hausdepp.discard);
    expect(packet.cards.every(card => card.opacity === 1 && card.wrapperOpacity === 1)).toBe(true);
    await page.locator('.hd-deal-card[data-motion-type="play"]').evaluate(node => node.getAnimations().forEach(animation => animation.play()));
    await expect(page.locator('.hd-deal-card')).toHaveCount(0, { timeout: 3000 });
    await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', HAND[0]);
    await expect(card(page, HAND[1])).toBeEnabled();
  });

  for (const replyOrder of ['ack-first', 'snapshot-first']) {
    test(`${replyOrder}: a matching tap queued before acceptance flies before the preceding card lands`, async ({ page }) => {
      const state = await fixture(page, 'de');
      await page.evaluate(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('.hd-deal-card')) animation.pause();
          return animation;
        };
      });
      await card(page, HAND[0]).click();
      const first = state.commands[0];
      await expect(card(page, HAND[1])).toBeEnabled();
      await card(page, HAND[1]).click();
      expect(state.commands).toHaveLength(1);
      const next = structuredClone(state.board), s = next._hausdepp;
      Object.assign(s, { version: s.version + 1, hand: HAND.slice(1), discard: [...s.discard, HAND[0]],
        current_player_id: state.remote, available_actions: ['afterthrow'], playable_cards: [HAND[1]],
        afterthrow: { player_id: state.self, rank: 'U' },
        last_event: { type: 'play', player_id: state.self, cards: [HAND[0]] } });
      const acknowledge = () => state.raw({ hausdepp_command: {
        command_id: first.command_id, accepted: true, version: s.version,
      } });
      if (replyOrder === 'ack-first') acknowledge();
      state.send(next);
      if (replyOrder === 'snapshot-first') acknowledge();
      await expect.poll(() => state.commands.length).toBe(2);
      expect(state.commands[1]).toMatchObject({ action: 'hausdepp_afterthrow', cards: [HAND[1]], version: s.version });
      await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
      await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCount(1);
      await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCSS('visibility', 'visible');
      await expect(card(page, HAND[1])).toHaveCSS('visibility', 'hidden');
      // Neither a timer nor a second accepted append may paint either face on
      // the pile before arrival, or hide the second flight behind the first.
      const second = state.commands[1];
      Object.assign(s, { version: s.version + 1, hand: [HAND[2]], discard: [...s.discard, HAND[1]],
        playable_cards: [], last_event: { type: 'afterthrow', player_id: state.self, cards: [HAND[1]] } });
      state.send(next);
      state.raw({ hausdepp_command: { command_id: second.command_id, accepted: true, version: s.version } });
      const followFlight = page.locator('.hd-deal-card[data-motion-type="afterthrow"]');
      await expect(followFlight).toHaveCount(1);
      await expect(followFlight).toHaveCSS('visibility', 'visible');
      await expect(followFlight).toHaveCSS('opacity', '1');
      await page.waitForTimeout(1100);
      await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '1');
      await expect(page.locator('#hausdeppPile [data-card-id]')).toHaveAttribute('data-card-id', 'leaves-6');
      if (replyOrder === 'snapshot-first') {
        // A later own card may physically arrive first. Keep its single face
        // at the true destination until the preceding paper can hand over.
        await followFlight.evaluate(node => node.getAnimations().forEach(animation => animation.finish()));
        await expect(followFlight).toHaveCount(1);
        const endpoint = await followFlight.evaluate(node => {
          const rect = node.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
            targetX: Number(node.dataset.targetX), targetY: Number(node.dataset.targetY) };
        });
        expect(Math.abs(endpoint.x - endpoint.targetX)).toBeLessThan(.6);
        expect(Math.abs(endpoint.y - endpoint.targetY)).toBeLessThan(.6);
        await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '1');
      }
      await page.locator('.hd-deal-card[data-motion-type="play"]').evaluate(node => node.getAnimations().forEach(animation => animation.play()));
      if (replyOrder === 'ack-first') {
        // Resume the first only. The second stays a single paused visible face.
        await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '2');
        await expect(page.locator('#hausdeppPile [data-card-id="bells-U"]')).toHaveCount(0);
        await expect(followFlight).toHaveCount(1);
        await followFlight.evaluate(node => node.getAnimations().forEach(animation => animation.play()));
      }
      await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '3');
      await expect(page.locator('.hd-deal-card')).toHaveCount(0);
      expect(state.commands).toHaveLength(2);
    });
  }

  test('a late decision can afterthrow an overlooked matching card during a paused own flight', async ({ page }) => {
    const state = await fixture(page, 'en');
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.hd-deal-card')) animation.pause();
        return animation;
      };
    });
    await card(page, HAND[0]).click();
    const first = state.commands[0];
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { version: s.version + 1, hand: HAND.slice(1), discard: [...s.discard, HAND[0]],
      current_player_id: state.remote, available_actions: ['afterthrow'], playable_cards: [HAND[1]],
      afterthrow: { player_id: state.self, rank: 'U' },
      last_event: { type: 'play', player_id: state.self, cards: [HAND[0]] } });
    state.send(next);
    state.raw({ hausdepp_command: { command_id: first.command_id, accepted: true, version: s.version } });
    await page.waitForTimeout(1100);
    await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '1');
    await expect(card(page, HAND[1])).toBeEnabled();
    await expect(card(page, HAND[2])).toBeDisabled();
    await card(page, HAND[1]).click();
    await expect.poll(() => state.commands.length).toBe(2);
    expect(state.commands[1]).toMatchObject({ action: 'hausdepp_afterthrow', cards: [HAND[1]], version: s.version });
    await expect(page.locator('.hd-deal-card[data-motion-type="play"], .hd-deal-card[data-motion-type="launch"]')).toHaveCount(2);
    await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#hausdeppPile [data-card-id="hearts-U"], #hausdeppPile [data-card-id="bells-U"]')).toHaveCount(0);
  });

  test('an automatically refilled matching nine can be afterthrown before the own nine lands', async ({ page }) => {
    const state = await fixture(page, 'de');
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { version: s.version + 1, hand: ['hearts-9', 'bells-A', 'leaves-A'],
      playable_cards: ['hearts-9', 'bells-A', 'leaves-A'] });
    state.send(next);
    await expect(card(page, 'hearts-9')).toBeEnabled();
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.hd-deal-card[data-motion-type="launch"], .hd-deal-card[data-target="pile"]')) animation.pause();
        return animation;
      };
    });
    await card(page, 'hearts-9').click();
    const first = state.commands[0];
    const debt = { player_id: state.self, remaining: 1, rank: '9', continuation: 'advance' };
    Object.assign(s, { version: s.version + 1, hand: ['bells-A', 'leaves-A'], discard: [...s.discard, 'hearts-9'],
      current_player_id: state.remote, available_actions: ['draw', 'afterthrow'], playable_cards: [],
      afterthrow: { player_id: state.self, rank: '9' }, pending_refill: debt, pending_refills: [debt],
      draw_required: true, last_event: { type: 'play', player_id: state.self, cards: ['hearts-9'] } });
    state.send(next);
    state.raw({ hausdepp_command: { command_id: first.command_id, accepted: true, version: s.version } });
    await expect.poll(() => state.commands.length).toBe(2);
    const draw = state.commands[1];
    expect(draw).toMatchObject({ action: 'hausdepp_draw', version: s.version });
    await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
    await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-card-count', '1');
    Object.assign(s, { version: s.version + 1, hand: ['bells-A', 'leaves-A', 'bells-9'],
      available_actions: ['afterthrow'], playable_cards: ['bells-9'], pending_refill: null, pending_refills: [],
      draw_required: false, last_event: { type: 'draw', player_id: state.self, drawn_count: 1 } });
    state.send(next);
    state.raw({ hausdepp_command: { command_id: draw.command_id, accepted: true, version: s.version } });
    await expect(card(page, 'bells-9')).toBeEnabled();
    await card(page, 'bells-9').click();
    await expect.poll(() => state.commands.length).toBe(3);
    expect(state.commands[2]).toMatchObject({ action: 'hausdepp_afterthrow', cards: ['bells-9'], version: s.version });
    await expect(page.locator('.hd-deal-card[data-motion-type="play"], .hd-deal-card[data-motion-type="launch"]')).toHaveCount(2);
    await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#hausdeppPile [data-card-id="hearts-9"], #hausdeppPile [data-card-id="bells-9"]')).toHaveCount(0);
    await expect(page.locator('#hausdeppStock')).toBeDisabled();
    expect(state.commands.filter(command => command.action === 'hausdepp_draw')).toHaveLength(1);
  });

  test('a follow-up beaten by the next player\'s card flies back to the hand with a clear message', async ({ page }) => {
    const state = await fixture(page, 'de');
    const open = structuredClone(state.board), s = open._hausdepp;
    Object.assign(s, { version: s.version + 1, current_player_id: state.remote, available_actions: ['afterthrow'],
      playable_cards: HAND.slice(0, 2), afterthrow: { player_id: state.self, rank: 'U' } });
    state.send(open);
    await expect(card(page, HAND[0])).toBeEnabled();
    await card(page, HAND[0]).click();
    expect(state.commands.at(-1)).toMatchObject({ action: 'hausdepp_afterthrow', cards: [HAND[0]] });
    await expect(page.locator('.hd-deal-card[data-motion-type="launch"]')).toHaveCount(1);
    state.raw({ error: 'hausdepp_afterthrow_expired', hausdepp_error: { code: 'hausdepp_afterthrow_expired' } });
    await expect(page.locator('#hausdeppActionError')).toHaveText(/Zu spät/);
    // The card returns to its slot; it is never shown twice meanwhile.
    await expect(page.locator('.hd-deal-card')).toHaveCount(0);
    await expect(card(page, HAND[0])).toHaveCSS('visibility', 'visible');
  });

  test('three queued tens retain their own clearance chain and wait for each burn arrival', async ({ page }) => {
    const state = await fixture(page, 'de');
    const tens = ['hearts-10', 'bells-10', 'leaves-10'];
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { version: s.version + 1, hand: [...tens, 'leaves-A'], deck_count: 0,
      available_actions: ['play'], playable_cards: [...tens, 'leaves-A'] });
    state.send(next);
    await expect(card(page, tens[0])).toBeEnabled();
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.hd-deal-card')) animation.pause();
        return animation;
      };
    });
    for (const ten of tens) await card(page, ten).click();
    expect(state.commands).toHaveLength(1);
    for (let index = 0; index < tens.length; index += 1) {
      await expect.poll(() => state.commands.length).toBe(index + 1);
      const command = state.commands[index];
      expect(command).toMatchObject({ action: 'hausdepp_play', cards: [tens[index]], version: s.version });
      const burnCount = s.discard.length + 1;
      Object.assign(s, { version: s.version + 1, hand: s.hand.filter(card => card !== tens[index]), discard: [],
        burned_count: s.burned_count + burnCount, current_player_id: state.self, afterthrow: null,
        available_actions: ['play'], last_event: { type: 'play', player_id: state.self,
          cards: [tens[index]], burn_reason: 'ten', burned_count: burnCount } });
      s.playable_cards = [...s.hand];
      state.send(next);
      state.raw({ hausdepp_command: { command_id: command.command_id, accepted: true, version: s.version } });
      await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
      await expect(page.locator('.hd-deal-card[data-motion-type="burn"]')).toHaveCount(burnCount);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      // These are fresh plays after a clearance, rather than an open same-rank
      // afterthrow. The queued action must wait for that burn's physical end.
      expect(state.commands).toHaveLength(index + 1);
      await expect(card(page, 'leaves-A')).toBeDisabled();
      await page.locator('.hd-deal-card').evaluateAll(nodes => nodes.forEach(node =>
        node.getAnimations().forEach(animation => animation.finish())));
    }
    await expect(page.locator('.hd-deal-card')).toHaveCount(0);
    await expect(card(page, 'leaves-A')).toBeEnabled();
    expect(state.commands.map(command => command.cards)).toEqual(tens.map(ten => [ten]));
    await expect(page.locator('#hausdeppBurnedCount')).toHaveText('4');
  });

  test('a same-rank tap queued before acceptance never leaks into a later turn', async ({ page }) => {
    const state = await fixture(page, 'de');
    await card(page, HAND[0]).click();
    await expect(card(page, HAND[1])).toBeEnabled();
    await card(page, HAND[1]).click();
    expect(state.commands.map(command => command.action)).toEqual(['hausdepp_play']);
    const first = state.commands[0];
    const accepted = structuredClone(state.board), s = accepted._hausdepp;
    // Version +1 is the own card, +2 another player's move that hands the turn
    // back. The queued tap belonged to the closed follow-up, not this new turn.
    Object.assign(s, { version: s.version + 2, hand: HAND.slice(1), discard: [...s.discard, HAND[0], 'acorns-O'],
      current_player_id: state.self, available_actions: ['play', 'pickup', 'gamble'], playable_cards: [HAND[2]],
      afterthrow: null, last_event: { type: 'play', player_id: state.remote, cards: ['acorns-O'] } });
    s.playable_cards = HAND.slice(1);
    state.send(accepted);
    state.raw({ hausdepp_command: { command_id: first.command_id, accepted: true, version: state.board._hausdepp.version + 1 } });
    await page.waitForTimeout(200);
    expect(state.commands.map(command => command.action)).toEqual(['hausdepp_play']);
    await expect(card(page, HAND[1])).toBeEnabled();
  });

  test('remote throws and a fast pickup keep actual arrival order beyond the old presentation timer', async ({ page }) => {
    const state = await fixture(page, 'en');
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('.hd-deal-card')) animation.pause();
        return animation;
      };
    });
    const first = structuredClone(state.board), a = first._hausdepp;
    Object.assign(a, { version: a.version + 1, discard: [...a.discard, 'acorns-U'],
      last_event: { type: 'play', player_id: state.remote, cards: ['acorns-U'] } });
    state.send(first);
    const throwFlight = page.locator('.hd-deal-card[data-motion-type="play"]');
    await expect(throwFlight).toHaveCount(1);
    await page.waitForTimeout(1150);
    // The exception belongs to the own uninterrupted same-rank throw. Even
    // server-legal pile pickup and stock gambling still wait for remote paper.
    await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-pickup-available', 'false');
    await expect(page.locator('#hausdeppStock')).toBeDisabled();
    await page.locator('#hausdeppPile').dispatchEvent('click');
    await page.locator('#hausdeppStock').dispatchEvent('click');
    expect(state.commands).toEqual([]);
    const pickup = structuredClone(first), b = pickup._hausdepp;
    Object.assign(b, { version: b.version + 1, discard: [],
      last_event: { type: 'pickup', player_id: state.remote, picked_up_count: 2 } });
    state.send(pickup);
    const third = structuredClone(pickup), c = third._hausdepp;
    Object.assign(c, { version: c.version + 1, discard: ['bells-9'],
      last_event: { type: 'play', player_id: state.remote, cards: ['bells-9'] } });
    state.send(third);
    const nextThrow = page.locator('.hd-deal-card[data-motion-type="play"]').last();
    await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(2);
    await expect(nextThrow).toHaveCSS('visibility', 'hidden');
    await expect(page.locator('#hausdeppPile [data-card-id="acorns-U"], #hausdeppPile [data-card-id="bells-9"]')).toHaveCount(0);
    await expect(card(page, HAND[0])).toBeDisabled();
    // The first throw lands while the following pickup is still paused.
    await throwFlight.first().evaluate(node => node.getAnimations().forEach(animation => animation.play()));
    await expect(page.locator('#hausdeppPile [data-card-id="acorns-U"]')).toHaveCount(1);
    await expect(nextThrow).toHaveCSS('visibility', 'hidden');
    const pickupFlights = page.locator('.hd-deal-card[data-motion-type="pickup"]');
    await expect(pickupFlights.first()).toHaveCSS('visibility', 'visible');
    await pickupFlights.evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => animation.play())));
    await expect(page.locator('.hd-deal-card[data-motion-type="pickup"]')).toHaveCount(0);
    await expect(nextThrow).toHaveCSS('visibility', 'visible');
    await expect(page.locator('#hausdeppPile [data-card-id]')).toHaveCount(0);
    await nextThrow.evaluate(node => node.getAnimations().forEach(animation => animation.play()));
    await expect(page.locator('#hausdeppPile [data-card-id]')).toHaveCount(1);
    await expect(page.locator('#hausdeppPile [data-card-id]')).toHaveAttribute('data-card-id', 'bells-9');
    await expect(card(page, HAND[0])).toBeEnabled();
    await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-pickup-available', 'true');
    await expect(page.locator('#hausdeppStock')).toBeEnabled();
    expect(state.commands).toEqual([]);
  });

  for (const interrupted of ['resize', 'hidden', 'reduced-motion']) {
    test(`${interrupted} settles a paused accepted flight without stale cards or disabled controls`, async ({ page }) => {
      const state = await fixture(page, 'de');
      await page.evaluate(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('.hd-deal-card')) animation.pause();
          return animation;
        };
      });
      const next = structuredClone(state.board), s = next._hausdepp;
      Object.assign(s, { version: s.version + 1, discard: [...s.discard, 'acorns-U'],
        last_event: { type: 'play', player_id: state.remote, cards: ['acorns-U'] } });
      state.send(next);
      await expect(card(page, HAND[0])).toBeDisabled();
      if (interrupted === 'resize') await page.setViewportSize({ width: 568, height: 320 });
      else if (interrupted === 'reduced-motion') await page.emulateMedia({ reducedMotion: 'reduce' });
      else await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(page.locator('.hd-deal-card')).toHaveCount(0);
      await expect(page.locator('#hausdeppPile [data-card-id="acorns-U"]')).toHaveCount(1);
      if (interrupted === 'hidden') await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await expect(card(page, HAND[0])).toBeEnabled();
    });
  }
});

for (const [width, height] of [[390, 844], [320, 568], [844, 390], [768, 1024], [1440, 900]]) {
  test(`table tip for newer players replaces only the turn line text at ${width}x${height}`, async ({ page }) => {
    const state = await fixture(page, 'de');
    await page.setViewportSize({ width, height });
    const next = structuredClone(state.board), s = next._hausdepp;
    Object.assign(s, { version: s.version + 1, discard: ['leaves-A'], hand: ['hearts-7', 'bells-8', 'hearts-10'],
      playable_cards: ['hearts-10'], available_actions: ['play', 'pickup', 'gamble'], table_tip: null });
    state.send(next);
    const status = page.locator('#hausdeppStatus');
    await expect(status).toHaveText('Du bist dran.');
    const layout = () => page.evaluate(() => {
      const box = node => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height].map(Math.round); };
      const line = document.getElementById('hausdeppStatus');
      return { status: box(line), hand: box(document.getElementById('hausdeppHand')), pile: box(document.getElementById('hausdeppPile')),
        clipped: line.scrollWidth > line.clientWidth + 1 };
    });
    const before = await layout();
    s.version += 1; s.table_tip = { key: 'tipBuyAce' }; state.send(next);
    await expect(status).toHaveText('Tipp: Ass aufnehmen, 10 behalten');
    await expect(status).toHaveClass(/is-yours/);
    if (process.env.HAUSDEPP_TIP_SCREENSHOTS === '1') {
      await page.screenshot({ path: test.info().outputPath(`table-tip-${width}x${height}.png`) });
    }
    const after = await layout();
    // Nothing moves, nothing is covered, and the short tip fits the line.
    expect(after.hand).toEqual(before.hand);
    expect(after.pile).toEqual(before.pile);
    expect(after.status[3]).toBe(before.status[3]);
    expect(after.clipped).toBe(false);
    s.version += 1; s.table_tip = null; state.send(next);
    await expect(status).toHaveText('Du bist dran.');
  });
}

test.describe('public reveal of a successful cut', () => {
  test.use({ reducedMotion: 'no-preference' });
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    test(`everyone sees who receives the cut cards at ${width}x${height}`, async ({ page }) => {
      const state = await fixture(page, 'de');
      await page.setViewportSize({ width, height });
      const remote = state.board._hausdepp.players.find(player => player.id === state.remote);
      const peeking = structuredClone(state.board), p = peeking._hausdepp;
      Object.assign(p, { version: p.version + 1, phase: 'peeking', hand: [], discard: [], playable_cards: [],
        available_actions: [], peek: { player_id: state.remote, success: false, complete: false } });
      p.players = p.players.map(player => ({ ...player, hand_count: 0 }));
      state.send(peeking);
      await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
      const dealt = structuredClone(peeking), d = dealt._hausdepp;
      const others = d.players.filter(player => player.id !== state.remote);
      Object.assign(d, { version: p.version + 1, phase: 'playing', hand: [...HAND], discard: ['acorns-7'],
        current_player_id: state.self, available_actions: ['play', 'pickup', 'gamble'], playable_cards: [...HAND],
        peek: { player_id: state.remote, success: true, complete: true, cards: ['hearts-A', 'bells-A', 'leaves-10'] },
        last_event: { type: 'round_started' },
        deal: { version: p.version + 1, starter: 'acorns-7',
          sequence: [...others.map((player, index) => ({ player_id: player.id, hand_index: 0 })),
            { player_id: state.remote, hand_index: 2 }] } });
      d.players = d.players.map(player => ({ ...player, hand_count: 3 }));
      state.send(dealt);
      const reveal = page.locator('.hd-deal-card[data-motion-type="peek-reveal"]');
      await expect(reveal).toHaveCount(3);
      await expect(page.locator('.hd-peek-caption')).toHaveText(`${remote.name} bekommt Ass · Ass · 10`);
      // Mid-reveal both faces are open in the table centre for everyone.
      await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 1000; animation.pause(); }));
      const shown = await reveal.evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return { face: Boolean(node.querySelector('svg')), opacity: Number(getComputedStyle(node).opacity),
          x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }));
      const pile = await page.locator('#hausdeppPile').boundingBox();
      expect(shown.every(card => card.face && card.opacity > .99)).toBe(true);
      expect(shown.every(card => Math.abs(card.y - (pile.y + pile.height / 2)) < 4)).toBe(true);
      // Fully on screen and spread far enough that each face is distinguishable.
      const viewport = page.viewportSize();
      expect(shown.every(card => card.x > 0 && card.x < viewport.width)).toBe(true);
      const xs = shown.map(card => card.x).sort((a, b) => a - b);
      expect(Math.min(...xs.slice(1).map((x, index) => x - xs[index]))).toBeGreaterThan(30);
      if (process.env.HAUSDEPP_REVEAL_SCREENSHOTS === '1') {
        await page.screenshot({ path: test.info().outputPath(`peek-reveal-${width}x${height}.png`) });
      }
      // They end in the receiver's hand, and the deal waits for them.
      const flights = await page.evaluate(() => [...document.querySelectorAll('.hd-deal-card')].map(node => ({
        type: node.dataset.motionType, delay: Number(node.dataset.delay || 0) })));
      expect(flights.filter(item => item.type === 'deal').every(item => item.delay >= 2200)).toBe(true);
      const seat = await page.locator(`.hd-seat[data-player-id="${state.remote}"] [data-player-hand]`).boundingBox();
      await page.evaluate(() => document.getAnimations().forEach(animation => { animation.currentTime = 2199; }));
      const landed = await reveal.first().boundingBox();
      expect(landed.x + landed.width / 2).toBeGreaterThanOrEqual(seat.x - 4);
      expect(landed.x + landed.width / 2).toBeLessThanOrEqual(seat.x + seat.width + 4);
    });
  }
});

for (const [width, height] of [[390, 844], [1440, 900]]) {
  test(`round result lists places, XP and achievements at ${width}x${height}`, async ({ page }) => {
    const state = await fixture(page, 'de');
    await page.setViewportSize({ width, height });
    const done = structuredClone(state.board), s = done._hausdepp;
    const ids = s.players.map(player => player.id);
    const cpus = s.players.filter(player => player.is_cpu).map(player => player.id);
    const loser = cpus[0];
    Object.assign(done, { _finished: true, _hausdepp_round_summary: { round_id: 'r1', players: { [state.self]: {
      xp: 37, round_xp: 2, achievements: [
        { id: 'hausdepp_07', points: 25, name: { de: 'Saubere Hand', en: 'Clean hand' } },
        { id: 'hausdepp_01', points: 10, name: { de: 'Erste Runde', en: 'First round' } }] } } } });
    Object.assign(s, { version: s.version + 1, phase: 'finished', loser_id: loser, current_player_id: null,
      finished_order: [state.self, ...ids.filter(id => id !== state.self && id !== loser)],
      available_actions: [], playable_cards: [], hand: [] });
    state.send(done);
    const result = page.locator('#hausdeppResult');
    await expect(result).toBeVisible();
    const places = result.locator('.hd-result-place');
    await expect(places).toHaveCount(ids.length);
    await expect(places.first()).toContainText('1. Platz');
    await expect(places.first()).toContainText('+37 EP');
    await expect(places.first().locator('.hd-result-awards li')).toHaveCount(2);
    await expect(places.last()).toHaveClass(/is-hausdepp/);
    await expect(places.last()).toContainText('Hausdepp');
    await expect(places.nth(1)).toContainText('Computer');
    if (process.env.HAUSDEPP_RESULT_SCREENSHOTS === '1') {
      await page.screenshot({ path: test.info().outputPath(`round-result-${width}x${height}.png`), fullPage: false });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('the header avatar opens the own profile picture setting, not the account overview', async ({ page }) => {
  await fixture(page, 'de');
  const avatar = page.locator('.hd-profile-button');
  await expect(avatar).toHaveAttribute('href', '/hausdepp/konto/einstellungen#profilbild');
  await expect(avatar).toHaveAccessibleName(/Profil bearbeiten/);
  await avatar.click();
  await expect(page).toHaveURL(/\/hausdepp\/konto\/einstellungen#profilbild$/);
  const row = page.locator('details#profilbild');
  await expect(row).toHaveJSProperty('open', true);
  await expect(row.locator('[data-avatar-upload]')).toBeInViewport();
});

test('equal ranks on top of the open pile fan out so their count reads at a glance', async ({ page }) => {
  const state = await fixture(page, 'de');
  const next = structuredClone(state.board), s = next._hausdepp;
  const faces = page.locator('#hausdeppPile .hd-pile-face[data-run-step]');
  const ranks = ['hearts-U', 'bells-U', 'acorns-U', 'leaves-U'];
  for (const [width, height] of [[320, 568], [440, 956], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const count of [2, 3, 4]) {
      Object.assign(s, { version: s.version + 1, discard: ['leaves-6', ...ranks.slice(0, count)] });
      state.send(next);
      await expect(faces).toHaveCount(count);
      await expect(page.locator('#hausdeppPile')).toHaveAttribute('aria-label', new RegExp(`${count} gleiche oben`));
      // Read the settled fan; earlier cards extend right, away from the stock.
      await expect.poll(() => faces.evaluateAll(nodes => {
        const rights = nodes.map(node => node.getBoundingClientRect().right);
        const stock = document.querySelector('#hausdeppStock').getBoundingClientRect();
        const caption = document.querySelector('#hausdeppPileAction').getBoundingClientRect();
        return rights.every((right, index) => index === 0 || rights[index - 1] > right + 4)
          && nodes.every(node => {
            const card = node.getBoundingClientRect();
            return card.left >= stock.right && card.right <= window.innerWidth
              && (card.bottom <= caption.top || card.top >= caption.bottom
                || card.right <= caption.left || card.left >= caption.right);
          });
      }), { message: `${width}×${height}: ${count} cards fan right, clear the stock and caption, and stay on screen` }).toBe(true);
    }
  }
  if (process.env.HAUSDEPP_PILE_SCREENSHOTS === '1') {
    const box = await page.locator('.hd-centre').boundingBox();
    await page.screenshot({ path: test.info().outputPath('pile-run.png'), clip: box });
  }
  s.version += 1; s.discard = ['leaves-6', 'hearts-U']; state.send(next);
  await expect(page.locator('#hausdeppPile .hd-pile-face[data-run-step]')).toHaveCount(0);
});
