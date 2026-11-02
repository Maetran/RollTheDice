const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test.setTimeout(90_000);

async function expectCurrent(peer, cards) {
  const trick = peer.page.locator('[data-wt-trick]');
  await expect(trick).toHaveAttribute('data-state', 'current');
  await expect(trick.locator(':scope > .wt-trick-card')).toHaveCount(cards.length);
  expect(await trick.locator(':scope > .wt-trick-card').evaluateAll(nodes => nodes.map(node => node.dataset.card)))
    .toEqual(cards.map(item => item.card));
  for (const item of cards) await expect(trick.locator(`[data-key="${item.card}"]`)).toBeVisible();
  await expect(peer.page.locator('[data-wt-motion]')).toHaveCount(0);
}

for (const [language, viewport] of [['de', { width: 390, height: 844 }], ['en', { width: 1280, height: 900 }]]) {
  test(`${language}: review retires a held old trick and restores live cards through every close path`, async ({ browser, baseURL }) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options, viewport,
        serviceWorkers: 'block', reducedMotion: 'no-preference' }) };
      for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL, language,
        { role: index === 0 ? 'admin' : 'user' }));
      await create(players, { determination: 'normal', target: 15, trickHistory: true });
      await normalCall(players);
      // Freeze real WAAPI presentation, not the accepted game state. The old
      // trick stays at centre while the next accepted play waits in its flight.
      for (const peer of players) await peer.page.evaluate(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('[data-wt-motion="collect"]')) { animation.pause(); animation.currentTime = 1000; }
          if (this.matches('[data-wt-motion="arrive"]')) { animation.pause(); animation.currentTime = 100; }
          return animation;
        };
      });
      for (let count = 0; count < 4; count++) await playOne(players);
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.last_trick?.cards.length === 4)).toBe(true);
      for (const peer of players) await expect(peer.page.locator('[data-wt-motion="collect"]')).toHaveCount(1);

      const waiting = players.find(peer => !peer.traffic.snapshot.engine.actions.includes('play_card'));
      const waitingHistory = waiting.page.locator('[data-wt-history]');
      await waitingHistory.locator('summary').click();
      await expect(waitingHistory).toHaveAttribute('open', '');
      await waitingHistory.locator('[data-wt-history-close]').click();
      await expect(waitingHistory).not.toHaveAttribute('open', '');
      await expect.poll(() => waiting.page.locator('[data-wt-trick] > .wt-trick-card').evaluateAll(nodes => nodes.filter(node => {
        const style = getComputedStyle(node); return style.visibility !== 'hidden' && Number(style.opacity) > 0;
      }).length), { message: 'closing review must not revive the cancelled previous trick' }).toBe(0);

      await playOne(players);
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 1)).toBe(true);
      const first = players[0].traffic.snapshot.engine.current_trick.cards;
      // The waiting player's arrival is already in flight; the other three
      // arrivals are queued behind the held old trick. Both must be discarded.
      await expect(waiting.page.locator('[data-wt-motion="arrive"]')).toHaveCount(1);
      for (const [index, peer] of players.entries()) {
        const history = peer.page.locator('[data-wt-history]');
        await history.locator('summary').click();
        await expect(history).toHaveAttribute('open', '');
        await expect(peer.page.locator('[data-wt-motion]')).toHaveCount(0);
        if (index === 3) {
          await history.locator('[data-wt-history-pin]').check();
          await peer.page.locator('.wt-target').click();
          await expect(history).toHaveAttribute('open', '');
          await history.locator('[data-wt-history-close]').click();
          await expect(history.locator('[data-wt-history-pin]')).not.toBeChecked();
        } else if (index === 2) await peer.page.locator('.wt-target').click();
        else if (index === 1) await peer.page.keyboard.press('Escape');
        else await history.locator('[data-wt-history-close]').click();
        await expect(history).not.toHaveAttribute('open', '');
        await expectCurrent(peer, first);
        await history.locator('summary').click();
        await history.locator('summary').click();
        await expect(history).not.toHaveAttribute('open', '');
        await expectCurrent(peer, first);
      }

      // Accepted cards also update while a pinned review owns the surface.
      const observer = players.find(peer => !peer.traffic.snapshot.engine.actions.includes('play_card'));
      const history = observer.page.locator('[data-wt-history]');
      await history.locator('summary').click();
      await history.locator('[data-wt-history-pin]').check();
      await playOne(players);
      await expect.poll(() => observer.traffic.snapshot.engine.current_trick.cards.length).toBe(2);
      await expect(history).toHaveAttribute('open', '');
      await expect(observer.page.locator('[data-wt-motion]')).toHaveCount(0);
      await history.locator('[data-wt-history-close]').click();
      await expectCurrent(observer, observer.traffic.snapshot.engine.current_trick.cards);
      expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
