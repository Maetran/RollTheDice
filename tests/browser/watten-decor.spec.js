const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');

const control = (host, name) => host.page.locator(`[data-watten-decor-action=${name}]`);
const prop = (host, kind) => host.page.locator(`[data-watten-decor-item][data-watten-decor-kind=${kind}]`);

for (const language of ['de', 'en']) {
  test(`${language}: local decorations consume and move without a context menu while gameplay stays protected`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const host = players[0];
    try {
      await host.page.emulateMedia({ reducedMotion: 'reduce' });
      await create(players); await normalCall(players);
      await expect(control(host, 'toggle')).toHaveCount(0);
      await prop(host, 'beer').click({ button: 'right' });
      await host.page.keyboard.press('Escape');
      await expect(host.page.locator('[data-watten-decor-panel], [data-watten-decor-corner], [data-watten-decor-add]')).toHaveCount(0);
      for (let sip = 0; sip < 4; sip += 1) await prop(host, 'beer').click();
      await expect(prop(host, 'beer')).toHaveAttribute('data-level', '0');
      await expect(prop(host, 'beer').locator('.wt-decor-badge')).not.toBeEmpty();
      await prop(host, 'beer').click();
      await expect(prop(host, 'beer')).toHaveAttribute('data-level', '4');
      await expect(prop(host, 'beer').locator('.wt-decor-badge')).toBeEmpty();
      await prop(host, 'beer').press('ArrowDown');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await host.page.setViewportSize(viewport);
        await expect(host.page.locator('[data-watten-decor-panel]')).toHaveCount(0);
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await host.page.screenshot({ path: testInfo.outputPath(`decor-${viewport.width}x${viewport.height}.png`) });
      }
      await host.page.setViewportSize({ width: 1280, height: 800 });
      await expect(prop(host, 'beer')).toBeVisible();
      const desktopProp = await prop(host, 'beer').boundingBox(); expect(desktopProp.width).toBe(88);
      await expect.poll(() => players.every(item => item.traffic.snapshot.pending_call_events.length === 0)).toBe(true);
      const before = host.traffic.snapshot.engine.opportunity, commands = host.traffic.commands.length;
      await host.page.evaluate(() => { window.decorHandNodes = [...document.querySelectorAll('[data-wt-hand] button')]; });
      await expect(prop(host, 'beer')).toBeVisible();
      const source = await prop(host, 'beer').boundingBox();
      const hand = await host.page.locator('[data-wt-hand-area]').boundingBox();
      await host.page.mouse.move(source.x + 32, source.y + 32); await host.page.mouse.down();
      await host.page.mouse.move(hand.x + hand.width / 2, hand.y + hand.height / 2, { steps: 5 });
      await host.page.mouse.up();
      expect(host.traffic.snapshot.engine.opportunity).toBe(before);
      expect(host.traffic.commands.slice(commands)).toEqual([]);
      expect(await host.page.evaluate(() => window.decorHandNodes.every((node, index) => node === document.querySelectorAll('[data-wt-hand] button')[index]))).toBe(true);
      const overlap = await host.page.evaluate(() => {
        const protectedAreas = [...document.querySelectorAll('[data-wt-hand-area],.wt-seat,.wt-taken,.wt-stock,.wt-stock > i,[data-wt-panel],[data-wt-history],[data-wt-stake],[data-wt-scores]')]
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
