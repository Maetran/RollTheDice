const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');

test('Watten visible paper patterns survive a real accepted card play and its detached flight', async ({ browser, baseURL }, info) => {
  const players = [];
  try {
    for (let index = 0; index < 2; index++) {
      const peer = await player(browser, baseURL);
      await peer.page.setViewportSize({ width: 390, height: 844 });
      // Cosmetic display fixture only: commands and their accepted game states
      // still traverse the real disposable server. Real claim authorization and
      // restart persistence are covered by test_watten_table_appearance.py.
      await peer.page.routeWebSocket('**/ws/*', socket => {
        const server = socket.connectToServer();
        server.onMessage(raw => {
          const message = JSON.parse(String(raw));
          if (message.scoreboard?.game_type === 'watten') message.scoreboard.table_effects = { scorched_cards: true };
          socket.send(JSON.stringify(message));
        });
      });
      players.push(peer);
    }
    await create(players, { target: 11 }); await normalCall(players);
    const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
    const page = actor.page, card = actor.traffic.snapshot.engine.hand[0].card;
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const hand = page.locator('[data-wt-hand] button[data-card]');
    const patterns = await hand.evaluateAll(nodes => nodes.map(node => getComputedStyle(node, '::before').backgroundImage));
    expect(new Set(patterns).size).toBe(5);
    const paper = await page.locator(`[data-wt-hand] button[data-card="${card}"]`).evaluate(node => getComputedStyle(node, '::before').backgroundImage);
    await page.evaluate(() => {
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (['arrive', 'collect'].includes(this.dataset.wtMotion)) animation.pause();
        return animation;
      };
    });
    const opportunity = actor.traffic.snapshot.engine.opportunity;
    await page.locator(`[data-wt-hand] button[data-card="${card}"]`).press('Enter');
    await expect.poll(() => actor.traffic.snapshot.engine.opportunity).not.toBe(opportunity);
    const flight = page.locator('[data-wt-motion="arrive"] .wt-card');
    await expect(flight).toHaveCount(1);
    expect(await flight.evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toBe(paper);
    await page.screenshot({ path: info.outputPath('watten-scorched-flight.png') });
    await page.locator('[data-wt-motion="arrive"]').evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => animation.finish())));
    const landed = page.locator(`.wt-trick-card[data-card="${card}"]`);
    await expect(landed).toBeVisible();
    expect(await landed.evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toBe(paper);
    await playOne(players);
    const collected = page.locator(`[data-wt-motion="collect"] .wt-card[data-card="${card}"]`);
    await expect(collected).toHaveCount(1);
    expect(await collected.evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toBe(paper);
    await page.locator('[data-wt-motion="collect"]').evaluateAll(nodes => nodes.forEach(node => node.getAnimations().forEach(animation => animation.finish())));
    expect(actor.traffic.errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('watten-scorched-pile.png') });
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
