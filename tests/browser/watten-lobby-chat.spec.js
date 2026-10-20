const { test, expect } = require('@playwright/test');
const { player } = require('./helpers/watten-journey.cjs');

const input = item => item.page.locator('[data-watten-lobby-chat-input]');
const messages = item => item.page.locator('[data-watten-lobby-chat-messages]');
const action = (item, name) => item.page.locator(`[data-watten-lobby-chat-action=${name}]`);
const disclosure = item => item.page.locator('.wt-lobby-chat-disclosure');
const revealChat = async item => {
  await expect(disclosure(item)).not.toHaveAttribute('open', '');
  await expect(action(item, 'open')).toBeHidden();
  await disclosure(item).locator('summary').click();
  await expect(action(item, 'open')).toBeVisible();
};

for (const language of ['de', 'en']) {
  test(`${language}: shared lobby preserves consent, fixed audiences, product labels and mobile drafts`, async ({ browser, baseURL }, testInfo) => {
    const players = await Promise.all([0, 1, 2].map(() => player(browser, baseURL, language)));
    const [host, guest, newcomer] = players;
    try {
      for (const item of players) {
        await item.page.goto('/watten');
        await revealChat(item);
        expect(item.traffic.commands).toEqual([]);
      }
      for (const item of [host, guest]) {
        await action(item, 'open').click(); await expect(input(item)).toBeEnabled();
      }
      const first = '<img src=x onerror="throw 1"> is public plain text';
      await input(host).fill(first); await action(host, 'send').click();
      await expect(input(host)).toHaveValue('');
      await expect(messages(guest)).toContainText(first);
      await expect(messages(guest).locator('img')).toHaveCount(0);
      await action(newcomer, 'open').click(); await expect(input(newcomer)).toBeEnabled();
      await expect(messages(newcomer)).not.toContainText(first);
      await input(newcomer).fill('Only the current audience sees this'); await action(newcomer, 'send').click();
      for (const item of players) await expect(messages(item)).toContainText('Only the current audience sees this');
      await guest.page.reload(); await revealChat(guest);
      await action(guest, 'open').click(); await expect(input(guest)).toBeEnabled();
      await expect(messages(guest)).toContainText(first);
      await expect(messages(guest)).toContainText('Only the current audience sees this');

      const legacy = await host.context.newPage();
      await legacy.goto('/hausdepp');
      await expect(legacy.locator('[data-lobby-chat-input]')).toBeEnabled();
      await expect(legacy.locator('.lobby-chat__message[data-game-type=watten]').first()).toBeVisible();
      await expect(legacy.locator('.lobby-chat__message[data-game-type=watten] .lobby-chat__game-badge').first()).toHaveText('watten');
      await legacy.locator('[data-lobby-chat-input]').fill('Hello from Hausdepp');
      await legacy.locator('[data-lobby-chat-send]').click();
      await expect(messages(guest)).toContainText('Hello from Hausdepp');
      await guest.page.locator('[data-watten-lobby-chat-filter]').selectOption('hausdepp');
      await expect(messages(guest)).toContainText('Hello from Hausdepp');
      await expect(messages(guest)).not.toContainText(first);
      await guest.page.locator('[data-watten-lobby-chat-filter]').selectOption('all');
      for (const item of players) {
        for (const frame of item.traffic.lobby) {
          expect(Object.keys(frame.lobby_chat).sort()).toEqual(['id', 'kind', 'sender', 'is_admin', 'game_type', 'sent_at', 'text'].sort());
        }
      }
      await input(guest).fill('Draft preserved in both orientations');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await guest.page.setViewportSize(viewport); await input(guest).focus();
        await expect(input(guest)).toHaveValue('Draft preserved in both orientations');
        expect(await guest.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        expect((await input(guest).boundingBox()).height).toBeGreaterThanOrEqual(44);
        await guest.page.screenshot({ path: testInfo.outputPath(`lobby-${viewport.width}x${viewport.height}.png`) });
      }
      const disabling = host.page.waitForResponse(response =>
        new URL(response.url()).pathname === '/api/auth/preferences/lobby-chat'
        && response.request().method() === 'PUT'
        && response.request().postDataJSON()?.lobby_chat_enabled === false);
      await action(host, 'disable').click();
      await expect(host.page.locator('[data-watten-lobby-chat-body]')).toBeHidden();
      await expect(messages(host)).toBeEmpty();
      const disabled = await disabling;
      expect(disabled.status()).toBe(200);
      expect((await disabled.json()).lobby_chat_enabled).toBe(false);
      expect((await (await host.context.request.get('/api/auth/me')).json()).user.preferences.lobby_chat_enabled).toBe(false);
      await input(guest).fill('Sent while the first account opted out'); await action(guest, 'send').click();
      await expect(input(guest)).toHaveValue('');
      await action(host, 'open').click(); await expect(input(host)).toBeEnabled();
      await expect(messages(host)).toContainText(first);
      await expect(messages(host)).not.toContainText('Sent while the first account opted out');
      const cleared = await guest.page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return document.querySelector('#wattenApp').childElementCount;
      });
      expect(cleared).toBe(0);
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}
