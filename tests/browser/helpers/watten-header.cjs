const { expect } = require('@playwright/test');

async function expectTableHeaderReachable(page) {
  // matchMedia changes and its disclosure callback arrive asynchronously on
  // rotation. Read visibility expectations only after that transition settles.
  await expect.poll(() => page.evaluate(() => {
    const html = document.documentElement;
    const expected = html.dataset.wattenActive === 'true'
      && matchMedia('(orientation: landscape) and (max-width: 720px) and (max-height: 360px)').matches;
    return (html.dataset.wtCompactHeader === 'true') === expected;
  })).toBe(true);
  const language = await page.locator('html').getAttribute('lang');
  const rulesPath = language === 'en' ? '/watten/regeln?lang=en' : '/watten/regeln';
  const compact = await page.locator('html').getAttribute('data-wt-compact-header') === 'true';
  const expanded = await page.locator('html').getAttribute('data-wt-header-open') === 'true';
  for (const selector of ['.wt-header [data-language-switcher]', '.wt-header [data-game-picker]', `.wt-header a[href="${rulesPath}"]`]) {
    if (compact && !expanded) await expect(page.locator(selector)).toBeHidden();
    else await expect(page.locator(selector)).toBeVisible();
  }
  if (compact) {
    await expect(page.locator('[data-watten-header-toggle]')).toBeVisible();
    await expect(page.locator('[data-watten-header-toggle]')).toHaveAttribute('aria-expanded', String(expanded));
  }
  await expect.poll(() => page.evaluate(() => {
    const header = document.querySelector('.wt-header');
    const compact = document.documentElement.dataset.wtCompactHeader === 'true';
    const expanded = document.documentElement.dataset.wtHeaderOpen === 'true';
    const controls = [...header.querySelectorAll('a, select, button'),
      ...document.querySelectorAll('details.wt-partner-hand > summary')];
    const failures = [];
    const topbar = document.querySelector('.wt-topbar');
    if (topbar && innerWidth > innerHeight && innerHeight <= 519) {
      const rail = header.getBoundingClientRect();
      const felt = document.querySelector('[data-wt-felt]').getBoundingClientRect();
      const railControls = [...controls, ...document.querySelectorAll('[data-wt-score-open], [data-wt-tools] button, [data-watten-social-action="toggle"], [data-wt-stake] > button, [data-wt-history]:not([open]) > summary')]
        .filter(control => control.getBoundingClientRect().width > 0 && control.getBoundingClientRect().height > 0);
      const inset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wt-rail-inset')) || 0;
      if (rail.left < -1 || rail.right >= innerWidth / 2 || (!compact && felt.left < rail.right - 1) || felt.top > 1
        || felt.right > innerWidth + 1 || felt.bottom > innerHeight + 1) failures.push('landscape table does not fill the space right of the left header rail');
      if (compact) {
        if (Math.abs(felt.left - inset - 52) > 1 || Math.abs(rail.width - inset - (expanded ? 156 : 52)) > 1) {
          failures.push('compact header changes the reserved 52px table rail');
        }
        const scores = topbar.getBoundingClientRect();
        if (Math.abs(scores.left - (expanded ? innerWidth - 168 : inset + 56)) > 1 || Math.abs(scores.width - 156) > 1
          || scores.top < -1 || scores.top > 8) failures.push('compact scores do not float beside the header');
      }
      for (const control of railControls) {
        const box = control.getBoundingClientRect();
        const label = control.getAttribute('aria-label') || control.getAttribute('title') || control.textContent.trim();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        if ((!compact || header.contains(control)) && (box.left < rail.left - 1 || box.right > rail.right + 1)) {
          failures.push(`${label}: escapes left rail at ${box.left},${box.top},${box.width},${box.height}`);
        }
        if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1 || box.width < 44 || box.height < 44
          || !control.contains(hit)) failures.push(`${label}: rail target clipped, too small or covered by ${hit?.className}`);
      }
    }
    if (topbar && innerWidth <= 760 && innerWidth < innerHeight) {
      const row = topbar.getBoundingClientRect();
      const score = topbar.querySelector('.wt-score-open')?.getBoundingClientRect();
      const tools = [...document.querySelectorAll('[data-wt-tools] button, [data-watten-social-action="toggle"]')];
      if (row.height > 54) failures.push('Scores and table tools use more than one compact row');
      for (const tool of tools) {
        const box = tool.getBoundingClientRect();
        if (!box.width || !box.height || !score) continue;
        if (Math.abs(box.top + box.height / 2 - score.top - score.height / 2) > 2) {
          failures.push('Leave/chat control is not in the score row');
        }
      }
    }
    if (document.documentElement.dataset.wattenActive === 'true' && innerHeight <= 700 && innerWidth <= innerHeight) {
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
