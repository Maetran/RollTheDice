const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, action } = require('./helpers/watten-journey.cjs');

test.setTimeout(60_000);

async function finishDeal(players) {
  for (let card = 0; card < 10 && players[0].traffic.snapshot.engine.phase === 'play'; card += 1) await playOne(players);
  await expect.poll(() => ['deal_complete', 'match_complete'].includes(players[0].traffic.snapshot.engine.phase)).toBe(true);
}

test('a completed deal collects its trick, reviews the call for three seconds and deals again without a host command', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL, 'en')];
  try {
    await create(players, { count: 2, target: 11 });
    await normalCall(players);
    const deal = players[0].traffic.snapshot.engine.deal_id;
    await finishDeal(players);
    expect(players[0].traffic.snapshot.engine.phase).toBe('deal_complete');
    await expect(players[0].page.locator('[data-watten-round-call]')).toBeHidden();
    await expect(players[0].page.locator('[data-watten-round-call]')).toBeVisible({ timeout: 5000 });
    const visibleAt = Date.now();
    for (const item of players) {
      await expect(item.page.locator('[data-wt-trick]')).toBeHidden();
      await expect(item.page.locator('[data-wt-motion="collect"]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command="next-deal"]')).toHaveCount(0);
    }
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.deal_id !== deal), { timeout: 6000 }).toBe(true);
    expect(Date.now() - visibleAt).toBeGreaterThanOrEqual(2400);
    for (const item of players) {
      await expect(item.page.locator('[data-wt-hand] [data-wt-card]')).toHaveCount(5);
      expect(item.traffic.commands.some(message => message.action === 'watten_next_deal')).toBe(false);
      expect(item.traffic.snapshot.engine.round_summary).toBeUndefined();
    }
  } finally { await Promise.all(players.map(item => item.context.close())); }
});

for (const reducedMotion of ['no-preference', 'reduce']) {
  test(`match result follows collection and call review without overlap (${reducedMotion})`, async ({ browser, baseURL }) => {
    const configured = { newContext: options => browser.newContext({ ...options, reducedMotion }) };
    const players = [await player(configured, baseURL), await player(configured, baseURL, 'en')];
    try {
      await create(players, { count: 2, target: 3 });
      await normalCall(players);
      await playOne(players); await action(players, 'bid'); await action(players, 'respond_hold', 'hold');
      await players[0].page.evaluate(() => {
        window.roundPresentationEvents = [];
        let last = '';
        const read = () => {
          const visible = selector => { const node = document.querySelector(selector); return !!node && node.getClientRects().length > 0; };
          const event = { t: performance.now(), collect: document.querySelectorAll('[data-wt-motion="collect"]').length,
            call: visible('[data-watten-round-call]'), result: visible('[data-watten-match-result]') };
          const signature = `${event.collect}|${event.call}|${event.result}`;
          if (signature !== last) { window.roundPresentationEvents.push(event); last = signature; }
        };
        new MutationObserver(read).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'style'] });
        read();
      });
      await finishDeal(players);
      await expect(players[0].page.locator('[data-watten-match-result]')).toBeHidden();
      await expect(players[0].page.locator('[data-watten-round-call]')).toBeVisible({ timeout: 5000 });
      await expect(players[0].page.locator('[data-watten-match-result]')).toBeHidden();
      await expect(players[0].page.locator('[data-wt-motion="collect"]')).toHaveCount(0);
      await expect(players[0].page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 5000 });
      const events = await players[0].page.evaluate(() => window.roundPresentationEvents);
      expect(events.some(event => event.result && event.collect > 0)).toBe(false);
      const call = events.find(event => event.call && !event.result), result = events.find(event => event.result);
      expect(call).toBeTruthy(); expect(result.t - call.t).toBeGreaterThanOrEqual(2400);
    } finally { await Promise.all(players.map(item => item.context.close())); }
  });
}
