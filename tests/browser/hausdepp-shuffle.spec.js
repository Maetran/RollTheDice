const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Shuffle tests use an isolated database/server').not.toBe('8000');
});

async function owner(page, language = 'de') {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.shuffleOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => {
    localStorage.setItem('zdwa_language', value);
    window.__shuffleLayers = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const layers = [...node.querySelectorAll('.hd-shuffle-layer')];
        if (node.matches('.hd-shuffle-layer')) layers.push(node);
        for (const layer of layers) window.__shuffleLayers.push(layer.dataset.shuffleKey);
      }
    }).observe(document, { childList: true, subtree: true });
  }, language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // These scenarios verify gameplay/layout independently of the beginner offer.
  // Full offer, dismissal and tour hit tests remain in game-tours.spec.js.
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
  return headers;
}

test.afterEach(async ({ page }) => {
  const saved = page.shuffleOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', {
    headers: saved.headers, data: { preferred_language: saved.language },
  });
});

async function realCpuTable(page, language = 'de') {
  const headers = await owner(page, language);
  let board;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(String(payload));
      if (message.scoreboard?._hausdepp) board = message.scoreboard;
    } catch { /* Ignore non-JSON protocol frames. */ }
  }));
  // The first dealer is random; open tables until the viewer is the one who peeks.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const created = await page.request.post('/api/games', {
      headers, data: { name: 'Shuffle-Test · Echte Ausgangsprojektion', mode: '2',
        game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
    });
    expect(created.ok()).toBeTruthy();
    const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
    board = null;
    await page.goto(room);
    await expect.poll(() => board?._hausdepp?.viewer_id).toBeTruthy();
    const state = board._hausdepp;
    if (state.phase === 'peeking' && state.peek?.player_id === state.viewer_id) return { room, board: structuredClone(board) };
  }
  throw new Error('No table with the viewer as peeker after 12 random deals');
}

function phaseBoard(real, phase, { round = null, version = 20 } = {}) {
  const board = structuredClone(real);
  const self = board._hausdepp.viewer_id;
  board._name = 'Renderer-Test · Mischen ohne Spielverzögerung';
  board._paused = false; board._finished = false; board._aborted = false;
  board._started = phase !== 'waiting';
  board._chat_history = [];
  board._hausdepp_tournament = round ? {
    id: 'labelled-shuffle-tournament', round_number: round, completed: false,
    round_complete: false, can_start_next_round: false, target_word: 'HAUSDEPP',
    dealer_id: board._hausdepp.players.find(player => player.id !== self).id,
    letters: {}, losses: {}, tages_hausdepp_id: null,
  } : null;
  if (phase === 'waiting') { board._hausdepp = null; return board; }
  Object.assign(board._hausdepp, {
    version, phase, hand: phase === 'playing' ? ['hearts-6', 'bells-U', 'acorns-10'] : [],
    discard: phase === 'playing' ? ['leaves-6'] : [], deck_count: phase === 'playing' ? 29 : 36,
    burned_count: 0, current_player_id: self, dealer_id: board._hausdepp_tournament?.dealer_id,
    available_actions: phase === 'playing' ? ['play', 'pickup', 'gamble'] : ['peek'],
    playable_cards: phase === 'playing' ? ['hearts-6', 'bells-U', 'acorns-10'] : [],
    pending_refill: null, pending_refills: [], afterthrow: null, private_peek: [],
    draw_required: false, draw_urgent: false, stock_blocked_by: null, deal: null,
    peek: { player_id: self, complete: phase === 'playing', success: null, cards: [] },
    players: board._hausdepp.players.map(player => ({ ...player, hand_count: phase === 'playing' ? 3 : 0, finished: false })),
    finished_order: [], loser_id: null, last_event: { type: 'round_started' },
  });
  return board;
}

async function rendererFixture(page, { initial = 'waiting', round = null } = {}) {
  const real = await realCpuTable(page);
  // The fixture only replaces the renderer's WebSocket stream. The real table's
  // server state, cards, permissions and achievements are never rewritten.
  await page.evaluate(() => sessionStorage.clear());
  let current = phaseBoard(real.board, initial, { round });
  let active;
  let connections = 0;
  const commands = [];
  const id = real.room.split('/').pop();
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    active = socket;
    connections += 1;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (['join_game', 'spectate_game'].includes(message.action)) {
        socket.send(JSON.stringify({ player_id: real.board._hausdepp.viewer_id, scoreboard: current }));
      } else commands.push(message);
    });
  });
  await page.goto(real.room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', initial);
  return { real: real.board, room: real.room, commands,
    get connections() { return connections; },
    close: options => active.close(options),
    send: (board, extra = {}) => { current = board; active.send(JSON.stringify({ scoreboard: board, ...extra })); },
  };
}

