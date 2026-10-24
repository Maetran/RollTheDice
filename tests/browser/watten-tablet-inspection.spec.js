const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, action } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

const VIEWPORTS = [{ width: 1024, height: 1366 }, { width: 1366, height: 1024 }];
const CARD = /^(?:(?:hearts|bells|leaves|acorns)-(?:7|8|9|10|U|O|K|A)|bells-6)$/;

test('both real tablet callers see complete card artwork and can acknowledge inspection in either orientation', async ({ browser, baseURL }, info) => {
  test.setTimeout(60_000);
  const configured = { newContext: options => browser.newContext({ ...options,
    viewport: VIEWPORTS[0], serviceWorkers: 'block' }) };
  const players = [], measurements = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(configured, baseURL));
    await create(players);
    for (const item of players) expect(item.traffic.snapshot.room.recipe).toMatchObject({
      player_count: 4, determination: 'ladinisch', blind: true,
    });
    await action(players, 'show_ready');
    await action(players, 'show_ready');
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'inspection')).toBe(true);
    const callers = players.filter(item => item.traffic.snapshot.engine.actions.includes('inspection_ack'));
    expect(callers).toHaveLength(2);

    for (const viewport of VIEWPORTS) for (const caller of callers) {
      const page = caller.page;
      await page.setViewportSize(viewport);
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expect(page.locator('script[src^="/static/watten-game.js"]')).toHaveCount(1);
      const faces = page.locator('[data-watten-inspection] .wt-card[data-card]');
      await expect(faces).toHaveCount(2);
      for (const shown of caller.traffic.snapshot.engine.inspection.cards) {
        expect(shown.card).toMatch(CARD);
        const face = page.locator(`.wt-reveal-card--${shown.role} .wt-card`);
        await expect(face).toHaveAttribute('data-card', shown.card);
        await expect(face).toBeVisible();
        await expect(face.locator('svg.hd-card-art')).toBeVisible();
        await expect(face.locator('svg image')).toBeVisible();
      }
      const artwork = await faces.evaluateAll(nodes => nodes.map(node => {
        const svg = node.querySelector('svg'), clip = svg.querySelector('clipPath'), image = svg.querySelector('image');
        return { card: node.dataset.card, clip: clip.id, reference: image.parentElement.getAttribute('clip-path'),
          unique: document.querySelectorAll(`#${CSS.escape(clip.id)}`).length,
          href: image.getAttribute('href'), box: node.getBoundingClientRect().toJSON() };
      }));
      expect(new Set(artwork.map(item => item.clip)).size).toBe(2);
      for (const item of artwork) {
        expect(item.unique).toBe(1);
        expect(item.reference).toBe(`url(#${item.clip})`);
        expect(item.href).toBeTruthy();
        expect(item.box.left).toBeGreaterThanOrEqual(0);
        expect(item.box.right).toBeLessThanOrEqual(viewport.width);
        expect(item.box.top).toBeGreaterThanOrEqual(0);
        expect(item.box.bottom).toBeLessThanOrEqual(viewport.height);
      }
      // Decode the same native atlas referenced by the real rendered SVGs.
      // An existing <image> alone would also pass with an unloaded white face.
      for (const href of new Set(artwork.map(item => item.href))) {
        const decoded = await page.evaluate(async url => {
          const image = new Image(); image.src = url;
          await image.decode();
          return { width: image.naturalWidth, height: image.naturalHeight };
        }, href);
        expect(decoded.width).toBeGreaterThan(0);
        expect(decoded.height).toBeGreaterThan(0);
      }
      await expect(page.locator('[data-watten-preplay-pending="bloedeln"], [data-watten-bloedeln-status], [data-watten-bloedeln-start]')).toHaveCount(0);
      const ack = page.locator('[data-watten-action="inspection_ack"]');
      await expect(ack).toBeEnabled();
      await expectReachable(page, '[data-watten-action="inspection_ack"]');
      await ack.click({ trial: true });
      const target = await ack.boundingBox();
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      measurements.push({ seat: caller.traffic.snapshot.viewer.seat, viewport, artwork, ack: target });
      await page.screenshot({ path: info.outputPath(`inspection-${caller.traffic.snapshot.viewer.seat}-${viewport.width}x${viewport.height}.png`) });
    }
    await action(callers, 'inspection_ack');
    await action(callers, 'inspection_ack');
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally {
    await writeFile(info.outputPath('tablet-inspection.json'), JSON.stringify(measurements, null, 2));
    await Promise.allSettled(players.map(item => item.context.close()));
  }
});
