const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { inspectTrickPile } = require('./helpers/watten-trick-pile.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

test('three-player desktop: consecutive side players still form one unlabelled pile', async ({ browser, baseURL }) => {
  const players = [];
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options, viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' }) };
    for (let index = 0; index < 3; index++) players.push(await player(wrapped, baseURL));
    await create(players, { determination: 'normal', target: 15 });
    await normalCall(players);
    for (let count = 1; count <= 3; count++) {
      await playOne(players);
      for (const peer of players) {
        await expect(peer.page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(count);
        await expect(peer.page.locator('[data-wt-trick] .wt-card-owner')).toHaveCount(0);
        expect(await peer.page.locator('[data-wt-trick] > .wt-trick-card').evaluateAll(nodes => {
          const faces = nodes.map(node => node.getBoundingClientRect()), connected = new Set([0]);
          const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
          for (let step = 0; step < faces.length; step++) for (let index = 0; index < faces.length; index++) {
            if ([...connected].some(other => overlaps(faces[index], faces[other]))) connected.add(index);
          }
          return connected.size === faces.length;
        })).toBe(true);
      }
    }
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});

async function expectStablePrefix(peer, expected, previous, { paintedSelector, winner } = {}) {
  const result = await inspectTrickPile(peer.page, { expected, anchorSeat: peer.traffic.snapshot.viewer.seat,
    ownerNames: peer.traffic.snapshot.room.seats.map(seat => seat.name), paintedSelector, winner });
  expect(result.errors, `${expected.length}-card prefix from viewer seat ${peer.traffic.snapshot.viewer.seat}`).toEqual([]);
  for (const earlier of previous || []) {
    const current = result.cards.find(card => card.card === earlier.card);
    expect(current, `previous card ${earlier.card} remains in the pile`).toBeTruthy();
    for (const key of ['left', 'top', 'width', 'height']) {
      expect(Math.abs(current[key] - earlier[key]), `${earlier.card}: relative ${key} remains stable`).toBeLessThanOrEqual(1);
    }
    expect(current.z, `${earlier.card}: marking the winner never raises an earlier card`).toBe(earlier.z);
    for (let index = 0; index < earlier.angle.length; index++) {
      expect(Math.abs(current.angle[index] - earlier.angle[index]), `${earlier.card}: angle remains stable`).toBeLessThanOrEqual(.001);
    }
  }
  return result.cards;
}

test('portrait dealing: completing paused deal flights cannot resize an already played prefix', async ({ browser, baseURL }) => {
  const players = [];
  try {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 440, height: 956 }, serviceWorkers: 'block', reducedMotion: 'no-preference' }) };
    for (let index = 0; index < 4; index++) {
      const peer = await player(wrapped, baseURL);
      await peer.page.addInitScript(() => {
        const animate = Element.prototype.animate;
        window.pausedWattenDeals = [];
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('[data-wt-motion="deal"]')) {
            animation.pause(); animation.currentTime = 0;
            window.pausedWattenDeals.push(animation);
          }
          return animation;
        };
      });
      players.push(peer);
    }
    await create(players, { determination: 'normal', target: 15 });
    for (const peer of players) {
      await expect.poll(() => peer.page.evaluate(() => window.pausedWattenDeals.length)).toBe(20);
      // The own hand remains playable while all fifteen accepted opponent
      // slots stay transparent behind their deliberately paused deal flights.
      await peer.page.evaluate(() => window.pausedWattenDeals.forEach((animation, index) => {
        if (index < 5) animation.finish();
      }));
      await expect(peer.page.locator('[data-wt-motion="deal"]')).toHaveCount(15);
      await expect.poll(() => peer.page.locator('.wt-backs > i[style*="opacity: 0"]').count()).toBe(15);
    }
    await normalCall(players);
    await playOne(players);
    const geometry = [];
    for (const peer of players) {
      await expect(peer.page.locator('[data-wt-motion="arrive"]')).toHaveCount(0);
      geometry.push(await expectStablePrefix(peer, peer.traffic.snapshot.engine.current_trick.cards));
      await peer.page.evaluate(() => window.pausedWattenDeals.forEach(animation => {
        if (animation.playState !== 'finished') animation.finish();
      }));
      await expect(peer.page.locator('[data-wt-motion="deal"]')).toHaveCount(0);
    }
    await playOne(players);
    for (const [index, peer] of players.entries()) {
      await expect(peer.page.locator('[data-wt-motion="arrive"]')).toHaveCount(0);
      await expectStablePrefix(peer, peer.traffic.snapshot.engine.current_trick.cards, geometry[index]);
      expect(await peer.page.evaluate(() => {
        const cards = [...document.querySelectorAll('[data-wt-trick] > .wt-trick-card')];
        const slots = [...document.querySelectorAll('.wt-seat .wt-backs > i:not([hidden])')];
        return cards.flatMap(card => slots.filter(slot => {
          const a = card.getBoundingClientRect(), b = slot.getBoundingClientRect();
          return b.width > 0 && b.height > 0 && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
            && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
        }).map(() => card.dataset.key));
      })).toEqual([]);
    }
    expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});

