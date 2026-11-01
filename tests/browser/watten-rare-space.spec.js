const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');

test('a rare Watten find remains reachable on a crowded phone table', async ({ browser, baseURL }) => {
  const peers = [];
  try {
    for (let seat = 0; seat < 2; seat++) {
      const peer = await player(browser, baseURL);
      await peer.page.setViewportSize({ width: 320, height: 568 });
      await peer.page.routeWebSocket('**/ws/*', socket => {
        peer.inject = message => socket.send(JSON.stringify(message));
        socket.connectToServer();
      });
      peers.push(peer);
    }
    await create(peers); await normalCall(peers);
    const peer = peers[0], page = peer.page, snapshot = peer.traffic.snapshot;
    // Simulate a felt entirely occupied by protected table content. The
    // blocker has no input surface and leaves the real cards fully usable.
    await page.evaluate(() => {
      const felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
      const blocker = document.createElement('div');
      blocker.className = 'wt-seat-slot';
      blocker.style.cssText = `position:fixed;left:${felt.left}px;top:${felt.top}px;width:${felt.width}px;height:${felt.height}px;pointer-events:none`;
      document.querySelector('[data-watten-view]').append(blocker);
    });
    peer.inject({ scoreboard: { ...snapshot, table_surprise_offer: { deal_id: snapshot.engine.deal_id, effect: 'star' } } });
    const rare = page.locator('.wt-decor-prop--rare');
    await expect(rare).toBeVisible();
    await expect(page.locator('[data-wt-tools] .wt-decor-prop--rare')).toHaveCount(1);
    const overlap = await rare.evaluate(node => {
      const a = node.getBoundingClientRect();
      return [...document.querySelectorAll('[data-wt-hand-area], [data-wt-stake], [data-wt-scores]')]
        .filter(other => !other.closest('[hidden]')).some(other => {
          const b = other.getBoundingClientRect();
          return b.width && b.height && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        });
    });
    expect(overlap).toBe(false);
    // The same fallback also works if no felt region is measurable at all.
    await page.locator('[data-wt-felt]').evaluate(node => { node.hidden = true; });
    await expect(rare).toBeVisible();
    await expect(page.locator('[data-wt-tools] .wt-decor-prop--rare')).toHaveCount(1);
    await expect(rare).toHaveAttribute('aria-label', /.+/);
    const title = await page.locator('[data-wt-scores]').boundingBox();
    const button = await rare.boundingBox();
    expect(button.x).toBeGreaterThanOrEqual(0);
    expect(button.x + button.width).toBeLessThanOrEqual(321);
    expect(button.x >= title.x + title.width || button.y >= title.y + title.height).toBe(true);
    await rare.click();
    await expect.poll(() => peer.traffic.commands.filter(command => command.action === 'watten_table_surprise').length).toBe(1);
    expect(peers.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(peers.map(peer => peer.context.close())); }
});

test('a rare find keeps its position through table repaints on a phone', async ({ browser, baseURL }) => {
  const peers = [];
  try {
    for (let seat = 0; seat < 2; seat++) {
      const peer = await player(browser, baseURL);
      await peer.page.setViewportSize({ width: 440, height: 956 });
      await peer.page.routeWebSocket('**/ws/*', socket => {
        peer.inject = message => socket.send(JSON.stringify(message));
        socket.connectToServer();
      });
      peers.push(peer);
    }
    await create(peers); await normalCall(peers);
    const peer = peers[0], page = peer.page, snapshot = peer.traffic.snapshot;
    peer.inject({ scoreboard: { ...snapshot, table_surprise_offer: { deal_id: snapshot.engine.deal_id, effect: 'star' } } });
    const rare = page.locator('[data-watten-decor-layer] .wt-decor-prop--rare');
    await expect(rare).toBeVisible();
    const initial = await rare.boundingBox();
    for (let repaint = 0; repaint < 5; repaint++) {
      await page.evaluate(async () => {
        // Exercise the same observer used by normal table repaints.
        const marker = document.createElement('span');
        marker.hidden = true;
        document.querySelector('[data-watten-view]').append(marker);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        marker.remove();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const actual = await rare.boundingBox();
      expect(actual.x).toBeCloseTo(initial.x, 1);
      expect(actual.y).toBeCloseTo(initial.y, 1);
    }
  } finally { await Promise.allSettled(peers.map(peer => peer.context.close())); }
});
