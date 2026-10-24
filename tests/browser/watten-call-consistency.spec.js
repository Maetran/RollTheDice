const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');

test.setTimeout(120_000);

async function inspection(players) {
  for (let count = 0; count < 2; count++) {
    await expect.poll(() => players.some(peer => peer.traffic.snapshot.engine.actions.includes('show_ready'))).toBe(true);
    const caller = players.find(peer => peer.traffic.snapshot.engine.actions.includes('show_ready'));
    const before = caller.traffic.snapshot.engine.opportunity;
    // Exercise native keyboard activation independently of table hit geometry,
    // which has its own pointer/rotation regressions.
    await caller.page.locator('[data-watten-action=show_ready]').press('Enter');
    await expect.poll(() => caller.traffic.snapshot.engine.opportunity).not.toBe(before);
  }
  await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'inspection')).toBe(true);
  const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('inspection_ack'));
  expect(callers).toHaveLength(2);
  const engine = callers[0].traffic.snapshot.engine;
  const cards = structuredClone(engine.inspection.cards);
  const strike = cards.find(card => card.role === 'strike').card;
  const colour = cards.find(card => card.role === 'colour').card;
  const strikeRank = strike === 'bells-6' ? 'weli' : strike.split('-')[1];
  const trumpSuit = colour.split('-')[0];
  const expected = { strike_rank: strikeRank, trump_suit: trumpSuit,
    rechter: strikeRank === 'weli' ? 'bells-6' : `${trumpSuit}-${strikeRank}` };
  for (const caller of callers) {
    expect(caller.traffic.snapshot.engine.deal_id).toBe(engine.deal_id);
    expect(caller.traffic.snapshot.engine.inspection.cards).toEqual(cards);
    for (const shown of cards) {
      const face = caller.page.locator(`.wt-reveal-card--${shown.role} .wt-card`);
      await expect(face).toHaveAttribute('data-card', shown.card);
      await expect(face.locator('svg image')).toHaveCount(1);
    }
  }
  return { callers, cards, expected, dealId: engine.deal_id, revision: engine.deal_revision };
}

for (const language of ['de', 'en']) {
  test(`${language}: displayed inspection sources, redraw, reload and next deal stay bound to their own final call`, async ({ browser, baseURL }) => {
    const players = [];
    const configured = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(configured, baseURL, language));
      await create(players, { target: 15, reference: true, schoeneres: true });
      let previousDeal = null;
      for (let round = 0; round < 2; round++) {
        await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'show_ready'
          && peer.traffic.snapshot.engine.deal_id !== previousDeal), { timeout: 10_000 }).toBe(true);
        for (const peer of players) {
          expect(peer.traffic.snapshot.engine.round_summary).toBeUndefined();
          await expect(peer.page.locator('[data-watten-round-call]')).toHaveCount(0);
        }
        let shown = await inspection(players);
        if (round === 1) {
          // A same-deal redeal must retire its prior source faces, not reuse them.
          const requester = players.find(peer => peer.traffic.snapshot.engine.actions.includes('request_schoeneres'));
          await requester.page.locator('[data-watten-preplay-options] > summary').press('Enter');
          const before = requester.traffic.snapshot.engine.opportunity;
          await requester.page.locator('[data-watten-action=request_schoeneres]').press('Enter');
          await expect.poll(() => requester.traffic.snapshot.engine.opportunity).not.toBe(before);
          await action(players, 'preplay_accept');
          await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'show_ready'
            && peer.traffic.snapshot.engine.deal_revision === shown.revision + 1)).toBe(true);
          for (const peer of players) await expect(peer.page.locator('[data-watten-inspection]')).toHaveCount(0);
          shown = await inspection(players);
        }
        const returning = shown.callers[0];
        await returning.page.reload();
        await expect(returning.page.locator('[data-watten-action=inspection_ack]')).toBeVisible();
        await returning.page.setViewportSize({ width: 852, height: 393 });
        for (const card of shown.cards) {
          await expect(returning.page.locator(`.wt-reveal-card--${card.role} .wt-card`)).toHaveAttribute('data-card', card.card);
        }
        await action(players, 'inspection_ack');
        await action(players, 'inspection_ack');
        await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
        for (const caller of shown.callers) {
          expect(caller.traffic.snapshot.engine.deal_id).toBe(shown.dealId);
          expect(caller.traffic.snapshot.engine.reference_card).toEqual({ face: 'card', card: shown.expected.rechter });
          await expect(caller.page.locator('[data-watten-reference] .wt-card')).toHaveAttribute('data-card', shown.expected.rechter);
          await expect(caller.page.locator('[data-watten-round-call]')).toHaveCount(0);
        }
        // Finishing by an accepted bid response isolates summary binding from
        // card choice; exhaustive backend games separately audit trick scoring.
        await action(players, 'bid');
        await action(players, 'respond_go', 'go');
        await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'deal_complete')).toBe(true);
        for (const peer of players) {
          expect(peer.traffic.snapshot.engine.deal_id).toBe(shown.dealId);
          expect(peer.traffic.snapshot.engine.round_summary).toEqual(shown.expected);
        }
        // The real three-second review paints this call, then retires it before
        // the following deal's inspection. Inspect while that review is visible.
        const review = returning.page.locator('[data-watten-round-call]');
        await expect(review).toBeVisible({ timeout: 5000 });
        await expect(review.locator('.wt-card')).toHaveAttribute('data-card', shown.expected.rechter);
        previousDeal = shown.dealId;
      }
      expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
