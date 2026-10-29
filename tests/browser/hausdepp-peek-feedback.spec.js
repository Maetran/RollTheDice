const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Cut feedback tests require an isolated test server').not.toBe('8000');
});

test.afterEach(async ({ page }) => {
  const saved = page.peekFeedbackOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', {
    headers: saved.headers, data: { preferred_language: saved.language },
  });
});

async function realProjection(page, language) {
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.peekFeedbackOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
  let board;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try {
      const message = JSON.parse(String(payload));
      if (message.scoreboard?._hausdepp) board = message.scoreboard;
    } catch { /* Ignore protocol frames without a scoreboard. */ }
  }));
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Cut feedback · Real initial projection', mode: '2',
      game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
  });
  expect(created.ok()).toBeTruthy();
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  await page.goto(room);
  await expect.poll(() => board?._hausdepp?.viewer_id).toBeTruthy();
  return { room, board: structuredClone(board) };
}

function snapshot(real, { round = 1, version = 20, cards = [], complete = false,
  otherCutter = false, success = false } = {}) {
  const board = structuredClone(real);
  const state = board._hausdepp;
  const self = state.viewer_id;
  const other = state.players.find(player => player.id !== self).id;
  const cutter = otherCutter ? other : self;
  const phase = complete ? 'playing' : 'peeking';
  board._name = `Cut feedback · Round ${round} · Version ${version}`;
  Object.assign(board, { _paused: false, _started: true, _finished: false, _aborted: false, _chat_history: [] });
  board._hausdepp_tournament = {
    id: 'cut-feedback-tournament', round_number: round, completed: false,
    round_complete: false, can_start_next_round: false, target_word: 'HAUSDEPP',
    dealer_id: other, letters: {}, losses: {}, tages_hausdepp_id: null,
  };
  Object.assign(state, {
    version, phase, hand: complete ? ['hearts-6', 'bells-U', 'acorns-10'] : [],
    discard: complete ? ['leaves-6'] : [], deck_count: complete ? 29 : 36,
    burned_count: 0, dealer_id: other, current_player_id: complete ? self : cutter,
    available_actions: complete ? ['play', 'pickup', 'gamble'] : otherCutter ? [] : ['peek'],
    playable_cards: complete ? ['hearts-6', 'bells-U', 'acorns-10'] : [],
    pending_refill: null, pending_refills: [], afterthrow: null,
    private_peek: otherCutter ? [] : [...cards],
    private_peek_in_stock: otherCutter || success ? [] : [...cards],
    draw_required: false, draw_urgent: false, stock_blocked_by: null, deal: complete && success ? { version, sequence: [], starter: 'leaves-6' } : null,
    peek: { player_id: cutter, complete, success: complete ? success : null,
      cards: success || !otherCutter ? [...cards] : [] },
    players: state.players.map(player => ({ ...player, hand_count: complete ? 3 : 0, finished: false })),
    finished_order: [], loser_id: null,
    last_event: { type: complete ? 'deal' : 'peek_required', player_id: cutter },
  });
  return board;
}

async function rendererFixture(page, { language = 'de', initial = {} } = {}) {
  const real = await realProjection(page, language);
  await page.evaluate(() => sessionStorage.clear());
  // Only the renderer receives labelled snapshots. No server cards, tournament,
  // achievements or player permissions are rewritten by this fixture.
  let current = snapshot(real.board, initial);
  let active;
  const commands = [];
  const id = real.room.split('/').pop();
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    active = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (handleDisabledHausdeppVoice(socket, message)) return;
      if (['join_game', 'spectate_game'].includes(message.action)) {
        socket.send(JSON.stringify({ player_id: real.board._hausdepp.viewer_id, scoreboard: current }));
      } else commands.push(message);
    });
  });
  await page.goto(real.room);
  await expect(page.locator('#hausdeppRoomName')).toHaveText(current._name);
  return { commands,
    async send(options, extra = {}) {
      current = snapshot(real.board, options);
      active.send(JSON.stringify({ scoreboard: current, ...extra }));
      await expect(page.locator('#hausdeppRoomName')).toHaveText(current._name);
    },
    async cut(options) {
      const previous = commands.filter(message => message.action === 'hausdepp_peek').length;
      await page.locator('#hausdeppStock').click();
      await expect.poll(() => commands.filter(message => message.action === 'hausdepp_peek').length).toBe(previous + 1);
      const accepted = commands.filter(message => message.action === 'hausdepp_peek').at(-1);
      await this.send(options, { hausdepp_command: {
        command_id: accepted.command_id, accepted: true, version: options.version,
      } });
    },
  };
}

