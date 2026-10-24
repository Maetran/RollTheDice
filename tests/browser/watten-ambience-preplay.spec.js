const { test, expect } = require('@playwright/test');
const { player, create, action } = require('./helpers/watten-journey.cjs');
const { expectReachable } = require('./table-viewport');

const viewports = [{ width: 320, height: 568 }, { width: 852, height: 393 }, { width: 568, height: 320 }];

async function expectSeparateControls(players, phase, info) {
  for (const viewport of viewports) for (const peer of players) {
    const page = peer.page;
    await page.setViewportSize(viewport);
    await expectReachable(page, '#wattenSound');
    await expectReachable(page, '.wt-header .suite-header__brand');
    await expect.poll(() => page.evaluate(() => {
      const selectors = ['#wattenSound', '.wt-header .suite-header__brand',
        '[data-watten-preplay-options] > summary', '.wt-bloedeln-dock button',
        '[data-watten-action=show_ready]', '[data-watten-action=inspection_ack]'];
      const nodes = selectors.flatMap(selector => [...document.querySelectorAll(selector)]).filter(node => {
        const details = node.closest('details');
        // Chromium can report fixed descendant rectangles inside a closed
        // native details element. Its summary is the only exposed target.
        if (node.closest('[hidden]') || details && !details.open && !details.querySelector('summary')?.contains(node)) return false;
        return node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0;
      });
      const failures = [];
      for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width < 43.9 || rect.height < 43.9) failures.push(`${node.id || node.dataset.wattenAction || node.tagName}: small target`);
        if (!node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))) {
          failures.push(`${node.id || node.dataset.wattenAction || node.tagName}: covered`);
        }
      }
      const sound = document.querySelector('#wattenSound').getBoundingClientRect();
      const brand = document.querySelector('.wt-header .suite-header__brand').getBoundingClientRect();
      if (Math.min(sound.right, brand.right) - Math.max(sound.left, brand.left) > 1
        && Math.min(sound.bottom, brand.bottom) - Math.max(sound.top, brand.top) > 1) failures.push('brand and ambience overlap');
      return failures;
    }), { message: `${phase}: ambience, brand and real pre-play actions accept independent taps` }).toEqual([]);
    if (peer === players[0] && viewport.width === 568) {
      await page.screenshot({ path: info.outputPath(`ambience-${phase}-568x320.png`) });
    }
  }
}

for (const language of ['de', 'en']) {
  test(`${language}: ambience has its own header slot through Blödeln and open inspection menus`, async ({ browser, baseURL }, info) => {
    test.setTimeout(120_000);
    const mobile = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 4; seat++) players.push(await player(mobile, baseURL, language));
      await create(players, { count: 4, target: 15, schoeneres: true });
      await expectSeparateControls(players, 'show-and-request', info);
      await action(players, 'request_bloedeln');
      await expectSeparateControls(players, 'bloedeln-pending', info);
      await action(players, 'preplay_accept');
      await expectSeparateControls(players, 'bloedeln-accepted', info);
      await action(players, 'show_ready'); await action(players, 'show_ready');
      await expectSeparateControls(players, 'inspection-closed', info);
      const callers = players.filter(peer => peer.traffic.snapshot.engine.actions.includes('inspection_ack'));
      expect(callers).toHaveLength(2);
      for (const caller of callers) await caller.page.locator('[data-watten-preplay-options] > summary').click();
      await expectSeparateControls(callers, 'inspection-open', info);
      const requester = players.find(peer => peer.traffic.snapshot.engine.actions.includes('request_schoeneres'));
      await requester.page.locator('[data-watten-action=request_schoeneres]').click();
      await expectSeparateControls(players, 'redraw-pending', info);
      await action(players, 'preplay_decline');
      await action(players, 'inspection_ack'); await action(players, 'inspection_ack');
      await expectSeparateControls(players, 'play', info);
      expect(players.flatMap(peer => peer.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
