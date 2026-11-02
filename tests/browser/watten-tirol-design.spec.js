const { test, expect } = require('@playwright/test');
const { player, create, normalCall, playOne, finishOpenMatch } = require('./helpers/watten-journey.cjs');
const { expectTableHeaderReachable } = require('./helpers/watten-header.cjs');
const { expectReachable } = require('./table-viewport');

test.use({ serviceWorkers: 'block' });
test.setTimeout(90_000);

const toggleSelector = '[data-watten-design-toggle]';

async function expectDesign(page, design, language = 'de') {
  await expect(page.locator('html')).toHaveAttribute('data-watten-design', design);
  const themeColor = page.locator('meta[name="theme-color"]');
  await expect(themeColor).toHaveCount(1);
  await expect(themeColor).toHaveAttribute('content', design === 'tirol' ? '#214d3d' : '#713d2c');
  const classic = language === 'en' ? 'Classic' : 'Klassisch';
  const tirol = language === 'en' ? 'Tyrol' : 'Tirol';
  const current = design === 'tirol' ? tirol : classic;
  const next = design === 'tirol' ? classic : tirol;
  await expect(page.locator(toggleSelector)).toHaveAccessibleName(new RegExp(`${current}.*${next}`, 'i'));
}

async function expectStubendruckLobby(page, language) {
  await expect(page.locator('#wattenTitle')).toHaveText(language === 'en' ? 'Up for a game?' : 'Auf a Kartl.');
  await expect(page.locator('#wattenTitle')).toHaveCSS('font-family', /Georgia/);
  await expect(page.locator('.suite-header__brand')).toHaveCSS('font-family', /Georgia/);
  await expect(page.locator('.suite-header')).toHaveCSS('border-radius', '5px');
  await expect(page.locator('.suite-header')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[data-watten-create-open]')).toHaveCSS('background-color', 'rgb(33, 77, 61)');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(243, 245, 241)');
  await expect(page.locator('.watten-tirol-scene')).toBeHidden();
  expect(await page.locator('.wt-header').evaluate(node => getComputedStyle(node).backgroundImage)).not.toContain('zackenband');
}

async function handArtwork(page) {
  return page.locator('[data-wt-hand] button[data-card]').evaluateAll(nodes => nodes.map(node => ({
    card: node.dataset.card,
    image: node.querySelector('.hd-card-art image')?.getAttribute('href'),
  })));
}

async function expectTouchable(page, selector = toggleSelector) {
  await expectReachable(page, selector);
  const box = await page.locator(selector).boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
}

