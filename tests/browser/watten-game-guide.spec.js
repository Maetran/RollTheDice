const { test, expect } = require('@playwright/test');
const { player, create } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`Watten ${language} guide explains blind decisions and persists only Understood`, async ({ browser, baseURL }, testInfo) => {
    const mobileBrowser = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 320, height: 740 }, serviceWorkers: 'block' }) };
    const host = await player(mobileBrowser, baseURL, language, { guide: true });
    try {
      await create([host], { count: 2, cpuFill: true });
      const guide = host.page.locator('[data-game-tour="watten"]');
      await expect(guide).toHaveAttribute('data-tour-step', 'offer');
      await expect(guide).toHaveAttribute('aria-live', 'off');
      await expect(guide.locator('p')).toHaveCount(0);
      await expect(host.page.locator('[data-tour-start]')).toHaveText(language === 'de' ? 'Einführung ansehen' : 'View introduction');
      const invitationSize = await guide.boundingBox();
      expect(invitationSize.height).toBeLessThan(80);
      expect(await guide.evaluate(node => node.contains(document.activeElement))).toBe(false);
      await host.page.locator('[data-tour-close]').click();
      await expect(guide).toBeHidden();
      let preferences = await host.context.request.get('/api/auth/game-guides');
      expect((await preferences.json()).acknowledged.watten).toBe(0);
      await host.page.reload();
      await expect(guide).toHaveAttribute('data-tour-step', 'offer');
      await host.page.locator('[data-tour-start]').click();
      await expect(guide).toHaveAttribute('data-tour-step', 'welcome');
      const actionsBefore = host.traffic.commands.filter(message => message.action === 'watten_command').length;
      for (const step of ['calls', 'play', 'bid', 'partner', 'history', 'finish']) {
        await host.page.locator('[data-tour-next]').click();
        await expect(guide).toHaveAttribute('data-tour-step', step);
        if (step === 'partner') await expect(guide).toContainText(language === 'de' ? 'kein Gegensignal' : 'does not need to send');
      }
      await expect(host.page.locator('[data-tour-next]')).toHaveText(language === 'de' ? 'Verstanden' : 'Understood');
      for (const viewport of [{ width: 320, height: 740 }, { width: 393, height: 852 }, { width: 568, height: 320 }, { width: 1280, height: 800 }]) {
        await host.page.setViewportSize(viewport);
        await host.page.locator('[data-tour-next]').scrollIntoViewIfNeeded();
        const ackBox = await host.page.locator('[data-tour-next]').boundingBox();
        expect(ackBox.x).toBeGreaterThanOrEqual(0);
        expect(ackBox.x + ackBox.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(ackBox.y + ackBox.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      await host.page.screenshot({ path: testInfo.outputPath(`watten-guide-${language}.png`) });
      await host.page.locator('[data-tour-next]').click();
      await expect.poll(async () => (await (await host.context.request.get('/api/auth/game-guides')).json()).acknowledged.watten).toBe(1);
      expect(host.traffic.commands.filter(message => message.action === 'watten_command').length).toBe(actionsBefore);
      await host.page.reload();
      await expect(host.page.locator('[data-wt-hand]')).toBeVisible();
      await expect(guide).toBeHidden();
      preferences = await host.context.request.get('/api/auth/game-guides');
      expect((await preferences.json()).acknowledged.watten).toBe(1);
      expect(host.traffic.errors).toEqual([]);
    } finally { await host.context.close(); }
  });
}