for (const viewport of [{ width: 440, height: 956 }, { width: 956, height: 440 }, { width: 852, height: 393 }, { width: 568, height: 320 }]) {
  test(`normal motion ${viewport.width}x${viewport.height}: every sequential prefix stays one ordered pile through winner collection`, async ({ browser, baseURL }, info) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
      for (let index = 0; index < 4; index++) {
        const item = await player(wrapped, baseURL);
        await item.page.emulateMedia({ reducedMotion: 'no-preference' });
        players.push(item);
      }
      await create(players, { determination: 'normal', target: 15 });
      await normalCall(players);
      const geometry = players.map(() => null);
      for (let count = 1; count <= 3; count++) {
        await playOne(players);
        await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.current_trick.cards.length === count)).toBe(true);
        const expected = players[0].traffic.snapshot.engine.current_trick.cards;
        for (const [index, peer] of players.entries()) {
          expect(peer.traffic.snapshot.engine.current_trick.cards).toEqual(expected);
          await expect(peer.page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(count);
          await expect(peer.page.locator('[data-wt-motion="arrive"]')).toHaveCount(0);
          geometry[index] = await expectStablePrefix(peer, expected, geometry[index]);
        }
      }
      if (viewport.width === 956) {
        const expected = players[0].traffic.snapshot.engine.current_trick.cards;
        for (const size of [{ width: 568, height: 320 }, viewport]) for (const [index, peer] of players.entries()) {
          await peer.page.setViewportSize(size);
          await expect.poll(() => peer.page.locator('[data-wt-trick] > .wt-trick-card').first()
            .evaluate(node => Number.parseFloat(getComputedStyle(node).width))).toBe(size.width === 568 ? 48 : 64);
          geometry[index] = await expectStablePrefix(peer, expected, null);
        }
      }
      for (const item of players) await item.page.evaluate(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('[data-wt-motion="collect"]')) animation.pause();
          return animation;
        };
      });
      await playOne(players);
      await expect.poll(() => players.every(peer => peer.traffic.snapshot.engine.last_trick?.cards.length === 4)).toBe(true);
      const acceptedTrick = players[0].traffic.snapshot.engine.last_trick;
      const winnerPositions = new Set();
      for (const [index, item] of players.entries()) {
        expect(item.traffic.snapshot.engine.last_trick).toEqual(acceptedTrick);
        const group = item.page.locator('[data-wt-motion="collect"]');
        await expect(group).toHaveCount(1);
        const differences = await group.evaluate(node => {
          for (const animation of node.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = 500; }
          const errors = [];
          const box = element => {
            const rect = element.getBoundingClientRect();
            return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          };
          for (const copy of node.children) {
            const original = document.querySelector(`[data-wt-trick] > [data-key="${copy.dataset.key}"]`);
            if (!original) { errors.push('missing public original'); continue; }
            const a = box(original), b = box(copy);
            for (const key of Object.keys(a)) if (Math.abs(a[key] - b[key]) > 1) errors.push(`card ${copy.dataset.key} ${key}: ${a[key]} != ${b[key]}`);
            const first = getComputedStyle(original), second = getComputedStyle(copy);
            for (const property of ['width', 'height']) {
              if (Math.abs(Number.parseFloat(first[property]) - Number.parseFloat(second[property])) > .1) errors.push(`${copy.dataset.key} ${property}: ${first[property]} != ${second[property]}`);
            }
            for (const property of ['outlineColor', 'outlineWidth', 'boxShadow', 'zIndex']) {
              if (first[property] !== second[property]) errors.push(`${copy.dataset.key} ${property}: ${first[property]} != ${second[property]}`);
            }
          }
          return errors;
        });
        expect(differences).toEqual([]);
        await expectStablePrefix(item, acceptedTrick.cards, geometry[index], {
          paintedSelector: '[data-wt-motion="collect"]', winner: acceptedTrick.winner,
        });
        winnerPositions.add(await group.locator('.is-winning-card').getAttribute('data-position'));
        if (index === 0) await item.page.screenshot({ path: info.outputPath(`live-collection-${viewport.width}x${viewport.height}.png`) });
        await group.evaluate(node => node.getAnimations()[0].finish());
        await expect(group).toHaveCount(0);
      }
      expect([...winnerPositions].sort()).toEqual(['bottom', 'left', 'right', 'top']);
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });

  test(`blind packet ${viewport.width}x${viewport.height}: the own hand stays visible as safe noninteractive backs before showing`, async ({ browser, baseURL }, info) => {
    const players = [];
    try {
      const wrapped = { newContext: options => browser.newContext({ ...options, viewport, serviceWorkers: 'block' }) };
      for (let index = 0; index < 4; index++) players.push(await player(wrapped, baseURL));
      await create(players, { determination: 'ladinisch', target: 15 });
      await expect.poll(() => players.every(item => item.traffic.snapshot?.engine?.phase === 'show_ready')).toBe(true);
      for (const item of players) {
        const hand = item.page.locator('[data-wt-hand]');
        await expect(item.page.locator('[data-wt-hand-area]')).toBeVisible();
        await expect(hand.locator('.wt-hand-card--back')).toHaveCount(5);
        expect(await hand.locator('.wt-hand-card--back').first().evaluate(node => getComputedStyle(node).backgroundImage)).toContain('card-back');
        await expect(hand.locator('button, [data-card], [data-wt-card]')).toHaveCount(0);
        expect(item.traffic.snapshot.engine.hand).toEqual(Array.from({ length: 5 }, () => ({ back: true })));
        if (item.traffic.snapshot.engine.actions.includes('show_ready')) {
          await expectReachable(item.page, '[data-watten-action="show_ready"]');
          expect(await item.page.evaluate(() => {
            const action = document.querySelector('[data-watten-action="show_ready"]').getBoundingClientRect();
            return [...document.querySelectorAll('[data-wt-hand] > *')].every(card => {
              const rect = card.getBoundingClientRect();
              return action.right <= rect.left || action.left >= rect.right || action.bottom <= rect.top || action.top >= rect.bottom;
            });
          })).toBe(true);
        }
      }
      await players[0].page.screenshot({ path: info.outputPath(`blind-own-packet-${viewport.width}x${viewport.height}.png`) });
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
