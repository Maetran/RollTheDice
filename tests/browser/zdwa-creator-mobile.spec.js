const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });

const hints = {
  de: 'Zuhören und Mikro bleiben freiwillig. Deine Profilvorgabe bestimmt, ob du beim Einstieg zuhörst.',
  en: 'Listening and microphone stay optional. Your profile default decides whether you listen when joining.',
};

// Exercise the real lobby, setup script, translations and styles. No game is
// created: trial clicks verify hit targets without leaving the setup card.
for (const language of ['de', 'en']) {
  for (const design of ['classic', '2026']) {
    test(`${language}/${design}: mobile creator keeps voice help and game controls in separate usable rows`, async ({ page, context }, info) => {
      const creations = [], errors = [];
      page.on('request', request => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/games') creations.push(request);
      });
      page.on('pageerror', error => errors.push(error.message));
      await context.addInitScript(({ language, design }) => {
        localStorage.setItem('zdwa_language', language);
        localStorage.setItem('zdwa_design', design === 'classic' ? 'old' : 'new');
        localStorage.setItem('wuerfler_theme', 'light');
      }, { language, design });
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(`/?lang=${language}&design=${design}`);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      if (design === '2026') await expect(page.locator('html')).toHaveAttribute('data-design', '2026');
      else await expect(page.locator('html')).not.toHaveAttribute('data-design', '2026');

      const card = page.locator('#createGameCard'), voice = page.locator('#zdwaVoiceEnabled');
      await expect(page.getByRole('main')).toHaveCount(1);
      await expect(page.getByRole('main').locator('#createGameCard')).toHaveCount(1);
      await expect(page.getByRole('main').locator('header')).toHaveCount(0);
      // Speech input must match the labels players can see and speak.
      // Deriving the two short names from their labels keeps DE/EN in sync.
      await expect(page.locator('[data-game-mode="1"]')).toHaveAccessibleName('1 Solo');
      await expect(page.locator('[data-game-mode="2v2"]')).toHaveAccessibleName('2 vs 2');
      await expect(voice).toBeChecked();
      await expect(card.locator('.room-voice-choice small')).toHaveText(hints[language]);
      await page.locator('#passInput').fill('mobile-table');

      for (const [width, height] of [[320, 568], [390, 844], [440, 956]]) {
        await page.setViewportSize({ width, height });
        await card.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const layout = await card.evaluate(element => {
          const rect = node => {
            const bounds = node.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
              width: bounds.width, height: bounds.height };
          };
          const selectors = { row: '.create-row', passphrase: '.passphrase-field', input: '#passInput',
            voice: '.room-voice-choice', checkbox: '#zdwaVoiceEnabled', voiceText: '.room-voice-choice > span',
            hint: '.room-voice-choice small', start: '#createBtn',
            offline: 'a[href="/offline-spielen"]' };
          const title = document.createRange();
          title.selectNodeContents([...element.querySelector('.room-voice-choice > span').childNodes]
            .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()));
          return { card: rect(element), boxes: Object.fromEntries(Object.entries(selectors)
            .map(([key, selector]) => [key, rect(element.querySelector(selector))])),
          voiceTitle: rect(title),
          overflow: [...element.querySelectorAll('.room-voice-choice > span, .room-voice-choice small, #createBtn')]
            .map(node => node.scrollWidth - node.clientWidth),
          pageOverflow: document.documentElement.scrollWidth - innerWidth };
        });
        expect(layout.pageOverflow).toBeLessThanOrEqual(1);
        for (const [name, box] of Object.entries(layout.boxes)) {
          expect(box.left, `${name} left at ${width}px`).toBeGreaterThanOrEqual(layout.card.left - 1);
          expect(box.right, `${name} right at ${width}px`).toBeLessThanOrEqual(layout.card.right + 1);
          expect(box.top, `${name} top at ${width}px`).toBeGreaterThanOrEqual(layout.card.top - 1);
          expect(box.bottom, `${name} bottom at ${width}px`).toBeLessThanOrEqual(layout.card.bottom + 1);
        }
        const { row, passphrase, input, voice: choice, checkbox, voiceText, hint, start, offline } = layout.boxes;
        for (const box of [passphrase, input, choice, start]) expect(box.width).toBeGreaterThanOrEqual(row.width - 2);
        expect(passphrase.bottom).toBeLessThanOrEqual(choice.top);
        expect(voiceText.left - checkbox.right, `checkbox gap at ${width}px`).toBeGreaterThanOrEqual(6);
        expect(hint.left).toBeGreaterThanOrEqual(voiceText.left - 1);
        expect(hint.top, `voice help begins below its label at ${width}px`).toBeGreaterThanOrEqual(layout.voiceTitle.bottom);
        expect(hint.bottom).toBeLessThanOrEqual(choice.bottom + 1);
        expect(choice.bottom).toBeLessThanOrEqual(start.top);
        expect(start.bottom).toBeLessThanOrEqual(offline.top);
        expect(start.height).toBeGreaterThanOrEqual(44);
        expect(offline.height).toBeGreaterThanOrEqual(44);
        for (const overflow of layout.overflow) expect(overflow).toBeLessThanOrEqual(1);

        await voice.uncheck(); await expect(voice).not.toBeChecked();
        await voice.check(); await expect(voice).toBeChecked();
        await expect(page.locator('#passInput')).toHaveValue('mobile-table');
        await page.locator('#createBtn').click({ trial: true });
        await card.locator('a[href="/offline-spielen"]').click({ trial: true });
        await page.screenshot({ path: info.outputPath(`creator-${width}x${height}.png`) });
      }
      expect(creations).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}
