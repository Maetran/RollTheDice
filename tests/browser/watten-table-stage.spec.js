const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectFixedTable, expectReachable } = require('./table-viewport');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');

// Each case creates up to four real accounts and checks four viewport sizes
// before and during a bid. Keep individual assertions at their normal timeout.
test.setTimeout(90_000);

const VIEWPORTS = [{ width: 390, height: 844 }, { width: 568, height: 320 }, { width: 1280, height: 800 }, { width: 320, height: 568 }];
const gameBrowser = browser => ({ newContext: options => browser.newContext({ ...options,
  viewport: VIEWPORTS[0], serviceWorkers: 'block' }) });

async function settled(players, phase) {
  await expect.poll(() => {
    const first = players[0].traffic.snapshot;
    return players.every(item => item.traffic.snapshot?.id === first?.id
      && item.traffic.snapshot?.engine?.phase === phase
      && item.traffic.snapshot?.engine?.opportunity === first?.engine?.opportunity);
  }).toBe(true);
  for (const item of players) await expect(item.page.locator('[data-wt-table]')).toHaveAttribute('data-phase', phase);
}

async function expectStage(item, count) {
  const { page, traffic } = item;
  await expect(page.locator('html')).toHaveAttribute('data-watten-active', 'true');
  await expect(page.locator('[data-wt-seat]')).toHaveCount(count);
  const engine = traffic.snapshot.engine;
  const ownSeat = engine.viewer.seat;
  const backCount = engine.seats.filter(seat => seat.seat !== ownSeat).reduce((sum, seat) => sum + seat.card_count, 0);
  await expect(page.locator('.wt-backs > i:not([hidden])')).toHaveCount(backCount);
  await expect(page.locator('[data-wt-hand] button')).toHaveCount(engine.hand.length);
  await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-panel]', '[data-wt-hand-area]']);
  await expect.poll(() => page.evaluate(() => {
    const violations = [];
    const rect = node => node.getBoundingClientRect();
    const intersects = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    const shown = node => rect(node).width > 0 && rect(node).height > 0;
    const label = node => node.matches('.wt-backs > i') ? `opponent card at seat ${node.closest('[data-wt-seat]').dataset.wtSeat}`
      : node.getAttribute('data-wt-card') || node.className;
    const cards = [...document.querySelectorAll('.wt-backs > i:not([hidden]), [data-wt-hand] button, .wt-trick-card')].filter(shown);
    for (const node of cards) {
      const box = rect(node);
      if (box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) {
        violations.push(`${label(node)} outside viewport`);
      }
      // A fan may intentionally overlap its own cards, but no clipping
      // ancestor may cut off any rotated card or its outer corners.
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor), bounds = rect(ancestor);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX)
          && (box.left < bounds.left - 1 || box.right > bounds.right + 1)) violations.push(`${label(node)} clipped horizontally`);
        if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)
          && (box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1)) violations.push(`${label(node)} clipped vertically`);
      }
    }
    for (const name of document.querySelectorAll('.wt-seat-name')) {
      const box = rect(name);
      if (box.left < -1 || box.right > innerWidth + 1) violations.push(`seat ${name.closest('[data-wt-seat]').dataset.wtSeat} name outside ${innerWidth}x${innerHeight}: ${box.left}–${box.right}`);
    }
    const protectedAreas = [...document.querySelectorAll('[data-wt-hand-area], [data-wt-panel], [data-wt-private] button, .wt-trick-card')].filter(shown);
    for (const back of document.querySelectorAll('.wt-backs > i:not([hidden])')) {
      const box = rect(back);
      const overlaps = protectedAreas.filter(area => intersects(box, rect(area)));
      if (overlaps.length) violations.push(`${label(back)} overlaps ${overlaps.map(area => area.className || area.tagName).join(', ')} at ${innerWidth}x${innerHeight}`);
      const seat = back.closest('[data-wt-seat]');
      if ([...seat.querySelectorAll('.wt-seat-name, .wt-seat-tags, .wt-seat-meta')].filter(shown)
        .some(name => intersects(box, rect(name)))) violations.push(`${label(back)} covered by seat label`);
    }
    return [...new Set(violations)];
  }), { message: 'all five-card opponent fans and the own hand remain complete and clear' }).toEqual([]);

  for (const selector of ['[data-wt-hand] button:first-child', '[data-wt-panel]']) await expectReachable(page, selector);
  for (const control of await page.locator('[data-wt-panel] button, [data-wt-private] button, [data-wt-tools] button').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await expectReachable(page, await control.evaluate(node => {
      // Existing commands have stable public action identifiers, not test IDs.
      const attribute = node.hasAttribute('data-watten-action') ? 'data-watten-action' : 'data-watten-command';
      const value = node.getAttribute(attribute);
      const kind = node.getAttribute('data-value');
      return `[${attribute}="${value}"]${kind === null ? '' : `[data-value="${kind}"]`}`;
    }));
  }
  await expectTableHeaderReachable(page);
}