async function pauseClock(page) {
  await page.clock.install({ time: new Date('2026-10-16T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-16T12:00:01Z'));
}

async function expectShuffle(page) {
  const layer = page.locator('.hd-shuffle-layer');
  await expect(layer).toHaveCount(1);
  await expect(layer).toHaveAttribute('aria-hidden', 'true');
  await expect(layer).toHaveAttribute('data-shuffle-key', /.+/);
  await expect(layer.locator('.hd-shuffle-half')).toHaveCount(2);
  const appearance = await layer.evaluate(element => ({
    pointerEvents: getComputedStyle(element).pointerEvents,
    position: getComputedStyle(element).position,
    hasCardFaces: Boolean(element.querySelector('[data-card-id], svg, img')),
    halves: [...element.querySelectorAll('.hd-shuffle-half')].map(half => ({
      children: half.children.length,
      backgrounds: [...half.children].map(card => getComputedStyle(card).backgroundImage),
    })),
  }));
  expect(appearance.pointerEvents).toBe('none');
  expect(appearance.position).toBe('fixed');
  expect(appearance.hasCardFaces, 'The shuffle presentation contains only anonymous card backs').toBe(false);
  for (const half of appearance.halves) {
    expect(half.children).toBe(3);
    expect(half.backgrounds.every(background => background.includes('card-back'))).toBe(true);
  }
  return layer;
}

test('waiting → peeking shows one brief shuffle and never blocks the actual stock', async ({ page }) => {
  const fixture = await rendererFixture(page);
  await pauseClock(page);
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  const peeking = phaseBoard(fixture.real, 'peeking');
  fixture.send(peeking);
  const layer = await expectShuffle(page);
  const firstKey = await layer.getAttribute('data-shuffle-key');
  await expect(page.locator('#hausdeppStock')).toBeEnabled();
  const hitsStock = await page.locator('#hausdeppStock').evaluate(stock => {
    const bounds = stock.getBoundingClientRect();
    return stock.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2));
  });
  expect(hitsStock, 'The pointer-inert presentation does not cover the working stock action').toBe(true);
  fixture.send({ ...peeking, _name: 'Renderer-Test · Gleiche Mischphase' });
  await expect(layer).toHaveAttribute('data-shuffle-key', firstKey);
  expect(await page.evaluate(() => window.__shuffleLayers.length)).toBe(1);
  await page.clock.runFor(900);
  await expect(layer).toHaveCount(0);
  // Mandatory refills are tapped automatically; nothing else may be sent.
  expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
  fixture.send(peeking);
  await expect(layer).toHaveCount(0);
  expect(await page.evaluate(() => window.__shuffleLayers.length)).toBe(1);
});

test('reduced motion skips decorative movement while peeking and dealing stay usable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await rendererFixture(page);
  await pauseClock(page);
  fixture.send(phaseBoard(fixture.real, 'peeking'));
  const layer = page.locator('.hd-shuffle-layer');
  await expect(page.locator('#hausdeppStock')).toBeEnabled();
  await expect(layer).toHaveCount(0);
  fixture.send(phaseBoard(fixture.real, 'playing', { version: 21 }));
  await expect(layer).toHaveCount(0);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  expect(await page.evaluate(() => window.__shuffleLayers.length)).toBe(0);
});

for (const language of ['de', 'en']) {
  test(`${language}: a fresh real CPU table shuffles on its first peeking snapshot, then reload stays quiet`, async ({ page }) => {
    await realCpuTable(page, language);
    await expect.poll(() => page.evaluate(() => window.__shuffleLayers.length)).toBe(1);
    await page.reload();
    await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
    await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
    expect(await page.evaluate(() => window.__shuffleLayers)).toEqual([]);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
  });
}

test('a peeking reload and socket reconnect preserve the once-per-round presentation', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'peeking' });
  await expect.poll(() => page.evaluate(() => window.__shuffleLayers.length)).toBe(1);
  await page.reload();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'peeking');
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  expect(await page.evaluate(() => window.__shuffleLayers)).toEqual([]);
  await pauseClock(page);
  const connections = fixture.connections;
  fixture.close({ code: 1012, reason: 'Labelled reconnect scenario' });
  await expect(page.locator('#hausdeppConnection')).toContainText('Verbindung');
  await page.clock.runFor(1600);
  await expect.poll(() => fixture.connections).toBe(connections + 1);
  await expect(page.locator('#hausdeppStock')).toBeEnabled();
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  expect(await page.evaluate(() => window.__shuffleLayers)).toEqual([]);
});

