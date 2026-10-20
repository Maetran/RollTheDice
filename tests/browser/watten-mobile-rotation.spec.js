const { test, expect } = require('@playwright/test');
const { player, openCreator, create, action, answerPartnerFeedback, normalCall, playOne } = require('./helpers/watten-journey.cjs');
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
        await expect(page.locator('[data-watten-create-open]')).toBeVisible();
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
            await expectFixedTable(page, ['[data-wt-felt]', '[data-wt-scores]', '[data-wt-hand-area]']);
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
        // Complete this real trick, then keep its history open while an actual
        // bid awaits a decision. Both lower-dock controls must survive rotation.
        await playOne(players);
        await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play'
          && item.traffic.snapshot.engine.last_trick?.cards.length === 2)).toBe(true);
        await action(players, 'bid');
        await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'bid_response')).toBe(true);
        await answerPartnerFeedback(players);
        const responder = players.find(item => item.traffic.snapshot.engine.actions.includes('respond_hold'));
        expect(responder).toBeTruthy();
        const decisionPage = responder.page;
        await decisionPage.bringToFront();
        for (const viewport of [{ width: 956, height: 440 }, portrait, { width: 956, height: 440 }, portrait]) {
          await decisionPage.setViewportSize(viewport);
          await decisionPage.evaluate(() => window.dispatchEvent(new Event('orientationchange')));
          const history = decisionPage.locator('.wt-end-sheet > [data-wt-history]');
          await expect(history).toBeVisible();
          if (!await history.evaluate(node => node.open)) await history.locator('summary').click();
          await expectFixedTable(decisionPage, ['[data-wt-felt]', '[data-wt-scores]', '[data-wt-hand-area]']);
          await expectReachable(decisionPage, '[data-wt-history] > summary');
          await expect.poll(() => history.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const panel = node.parentElement.querySelector('[data-wt-panel]');
            const summary = node.querySelector('summary').getBoundingClientRect();
            const hand = document.querySelector('[data-wt-hand-area]').getBoundingClientRect();
            const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
              && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
            return {
              aboveDecision: rect.bottom <= panel.getBoundingClientRect().top + 1,
              clearOfHand: !overlaps(summary, hand),
              controlsClearOfHistory: [...panel.querySelectorAll('button')].every(button => !overlaps(rect, button.getBoundingClientRect())),
              readableCards: [...node.querySelectorAll('.wt-card--mini')].every(card => Number.parseFloat(getComputedStyle(card).width) >= 44),
            };
          }), { message: 'rotating keeps history above the bid, away from the hand and decision targets' })
            .toEqual({ aboveDecision: true, clearOfHand: true, controlsClearOfHistory: true, readableCards: true });
          for (const response of ['respond_hold', 'respond_go', 'respond_counter']) {
            const selector = `[data-watten-action="${response}"]`;
            const target = decisionPage.locator(selector);
            await expect(target).toBeEnabled();
            const targetBox = await target.boundingBox();
            expect(targetBox.width).toBeGreaterThanOrEqual(44);
            expect(targetBox.height).toBeGreaterThanOrEqual(44);
            await expectReachable(decisionPage, selector);
          }
        }
        await action(players, 'respond_hold', 'hold');
        await expect.poll(() => players.every(item => item.traffic.snapshot.engine.phase === 'play')).toBe(true);
        expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
        // Locking is confined to an active game. The compact lobby opens a
        // scrollable native creator; the long rulebook scrolls as a document.
        await page.setViewportSize({ width: 390, height: 600 });
        await page.goto('/watten');
        await expect(page.locator('html')).not.toHaveAttribute('data-watten-active', 'true');
        await openCreator(page);
        const dialog = page.locator('[data-watten-create-dialog]');
        await expect.poll(() => dialog.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(0);
        await dialog.evaluate(node => { node.scrollTop = node.scrollHeight; });
        await expect.poll(() => dialog.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
        await page.keyboard.press('Escape');
        await expect(dialog).not.toBeVisible();
        await page.goto('/watten/regeln');
        await expect(page.locator('html')).not.toHaveAttribute('data-watten-active', 'true');
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeGreaterThan(0);
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      } finally { await Promise.allSettled(players.map(item => item.context.close())); }
    });
  });
}
