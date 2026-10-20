const { handleDisabledHausdeppVoice } = require('./hausdepp-voice-fixture');
const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'allow' });

async function signIn(page) {
  const response = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(response.ok()).toBeTruthy();
  const { user } = await response.json();
  return { 'X-CSRF-Token': user.csrf_token };
}

function artwork(url) {
  return /\/static\/hausdepp\/(?:cards-atlas\.webp|card-back\.webp)/.test(url);
}

test.beforeAll(({ baseURL }) => expect(new URL(baseURL).port).not.toBe('8000'));

test.describe('cold card loading uses controllable page requests', () => {
  // A newly activated network-only worker can claim the page before preloading
  // and route its image fetches outside page.route. Test the cold-image barrier
  // without that independent race; the install case below keeps real workers.
  test.use({ serviceWorkers: 'block' });

  test('all card artwork is decoded before the first private table connects', async ({ page }) => {
    const headers = await signIn(page);
    const created = await page.request.post('/api/games', {
      headers, data: { name: 'Renderer-Test · Karten vorladen', mode: '2', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
    });
    const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
    let releaseImages;
    const barrier = new Promise(resolve => { releaseImages = resolve; });
    let blocked = 0;
    const gameSockets = [];
    page.on('websocket', socket => { if (socket.url().includes('/ws/' + room.split('/').pop())) gameSockets.push(socket); });
    await page.route('**/static/hausdepp/**', async route => {
      if (!artwork(route.request().url())) return route.continue();
      blocked += 1;
      await barrier;
      await route.continue();
    });
    try {
      await page.goto(room, { waitUntil: 'domcontentloaded' });
      // Card atlas and back.
      await expect.poll(() => blocked).toBeGreaterThanOrEqual(2);
      expect(gameSockets).toHaveLength(0);
      await expect(page.locator('#hausdeppHand')).toHaveCount(0);
      releaseImages();
      await expect.poll(() => gameSockets.length).toBe(1);
      await expect(page.locator('#hausdeppTable')).toHaveAttribute('data-phase', /peeking|playing/);
      const decoded = await page.evaluate(async () => Promise.all([
        ...new Set([...document.querySelectorAll('svg image')].map(image => image.getAttribute('href'))),
      ].map(async src => { const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth > 0; })));
      expect(decoded.every(Boolean)).toBe(true);
    } finally { releaseImages(); }
  });
});

test('newly drawn card faces reuse warm images without requests or a loading wait', async ({ page, context }) => {
  const headers = await signIn(page);
  const created = await page.request.post('/api/games', {
    headers, data: { name: 'Renderer-Test · Sofort sichtbare Karten', mode: '2', game_type: 'hausdepp', play_mode: 'cpu', cpu_count: 1 },
  });
  const room = `/hausdepp/spiel/${(await created.json()).game_id}`;
  let actual;
  page.on('websocket', socket => socket.on('framereceived', ({ payload }) => {
    try { const message = JSON.parse(String(payload)); if (message.scoreboard?._hausdepp) actual = message.scoreboard; } catch {}
  }));
  await page.goto(room);
  await expect.poll(() => Boolean(actual?._hausdepp?.viewer_id)).toBe(true);
  const board = structuredClone(actual);
  Object.assign(board._hausdepp, {
    phase: 'playing', hand: ['hearts-6', 'bells-U', 'acorns-10'], discard: ['leaves-6'], deck_count: 14,
    available_actions: ['play', 'pickup', 'gamble'], playable_cards: ['hearts-6', 'bells-U', 'acorns-10'],
    pending_refill: null, pending_refills: [], draw_required: false, draw_urgent: false,
    afterthrow: null, private_peek: [], deal: null, stock_blocked_by: null,
    current_player_id: board._hausdepp.viewer_id,
  });
  let socket;
  await page.routeWebSocket(new RegExp(`/ws/${room.split('/').pop()}$`), routed => {
    socket = routed;
    routed.onMessage(raw => {
      const message = JSON.parse(String(raw));
      if (handleDisabledHausdeppVoice(routed, message)) return;
      if (['join_game', 'spectate_game'].includes(message.action)) {
        routed.send(JSON.stringify({ player_id: board._hausdepp.viewer_id, scoreboard: board }));
      }
    });
  });
  await page.goto(room);
  await expect(page.locator('#hausdeppHand [data-card-id]')).toHaveCount(3);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); });
  const requested = [];
  page.on('request', request => { if (artwork(request.url())) requested.push(request.url()); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 2000, downloadThroughput: 32768, uploadThroughput: 32768,
  });
  for (const drawn of ['leaves-10', 'hearts-A', 'acorns-9', 'bells-7']) {
    board._hausdepp.version += 1;
    board._hausdepp.hand = ['bells-U', 'acorns-10', drawn];
    board._hausdepp.playable_cards = [...board._hausdepp.hand];
    socket.send(JSON.stringify({ scoreboard: board }));
    const card = page.locator(`#hausdeppHand [data-card-id="${drawn}"]`);
    await expect(card).toBeVisible({ timeout: 750 });
    const href = await card.locator('svg image').getAttribute('href');
    expect(href).toMatch(/\?v=[a-f0-9]{12}$/);
    const ready = await page.evaluate(async href => {
      const image = new Image(); image.src = href;
      const started = performance.now();
      await image.decode();
      return { elapsed: performance.now() - started, width: image.naturalWidth };
    }, href);
    expect(ready.width).toBeGreaterThan(0);
    expect(ready.elapsed, `${drawn} reuses a decoded source despite 2s network latency`).toBeLessThan(150);
  }
  expect(requested, 'drawing does not fetch card sheets again').toEqual([]);
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
});

test('Chromium accepts the real Hausdepp install manifest and decodes its heart-ten icons', async ({ page, context }) => {
  await page.goto('/hausdepp');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toMatch(/\/hausdepp-sw\.js$/);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  expect(manifest.url).toContain('/hausdepp-manifest.webmanifest');
  const parsed = JSON.parse(manifest.data);
  expect(parsed.id).toBe('/hausdepp');
  expect(parsed.short_name).toBe('Hausdepp');
  for (const icon of parsed.icons) {
    const dimensions = await page.evaluate(async src => {
      const image = new Image(); image.src = src; await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, icon.src);
    expect(dimensions.join('x')).toBe(icon.sizes);
    expect(icon.src).toContain('hausdepp-icon-');
  }
  const apple = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(apple).toContain('hausdepp-apple-touch-icon-180-v2.png');
});
