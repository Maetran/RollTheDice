const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

// Run against the explicit public-beta rollout. Preview-only pools deliberately
// have no public SSR documents; the language engine and SSR also have unit tests.
for (const language of ['de', 'en']) {
  test(`${language}: a guest keeps the public language through rules, login and an explicit language link`, async ({ page }) => {
    const other = language === 'en' ? 'de' : 'en';
    await page.addInitScript(value => {
      if (!sessionStorage.getItem('watten-public-language-test')) {
        localStorage.setItem('zdwa_language', value);
        sessionStorage.setItem('watten-public-language-test', 'true');
      }
    }, other);
    const query = language === 'en' ? '?lang=en' : '';
    await page.goto(`/watten${query}`);
    test.skip(await page.locator('html').getAttribute('data-watten-seo-language') === null, 'Requires the explicit public-beta SSR rollout');
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('zdwa_language'))).toBe(language);
    const guide = page.locator('[data-watten-lobby-guide]');
    await expect(guide).toBeVisible();
    await expect(guide.locator('h2')).toHaveText(language === 'en' ? 'Watten at a glance' : 'Watten kurz erklärt');
    await expect(guide).toContainText(language === 'en' ? 'Everyone receives five cards.' : 'Jede Person bekommt fünf Karten.');
    await expect(page.getByRole('link', { name: language === 'en' ? 'Read the house rules' : 'Hausregeln lesen', exact: true })).toHaveClass(/wt-button/);
    await expect(page.locator('[data-watten-nav] a[href^="/watten/regeln"]')).toHaveAttribute('href', `/watten/regeln${query}`);
    await page.getByRole('link', { name: language === 'en' ? 'Read the house rules' : 'Hausregeln lesen', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/watten/regeln${language === 'en' ? '\\?lang=en' : ''}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator(`article[lang="${language}"]`)).toBeVisible();
    await page.getByRole('link', { name: language === 'en' ? 'Sign in and play' : 'Anmelden und spielen', exact: true }).click();
    await expect(page).toHaveURL(/\/watten\/anmelden(?:\?|$)/);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.locator('h1')).toHaveText(language === 'en' ? 'Sign in to Watten' : 'Bei Watten anmelden');
    await expect(page.locator('.suite-header__brand')).toHaveAttribute('href', `/watten${query}`);
    await page.goBack();
    await page.locator(`a[hreflang="${other}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/watten/regeln${other === 'en' ? '\\?lang=en' : ''}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('zdwa_language'))).toBe(other);
  });
}
