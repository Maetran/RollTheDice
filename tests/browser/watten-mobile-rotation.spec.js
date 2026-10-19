const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');

for (const browserName of ['chromium', 'webkit']) {
  const rotationTest = test.extend({ browser: [async ({ playwright }, use) => {
    const browser = await playwright[browserName].launch();
    try { await use(browser); } finally { await browser.close(); }
  }, { scope: 'worker' }] });
  rotationTest.describe(`Watten ${browserName} mobile rotation hit targets`, () => {

    rotationTest('iPhone portrait return plays its painted card and preserves document scrolling', async ({ browser, baseURL }) => {
      const portrait = { width: 440, height: 956 };
      const mobileBrowser = { newContext: options => browser.newContext({ ...options, viewport: portrait,
        hasTouch: true, isMobile: true, deviceScaleFactor: 3, serviceWorkers: 'block' }) };
      const players = [await player(mobileBrowser, baseURL), await player(mobileBrowser, baseURL, 'en')];
      try {
        await create(players);
        await normalCall(players);
        await expect.poll(() => players.some(item => item.traffic.snapshot.engine.actions.includes('play_card'))).toBe(true);
        const actor = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
        const { page, traffic } = actor;
        for (let turn = 0; turn < 3; turn += 1) {
          for (const viewport of [{ width: 956, height: 440 }, portrait]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => {
              window.dispatchEvent(new Event('orientationchange'));
              screen.orientation?.dispatchEvent(new Event('change'));
            });
            // Watten deliberately flows down the page. Rotation recovery for
            // the fixed dice/card tables must leave its native scroll usable.
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
            await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
            await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
          }
        }
        const card = traffic.snapshot.engine.hand[0].card;
        const opportunity = traffic.snapshot.engine.opportunity;
        const button = page.locator(`[data-wt-hand] button[data-card="${card}"]`);
        await expect(button).toBeEnabled();
        await button.scrollIntoViewIfNeeded();
        const box = await button.boundingBox();
        expect(box).not.toBeNull();
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await expect.poll(() => traffic.commands.filter(command => command.action === 'watten_command' && command.kind === 'play_card'))
          .toEqual([expect.objectContaining({ action: 'watten_command', kind: 'play_card', value: card, opportunity })]);
        await expect.poll(() => traffic.snapshot.engine.opportunity).not.toBe(opportunity);
        expect(traffic.errors).toEqual([]);
      } finally { await Promise.allSettled(players.map(item => item.context.close())); }
    });
  });
}