async function expectReadableAppearanceControls(page) {
  const contrast = await page.evaluate(() => {
    const rgba = value => {
      const parts = value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
      return [...parts.slice(0, 3), parts[3] ?? 1];
    };
    const composite = (front, back) => [0, 1, 2].map(index => front[index] * front[3] + back[index] * (1 - front[3]));
    const luminance = color => color.slice(0, 3).map(value => {
      const channel = value / 255;
      return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    return [...document.querySelectorAll('[data-watten-design-toggle], [data-wt-score-open] .wt-score-points')].map(node => {
      const parents = [];
      for (let current = node; current; current = current.parentElement) parents.unshift(current);
      let background = [255, 255, 255];
      for (const current of parents) background = composite(rgba(getComputedStyle(current).backgroundColor), background);
      const ink = composite(rgba(getComputedStyle(node).color), background);
      const levels = [luminance(ink), luminance(background)].sort((a, b) => b - a);
      return { target: node.dataset.wattenDesignToggle !== undefined ? 'design icon' : 'score number',
        ratio: (levels[0] + .05) / (levels[1] + .05) };
    });
  });
  // These large score figures and icon controls must remain distinct from
  // their paper surfaces; a broad white button rule can erase both.
  for (const item of contrast) expect(item.ratio, `${item.target} has visible contrast`).toBeGreaterThanOrEqual(3);
}

for (const language of ['de', 'en']) {
  test(`${language}: Watten design cycles from the original, persists across pages and keeps other games independent`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 320, height: 568 }, serviceWorkers: 'block' }) };
    const own = await player(wrapped, baseURL, language);
    const { page, context } = own;
    try {
      await page.goto('/watten');
      await expectDesign(page, 'classic', language);
      await expectTouchable(page);
      const originalBackground = await page.evaluate(() => getComputedStyle(document.body).background);
      await page.locator(toggleSelector).focus();
      await page.keyboard.press('Enter');
      await expectDesign(page, 'tirol', language);
      await expectStubendruckLobby(page, language);
      await expect(page.locator('.watten-tirol-motto')).toContainText('Bisch a Tiroler, bisch a Mensch');
      if (language === 'en') await expect(page.locator('[data-watten-tirol-translation]')).toBeVisible();
      else await expect(page.locator('[data-watten-tirol-translation]')).toBeHidden();
      await expect(page.locator(toggleSelector)).toBeFocused();
      expect(await page.evaluate(() => getComputedStyle(document.body).background)).not.toBe(originalBackground);
      expect(await page.evaluate(() => localStorage.getItem('watten_design'))).toBe('tirol');
      if (language === 'de') {
        // Follow the real account-language flow. A temporary local-only API
        // change can be superseded by a legitimate in-flight identity refresh.
        await Promise.all([
          page.waitForEvent('domcontentloaded'),
          page.locator('[data-language-switcher]').selectOption('en'),
        ]);
        await expectDesign(page, 'tirol', 'en');
        await Promise.all([
          page.waitForEvent('domcontentloaded'),
          page.locator('[data-language-switcher]').selectOption('de'),
        ]);
        await expectDesign(page, 'tirol', 'de');
      }
      for (const viewport of [{ width: 320, height: 568 }, { width: 1280, height: 900 }]) {
        await page.setViewportSize(viewport);
        await expectTouchable(page);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath(`tirol-lobby-${language}-${viewport.width}.png`), fullPage: true });
      }
      await page.reload();
      await expectDesign(page, 'tirol', language);
      await expectStubendruckLobby(page, language);
      for (const path of ['/watten/regeln', '/watten/anmelden', '/watten/konto/einstellungen', '/watten/rangliste', '/watten/konto/fortschritt']) {
        await page.goto(`${path}${language === 'en' ? '?lang=en' : ''}`);
        await expect(page.locator('html')).toHaveAttribute('lang', language);
        await expect(page.locator('main h1').first()).toBeVisible();
        await expectDesign(page, 'tirol', language);
        await expectTouchable(page);
      }
      await page.locator(toggleSelector).click();
      await expectDesign(page, 'classic', language);
      await page.goto('/watten');
      await expectDesign(page, 'classic', language);
      await expect(page.locator('#wattenTitle')).toHaveText('Watten');
      expect(await page.evaluate(() => getComputedStyle(document.body).background)).toBe(originalBackground);

      // A second tab follows this device's explicit choice, including a reset.
      const second = await context.newPage();
      await second.goto('/watten/regeln');
      await expectDesign(second, 'classic', language);
      await page.locator(toggleSelector).click();
      await expectDesign(second, 'tirol', language);
      await second.evaluate(() => localStorage.clear());
      await expectDesign(page, 'classic', language);
      await second.close();

      // Its own key means Watten never overwrites the ZDWA/Zilch choices.
      await page.evaluate(() => {
        localStorage.setItem('wuerfler_theme', 'dark');
        localStorage.setItem('zilch_theme', 'lcars');
      });
      await page.locator(toggleSelector).click();
      expect(await page.evaluate(() => ({
        zdwa: localStorage.getItem('wuerfler_theme'), zilch: localStorage.getItem('zilch_theme'),
      }))).toEqual({ zdwa: 'dark', zilch: 'lcars' });
      expect(own.traffic.errors).toEqual([]);
    } finally { await context.close(); }
  });
}

