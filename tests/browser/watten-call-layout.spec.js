const { test, expect } = require('@playwright/test');
const { writeFile } = require('node:fs/promises');
const { player, create, action, answerPartnerFeedback, playOne } = require('./helpers/watten-journey.cjs');

const PORTRAITS = [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 390, height: 844 }];

async function settleCalls(page) {
  await page.clock.runFor(100);
  // The fake clock controls the 5200ms product deadline, not CSS animation
  // timelines. Hold the native chip animation in its readable plateau.
  await page.evaluate(() => {
    for (const node of document.querySelectorAll('[data-watten-call]')) for (const animation of node.getAnimations()) {
      animation.pause();
      animation.currentTime = 400;
    }
  });
}

async function resize(page, viewport) {
  // Let native resize/compositor deliveries and the product's RAF run
  // together; pause again before the multi-viewport assertions/retire check.
  await page.clock.resume();
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect.poll(() => page.locator('[data-wt-felt]').evaluate((node, height) =>
    Math.abs(node.getBoundingClientRect().bottom - height) < 1, viewport.height)).toBe(true);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 10);
  await settleCalls(page);
}

async function geometry(page) {
  return page.evaluate(() => {
    const visible = node => node.checkVisibility() && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
    const box = node => node.getBoundingClientRect().toJSON();
    const own = document.querySelector('[data-wt-own-call] .wt-bubble');
    const dock = [...document.querySelectorAll('.wt-end-sheet > :not(.wt-own-call)')].filter(visible);
    const obstacles = [...new Set([...dock, ...document.querySelectorAll('[data-watten-call], .wt-seat-badge, .wt-avatar, .wt-seat-name, .wt-seat-call-role, .wt-seat-tags, .wt-seat-meta, '
      + '.wt-bubble--thanks, .wt-backs > i:not([hidden]), .wt-stock, .wt-reference, [data-wt-preplay], .wt-prompt, .wt-partner-popover, .wt-retour-tag')].filter(visible))];
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const ownBox = box(own);
    const calls = [...document.querySelectorAll('[data-watten-call]')].filter(visible);
    return {
      own: ownBox,
      table: document.querySelector('[data-wt-felt]').getBoundingClientRect().toJSON(),
      visibleOwn: [...document.querySelectorAll('.wt-bubble--bottom[data-watten-call]')].filter(visible).length,
      overlaps: obstacles.filter(node => node !== own).map(node => ({ class: node.className, box: box(node), area: overlap(ownBox, box(node)) })).filter(item => item.area > 0),
      calls: calls.map(node => ({ text: node.textContent, box: box(node), own: node === own,
        positioned: node.hasAttribute('data-wt-portrait-call') ? {
          actualLeft: node.offsetLeft, actualTop: node.offsetTop,
          expectedLeft: Number.parseFloat(node.style.getPropertyValue('--wt-call-left')),
          expectedTop: Number.parseFloat(node.style.getPropertyValue('--wt-call-top')) } : null,
        covered: obstacles.filter(other => other !== node).map(other => ({ class: other.className, area: overlap(box(node), box(other)) })).filter(item => item.area > 0) })),
      fallback: own.parentElement.dataset.wtCallFallback ?? null,
      fallbacks: [...document.querySelectorAll('[data-wt-call-fallback]')].map(node => node.dataset.wtCallFallback),
      slot: (() => {
        const node = own.parentElement, actual = box(node), sheet = box(node.parentElement);
        return { actual, sheet, transition: getComputedStyle(node).transitionProperty,
          expected: { left: sheet.left + Number.parseFloat(node.style.getPropertyValue('--wt-own-call-left')) - actual.width / 2,
            bottom: sheet.bottom - Number.parseFloat(node.style.getPropertyValue('--wt-own-call-bottom')) } };
      })(),
      pointer: [getComputedStyle(own.parentElement).pointerEvents, getComputedStyle(own).pointerEvents],
      capturesPointer: Boolean(document.elementFromPoint(ownBox.x + ownBox.width / 2, ownBox.y + ownBox.height / 2)?.closest('[data-wt-own-call]')),
    };
  });
}

