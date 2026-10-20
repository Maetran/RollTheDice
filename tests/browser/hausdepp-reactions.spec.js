const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
const DEFAULTS = ['👍', '😂', '😮', '💩'];
const VIEWPORTS = [
  ['narrow-phone', 320, 568], ['phone', 390, 844], ['low-landscape', 568, 320],
  ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768], ['desktop', 1440, 900],
];

test.beforeAll(({ baseURL }) => {
  expect(new URL(baseURL).port, 'Reaction tests require the disposable browser server').not.toBe('8000');
});

test.afterEach(async ({ page }) => {
  if (page.reactionOwner) await page.request.put('/api/auth/preferences/language', {
    headers: page.reactionOwner.headers, data: { preferred_language: page.reactionOwner.language },
  });
});

async function playingRoom(page, { viewport = { width: 390, height: 844 } } = {}) {
  await page.setViewportSize(viewport);
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user, headers = { 'X-CSRF-Token': user.csrf_token };
  page.reactionOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: 'de' } });
  await page.addInitScript(() => localStorage.setItem('zdwa_language', 'de'));
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: {
    show: false, enabled: true, games: { zdwa: 'unseen', zilch: 'unseen', hausdepp: 'dismissed' },
  } }));
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Reaktions-Test · Sechs Plätze', mode: '6', game_type: 'hausdepp',
      play_mode: 'cpu', cpu_count: 5 },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).game_id, room = `/hausdepp/spiel/${id}`;
  let actual;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) actual = message.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
  // A labelled display fixture starts with the account's real private projection;
  // the synthetic playing opportunity never changes server state or awards.
  const board = structuredClone(actual), self = board._hausdepp.viewer_id;
  const remote = board._hausdepp.players.find(player => player.id !== self).id;
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
  board._hausdepp.players = board._hausdepp.players.map(player => ({ ...player, hand_count: 3, finished: false }));
  board._participants = board._participants.map(player => ({ ...player, hand_count: 3, finished: false }));
  let activeSocket;
  const commands = [];
  await page.routeWebSocket(new RegExp(`/ws/${id}$`), socket => {
    activeSocket = socket;
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (handleDisabledHausdeppVoice(socket, message)) return;
      if (['join_game', 'spectate_game'].includes(message.action)) socket.send(JSON.stringify({ player_id: self, scoreboard: board }));
      else commands.push(message);
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', 'playing');
  await expect(page.locator('[data-reaction-quick]')).toHaveCount(4);
  await expect(page.locator('[data-reaction-quick]').first()).toBeEnabled();
  await page.evaluate(() => document.fonts.ready);
  return { user, self, remote, board, commands, room,
    storageKey: `hausdepp:reactions:v1:${user.id}`,
    send: payload => activeSocket.send(JSON.stringify(payload)),
    disconnect: () => activeSocket.close({ code: 1008, reason: 'Labelled offline reaction test' }),
  };
}

async function assertDockGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#chatToggle, .hd-reactions > button, #hausdeppTools > summary, #hausdeppMultiToggle, #hausdeppMultiPlay')]
      .filter(node => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden')
      .map(node => { const rect = node.getBoundingClientRect(); return { id: node.id || node.dataset.hausdeppReaction || node.className,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; });
    const overlaps = [];
    for (let a = 0; a < buttons.length; a++) for (let b = a + 1; b < buttons.length; b++) {
      const x = buttons[a], y = buttons[b];
      if (Math.min(x.right, y.right) - Math.max(x.left, y.left) > 1
          && Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 1) overlaps.push([x.id, y.id]);
    }
    return { buttons, overlaps, width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
  });
  const viewport = page.viewportSize();
  expect(geometry.overlaps, `${label}: full-size dock controls must remain separate`).toEqual([]);
  expect(geometry.width, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(viewport.width + 1);
  if (viewport.width <= 1099) expect(geometry.height, `${label}: fixed table stays inside viewport`).toBeLessThanOrEqual(viewport.height + 1);
  for (const button of geometry.buttons) {
    expect(button.width, `${label}: ${button.id} width`).toBeGreaterThanOrEqual(44);
    expect(button.height, `${label}: ${button.id} height`).toBeGreaterThanOrEqual(44);
    expect(button.left, `${label}: ${button.id} left`).toBeGreaterThanOrEqual(-1);
    expect(button.right, `${label}: ${button.id} right`).toBeLessThanOrEqual(viewport.width + 1);
    expect(button.top, `${label}: ${button.id} top`).toBeGreaterThanOrEqual(-1);
    expect(button.bottom, `${label}: ${button.id} bottom`).toBeLessThanOrEqual(viewport.height + 1);
  }
}

for (const [name, width, height] of VIEWPORTS) {
  test(`four quick reactions, picker and selection dock stay reachable at ${name}`, async ({ page }) => {
    await playingRoom(page, { viewport: { width, height } });
    await expect(page.locator('[data-reaction-quick]')).toHaveText(DEFAULTS);
    await assertDockGeometry(page, `${name} quick dock`);
    const toggle = page.locator('.hd-reaction-toggle'), picker = page.locator('.hd-reaction-picker');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    if (process.env.HAUSDEPP_CAPTURE_DIR && width === 320) {
      await page.screenshot({ path: `${process.env.HAUSDEPP_CAPTURE_DIR}/mobile-reactions-dock.png`, fullPage: true });
    }
    await toggle.click();
    await expect(picker).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(picker.locator('[data-reaction-choice]')).toHaveCount(12);
    const buttons = await picker.locator('button').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom,
        left: rect.left, top: rect.top, label: node.getAttribute('aria-label') || node.textContent };
    }));
    for (const button of buttons) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
      expect(button.left).toBeGreaterThanOrEqual(0);
      expect(button.top).toBeGreaterThanOrEqual(0);
      expect(button.right).toBeLessThanOrEqual(width);
      expect(button.bottom).toBeLessThanOrEqual(height);
      expect(button.label).toBeTruthy();
    }
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    await expect(toggle).toBeFocused();
    await page.locator('#hausdeppMultiToggle').click();
    await expect(page.locator('#hausdeppMultiToggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#hausdeppMultiPlay')).toBeVisible();
    if (width <= 1099) await expect(page.locator('.hd-reactions')).toBeHidden();
    await assertDockGeometry(page, `${name} selection dock`);
    await page.locator('#hausdeppMultiToggle').click();
    await expect(page.locator('.hd-reactions')).toBeVisible();
    await expect(page.locator('[data-reaction-quick]')).toHaveText(DEFAULTS);
  });
}

