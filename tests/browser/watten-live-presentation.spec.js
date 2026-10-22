const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

for (const viewport of [{ width: 440, height: 956 }, { width: 956, height: 440 }, { width: 568, height: 320 }]) {
  test(`normal motion ${viewport.width}x${viewport.height}: a real trick keeps its labels, winner and card proportions during collection`, async ({ browser, baseURL }, info) => {
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
      for (let index = 0; index < 3; index++) await playOne(players);
      const page = players[0].page;
      await expect(page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(3);
      for (const item of players) await item.page.evaluate(() => {
        const animate = Element.prototype.animate;
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args);
          if (this.matches('[data-wt-motion="collect"]')) animation.pause();
          return animation;
        };
      });
      await playOne(players);
      const winnerPositions = new Set();
      for (const [index, item] of players.entries()) {
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
            for (const [name, first, second] of [['card', original, copy],
              ['owner', original.querySelector('.wt-card-owner'), copy.querySelector('.wt-card-owner')]]) {
              const a = box(first), b = box(second);
              for (const key of Object.keys(a)) if (Math.abs(a[key] - b[key]) > 1) errors.push(`${name} ${copy.dataset.key} ${key}: ${a[key]} != ${b[key]}`);
            }
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