test('an unknown saved design falls back safely and blocked storage still permits a page-local switch', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('watten_design', 'unknown-design'));
    await page.goto('/watten');
    await expectDesign(page, 'classic');
    await page.locator(toggleSelector).click();
    await expectDesign(page, 'tirol');
    const blocked = await context.newPage();
    blocked.on('pageerror', error => errors.push(error.message));
    await blocked.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', { configurable: true, get() {
        throw new DOMException('Storage unavailable', 'SecurityError');
      } });
    });
    await blocked.goto('/watten');
    await expectDesign(blocked, 'classic');
    await blocked.locator(toggleSelector).click();
    await expectDesign(blocked, 'tirol');
    await blocked.reload();
    await expectDesign(blocked, 'classic');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('the waiting-room switch returns to the live header and both looks preserve a real mobile match', async ({ browser, baseURL }, info) => {
  const wrapped = { newContext: options => browser.newContext({ ...options,
    viewport: { width: 320, height: 568 }, serviceWorkers: 'block' }) };
  const players = [await player(wrapped, baseURL, 'de', { role: 'admin' }), await player(wrapped, baseURL)];
  const [own, peer] = players;
  const { page } = own;
  try {
    await create(players, { start: false, trickHistory: true });
    await expect(page.locator('.suite-header')).toBeHidden();
    await expect(page.locator(`[data-watten-waiting-controls] ${toggleSelector}`)).toBeVisible();
    await expectTouchable(page);
    await page.locator(toggleSelector).click();
    await expectDesign(page, 'tirol');
    await expectDesign(peer.page, 'classic');
    await page.locator('[data-watten-command=start]').click();
    await expect.poll(() => players.every(item => item.traffic.snapshot?.started && item.traffic.snapshot.engine)).toBe(true);
    await normalCall(players);
    await expect(page.locator(`.suite-header ${toggleSelector}`)).toBeVisible();
    const state = () => players.map(item => ({
      hand: item.traffic.snapshot.engine.hand,
      phase: item.traffic.snapshot.engine.phase,
      opportunity: item.traffic.snapshot.engine.opportunity,
    }));
    const before = structuredClone(state());
    const originalArtwork = await handArtwork(page);
    expect(originalArtwork).toHaveLength(5);
    for (const card of originalArtwork) expect(card.image).toContain('/static/hausdepp/');
    const commandsBefore = own.traffic.commands.filter(message => message.action === 'watten_command').length;
    const writes = [];
    page.on('request', request => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url());
    });
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(viewport);
      const compact = viewport.width === 568;
      if (compact) {
        await expect(page.locator('[data-watten-header-toggle]')).toBeVisible();
        await page.locator('[data-watten-header-toggle]').click();
      }
      await expectTableHeaderReachable(page);
      await expectTouchable(page);
      let originalSurface;
      for (const design of ['classic', 'tirol']) {
        await page.locator(toggleSelector).click();
        await expectDesign(page, design);
        await expectTableHeaderReachable(page);
        await expectTouchable(page);
        const surface = await page.locator('.wt-table').evaluate(node => {
          const paint = getComputedStyle(node, '::before');
          return { source: paint.borderImageSource, slice: paint.borderImageSlice,
            geometry: [paint.top, paint.right, paint.bottom, paint.left, paint.width, paint.height,
              paint.borderTopWidth, paint.borderRightWidth, paint.borderBottomWidth, paint.borderLeftWidth] };
        });
        if (design === 'classic') {
          originalSurface = surface;
          expect(surface.source).toContain('/static/watten/table-schnitzstube.jpg');
        } else {
          await expectReadableAppearanceControls(page);
          expect(surface.source).toContain('/static/images/watten-tirol/zirbenstube.webp');
          expect(surface.slice).toMatch(/^\d[\d. %]* fill$/);
          expect(surface.geometry).toEqual(originalSurface.geometry);
        }
        expect(await handArtwork(page)).toEqual(originalArtwork);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        expect(state()).toEqual(before);
      }
      if (compact) await page.keyboard.press('Escape');
      await page.screenshot({ path: info.outputPath(`tirol-table-${viewport.width}x${viewport.height}.png`) });
    }
    expect(own.traffic.commands.filter(message => message.action === 'watten_command').length).toBe(commandsBefore);
    expect(writes).toEqual([]);
    await page.setViewportSize({ width: 393, height: 852 });
    await playOne(players);
    await playOne(players);
    await expect.poll(() => players.every(item => item.traffic.snapshot.engine.last_trick?.cards.length === 2)).toBe(true);
    const next = players.find(item => item.traffic.snapshot.engine.actions.includes('play_card'));
    const viewer = players.find(item => item !== next);
    if (await viewer.page.locator('html').getAttribute('data-watten-design') !== 'tirol') {
      await viewer.page.locator(toggleSelector).click();
    }
    await expectDesign(viewer.page, 'tirol');
    const history = viewer.page.locator('[data-wt-history]');
    await history.locator(':scope > summary').click();
    await expect(history).toHaveAttribute('open', '');
    await playOne(players);
    await expect.poll(() => viewer.traffic.snapshot.engine.current_trick.cards.length).toBe(1);
    const currentCard = viewer.traffic.snapshot.engine.current_trick.cards[0].card;
    await history.locator('[data-wt-history-close]').click();
    await expect(history).not.toHaveAttribute('open', '');
    await expect(viewer.page.locator('[data-wt-trick]')).toHaveAttribute('data-state', 'current');
    await expect(viewer.page.locator(`[data-wt-trick] > .wt-trick-card[data-card="${currentCard}"]`)).toBeVisible();
    await expect(viewer.page.locator('[data-wt-trick] > .wt-trick-card')).toHaveCount(1);
    await expect(viewer.page.locator('[data-wt-hand]')).toBeVisible();
    expect(state()).not.toEqual(before);
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});