test('a first playing snapshot stays quiet while a new tournament round gets its own shuffle', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing', round: 1 });
  await pauseClock(page);
  expect(await page.evaluate(() => window.__shuffleLayers)).toEqual([]);
  fixture.send(phaseBoard(fixture.real, 'peeking', { round: 1 }));
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  fixture.send(phaseBoard(fixture.real, 'peeking', { round: 2, version: 30 }));
  const layer = await expectShuffle(page);
  const secondKey = await layer.getAttribute('data-shuffle-key');
  await expect(page.locator('#hausdeppTournamentBanner')).toContainText('Runde 2');
  fixture.send(phaseBoard(fixture.real, 'playing', { round: 2, version: 31 }));
  await expect(layer).toHaveCount(0);
  fixture.send(phaseBoard(fixture.real, 'peeking', { round: 3, version: 40 }));
  await expectShuffle(page);
  expect(await layer.getAttribute('data-shuffle-key')).not.toBe(secondKey);
  expect(await page.evaluate(() => window.__shuffleLayers.length)).toBe(2);
  expect(new URL(page.url()).pathname).toBe(fixture.room);
});

test('stock input and a disconnected socket cancel a running shuffle without an input lock', async ({ page }) => {
  const fixture = await rendererFixture(page);
  await pauseClock(page);
  fixture.send(phaseBoard(fixture.real, 'peeking'));
  await expectShuffle(page);
  await page.locator('#hausdeppStock').click();
  await expect.poll(() => fixture.commands.filter(message => message.action === 'hausdepp_peek').length).toBe(1);
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  const accepted = fixture.commands.find(message => message.action === 'hausdepp_peek');
  fixture.send(phaseBoard(fixture.real, 'peeking', { round: 2, version: 30 }), {
    hausdepp_command: { command_id: accepted.command_id, accepted: true, version: 30 },
  });
  await expectShuffle(page);
  fixture.close({ code: 1008, reason: 'Labelled terminal socket close' });
  await expect(page.locator('.hd-shuffle-layer')).toHaveCount(0);
  await expect(page.locator('#hausdeppStock')).toBeDisabled();
});

test('compact discard counters remain separate from stock captions and turn messages', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing' });
  for (const [width, height] of [[320, 568], [390, 844], [844, 390], [1024, 768], [1440, 900]]) for (const urgent of [false, true]) {
    await page.setViewportSize({ width, height });
    const board = phaseBoard(fixture.real, 'playing', { version: urgent ? 31 : 30 });
    if (urgent) Object.assign(board._hausdepp, {
      hand: ['hearts-6', 'bells-U'], available_actions: ['draw'], playable_cards: [],
      draw_required: true, draw_urgent: true,
      pending_refill: { player_id: board._hausdepp.viewer_id, remaining: 1, rank: '10', continuation: 'replay' },
    });
    fixture.send(board);
    await expect(page.locator('#hausdeppStockAction')).toHaveText(urgent ? 'Auf drei auffüllen' : 'Zocken');
    await page.evaluate(() => document.fonts.ready);
    const overlap = await page.evaluate(() => {
      const textRects = element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const result = [];
        while (walker.nextNode()) {
          // Only painted text counts: the screen-reader words are clipped away.
          if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('.hd-sr')) continue;
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          result.push(...[...range.getClientRects()].map(rect => ({
            left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          })));
        }
        return result;
      };
      const burned = textRects(document.querySelector('.hd-burned'));
      return ['hausdeppStockAction', 'hausdeppStockCount', 'hausdeppPileCount', 'hausdeppDrawAlert', 'hausdeppStatus', 'hausdeppEvent']
        .filter(id => textRects(document.getElementById(id)).some(caption => burned.some(counter =>
          Math.min(caption.right, counter.right) - Math.max(caption.left, counter.left) > 1
          && Math.min(caption.bottom, counter.bottom) - Math.max(caption.top, counter.top) > 1)));
    });
    expect(overlap, `${width}×${height} ${urgent ? 'urgent draw' : 'normal play'}: discard count must not overlap any nearby text`).toEqual([]);
  }
  // Mandatory refills are tapped automatically; nothing else may be sent.
  expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
});

async function watchPublicMotion(page) {
  await page.evaluate(() => {
    window.__publicMotions = [];
    window.addEventListener('hausdepp:motion', event => window.__publicMotions.push(event.detail));
  });
}

async function pausePublicPictures(page) {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('.hd-deal-card, #hausdeppPile')) {
      for (const animation of element.getAnimations()) animation.pause();
    }
  });
}

