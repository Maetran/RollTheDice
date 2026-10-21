const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

async function expectButtonLinks(links, width) {
  expect(await links.count()).toBeGreaterThan(0);
  const controls = await links.evaluateAll(elements => elements
    .filter(element => element.getClientRects().length)
    .map(element => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        href: element.getAttribute('href'), display: style.display,
        height: rect.height, left: rect.left, right: rect.right,
        padding: parseFloat(style.paddingLeft), border: parseFloat(style.borderTopWidth),
        background: style.backgroundColor, decoration: style.textDecorationLine,
      };
    }));
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control.href).toBeTruthy();
    expect(['flex', 'inline-flex']).toContain(control.display);
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(width + 1);
    expect(control.padding).toBeGreaterThan(0);
    expect(control.border > 0 || !['transparent', 'rgba(0, 0, 0, 0)'].includes(control.background)).toBeTruthy();
    expect(control.decoration).toBe('none');
  }
}

async function expectReadableButton(link) {
  const ratio = await link.evaluate(element => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      });
      return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
    };
    const style = getComputedStyle(element);
    const text = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(text, background) + .05) / (Math.min(text, background) + .05);
  });
  expect(ratio).toBeGreaterThanOrEqual(4.5);
}

for (const language of ['de', 'en']) {
  for (const width of [320, 1280]) {
    test(`${language} at ${width}px: rule and lobby actions keep their targets and game button styling`, async ({ page, browser, baseURL }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      const login = await page.request.post('/api/auth/login', {
        data: { username: 'Admin', password: 'temporary-password-123' },
      });
      expect(login.ok()).toBeTruthy();
      const user = (await login.json()).user;
      const headers = { 'X-CSRF-Token': user.csrf_token };
      const previousLanguage = user.preferences?.preferred_language || 'de';
      expect((await page.request.put('/api/auth/preferences/language', {
        headers, data: { preferred_language: language },
      })).ok()).toBeTruthy();
      await page.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
      try {
        await page.goto('/regeln');
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expectButtonLinks(page.locator('.doc-content .button-link'), width);
        await page.screenshot({ path: testInfo.outputPath(`zdwa-rules-${language}-${width}.png`) });
        await page.locator('.doc-content a[href="/rangabzeichen"]').click();
        await expect(page).toHaveURL(/\/rangabzeichen$/);

        await page.goto('/hausdepp/regeln');
        await expect(page.locator('.hd-rulebook')).toBeVisible();
        const hausdeppContents = page.locator('.hd-rules-toc a');
        await expectButtonLinks(hausdeppContents, width);
        await hausdeppContents.first().click();
        await expect(page).toHaveURL(/\/hausdepp\/regeln#/);
        await page.locator('.hd-rules-toc').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`hausdepp-rules-${language}-${width}.png`) });

        await page.goto(`/watten/regeln${language === 'en' ? '?lang=en' : ''}`);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        const wattenArticle = page.locator(`.wt-rules-text[lang="${language}"]`);
        await expect(wattenArticle).toBeVisible();
        await expectButtonLinks(wattenArticle.locator('.wt-toc a, .wt-page-actions a'), width);
        await wattenArticle.locator('.wt-toc').scrollIntoViewIfNeeded();
        await page.screenshot({ path: testInfo.outputPath(`watten-rules-${language}-${width}.png`) });
        const firstRule = wattenArticle.locator('.wt-toc a').first();
        const target = new URL(await firstRule.getAttribute('href'), page.url()).hash;
        await firstRule.click();
        expect(new URL(page.url()).hash).toBe(target);
        await expect(wattenArticle.locator(target)).toBeInViewport();

        // Zilch's disposable test pool is preview-only. Use its real designated
        // preview identity in a separate session, leaving the owner unchanged.
        const zilchContext = await browser.newContext({ baseURL, serviceWorkers: 'block', viewport: { width, height: 900 } });
        try {
          const ownerLogin = await zilchContext.request.post('/api/auth/login', {
            data: { username: 'Admin', password: 'temporary-password-123' },
          });
          expect(ownerLogin.ok()).toBeTruthy();
          const owner = (await ownerLogin.json()).user;
          const created = await zilchContext.request.post('/api/admin/users', {
            headers: { 'X-CSRF-Token': owner.csrf_token },
            data: { username: 'Mani', temporary_password: 'mani-preview-password-123', role: 'admin' },
          });
          expect([201, 400]).toContain(created.status());
          const previewLogin = await zilchContext.request.post('/api/auth/login', {
            data: { username: 'Mani', password: 'mani-preview-password-123' },
          });
          expect(previewLogin.ok()).toBeTruthy();
          await zilchContext.addInitScript(value => localStorage.setItem('zdwa_language', value), language);
          // As elsewhere in the preview UI suite, model completed password
          // setup without changing the shared Mani account or its access.
          await zilchContext.route('**/api/auth/me', async route => {
            const response = await route.fetch();
            const auth = await response.json();
            expect(auth.authenticated).toBe(true);
            await route.fulfill({ response, json: { ...auth, user: {
              ...auth.user, must_change_password: false,
              preferences: { ...auth.user.preferences, preferred_language: language },
            } } });
          });
          const zilch = await zilchContext.newPage();
          await zilch.goto('/zilch');
          const zilchRules = zilch.locator('.zilch-intro-help a');
          await expect(zilchRules).toBeVisible();
          await expectButtonLinks(zilchRules, width);
          await expectReadableButton(zilchRules);
          await zilchRules.hover();
          await expectReadableButton(zilchRules);
          await zilch.screenshot({ path: testInfo.outputPath(`zilch-lobby-${language}-${width}.png`) });
          await zilchRules.click();
          await expect(zilch).toHaveURL(/\/zilch\/regeln$/);
          await expect(zilch.locator('.zilch-rules-section').first()).toBeVisible();
          await expectButtonLinks(zilch.locator('.zilch-rules-section .button-link'), width);

          // The alternate Zilch theme must keep its own control palette.
          await zilch.evaluate(() => localStorage.setItem('zilch_theme', 'lcars'));
          await zilch.reload();
          await expect(zilch.locator('html')).toHaveAttribute('data-theme', 'lcars');
          const offlineAction = zilch.locator('.zilch-rules-section .button-link').first();
          await expect(offlineAction).toBeVisible();
          await expectButtonLinks(offlineAction, width);
          expect(await offlineAction.evaluate(element => getComputedStyle(element).textTransform)).toBe('uppercase');
        } finally {
          await zilchContext.close();
        }
      } finally {
        await page.request.put('/api/auth/preferences/language', {
          headers, data: { preferred_language: previousLanguage },
        });
      }
    });
  }
}

test('without JavaScript: public Hausdepp and offline fallback actions are tappable buttons', async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', viewport: { width: 320, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/hausdepp`);
    await expectButtonLinks(page.locator('[data-hausdepp-lobby-summary] .hd-onboarding-actions a'), 320);
    await page.screenshot({ path: testInfo.outputPath('hausdepp-nojs-320.png') });
    await page.goto(`${baseURL}/offline`);
    await expectButtonLinks(page.locator('.offline-card a'), 320);
    await expect(page.locator('.offline-card a')).toHaveAttribute('href', '/offline-spielen');
  } finally {
    await context.close();
  }
});
