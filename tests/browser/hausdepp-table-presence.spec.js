const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  ['narrow-phone', 320, 568], ['compact-phone', 360, 740], ['phone', 390, 844], ['large-phone', 430, 932],
  ['compact-landscape', 568, 320], ['medium-landscape', 740, 360], ['phone-landscape', 844, 390],
  ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768], ['desktop', 1440, 900],
];

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Presence tests must use the isolated Playwright server').not.toBe('8000');
});

async function owner(page, language = 'de') {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const user = (await response.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.presenceOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // These scenarios verify gameplay/layout independently of the beginner offer.
  // Full offer, dismissal and tour hit tests remain in game-tours.spec.js.
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
  return { user, headers };
}

for (const language of ['de', 'en']) {
  test(`${language}: enlarged mobile piles leave refill and waiting captions clear`, async ({ page }) => {
    const fixture = await labelledTable(page, { language });
    let version = fixture.board._hausdepp.version;
    for (const [name, width, height] of VIEWPORTS.filter(([, width]) => width <= 844)) {
      await page.setViewportSize({ width, height });
      for (const mode of ['normal', 'refill', 'waiting']) {
        const board = structuredClone(fixture.board);
        const state = board._hausdepp;
        state.version = ++version;
        if (mode === 'refill') Object.assign(state, {
          hand: ['hearts-6', 'bells-U'], draw_required: true, draw_urgent: true,
          available_actions: ['draw'], playable_cards: [],
          pending_refill: { player_id: fixture.self, remaining: 1, rank: '10', continuation: 'replay' },
        });
        if (mode === 'waiting') {
          state.players.find(player => player.id === fixture.remote).name = 'Franziska-Maria';
          Object.assign(state, { stock_blocked_by: fixture.remote, available_actions: ['play', 'pickup'] });
        }
        fixture.send({ scoreboard: board });
        await expect(page.locator('#hausdeppStockAction')).toHaveText(mode === 'waiting'
          ? `${language === 'de' ? 'Warte auf' : 'Waiting for'} Franziska-Maria`
          : mode === 'refill' ? language === 'de' ? 'Auf drei auffüllen' : 'Refill to three'
            : language === 'de' ? 'Zocken' : 'Take a chance');
        const collisions = await page.evaluate(() => {
          const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1
            && a.top < b.bottom - 1 && a.bottom > b.top + 1;
          const pileRects = [...document.querySelectorAll('#hausdeppStock, #hausdeppPile, #hausdeppPile .hausdepp-card')]
            .map(node => node.getBoundingClientRect());
          const seatRects = [...document.querySelectorAll('.hd-seat, .hd-seat .hd-opponent-card')]
            .map(node => node.getBoundingClientRect());
          const textRects = selector => [...document.querySelectorAll(selector)].flatMap(node => {
            if (!node.getClientRects().length) return [];
            const range = document.createRange();
            range.selectNodeContents(node);
            return [...range.getClientRects()];
          });
          // Only painted text counts: the screen-reader words are clipped away.
          const burned = [...document.querySelectorAll('.hd-burned [id="hausdeppBurnedCount"], .hd-burned > span:not(.hd-sr)')]
            .flatMap(node => [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()))
            .flatMap(text => { const range = document.createRange(); range.selectNodeContents(text); return [...range.getClientRects()]; });
          const captions = textRects('#hausdeppStockAction, #hausdeppStockCount, #hausdeppPileCount, #hausdeppDrawAlert, #hausdeppStatus, #hausdeppEvent');
          return { cards: seatRects.some(seat => pileRects.some(pile => intersects(seat, pile))),
            captions: burned.some(counter => captions.some(caption => intersects(counter, caption))) };
        });
        expect(collisions, `${language} ${name} ${mode}: cards and captions remain separate`).toEqual({ cards: false, captions: false });
        await expectNoHorizontalOverflow(page, `${language} ${name} ${mode}`);
      }
    }
    // The due refill is tapped automatically; nothing else may be sent.
    expect(fixture.commands.filter(command => command.action !== 'hausdepp_draw')).toEqual([]);
  });
}

test.afterEach(async ({ page }) => {
  const saved = page.presenceOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', {
    headers: saved.headers, data: { preferred_language: saved.language },
  });
});