for (const reason of ['ten', 'four_of_a_kind']) {
  test(`a ${reason} burn leaves the public cause readable before the packet moves, while stock input stays live`, async ({ page }) => {
    const fixture = await rendererFixture(page, { initial: 'playing' });
    const initial = phaseBoard(fixture.real, 'playing', { version: 30 });
    const self = initial._hausdepp.viewer_id;
    initial._hausdepp.discard = reason === 'ten' ? ['leaves-6'] : ['acorns-6', 'leaves-6', 'bells-6'];
    fixture.send(initial);
    await expect(page.locator('#hausdeppPileCount')).toContainText(String(initial._hausdepp.discard.length));
    await watchPublicMotion(page);
    const next = structuredClone(initial);
    const played = reason === 'ten' ? 'acorns-10' : 'hearts-6';
    Object.assign(next._hausdepp, {
      version: 31, hand: initial._hausdepp.hand.filter(card => card !== played), discard: [],
      burned_count: initial._hausdepp.discard.length + 1, available_actions: ['draw'], playable_cards: [],
      last_event: { type: reason === 'ten' ? 'play' : 'afterthrow', player_id: self,
        cards: [played], burn_reason: reason, burned_count: initial._hausdepp.discard.length + 1 },
    });
    fixture.send(next);
    await expect(page.locator('.hd-deal-card[data-motion-type="burn"]')).toHaveCount(next._hausdepp.burned_count);
    await pausePublicPictures(page);
    const motions = await page.evaluate(() => window.__publicMotions);
    const play = motions.find(event => event.type === next._hausdepp.last_event.type);
    const burn = motions.find(event => event.type === 'burn');
    expect(play.rest).toBeGreaterThanOrEqual(300);
    // The packet departs exactly when the played card has been read: no gap.
    expect(burn.delay).toBeGreaterThanOrEqual(play.delay + play.duration);
    expect(burn.duration).toBeGreaterThanOrEqual(400);
    await expect(page.locator('#hausdeppBurnedCount')).toHaveText(String(next._hausdepp.burned_count));
    const visibleCause = await page.evaluate(type => {
      const opacity = element => Number(getComputedStyle(element).opacity);
      for (const ghost of document.querySelectorAll('.hd-deal-card')) {
        for (const animation of ghost.getAnimations()) animation.currentTime = ghost.dataset.motionType === 'burn' ? 0 : 700;
      }
      return {
        livePile: opacity(document.getElementById('hausdeppPile')),
        burn: [...document.querySelectorAll('[data-motion-type="burn"]')].map(opacity),
        faceUp: [...document.querySelectorAll(`.hd-deal-card[data-motion-type="pile-rest"], .hd-deal-card[data-motion-type="${type}"]`)]
          .filter(element => opacity(element) > .9 && element.querySelector('svg')).length,
      };
    }, next._hausdepp.last_event.type);
    expect(visibleCause.livePile).toBe(0);
    expect(visibleCause.burn.every(opacity => opacity === 0)).toBe(true);
    expect(visibleCause.faceUp).toBe(reason === 'ten' ? 2 : 4);
    // A presentation never gates the next authorised action: the mandatory
    // refill is tapped automatically, exactly once, while the packet moves.
    await expect.poll(() => fixture.commands.filter(command => command.action === 'hausdepp_draw').length).toBe(1);
  });
}

