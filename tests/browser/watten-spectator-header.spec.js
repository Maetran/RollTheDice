const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

for (const language of ['de', 'en']) {
  test(`${language}: compact spectator status stays with the points and clears the chat target`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 3; seat++) players.push(await player(wrapped, baseURL, language));
      const path = await create(players.slice(0, 2), { target: 11, determination: 'normal' });
      await normalCall(players.slice(0, 2));
      const { page } = players[2];
      await page.goto(`${path}/zuschauen`);
      await expect(page.locator('[data-wt-table]')).toHaveAttribute('data-viewer', 'spectator');
      const status = page.locator('[data-wt-tools] > .wt-tag');
      await expect(status).toHaveText(language === 'en' ? 'Watching' : 'Zuschauen');
      for (const viewport of [{ width: 568, height: 320 }, { width: 720, height: 360 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('html')).toHaveAttribute('data-wt-compact-header', 'true');
        for (const open of [false, true, false]) {
          if (open !== (await page.locator('html').getAttribute('data-wt-header-open') === 'true')) {
            await page.locator('[data-watten-header-toggle]').click();
          }
          await expectTableHeaderReachable(page);
          await expectReachable(page, '[data-watten-social-action=toggle]');
          await expect(status).toBeVisible();
          await expect.poll(() => page.evaluate(() => {
            const status = document.querySelector('[data-wt-tools] > .wt-tag').getBoundingClientRect();
            const points = document.querySelector('.wt-topbar').getBoundingClientRect();
            const chat = document.querySelector('[data-watten-social-action=toggle]').getBoundingClientRect();
            const overlap = Math.min(status.right, chat.right) - Math.max(status.left, chat.left) > 1
              && Math.min(status.bottom, chat.bottom) - Math.max(status.top, chat.top) > 1;
            return { insidePoints: status.left >= points.left && status.right <= points.right
              && status.top >= points.top && status.bottom <= points.bottom,
            chatClear: !overlap, fullText: document.querySelector('[data-wt-tools] > .wt-tag').scrollWidth <= status.width + 1 };
          }), { message: 'the complete spectator label fits the floating points without painting over chat' })
            .toEqual({ insidePoints: true, chatClear: true, fullText: true });
        }
        const chat = page.locator('[data-watten-social-action=toggle]');
        await chat.click();
        await expect(chat).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('[data-watten-social-drawer]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(chat).toHaveAttribute('aria-expanded', 'false');
        await page.screenshot({ path: info.outputPath(`spectator-header-${language}-${viewport.width}x${viewport.height}.png`) });
      }
      for (const peer of players) expect(peer.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(peer => peer.context.close())); }
  });
}