async function pauseClock(page) {
  await page.clock.install({ time: new Date('2026-10-19T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-19T12:00:01Z'));
}

async function expectCards(locator, cards) {
  await expect(locator.locator('[data-card-id]')).toHaveCount(cards.length);
  expect(await locator.locator('[data-card-id]').evaluateAll(nodes => nodes.map(node => node.dataset.cardId))).toEqual(cards);
}

for (const language of ['de', 'en']) {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    test(`${language}, ${reducedMotion}: cut faces slide from under the stock, then leave a private bottom-card hint`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion });
      const fixture = await rendererFixture(page, { language });
      await pauseClock(page);
      const preview = page.locator('#hausdeppCutPreview');
      const tools = page.locator('#hausdeppTools');
      const history = page.locator('#hausdeppPeek');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      await expect(preview).toBeHidden();
      expect(await tools.evaluate(element => element.open)).toBe(false);
      expect(await history.evaluate(element => element.open)).toBe(false);

      await fixture.cut({ version: 21, cards: ['hearts-A'] });
      await expect(page.locator('.hd-stock-group #hausdeppCutPreview')).toBeVisible();
      await expectCards(preview, ['hearts-A']);
      await expect(page.locator('#hausdeppStock')).toBeEnabled();
      expect(await history.evaluate(element => element.closest('#hausdeppTools') !== null)).toBe(true);
      await expect(history).toBeHidden();
      // Cut faces are behind the face-down pile and protrude on its left.
      const placement = await preview.evaluate(node => {
        const stock = document.querySelector('#hausdeppStock'), a = node.getBoundingClientRect(), b = stock.getBoundingClientRect();
        return { left: a.left, right: a.right, stockLeft: b.left, stockRight: b.right,
          previewZ: Number(getComputedStyle(node).zIndex), stockZ: Number(getComputedStyle(stock).zIndex),
          animation: getComputedStyle(node.querySelector('.hausdepp-card')).animationName };
      });
      expect(placement.left).toBeGreaterThanOrEqual(0);
      expect(placement.left).toBeLessThan(placement.stockLeft);
      expect(placement.right).toBeLessThan(placement.stockRight);
      expect(placement.previewZ).toBeLessThan(placement.stockZ);
      expect(placement.animation).toBe(reducedMotion === 'reduce' ? 'none' : 'hd-cut-slide-under');
      if (reducedMotion === 'no-preference') {
        const frames = await preview.locator('.hausdepp-card').first().evaluate(node => node.getAnimations()[0].effect.getKeyframes());
        expect(frames[0].transform).toBe('translateY(-15%)');
        expect(frames.at(-1).transform).toBe('translateY(0px)');
      }
      expect(await page.locator('#hausdeppStock').evaluate(stock => {
        const rect = stock.getBoundingClientRect();
        return stock.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), 'The private preview leaves the next cut reachable').toBe(true);
      await page.clock.runFor(1101);
      await expect(preview).toBeHidden();
      await expect(page.locator('#hausdeppKnownBottomCards')).toBeVisible();
      await expectCards(page.locator('#hausdeppKnownBottomCards'), ['hearts-A']);

      await fixture.cut({ version: 22, cards: ['hearts-A', 'bells-K'], complete: true });
      await expectCards(preview, ['hearts-A', 'bells-K']);
      await expect(preview).toBeVisible();
      await expect(page.locator('#hausdeppHand [data-card-id="hearts-6"]')).toBeEnabled();
      if (language === 'de' && reducedMotion === 'no-preference') {
        await page.screenshot({ path: test.info().outputPath('cut-preview-mobile-390x844.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.screenshot({ path: test.info().outputPath('cut-preview-desktop-1440x900.png'), animations: 'disabled' });
        await page.setViewportSize({ width: 390, height: 844 });
      }
      await page.clock.runFor(600);
      await expect(preview).toBeVisible();
      await fixture.send({ version: 23, cards: ['hearts-A', 'bells-K'], complete: true });
      await page.clock.runFor(499);
      await expect(preview).toBeVisible();
      await page.clock.runFor(2);
      await expect(preview).toBeHidden();
      await expect(page.locator('#hausdeppKnownBottomCards')).toBeVisible();
      await fixture.send({ version: 24, cards: ['hearts-A', 'bells-K'], complete: true });
      await expect(preview).toBeHidden();
      expect(await tools.evaluate(element => element.open)).toBe(false);
      expect(await history.evaluate(element => element.open)).toBe(false);

      await tools.locator(':scope > summary').click();
      await expect(history.locator(':scope > summary')).toHaveText(language === 'de' ? 'Beim Abheben gesehen' : 'Seen when lifting the deck');
      await expect(page.locator('#hausdeppPeekCards')).toBeHidden();
      await history.locator(':scope > summary').click();
      await expect(page.locator('#hausdeppPeekCards')).toBeVisible();
      await expectCards(page.locator('#hausdeppPeekCards'), ['hearts-A', 'bells-K']);
    });
  }
}

test('private cut remains beneath the stock on narrow and landscape screens', async ({ page }) => {
  const fixture = await rendererFixture(page);
  await pauseClock(page);
  for (const [index, [width, height]] of [[320, 568], [440, 956], [568, 320], [1440, 900]].entries()) {
    await page.setViewportSize({ width, height });
    await fixture.send({ round: index + 1, version: 40 + 2 * index });
    await fixture.cut({ round: index + 1, version: 41 + 2 * index, cards: ['hearts-A'] });
    const preview = page.locator('#hausdeppCutPreview');
    await expect(preview).toBeVisible();
    const geometry = await preview.evaluate(node => {
      const a = node.getBoundingClientRect(), stock = document.querySelector('#hausdeppStock');
      const b = stock.getBoundingClientRect();
      return { left: a.left, right: a.right, top: a.top, bottom: a.bottom,
        stockLeft: b.left, stockRight: b.right, below: Number(getComputedStyle(node).zIndex) < Number(getComputedStyle(stock).zIndex) };
    });
    expect(geometry.left, `${width}x${height}`).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.left).toBeLessThan(geometry.stockLeft);
    expect(geometry.right).toBeLessThan(geometry.stockRight);
    expect(geometry.below).toBe(true);
    await page.clock.runFor(1101);
    await expect(preview).toBeHidden();
    await expect(page.locator('#hausdeppKnownBottomCards')).toBeVisible();
  }
});

