const { test, expect } = require('@playwright/test');
const { player, create, normalCall } = require('./helpers/watten-journey.cjs');
const { expectFixedTable, expectReachable } = require('./table-viewport');

for (const browserName of ['chromium', 'webkit']) {
  const rotationTest = test.extend({ browser: [async ({ playwright }, use) => {
    const browser = await playwright[browserName].launch();
    try { await use(browser); } finally { await browser.close(); }
  }, { scope: 'worker' }] });
  rotationTest.describe(`Watten ${browserName} mobile rotation hit targets`, () => {

    rotationTest('a cancelled identity read during departure preserves the chosen Rules link', async ({ browser, baseURL }) => {
      const mobileBrowser = { newContext: options => browser.newContext({ ...options,
        viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' }) };
      const { page, context, traffic } = await player(mobileBrowser, baseURL);
      let heldAuth;
      const rootNavigations = [];
      try {
        await page.goto('/watten');
        await expect(page.locator('[data-watten-create]')).toBeVisible();
        await expect.poll(() => page.evaluate(() => Boolean(window.ZDWA_APP_MODE?.initialized))).toBe(true);
        await page.evaluate(() => window.ZDWA_APP_MODE.refresh());

        let announceAuth;
        const authHeld = new Promise(resolve => { announceAuth = resolve; });
        await page.route('**/api/auth/me', route => {
          if (heldAuth) return route.continue();
          heldAuth = route;
          announceAuth(route.request());
        });
        await page.evaluate(() => { window.pendingNavigationAuth = window.ZDWA_APP_MODE.refresh(); });
        const identityRequest = await authHeld;
        const identityFailed = page.waitForEvent('requestfailed', request => request === identityRequest);
        const refreshSettled = page.evaluate(() => window.pendingNavigationAuth)
          .then(value => ({ value }), error => ({ error: error.message }));
        let announceRoot;
        const rootRequested = new Promise(resolve => { announceRoot = resolve; });
        page.on('request', request => {
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()
            && new URL(request.url()).pathname === '/') {
            rootNavigations.push(request.url());
            announceRoot('unexpected home redirect');
          }
        });
        await page.route('**/watten/regeln', async route => {
          // Hold the chosen document until the old page's cancelled identity
          // read has settled: pagehide cannot hide an early redirect here.
          try { await heldAuth.abort('aborted'); }
          catch (error) { if (!identityRequest.failure()) throw error; }
          await identityFailed;
          const outcome = await refreshSettled;
          expect(outcome.error).toBeUndefined();
          expect(outcome.value).toBe(false);
          await route.continue();
        });
        const destination = Promise.race([
          page.waitForURL(/\/watten\/regeln$/).then(() => 'chosen Rules page'), rootRequested,
        ]);
        await page.locator('.wt-header a[href="/watten/regeln"]').click({ noWaitAfter: true });
        expect(await destination).toBe('chosen Rules page');
        await expect(page.locator('.wt-rules')).toBeVisible();
        expect(await page.evaluate(() => window.ZDWA_APP_MODE.refresh())).toBe(true);
        expect(rootNavigations).toEqual([]);
        expect(traffic.errors).toEqual([]);
      } finally {
        if (!page.isClosed()) await page.unrouteAll({ behavior: 'ignoreErrors' });
        await context.close();
      }
    });

    rotationTest('iPhone portrait return keeps the active table fixed and ordinary pages scrollable', async ({ browser, baseURL }) => {
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
        await page.bringToFront();
        await page.evaluate(() => { window.rotationHandNodes = [...document.querySelectorAll('[data-wt-hand] button')]; });
        for (let turn = 0; turn < 3; turn += 1) {
          for (const viewport of [{ width: 956, height: 440 }, portrait]) {
            await page.setViewportSize(viewport);
            await page.evaluate(() => {
              window.dispatchEvent(new Event('orientationchange'));
              screen.orientation?.dispatchEvent(new Event('change'));
            });
            await expect(page.locator('html')).toHaveAttribute('data-watten-active', 'true');
            await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-panel]', '[data-wt-hand-area]']);
            await expectReachable(page, '[data-wt-hand] button:first-child');
            expect(await page.evaluate(() => window.rotationHandNodes.every((node, index) =>
              node === document.querySelectorAll('[data-wt-hand] button')[index]))).toBe(true);
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
        // Locking is confined to an active game. The real creator and long
        // rulebook retain ordinary native document scrolling after departure.
        await page.setViewportSize({ width: 390, height: 844 });
        for (const path of ['/watten', '/watten/regeln']) {
          await page.goto(path);
          await expect(page.locator('html')).not.toHaveAttribute('data-watten-active', 'true');
          await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0);
          await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
          await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
        }
      } finally { await Promise.allSettled(players.map(item => item.context.close())); }
    });
  });
}
