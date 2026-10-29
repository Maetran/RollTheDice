const { test, expect } = require('@playwright/test');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');

// The worker and the update UI are real; the page is a minimal active-table
// harness. Keep the worker response mutable without touching repository assets.
for (const inherited of [false, true]) test(`a real waiting Watten worker in standalone mode ${inherited ? 'after a suite worker' : 'on its own'} reloads only on request`, async ({ browser }) => {
  const worker = await readFile('app/static/watten-sw.js', 'utf8');
  const pwa = await readFile('frontend/watten/pwa.js', 'utf8');
  let revision = 1;
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(`self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
        self.addEventListener('fetch', e => e.respondWith(fetch(e.request)));`);
    } else if (request.url === '/bootstrap') {
      response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>bootstrap</title>');
    } else if (request.url === '/watten-sw.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.setHeader('Service-Worker-Allowed', '/');
      response.end(`${worker}\n// test-worker-revision ${revision}\n`);
    } else if (request.url === '/pwa.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(pwa);
    } else if (request.url.startsWith('/watten/spiel/')) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html data-watten-public-beta="true"><head></head><body>
        <main data-wt-table>Unfinished table</main><script type="module">
        import { initializeWattenPwa } from '/pwa.js';
        window.bootId = crypto.randomUUID(); initializeWattenPwa({installControls:false});
        </script></body></html>`);
    } else { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 440, height: 956 } });
  try {
    const page = await context.newPage();
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
    if (inherited) {
      await page.goto(`http://127.0.0.1:${server.address().port}/bootstrap`);
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); });
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'))).toBe(true);
    }
    const beforeTable = navigations;
    await page.goto(`http://127.0.0.1:${server.address().port}/watten/spiel/0123456789abcdef`);
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/watten-sw.js'))).toBe(true);
    expect(await page.evaluate(() => window.WATTEN_PWA.product)).toBe(inherited ? 'zdwa' : 'watten');
    expect(navigations, 'the controlling worker change does not navigate the active table').toBe(beforeTable + 1);
    const boot = await page.evaluate(() => window.bootId);
    await expect(page.locator('[data-watten-update]')).toBeHidden();
    revision = 2;
    await page.evaluate(async () => (await window.WATTEN_PWA.ready).update());
    await expect.poll(() => page.evaluate(async () => Boolean((await window.WATTEN_PWA.ready).waiting))).toBe(true);
    await expect(page.locator('[data-watten-update]')).toBeVisible();
    expect(await page.evaluate(() => window.bootId)).toBe(boot);
    expect(navigations, 'a waiting update does not navigate the active table').toBe(beforeTable + 1);
    await expect(page.locator('[data-wt-table]')).toHaveText('Unfinished table');
    const loaded = page.waitForEvent('domcontentloaded');
    await page.locator('[data-watten-update]').click();
    await loaded;
    await expect.poll(() => page.evaluate(() => window.bootId)).not.toBe(boot);
    expect(navigations, 'the explicit update navigates exactly once').toBe(beforeTable + 2);
    await expect(page.locator('[data-wt-table]')).toHaveText('Unfinished table');
  } finally {
    await context.close();
    await new Promise(resolve => server.close(resolve));
  }
});

const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test('a reloaded four-player phone table restores its public trick and clear history placement', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const players = [];
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 440, height: 956 }, serviceWorkers: 'block' }) };
    for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    await create(players, { count: 4, target: 15, determination: 'normal', reference: true, trickHistory: true });
    await normalCall(players);
    for (let card = 0; card < 4; card++) await playOne(players);
    await expect.poll(() => players[0].traffic.snapshot?.engine?.last_trick?.cards.length).toBe(4);
    for (let card = 0; card < 2; card++) await playOne(players);
    const host = players[0], page = host.page;
    await expect.poll(() => host.traffic.snapshot?.engine?.current_trick?.cards.length).toBe(2);
    await expect(page.locator('[data-wt-trick] .wt-trick-card')).toHaveCount(2);
    await expect(page.locator('[data-wt-history]')).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const historyBefore = await page.locator('[data-wt-history]').boundingBox();
    const savedBefore = await page.evaluate(() => sessionStorage.getItem('watten:history-slot:v1'));
    const before = host.traffic.snapshot.engine.current_trick.cards.map(item => item.card);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-watten-active', 'true');
    await expect(page.locator('[data-wt-trick] .wt-trick-card')).toHaveCount(2);
    await expect(page.locator('[data-wt-history]')).toBeVisible();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const historyAfter = await page.locator('[data-wt-history]').boundingBox();
    const savedAfter = await page.evaluate(() => sessionStorage.getItem('watten:history-slot:v1'));
    for (const raw of [savedBefore, savedAfter]) {
      const saved = JSON.parse(raw);
      expect(Object.keys(saved).sort()).toEqual(['height', 'left', 'surface', 'top', 'width']);
      expect(saved.surface).toMatch(/^4:440:956:[\d.]+:[\d.]+$/);
    }
    expect(Math.abs(historyAfter.x - historyBefore.x), JSON.stringify({ before: historyBefore, after: historyAfter })).toBeLessThanOrEqual(8);
    expect(Math.abs(historyAfter.y - historyBefore.y)).toBeLessThanOrEqual(8);
    expect(await page.locator('[data-wt-trick] .wt-trick-card').evaluateAll(cards => cards.map(card => card.dataset.card))).toEqual(before);
    await expect.poll(() => page.evaluate(() => {
      const table = document.querySelector('[data-wt-felt]').getBoundingClientRect();
      const centre = document.querySelector('.wt-centre').getBoundingClientRect();
      return Math.abs((centre.left + centre.right) / 2 - (table.left + table.right) / 2);
    })).toBeLessThanOrEqual(2);
    expect(host.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
