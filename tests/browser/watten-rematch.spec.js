const { test, expect } = require('@playwright/test');
const { player, finishOpenMatch } = require('./helpers/watten-journey.cjs');

for (const language of ['de', 'en']) {
  test(`${language}: a committed next table survives a lost response and keeps seats and start explicit`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const host = players[0], guest = players[1];
    const requests = [];
    let createdTarget;
    try {
      const source = await finishOpenMatch(players);
      const original = await (await host.context.request.get('/api/watten/account')).json();
      await expect(host.page.locator('[data-watten-rematch-form]')).toBeVisible();
      await expect(guest.page.locator('[data-watten-rematch]')).toBeHidden();
      const form = host.page.locator('[data-watten-rematch-form]');
      const protectedTarget = language === 'de';
      await form.locator('[name=protection_mode]').selectOption(protectedTarget ? 'fresh_password' : 'disabled');
      if (protectedTarget) await form.locator('[name=rematch_password]').fill('next-table-fresh-secret');
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }]) {
        await host.page.setViewportSize(viewport);
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await host.page.locator('[data-watten-rematch]').screenshot({ path: testInfo.outputPath(`rematch-${viewport.width}x${viewport.height}.png`) });
      }
      await host.page.route('**/api/watten/games/*/rematch', async route => {
        requests.push({ body: route.request().postDataJSON(), expected: route.request().headers()['x-watten-expected-account-id'] });
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        createdTarget = (await response.json()).game_id;
        await route.abort('failed'); // Server committed; only its HTTP confirmation is lost.
      });
      await form.locator('[data-watten-rematch-action=create]').click();
      await expect.poll(() => createdTarget).toMatch(/^[0-9a-f]{16}$/);
      await expect(host.page.locator('[data-watten-rematch-action=open]')).toBeEnabled();
      expect(requests).toHaveLength(1); expect(requests[0].expected).toBe(String(host.user.id));
      if (protectedTarget) expect(requests[0].body.protection.password).toBe('next-table-fresh-secret');
      await host.page.unroute('**/api/watten/games/*/rematch');
      await host.page.locator('[data-watten-rematch-action=open]').click();
      await expect(host.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      await expect.poll(() => host.traffic.snapshot?.id).toBe(createdTarget);
      expect(host.traffic.snapshot.started).toBe(false);
      expect(host.traffic.snapshot.viewer.seat).toBeNull();
      expect(host.traffic.snapshot.room.recipe.password_required).toBe(protectedTarget);
      await guest.page.locator('[data-watten-rematch-action=open]').click();
      await expect(guest.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      if (protectedTarget) await guest.page.locator('[data-watten-join] [name=password]').fill('next-table-fresh-secret');
      await guest.page.locator('[data-watten-join] button[type=submit]').click();
      await expect.poll(() => guest.traffic.snapshot?.id).toBe(createdTarget);
      expect(guest.traffic.snapshot.viewer.seat).toBeNull();
      await expect(guest.page.locator('[data-watten-rematch-reservation]')).toBeVisible();
      for (let seat = 0; seat < players.length; seat += 1) {
        await players[seat].page.locator(`[data-watten-command=take-seat][data-seat="${seat}"]`).click();
        await expect.poll(() => players[seat].traffic.snapshot.viewer.seat).toBe(seat);
      }
      expect(host.traffic.snapshot.started).toBe(false);
      await host.page.locator('[data-watten-command=start]').click();
      await expect.poll(() => host.traffic.snapshot.started).toBe(true);
      expect(host.traffic.snapshot.engine.scores.every(item => item.points === 0)).toBe(true);
      const after = await (await host.context.request.get('/api/watten/account')).json();
      expect(after.progress.total_xp).toBe(original.progress.total_xp);
      expect(after.statistics.all_matches).toBe(1);
      await host.page.goto(source);
      await expect(host.page.locator('[data-watten-rematch-action=open]')).toBeVisible();
      await host.page.locator('[data-watten-rematch-action=open]').click();
      await expect(host.page).toHaveURL(new RegExp(`/watten/spiel/${createdTarget}$`));
      expect(requests).toHaveLength(1);
      expect(host.traffic.errors).toEqual([]); expect(guest.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('four humans release their reservations and explicitly choose different teams for the next match', async ({ browser, baseURL }) => {
  const players = await Promise.all([0, 1, 2, 3].map(() => player(browser, baseURL)));
  const host = players[0];
  try {
    const source = await finishOpenMatch(players, { determination: 'normal' });
    const original = await Promise.all(players.map(async item => (await item.context.request.get('/api/watten/account')).json()));
    await host.page.locator('[data-watten-rematch-form] [name=protection_mode]').selectOption('disabled');
    await host.page.locator('[data-watten-rematch-action=create]').click();
    await expect.poll(() => new URL(host.page.url()).pathname).not.toBe(source);
    for (const item of players) {
      if (item !== host) {
        await item.page.locator('[data-watten-rematch-action=open]').click();
        await item.page.locator('[data-watten-join] button[type=submit]').click();
      }
      await expect(item.page.locator('[data-watten-rematch-reservation]')).toBeVisible();
      await item.page.locator('[data-watten-command=decline-reservation]').click();
      await expect(item.page.locator('[data-watten-rematch-reservation]')).toHaveCount(0);
      expect(item.traffic.snapshot.viewer.seat).toBeNull();
    }
    for (const [index, seat] of [1, 0, 3, 2].entries()) {
      const item = players[index];
      await item.page.locator(`[data-watten-command=take-seat][data-seat="${seat}"]`).click();
      await expect.poll(() => item.traffic.snapshot.viewer.seat).toBe(seat);
      await expect(item.page.locator('.wt-seat-slot.is-own')).toContainText(item.user.username);
    }
    expect(host.traffic.snapshot.started).toBe(false);
    await host.page.locator('[data-watten-command=start]').click();
    await expect.poll(() => players.every(item => item.traffic.snapshot.started)).toBe(true);
    for (let index = 0; index < players.length; index += 1) {
      expect(players[index].traffic.snapshot.engine.scores.every(score => score.points === 0)).toBe(true);
      const current = (await (await players[index].context.request.get('/api/watten/account')).json());
      expect(current.progress.total_xp).toBe(original[index].progress.total_xp);
      expect(current.statistics.all_matches).toBe(1);
      expect(players[index].traffic.errors).toEqual([]);
    }
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
