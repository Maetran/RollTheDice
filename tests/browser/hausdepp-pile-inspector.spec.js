const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const VIEWPORTS = [[320, 568], [390, 844], [568, 320], [844, 390], [768, 1024], [1440, 900]];
const PUBLIC_CARDS = ['hearts-6', 'bells-7', 'leaves-8', 'acorns-9', 'hearts-U', 'bells-O', 'leaves-K'];

async function tableFixture(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.pileOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => {
    localStorage.setItem('zdwa_language', value);
    window.__pileMotions = [];
    window.addEventListener('hausdepp:motion', event => window.__pileMotions.push(event.detail));
  }, language);
  await page.route('**/api/releases**', route => route.fulfill({ json: { releases: [], can_prompt: false } }));
  // Isolated renderer scenarios; actual beginner offers remain in game-tours.spec.
  await page.route('**/api/auth/game-guides', route => route.fulfill({ json: { enabled: false, acknowledged: {} } }));
  await page.route('**/api/auth/tours/offer', route => route.fulfill({ json: { show: false, enabled: false, games: {} } }));
  const created = await page.request.post('/api/games', { headers, data: {
    name: 'Renderer-Test · Öffentliches Paket', mode: '6', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 5,
  } });
  expect(created.ok()).toBeTruthy();
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  let original;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) original = message.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => !!original?._hausdepp?.viewer_id).toBe(true);
  // Public, display-only projection based on a real account/table. The fixture
  // never writes its cards, rewards, or accepted actions into the real game.
  const board = structuredClone(original);
  const self = board._hausdepp.viewer_id;
  Object.assign(board, { _paused: false, _finished: false, _aborted: false, _hausdepp_tournament: null });
  Object.assign(board._hausdepp, {
    phase: 'playing', hand: ['leaves-U', 'acorns-A', 'hearts-10'], discard: [...PUBLIC_CARDS],
    deck_count: 11, burned_count: 0, current_player_id: self, available_actions: ['play', 'pickup', 'gamble'],
    playable_cards: ['hearts-10'], afterthrow: null, pending_refill: null, pending_refills: [],
    draw_required: false, draw_urgent: false, stock_blocked_by: null, private_peek: [],
    peek: { player_id: self, success: false, complete: true }, deal: null,
    last_event: { type: 'round_started' }, finished_order: [], loser_id: null,
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
  await expect(page.locator('#hausdeppPile [data-card-id]')).toHaveCount(3);
  // Desktop tables intentionally open chat. Close that real drawer before
  // resizing this interaction fixture to a phone and opening another sheet.
  if (await page.locator('#chatToggle').getAttribute('aria-expanded') === 'true') await page.locator('#chatToggle').click();
  await expect(page.locator('#chatPanel')).not.toBeVisible();
  return { board, self, commands, send: next => socket.send(JSON.stringify({ scoreboard: next })) };
}

test.afterEach(async ({ page }) => {
  if (page.pileOwner) await page.request.put('/api/auth/preferences/language', {
    headers: page.pileOwner.headers, data: { preferred_language: page.pileOwner.language },
  });
});

for (const language of ['de', 'en']) {
  test(`${language}: public packet inspection has an explicit and keyboard action, live cards, and bounded sheets`, async ({ page }) => {
    const fixture = await tableFixture(page, language);
    const dialog = page.locator('#hausdeppPileInspector');
    await expect(page.locator('#hausdeppStock .hd-stock-card')).toHaveCount(11);
    await expect(page.locator('#hausdeppStock [data-card-id], #hausdeppStock svg')).toHaveCount(0);
    await expect(page.locator('#hausdeppPile .hd-pile-edge')).toHaveCount(4);
    expect(await page.locator('#hausdeppPile [data-card-id]').evaluateAll(cards => cards.map(card => card.dataset.cardId))).toEqual(PUBLIC_CARDS.slice(-3));
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      await page.locator('#hausdeppTools > summary').click();
      const inspect = page.locator('#hausdeppInspectPile');
      await expect(inspect).toHaveText(language === 'de' ? 'Offenes Paket ansehen' : 'Inspect the open pile');
      expect((await inspect.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await inspect.click();
      await expect(dialog).toBeVisible();
      expect(await dialog.locator('[data-pile-inspector-cards] [data-card-id]').evaluateAll(cards => cards.map(card => card.dataset.cardId))).toEqual(PUBLIC_CARDS);
      await expect(dialog.locator('[data-card-id="acorns-6"]')).toHaveCount(0);
      await expect(dialog.locator('[data-card-id="leaves-U"]')).toHaveCount(0);
      await expect(dialog.locator('[data-card-id="acorns-A"]')).toHaveCount(0);
      const bounds = await dialog.boundingBox();
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1);
      if (process.env.HAUSDEPP_CENTRE_SCREENSHOTS === '1' && language === 'de' && [320, 390, 844, 1440].includes(width)) {
        await page.screenshot({ path: test.info().outputPath(`pile-inspector-${width}x${height}.png`) });
      }
      await dialog.locator('[data-pile-inspector-cards] [data-card-id]').last().scrollIntoViewIfNeeded();
      await expect(dialog.locator('[data-pile-inspector-cards] [data-card-id]').last()).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      if (width <= 1099) expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(inspect).toBeFocused();
      await page.locator('.hd-tools-close').click();
      await page.locator('#hausdeppPile').focus();
      await page.keyboard.press('Shift+Enter');
      await expect(dialog).toBeVisible();
      await dialog.locator('[data-pile-inspector-close]').click();
      await expect(page.locator('#hausdeppPile')).toBeFocused();
    }
    // Reading public cards remains available on another player's turn.
    const next = structuredClone(fixture.board);
    next._hausdepp.version += 1;
    next._hausdepp.current_player_id = next._hausdepp.players.find(player => player.id !== fixture.self).id;
    next._hausdepp.available_actions = [];
    next._hausdepp.playable_cards = [];
    fixture.send(next);
    await expect(page.locator('#hausdeppPile')).toHaveAttribute('data-pickup-available', 'false');
    await page.locator('#hausdeppPile').click({ button: 'right' });
    await expect(dialog).toBeVisible();
    next._hausdepp.version += 1;
    next._hausdepp.discard.push('acorns-K');
    next._hausdepp.deck_count = 1;
    fixture.send(next);
    await expect(dialog.locator('[data-card-id]')).toHaveCount(8);
    await expect(page.locator('#hausdeppStock .hd-stock-card')).toHaveCount(1);
    await expect(page.locator('#hausdeppPile .hd-pile-edge')).toHaveCount(5);
    expect(await dialog.locator('[data-card-id]').last().getAttribute('data-card-id')).toBe('acorns-K');
    next._hausdepp.version += 1;
    next._hausdepp.discard = [];
    next._hausdepp.deck_count = 0;
    fixture.send(next);
    await expect(dialog.locator('[data-card-id]')).toHaveCount(0);
    await expect(page.locator('#hausdeppStock .hd-stock-card')).toHaveCount(0);
    await expect(page.locator('#hausdeppPile .hd-pile-edge, #hausdeppPile [data-card-id]')).toHaveCount(0);
    await expect(dialog.locator('[data-pile-inspector-status]')).toHaveText(language === 'de' ? 'Tisch frei' : 'Table clear');
    await page.keyboard.press('Escape');
    await expect(page.locator('#hausdeppTools > summary')).toBeFocused();
    expect(fixture.commands).toEqual([]);
  });

  test(`${language}: long hold suppresses the trailing pickup while a fresh short tap takes immediately`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const fixture = await tableFixture(page, language);
    const pile = page.locator('#hausdeppPile');
    const rect = await pile.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down();
    await expect(page.locator('#hausdeppPileInspector')).toBeVisible({ timeout: 1500 });
    await page.mouse.up();
    // Browsers may deliver a compatibility click after a held touch ends.
    await pile.dispatchEvent('click', { bubbles: true, detail: 1 });
    expect(fixture.commands).toEqual([]);
    await page.keyboard.press('Escape');
    // Touch uses the same pointer boundary; model its compatibility click
    // explicitly so neither mouse nor touch can accidentally take the pile.
    await pile.dispatchEvent('pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true,
      button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 });
    await expect(page.locator('#hausdeppPileInspector')).toBeVisible({ timeout: 1500 });
    await pile.dispatchEvent('pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true });
    await pile.dispatchEvent('click', { bubbles: true, detail: 1 });
    expect(fixture.commands).toEqual([]);
    await page.keyboard.press('Escape');
    await pile.click();
    await expect.poll(() => fixture.commands.length).toBe(1);
    expect(fixture.commands[0]).toMatchObject({ action: 'hausdepp_pickup', version: fixture.board._hausdepp.version });
    await expect(page.locator('#hausdeppPileInspector')).not.toBeVisible();
  });
}