test('rapid accepted public plays expose the current packet immediately, same-version renders retain it, and disconnect clears the flight', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing' });
  await watchPublicMotion(page);
  const first = phaseBoard(fixture.real, 'playing', { version: 21 });
  const self = first._hausdepp.viewer_id;
  Object.assign(first._hausdepp, {
    hand: ['bells-U', 'acorns-10'], discard: ['leaves-6', 'hearts-6'],
    last_event: { type: 'play', player_id: self, cards: ['hearts-6'] },
  });
  fixture.send(first);
  await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(1);
  await pausePublicPictures(page);
  await page.evaluate(() => { window.__previousPublicCard = document.querySelector('[data-motion-type="play"]'); });
  const second = structuredClone(first);
  second._hausdepp.version += 1;
  second._hausdepp.discard.push('bells-6');
  second._hausdepp.last_event = { type: 'afterthrow', player_id: second._hausdepp.players.find(player => player.id !== self).id,
    cards: ['bells-6'] };
  fixture.send(second);
  await expect(page.locator('.hd-deal-card[data-motion-type="afterthrow"]')).toHaveCount(1);
  await pausePublicPictures(page);
  const evidence = await page.evaluate(() => {
    window.__currentPublicCard = document.querySelector('[data-motion-type="afterthrow"]');
    const pile = document.getElementById('hausdeppPile');
    return { motions: window.__publicMotions, flightOpacity: Number(getComputedStyle(window.__currentPublicCard).opacity),
      oldFlightConnected: window.__previousPublicCard.isConnected,
      oldPileCopies: document.querySelectorAll('[data-motion-type="pile-rest"]').length,
      livePile: Number(getComputedStyle(pile).opacity),
      cards: [...pile.querySelectorAll('[data-card-id]')].map(card => ({
        id: card.dataset.cardId, opacity: Number(getComputedStyle(card).opacity),
      })) };
  });
  const [play, afterthrow] = evidence.motions;
  expect(play.type).toBe('play');
  expect(afterthrow.type).toBe('afterthrow');
  expect(afterthrow.delay).toBe(0);
  expect(evidence.flightOpacity).toBe(1);
  expect(evidence.oldFlightConnected).toBe(false);
  expect(evidence.oldPileCopies).toBe(0);
  expect(evidence.livePile).toBe(1);
  expect(evidence.cards).toEqual(second._hausdepp.discard.map(id => ({ id, opacity: 1 })));
  fixture.send({ ...second, _name: 'Renderer-Test · Gleicher angenommener Stand' });
  await expect(page.locator('#hausdeppRoomName')).toHaveText('Renderer-Test · Gleicher angenommener Stand');
  expect(await page.evaluate(() => document.querySelector('[data-motion-type="afterthrow"]') === window.__currentPublicCard)).toBe(true);
  expect(await page.evaluate(() => window.__publicMotions.length)).toBe(2);
  fixture.close({ code: 1008, reason: 'Labelled motion queue disconnect' });
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  await expect(page.locator('#hausdeppPile')).toHaveCSS('opacity', '1');
});

test('four cards played together all remain face up after the last arrival and leave together before burning', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing' });
  const initial = phaseBoard(fixture.real, 'playing', { version: 30 });
  const self = initial._hausdepp.viewer_id;
  const cards = ['acorns-A', 'leaves-A', 'hearts-A', 'bells-A'];
  initial._hausdepp.hand = cards;
  initial._hausdepp.discard = ['leaves-K'];
  initial._hausdepp.playable_cards = cards;
  fixture.send(initial);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(4);
  const next = structuredClone(initial);
  Object.assign(next._hausdepp, { version: 31, hand: [], discard: [], burned_count: 5, playable_cards: [],
    last_event: { type: 'play', player_id: self, cards, burn_reason: 'four_of_a_kind', burned_count: 5 } });
  fixture.send(next);
  await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(4);
  await pausePublicPictures(page);
  const arrivals = await page.locator('[data-motion-type="play"]').evaluateAll(elements => elements.map(element => {
    const animation = element.getAnimations()[0];
    animation.currentTime = 1000;
    return { opacity: Number(getComputedStyle(element).opacity),
      end: Number(element.dataset.delay) + Number(element.dataset.duration), hasFace: Boolean(element.querySelector('svg')) };
  }));
  expect(arrivals.every(card => card.opacity === 1 && card.hasFace)).toBe(true);
  expect(new Set(arrivals.map(card => card.end)).size, 'No card vanishes while the other matching cards are still arriving').toBe(1);
});

test('enabling reduced motion cancels an active public sequence and reveals the current authoritative pile', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing' });
  const next = phaseBoard(fixture.real, 'playing', { version: 21 });
  Object.assign(next._hausdepp, { discard: [], burned_count: 2,
    last_event: { type: 'play', player_id: next._hausdepp.viewer_id, cards: ['acorns-10'], burn_reason: 'ten', burned_count: 2 } });
  fixture.send(next);
  await expect(page.locator('.hd-deal-card[data-motion-type="burn"]')).toHaveCount(2);
  await pausePublicPictures(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  // This accepted burn leaves an empty, disabled pile. Its mask is released:
  // the table never fades its stacks, so the empty place is fully painted.
  await expect(page.locator('#hausdeppPile')).toBeDisabled();
  await expect(page.locator('#hausdeppPile')).toHaveCSS('opacity', '1');
  expect(await page.locator('#hausdeppPile').evaluate(element => element.getAnimations().length)).toBe(0);
  await expect(page.locator('#hausdeppBurnedCount')).toHaveText('2');
  // Mandatory refills are tapped automatically; nothing else may be sent.
  expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
});

