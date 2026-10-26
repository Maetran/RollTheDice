const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, action } = require('./helpers/watten-journey.cjs');

test.setTimeout(60_000);

async function finishDeal(players) {
  for (let card = 0; card < 10 && players[0].traffic.snapshot.engine.phase === 'play'; card += 1) {
    await playOne(players);
    await expect.poll(() => new Set(players.map(item => item.traffic.snapshot.engine.opportunity)).size).toBe(1);
  }
  await expect.poll(() => players.every(item => ['deal_complete', 'match_complete'].includes(item.traffic.snapshot.engine.phase))).toBe(true);
}

async function expectOwnReviewHand(item) {
  const expected = item.traffic.snapshot.engine.hand.map(card => card.card).sort();
  const cards = item.page.locator('[data-wt-hand] button[data-card]');
  await expect(item.page.locator('[data-wt-table]')).toHaveAttribute('data-round-stage', 'review');
  await expect(item.page.locator('[data-watten-round-call]')).toBeVisible();
  await expect(cards).toHaveCount(expected.length);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.card).sort())).toEqual(expected);
  await expect(item.page.locator('[data-wt-hand] button:enabled')).toHaveCount(0);
  if (!expected.length) {
    // A fifth trick can exhaust both hands; no earlier played face is restored.
    await expect(item.page.locator('[data-wt-hand-area]')).toBeHidden();
  } else {
    await expect(item.page.locator('[data-wt-hand-area]')).toBeVisible();
    await Promise.all(expected.map(card => expect(item.page.locator(`[data-wt-hand] button[data-card="${card}"]`)).toBeVisible()));
  }
  const errors = await item.page.evaluate(() => {
    const errors = [];
    const call = document.querySelector('[data-watten-round-call]'), callBox = call.getBoundingClientRect();
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    // Visibility alone accepts an overflowing section whose lower text and
    // Rechter caption are clipped by the action panel. Check its whole content.
    for (const node of [call, ...call.querySelectorAll('dt, dd, .wt-card, figcaption')]) {
      const box = node.getBoundingClientRect(), label = node.className || node.tagName;
      if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) {
        errors.push({ call: label, issue: 'outside viewport', box: box.toJSON() });
      }
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), clip = ancestor.getBoundingClientRect();
        const left = clip.left + ancestor.clientLeft, top = clip.top + ancestor.clientTop;
        const clipsX = style.overflowX !== 'visible', clipsY = style.overflowY !== 'visible';
        if (clipsX && (box.left < left - 1 || box.right > left + ancestor.clientWidth + 1)
          || clipsY && (box.top < top - 1 || box.bottom > top + ancestor.clientHeight + 1)) {
          errors.push({ call: label, issue: 'clipped by ancestor', ancestor: ancestor.className,
            box: box.toJSON(), clip: clip.toJSON() });
        }
      }
    }
    for (const card of document.querySelectorAll('[data-wt-hand] button[data-card]')) {
      const box = card.getBoundingClientRect();
      if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) {
        errors.push({ card: card.dataset.card, issue: 'outside viewport', box: box.toJSON() });
      }
      if (intersects(box, callBox)) errors.push({ card: card.dataset.card, issue: 'overlaps call', box: box.toJSON(), call: callBox.toJSON() });
      const covering = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      if (!card.contains(covering)) errors.push({ card: card.dataset.card, issue: 'covered center', covering: covering?.className });
    }
    return errors;
  });
  expect(errors, 'remaining own faces and the complete call stay exposed during review').toEqual([]);
}