for (const reduced of [false, true]) {
  test(`burned cards travel to a distinct backs-only stack (${reduced ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    const fixture = await tableFixture(page);
    const next = structuredClone(fixture.board);
    Object.assign(next._hausdepp, {
      version: next._hausdepp.version + 1, hand: ['leaves-U', 'acorns-A'], discard: [], burned_count: 8,
      available_actions: ['draw'], playable_cards: [], draw_required: true, draw_urgent: true,
      last_event: { type: 'play', player_id: fixture.self, cards: ['hearts-10'], burn_reason: 'ten', burned_count: 8 },
    });
    fixture.send(next);
    await expect(page.locator('#hausdeppBurnedCount')).toHaveText('8');
    await expect(page.locator('#hausdeppBurnedStack .hd-burned-card')).toHaveCount(6);
    await expect(page.locator('#hausdeppBurnedStack [data-card-id], #hausdeppBurnedStack svg')).toHaveCount(0);
    await expect(page.locator('#hausdeppBurnedStack')).toHaveAttribute('aria-hidden', 'true');
    await expect.poll(() => page.evaluate(() => window.__pileMotions.some(event => event.type === 'burn'))).toBe(true);
    const burn = await page.evaluate(() => window.__pileMotions.find(event => event.type === 'burn'));
    expect(burn).toMatchObject({ source: 'pile', target: 'burned', count: 8, reducedMotion: reduced });
    const stack = await page.locator('#hausdeppBurnedStack').boundingBox();
    expect(Math.abs(burn.to.x - (stack.x + stack.width / 2))).toBeLessThanOrEqual(1);
    expect(Math.abs(burn.to.y - (stack.y + stack.height / 2))).toBeLessThanOrEqual(1);
    if (reduced) await expect(page.locator('.hd-deal-card')).toHaveCount(0);
    else await expect(page.locator('.hd-deal-card[data-motion-type="burn"][data-target="burned"]')).toHaveCount(8);
    await expect(page.locator('.hd-deal-card')).toHaveCount(0);
    for (const [width, height] of VIEWPORTS) {
      await page.setViewportSize({ width, height });
      const geometry = await page.locator('#hausdeppBurnedStack').evaluate(element => {
        const rect = element.getBoundingClientRect();
        const intersects = other => rect.left < other.right - 1 && rect.right > other.left + 1 && rect.top < other.bottom - 1 && rect.bottom > other.top + 1;
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          blocked: [...document.querySelectorAll('.hd-seat, #hausdeppStock, #hausdeppPile, #hausdeppHand [data-card-id]')]
            .some(node => intersects(node.getBoundingClientRect())) };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(-1);
      expect(geometry.right).toBeLessThanOrEqual(width + 1);
      expect(geometry.top).toBeGreaterThanOrEqual(-1);
      expect(geometry.bottom).toBeLessThanOrEqual(height + 1);
      expect(geometry.blocked, `${width}×${height}: out-of-play stack stays distinct from cards and seats`).toBe(false);
      if (process.env.HAUSDEPP_CENTRE_SCREENSHOTS === '1' && !reduced && [320, 390, 844, 1440].includes(width)) {
        await page.screenshot({ path: test.info().outputPath(`burned-stack-${width}x${height}.png`) });
      }
    }
  });
}
