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
  expect(fixture.commands).toEqual([]);
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
    await expect(page.locator('#hausdeppStock')).toBeEnabled();
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
          if (!walker.currentNode.textContent.trim()) continue;
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
  expect(fixture.commands).toEqual([]);
});
