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
  test(`${language}: real account exposes all 100 private achievements and the 24-rank ladder`, async ({ page }) => {
    const data = await owner(page, language);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/hausdepp/konto');
    await expect(page.locator('#hausdeppAchievementCount')).toContainText('/ 100');
    await expect(page.locator('.hd-achievement-card')).toHaveCount(100);
    await expect(page.locator('.hd-achievement-group')).toHaveCount(11);
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
    await expect(page.locator('.hd-achievement-card')).toHaveCount(100);
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
    await page.goto('/hausdepp/konto');
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
    await expect(page.locator('.hd-achievement-card')).toHaveCount(98);
    await notice.locator('[data-progress-ack]').click();
    await expect(notice).toBeHidden();
    expect(acknowledged).toEqual({ revision: data.presentation.pending.revision });
    await expect(page.locator('#hausdeppRankTitle')).toBeFocused();
    await page.reload();
    await expect(page.locator('#hausdeppRankTitle')).toHaveText('Newton');
    await expect(notice).toBeHidden();
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
  await page.goto('/hausdepp/konto');
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
  data.scoring = { available: true, points: 5000, round_points: 5000, achievement_points: 0, round_reward: 10 };
  data.presentation.pending = null;
  data.achievements.items[0].name = { de: '<img src=x onerror=alert(1)>', en: '<img src=x onerror=alert(1)>' };
  data.achievements.items[0].description = { de: '<script>Keine fremden Karten</script>', en: '<script>No private cards</script>' };
  await page.route('**/api/hausdepp/account?**', route => route.fulfill({ json: data }));
  await page.goto('/hausdepp/konto');
  await expect(page.locator('#hausdeppRankTitle')).toHaveText('Hausdepp');
  await expect(page.locator('.hd-rank-progress')).toContainText('Mehr Hausdepp geht nicht.');
  await expect(page.locator('.hd-rank-progress progress')).toHaveAttribute('value', '100');
  await expect(page.locator('.hd-achievement-card').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('.hd-achievement-card img, .hd-achievement-card script')).toHaveCount(0);
});

test('narrow account displays complete status and long category names', async ({ page }) => {
  await owner(page);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/hausdepp/konto');
  await expect(page.locator('.hd-achievement-card')).toHaveCount(100);
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
      await page.goto('/hausdepp/konto');
      await expect(page.locator('.hd-achievement-card')).toHaveCount(100);
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
