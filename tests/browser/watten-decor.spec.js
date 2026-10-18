const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');

const control = (host, name) => host.page.locator(`[data-watten-decor-action=${name}]`);
const add = (host, kind) => host.page.locator(`[data-watten-decor-add=${kind}]`);
const prop = (host, kind) => host.page.locator(`[data-watten-decor-item][data-watten-decor-kind=${kind}]`);

for (const language of ['de', 'en']) {
  test(`${language}: local decorations consume, spill and move while gameplay stays protected`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const host = players[0];
    try {
      if (language === 'en') await host.page.emulateMedia({ reducedMotion: 'no-preference' });
      await create(players, { start: false });
      await control(host, 'toggle').click();
      await expect(host.page.locator('[data-watten-decor-add]')).toHaveCount(8);
      await host.page.locator('[data-watten-decor-corner]').scrollIntoViewIfNeeded();
      await add(host, 'beer').click();
      await expect(prop(host, 'beer')).toBeVisible();
      for (let sip = 0; sip < 4; sip += 1) await control(host, 'use').click();
      await expect(control(host, 'use')).toBeDisabled();
      await control(host, 'refill').click(); await expect(control(host, 'use')).toBeEnabled();
      await control(host, 'spill').click();
      await expect(host.page.locator('[data-watten-decor-spill]')).toBeVisible();
      await control(host, 'wipe').click();
      await expect(host.page.locator('[data-watten-decor-spill]')).toHaveCount(0);
      await add(host, 'chips').click(); await control(host, 'use').click();
      await expect(host.page.locator('[data-watten-decor-status]')).toHaveText(language === 'de' ? 'Ein Bissen – nur zum Spass.' : 'A bite, just for fun.');
      await control(host, 'rotate').click();
      await prop(host, 'chips').press('ArrowDown');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await host.page.setViewportSize(viewport);
        await host.page.locator('[data-watten-decor-corner]').scrollIntoViewIfNeeded();
        await expect(prop(host, 'beer')).toBeVisible(); await expect(prop(host, 'chips')).toBeVisible();
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await host.page.screenshot({ path: testInfo.outputPath(`decor-${viewport.width}x${viewport.height}.png`) });
      }
      await control(host, 'clear').click(); await expect(host.page.locator('[data-watten-decor-item]')).toHaveCount(0);
      await control(host, 'close').click();
      await host.page.setViewportSize({ width: 1280, height: 800 });
      await host.page.locator('[data-watten-command=start]').click(); await normalCall(players);
      await expect.poll(() => players.every(item => item.traffic.snapshot.pending_call_events.length === 0)).toBe(true);
      const before = host.traffic.snapshot.engine.opportunity, commands = host.traffic.commands.length;
      await host.page.evaluate(() => { window.decorHandNodes = [...document.querySelectorAll('[data-wt-hand] button')]; });
      await control(host, 'toggle').click();
      await host.page.locator('[data-watten-decor-corner]').scrollIntoViewIfNeeded();
      await add(host, 'beer').click(); await expect(prop(host, 'beer')).toBeVisible();
      const source = await prop(host, 'beer').boundingBox();
      const hand = await host.page.locator('[data-wt-hand-area]').boundingBox();
      await host.page.mouse.move(source.x + 32, source.y + 32); await host.page.mouse.down();
      await host.page.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2, { steps: 5 });
      await host.page.mouse.up();
      expect(host.traffic.snapshot.engine.opportunity).toBe(before);
      expect(host.traffic.commands.slice(commands)).toEqual([]);
      expect(await host.page.evaluate(() => window.decorHandNodes.every((node, index) => node === document.querySelectorAll('[data-wt-hand] button')[index]))).toBe(true);
      const overlap = await host.page.evaluate(() => {
        const protectedAreas = [...document.querySelectorAll('[data-wt-hand-area],.wt-seat,[data-wt-panel],[data-wt-scores]')]
          .filter(node => !node.hidden).map(node => node.getBoundingClientRect());
        return [...document.querySelectorAll('[data-watten-decor-item]')].filter(node => !node.hidden).some(node => {
          const a = node.getBoundingClientRect();
          return protectedAreas.some(b => b.width && b.height && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
        });
      });
      expect(overlap).toBe(false);
      await host.page.locator('[data-watten-social-action=toggle]').click();
      await expect(prop(host, 'beer')).toBeHidden();
      await host.page.keyboard.press('Escape');
      const cleared = await host.page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return document.querySelector('#wattenApp').childElementCount;
      });
      expect(cleared).toBe(0); expect(host.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