// Freeze the real WAAPI pictures as soon as the renderer creates them. This
// controls inspection time without replacing animate(), its keyframes or CSS.
async function freezePileGeometry(page) {
  await page.evaluate(() => {
    window.__pileGeometryGroups = {};
    window.__pileGeometryRect = element => {
      const box = element.getBoundingClientRect();
      let angle = 0;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        const rotation = (style.rotate || 'none').split(' ').at(-1);
        angle += (parseFloat(rotation) || 0) * (rotation.endsWith('rad') ? 180 / Math.PI : rotation.endsWith('turn') ? 360 : 1);
        if (style.transform !== 'none') {
          const matrix = new DOMMatrixReadOnly(style.transform);
          angle += Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
        }
      }
      return { left: box.left, top: box.top, width: box.width, height: box.height, angle };
    };
    window.__pileGeometryOpacity = element => {
      let opacity = 1;
      for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return opacity;
    };
    window.__pileGeometryObserver?.disconnect();
    window.__pileGeometryObserver = new MutationObserver(() => {
      for (const element of document.querySelectorAll('.hd-deal-card, #hausdeppPile')) {
        for (const animation of element.getAnimations()) animation.pause();
      }
    });
    window.__pileGeometryObserver.observe(document.body, { childList: true, subtree: true });
  });
}

async function renderedPileGeometry(page) {
  return page.locator('#hausdeppPile').evaluate(pile => {
    const rect = window.__pileGeometryRect;
    return { control: rect(pile), opacity: window.__pileGeometryOpacity(pile),
      faces: [...pile.querySelectorAll('[data-card-id]')].map(card => ({
        id: card.dataset.cardId, opacity: window.__pileGeometryOpacity(card),
        paper: rect(card), art: rect(card.querySelector('svg.hd-card-art')),
      })) };
  });
}

async function pinPilePictures(page, key, type, count) {
  const selector = `.hd-deal-card[data-motion-type="${type}"]`;
  await expect.poll(() => page.locator(selector).count()).toBeGreaterThanOrEqual(count);
  await page.evaluate(async ({ key, selector, count }) => {
    const pictures = [...document.querySelectorAll(selector)].slice(-count);
    window.__pileGeometryGroups[key] = pictures;
    const animations = pictures.flatMap(element => element.getAnimations());
    for (const animation of animations) animation.pause();
    await Promise.all(animations.map(animation => animation.ready));
  }, { key, selector, count });
}

async function measurePilePictures(page, key, phase) {
  return page.evaluate(async ({ key, phase }) => {
    const pictures = window.__pileGeometryGroups[key];
    for (const element of pictures) {
      const animation = element.getAnimations()[0];
      if (!(animation instanceof Animation)) throw new Error('A real card animation is required for geometry inspection');
      animation.pause();
      const timing = animation.effect.getTiming();
      const visible = animation.effect.getKeyframes().filter(frame => Number(frame.opacity) === 1);
      const first = visible[0].computedOffset;
      const last = visible.at(-1).computedOffset;
      const progress = phase === 'start' ? first : phase === 'rest' ? (first + last) / 2 : last;
      animation.currentTime = timing.delay + timing.duration * progress;
    }
    await new Promise(resolve => requestAnimationFrame(resolve));
    const rect = window.__pileGeometryRect;
    return pictures.map(element => ({
      index: Number(element.dataset.index), delay: Number(element.dataset.delay),
      opacity: Number(getComputedStyle(element).opacity),
      paper: rect(element), art: rect(element.querySelector('svg.hd-card-art')),
    }));
  }, { key, phase });
}

function expectSamePaperGeometry(actual, expected, label) {
  // A CSS pixel accommodates layout/transform rounding across browser engines;
  // the reference always comes from the real current card, never a size cap.
  for (const property of ['left', 'top', 'width', 'height']) {
    expect(Math.abs(actual[property] - expected[property]), `${label}: ${property}`).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(actual.angle - expected.angle), `${label}: rotation`).toBeLessThanOrEqual(.1);
}

async function expectInstantPilePictures(page, testInfo, { name, before, incoming, discard }) {
  const durable = await renderedPileGeometry(page);
  expect(durable.faces.map(card => card.id)).toEqual(discard.slice(-3));
  const top = durable.faces.at(-1);
  for (const part of ['paper', 'art']) expectSamePaperGeometry(top[part], durable.control, `${name} current top ${part}`);
  const frames = {};
  for (const phase of ['start', 'rest', 'arrival']) {
    const pictures = await measurePilePictures(page, incoming, phase);
    const current = await renderedPileGeometry(page);
    frames[phase] = { pictures, current };
    expect(pictures).toHaveLength(1);
    expect(pictures[0].delay, `${name}: an accepted append never waits behind an older flight`).toBe(0);
    expect(pictures[0].opacity, `${name}: the decorative incoming card stays readable at ${phase}`).toBeGreaterThan(.99);
    expect(current.opacity, `${name}: the real packet is visible at ${phase}`).toBe(1);
    expect(current.faces.map(card => card.id)).toEqual(discard.slice(-3));
    for (const [index, card] of current.faces.entries()) {
      expect(card.opacity, `${name}: real ${card.id} stays visible at ${phase}`).toBe(1);
      for (const part of ['paper', 'art']) expectSamePaperGeometry(card[part], durable.faces[index][part],
        `${name} real ${card.id} ${phase} ${part}`);
    }
    if (phase === 'arrival') for (const part of ['paper', 'art']) {
      expectSamePaperGeometry(pictures[0][part], top[part], `${name} arrival ${part}`);
    }
    await expect(page.locator('.hd-deal-card[data-motion-type="pile-rest"]')).toHaveCount(0);
  }
  await testInfo.attach(`${name}-actual-card-geometry`, {
    body: JSON.stringify({ before, frames, durable }, null, 2), contentType: 'application/json',
  });
  if (process.env.HAUSDEPP_GEOMETRY_SCREENSHOTS === '1') {
    await page.screenshot({ path: testInfo.outputPath(`${name}-stable-pile.png`) });
  }
  return durable;
}

