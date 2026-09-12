const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { expectTextContrast: expectReadable } = require('./contrast');

test.use({ serviceWorkers: 'block' });

const PUBLIC_AUTH = {
  authenticated: false, user: null,
  game_access: { zilch_preview: true, zilch_public: true },
  registration: { email_enabled: true, turnstile_enabled: false },
  passkeys: { enabled: false },
};

async function prepare(page, language) {
  await page.addInitScript(lang => {
    localStorage.setItem('zdwa_language', lang);
    localStorage.setItem('zilch_theme', 'light');
    localStorage.setItem('wuerfler_theme', 'dark');
  }, language);
  await page.route('**/api/auth/me', route => route.fulfill({ json: PUBLIC_AUTH }));
}

async function publicLobby(page) {
  // Reuse the public capability fixture from zilch-loading-performance.spec:
  // backend tests own audience access; these tests exercise the shipped UI.
  const template = await readFile(path.join(__dirname, '../../app/static/zilch-lobby.html'), 'utf8');
  const body = template.includes('data-zilch-public-lobby="true"') ? template
    : template.replace('data-zilch-root', 'data-zilch-root data-zilch-public-lobby="true"');
  await page.route('**/zilch', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
  await page.route('**/api/games?**', route => route.fulfill({ json: { games: [] } }));
  await page.route('**/api/zilch/leaderboards?**', route => route.fulfill({ json: { entries: [] } }));
}

async function publicRules(page) {
  const body = await readFile(path.join(__dirname, '../../app/static/zilch-rules.html'), 'utf8');
  await page.route('**/zilch/regeln', route => route.fulfill({ status: 200, contentType: 'text/html', body }));
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const language of ['de', 'en']) {
  for (const width of [1280, 390, 320]) {
    test(`Classic login and public lobby remain readable and usable (${language}, ${width}px)`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await prepare(page, language);
      await page.goto('/zilch/anmelden');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      for (const selector of ['#zilchLoginTitle', '.zilch-login-intro', '#zilchPasswordLogin > summary']) {
        await expectReadable(page.locator(selector));
      }
      await page.locator('#zilchPasswordLogin > summary').click();
      await expectReadable(page.locator('#zilchForgotPassword'));
      await expectReadable(page.locator('label[for="zilchLoginUsername"]'));
      await expectNoOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`classic-login-${language}-${width}.png`), fullPage: true });

      await publicLobby(page);
      await page.goto('/zilch');
      await expect(page.locator('#zilchCreateForm')).toBeVisible();
      await expectReadable(page.locator('.zilch-intro-help a'));
      for (const selector of ['.zilch-lobby-section .eyebrow', '.zilch-create-card h2', '.zilch-mode-choice legend']) {
        await expectReadable(page.locator(selector).first());
      }
      const options = page.locator('[data-zilch-play-mode]');
      await expect(options).toHaveCount(3);
      for (const option of await options.all()) {
        await expectReadable(option.locator('strong'));
        expect(await option.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      }
      const cpu = page.locator('[data-zilch-play-mode="cpu"]');
      await cpu.click();
      await expect(cpu).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator('[data-zilch-play-mode="solo"]')).toHaveAttribute('aria-checked', 'false');
      await expect(page.locator('#zilchCpuStrategySelect')).toBeVisible();
      for (const option of await options.all()) await expectReadable(option.locator('strong'));
      await cpu.focus();
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => {
        const style = getComputedStyle(document.activeElement);
        return { outline: parseFloat(style.outlineWidth), style: style.outlineStyle };
      });
      expect(focus.outline).toBeGreaterThan(0);
      expect(focus.style).not.toBe('none');
      await expectNoOverflow(page);
      await page.screenshot({ path: testInfo.outputPath(`classic-lobby-${language}-${width}.png`), fullPage: true });
    });
  }
}

