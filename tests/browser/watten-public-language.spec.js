const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

// Hold the real anonymous identity response until we have a reference to the
// SSR hero. Its replacement proves the asynchronous guest remount completed;
// seeing a Tirol title immediately after navigation alone is not sufficient.
async function publicLobbyAfterGuestRemount(page, path, { reload = false } = {}) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const auth = async route => {
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  };
  await page.route('**/api/auth/me', auth);
  let initialHero;
  try {
    if (reload) await page.reload();
    else await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-watten-public-beta', 'true');
    initialHero = await page.locator('.wt-lobby-intro').elementHandle();
    expect(initialHero).not.toBeNull();
    release();
    await expect.poll(() => initialHero.evaluate(node => node.isConnected), {
      message: 'the real anonymous identity response has replaced the SSR lobby',
    }).toBe(false);
    await expect(page.locator('.wt-lobby-intro')).toHaveCount(1);
    await expect(page.locator('.wt-lobby-intro h1')).toHaveCount(1);
    await expect(page.locator('.wt-lobby-intro .wt-lead')).toHaveCount(1);
  } finally {
    release();
    await page.unroute('**/api/auth/me', auth);
    await initialHero?.dispose();
  }
}

async function publicIntro(page) {
  return page.locator('.wt-lobby-intro').evaluate(node => ({
    heading: node.querySelector('h1').innerHTML,
    lead: node.querySelector('.wt-lead').innerHTML,
  }));
}

// The dedicated public pool must serve real localized SSR documents. Preview
// pools exclude this file instead of silently skipping its navigation contract.
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
    await expect(page.locator('html')).toHaveAttribute('data-watten-public-beta', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-watten-seo-language', language);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect.poll(() => page.evaluate(() => localStorage.getItem('zdwa_language'))).toBe(language);
    const guide = page.locator('[data-watten-lobby-guide]');
    await expect(guide).toBeVisible();
    await expect(guide.locator('h2')).toHaveText(language === 'en' ? 'Watten rules at a glance' : 'Watten-Regeln kurz erklärt');
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

  test(`${language}: a guest restores exact Classic copy after a saved Tirol reload and language changes`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const path = value => `/watten${value === 'en' ? '?lang=en' : ''}`;
    const toggle = page.locator('[data-watten-design-toggle]');
    const expectPreference = async (design, locale) => {
      await expect(page.locator('html')).toHaveAttribute('data-watten-design', design);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect.poll(() => page.evaluate(() => ({
        design: localStorage.getItem('watten_design'), language: localStorage.getItem('zdwa_language'),
      }))).toEqual({ design, language: locale });
    };
    await publicLobbyAfterGuestRemount(page, path(language));
    await expect(page.locator('html')).toHaveAttribute('data-watten-design', 'classic');
    const baseline = await publicIntro(page);
    expect(baseline.heading).not.toBe('');
    expect(baseline.lead).not.toBe('');
    await toggle.click();
    await expectPreference('tirol', language);
    await expect(page.locator('#wattenTitle')).toHaveText(language === 'en' ? 'Up for a game?' : 'Auf a Kartl.');
    await publicLobbyAfterGuestRemount(page, path(language), { reload: true });
    await expectPreference('tirol', language);
    await expect(page.locator('#wattenTitle')).toHaveText(language === 'en' ? 'Up for a game?' : 'Auf a Kartl.');

    // Public language URLs choose the displayed language while keeping the
    // independently saved design. Both remounts must keep one set of copy.
    const other = language === 'en' ? 'de' : 'en';
    await publicLobbyAfterGuestRemount(page, path(other));
    await expectPreference('tirol', other);
    await expect(page.locator('#wattenTitle')).toHaveText(other === 'en' ? 'Up for a game?' : 'Auf a Kartl.');
    await expect(page.locator('.watten-tirol-kicker')).toHaveCount(1);
    await expect(page.locator('.watten-tirol-cards')).toHaveCount(1);
    await expect(page.locator('.watten-tirol-motto')).toHaveCount(1);
    await publicLobbyAfterGuestRemount(page, path(language));
    await expectPreference('tirol', language);
    await toggle.click();
    await expectPreference('classic', language);
    await expect.poll(() => publicIntro(page)).toEqual(baseline);
    await expect(page.locator('.watten-tirol-kicker')).toBeHidden();
    await expect(page.locator('.watten-tirol-cards')).toBeHidden();
    await expect(page.locator('.watten-tirol-motto')).toBeHidden();
    await publicLobbyAfterGuestRemount(page, path(language), { reload: true });
    await expectPreference('classic', language);
    await expect.poll(() => publicIntro(page)).toEqual(baseline);
    expect(errors).toEqual([]);
  });
}