async function expectStablePilePictures(page, testInfo, { name, before, incoming, durable }) {
  const start = await measurePilePictures(page, `${name}-old`, 'start');
  const rest = await measurePilePictures(page, `${name}-old`, 'rest');
  const arrival = await measurePilePictures(page, incoming, 'arrival');
  await testInfo.attach(`${name}-actual-card-geometry`, {
    body: JSON.stringify({ before, start, rest, arrival, durable }, null, 2), contentType: 'application/json',
  });
  for (const [phase, pictures] of [['start', start], ['rest', rest]]) {
    expect(pictures).toHaveLength(before.faces.length);
    for (const [index, picture] of pictures.entries()) {
      expect(picture.opacity, `${name}: the previous card stays visible at ${phase}`).toBeGreaterThan(.99);
      for (const part of ['paper', 'art']) expectSamePaperGeometry(picture[part], before.faces[index][part],
        `${name} previous ${before.faces[index].id} ${phase} ${part}`);
    }
  }
  expect(arrival).toHaveLength(1);
  expect(arrival[0].opacity, `${name}: the arriving card remains readable`).toBeGreaterThan(.99);
  for (const part of ['paper', 'art']) expectSamePaperGeometry(arrival[0][part], durable[part], `${name} arrival ${part}`);
  if (process.env.HAUSDEPP_GEOMETRY_SCREENSHOTS === '1') {
    await page.screenshot({ path: testInfo.outputPath(`${name}-stable-pile.png`) });
  }
}

