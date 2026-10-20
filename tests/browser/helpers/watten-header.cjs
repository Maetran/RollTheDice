const { expect } = require('@playwright/test');

async function expectTableHeaderReachable(page) {
  const language = await page.locator('html').getAttribute('lang');
  const rulesPath = language === 'en' ? '/watten/regeln?lang=en' : '/watten/regeln';
  await expect(page.locator('.wt-header [data-language-switcher]')).toBeVisible();
  await expect(page.locator('.wt-header [data-game-picker]')).toBeVisible();
  await expect(page.locator(`.wt-header a[href="${rulesPath}"]`)).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('.wt-header');
    const controls = [...header.querySelectorAll('a, select, button'),
      ...document.querySelectorAll('details.wt-partner-hand > summary')];
    const failures = [];
    if (document.documentElement.dataset.wattenActive === 'true' && innerHeight <= 700) {
      const disclosure = document.querySelector('details.wt-partner-hand > summary');
      if (disclosure) {
        const box = disclosure.getBoundingClientRect();
        const row = header.getBoundingClientRect();
        const brand = header.querySelector('.suite-header__brand').getBoundingClientRect();
        if (box.top < row.top - 1 || box.bottom > row.bottom + 1 || box.right > brand.left - 2) {
          failures.push('Partner disclosure is outside its reserved header slot');
        }
      }
    }
    for (const control of controls) {
      const box = control.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const label = control.getAttribute('aria-label') || control.textContent.trim() || control.tagName;
      if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1) {
        failures.push(`${label}: clipped at ${innerWidth}x${innerHeight}`);
      }
      if (box.width < 44 || box.height < 44) failures.push(`${label}: target below 44px`);
      if (!control.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))) {
        failures.push(`${label}: covered`);
      }
    }
    return failures;
  }), { message: 'Watten header controls and partner disclosure stay complete and accept taps' }).toEqual([]);
}

module.exports = { expectTableHeaderReachable };