for (const language of ['de', 'en']) {
  for (const count of [2, 3, 4]) {
    test(`${language}: ${count} real humans keep complete fans and bid decisions on one fixed table`, async ({ browser, baseURL }, testInfo) => {
      const players = [];
      try {
        for (let index = 0; index < count; index += 1) players.push(await player(gameBrowser(browser), baseURL, language));
        await create(players, { determination: 'normal', target: 15 });
        await normalCall(players);
        await settled(players, 'play');
        for (const viewport of VIEWPORTS) {
          for (const item of players) {
            await item.page.setViewportSize(viewport);
            await expect(item.page.locator('html')).toHaveAttribute('lang', language);
            await expectStage(item, count);
          }
        }
        await playOne(players);
        await settled(players, 'play');
        await action(players, 'bid');
        await settled(players, 'bid_response');
        const before = players.map(item => ({ hand: item.traffic.snapshot.engine.hand,
          opportunity: item.traffic.snapshot.engine.opportunity, pending: item.traffic.snapshot.engine.bid.pending,
          seat: item.traffic.snapshot.viewer.seat, participant: item.traffic.snapshot.viewer.participant_id }));
        for (const item of players) await item.page.evaluate(() => {
          window.stageHandNodes = [...document.querySelectorAll('[data-wt-hand] button')];
        });
        const decider = players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
        expect(decider).toBeTruthy();
        for (const viewport of VIEWPORTS) {
          for (const [index, item] of players.entries()) {
            await item.page.setViewportSize(viewport);
            await expectStage(item, count);
            expect(item.traffic.snapshot.engine.opportunity).toBe(before[index].opportunity);
            expect(item.traffic.snapshot.engine.bid.pending).toEqual(before[index].pending);
            expect(await item.page.evaluate(() => window.stageHandNodes.every((node, position) =>
              node === document.querySelectorAll('[data-wt-hand] button')[position]))).toBe(true);
          }
          await expect(decider.page.locator('[data-watten-bid] [data-kind="respond"]')).toHaveCount(3);
          for (const response of await decider.page.locator('[data-watten-bid] [data-kind="respond"]').all()) await expect(response).toBeEnabled();
          await decider.page.screenshot({ path: testInfo.outputPath(`table-bid-${language}-${count}-${viewport.width}x${viewport.height}.png`) });
        }
        // A real reconnect must hydrate this same frozen bid and hand. Observe
        // a NEW socket frame, rather than accepting the collector's old state.
        const rejoined = [];
        const id = decider.traffic.snapshot.id;
        const onSocket = socket => {
          if (new URL(socket.url()).pathname !== `/ws/${id}`) return;
          socket.on('framereceived', frame => {
            const message = JSON.parse(String(frame.payload));
            if (message.scoreboard?.id === id) rejoined.push(message.scoreboard);
          });
        };
        decider.page.on('websocket', onSocket);
        try {
          await decider.page.reload();
          await expect.poll(() => rejoined.some(snapshot => snapshot.viewer?.participant_id === before[players.indexOf(decider)].participant)).toBe(true);
          await expectStage(decider, count);
          const original = before[players.indexOf(decider)];
          expect(decider.traffic.snapshot.engine.hand).toEqual(original.hand);
          expect(decider.traffic.snapshot.engine.opportunity).toBe(original.opportunity);
          expect(decider.traffic.snapshot.engine.bid.pending).toEqual(original.pending);
          expect(decider.traffic.snapshot.viewer.seat).toBe(original.seat);
          await expect(decider.page.locator('[data-watten-action="respond_hold"]')).toBeEnabled();
          await action(players, 'respond_hold', 'hold');
          await settled(players, 'play');
        } finally { decider.page.off('websocket', onSocket); }
        expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
      } finally { await Promise.allSettled(players.map(item => item.context.close())); }
    });
  }
}

