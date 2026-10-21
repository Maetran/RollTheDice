const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test.setTimeout(90_000);

async function recordLayout(page, info, stage) {
  const path = info.outputPath(`${stage}-portrait-layout.json`);
  const geometry = await page.evaluate(() => {
    const rect = node => { const { x, y, width, height, top, right, bottom, left } = node.getBoundingClientRect(); return { x, y, width, height, top, right, bottom, left }; };
    return {
      centre: { ...document.querySelector('.wt-centre').dataset }, felt: rect(document.querySelector('.wt-felt')),
      label: document.querySelector('.wt-trick-label').textContent,
      obstacles: [...document.querySelectorAll('.wt-seat-badge, .wt-backs > i:not([hidden]), .wt-taken[data-filled="true"], .wt-stock, [data-wt-hand-area], [data-wt-panel], [data-wt-private] button, [data-wt-stake], [data-wt-history]:not([open])')]
        .filter(node => !node.hidden && getComputedStyle(node).display !== 'none')
        .map(node => ({ tag: node.tagName, class: node.className, rect: rect(node) })),
      reference: document.querySelector('.wt-reference') ? rect(document.querySelector('.wt-reference')) : null,
    };
  });
  await writeFile(path, JSON.stringify(geometry, null, 2));
  await info.attach(`${stage}-portrait-layout`, { path, contentType: 'application/json' });
}

for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 852 }]) {
  test(`four-player portrait ${viewport.width}x${viewport.height}: larger live trick and readable review`, async ({ browser, baseURL }, info) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
      for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL));
      await create(players, { determination: 'normal', target: 15 });
      await normalCall(players);
      for (let index = 0; index < 3; index++) {
        await playOne(players);
        await expect.poll(() => players[0].traffic.snapshot?.engine?.current_trick?.cards.length).toBe(index + 1);
      }
      const page = players[0].page;
      await expect(page.locator('.wt-trick-card')).toHaveCount(3);
      await expect(page.locator('[data-watten-call]')).toHaveCount(0);
      await recordLayout(page, info, 'live');
      await expect.poll(() => page.locator('.wt-trick-card').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width)))
        .toBeGreaterThanOrEqual(viewport.width <= 350 ? 64 : 76);
      await expect.poll(() => page.evaluate(() => {
        const errors = [], cards = [...document.querySelectorAll('.wt-trick-card')];
        const visible = node => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
        const protectedNodes = [...document.querySelectorAll('.wt-seat-badge, .wt-backs > i:not([hidden]), [data-wt-hand-area], [data-wt-panel], [data-wt-stake]')].filter(visible);
        const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        for (const card of cards) {
          const bounds = card.getBoundingClientRect();
          if (bounds.left < 0 || bounds.right > innerWidth || bounds.top < 0 || bounds.bottom > innerHeight) errors.push('card outside viewport');
          if (protectedNodes.some(node => intersects(bounds, node.getBoundingClientRect()))) errors.push('card overlaps hand, avatar or control');
          const rank = document.elementFromPoint(bounds.left + bounds.width * .12, bounds.top + bounds.height * .1);
          if (!card.contains(rank)) errors.push('card rank covered');
          const owner = card.querySelector('.wt-card-owner'), ownerBounds = owner.getBoundingClientRect();
          if (!owner.textContent.trim() || !owner.contains(document.elementFromPoint(ownerBounds.x + ownerBounds.width / 2, ownerBounds.y + ownerBounds.height / 2))) errors.push('owner name covered');
        }
        return errors;
      }), { message: 'larger public faces, ranks and owner labels remain clear of all table controls' }).toEqual([]);
      await page.screenshot({ path: info.outputPath(`watten-current-${viewport.width}x${viewport.height}.png`) });
      await playOne(players);
      await expect.poll(() => players[0].traffic.snapshot?.engine?.last_trick?.cards.length).toBe(4);
      await expect(page.locator('.wt-trick[data-state="last"] .wt-trick-card')).toHaveCount(4);
      await recordLayout(page, info, 'completed');
      await expect.poll(() => page.locator('.wt-trick-card').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width)))
        .toBeGreaterThanOrEqual(viewport.width <= 350 ? 64 : 76);
      await expect.poll(() => page.locator('.wt-trick-label').evaluate(node => {
        const rect = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }), { message: 'completed trick keeps its larger faces and a visible winner label' }).toBe(true);
      await page.screenshot({ path: info.outputPath(`watten-completed-${viewport.width}x${viewport.height}.png`) });
      const history = page.locator('[data-wt-history]');
      if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
      await expect(history.locator('.wt-history > li').last().locator('.wt-card--mini')).toHaveCount(4);
      await expect.poll(() => history.locator('.wt-card--mini').first().evaluate(node => Number.parseFloat(getComputedStyle(node).width))).toBeGreaterThanOrEqual(60);
      await expect.poll(() => history.evaluate(node => {
        const cards = [...node.querySelectorAll('.wt-history > li:last-child .wt-mini-cards > figure')];
        return cards.every(figure => {
          const rect = figure.getBoundingClientRect(), port = node.querySelector('.wt-history').getBoundingClientRect();
          return rect.left >= port.left - 1 && rect.right <= port.right + 1 && rect.top >= port.top - 1 && rect.bottom <= port.bottom + 1
            && figure.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        });
      }), { message: 'all four larger review cards and their names fit together without scrolling' }).toBe(true);
      await page.screenshot({ path: info.outputPath(`watten-review-${viewport.width}x${viewport.height}.png`) });
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
