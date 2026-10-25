const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectHandFans } = require('./helpers/watten-hand-fans.cjs');
const { expectReachable } = require('./table-viewport');

test.setTimeout(90_000);

for (const language of ['de', 'en']) {
  test(`${language}: four-seat compact spectator status shares the target row and clears chat, names and roles`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 393, height: 852 }, serviceWorkers: 'block' }) };
    const players = [];
    try {
      for (let seat = 0; seat < 5; seat++) players.push(await player(wrapped, baseURL, language));
      const path = await create(players.slice(0, 4), { target: 11, determination: 'normal' });
      await normalCall(players.slice(0, 4));
      const { page } = players[4];
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
          // The expanded navigation overlays the table's upper left corner.
          // Every seat label must accept hits again after it collapses.
          if (!open) await expectHandFans(page, { spectator: true });
          await expectReachable(page, '[data-watten-social-action=toggle]');
          await expect(status).toBeVisible();
          await expect.poll(() => page.evaluate(() => {
            const status = document.querySelector('[data-wt-tools] > .wt-tag').getBoundingClientRect();
            const points = document.querySelector('.wt-topbar').getBoundingClientRect();
            const target = document.querySelector('.wt-target').getBoundingClientRect();
            const chat = document.querySelector('[data-watten-social-action=toggle]').getBoundingClientRect();
            const overlap = Math.min(status.right, chat.right) - Math.max(status.left, chat.left) > 1
              && Math.min(status.bottom, chat.bottom) - Math.max(status.top, chat.top) > 1;
            const labels = [...document.querySelectorAll('.wt-seat-name, .wt-seat-call-role')]
              .map(node => node.getBoundingClientRect()).filter(box => box.width && box.height);
            const labelsClear = labels.every(box => Math.min(status.right, box.right) - Math.max(status.left, box.left) <= 1
              || Math.min(status.bottom, box.bottom) - Math.max(status.top, box.top) <= 1);
            const statusCentre = status.y + status.height / 2;
            const rowOverlap = Math.min(status.bottom, target.bottom) - Math.max(status.top, target.top);
            return { insidePoints: status.left >= points.left && status.right <= points.right
              && status.top >= points.top && status.bottom <= points.bottom,
            // Borders may make the score buttons taller than their 44px
            // minimum. Compare the actual metadata row, not that minimum.
            sameTargetRow: statusCentre >= target.top && statusCentre <= target.bottom && rowOverlap >= status.height * .75,
            noExtraRow: Math.abs(points.bottom - target.bottom) <= 1, labelsClear,
            chatClear: !overlap, fullText: document.querySelector('[data-wt-tools] > .wt-tag').scrollWidth <= status.width + 1 };
          }), { message: 'the complete spectator label shares the existing target row without covering chat or player labels' })
            .toEqual({ insidePoints: true, sameTargetRow: true, noExtraRow: true, labelsClear: true, chatClear: true, fullText: true });
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