test('normal motion: an actual completed trick travels to its winner, who leads the next card', async ({ browser, baseURL }) => {
  const players = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const item = await player(gameBrowser(browser), baseURL, index ? 'en' : 'de');
      await item.page.emulateMedia({ reducedMotion: 'no-preference' });
      await item.page.setViewportSize({ width: 1280, height: 800 });
      players.push(item);
    }
    await create(players, { target: 15 });
    await normalCall(players);
    await settled(players, 'play');
    await playOne(players);
    await settled(players, 'play');
    const viewer = players[0];
    await viewer.page.evaluate(() => {
      // Pause only this real presentation animation at creation, so protocol
      // polling cannot outrun the geometry measurement on a busy test machine.
      // Server state, WebSockets and every other animation remain genuine.
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const animation = animate.apply(this, args);
        if (this.matches('[data-wt-motion="collect"]')) animation.pause();
        return animation;
      };
    });
    const collecting = viewer.page.waitForSelector('[data-wt-motion="collect"]', { state: 'visible' });
    await playOne(players);
    await settled(players, 'play');
    const last = viewer.traffic.snapshot.engine.last_trick;
    expect(last.cards).toHaveLength(2);
    const collection = await collecting;
    expect(await collection.getAttribute('data-target-seat')).toBe(String(last.winner));
    const geometry = await collection.evaluate(node => {
      const animation = node.getAnimations()[0];
      if (!animation) throw new Error('The real collecting wrapper has no animation');
      const center = element => {
        const box = element.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      };
      // Inspect the actual WAAPI endpoints deterministically, not a fake engine
      // event or a wall-clock sleep. Finishing resumes the real cleanup path.
      animation.pause();
      const duration = animation.effect.getComputedTiming().activeDuration;
      animation.currentTime = 0;
      const from = center(node), trick = center(document.querySelector('[data-wt-trick]'));
      animation.currentTime = duration;
      const to = center(node);
      const target = center(document.querySelector(`[data-wt-catch="${node.dataset.targetSeat}"]`));
      animation.finish();
      return { from, to, trick, target, duration };
    });
    expect(geometry.duration).toBeGreaterThan(0);
    expect(Math.hypot(geometry.from.x - geometry.trick.x, geometry.from.y - geometry.trick.y)).toBeLessThanOrEqual(3);
    expect(Math.hypot(geometry.to.x - geometry.target.x, geometry.to.y - geometry.target.y)).toBeLessThanOrEqual(3);
    expect(Math.hypot(geometry.from.x - geometry.to.x, geometry.from.y - geometry.to.y)).toBeGreaterThan(20);
    await expect(viewer.page.locator('[data-wt-motion="collect"]')).toHaveCount(0);
    const next = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
    expect(next.traffic.snapshot.viewer.seat).toBe(last.winner);
    expect(players.every(item => item.traffic.snapshot.engine.card_turn === last.winner)).toBe(true);
    await expect(next.page.locator(`[data-wt-seat="${last.winner}"]`)).toHaveClass(/is-turn/);
    await playOne(players);
    await settled(players, 'play');
    expect(viewer.traffic.snapshot.engine.current_trick.cards).toEqual([
      expect.objectContaining({ seat: last.winner }),
    ]);
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const count of [3, 4]) {
  test(`${count}: an optional open partner hand stays clear of the own hand in small landscape`, async ({ browser, baseURL }) => {
    const players = [];
    try {
      for (let index = 0; index < count; index += 1) players.push(await player(gameBrowser(browser), baseURL));
      await create(players, { determination: 'normal', partnerHand: true, target: 15 });
      await normalCall(players);
      await settled(players, 'play');
      const partner = players.find(item => item.traffic.snapshot.engine.partner_hand?.cards.length === 5);
      expect(partner).toBeTruthy();
      for (const viewport of [VIEWPORTS[1], VIEWPORTS[0], VIEWPORTS[3], { width: 390, height: 600 }, { width: 760, height: 600 }]) {
        await partner.page.setViewportSize(viewport);
        await expectStage(partner, count);
        const details = partner.page.locator('.wt-partner-hand');
        if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
        await expect(partner.page.locator('.wt-partner-popover')).toBeVisible();
        await expect(partner.page.locator('.wt-partner-popover .wt-card')).toHaveCount(5);
        expect(await partner.page.locator('[data-wt-hand] button').evaluateAll(nodes => nodes.every(node => {
          const rect = node.getBoundingClientRect();
          return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
        }))).toBe(true);
      }
      await playOne(players);
      await expect(partner.page.locator('.wt-partner-hand')).toHaveAttribute('open', '');
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