const PILE_GEOMETRY_DEVICES = [
  ['phone-320', 320, 568], ['iphone-390', 390, 844],
  ['landscape-568', 568, 320], ['landscape-844', 844, 390],
  ['tablet-768', 768, 1024], ['tablet-landscape-1024', 1024, 768],
  ['ipad-820', 820, 1180], ['ipad-landscape-1180', 1180, 820],
  ['tablet-max', 900, 1440],
  ['ipad-pro-portrait', 1024, 1366], ['ipad-pro-landscape', 1366, 1024],
  ['desktop-1440', 1440, 900], ['desktop-1920', 1920, 1080],
  ['split-view', 600, 900],
];
test.describe('stable pile geometry', () => {
    test.use({ reducedMotion: 'no-preference' });
    for (const [device, width, height] of PILE_GEOMETRY_DEVICES) {
      test.describe(device, () => {
        const touch = !device.startsWith('desktop-');
        test.use({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
        test('previous packet faces and incoming cards retain their real dimensions and positions', async ({ page }, testInfo) => {
          const fixture = await rendererFixture(page, { initial: 'playing' });
          await page.evaluate(async () => {
            await document.fonts.ready;
            await Promise.all([...new Set([...document.querySelectorAll('svg image')].map(image => image.getAttribute('href')))]
              .map(async source => { const image = new Image(); image.src = source; await image.decode(); }));
          });
          await freezePileGeometry(page);
          const normal = phaseBoard(fixture.real, 'playing', { version: 30 });
          const self = normal._hausdepp.viewer_id;
          const other = normal._hausdepp.players.find(player => player.id !== self).id;
          Object.assign(normal._hausdepp, { hand: ['hearts-9', 'bells-U', 'acorns-10'],
            playable_cards: ['hearts-9', 'bells-U', 'acorns-10'], discard: ['leaves-6', 'bells-7', 'acorns-8'] });
          fixture.send(normal);
          await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', 'acorns-8');
          const beforeNormal = await renderedPileGeometry(page);
          const played = structuredClone(normal);
          Object.assign(played._hausdepp, { version: 31, hand: ['bells-U', 'acorns-10'],
            discard: [...normal._hausdepp.discard, 'hearts-9'],
            last_event: { type: 'play', player_id: self, cards: ['hearts-9'] } });
          fixture.send(played);
          await pinPilePictures(page, 'normal-play', 'play', 1);
          await expectInstantPilePictures(page, testInfo, { name: 'normal', before: beforeNormal,
            incoming: 'normal-play', discard: played._hausdepp.discard });

          // The fourth equal rank clears the packet. The incoming face still
          // lands at full pile size before the existing burn sequence departs.
          const burn = phaseBoard(fixture.real, 'playing', { version: 40 });
          Object.assign(burn._hausdepp, { hand: ['hearts-6', 'bells-U', 'acorns-10'],
            playable_cards: ['hearts-6'], discard: ['acorns-6', 'leaves-6', 'bells-6'] });
          fixture.send(burn);
          await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', 'bells-6');
          const beforeBurn = await renderedPileGeometry(page);
          const burned = structuredClone(burn);
          Object.assign(burned._hausdepp, { version: 41, hand: ['bells-U', 'acorns-10'], discard: [],
            burned_count: 4, available_actions: ['draw'], playable_cards: [],
            last_event: { type: 'afterthrow', player_id: self, cards: ['hearts-6'],
              burn_reason: 'four_of_a_kind', burned_count: 4 } });
          fixture.send(burned);
          await pinPilePictures(page, 'four-equal-old', 'pile-rest', 3);
          await pinPilePictures(page, 'four-equal-play', 'afterthrow', 1);
          await expect(page.locator('.hd-deal-card[data-motion-type="burn"]')).toHaveCount(4);
          const emptyDestination = (await renderedPileGeometry(page)).control;
          await expectStablePilePictures(page, testInfo, { name: 'four-equal', before: beforeBurn,
            incoming: 'four-equal-play', durable: { paper: emptyDestination, art: emptyDestination } });

          // Deliver a second accepted action before the first picture finishes.
          // Its real packet must be painted immediately, replacing any older
          // flight while retaining the current cards' actual poses in every frame.
          const rapid = structuredClone(normal);
          rapid._hausdepp.version = 50;
          fixture.send(rapid);
          await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', 'acorns-8');
          const beforeRapid = await renderedPileGeometry(page);
          const first = structuredClone(played);
          first._hausdepp.version = 51;
          fixture.send(first);
          await pinPilePictures(page, 'rapid-first-play', 'play', 1);
          const firstDestination = await expectInstantPilePictures(page, testInfo, { name: 'rapid-first', before: beforeRapid,
            incoming: 'rapid-first-play', discard: first._hausdepp.discard });
          const second = structuredClone(first);
          Object.assign(second._hausdepp, { version: 52, discard: [...first._hausdepp.discard, 'bells-9'],
            last_event: { type: 'afterthrow', player_id: other, cards: ['bells-9'] } });
          fixture.send(second);
          await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', 'bells-9');
          await pinPilePictures(page, 'rapid-second-play', 'afterthrow', 1);
          expect(await page.evaluate(() => window.__pileGeometryGroups['rapid-first-play'].every(card => !card.isConnected)),
            'The newer accepted append removes the obsolete first flight').toBe(true);
          await expect(page.locator('.hd-deal-card[data-motion-type="play"]')).toHaveCount(0);
          await expectInstantPilePictures(page, testInfo, { name: 'rapid-second', before: firstDestination,
            incoming: 'rapid-second-play', discard: second._hausdepp.discard });
          // Mandatory refills are tapped automatically; nothing else may be sent.
  expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
        });
      });
    }
});

test('stable pile geometry: resizing cancels the old pictures and exposes the new authoritative card pose', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: 'playing' });
  await freezePileGeometry(page);
  const next = phaseBoard(fixture.real, 'playing', { version: 21 });
  Object.assign(next._hausdepp, { discard: ['leaves-6', 'hearts-6'],
    last_event: { type: 'play', player_id: next._hausdepp.viewer_id, cards: ['hearts-6'] } });
  fixture.send(next);
  await pinPilePictures(page, 'resize-play', 'play', 1);
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.hd-deal-card')).toHaveCount(0);
  await expect(page.locator('#hausdeppPile')).toHaveCSS('opacity', '1');
  await expect(page.locator('#hausdeppPile [data-card-id]').last()).toHaveAttribute('data-card-id', 'hearts-6');
  const current = await renderedPileGeometry(page);
  expectSamePaperGeometry(current.faces.at(-1).paper, current.control, 'resized current top card');
  expectSamePaperGeometry(current.faces.at(-1).art, current.control, 'resized current artwork');
  // Mandatory refills are tapped automatically; nothing else may be sent.
  expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
});