async function labelledTable(page, { count = 6, language = 'de', viewport = { width: 390, height: 844 } } = {}) {
  await page.setViewportSize(viewport);
  const { user, headers } = await owner(page, language);
  const created = await page.request.post('/api/games', {
    headers,
    data: { name: 'Renderer-Test · Präsenz am Tisch', mode: String(count), game_type: 'hausdepp',
      play_mode: 'cpu', cpu_count: count - 1 },
  });
  expect(created.ok()).toBeTruthy();
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  let actual;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) actual = message.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
  const board = structuredClone(actual);
  const self = board._hausdepp.viewer_id;
  const remote = board._hausdepp.players.find(player => player.id !== self).id;
  // Labelled display-only scenario based on a real private game's projection.
  // No identity, card, achievement or permission is written to the server.
  board._name = 'Renderer-Test · Drei Karten pro Hand';
  board._paused = false; board._finished = false; board._aborted = false;
  board._hausdepp_tournament = null;
  Object.assign(board._hausdepp, {
    phase: 'playing', hand: ['hearts-6', 'bells-U', 'acorns-10'], discard: ['leaves-6'], deck_count: 14,
    burned_count: 0, current_player_id: self, available_actions: ['play', 'pickup', 'gamble'],
    playable_cards: ['hearts-6', 'bells-U', 'acorns-10'], afterthrow: null, pending_refill: null,
    pending_refills: [], draw_required: false, draw_urgent: false, stock_blocked_by: null,
    private_peek: [], peek: { player_id: self, success: false, complete: true }, deal: null,
    last_event: { type: 'round_started' }, finished_order: [], loser_id: null,
  });
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player, hand_count: 3, finished: false,
    ...(player.id === remote ? { name: 'Franziska', is_cpu: false } : {}) }));
  board._participants = board._participants.map(player => ({ ...player, hand_count: 3, finished: false,
    ...(player.id === remote ? { name: 'Franziska', is_cpu: false, participant_type: 'human' } : {}) }));
  board._players.push({ id: remote, name: 'Franziska', user_id: 73, connected: true });
  const avatar = await page.request.get(`/api/avatars/${user.id}`);
  expect(avatar.ok()).toBeTruthy();
  // The remote public-account mapping is a renderer fixture. Its avatar bytes
  // are the real account avatar response, requested through the normal URL.
  const avatarBytes = await avatar.body();
  await page.route('**/api/avatars/73', route => route.fulfill({
    body: avatarBytes, contentType: avatar.headers()['content-type'],
  }));
  let activeSocket;
  const commands = [];
  await page.routeWebSocket(new RegExp(`/ws/${room.split('/').pop()}$`), socket => {
    activeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (['join_game', 'spectate_game'].includes(message.action)) {
        socket.send(JSON.stringify({ player_id: self, scoreboard: board }));
      } else commands.push(message);
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('.hd-seat')).toHaveCount(count - 1);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  return { board, self, remote, user, commands,
    send: payload => activeSocket.send(JSON.stringify(payload)) };
}

async function expectNoHorizontalOverflow(page, context) {
  const overflow = await page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - innerWidth;
    const nodes = extra > 1 ? [...document.querySelectorAll('body *')].flatMap(node => {
      const rect = node.getBoundingClientRect();
      return rect.width && rect.right > innerWidth + 1 ? [{ tag: node.tagName, id: node.id,
        class: String(node.className).slice(0, 90), left: rect.left, right: rect.right, width: rect.width }] : [];
    }).slice(-12) : [];
    return { extra, nodes };
  });
  expect(overflow.extra, `${context}: ${JSON.stringify(overflow.nodes)}`).toBeLessThanOrEqual(1);
}

