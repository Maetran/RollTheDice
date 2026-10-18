const { test, expect } = require('@playwright/test');
const { player, create, action, normalCall, playOne } = require('./helpers/watten-journey.cjs');

async function finish(players) {
  const path = await create(players);
  await normalCall(players);
  await playOne(players);
  await action(players, 'bid');
  await action(players, 'respond_hold', 'hold');
  for (let index = 0; index < 12 && players[0].traffic.snapshot.engine.phase === 'play'; index += 1) await playOne(players);
  for (const item of players) await expect(item.page.locator('[data-watten-match-result]')).toBeVisible();
  return path;
}

for (const language of ['de', 'en']) {
  test(`${language}: a native completed match reaches progress, history, filtered standings and explicit acknowledgement`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const own = players[0];
    try {
      const gamePath = await finish(players);
      const account = await (await own.context.request.get('/api/watten/account')).json();
      expect(account.statistics.all_matches).toBe(1);
      expect(account.progress.total_xp).toBeGreaterThan(10);
      expect(account.progress.pending.credits).toHaveLength(1);
      await own.page.locator('[data-watten-nav] a[href="/watten/konto/fortschritt"]').click();
      await expect(own.page).toHaveURL(/\/watten\/konto\/fortschritt$/);
      await expect(own.page.locator('html')).toHaveAttribute('lang', language);
      await expect(own.page.locator('.wt-progress-title h2')).toHaveText(account.progress.title.name[language]);
      await expect(own.page.locator('.wt-achievement-grid > li')).toHaveCount(27);
      await expect(own.page.locator('.wt-feed')).toContainText(own.user.username);
      await expect(own.page.locator('[data-progress-action=acknowledge]')).toBeVisible();
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 768, height: 700 }]) {
        await own.page.setViewportSize(viewport);
        expect(await own.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await own.page.screenshot({ path: testInfo.outputPath(`progress-${viewport.width}x${viewport.height}.png`), fullPage: true });
      }
      await own.page.locator('[data-progress-action=acknowledge]').click();
      await expect(own.page.locator('[data-progress-action=acknowledge]')).toHaveCount(0);
      await own.page.reload();
      await expect(own.page.locator('.wt-progress-title h2')).toHaveText(account.progress.title.name[language]);
      await expect(own.page.locator('[data-progress-action=acknowledge]')).toHaveCount(0);
      const after = await (await own.context.request.get('/api/watten/account')).json();
      expect(after.progress.total_xp).toBe(account.progress.total_xp);
      expect((await (await players[1].context.request.get('/api/watten/account')).json()).progress.pending.credits).toHaveLength(1);
      await own.page.locator('.wt-progress-tabs a[href="/watten/konto/verlauf"]').click();
      await expect(own.page.locator('.wt-match-history > li')).toHaveCount(1);
      await expect(own.page.locator('.wt-match-history')).toContainText(players[1].user.username);
      expect(await own.page.locator('[data-progress-match]').getAttribute('data-progress-match')).toBe(gamePath.split('/').pop());
      await own.page.locator('.wt-progress-tabs a[href="/watten/rangliste"]').click();
      const form = own.page.locator('[data-progress-ranking]');
      await expect(form.locator('[name=players]')).toBeDisabled();
      await expect(own.page.locator('.wt-ranking .is-own')).toContainText(own.user.username);
      await form.locator('[name=metric]').selectOption('wins');
      await expect(form.locator('[name=players]')).toBeEnabled();
      await form.locator('[name=players]').selectOption('2');
      await form.locator('[name=opponents]').selectOption('human');
      await form.locator('button').click();
      await expect(own.page.locator('[data-progress-ranking-result]')).toContainText(own.user.username);
      expect(own.traffic.errors).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('an initial account read failure exposes a working retry and never invents progress', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  try {
    await own.page.route('**/api/watten/account', route => route.fulfill({ status: 503, json: { detail: 'unavailable' } }));
    await own.page.goto('/watten/konto/fortschritt');
    await expect(own.page.locator('[data-progress-error]')).toContainText('nicht vollständig');
    await expect(own.page.locator('.wt-progress-title')).toHaveCount(0);
    await expect(own.page.locator('[data-progress-loading]')).toHaveCount(0);
    await own.page.unroute('**/api/watten/account');
    await own.page.locator('[data-progress-action=retry]').click();
    await expect(own.page.locator('.wt-progress-title')).toContainText('0 XP');
    expect(own.traffic.errors).toEqual([]);
  } finally { await own.context.close(); }
});

test('an older failed ranking response cannot overwrite the latest successful filter', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  let delayed;
  try {
    await own.page.goto('/watten/rangliste');
    const form = own.page.locator('[data-progress-ranking]');
    await expect(form.locator('button')).toBeEnabled();
    await own.page.route('**/api/watten/leaderboard?**', async route => {
      if (new URL(route.request().url()).searchParams.get('metric') === 'wins') {
        await new Promise(resolve => { delayed = resolve; });
        await route.fulfill({ status: 503, json: { detail: 'unavailable' } });
      } else await route.continue();
    });
    await form.locator('[name=metric]').selectOption('wins');
    await expect.poll(() => !!delayed).toBe(true);
    await form.locator('[name=metric]').selectOption('win_rate');
    await expect(own.page.locator('[data-progress-ranking-result]')).toContainText('Mindestens 10');
    delayed(); delayed = null;
    await expect(form.locator('button')).toBeEnabled();
    await expect(own.page.locator('[data-progress-error]')).toBeEmpty();
  } finally { delayed?.(); await own.context.close(); }
});

test('a cookie account switch between initial identity and private GET rejects the old binding', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  const own = players[0];
  let unblock;
  try {
    let attempted;
    await own.page.route('**/api/watten/account', async route => {
      attempted = route.request().headers()['x-watten-expected-account-id'];
      await new Promise(resolve => { unblock = resolve; });
      // Use the context's current cookie jar after the second tab switched it.
      const response = await own.context.request.get('/api/watten/account', {
        headers: { 'X-Watten-Expected-Account-Id': attempted },
      });
      await route.fulfill({ response });
    });
    await own.page.goto('/watten/konto/fortschritt');
    await expect.poll(() => !!unblock).toBe(true);
    expect(attempted).toBe(String(own.user.id));
    await own.context.clearCookies();
    await own.context.addCookies(await players[1].context.cookies());
    const guard = own.page.waitForResponse(response => response.url().includes('/api/watten/account') && response.status() === 409);
    await own.page.unroute('**/api/watten/account');
    unblock(); unblock = null;
    await guard;
    await expect(own.page.locator('.wt-progress-title')).toContainText('0 XP');
    expect(own.traffic.errors).toEqual([]);
  } finally { unblock?.(); await Promise.allSettled(players.map(item => item.context.close())); }
});
