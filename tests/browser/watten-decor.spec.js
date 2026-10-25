const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const path = require('node:path');
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

test('tablet decorations remain reachable and draggable through harmless table repaints in both orientations', async ({ browser, baseURL }, info) => {
  test.setTimeout(60_000);
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(browser, baseURL));
    await create(players, { count: 4, target: 15, determination: 'normal' }); await normalCall(players);
    const page = players[0].page, props = page.locator('[data-watten-decor-item]');
    const bundle = await build({ entryPoints: [path.resolve('frontend/watten/decor.js')], bundle: true,
      write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
    await page.evaluate(async code => {
      const module = await import(`data:text/javascript;base64,${btoa(unescape(encodeURIComponent(code)))}`);
      window.decorGeometry = { protectedSelector: module.DECOR_PROTECTED, fits: module.fitsDecor };
    }, bundle.outputFiles[0].text);
    await expect(props).toHaveCount(3);
    for (const viewport of [{ width: 820, height: 1180 }, { width: 1180, height: 820 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(() => page.locator('[data-wt-felt]').evaluate(node => Math.abs(node.getBoundingClientRect().bottom - innerHeight))).toBeLessThan(1);
      for (let index = 0; index < 3; index++) {
        const item = props.nth(index);
        await expect(item).toBeVisible();
        await item.click({ trial: true });
        const target = await item.evaluate(node => {
          const source = node.getBoundingClientRect(), felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
          const { protectedSelector, fits } = window.decorGeometry;
          const protectedRects = [...document.querySelector('#wattenApp').querySelectorAll(protectedSelector)]
            .filter(other => !other.closest('[data-watten-decor-layer], [hidden]'))
            .map(other => other.getBoundingClientRect()).filter(box => box.width > 0 && box.height > 0);
          const occupied = [...document.querySelectorAll('[data-watten-decor-item]')]
            .filter(other => other !== node && !other.hidden).map(other => other.getBoundingClientRect());
          const candidates = [];
          for (let y = felt.top + 16; y + source.height < felt.bottom - 16; y += 24) {
            for (let x = felt.left + 16; x + source.width < felt.right - 16; x += 24) {
              if (!fits({ left: x, right: x + source.width, top: y, bottom: y + source.height },
                { regions: [felt], protectedRects }, occupied)) continue;
              const distance = Math.hypot(x - source.left, y - source.top);
              if (distance >= 32) candidates.push({ x, y, distance });
            }
          }
          return candidates.sort((a, b) => a.distance - b.distance)[0] || null;
        });
        expect(target).toBeTruthy();
        const source = await item.boundingBox();
        await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2); await page.mouse.down();
        await page.evaluate(() => { const back = document.querySelector('.wt-backs > i'); back.hidden = back.hidden; });
        await page.mouse.move(target.x + source.width / 2, target.y + source.height / 2, { steps: 5 });
        const held = await item.evaluate(node => ({ capture: node.hasPointerCapture(1), dragging: node.dataset.dragging,
          kind: node.dataset.wattenDecorKind, bounds: node.getBoundingClientRect().toJSON() }));
        expect(held.capture, JSON.stringify({ viewport, source, target, held })).toBe(true);
        await page.mouse.up();
        const moved = await item.boundingBox();
        expect(Math.hypot(moved.x - source.x, moved.y - source.y), JSON.stringify({ viewport, source, target, held })).toBeGreaterThan(20);
      }
      await page.screenshot({ path: info.outputPath(`tablet-drag-${viewport.width}x${viewport.height}.png`) });
    }
    expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
});