async function expectFixedGameWindow(page, context) {
  const viewport = page.viewportSize();
  if (viewport.width > 1099) return;
  const layout = await page.evaluate(() => {
    const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const selectors = ['#hausdeppStock', '#hausdeppPile', '#hausdeppStatus', '.hd-hand-region', '#chatToggle', '#hausdeppTools > summary', '.hd-reactions'];
    return { pageHeight: document.documentElement.scrollHeight, pageWidth: document.documentElement.scrollWidth,
      scrollX, scrollY, controls: selectors.map(selector => ({ selector, ...rect(document.querySelector(selector)) })) };
  });
  expect(layout.pageHeight, `${context}: the document does not scroll vertically`).toBeLessThanOrEqual(viewport.height + 1);
  expect(layout.pageWidth, `${context}: the document does not scroll horizontally`).toBeLessThanOrEqual(viewport.width + 1);
  expect(layout.scrollX).toBe(0);
  expect(layout.scrollY).toBe(0);
  for (const control of layout.controls) {
    expect(control.left, `${context}: ${control.selector} left`).toBeGreaterThanOrEqual(-1);
    expect(control.right, `${context}: ${control.selector} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(control.top, `${context}: ${control.selector} top`).toBeGreaterThanOrEqual(-1);
    expect(control.bottom, `${context}: ${control.selector} bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }
}

for (const language of ['de', 'en']) {
  test(`${language}: the fixed table keeps a large hand internal and opens reachable help and chat sheets`, async ({ page }) => {
    test.setTimeout(60000);
    const fixture = await labelledTable(page, { language });
    const hand = ['hearts', 'bells', 'leaves', 'acorns'].flatMap(suit => ['6', '7', '8', '9', 'U', 'O', 'K', 'A', '10'].map(rank => `${suit}-${rank}`)).filter(card => card !== 'acorns-10');
    const board = structuredClone(fixture.board);
    Object.assign(board._hausdepp, { version: board._hausdepp.version + 1, hand, deck_count: 0,
      discard: [], playable_cards: hand, available_actions: ['play'], finished_order: board._hausdepp.players.filter(player => ![fixture.self, fixture.remote].includes(player.id)).map(player => player.id) });
    board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player,
      hand_count: player.id === fixture.self ? 35 : player.id === fixture.remote ? 1 : 0,
      finished: ![fixture.self, fixture.remote].includes(player.id) }));
    fixture.send({ scoreboard: board });
    await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(35);
    for (const [name, width, height] of VIEWPORTS.filter(([, width]) => width <= 1099)) {
      await page.setViewportSize({ width, height });
      const fan = page.locator('#hausdeppHand');
      expect(await fan.evaluate(element => element.scrollWidth > element.clientWidth), `${name}: the large fan scrolls internally`).toBe(true);
      await fan.evaluate(element => { element.scrollLeft = 0; });
      await page.locator('#hausdeppHand button').first().click({ trial: true, position: { x: 16, y: 32 }, timeout: 5000 });
      await fan.evaluate(element => { element.scrollLeft = element.scrollWidth; });
      await page.locator('#hausdeppHand button').last().click({ trial: true, timeout: 5000 });
      await expectFixedGameWindow(page, `${language} ${name} large hand`);
      await page.locator('#hausdeppTools > summary').click();
      await expect(page.locator('.hd-game-help')).toBeVisible();
      await expect(page.locator('.hd-game-help a[href="/hausdepp/regeln"]')).toBeVisible();
      await page.locator('.hd-tools-close').click();
      await expect(page.locator('#hausdeppTools')).not.toHaveAttribute('open', '');
      await page.locator('#chatToggle').click();
      await expect(page.locator('#chatInput')).toBeVisible();
      expect(await page.locator('#chatInput').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
      await page.locator('#chatClose').click();
      await expect(page.locator('#chatInput')).toBeHidden();
      await expectFixedGameWindow(page, `${language} ${name} closed sheets`);
    }
    expect(fixture.commands).toEqual([]);
  });
}