test('public core rules remain useful with JavaScript disabled', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false, viewport: { width: 320, height: 900 }, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await publicRules(page);
    const response = await page.goto('/zilch/regeln');
    expect(response.status()).toBe(200);
    const summary = page.locator('[data-zilch-rules-summary]');
    await expect(summary.getByRole('heading', { level: 1 })).toHaveText('Zilch-Regeln');
    await expect(summary.locator('.zilch-rule-table tbody tr')).toHaveCount(12);
    for (const title of ['Was Punkte bringt', 'Würfeln oder sichern', 'Freier Wurf und Bestätigungswurf', 'Zilch-Serie', '10’000-Punkte-Sprint']) {
      await expect(summary.getByRole('heading', { name: title, exact: true })).toBeVisible();
    }
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
    await expectNoOverflow(page);
  } finally { await context.close(); }
});

for (const language of ['de', 'en']) {
  test(`public core rules survive an unavailable rules API (${language})`, async ({ page }) => {
    await prepare(page, language);
    await publicRules(page);
    let calls = 0;
    await page.route('**/api/zilch/rules', route => {
      calls += 1;
      return route.fulfill({ status: 503, json: { detail: 'Unavailable' } });
    });
    await page.goto('/zilch/regeln');
    const summary = page.locator('[data-zilch-rules-summary]');
    await expect.poll(() => calls).toBeGreaterThan(0);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(summary.getByRole('heading', { level: 1 })).toHaveText(language === 'en' ? 'Zilch rules' : 'Zilch-Regeln');
    await expect(summary.locator('.zilch-rule-table tbody tr')).toHaveCount(12);
    await expectReadable(summary.locator('#zilchScoringTitle'));
    await expectNoOverflow(page);
  });
}

test('switching through Classic preserves LCARS surfaces and typography', async ({ page }, testInfo) => {
  await prepare(page, 'en');
  await page.goto('/zilch/anmelden');
  const installed = await page.evaluate(() => {
    let enabled = 0;
    const visit = rules => {
      for (const rule of rules) {
        if (rule instanceof CSSMediaRule && rule.conditionText.includes('display-mode: standalone')) {
          rule.media.mediaText = 'all';
          enabled += 1;
        }
        if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);
    const shell = getComputedStyle(document.querySelector('.zilch-login-shell'));
    const backdrop = getComputedStyle(document.body, '::before');
    return { enabled, shellPosition: shell.position, shellZ: Number(shell.zIndex), backdropZ: Number(backdrop.zIndex) };
  });
  expect(installed.enabled).toBeGreaterThan(0);
  expect(installed.shellPosition).toBe('relative');
  expect(installed.shellZ).toBeGreaterThan(installed.backdropZ);
  for (const selector of ['.zilch-login-brand', '[data-theme-toggle]']) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    expect(await control.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return element === hit || element.contains(hit);
    })).toBe(true);
  }
  const toggle = page.locator('[data-theme-toggle]');
  const appearance = () => page.evaluate(() => {
    const selectors = ['html', 'body', '.zilch-login-card', '#zilchLoginTitle', '#zilchPasswordLogin > summary', '#zilchLoginUsername'];
    return selectors.map(selector => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return { selector, color: style.color, background: style.backgroundColor, image: style.backgroundImage,
        font: style.fontFamily, radius: style.borderRadius, shadow: style.boxShadow };
    });
  });
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lcars');
  await page.evaluate(() => document.fonts.ready);
  const before = await appearance();
  for (const selector of ['html', 'body']) {
    await expect(page.locator(selector)).toHaveCSS('background-image', 'none');
  }
  expect(await page.evaluate(() => getComputedStyle(document.body, '::before').backgroundImage)).toBe('none');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lcars');
  expect(await appearance()).toEqual(before);
  expect(await page.evaluate(() => localStorage.getItem('wuerfler_theme'))).toBe('dark');
  await testInfo.attach('lcars-isolation.json', { body: JSON.stringify(before, null, 2), contentType: 'application/json' });
});