test('a new tournament round clears old cards before the next cutter; repeated cards get a fresh preview later', async ({ page }) => {
  const fixture = await rendererFixture(page);
  await pauseClock(page);
  const preview = page.locator('#hausdeppCutPreview');
  const history = page.locator('#hausdeppPeek');
  await fixture.send({ version: 21, cards: ['hearts-A'] });
  await fixture.send({ version: 22, cards: ['hearts-A', 'bells-K'], complete: true });
  await expect(preview).toBeVisible();
  await page.locator('#hausdeppTools > summary').click();
  await history.locator(':scope > summary').click();
  await expect(page.locator('#hausdeppPeekCards')).toBeVisible();

  await fixture.send({ round: 2, version: 30, otherCutter: true });
  expect(await history.evaluate(element => ({ hidden: element.hidden, open: element.open }))).toEqual({ hidden: true, open: false });
  await expectCards(page.locator('#hausdeppPeekCards'), []);
  await expect(preview).toBeHidden();
  await expectCards(preview, []);
  await expect(page.locator('#hausdeppKnownBottomCards')).toBeHidden();
  await expect(page.locator('#hausdeppStock')).toBeDisabled();

  await fixture.send({ round: 3, version: 40 });
  await expect(preview).toBeHidden();
  await fixture.send({ round: 3, version: 41, cards: ['hearts-A'] });
  await expect(preview).toBeVisible();
  await expectCards(preview, ['hearts-A']);
  await fixture.send({ round: 3, version: 42, cards: ['hearts-A', 'bells-K'], complete: true });
  await expectCards(preview, ['hearts-A', 'bells-K']);
  await page.clock.runFor(1101);
  await expect(preview).toBeHidden();
});

test('another cutter never gets a private preview and reloading an already playing round stays quiet', async ({ page }) => {
  const fixture = await rendererFixture(page, { initial: { otherCutter: true } });
  const preview = page.locator('#hausdeppCutPreview');
  await expect(preview).toBeHidden();
  await fixture.send({ version: 21, otherCutter: true });
  await expectCards(preview, []);
  await expect(page.locator('#hausdeppPeek')).toBeHidden();
  // The successful ten is public, but must not enter the private cut preview.
  await fixture.send({ version: 22, otherCutter: true, complete: true, success: true,
    cards: ['hearts-A', 'leaves-10'] });
  await expect(preview).toBeHidden();
  await expectCards(preview, []);

  await fixture.send({ round: 2, version: 30 });
  await fixture.send({ round: 2, version: 31, cards: ['hearts-A'] });
  await fixture.send({ round: 2, version: 32, cards: ['hearts-A', 'bells-K'], complete: true });
  await expect(preview).toBeVisible();
  await page.reload();
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('#hausdeppCutPreview')).toBeHidden();
  expect(await page.locator('#hausdeppTools').evaluate(element => element.open)).toBe(false);
  expect(await page.locator('#hausdeppPeek').evaluate(element => element.open)).toBe(false);
  await expectCards(page.locator('#hausdeppPeekCards'), ['hearts-A', 'bells-K']);
});


test('a reduced-motion successful cut shows both public faces briefly to another player', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const fixture = await rendererFixture(page, { initial: { otherCutter: true } });
  await pauseClock(page);
  await fixture.send({ version: 21, otherCutter: true });
  await fixture.send({ version: 22, otherCutter: true, complete: true, success: true,
    cards: ['hearts-A', 'leaves-10'] });
  const faces = page.locator('.hd-deal-card[data-motion-type="peek-reveal"]');
  await expect(faces).toHaveCount(2);
  await expect(faces.locator('svg.hd-card-art')).toHaveCount(2);
  await expect(page.locator('.hd-peek-caption')).toContainText('Ass · 10');
  const bounds = await faces.evaluateAll(nodes => nodes.map(node => {
    const rect = node.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  expect(bounds[0].left).toBeGreaterThanOrEqual(0);
  expect(bounds[0].right).toBeLessThan(bounds[1].left);
  expect(bounds[1].right).toBeLessThanOrEqual(390);
  expect(bounds.every(rect => rect.top >= 0 && rect.bottom <= 844)).toBe(true);
  await page.clock.runFor(1300);
  await expect(faces.first()).toBeVisible();
  await page.clock.runFor(901);
  await expect(faces).toHaveCount(0);
  await expect(page.locator('#hausdeppCutPreview')).toBeHidden();
});
