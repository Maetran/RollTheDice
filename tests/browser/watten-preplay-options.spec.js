const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

async function settledInspection(page) {
  await page.evaluate(() => new Promise(resolve => {
    let previous = '', stable = 0;
    const frame = () => {
      const cards = [...document.querySelectorAll('[data-watten-inspection] .wt-card')];
      const current = JSON.stringify(cards.map(card => [card.style.width, card.closest('figure').style.cssText]));
      stable = current === previous ? stable + 1 : 0; previous = current;
      if (stable >= 3 && document.querySelector('[data-wt-inspection-positioned]')) resolve();
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }));
}

for (const language of ['de', 'en']) {
  test(`${language}: optional inspection menus leave both callers' pointer ACK reachable when closed and open`, async ({ browser, baseURL }, info) => {
    const configured = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(configured, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { count: 4, target: 15, reference: true, schoeneres: true });
      const { id: gameId, engine: { deal_id: dealId } } = players[0].traffic.snapshot;
      await action(players, 'show_ready'); await action(players, 'show_ready');
      // Each recipient receives the accepted show separately. The actor's
      // opportunity alone cannot establish the other callers' inspection DTOs.
      await expect.poll(() => {
        const current = players[0].traffic.snapshot?.engine;
        return players.map(peer => {
          const snapshot = peer.traffic.snapshot, engine = snapshot?.engine;
          return { game: snapshot?.id, deal: engine?.deal_id, phase: engine?.phase,
            synchronized: engine?.deal_revision === current?.deal_revision && engine?.opportunity === current?.opportunity };
        });
      }).toEqual(players.map(() => ({ game: gameId, deal: dealId, phase: 'inspection', synchronized: true })));
      const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('inspection_ack'));
      expect(callers).toHaveLength(2);
      for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 852, height: 393 }, { width: 568, height: 320 }]) {
        for (const caller of callers) {
          const page = caller.page;
          await page.setViewportSize(viewport);
          await settledInspection(page);
          const menu = page.locator('[data-watten-preplay-options]');
          await expect(menu).toBeVisible();
          if (await menu.evaluate(node => node.open)) await menu.locator('summary').click();
          const widths = await page.locator('[data-watten-inspection] .wt-card').evaluateAll(nodes => nodes.map(node => Number.parseFloat(getComputedStyle(node).width)));
          expect(widths).toHaveLength(2);
          expect(Math.min(...widths)).toBeGreaterThanOrEqual(51.9);
          await expectReachable(page, '[data-watten-action=inspection_ack]');
          await page.locator('[data-watten-action=inspection_ack]').click({ trial: true });
          await expectReachable(page, '[data-watten-preplay-options] > summary');
          const ack = await page.locator('[data-watten-action=inspection_ack]').boundingBox();
          await menu.locator('summary').click();
          await expect(menu).toHaveAttribute('open', '');
          await expectReachable(page, '[data-watten-preplay-options] > summary');
          await expect(page.locator('[data-watten-action=request_schlagwechsel]')).toHaveCount(0);
          for (const kind of ['request_schoeneres']) {
            const button = page.locator(`[data-watten-action=${kind}]`);
            await expect(button).toBeEnabled();
            await button.scrollIntoViewIfNeeded();
            await expectReachable(page, `[data-watten-action=${kind}]`);
            await button.click({ trial: true });
          }
          await expectReachable(page, '[data-watten-action=inspection_ack]');
          await page.locator('[data-watten-action=inspection_ack]').click({ trial: true });
          expect(await page.locator('[data-watten-action=inspection_ack]').boundingBox()).toEqual(ack);
          expect(await page.locator('[data-watten-inspection] .wt-card').evaluateAll(nodes => nodes.map(node => Number.parseFloat(getComputedStyle(node).width)))).toEqual(widths);
          await page.screenshot({ path: info.outputPath(`inspection-options-${caller.traffic.snapshot.viewer.seat}-${viewport.width}x${viewport.height}.png`) });
          await menu.locator('summary').click();
        }
      }
      // Native pointer ACKs must progress the actual round for both callers.
      await callers[0].page.locator('[data-watten-preplay-options] > summary').click();
      await callers[0].page.locator('[data-watten-action=inspection_ack]').click();
      await callers[1].page.locator('[data-watten-action=inspection_ack]').click();
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: the optional menu retains both legal choices before a normal call`, async ({ browser, baseURL }) => {
    const configured = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(configured, baseURL, language, { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { count: 4, target: 15, determination: 'normal', schoeneres: true, schlagwechsel: true });
      const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('request_schlagwechsel'));
      expect(callers).toHaveLength(2);
      for (const viewport of [{ width: 393, height: 852 }, { width: 320, height: 568 }, { width: 852, height: 393 }, { width: 568, height: 320 }]) {
        for (const caller of callers) {
          const page = caller.page;
          await page.setViewportSize(viewport);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const menu = page.locator('[data-watten-preplay-options]');
          if (await menu.evaluate(node => node.open)) await menu.locator('summary').click();
          await menu.locator('summary').click();
          for (const kind of ['request_schoeneres', 'request_schlagwechsel']) {
            const button = page.locator(`[data-watten-action=${kind}]`);
            await expect(button).toBeEnabled();
            await button.scrollIntoViewIfNeeded();
            await expectReachable(page, `[data-watten-action=${kind}]`);
            await button.click({ trial: true });
          }
          await menu.locator('summary').click();
        }
      }
      await callers[0].page.locator('[data-watten-preplay-options] > summary').click();
      await callers[0].page.locator('[data-watten-action=request_schlagwechsel]').click();
      await action(players, 'preplay_decline');
      await expect.poll(() => players.every(peer => !peer.traffic.snapshot.engine.preplay.pending)).toBe(true);
      expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}

test('an exclusive redraw after accepted Blödeln renders one request and one response control pair', async ({ browser, baseURL }) => {
  const configured = { newContext: options => browser.newContext({ ...options,
    viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(configured, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    await create(players, { count: 4, target: 15, schoeneres: true });
    await action(players, 'request_bloedeln'); await action(players, 'preplay_accept');
    await action(players, 'show_ready'); await action(players, 'show_ready');
    const requester = players.find(peer => peer.traffic.snapshot.engine.actions.includes('request_schoeneres'));
    await requester.page.locator('[data-watten-preplay-options] > summary').click();
    await requester.page.locator('[data-watten-action=request_schoeneres]').click();
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.pending?.kind === 'schoeneres')).toBe(true);
    for (const peer of players) {
      await expect(peer.page.locator('[data-watten-preplay-pending=schoeneres]')).toHaveCount(1);
      await expect(peer.page.locator('#wattenPreplayTitle')).toHaveCount(1);
      await expect(peer.page.locator('[data-wt-preplay]')).toBeEmpty();
      const canRespond = peer.traffic.snapshot.engine.actions.includes('preplay_accept');
      await expect(peer.page.locator('[data-watten-action=preplay_accept]')).toHaveCount(canRespond ? 1 : 0);
      await expect(peer.page.locator('[data-watten-action=preplay_decline]')).toHaveCount(canRespond ? 1 : 0);
    }
    await action(players, 'preplay_decline');
    await expect.poll(() => players.every(peer => !peer.traffic.snapshot.engine.preplay.pending)).toBe(true);
    await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
    expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
