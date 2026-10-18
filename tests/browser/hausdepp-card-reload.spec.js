const { test, expect } = require('@playwright/test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

test.use({ serviceWorkers: 'allow', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });

const artwork = url => /\/static\/hausdepp\/(?:cards-atlas\.webp|card-back\.webp)(?:\?|$)/.test(url);

test.beforeAll(({ baseURL }) => {
  expect(['8000', '8001', '8051'], 'Only a disposable test server may run this regression').not.toContain(new URL(baseURL).port);
});

async function ready(page) {
  const demo = page.locator('.hd-lobby-cards');
  await expect(demo).toHaveAttribute('data-card-assets', 'ready');
  await expect(demo.locator('.hausdepp-card')).toHaveCount(3);
  return demo;
}

async function expectPaintedMotif(page) {
  const card = page.locator('.hd-lobby-cards [data-card-id="hearts-10"]');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  // The centre of the frontmost card excludes its rotated edges and the
  // wooden table. Blank ivory paper therefore cannot satisfy this check.
  const screenshot = await page.screenshot({ clip: {
    x: box.x + box.width * .3, y: box.y + box.height * .2,
    width: box.width * .4, height: box.height * .6,
  } });
  const python = process.env.PLAYWRIGHT_PYTHON || (fs.existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
  const inkFraction = Number(execFileSync(python, ['-c', [
    'import sys', 'from PIL import Image',
    'image = Image.open(sys.stdin.buffer).convert("RGB")',
    'pixels = list(image.getdata())',
    'ink = sum(max(p) < 110 or max(p) - min(p) > 35 and min(p) < 180 for p in pixels)',
    'print(ink / len(pixels))',
  ].join('\n')], { input: screenshot, encoding: 'utf8' }));
  expect(inkFraction, 'The rendered heart-ten has coloured motif/ink pixels, not just cream paper').toBeGreaterThan(.06);
}

test('real worker-controlled warm reloads keep lobby card motives painted', async ({ page, browserName }) => {
  const writes = [];
  const responses = [];
  page.on('request', request => {
    if (request.method() !== 'GET' && /\/api\/games(?:[/?]|$)/.test(request.url())) writes.push(request.url());
  });
  page.on('response', response => { if (artwork(response.url())) responses.push(response); });
  await page.goto('/hausdepp');
  await ready(page);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL || '')).toMatch(/\/hausdepp-sw\.js$/);
  await expectPaintedMotif(page);
  for (let reload = 0; reload < 3; reload += 1) {
    responses.length = 0;
    await page.reload();
    await ready(page);
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expectPaintedMotif(page);
    expect(responses.length).toBeGreaterThan(0);
    expect(responses.every(response => response.ok() && !response.fromServiceWorker()),
      'Public pictures use native image/HTTP caching instead of a worker fetch wrapper').toBe(true);
    const warmImages = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => /\/static\/hausdepp\/(?:cards-atlas\.webp|card-back\.webp)\?v=/.test(entry.name))
      .map(entry => ({ url: entry.name, transfer: entry.transferSize })));
    expect(new Set(warmImages.map(image => image.url)).size).toBe(2);
    if (browserName === 'chromium') {
      expect(warmImages.every(image => image.transfer === 0), 'Chromium reload reuses immutable image bytes from HTTP cache').toBe(true);
    }
    // Playwright WebKit may re-fetch an immutable picture on explicit reload.
    // Prove native warm image reuse in both engines independently of that
    // navigation policy: decoding both identical sources sends no request.
    const decodeRequests = [];
    const recordDecodeRequest = request => { if (artwork(request.url())) decodeRequests.push(request.url()); };
    page.on('request', recordDecodeRequest);
    try {
      const decoded = await page.evaluate(async urls => Promise.all(urls.map(async src => {
        const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth > 0;
      })), [...new Set(warmImages.map(image => image.url))]);
      expect(decoded).toEqual([true, true]);
      expect(decodeRequests, 'Already decoded public sources stay in the native image cache').toEqual([]);
    } finally { page.off('request', recordDecodeRequest); }
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
  }
  expect(writes).toEqual([]);
});

test.describe('cold image loading and retry', () => {
  // A real worker claims the warm-reload case above. The cold barrier needs
  // controllable page requests independently of service-worker interception.
  test.use({ serviceWorkers: 'block' });

  test('lobby creates no blank SVG cards while its source image is still loading', async ({ page }) => {
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let blocked = false;
    await page.route('**/static/hausdepp/cards-atlas.webp?*', async route => {
      blocked = true; await barrier; await route.continue();
    });
    try {
      await page.goto('/hausdepp', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => blocked).toBe(true);
      await expect(page.locator('.hd-lobby-cards')).toHaveAttribute('data-card-assets', 'loading');
      await expect(page.locator('.hd-lobby-cards .hausdepp-card')).toHaveCount(0);
      await expect(page.locator('.hd-rules-link')).toBeVisible();
      await expect(page.locator('.hd-rules-link')).toHaveAttribute('href', '/hausdepp/regeln');
      release();
      await ready(page);
      await expectPaintedMotif(page);
    } finally { release(); }
  });

  test('a transient card-image failure retries without leaving cream cards behind', async ({ page }) => {
    let attempts = 0;
    await page.route('**/static/hausdepp/cards-atlas.webp?*', async route => {
      attempts += 1;
      if (attempts === 1) return route.fulfill({ status: 503, body: 'Temporary image failure' });
      return route.continue();
    });
    await page.goto('/hausdepp');
    await ready(page);
    expect(attempts).toBeGreaterThanOrEqual(2);
    await expectPaintedMotif(page);
  });
});
