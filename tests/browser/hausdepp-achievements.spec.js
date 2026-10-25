const { test, expect } = require('@playwright/test');
const { mkdir } = require('node:fs/promises');

test.use({ serviceWorkers: 'block' });

async function owner(page, language = 'de') {
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  page.hausdeppAchievementOwner = { headers, language: user.preferences?.preferred_language || 'de' };
  await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } });
  await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
  const account = await page.request.get('/api/hausdepp/account');
  expect(account.ok()).toBeTruthy();
  return account.json();
}

test.afterEach(async ({ page }) => {
  const saved = page.hausdeppAchievementOwner;
  if (saved) await page.request.put('/api/auth/preferences/language', {
    headers: saved.headers, data: { preferred_language: saved.language },
  });
});

const local = (value, language) => typeof value === 'object' ? value[language] : value;
const surpriseEffects = ['star', 'hammer', 'ufo', 'portal', 'dragon', 'kraken', 'clock', 'blackhole', 'four', 'all'];

function labelledSurpriseScenario(account, complete = false) {
  const data = structuredClone(account);
  const unlocked = new Set(complete ? Array.from({ length: 20 }, (_, index) => `hausdepp_${index + 116}`)
    : [116, 117, 118, 119, 124, 126, 127, 128, 129, 134].map(number => `hausdepp_${number}`));
  for (const item of data.achievements.items) {
    item.unlocked = unlocked.has(item.id);
    item.unlocked_at = item.unlocked ? '2026-10-18T12:00:00+00:00' : null;
    item.progress.current = item.unlocked ? item.progress.target : ['hausdepp_125', 'hausdepp_135'].includes(item.id) ? 4 : 0;
  }
  const achievementPoints = data.achievements.items.filter(item => item.unlocked).reduce((sum, item) => sum + item.points, 0);
  const points = 10 + achievementPoints, index = data.ranks.findLastIndex(rank => rank.threshold <= points);
  data.rank = { ...data.ranks[index], next: data.ranks[index + 1], progress: {
    current: points - data.ranks[index].threshold, target: data.ranks[index + 1].threshold - data.ranks[index].threshold,
    percent: (points - data.ranks[index].threshold) / (data.ranks[index + 1].threshold - data.ranks[index].threshold) * 100,
  } };
  data.scoring = { ...data.scoring, available: true, points, round_points: 10, achievement_points: achievementPoints };
  data.achievements.unlocked_count = unlocked.size;
  data.presentation = { revision: 9501, pending: null };
  return data;
}

function surpriseCompletionReceipt(data) {
  return { revision: 9501, through_points: data.scoring.points, points_earned: 750,
    achievement_ids: ['hausdepp_125', 'hausdepp_135'], rank_up: false, from_rank: data.rank, to_rank: data.rank };
}

async function expectNarrowContent(page, selector) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const overflows = await page.locator(selector).evaluateAll(elements => elements.filter(element => element.checkVisibility())
    .map(element => ({ id: element.dataset.achievementId || element.className, box: element.getBoundingClientRect(),
      overflow: element.scrollWidth - element.clientWidth }))
    .filter(({ box, overflow }) => box.left < -1 || box.right > innerWidth + 1 || overflow > 1)
    .map(({ id, overflow }) => ({ id, overflow })));
  expect(overflows).toEqual([]);
}

// Explicit renderer scenario, derived from the shipped catalogue. It never
// awards points or achievements to the private test server's real account.
function labelledNewtonScenario(account) {
  const data = structuredClone(account);
  const first = data.achievements.items[0];
  const second = data.achievements.items[20];
  const achievementPoints = first.points + second.points;
  const points = 30 + achievementPoints;
  for (const item of data.achievements.items) {
    item.unlocked = [first.id, second.id].includes(item.id);
    item.unlocked_at = item.unlocked ? '2026-10-16T12:00:00+00:00' : null;
    item.progress.current = item.unlocked ? item.progress.target : 0;
  }
  data.scoring = { available: true, points, round_points: 30, achievement_points: achievementPoints, round_reward: 10 };
  const rank = structuredClone(data.ranks[2]);
  rank.next = structuredClone(data.ranks[3]);
  rank.progress = { current: points - rank.threshold, target: rank.next.threshold - rank.threshold, percent: (points - rank.threshold) / (rank.next.threshold - rank.threshold) * 100 };
  data.rank = rank;
  data.achievements.unlocked_count = 2;
  data.presentation = { pending: {
    revision: points, through_points: points, from_rank: data.ranks[0], to_rank: rank,
    points_earned: points, achievement_ids: [first.id, second.id], rank_up: true,
    message: { de: 'Gratuliere! Dem Hausdepp wieder einen Schritt näher.', en: 'Congratulations! One step closer to Hausdepp.' },
    quote: rank.quote,
  } };
  return data;
}

