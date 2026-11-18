const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, action } = require('./helpers/watten-journey.cjs');

const large = { width: 1366, height: 1024 };
const small = { width: 1024, height: 768 };
const reference = '[data-watten-reference]';

async function geometry(page, viewport) {
  await page.setViewportSize(viewport);
  await expect.poll(() => page.evaluate(() => Math.abs(
    document.querySelector('[data-wt-felt]').getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1);
  return page.locator(reference).evaluate(figure => {
    const box = figure.getBoundingClientRect();
    const obstacles = document.querySelectorAll('.wt-trick-card, .wt-hand-card, .wt-backs > i:not([hidden]), .wt-seat-badge, .wt-taken-packet, .wt-stock, [data-wt-stake], .wt-panel button');
    const overlaps = [...obstacles].filter(node => {
      const other = node.getBoundingClientRect();
      return other.width && other.height && Math.min(box.right, other.right) > Math.max(box.left, other.left) + 1
        && Math.min(box.bottom, other.bottom) > Math.max(box.top, other.top) + 1;
    }).map(node => node.className);
    const hand = [...document.querySelectorAll('.wt-hand-card')].map(card => card.getBoundingClientRect());
    const trick = [...document.querySelectorAll('.wt-trick-card, .wt-trick-label')].map(node => node.getBoundingClientRect());
    const handGap = Math.min(...hand.map(card => card.top)) - Math.max(...trick.map(node => node.bottom));
    return { width: figure.querySelector('.wt-card').getBoundingClientRect().width, overlaps, handGap,
      visible: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight };
  });
}

for (const count of [2, 3, 4]) {
  test(`tablet reference at ${count} seats stays legible and mounted as the trick grows`, async ({ browser, baseURL }, info) => {
    test.setTimeout(90_000);
    const players = [];
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport: large, serviceWorkers: 'block' }) };
    try {
      for (let seat = 0; seat < count; seat++) players.push(await player(wrapped, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
      await create(players, { target: 15, determination: 'normal', reference: true });
      await normalCall(players);
      const page = players[0].page;
      const face = page.locator(`${reference} .wt-card`);
      await expect(face).toHaveAttribute('data-card', 'bells-7');
      const initial = await page.locator(reference).evaluateHandle(figure => ({
        figure, face: figure.querySelector('.wt-card'), clip: figure.querySelector('clipPath'), clipId: figure.querySelector('clipPath').id,
        hand: new Map([...document.querySelectorAll('[data-wt-hand] button')].map(node => [node.dataset.card, node])),
        trick: new Map(),
      }));
      for (let played = 1; played <= count; played++) {
        await playOne(players);
        await expect(page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(played);
        const stable = await page.evaluate(previous => {
          const figure = document.querySelector('[data-watten-reference]');
          const cards = [...document.querySelectorAll('[data-wt-trick] > .wt-trick-card')];
          const trick = cards.every(node => !previous.trick.has(node.dataset.card) || previous.trick.get(node.dataset.card) === node);
          for (const node of cards) previous.trick.set(node.dataset.card, node);
          return { figure: figure === previous.figure, face: figure.querySelector('.wt-card') === previous.face,
            clip: figure.querySelector('clipPath') === previous.clip && previous.clip.id === previous.clipId
              && figure.querySelector('g').getAttribute('clip-path') === `url(#${previous.clipId})`, trick,
            hand: [...document.querySelectorAll('[data-wt-hand] button')].every(node => previous.hand.get(node.dataset.card) === node) };
        }, initial);
        expect(stable).toEqual({ figure: true, face: true, clip: true, trick: true, hand: true });
      }
      for (const viewport of [large, small]) {
        const layout = await geometry(page, viewport);
        await info.attach(`reference-${viewport.width}x${viewport.height}.json`, { body: JSON.stringify(layout), contentType: 'application/json' });
        expect(layout.visible).toBe(true);
        expect(layout.handGap).toBeGreaterThanOrEqual(0);
        expect(layout.width).toBeGreaterThanOrEqual(viewport.width === 1366 ? 80 : 70);
        expect(layout.overlaps, JSON.stringify({ count, viewport })).toEqual([]);
      }
      if (count === 2) {
        await action(players, 'bid');
        await action(players, 'respond_go', 'go');
        const review = page.locator('[data-watten-round-call] .wt-card');
        await expect(review).toBeVisible();
        expect((await review.boundingBox()).width).toBeGreaterThanOrEqual(60);
        await action(players, 'announce_strike', '8');
        await expect(page.locator(reference)).toHaveCount(0);
        await action(players, 'announce_colour', 'hearts');
        await expect(face).toHaveAttribute('data-card', 'hearts-8');
      }
      await initial.dispose();
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}

test('blind tablet partners see the back at the same size as the callers’ reference', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const players = [];
  const wrapped = { newContext: options => browser.newContext({ ...options, viewport: large, serviceWorkers: 'block' }) };
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    await create(players, { reference: true });
    await action(players, 'show_ready');
    await action(players, 'show_ready');
    await action(players, 'inspection_ack');
    await action(players, 'inspection_ack');
    await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.phase === 'play')).toBe(true);
    const widths = [];
    const visible = players.filter(peer => peer.traffic.snapshot.engine.reference_card.face === 'card');
    expect(visible).toHaveLength(2);
    for (const peer of players) {
      const face = peer.page.locator(`${reference} .wt-card`);
      await expect(face).toBeVisible();
      if (visible.includes(peer)) await expect(face).toHaveAttribute('data-card', peer.traffic.snapshot.engine.reference_card.card);
      else {
        await expect(face).toHaveClass(/wt-card--back/);
        await expect(face.locator('svg')).toHaveCount(0);
        expect(await face.getAttribute('data-card')).toBeNull();
      }
      widths.push((await face.boundingBox()).width);
    }
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(80);
    expect(new Set(widths).size).toBe(1);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
