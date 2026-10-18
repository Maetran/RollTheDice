const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, action } = require('./helpers/watten-journey.cjs');

const toggle = item => item.page.locator('[data-watten-social-action=toggle]');
const drawer = item => item.page.locator('[data-watten-social-drawer]');
const input = item => item.page.locator('[data-watten-social-input]');
const log = item => item.page.locator('[data-watten-social-log]');

for (const language of ['de', 'en']) {
  test(`${language}: table chat and reactions preserve the frozen bid, hand nodes and mobile draft`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const [host, guest] = players;
    try {
      await host.page.addInitScript(() => {
        const add = WebSocket.prototype.addEventListener;
        WebSocket.prototype.addEventListener = function (type, listener, options) {
          if (type !== 'message' || typeof listener !== 'function') return add.call(this, type, listener, options);
          return add.call(this, type, function (event) {
            if (window.dropWattenSocialAck && JSON.parse(event.data).watten_social_ack) return;
            listener.call(this, event);
          }, options);
        };
      });
      await create(players);
      await normalCall(players);
      await playOne(players);
      await action(players, 'bid');
      // Call bubbles acknowledge their own delivery after a short display;
      // observe that earlier lifecycle before measuring the chat-only window.
      await expect.poll(() => players.every(item => item.traffic.snapshot.pending_call_events.length === 0)).toBe(true);
      const before = players.map(item => ({ opportunity: item.traffic.snapshot.engine.opportunity,
        revision: item.traffic.snapshot.room_revision, hand: item.traffic.snapshot.engine.hand }));
      const commands = players.map(item => item.traffic.commands.length);
      for (const item of players) await item.page.evaluate(() => { window.socialHandNodes = [...document.querySelectorAll('[data-wt-hand] button')]; });
      await toggle(host).click();
      await expect(input(host)).toBeEnabled();
      await host.page.evaluate(() => { window.dropWattenSocialAck = true; });
      const text = '<img src=x onerror="throw 1"> remains plain text';
      await input(host).fill(text);
      await host.page.locator('[data-watten-social-action=send]').click();
      await expect(guest.page.locator('[data-watten-social-unread]')).toHaveText('1');
      await toggle(guest).click();
      await expect(log(guest)).toContainText(text);
      await expect(log(guest).locator('img')).toHaveCount(0);
      await expect(host.page.locator('[data-watten-social-action=retry]')).toBeVisible({ timeout: 10000 });
      await host.page.evaluate(() => { window.dropWattenSocialAck = false; });
      await host.page.locator('[data-watten-social-action=retry]').click();
      await expect(input(host)).toHaveValue('');
      expect(await log(guest).locator('li').count()).toBe(1);
      const sends = host.traffic.commands.filter(item => item.action === 'watten_chat_message');
      expect(sends).toHaveLength(2); expect(sends[1]).toEqual(sends[0]);
      await guest.page.locator('[data-watten-social-action=emoji][data-emoji="🎉"]').click();
      await expect(host.page.locator('[data-watten-social-bubble]')).toContainText('🎉');
      await input(host).fill('Draft kept through rotation');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await host.page.setViewportSize(viewport);
        await expect(input(host)).toHaveValue('Draft kept through rotation');
        await input(host).focus();
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        expect((await input(host).boundingBox()).height).toBeGreaterThanOrEqual(44);
        await drawer(host).screenshot({ path: testInfo.outputPath(`chat-${viewport.width}x${viewport.height}.png`) });
      }
      await host.page.keyboard.press('Escape');
      await expect(drawer(host)).toBeHidden(); await expect(toggle(host)).toBeFocused();
      for (let index = 0; index < players.length; index += 1) {
        const item = players[index];
        expect(item.traffic.snapshot.engine.opportunity).toBe(before[index].opportunity);
        expect(item.traffic.snapshot.room_revision).toBe(before[index].revision);
        expect(item.traffic.snapshot.engine.hand).toEqual(before[index].hand);
        expect(item.traffic.snapshot.engine.bid.pending).toBeTruthy();
        expect(item.traffic.commands.slice(commands[index]).filter(command => !command.action.startsWith('watten_social_')
          && !['watten_chat_message', 'watten_send_emoji'].includes(command.action))).toEqual([]);
        expect(await item.page.evaluate(() => window.socialHandNodes.every((node, position) => node === document.querySelectorAll('[data-wt-hand] button')[position]))).toBe(true);
        expect(item.traffic.errors).toEqual([]);
      }
      const cleared = await host.page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        return document.querySelector('#wattenApp').childElementCount;
      });
      expect(cleared).toBe(0);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('a blind-table spectator receives only public social events and cannot bypass admission', async ({ browser, baseURL }) => {
  const players = await Promise.all([0, 1, 2, 3, 4].map(() => player(browser, baseURL)));
  const spectator = players[4];
  try {
    const path = await create(players.slice(0, 4), { password: 'private-gallery-admission' });
    await spectator.page.goto(`${path}/zuschauen`);
    await expect(toggle(spectator)).toBeHidden();
    await spectator.page.locator('[data-watten-spectate] [name=password]').fill('private-gallery-admission');
    await spectator.page.locator('[data-watten-spectate] button[type=submit]').click();
    await expect(toggle(spectator)).toBeVisible();
    await toggle(spectator).click();
    await expect(input(spectator)).toBeEnabled();
    await input(spectator).fill('Hello from the public gallery');
    await spectator.page.locator('[data-watten-social-action=send]').click();
    await expect(input(spectator)).toHaveValue('');
    for (const item of players.slice(0, 4)) {
      await toggle(item).click(); await expect(log(item)).toContainText('Hello from the public gallery');
    }
    const events = players.flatMap(item => item.traffic.social.filter(frame => frame.watten_social_event)
      .map(frame => frame.watten_social_event.event));
    expect(events).toHaveLength(5);
    for (const event of events) {
      expect(Object.keys(event).sort()).toEqual(['id', 'type', 'sender_id', 'display_name', 'role', 'text', 'time'].sort());
      expect(event.role).toBe('spectator'); expect(event.sender_id).not.toBe(String(spectator.user.id));
    }
    expect(players.every(item => item.traffic.commands.filter(command => command.action === 'watten_command').length === 0)).toBe(true);
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
