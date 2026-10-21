const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`blind ${language}: both non-callers choose before play, see each answer, and one no declines Blödeln`, async ({ browser, baseURL }) => {
    const mobile = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(mobile, baseURL, language));
      await create(players, { count: 4, target: 11 });
      const consent = () => players[0].traffic.snapshot?.engine?.preplay?.bloedeln_consent;
      await expect.poll(() => consent()?.pending).toBe(true);
      const nonCallers = consent().decisions.map(item => players.find(peer => peer.traffic.snapshot.viewer.seat === item.seat));
      for (const peer of nonCallers) {
        await expect(peer.page.locator('[data-watten-action=bloedeln_accept]')).toBeVisible();
        await expect(peer.page.locator('[data-watten-action=bloedeln_decline]')).toBeVisible();
      }
      // Announcers may finish their own work while the two other players decide.
      await action(players, 'show_ready');
      await action(players, 'show_ready');
      await action(players, 'inspection_ack');
      await action(players, 'inspection_ack');
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
      expect(players.every(peer => !peer.traffic.snapshot.engine.actions.includes('play_card')
        && !peer.traffic.snapshot.engine.actions.includes('bid'))).toBe(true);
      await nonCallers[0].page.locator('[data-watten-action=bloedeln_decline]').click();
      const firstSeat = nonCallers[0].traffic.snapshot.viewer.seat;
      await expect.poll(() => nonCallers[1].traffic.snapshot.engine.preplay.bloedeln_consent.decisions
        .find(item => item.seat === firstSeat)?.accepted).toBe(false);
      await expect(nonCallers[1].page.locator(`[data-watten-bloedeln-seat="${firstSeat}"]`)).toHaveAttribute('data-decision', 'no');
      await expect(nonCallers[1].page.locator('[data-watten-action=bloedeln_accept]')).toBeEnabled();
      expect(players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === 0)).toBe(true);
      await nonCallers[1].page.locator('[data-watten-action=bloedeln_accept]').click();
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_consent.pending === false)).toBe(true);
      for (const peer of players) {
        await expect(peer.page.locator('[data-watten-bloedeln-consent=settled]')).toContainText(language === 'de' ? 'Kein Blödeln' : 'No Blödeln');
        expect(peer.traffic.snapshot.engine.preplay.bloedeln_cards).toEqual([]);
        expect(peer.traffic.errors).toEqual([]);
      }
      await expect.poll(() => players.some(peer => peer.traffic.snapshot.engine.actions.includes('play_card'))).toBe(true);
    } finally {
      for (const peer of players) await peer.context.close();
    }
  });
}

test('two yes answers reveal the original cards before play and leave the live trick clear', async ({ browser, baseURL }) => {
  const mobile = { newContext: options => browser.newContext({ ...options,
    viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(mobile, baseURL));
    await create(players, { count: 4, target: 11 });
    await action(players, 'bloedeln_accept');
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_consent.decisions
      .filter(choice => choice.accepted === true).length === 1)).toBe(true);
    await action(players, 'bloedeln_accept');
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.preplay.bloedeln_cards.length === 2)).toBe(true);
    for (const peer of players) await expect(peer.page.locator('[data-watten-bloedeln-cards] .wt-card')).toHaveCount(2);
    await action(players, 'show_ready'); await action(players, 'show_ready');
    await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
    await expect.poll(() => players.some(peer => peer.traffic.snapshot.engine.actions.includes('play_card'))).toBe(true);
    const actor = players.find(peer => peer.traffic.snapshot.engine.actions.includes('play_card'));
    const engine = actor.traffic.snapshot.engine;
    const forced = engine.preplay.bloedeln_cards.find(item => item.seat === engine.viewer.seat)?.card;
    const card = forced || engine.hand[0].card;
    await actor.page.locator(`[data-wt-hand] button[data-card="${card}"]`).click();
    for (const peer of players) {
      await expect(peer.page.locator('[data-wt-trick] [data-card]')).toHaveCount(1);
      await expect(peer.page.locator('[data-watten-bloedeln-cards]')).toHaveCount(0);
      expect(peer.traffic.errors).toEqual([]);
    }
  } finally { for (const peer of players) await peer.context.close(); }
});