test('only confirmed own reactions affect future quick buttons, with stable positions during this room', async ({ page }) => {
  const fixture = await playingRoom(page);
  const saved = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)), fixture.storageKey);
  const pick = async emoji => {
    await page.locator('.hd-reaction-toggle').click();
    await page.locator(`[data-reaction-choice="${emoji}"]`).click();
    await expect(page.locator('.hd-reaction-picker')).toBeHidden();
  };
  await pick('🔥');
  expect(await saved()).toBeNull();
  fixture.send({ emoji: { from_id: fixture.remote, user_id: 999, from: 'Mitspieler', emoji: '🔥', ts: '2026-10-18T12:00:00Z' } });
  await expect(page.locator(`[data-reaction-sender="${fixture.remote}"]`)).toBeVisible();
  expect(await saved()).toBeNull();
  const own = { from_id: fixture.self, user_id: fixture.user.id, from: fixture.user.username, emoji: '🔥', ts: '2026-10-18T12:00:01Z' };
  fixture.send({ emoji: own });
  await expect.poll(async () => (await saved())?.counts?.['🔥']).toBe(1);
  fixture.send({ emoji: own });
  fixture.send({ scoreboard: fixture.board });
  await expect(page.locator('[data-reaction-quick]')).toHaveText(DEFAULTS);
  expect((await saved()).counts['🔥']).toBe(1);
  await pick('🎉');
  fixture.send({ error: 'Bitte kurz warten' });
  expect((await saved()).counts['🎉'] || 0).toBe(0);
  await page.reload();
  await expect(page.locator('[data-reaction-quick]')).toHaveText(['🔥', '👍', '😂', '😮']);
});

test('a hand tap dismisses the picker and only the next tap may play a card', async ({ page }) => {
  const fixture = await playingRoom(page);
  const card = page.locator('#hausdeppHand [data-card-id]').last();
  await page.locator('.hd-reaction-toggle').click();
  const rect = await card.boundingBox();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await expect(page.locator('.hd-reaction-picker')).toBeHidden();
  expect(fixture.commands.filter(command => command.action === 'hausdepp_play')).toEqual([]);
  await card.click();
  await expect.poll(() => fixture.commands.filter(command => command.action === 'hausdepp_play').length).toBe(1);
});

test('disconnect closes an open picker and disables all reaction sends', async ({ page }) => {
  const fixture = await playingRoom(page);
  await page.locator('.hd-reaction-toggle').click();
  fixture.disconnect();
  await expect(page.locator('.hd-reaction-picker')).toBeHidden();
  for (const button of await page.locator('.hd-reactions > button').all()) await expect(button).toBeDisabled();
  expect(fixture.commands.filter(command => command.action === 'send_emoji')).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), fixture.storageKey)).toBeNull();
});

test('corrupt reaction storage and another account preference keep the default dock usable', async ({ page }) => {
  const fixture = await playingRoom(page);
  await page.evaluate(({ key, other }) => {
    localStorage.setItem(key, 'broken local preference');
    localStorage.setItem(other, JSON.stringify({ version: 1, counts: { '🔥': 100 }, seen: [] }));
  }, { key: fixture.storageKey, other: `hausdepp:reactions:v1:${fixture.user.id + 1}` });
  await page.reload();
  await expect(page.locator('[data-reaction-quick]')).toHaveText(DEFAULTS);
  await page.locator('[data-hausdepp-reaction="👍"]').click();
  await expect.poll(() => fixture.commands.filter(command => command.action === 'send_emoji').length).toBe(1);
});