async function expectFreshHand(item) {
  const cards = item.page.locator('[data-wt-hand] button[data-card]');
  await expect(cards).toHaveCount(5);
  expect(await cards.evaluateAll(nodes => nodes.map(node => node.dataset.card).sort()))
    .toEqual(item.traffic.snapshot.engine.hand.map(card => card.card).sort());
  expect(item.traffic.commands.some(message => message.action === 'watten_next_deal')).toBe(false);
  expect(item.traffic.snapshot.engine.round_summary).toBeUndefined();
  await expect(item.page.locator('[data-watten-round-call]')).toHaveCount(0);
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
    await Promise.all(players.map(expectOwnReviewHand));
    for (const item of players) {
      await expect(item.page.locator('[data-wt-trick]')).toBeHidden();
      await expect(item.page.locator('[data-wt-motion="collect"]')).toHaveCount(0);
      await expect(item.page.locator('[data-watten-command="next-deal"]')).toHaveCount(0);
    }
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.deal_id !== deal), { timeout: 6000 }).toBe(true);
    expect(Date.now() - visibleAt).toBeGreaterThanOrEqual(2400);
    await Promise.all(players.map(expectFreshHand));
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
      await Promise.all(players.map(expectOwnReviewHand));
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

for (const { viewport, count } of [
  { viewport: { width: 320, height: 568 }, count: 2 },
  { viewport: { width: 568, height: 320 }, count: 2 },
  { viewport: { width: 768, height: 1024 }, count: 4 },
  { viewport: { width: 1024, height: 768 }, count: 4 },
  { viewport: { width: 1440, height: 900 }, count: 2 },
]) {
  test(`going keeps only each own remaining hand beside the call (${viewport.width}x${viewport.height})`, async ({ browser, baseURL }, info) => {
    const configured = { newContext: options => browser.newContext({ ...options, viewport }) };
    const players = [];
    let spectator;
    try {
      for (let seat = 0; seat < count; seat += 1) players.push(await player(configured, baseURL, seat % 2 ? 'en' : 'de'));
      const path = await create(players, { target: 11, determination: 'normal' });
      if (viewport.width === 320) {
        spectator = await player(configured, baseURL);
        await spectator.page.goto(`${path}/zuschauen`);
        await expect(spectator.page.locator('[data-wt-table]')).toHaveAttribute('data-viewer', 'spectator');
        await expect.poll(() => spectator.traffic.snapshot?.engine?.deal_id).toBe(players[0].traffic.snapshot.engine.deal_id);
      }
      await normalCall(players);
      await playOne(players);
      await expect.poll(() => new Set(players.map(item => item.traffic.snapshot.engine.opportunity)).size).toBe(1);
      const deal = players[0].traffic.snapshot.engine.deal_id;
      const before = players.map(item => item.traffic.snapshot.engine.hand.map(card => card.card).sort());
      await action(players, 'bid');
      await action(players, 'respond_go', 'go');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'deal_complete')).toBe(true);
      players.forEach((item, index) => {
        expect(item.traffic.snapshot.engine.hand.map(card => card.card).sort()).toEqual(before[index]);
        expect(item.traffic.snapshot.engine.hand.length).toBeGreaterThanOrEqual(4);
        expect(item.traffic.snapshot.engine.bid.result.reason).toBe('go');
      });
      await expect(players[0].page.locator('[data-watten-round-call]')).toBeVisible({ timeout: 5000 });
      await Promise.all(players.map(expectOwnReviewHand));
      await players[0].page.screenshot({ path: info.outputPath(`own-hand-round-review-${viewport.width}x${viewport.height}.png`) });
      if (spectator) {
        await expect(spectator.page.locator('[data-watten-round-call]')).toBeVisible();
        expect(spectator.traffic.snapshot.engine).not.toHaveProperty('hand');
        expect(spectator.traffic.snapshot.engine).not.toHaveProperty('partner_hand');
        await expect(spectator.page.locator('[data-wt-hand] [data-card]')).toHaveCount(0);
        await expect(spectator.page.locator('[data-wt-hand-area]')).toBeHidden();
      }
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.deal_id !== deal), { timeout: 6000 }).toBe(true);
      // Four-seat noncallers receive backs until the next normal call is made.
      await normalCall(players);
      await Promise.all(players.map(expectFreshHand));
      expect([...players, spectator].filter(Boolean).flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled([...players, spectator].filter(Boolean).map(item => item.context.close())); }
  });
}
