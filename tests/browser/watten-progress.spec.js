const { test, expect } = require('@playwright/test');
const { player, finishOpenMatch: finish } = require('./helpers/watten-journey.cjs');

async function usableControl(locator) {
  await locator.scrollIntoViewIfNeeded();
  const geometry = await locator.evaluate(node => {
    const rect = node.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return { width: rect.width, height: rect.height, hit: hit === node || node.contains(hit) };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.hit).toBe(true);
}

for (const language of ['de', 'en']) {
  test(`${language}: a native completed match reaches progress, history, filtered standings and explicit acknowledgement`, async ({ browser, baseURL }, testInfo) => {
    const players = [await player(browser, baseURL, language), await player(browser, baseURL, language)];
    const own = players[0];
    try {
      const gamePath = await finish(players);
      await expect(own.page.locator('[data-watten-match-progress-action=dismiss]')).toBeHidden();
      await own.page.locator('.wt-final-call > summary').click();
      await expect(own.page.locator('[data-watten-match-progress-action=dismiss]')).toBeVisible();
      await expect(own.page.locator('.wt-seat-public-title')).toHaveCount(2);
      const account = await (await own.context.request.get('/api/watten/account')).json();
      expect(account.statistics.all_matches).toBe(1);
      expect(account.progress.total_xp).toBeGreaterThan(10);
      expect(account.progress.pending.credits).toHaveLength(1);
      await own.page.locator('[data-watten-match-result] a[href="/watten/konto/fortschritt"]').click();
      await expect(own.page).toHaveURL(/\/watten\/konto\/fortschritt$/);
      await expect(own.page.locator('#wattenProgress > h1')).toHaveText(language === 'de' ? 'Erfolge & Titel' : 'Achievements & titles');
      await expect(own.page.locator('html')).toHaveAttribute('lang', language);
      await expect(own.page.locator('.wt-progress-title h2')).toHaveText(account.progress.title.name[language]);
      const goals = account.progress.achievements;
      const earned = goals.filter(item => item.unlocked);
      await expect(own.page.locator('.wt-achievement-grid > li')).toHaveCount(goals.length);
      const ladder = own.page.locator('.wt-title-ladder');
      await expect(ladder).not.toHaveAttribute('open');
      await usableControl(ladder.locator('summary'));
      await ladder.locator('summary').click();
      await expect(ladder.locator('li')).toHaveCount(account.progress.titles.length);
      await expect(ladder.locator('[aria-current=step] strong')).toHaveText(account.progress.title.name[language]);
      expect(await ladder.locator('li strong').allTextContents()).toEqual(account.progress.titles.map(item => item.name[language]));
      await ladder.screenshot({ path: testInfo.outputPath('titles-expanded.png') });
      await ladder.locator('summary').click();
      await own.page.locator('[data-account-destination=achievements]').click();
      await expect(own.page.locator('.wt-feed')).toContainText(own.user.username);
      await expect(own.page.locator('[data-progress-action=acknowledge]')).toBeVisible();
      const acknowledgements = [];
      own.page.on('request', request => {
        if (request.method() === 'POST' && request.url().endsWith('/api/watten/account/acknowledge')) acknowledgements.push(request.postDataJSON());
      });
      await own.page.locator('[data-achievement-status=earned]').click();
      await expect(own.page.locator('.wt-achievement-grid > li')).toHaveCount(earned.length);
      const firstEarned = own.page.locator(`#${earned[0].id} summary`);
      await firstEarned.focus(); await own.page.keyboard.press('Enter');
      await expect(own.page.locator(`#${earned[0].id} details`)).toHaveAttribute('open');
      await expect(own.page.locator(`#${earned[0].id} time`)).toHaveAttribute('datetime', earned[0].earned_at);
      await own.page.locator('[data-achievement-status=open]').click();
      for (const category of account.progress.achievement_categories) {
        await own.page.locator('[data-achievement-category]').selectOption(category);
        await expect(own.page.locator('.wt-achievement-grid > li')).toHaveCount(goals.filter(item => !item.unlocked && item.category === category).length);
      }
      const linkedGoal = goals.find(item => !item.unlocked && item.category !== 'surprises');
      await own.page.evaluate(id => { location.hash = id; }, linkedGoal.id);
      await expect(own.page.locator('[data-achievement-status=all]')).toHaveAttribute('aria-pressed', 'true');
      await expect(own.page.locator(`#${linkedGoal.id} details`)).toHaveAttribute('open');
      await expect(own.page.locator(`#${linkedGoal.id} summary`)).toBeFocused();
      await own.page.locator('[data-achievement-status=earned]').click();
      await own.page.locator('[data-achievement-category]').selectOption('surprises');
      await expect(own.page.locator('[data-achievement-empty]')).toBeVisible();
      await own.page.locator('[data-achievement-reset]').focus(); await own.page.keyboard.press('Enter');
      await expect(own.page.locator('[data-achievement-status=all]')).toBeFocused();
      await own.page.keyboard.press('Tab');
      await expect(own.page.locator('[data-achievement-status=earned]')).toBeFocused();
      expect(await own.page.locator('[data-achievement-status=earned]').evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
      expect(acknowledgements).toEqual([]);
      expect((await (await own.context.request.get('/api/watten/account')).json()).progress.pending).toEqual(account.progress.pending);
      for (const viewport of [{ width: 320, height: 568 }, { width: 568, height: 320 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }, { width: 1280, height: 800 }]) {
        await own.page.setViewportSize(viewport);
        expect(await own.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        for (const selector of ['[data-achievement-status=all]', '[data-achievement-category]', '.wt-achievement-grid > li:first-child summary', '[data-progress-action=acknowledge]']) await usableControl(own.page.locator(selector));
        const overlap = await own.page.locator('.wt-achievement-grid summary').evaluateAll(nodes => nodes.some(node => {
          const name = node.querySelector('.wt-achievement-copy').getBoundingClientRect();
          const points = node.querySelector('.wt-achievement-points').getBoundingClientRect();
          return name.right > points.left || Math.max(name.left, points.left) < 0 || points.right > innerWidth;
        }));
        expect(overlap).toBe(false);
        await own.page.evaluate(() => scrollTo(0, 0));
        await own.page.screenshot({ path: testInfo.outputPath(`progress-${viewport.width}x${viewport.height}.png`), fullPage: true });
        await own.page.screenshot({ path: testInfo.outputPath(`progress-${viewport.width}x${viewport.height}-viewport.png`) });
        await own.page.locator('.wt-achievement-collection').evaluate(node => {
          const headerHeight = document.querySelector('.wt-header').getBoundingClientRect().height;
          scrollTo(0, node.getBoundingClientRect().top + scrollY - headerHeight - 16);
        });
        await own.page.screenshot({ path: testInfo.outputPath(`collection-${viewport.width}x${viewport.height}.png`) });
        if (viewport.width === 320) {
          await ladder.locator('summary').click();
          await expect(ladder.locator('li')).toHaveCount(22);
          expect(await own.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
          expect(await ladder.locator('li').evaluateAll(nodes => nodes.every(node => {
            const bounds = node.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= innerWidth;
          }))).toBe(true);
          await ladder.screenshot({ path: testInfo.outputPath('titles-expanded-320.png') });
          await ladder.locator('summary').click();
        }
      }
      await own.page.locator('[data-progress-action=acknowledge]').click();
      expect(acknowledgements).toEqual([{ generation: account.progress.generation, through_sequence: account.progress.grant_sequence }]);
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
      await expect(own.page.locator('.wt-progress-tabs a[href="/watten/konto/fortschritt"]')).toHaveText(language === 'de' ? 'Erfolge & Titel' : 'Achievements & titles');
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
    await own.page.locator('[data-account-destination=achievements]').click();
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
  let intercepted = false;
  try {
    let attempted;
    await own.page.route('**/api/watten/account', async route => {
      if (intercepted) { await route.continue(); return; }
      intercepted = true;
      attempted = route.request().headers()['x-watten-expected-account-id'];
      await new Promise(resolve => { unblock = resolve; });
      // Use the context's current cookie jar after the second tab switched it.
      const response = await own.context.request.get('/api/watten/account', {
        headers: { 'X-Watten-Expected-Account-Id': attempted },
      });
      await route.fulfill({ response });
    });
    await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
    await expect.poll(() => !!unblock).toBe(true);
    expect(attempted).toBe(String(own.user.id));
    await own.context.clearCookies();
    await own.context.addCookies(await players[1].context.cookies());
    const guard = own.page.waitForResponse(response => response.url().includes('/api/watten/account') && response.status() === 409);
    unblock(); unblock = null;
    await guard;
    await expect(own.page.locator('.wt-progress-title')).toContainText('0 XP');
    expect(own.traffic.errors).toEqual([]);
  } finally { unblock?.(); await Promise.allSettled(players.map(item => item.context.close())); }
});

test('a match reward dismissal survives reload and leaves a previous unseen match pending', async ({ browser, baseURL }) => {
  const players = [await player(browser, baseURL), await player(browser, baseURL)];
  const own = players[0];
  try {
    const older = await finish(players);
    await own.page.locator('.wt-final-call > summary').click();
    await expect(own.page.locator('[data-watten-match-progress-action=dismiss]')).toBeVisible();
    const current = await finish(players);
    await own.page.locator('.wt-final-call > summary').click();
    await own.page.locator('[data-watten-match-progress-action=dismiss]').click();
    await expect(own.page.locator('[data-watten-match-progress]')).toBeHidden();
    await own.page.reload();
    await expect(own.page.locator('[data-watten-match-result]')).toBeVisible({ timeout: 10000 });
    await expect(own.page.locator('[data-watten-match-progress]')).toBeHidden();
    const account = await (await own.context.request.get('/api/watten/account')).json();
    expect(account.progress.pending.credits.map(item => item.game_id)).toEqual([older.split('/').pop()]);
    expect(account.history.matches.map(item => item.game_id)).toContain(current.split('/').pop());
    expect(account.progress.acknowledged_sequence).toBe(0);
    expect(own.traffic.errors).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

test('a future catalog pending grant keeps its archive label instead of claiming a locked current goal', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  try {
    const account = await (await own.context.request.get('/api/watten/account')).json();
    const goal = account.progress.achievements.find(item => item.id === 'watten_quiet_win');
    expect(goal.unlocked).toBe(false);
    account.progress.pending.achievements = [{ id: goal.id, source_game_id: 'aaaaaaaaaaaaaaaa', sequence: 1, xp: 73 }];
    account.progress.archived_achievements = [{ id: goal.id, name: { de: 'Gespeicherter Watten-Erfolg', en: 'Stored Watten achievement' },
      granted_xp: 73, earned_at: '2026-10-01T12:00:00+00:00', catalog_version: 999 }];
    account.progress.grant_sequence = 1;
    await own.page.route('**/api/watten/account', route => route.fulfill({ json: account }));
    await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
    const pending = own.page.locator('[data-progress-pending]');
    await expect(pending).toContainText('Gespeicherter Watten-Erfolg');
    await expect(pending).not.toContainText(goal.name.de);
    await expect(own.page.locator(`#${goal.id} summary`)).toContainText('Noch offen');
    await expect(own.page.locator(`#${goal.id} summary`)).not.toContainText('73');
    expect(own.traffic.errors).toEqual([]);
  } finally { await own.context.close(); }
});

for (const language of ['de', 'en']) {
  test(`${language}: historical credited XP and first date stay distinct from a current catalogue reward`, async ({ browser, baseURL }, testInfo) => {
    const own = await player(browser, baseURL, language);
    try {
      const account = await (await own.context.request.get('/api/watten/account')).json();
      const goal = account.progress.achievements.find(item => item.id === 'watten_matches_1');
      goal.unlocked = true; goal.progress = 1; goal.granted_xp = 73; goal.earned_at = '2026-10-01T12:00:00+00:00';
      account.progress.total_xp = account.progress.achievement_xp = 73;
      account.progress.title = account.progress.titles.filter(item => item.threshold <= 73).at(-1);
      account.progress.next_title = account.progress.titles.find(item => item.threshold > 73);
      account.progress.xp_to_next = account.progress.next_title.threshold - 73;
      await own.page.setViewportSize({ width: 320, height: 568 });
      await own.page.route('**/api/watten/account', route => route.fulfill({ json: account }));
      await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
      const card = own.page.locator(`#${goal.id}`);
      await expect(card.locator('summary')).toContainText(language === 'de' ? '73 XP verbucht' : '73 XP credited');
      await expect(card.locator('summary')).not.toContainText('10 XP');
      await card.locator('summary').click();
      await expect(card.locator('time')).toHaveAttribute('datetime', goal.earned_at);
      await expect(card.locator('.wt-achievement-body')).toContainText(goal.description[language]);
      await expect(own.page.locator('.wt-progress-total')).toContainText('73');
      await expect(own.page.locator('.wt-progress-next')).toContainText('17');
      await card.evaluate(node => node.scrollIntoView({ block: 'center' }));
      await own.page.screenshot({ path: testInfo.outputPath('historical-earned-320x568.png') });
      expect(own.traffic.errors).toEqual([]);
    } finally { await own.context.close(); }
  });
}

test('zero and top-title views use the authoritative ladder without a phantom next title', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  try {
    const account = await (await own.context.request.get('/api/watten/account')).json();
    await own.page.route('**/api/watten/account', route => route.fulfill({ json: account }));
    await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
    await expect(own.page.locator('.wt-progress-total')).toContainText('0');
    await own.page.locator('[data-achievement-status=earned]').click();
    await expect(own.page.locator('[data-achievement-empty]')).toBeVisible();
    await expect(own.page.locator('[data-progress-action=acknowledge]')).toHaveCount(0);
    account.progress.title = account.progress.titles.at(-1);
    account.progress.total_xp = account.progress.match_xp = account.progress.title.threshold;
    account.progress.next_title = null; account.progress.xp_to_next = 0;
    await own.page.reload();
    await expect(own.page.locator('.wt-progress-title h2')).toHaveText(account.progress.title.name.de);
    await expect(own.page.locator('.wt-progress-next')).toContainText('höchste Titelstufe');
    await expect(own.page.locator('.wt-progress-next progress')).toHaveCount(0);
    await own.page.locator('.wt-title-ladder > summary').click();
    await expect(own.page.locator('.wt-title-ladder [aria-current=step] strong')).toHaveText(account.progress.title.name.de);
    await expect(own.page.locator('[data-achievement-status=all]')).toHaveAttribute('aria-pressed', 'true');
    expect(own.traffic.errors).toEqual([]);
  } finally { await own.context.close(); }
});

test('pagehide clears private filters and a late feed; persisted pageshow reloads fresh progress', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  let unblock, completed;
  try {
    await own.page.route('**/api/watten/achievements/feed?**', async route => {
      await new Promise(resolve => { unblock = resolve; });
      try { await route.fulfill({ json: { schema_version: 1, game_type: 'watten', coverage: { complete: true },
        entries: [], pagination: { has_next: false, has_previous: false } } }); }
      catch { /* pagehide aborts the pending request. */ }
      completed?.();
    });
    await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
    await expect.poll(() => !!unblock).toBe(true);
    await own.page.locator('[data-achievement-status=earned]').click();
    await expect(own.page.locator('[data-achievement-empty]')).toBeVisible();
    await own.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    await expect(own.page.locator('#wattenProgress')).toBeEmpty();
    const completion = new Promise(resolve => { completed = resolve; });
    unblock(); unblock = null; await completion;
    await own.page.evaluate(() => { location.hash = '#watten_matches_1'; });
    await expect(own.page.locator('#wattenProgress')).toBeEmpty();
    await own.page.unroute('**/api/watten/achievements/feed?**');
    await own.page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await expect(own.page.locator('.wt-progress-total')).toContainText('0');
    await expect(own.page.locator('[data-achievement-status=all]')).toHaveAttribute('aria-pressed', 'true');
    await expect(own.page.locator('.wt-achievement-grid .is-earned')).toHaveCount(0);
    expect(own.traffic.errors).toEqual([]);
  } finally { unblock?.(); await own.context.close(); }
});

test('retrying a failed feed page does not skip the missing page', async ({ browser, baseURL }) => {
  const own = await player(browser, baseURL);
  const pages = [];
  try {
    const base = await (await own.context.request.get('/api/watten/achievements/feed')).json();
    let failed = false;
    await own.page.route('**/api/watten/achievements/feed?**', async route => {
      const page = Number(new URL(route.request().url()).searchParams.get('page')); pages.push(page);
      if (page === 2 && !failed) {
        failed = true; await route.fulfill({ status: 503, json: { detail: 'unavailable' } }); return;
      }
      await route.fulfill({ json: { ...base, pagination: { page, limit: 12, total_entries: 25,
        total_pages: 3, has_next: page < 3, has_previous: page > 1 } } });
    });
    await own.page.goto('/watten/konto/fortschritt');
    await own.page.locator('[data-account-destination=achievements]').click();
    const next = own.page.locator('[data-progress-action=feed-next]');
    await expect(next).toBeEnabled(); await next.click();
    await expect(own.page.locator('[data-progress-error]')).toContainText('nicht vollständig');
    await next.click();
    await expect(own.page.locator('[data-progress-action=feed-previous]')).toBeVisible();
    expect(pages).toEqual([1, 2, 2]);
    expect(own.traffic.errors).toEqual([]);
  } finally { await own.context.close(); }
});