for (const language of ['de', 'en']) {
  test(`${language}: real account exposes all 138 private achievements and the 24-rank ladder`, async ({ page }) => {
    const data = await owner(page, language);
    expect(data.achievements.total).toBe(138);
    expect(data.achievements.items.reduce((sum, item) => sum + item.points, 0)).toBe(5705);
    expect(data.ranks.at(-1).threshold).toBe(9000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/hausdepp/konto#erfolge');
    await expect(page.locator('#hausdeppAchievementCount')).toContainText('/ 138');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
    await expect(page.locator('.hd-achievement-group')).toHaveCount(15);
    await expect(page.locator('#hausdeppRankTitle')).toHaveText(local(data.rank.name, language));
    await expect(page.locator('.hd-xp-breakdown')).toContainText(language === 'de' ? 'Aus abgeschlossenen Runden' : 'From completed rounds');
    await page.locator('.hd-rank-ladder > summary').click();
    await expect(page.locator('.hd-rank-ladder li')).toHaveCount(24);
    await expect(page.locator('.hd-rank-ladder li').first()).toContainText('Einstein');
    await expect(page.locator('.hd-rank-ladder li').last()).toContainText('Hausdepp');
    await expect(page.locator('.hd-rank-ladder li').nth(2)).toContainText(language === 'de' ? 'Ab jetzt geht’s bergab. Ganz nach den Naturgesetzen.' : local(data.ranks[2].quote, language));
    await expect(page.locator('.hd-rank-ladder [aria-current="step"]')).toHaveCount(1);
    const search = data.achievements.items[24];
    await page.locator('#hausdeppAchievementSearch').fill(local(search.name, language));
    await expect(page.locator('.hd-achievement-card')).toHaveCount(1);
    await expect(page.locator('.hd-achievement-card')).toContainText(local(search.description, language));
    await page.locator('#hausdeppAchievementSearch').fill('no-matching-achievement-xyz');
    await expect(page.locator('#hausdeppAchievementReset')).toBeVisible();
    await page.locator('#hausdeppAchievementReset').click();
    await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
    await expect(page.locator('#hausdeppAchievementSearch')).toBeFocused();
    await page.locator('#hausdeppAchievementCategory').selectOption('mishaps');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(8);
    await expect(page.locator('.hd-achievement-group')).toHaveCount(1);
    await expect(page.locator('.hd-achievement-group')).toHaveAttribute('open', '');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    expect(errors).toEqual([]);
  });

  test(`${language}: labelled rank-up combines skipped levels and awards with durable acknowledgement`, async ({ page }) => {
    const data = labelledNewtonScenario(await owner(page, language));
    let pending = true;
    let acknowledged;
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: {
      ...data, presentation: { pending: pending ? data.presentation.pending : null },
    } }));
    await page.route('**/api/hausdepp/account/acknowledge', async route => {
      acknowledged = route.request().postDataJSON();
      pending = false;
      await route.fulfill({ json: { acknowledged: true } });
    });
    await page.goto('/hausdepp/konto#erfolge');
    const notice = page.locator('#hausdeppProgressNotice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('Newton');
    await expect(notice).toContainText(local(data.rank.quote, language));
    await expect(notice.locator('h3')).toHaveCount(1);
    await expect(notice).toContainText(language === 'de' ? '2 Stufen' : '2 ranks');
    await notice.locator('summary').click();
    await expect(notice.locator('li')).toHaveCount(2);
    await page.locator('#hausdeppAchievementStatus').selectOption('unlocked');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(2);
    await page.locator('#hausdeppAchievementStatus').selectOption('locked');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(data.achievements.items.filter(item => !item.unlocked).length);
    await notice.locator('[data-progress-ack]').click();
    await expect(notice).toBeHidden();
    expect(acknowledged).toEqual({ revision: data.presentation.pending.revision });
    await expect(page.locator('#hausdeppRankTitle')).toBeFocused();
    await page.reload();
    await expect(page.locator('#hausdeppRankTitle')).toHaveText('Newton');
    await expect(notice).toBeHidden();
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: each theme shows unlocked achievements first with stable card order and combined filters`, async ({ page }) => {
    const data = structuredClone(await owner(page, language));
    const unlocked = new Set(['hausdepp_02', 'hausdepp_05', 'hausdepp_10', 'hausdepp_16', 'hausdepp_100']);
    // Renderer-only scenario. Keep all approved IDs, categories, point values
    // and translations, but deliberately reverse the incoming catalogue.
    data.achievements.items.reverse();
    for (const item of data.achievements.items) {
      item.unlocked = unlocked.has(item.id);
      item.unlocked_at = item.unlocked ? '2026-10-16T12:00:00+00:00' : null;
      item.progress.current = item.unlocked ? item.progress.target : 0;
    }
    data.achievements.unlocked_count = unlocked.size;
    data.presentation.pending = null;
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
    await page.goto('/hausdepp/konto#erfolge');
    const group = category => page.locator(`.hd-achievement-group[data-category="${category}"]`);
    const order = category => group(category).locator('.hd-achievement-card').evaluateAll(cards => cards.map(card => card.dataset.achievementId));
    const ids = numbers => numbers.map(number => `hausdepp_${String(number).padStart(2, '0')}`);
    await expect(page.locator('.hd-achievement-group')).toHaveCount(15);
    await expect(page.locator('.hd-achievement-controls select')).toHaveCount(2);
    await expect.poll(() => order('participation')).toEqual(ids([2, 5, 1, 3, 4, 6, 7, 8]));
    await expect.poll(() => order('community')).toEqual(ids([10, 16, 9, 11, 12, 13, 14, 15]));
    await expect.poll(() => order('tournament')).toEqual(ids([100, ...Array.from({ length: 15 }, (_, index) => index + 85)]));
    await expect(group('participation').locator('.hd-achievement-group-count')).toHaveText('2 / 8');
    await expect(group('community').locator('.hd-achievement-group-count')).toHaveText('2 / 8');
    await page.locator('#hausdeppAchievementCategory').selectOption('participation');
    await expect(group('participation').locator('h3').first()).toHaveText(language === 'de' ? 'Stammtisch gefunden' : 'Found your table');
    await page.locator('#hausdeppAchievementStatus').selectOption('unlocked');
    await expect.poll(() => order('participation')).toEqual(ids([2, 5]));
    await page.locator('#hausdeppAchievementStatus').selectOption('locked');
    await expect.poll(() => order('participation')).toEqual(ids([1, 3, 4, 6, 7, 8]));
    const fourth = data.achievements.items.find(item => item.id === 'hausdepp_04');
    await page.locator('#hausdeppAchievementSearch').fill(local(fourth.name, language));
    await expect.poll(() => order('participation')).toEqual(ids([4]));
    await page.locator('#hausdeppAchievementStatus').selectOption('unlocked');
    await page.locator('#hausdeppAchievementReset').click();
    await expect(page.locator('#hausdeppAchievementCategory')).toHaveValue('all');
    await expect(page.locator('#hausdeppAchievementStatus')).toHaveValue('all');
    await expect(page.locator('#hausdeppAchievementSearch')).toHaveValue('');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
    await expect(page.locator('.hd-achievement-group')).toHaveCount(15);
    await expect.poll(() => order('participation')).toEqual(ids([2, 5, 1, 3, 4, 6, 7, 8]));
    await expect.poll(() => order('community')).toEqual(ids([10, 16, 9, 11, 12, 13, 14, 15]));
  });
}

for (const language of ['de', 'en']) {
  test(`${language}: CPU rounds keep whole points while rank receipts use opaque integer revisions`, async ({ page }) => {
    const data = structuredClone(await owner(page, language));
    const awards = [25, 50].map(points => data.achievements.items.find(item => item.points === points));
    for (const item of data.achievements.items) {
      item.unlocked = awards.includes(item);
      item.unlocked_at = item.unlocked ? '2026-10-16T12:00:00+00:00' : null;
      item.progress.current = item.unlocked ? item.progress.target : 0;
    }
    data.achievements.unlocked_count = 2;
    data.scoring = { available: true, points: 77, round_points: 2, achievement_points: 75,
      round_reward: 10, cpu_round_reward: 2, cpu_reduction_percent: 75 };
    const index = data.ranks.findLastIndex(rank => rank.threshold <= 77);
    data.rank = { ...data.ranks[index], next: data.ranks[index + 1], progress: {
      current: 77 - data.ranks[index].threshold,
      target: data.ranks[index + 1].threshold - data.ranks[index].threshold,
      percent: (77 - data.ranks[index].threshold) / (data.ranks[index + 1].threshold - data.ranks[index].threshold) * 100,
    } };
    data.presentation = { revision: 9001, pending: { revision: 9001, through_points: 77,
      points_earned: 2, from_rank: data.rank, to_rank: data.rank, rank_up: false, achievement_ids: [] } };
    const receipts = [];
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
    await page.route('**/api/hausdepp/account/acknowledge', route => {
      receipts.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    });
    await page.goto('/hausdepp/konto#erfolge');
    const suffix = language === 'de' ? 'EP' : 'XP';
    await expect(page.locator('.hd-xp-total strong')).toHaveText('77');
    await expect(page.locator('.hd-xp-breakdown dd').first()).toHaveText(`2 ${suffix}`);
    await expect(page.locator('.hd-xp-breakdown dd').last()).toHaveText(`75 ${suffix}`);
    await expect(page.locator('.hd-rank-progress-label strong')).toContainText(`${data.rank.next.threshold - 77}`);
    await expect(page.locator('.hd-notice-reward')).toHaveText(`+2 ${suffix}`);
    await expect(page.locator('.hd-xp-guide')).toContainText('75%');
    await expect(page.locator('.hd-xp-guide')).toContainText(language === 'de' ? 'vollen Punkten' : 'full one-time rewards');
    await page.locator('[data-progress-ack]').click();
    expect(receipts).toEqual([{ revision: 9001 }]);
    data.presentation = { revision: 9002, pending: { revision: 9002, through_points: 77,
      points_earned: null, from_rank: null, to_rank: data.rank, rank_up: null, achievement_ids: [] } };
    await page.reload();
    await expect(page.locator('#hausdeppProgressNotice h3')).toHaveText(language === 'de' ? 'Dein Fortschritt ist gespeichert.' : 'Your progress is saved.');
    await expect(page.locator('#hausdeppProgressNotice .hd-notice-reward')).toHaveCount(0);
    await expect(page.locator('#hausdeppProgressNotice')).not.toContainText('+0');
    await page.locator('[data-progress-ack]').click();
    expect(receipts).toEqual([{ revision: 9001 }, { revision: 9002 }]);
  });
}

test('labelled acknowledgement failure keeps the summary and offers the same action again', async ({ page }) => {
  const data = labelledNewtonScenario(await owner(page));
  await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
  let attempts = 0;
  await page.route('**/api/hausdepp/account/acknowledge', route => {
    attempts += 1;
    return route.fulfill({ status: attempts === 1 ? 503 : 200, json: { acknowledged: attempts > 1 } });
  });
  await page.goto('/hausdepp/konto#erfolge');
  const notice = page.locator('#hausdeppProgressNotice');
  await notice.locator('[data-progress-ack]').click();
  await expect(notice.locator('.hd-notice-error')).toBeVisible();
  await expect(notice.locator('[data-progress-ack]')).toBeEnabled();
  await notice.locator('[data-progress-ack]').click();
  await expect(notice).toBeHidden();
  expect(attempts).toBe(2);
});

test('labelled final rank remains meaningful and achievement text is escaped', async ({ page }) => {
  const data = await owner(page);
  const rank = structuredClone(data.ranks.at(-1));
  rank.next = null; rank.progress = { current: 0, target: 0, percent: 100 };
  data.rank = rank;
  data.scoring = { available: true, points: 9000, round_points: 9000, achievement_points: 0, round_reward: 10 };
  data.presentation.pending = null;
  data.achievements.items[0].name = { de: '<img src=x onerror=alert(1)>', en: '<img src=x onerror=alert(1)>' };
  data.achievements.items[0].description = { de: '<script>Keine fremden Karten</script>', en: '<script>No private cards</script>' };
  await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
  await page.goto('/hausdepp/konto#erfolge');
  await expect(page.locator('#hausdeppRankTitle')).toHaveText('Hausdepp');
  await expect(page.locator('.hd-rank-progress')).toContainText('Mehr Hausdepp geht nicht.');
  await expect(page.locator('.hd-rank-progress progress')).toHaveAttribute('value', '100');
  await expect(page.locator('.hd-achievement-card').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.hd-achievement-card img, .hd-achievement-card script')).toHaveCount(0);
});

test('narrow account displays complete status and long category names', async ({ page }) => {
  await owner(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/hausdepp/konto#erfolge');
  await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
  await page.locator('#hausdeppAchievementCategory').selectOption('tournament');
  await expect(page.locator('.hd-achievement-card')).toHaveCount(16);
  const bounds = await page.locator('#hausdeppAchievementStatus, #hausdeppAchievementCategory').evaluateAll(selects => selects.map(select => {
    const style = getComputedStyle(select);
    const context = document.createElement('canvas').getContext('2d');
    context.font = style.font;
    const text = select.selectedOptions[0].textContent;
    return { width: select.getBoundingClientRect().width, required: context.measureText(text).width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 35 };
  }));
  for (const bound of bounds) expect(bound.width).toBeGreaterThanOrEqual(bound.required);
});

for (const language of ['de', 'en']) {
  test(`${language}: both surprise collections show ten distinct badges and four-of-eight progress on a 320px phone`, async ({ page }, testInfo) => {
    const data = labelledSurpriseScenario(await owner(page, language));
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
    await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 9501, points: data.scoring.points } }));
    await page.goto('/hausdepp/konto#erfolge');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
    for (const [track, start, label] of [
      ['activated', 116, language === 'de' ? 'Funde ausgelöst' : 'Finds you triggered'],
      ['witnessed', 126, language === 'de' ? 'Funde miterlebt' : 'Finds you witnessed'],
    ]) {
      const group = page.locator(`.hd-achievement-group[data-category="surprises_${track}"]`);
      await expect(group.locator('summary')).toContainText(label);
      await expect(group.locator('.hd-achievement-card')).toHaveCount(10);
      await expect(group.locator('.hd-achievement-group-count')).toHaveText('5 / 10');
      await group.locator('summary').click();
      for (const [index, effect] of surpriseEffects.entries()) {
        const card = group.locator(`[data-achievement-id="hausdepp_${start + index}"]`);
        const badge = card.locator('.hd-surprise-badge');
        await expect(badge).toHaveAttribute('data-surprise-badge', effect);
        await expect(badge).toHaveAttribute('data-surprise-track', track);
        await expect(badge).toHaveAttribute('aria-hidden', 'true');
        await expect(badge).toHaveAttribute('focusable', 'false');
        await expect(badge.locator('[id], script, foreignObject')).toHaveCount(0);
      }
      const all = group.locator(`[data-achievement-id="hausdepp_${start + 9}"]`);
      await expect(all.locator('.hd-achievement-fraction')).toHaveText('4 / 8');
      await expect(all.locator('progress')).toHaveAttribute('value', '4');
      await expect(all.locator('progress')).toHaveAttribute('max', '8');
      await expect(all.locator('progress')).toHaveAttribute('aria-label', new RegExp(local(data.achievements.items.find(item => item.id === `hausdepp_${start + 9}`).name, language)));
    }
    await expect(page.locator('.hd-surprise-badge')).toHaveCount(20);
    await expect(page.locator('.hd-surprise-layer, .hd-table-prop')).toHaveCount(0);
    await expectNarrowContent(page, '.hd-achievement-card, .hd-surprise-badge, .hd-achievement-group > summary');
    await page.locator('[data-category="surprises_activated"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`surprise-collections-${language}-320.png`) });
    await page.locator('[data-category="surprises_witnessed"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`surprise-witnessed-${language}-320.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await expectNarrowContent(page, '.hd-achievement-card, .hd-surprise-badge, .hd-achievement-group > summary');
    await page.screenshot({ path: testInfo.outputPath(`surprise-collections-${language}-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 320, height: 568 });
    await page.locator('#hausdeppAchievementCategory').selectOption('surprises_witnessed');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(10);
    await expect(page.locator('.hd-surprise-badge[data-surprise-track="witnessed"]')).toHaveCount(10);
  });

  test(`${language}: full-collection bonuses keep their 500 and 250 XP badges in the account summary and feed without phone overflow`, async ({ page }, testInfo) => {
    const data = labelledSurpriseScenario(await owner(page, language), true);
    const receipt = surpriseCompletionReceipt(data), suffix = language === 'de' ? 'EP' : 'XP';
    const awards = receipt.achievement_ids.map(id => data.achievements.items.find(item => item.id === id));
    let pending = true;
    const acknowledgements = [];
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: {
      ...data, presentation: { revision: 9501, pending: pending ? receipt : null },
    } }));
    await page.route('**/api/hausdepp/account/acknowledge', route => {
      acknowledgements.push(route.request().postDataJSON()); pending = false;
      return route.fulfill({ json: { acknowledged: true } });
    });
    await page.route('**/api/hausdepp/progress-notices', route => route.fulfill({ json: { notices: [], revision: 9501, points: data.scoring.points } }));
    await page.goto('/hausdepp/konto#erfolge');
    const notice = page.locator('#hausdeppProgressNotice');
    await expect(notice).toBeVisible();
    await notice.locator('summary').click();
    await expect(notice.locator('li')).toHaveCount(2);
    await expect(notice.locator('li strong')).toHaveText([`+500 ${suffix}`, `+250 ${suffix}`]);
    await expect(notice.locator('[data-surprise-badge="all"]')).toHaveCount(2);
    await expect(notice.locator('[data-surprise-track="activated"]')).toHaveCount(1);
    await expect(notice.locator('[data-surprise-track="witnessed"]')).toHaveCount(1);
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    await expectNarrowContent(page, '.hd-progress-notice, .hd-notice-achievement');
    await notice.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`surprise-summary-${language}-320.png`) });
    await notice.locator('[data-progress-ack]').click();
    await expect(notice).toBeHidden();
    expect(acknowledgements).toEqual([{ revision: 9501 }]);
    await page.route('**/api/hausdepp/leaderboard?**', route => route.fulfill({ json: {
      ranking: 'finished_rounds', entries: [], total_players: 0,
    } }));
    await page.route('**/api/hausdepp/achievements/recent?**', route => route.fulfill({ json: {
      items: awards.map(achievement => ({ unlocked_at: '2026-10-18T12:00:00+00:00', achievement: { ...achievement, difficulty: 'hard' },
        player: { display_name: 'Stammtischfreundin mit dem vollen Kuriositätenkabinett', is_self: false } })),
      page: 1, page_size: 20, total: 2, pages: 1, has_previous: false, has_next: false, difficulty: null,
    } }));
    await page.goto('/hausdepp/rangliste');
    const feed = page.locator('#hausdeppAchievementFeed');
    await expect(feed.locator('[data-feed-item]')).toHaveCount(2);
    await expect(feed.locator('.hd-achievement-points')).toHaveText([`500 ${suffix}`, `250 ${suffix}`]);
    await expect(feed.locator('h3')).toHaveText(awards.map(item => local(item.name, language)));
    await expect(feed.locator('[data-surprise-badge="all"]')).toHaveCount(2);
    await expect(feed.locator('[data-surprise-track="activated"]')).toHaveCount(1);
    await expect(feed.locator('[data-surprise-track="witnessed"]')).toHaveCount(1);
    await expectNarrowContent(page, '.hd-feed-item, .hd-feed-copy, .hd-surprise-badge');
    await feed.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`surprise-feed-${language}-320.png`) });
    await page.goto('/hausdepp/konto#erfolge');
    await expect(page.locator('#hausdeppProgressNotice')).toBeHidden();
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    expect(acknowledgements).toEqual([{ revision: 9501 }]);
  });

  test(`${language}: triggered and witnessed completion popups acknowledge each award once without duplicating the inline summary`, async ({ page }) => {
    const data = labelledSurpriseScenario(await owner(page, language), true), receipt = surpriseCompletionReceipt(data);
    const awards = receipt.achievement_ids.map(id => data.achievements.items.find(item => item.id === id));
    const seen = new Set(), acknowledgements = [], summaries = [];
    let reads = 0, pending = true;
    await page.setViewportSize({ width: 320, height: 568 });
    await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: {
      ...data, presentation: { revision: 9501, pending: pending ? receipt : null },
    } }));
    await page.route('**/api/hausdepp/progress-notices', route => {
      reads += 1;
      return route.fulfill({ json: { revision: 9501, points: data.scoring.points,
        notices: awards.filter(item => !seen.has(item.id)).map(item => ({ key: `achievement:${item.id}`,
          kind: 'achievement', name: item.name, points: item.points, condition: item.description,
          reason: { de: 'Acht verschiedene Funde in abgeschlossenen Runden gesammelt.', en: 'Collected eight different finds in completed rounds.' },
        })),
      } });
    });
    await page.route('**/api/hausdepp/progress-notices/*/acknowledge', route => {
      const key = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-2));
      acknowledgements.push(key); seen.add(key.split(':')[1]);
      return route.fulfill({ json: { acknowledged: true, key } });
    });
    await page.route('**/api/hausdepp/account/acknowledge', route => {
      summaries.push(route.request().postDataJSON()); pending = false;
      return route.fulfill({ json: { acknowledged: true } });
    });
    await page.goto('/hausdepp/konto#erfolge');
    const dialog = page.locator('#appDialog');
    for (const item of awards) {
      await expect(dialog).toHaveAttribute('data-kind', 'hausdepp-achievement');
      await expect(dialog.locator('h3')).toHaveText(local(item.name, language));
      await expect(dialog.locator('.hd-notice-reward')).toHaveText(`+${item.points} ${language === 'de' ? 'EP' : 'XP'}`);
      await expect(page.locator('#appDialogBackdrop:not([hidden])')).toHaveCount(1);
      await expect(page.locator('#hausdeppProgressNotice')).toBeHidden();
      await expectNarrowContent(page, '#appDialog, #appDialog h3');
      await page.locator('[data-dialog-action="acknowledge"]').click();
    }
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    await expect.poll(() => summaries).toEqual([{ revision: 9501 }]);
    expect(acknowledgements).toEqual(['achievement:hausdepp_125', 'achievement:hausdepp_135']);
    await page.reload();
    await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    await expect(page.locator('#appDialogBackdrop')).toBeHidden();
    await expect(page.locator('#hausdeppProgressNotice')).toBeHidden();
    expect(acknowledgements).toEqual(['achievement:hausdepp_125', 'achievement:hausdepp_135']);
    expect(summaries).toEqual([{ revision: 9501 }]);
  });
}

test('capture labelled rank-up and real account across portrait and landscape', async ({ page }) => {
  test.skip(process.env.HAUSDEPP_ACHIEVEMENTS_CAPTURE !== '1', 'One explicit responsive evidence batch.');
  const real = await owner(page);
  const labelled = labelledNewtonScenario(real);
  await mkdir('.impeccable/review', { recursive: true });
  for (const [name, width, height] of [
    ['phone-portrait', 390, 844], ['phone-landscape', 844, 390], ['narrow-phone', 320, 568],
    ['tablet-portrait', 768, 1024], ['tablet-landscape', 1024, 768],
    ['desktop-portrait', 900, 1440], ['desktop-landscape', 1440, 900],
  ]) {
    await page.setViewportSize({ width, height });
    for (const [scenario, data] of [['real-account', real], ['labelled-rank-up', labelled]]) {
      await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
      await page.goto('/hausdepp/konto#erfolge');
      await expect(page.locator('.hd-achievement-card')).toHaveCount(138);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), `${name} ${scenario} overflow`).toBe(false);
      const undersized = await page.locator('.hd-achievement-controls input, .hd-achievement-controls select, .hd-rank-ladder > summary, [data-progress-ack]').evaluateAll(elements => elements.filter(element => !element.closest('[hidden]')).map(element => ({ label: element.id || element.textContent, height: element.getBoundingClientRect().height })).filter(element => element.height < 44));
      expect(undersized, `${name} ${scenario} touch targets`).toEqual([]);
      await page.screenshot({ path: `.impeccable/review/hausdepp-achievements-${scenario}-${name}.png`, fullPage: true });
      if (name === 'phone-portrait' && scenario === 'labelled-rank-up') {
        await page.locator('.hd-rank-ladder > summary').click();
        await page.locator('.hd-rank-ladder li').nth(2).scrollIntoViewIfNeeded();
        await page.screenshot({ path: '.impeccable/review/hausdepp-achievements-ladder-phone.png', fullPage: false });
        await page.locator('#hausdeppAchievementCategory').selectOption('cut_gamble');
        await page.locator('#erfolge').scrollIntoViewIfNeeded();
        await page.screenshot({ path: '.impeccable/review/hausdepp-achievements-search-phone.png', fullPage: false });
      }
      await page.unroute('**/api/hausdepp/account?**');
    }
  }
});
