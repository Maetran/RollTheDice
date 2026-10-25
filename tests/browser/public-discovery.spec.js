const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

for (const width of [320, 768]) {
  test(`${width}px: rank catalogue and ranking explanation work before JavaScript`, async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({ baseURL, javaScriptEnabled: false,
      viewport: { width, height: width === 320 ? 720 : 1024 } });
    const page = await context.newPage();
    try {
      // The public catalogue contains no account information. Use the API only
      // as an independent test oracle; the browser itself has no scripting.
      const catalogueResponse = await context.request.get('/api/achievement-ranks');
      expect(catalogueResponse.ok()).toBeTruthy();
      const catalogue = await catalogueResponse.json();
      await page.goto('/rangabzeichen');
      const rows = page.locator('#rankLegendList > li');
      await expect(rows).toHaveCount(catalogue.ranks.length);
      for (const [index, rank] of catalogue.ranks.entries()) {
        await expect(rows.nth(index).locator('strong')).toHaveText(rank.title);
        await expect(rows.nth(index)).toHaveAttribute('data-rank-minimum', String(rank.minimum_points));
      }
      await expect(page.locator('#rankLegendSummary')).toContainText(String(catalogue.points_possible));
      await page.screenshot({ path: testInfo.outputPath(`initial-ranks-${width}.png`), fullPage: true });
      await page.goto('/spieler');
      const guide = page.locator('[data-public-ranking-guide]');
      await expect(guide).toBeVisible();
      await expect(guide).toContainText('Normal und Hardcore haben eigene Ranglisten.');
      await expect(page.locator('#rankingBody tr')).toHaveCount(0);
      await guide.getByRole('link', { name: 'Rangabzeichen & Ehrenberg-Marken' }).click();
      await expect(page).toHaveURL(/\/rangabzeichen$/);
      await expect(rows).toHaveCount(catalogue.ranks.length);
    } finally {
      await context.close();
    }
  });
}

test('public suite links survive real lobby hydration and stay outside the game root', async ({ page }) => {
  for (const path of ['/', '/hausdepp']) {
    await page.goto(path);
    const footer = page.locator('[data-public-suite-links]');
    await expect(footer).toBeVisible();
    await expect(footer.getByRole('link', { name: 'ZDWA', exact: true })).toHaveAttribute('href', 'https://zockdiewandan.online/');
    await expect(footer.getByRole('link', { name: 'Hausdepp', exact: true })).toHaveAttribute('href', 'https://hausdepp.zockdiewandan.online/hausdepp');
    if (path === '/hausdepp') {
      await expect(page.locator('#hausdeppApp [data-hausdepp-lobby-summary]')).toHaveCount(0);
      await expect(footer).toBeVisible();
      expect(await footer.evaluate(element => element.closest('#hausdeppApp') === null)).toBeTruthy();
    }
  }
  const login = await page.request.post('/api/auth/login', {
    data: { username: 'Admin', password: 'temporary-password-123' },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto('/konto');
  await expect(page.locator('[data-public-suite-links]')).toHaveCount(0);
});