async function expectOwnCall(page, measurements) {
  const result = await geometry(page);
  measurements.push({ viewport: page.viewportSize(), ...result });
  expect(result.visibleOwn).toBe(1);
  expect(result.overlaps).toEqual([]);
  expect(result.calls.flatMap(call => call.covered)).toEqual([]);
  for (const call of result.calls.filter(call => call.positioned)) {
    expect(Math.abs(call.positioned.actualLeft - call.positioned.expectedLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(call.positioned.actualTop - call.positioned.expectedTop)).toBeLessThanOrEqual(1);
  }
  expect(result.fallback).toBeNull();
  expect(result.fallbacks).toEqual([]);
  expect(result.slot.transition).toBe('none');
  expect(Math.abs(result.slot.actual.left - result.slot.expected.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.slot.actual.bottom - result.slot.expected.bottom)).toBeLessThanOrEqual(1);
  expect(result.pointer).toEqual(['none', 'none']);
  expect(result.capturesPointer).toBe(false);
  expect(result.own.x).toBeGreaterThanOrEqual(0);
  expect(result.own.right).toBeLessThanOrEqual((await page.viewportSize()).width);
  expect(result.own.y).toBeGreaterThanOrEqual(0);
  expect(result.own.y).toBeGreaterThanOrEqual(result.table.top);
  await expect(page.locator('[data-wt-own-call]')).toHaveAttribute('aria-hidden', 'true');
}

async function controlRects(page) {
  return page.locator('[data-wt-stake] button, [data-wt-panel] button, [data-wt-hand] button').evaluateAll(nodes => nodes
    .filter(node => node.checkVisibility())
    .map(node => ({ action: node.dataset.wattenAction || node.dataset.card || 'stake', rect: node.getBoundingClientRect().toJSON() })));
}

for (const language of ['de', 'en']) for (const { count, reference = false } of [{ count: 2 }, { count: 4 }, { count: 4, reference: true }]) {
  test(`${language}: ${count} real callers stay above the growing portrait bid dock${reference ? ' with reference' : ''}`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options, reducedMotion: reference ? 'no-preference' : options.reducedMotion, viewport: PORTRAITS[0], serviceWorkers: 'block' }) };
    const players = [];
    const measurements = [];
    try {
      for (let index = 0; index < count; index += 1) {
        const item = await player(wrapped, baseURL, language);
        await item.page.clock.install();
        players.push(item);
      }
      await create(players, { determination: 'normal', target: 15, reference });
      for (const { page } of players) {
        await page.evaluate(() => document.fonts.ready);
        await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 10);
      }
      const striker = await action(players, 'announce_strike', '7');
      await settleCalls(striker.page);
      await expectOwnCall(striker.page, measurements);
      const firstCall = await striker.page.locator('[data-wt-own-call] .wt-bubble').elementHandle();
      const colourer = await action(players, 'announce_colour', 'bells');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
      const callers = [...new Set([striker, colourer])];
      for (const { page } of callers) await settleCalls(page);
      expect(await firstCall.evaluate(node => node.isConnected)).toBe(true);
      const originalOverlaps = [];
      for (const { page } of callers) {
        await expectOwnCall(page, measurements);
        if (reference) {
          await page.evaluate(() => {
            for (const node of document.querySelectorAll('.wt-bubbles [data-watten-call]')) for (const animation of node.getAnimations()) animation.currentTime = 0;
          });
          await expectOwnCall(page, measurements);
          await settleCalls(page);
        }
        if (reference) continue;
        // The original bottom anchor intersects the real stake at 320px.
        const oldAnchor = await page.addStyleTag({ content: '.wt-own-call {display:none!important}.wt-bubbles>.wt-bubble--bottom {display:block!important}' });
        const oldOverlap = await page.evaluate(() => {
          const a = document.querySelector('.wt-bubbles .wt-bubble--bottom').getBoundingClientRect();
          const b = document.querySelector('[data-wt-stake]').getBoundingClientRect();
          return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        });
        originalOverlaps.push(oldOverlap);
        await oldAnchor.evaluate(node => node.remove());
      }
      measurements.push({ originalOverlaps });
      if (!reference) expect(Math.max(...originalOverlaps)).toBeGreaterThan(0);
      const portraits = reference ? [PORTRAITS[0], PORTRAITS[2]] : PORTRAITS;
      for (const viewport of portraits) for (const { page } of callers) {
        await resize(page, viewport);
        await expectOwnCall(page, measurements);
      }
      const shiftedOverlaps = [];
      for (const { page } of callers) {
        await resize(page, PORTRAITS[0]);
      }
      await action(players, 'bid');
      await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
      if (count === 4) {
        await answerPartnerFeedback(players, 'good');
        await expect(players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold')).page.locator('[data-watten-feedback-received]')).toBeVisible();
      }
      for (const { page } of callers) {
        if (reference) continue;
        const offset52 = await page.addStyleTag({ content: '.wt-own-call {display:none!important}.wt-bubbles>.wt-bubble--bottom {display:block!important;bottom:52px!important}' });
        const covered = await page.evaluate(() => {
          const a = document.querySelector('.wt-bubbles .wt-bubble--bottom').getBoundingClientRect();
          const b = document.querySelector('[data-wt-panel]').getBoundingClientRect();
          return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        });
        shiftedOverlaps.push(covered);
        await offset52.evaluate(node => node.remove());
      }
      measurements.push({ shiftedOverlaps });
      if (!reference) expect(Math.max(...shiftedOverlaps)).toBeGreaterThan(0);
      for (const viewport of portraits) for (const { page } of callers) {
        await resize(page, viewport);
        await expectOwnCall(page, measurements);
        if (viewport.width === 320) await page.screenshot({ path: info.outputPath(`bid-${language}-${count}-320-${page === callers[0].page ? 'first' : 'second'}.png`) });
      }
      await callers[0].page.screenshot({ path: info.outputPath(`bid-${language}-${count}-390.png`) });
      for (const viewport of [{ width: 568, height: 320 }, { width: 1280, height: 800 }]) for (const { page } of callers) {
        await resize(page, viewport);
        await expect(page.locator('[data-wt-own-call]')).toBeHidden();
        await expect(page.locator('.wt-bubbles .wt-bubble--bottom')).toBeVisible();
        expect(await page.locator('[data-wt-own-call]').evaluate(node => node.style.cssText)).toBe('');
        await expect(page.locator('[data-wt-own-call]')).not.toHaveAttribute('data-wt-call-fallback');
      }
      for (const { page } of callers) {
        await resize(page, PORTRAITS[0]);
        await expectOwnCall(page, measurements);
      }
      await resize(callers[0].page, { width: 600, height: 600 });
      await expectOwnCall(callers[0].page, measurements);
      if (language === 'de') {
        await action(players, 'respond_hold', 'hold');
        await playOne(players);
      } else {
        const controls = await Promise.all(callers.map(item => controlRects(item.page)));
        for (const { page } of players) await page.clock.runFor(5300);
        for (const [index, { page }] of callers.entries()) await expect.poll(() => controlRects(page)).toEqual(controls[index]);
      }
      for (const { page, traffic } of players) {
        await expect(page.locator('[data-watten-call]')).toHaveCount(0);
        expect(traffic.errors).toEqual([]);
      }
    } finally {
      const geometryPath = info.outputPath('geometry.json');
      await writeFile(geometryPath, JSON.stringify(measurements, null, 2));
      await info.attach('call-layout-geometry', { path: geometryPath, contentType: 'application/json' });
      await Promise.allSettled(players.map(item => item.context.close()));
    }
  });
}
