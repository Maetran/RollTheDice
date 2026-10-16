const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [
  ['narrow-phone', 320, 568], ['phone', 390, 844], ['phone-landscape', 844, 390],
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
  return { user, headers };
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
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), context).toBeLessThanOrEqual(1);
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
          top: r.top, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }; };
        return { seats: [...document.querySelectorAll('.hd-seat')].map(rect),
          hand: [...document.querySelectorAll('#hausdeppHand [data-card-id]')].map(rect),
          controls: [document.getElementById('hausdeppStock'), document.getElementById('hausdeppPile')].map(rect) };
      });
      const intersects = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
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
    });
  }
}