for (const language of ['de', 'en']) {
  test(`${language}: the chosen green print design survives a real result, progress and account navigation`, async ({ browser, baseURL }, info) => {
    const wrapped = { newContext: options => browser.newContext({ ...options,
      viewport: { width: 390, height: 844 }, serviceWorkers: 'block' }) };
    const players = [await player(wrapped, baseURL, language), await player(wrapped, baseURL, language)];
    const own = players[0], { page } = own;
    try {
      await page.goto('/watten');
      await page.locator(toggleSelector).click();
      await expectStubendruckLobby(page, language);
      const path = await finishOpenMatch(players);
      await expectDesign(page, 'tirol', language);
      await expect(page.locator('.wt-final-heading')).toHaveCSS('font-family', /Georgia/);
      await expect(page.locator('[data-watten-rematch-action=create]')).toHaveCSS('background-color', 'rgb(33, 77, 61)');
      await expect(page.locator('.wt-final-actions > a')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expect(page.locator('.wt-final-actions > a')).toHaveCSS('color', 'rgb(33, 77, 61)');
      for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(viewport);
        await expect(page.locator('.wt-final-heading')).toBeVisible();
        await expectReachable(page, '[data-watten-rematch-action=create]');
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await page.screenshot({ path: info.outputPath(`tirol-result-${language}-${viewport.width}.png`) });
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.wt-final-call > summary').click();
      await page.locator('.wt-final-progress').click();
      await expect(page).toHaveURL(/\/watten\/konto\/fortschritt$/);
      await expectDesign(page, 'tirol', language);
      await expect(page.locator('#wattenProgress > h1')).toHaveCSS('font-family', /Georgia/);
      await page.goto(`/watten/konto/einstellungen${language === 'en' ? '?lang=en' : ''}`);
      await expectDesign(page, 'tirol', language);
      await expectTouchable(page);
      await page.reload();
      await expectDesign(page, 'tirol', language);
      expect(await page.evaluate(() => localStorage.getItem('watten_design'))).toBe('tirol');
      await page.goto(path);
      await expect(page.locator('[data-watten-match-result]')).toBeVisible();
      await expectDesign(page, 'tirol', language);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
    } finally { await Promise.allSettled(players.map(item => item.context.close())); }
  });
}

test('four-player partner cards and enabled ambience retain their mobile header slots in both designs', async ({ browser, baseURL }, info) => {
  const wrapped = { newContext: options => browser.newContext({ ...options,
    viewport: { width: 320, height: 568 }, serviceWorkers: 'block' }) };
  const players = [];
  try {
    for (let seat = 0; seat < 4; seat++) players.push(await player(wrapped, baseURL, 'de', { role: seat === 0 ? 'admin' : 'user' }));
    const [own] = players, { page } = own;
    // Partner cards require an open table. This is the crowded four-player
    // header: the partner disclosure and the live ambience control coexist.
    await create(players, { count: 4, target: 11, determination: 'normal', partnerHand: true, start: false });
    await page.locator('#wattenSound').click();
    await expect(page.locator('.wt-sound')).toHaveAttribute('data-status', 'playing');
    await expect(page.locator('#wattenSound')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-watten-command=start]').click();
    await expect.poll(() => players.every(item => item.traffic.snapshot?.started && item.traffic.snapshot.engine)).toBe(true);
    await normalCall(players);
    const state = structuredClone({ hand: own.traffic.snapshot.engine.hand, partner: own.traffic.snapshot.engine.partner_hand,
      opportunity: own.traffic.snapshot.engine.opportunity });
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 568, height: 320 }]) {
      await page.setViewportSize(viewport);
      const compact = viewport.width === 568;
      if (compact) await page.locator('[data-watten-header-toggle]').click();
      for (const design of ['tirol', 'classic']) {
        await page.locator(toggleSelector).click();
        await expectDesign(page, design);
        await expectTableHeaderReachable(page);
        await expectTouchable(page);
        await expectTouchable(page, '#wattenSound');
        await expect(page.locator('#wattenSound')).toHaveAttribute('aria-pressed', 'true');
        await expectTouchable(page, '.wt-partner-hand > summary');
        if (design === 'tirol') {
          await expectReadableAppearanceControls(page);
          await page.screenshot({ path: info.outputPath(`tirol-partner-ambience-${viewport.width}x${viewport.height}.png`) });
        }
        expect({ hand: own.traffic.snapshot.engine.hand, partner: own.traffic.snapshot.engine.partner_hand,
          opportunity: own.traffic.snapshot.engine.opportunity }).toEqual(state);
      }
      if (compact) await page.keyboard.press('Escape');
    }
    await page.locator('#wattenSound').click();
    await expect(page.locator('#wattenSound')).toHaveAttribute('aria-pressed', 'false');
    expect(players.flatMap(item => item.traffic.errors)).toEqual([]);
  } finally { await Promise.allSettled(players.map(item => item.context.close())); }
});