test('the fixed table keeps chat above the keyboard and recovers its full window after rotation', async ({ page }) => {
  await labelledTable(page);
  await page.locator('#chatToggle').click();
  await page.locator('#chatInput').focus();
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 380 });
    Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 24 });
    visualViewport.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--game-viewport-height'))).toBe('380px');
  const input = await page.locator('#chatInput').boundingBox();
  expect(input.y).toBeGreaterThanOrEqual(24);
  expect(input.y + input.height).toBeLessThanOrEqual(405);
  await page.evaluate(() => {
    delete visualViewport.height;
    delete visualViewport.offsetTop;
    visualViewport.dispatchEvent(new Event('resize'));
    visualViewport.dispatchEvent(new Event('scroll'));
  });
  await page.locator('#chatClose').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--game-viewport-height'))).toBe('');
  for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expectFixedGameWindow(page, `${viewport.width}×${viewport.height} after keyboard/rotation`);
  }
});

for (const browserName of ['chromium', 'webkit']) {
  const rotationTest = test.extend({ browser: [async ({ playwright }, use) => {
    const browser = await playwright[browserName].launch();
    try { await use(browser); } finally { await browser.close(); }
  }, { scope: 'worker' }] });
  rotationTest.describe(`Hausdepp ${browserName} mobile rotation hit targets`, () => {
    rotationTest.use({ hasTouch: true, isMobile: true, deviceScaleFactor: 3,
      viewport: { width: 440, height: 956 }, reducedMotion: 'reduce' });

    rotationTest('iPhone portrait return plays the card tapped at its painted position', async ({ page }) => {
      const portrait = { width: 440, height: 956 };
      const fixture = await labelledTable(page, { viewport: portrait });
      for (let turn = 0; turn < 3; turn += 1) {
        for (const viewport of [{ width: 956, height: 440 }, portrait]) {
          await page.setViewportSize(viewport);
          await page.evaluate(() => {
            window.dispatchEvent(new Event('orientationchange'));
            screen.orientation?.dispatchEvent(new Event('change'));
          });
          await expect.poll(() => page.locator('#hausdeppHand').evaluate(element => {
            const rect = element.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight + 1;
          })).toBe(true);
          await expectFixedGameWindow(page, `${browserName} ${viewport.width}×${viewport.height} rotation ${turn + 1}`);
        }
      }
      // Safari's compatibility mouse click may follow a touch pointer with a
      // different ID. Two native touch pointers must still never share a tap.
      await page.locator('#hausdeppHand [data-card-id="bells-U"]').evaluate(button => {
        for (const [type, pointerId] of [['pointerdown', 7], ['pointerup', 7], ['click', 8]]) {
          button.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', pointerId,
            button: 0, detail: type === 'click' ? 1 : 0 }));
        }
      });
      const card = page.locator('#hausdeppHand [data-card-id="hearts-6"]');
      await expect(card).toBeEnabled();
      const box = await card.boundingBox();
      expect(box).not.toBeNull();
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect.poll(() => fixture.commands.filter(command => command.action === 'hausdepp_play'))
        .toEqual([expect.objectContaining({ action: 'hausdepp_play', cards: ['hearts-6'], version: fixture.board._hausdepp.version })]);
    });
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: navigation buttons keep real destinations and opaque touch surfaces`, async ({ page }) => {
    test.setTimeout(60000);
    await owner(page, language);
    for (const [name, width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      for (const path of ['/hausdepp', '/hausdepp/konto', '/hausdepp/regeln', '/hausdepp/rangliste']) {
        await page.goto(path);
        await expect(page.locator('.hd-nav a')).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);
        const controls = await page.locator('.hd-nav a').evaluateAll(elements => elements.map(element => {
          const css = getComputedStyle(element);
          const rgba = css.backgroundColor.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/);
          return { tag: element.tagName, href: element.getAttribute('href'), height: element.getBoundingClientRect().height,
            background: css.backgroundColor, alpha: rgba ? Number(rgba[1]) : css.backgroundColor === 'transparent' ? 0 : 1,
            border: parseFloat(css.borderTopWidth) };
        }));
        expect(controls.map(control => control.href)).toEqual(['/hausdepp', '/hausdepp/rangliste', '/hausdepp/regeln', '/hausdepp/konto']);
        for (const control of controls) {
          expect(control.tag).toBe('A');
          expect(control.height, `${language} ${name} ${path} ${control.href}`).toBeGreaterThanOrEqual(44);
          expect(control.border).toBeGreaterThanOrEqual(1);
          expect(control.alpha, `${control.href}: ${control.background}`).toBe(1);
        }
        await expect(page.locator(`.hd-nav a[href="${path}"]`)).toHaveAttribute('aria-current', 'page');
        if (path === '/hausdepp/konto') {
          const shortcuts = await page.locator('.hd-account-shortcuts a').evaluateAll(elements => elements.map(element => {
            const rect = element.getBoundingClientRect();
            return { href: element.getAttribute('href'), top: Math.round(rect.top), width: rect.width, height: rect.height,
              textFits: element.scrollWidth <= element.clientWidth + 1 };
          }));
          expect(shortcuts.map(link => link.href)).toEqual(['#fortschritt', '#erfolge', '#runden', '/hausdepp/rangliste']);
          const rows = Object.values(shortcuts.reduce((result, link) => {
            result[link.top] = (result[link.top] || 0) + 1;
            return result;
          }, {}));
          expect(rows, `${language} ${name}: account shortcuts form balanced rows`).toEqual(width <= 900 ? [2, 2] : [4]);
          expect(Math.max(...shortcuts.map(link => link.width)) - Math.min(...shortcuts.map(link => link.width))).toBeLessThanOrEqual(1);
          expect(Math.max(...shortcuts.map(link => link.height)) - Math.min(...shortcuts.map(link => link.height))).toBeLessThanOrEqual(1);
          for (const link of shortcuts) {
            expect(link.height).toBeGreaterThanOrEqual(44);
            expect(link.textFits, `${link.href} fits its touch surface`).toBe(true);
          }
        }
        await expectNoHorizontalOverflow(page, `${language} ${name} ${path}`);
      }
    }
    await page.locator('.hd-nav a[href="/hausdepp"]').click();
    await expect(page).toHaveURL(/\/hausdepp$/);
  });

  test(`${language}: own and remote account avatars retain decoded nodes across accepted actions`, async ({ page }) => {
    const fixture = await labelledTable(page, { language });
    const selectors = ['.hd-profile-button img', '.hd-own-identity img',
      `.hd-seat[data-player-id="${fixture.remote}"] img`];
    for (const [index, selector] of selectors.entries()) {
      const image = page.locator(selector);
      await expect(image).toHaveAttribute('src', `/api/avatars/${index === 2 ? 73 : fixture.user.id}`);
      await expect.poll(() => image.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
    }
    await page.evaluate(values => { window.__presenceAvatarNodes = values.map(selector => document.querySelector(selector)); }, selectors);
    for (const cpu of fixture.board._hausdepp.players.filter(player => player.is_cpu)) {
      const seat = page.locator(`.hd-seat[data-player-id="${cpu.id}"]`);
      expect(cpu.name).not.toMatch(/^CPU\s*\d+$/i);
      await expect(seat.locator('strong')).toHaveText(cpu.name);
      await expect(seat.locator('.hd-seat-avatar svg')).toHaveCount(1);
      await expect(seat.locator('.hd-seat-avatar img')).toHaveCount(0);
    }
    await page.locator('#hausdeppHand [data-card-id="hearts-6"]').click();
    await expect.poll(() => fixture.commands.some(command => command.action === 'hausdepp_play')).toBe(true);
    const command = fixture.commands.find(command => command.action === 'hausdepp_play');
    const next = structuredClone(fixture.board);
    next._hausdepp.version += 1;
    next._hausdepp.hand = ['bells-U', 'acorns-10'];
    next._hausdepp.discard.push('hearts-6');
    next._hausdepp.available_actions = ['draw'];
    next._hausdepp.playable_cards = [];
    next._hausdepp.current_player_id = fixture.remote;
    next._hausdepp.draw_required = true;
    next._hausdepp.draw_urgent = true;
    next._hausdepp.pending_refill = { player_id: fixture.self, remaining: 1, rank: '6', continuation: 'advance' };
    next._hausdepp.pending_refills = [next._hausdepp.pending_refill];
    next._hausdepp.last_event = { type: 'play', player_id: fixture.self, cards: ['hearts-6'] };
    fixture.send({ scoreboard: next, hausdepp_command: { command_id: command.command_id, accepted: true, version: next._hausdepp.version } });
    await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(2);
    expect(await page.evaluate(values => values.every((selector, index) => window.__presenceAvatarNodes[index]
      === document.querySelector(selector)), selectors)).toBe(true);
    for (const selector of selectors) expect(await page.locator(selector).evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  });
}

for (const reducedMotion of [false, true]) {
  test(`confirmed own and remote reactions survive snapshots for three seconds (${reducedMotion ? 'reduced motion' : 'normal motion'})`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    // Keep both avatar anchors and the reaction toolbar in view. Phone-sized
    // table geometry is covered separately; scrolling an avatar offscreen
    // should move its correctly anchored reaction offscreen as well.
    const fixture = await labelledTable(page, { viewport: { width: 1440, height: 1200 } });
    await page.clock.install({ time: new Date('2026-10-16T12:00:00Z') });
    await page.clock.pauseAt(new Date('2026-10-16T12:00:01Z'));
    await page.locator('[data-hausdepp-reaction="👍"]').click();
    await expect.poll(() => fixture.commands.some(command => command.action === 'send_emoji')).toBe(true);
    await expect(page.locator('.hd-seat-reaction')).toHaveCount(0);
    const own = { from_id: fixture.self, from: fixture.user.username, user_id: fixture.user.id, emoji: '👍', ts: '2026-10-16T12:00:00Z' };
    const remote = { from_id: fixture.remote, from: 'Franziska', user_id: 73, emoji: '🎉', ts: '2026-10-16T12:00:00Z' };
    fixture.send({ emoji: own });
    fixture.send({ emoji: remote });
    const bubbles = page.locator('#hausdeppReactionLayer .hd-seat-reaction');
    await expect(bubbles).toHaveCount(2);
    await expect(page.locator(`[data-reaction-sender="${fixture.self}"]`)).toContainText('👍');
    await expect(page.locator(`[data-reaction-sender="${fixture.remote}"]`)).toContainText('Franziska');
    await page.clock.fastForward(2000);
    fixture.send({ scoreboard: fixture.board });
    fixture.send({ emoji: own });
    fixture.send({ emoji: remote });
    await expect(bubbles).toHaveCount(2);
    const geometry = await bubbles.evaluateAll((nodes, self) => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      const anchor = node.dataset.reactionSender === self ? document.querySelector('.hd-own-identity')
        : document.querySelector(`.hd-seat[data-player-id="${node.dataset.reactionSender}"] .hd-seat-avatar`);
      const anchorRect = anchor.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        anchorTop: anchorRect.top, anchorCentre: anchorRect.left + anchorRect.width / 2,
        pointerEvents: getComputedStyle(node).pointerEvents, animation: getComputedStyle(node).animationName };
    }), fixture.self);
    for (const rect of geometry) {
      expect(rect.left).toBeGreaterThanOrEqual(-1);
      expect(rect.right).toBeLessThanOrEqual(page.viewportSize().width + 1);
      expect(rect.top).toBeGreaterThanOrEqual(-1);
      expect(rect.bottom, 'Reaction sits above its sender').toBeLessThanOrEqual(rect.anchorTop + 1);
      expect(Math.abs((rect.left + rect.right) / 2 - rect.anchorCentre), 'Reaction follows its sender horizontally').toBeLessThan(50);
      expect(rect.pointerEvents).toBe('none');
      if (reducedMotion) expect(rect.animation).toBe('none');
    }
    await page.clock.fastForward(999);
    await expect(bubbles).toHaveCount(2);
    await page.clock.fastForward(2);
    await expect(bubbles).toHaveCount(0);
    // Repeating an already seen server event cannot restart its lifetime.
    fixture.send({ emoji: own });
    await expect(bubbles).toHaveCount(0);
  });
}

for (const count of [3, 5, 6]) {
  for (const [name, width, height] of VIEWPORTS) {
    test(`semicircle geometry keeps ${count} seats clear of piles and the hand at ${name}`, async ({ page }) => {
      await labelledTable(page, { count, viewport: { width, height } });
      const geometry = await page.evaluate(() => {
        const rect = element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right,
          top: r.top, bottom: r.bottom, width: r.width, height: r.height,
          cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
        return { seats: [...document.querySelectorAll('.hd-seat')].map(rect),
          seatCards: [...document.querySelectorAll('.hd-seat .hd-opponent-card')].map(rect),
          pileArt: [...document.querySelectorAll('.hd-pile .hausdepp-card')].map(rect),
          hand: [...document.querySelectorAll('#hausdeppHand [data-card-id]')].map(rect),
          controls: [document.getElementById('hausdeppStock'), document.getElementById('hausdeppPile')].map(rect) };
      });
      const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
      const minimumWidth = width <= 359 ? 84 : width <= 380 && height > width ? 94 : width <= 700 && height < width ? 76
        : width <= 1099 && height < width && height <= 600 ? 96 : 100;
      for (const control of geometry.controls) {
        expect(control.width, `${name}: central card piles have prominent touch surfaces`).toBeGreaterThanOrEqual(minimumWidth);
        expect(control.height / control.width, `${name}: card proportions remain natural`).toBeCloseTo(57 / 36, 1);
        for (const card of geometry.hand) expect(intersects(control, card), 'Central piles leave the own hand free').toBe(false);
      }
      expect(geometry.controls[0].width).toBeCloseTo(geometry.controls[1].width, 1);
      for (const card of geometry.seatCards) {
        for (const pile of [...geometry.controls, ...geometry.pileArt]) {
          expect(intersects(card, pile), 'Opponent card backs leave the central cards clear').toBe(false);
        }
      }
      for (let index = 0; index < geometry.seats.length; index += 1) {
        const seat = geometry.seats[index];
        expect(seat.left).toBeGreaterThanOrEqual(-1);
        expect(seat.right).toBeLessThanOrEqual(width + 1);
        for (const other of geometry.seats.slice(index + 1)) expect(intersects(seat, other), 'Distinct players remain readable').toBe(false);
        for (const card of geometry.hand) expect(intersects(seat, card), 'Seats keep the own hand free').toBe(false);
        for (const control of geometry.controls) expect(intersects(seat, control),
          `Seats keep the stock and pile free: ${JSON.stringify({ seat, control })}`).toBe(false);
      }
      if (count >= 5) {
        const ordered = [...geometry.seats].sort((a, b) => a.cx - b.cx);
        const middle = ordered[Math.floor(ordered.length / 2)];
        expect(ordered[0].cy - middle.cy, 'Left seat follows the table arc').toBeGreaterThan(8);
        expect(ordered.at(-1).cy - middle.cy, 'Right seat follows the table arc').toBeGreaterThan(8);
      }
      const pileCentre = geometry.controls.reduce((sum, control) => sum + control.cx, 0) / geometry.controls.length;
      expect(Math.min(...geometry.seats.map(seat => seat.cx)), 'The table has a player on its left').toBeLessThan(pileCentre);
      expect(Math.max(...geometry.seats.map(seat => seat.cx)), 'The table has a player on its right').toBeGreaterThan(pileCentre);
      await expectNoHorizontalOverflow(page, `${count} seats ${name}`);
      await expectFixedGameWindow(page, `${count} seats ${name}`);
      await expect(page.locator('#hausdeppHand button:enabled')).toHaveCount(3);
      await expect(page.locator('.hd-seat [data-card-count="3"]')).toHaveCount(count - 1);
      for (const selector of ['#hausdeppStock', '#hausdeppPile']) {
        const control = page.locator(selector);
        await control.scrollIntoViewIfNeeded();
        expect(await control.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return hit === element || element.contains(hit);
        }), `${selector} remains directly tappable`).toBe(true);
      }
      for (const card of await page.locator('#hausdeppHand button:enabled').all()) {
        await card.click({ trial: true });
      }
      if (count === 6 && process.env.HAUSDEPP_CENTRE_SCREENSHOTS === '1') {
        await page.locator('.hd-centre').scrollIntoViewIfNeeded();
        await page.screenshot({ path: test.info().outputPath(`centre-${name}.png`), fullPage: true });
      }
    });
  }
}
