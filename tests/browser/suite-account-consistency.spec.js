const { test, expect } = require('@playwright/test');

test.use({ serviceWorkers: 'block' });
const products = [
  { game: 'zdwa', lobby: '/', entry: '/konto', tab: true, statistics: '#statistics', achievements: '#unlockedAchievements' },
  { game: 'zilch', lobby: '/zilch', entry: '/zilch/konto', tab: true, statistics: '#zilchAccountPanel-statistics', achievements: '#zilchAccountPanel-achievements' },
  { game: 'hausdepp', lobby: '/hausdepp', entry: '/hausdepp/konto', statistics: '#hausdeppAccountStats', achievements: '#hausdeppAchievements' },
  { game: 'watten', lobby: '/watten', entry: '/watten/konto/fortschritt', statistics: '.wt-progress-title', achievements: '.wt-achievement-collection' },
];
const names = {
  de: ['Profil & Zugang', 'Sprache & Spiel', 'Mitspieler & Hinweise', 'Hilfe & Neuigkeiten'],
  en: ['Profile & sign-in', 'Language & play', 'Players & notifications', 'Help & updates'],
};

async function createAccount(page, username, language = 'de', product = null) {
  const password = 'suite-account-fixture-password';
  const admin = await page.request.post('/api/auth/login', { data: { username: 'Admin', password: 'temporary-password-123' } });
  expect(admin.ok()).toBe(true);
  const created = await page.request.post('/api/admin/users', {
    headers: { 'X-CSRF-Token': (await admin.json()).user.csrf_token }, data: { username, temporary_password: password, role: 'user' },
  });
  expect(created.status()).toBe(201);
  const login = await page.request.post('/api/auth/login', { data: { username, password } });
  expect(login.ok()).toBe(true);
  const user = (await login.json()).user;
  const headers = { 'X-CSRF-Token': user.csrf_token };
  expect((await page.request.put('/api/auth/preferences/language', { headers, data: { preferred_language: language } })).ok()).toBe(true);
  if (product) {
    await noNotices(page, user);
    await page.goto(product.entry);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const passwordForm = { zdwa: '#passwordForm', zilch: '#zilchPasswordForm', hausdepp: '#hausdeppPasswordForm', watten: 'form[data-password]' }[product.game];
    await expect(page.locator(passwordForm)).toBeVisible();
    if (!product.tab) await expect(page).toHaveURL(new URL(`/${product.game}/konto/einstellungen#passwort`, page.url()).href);
  }
  expect((await page.request.post('/api/auth/change-password', { headers, data: { current_password: password, new_password: `${password}-final` } })).ok()).toBe(true);
  const again = await page.request.post('/api/auth/login', { data: { username, password: `${password}-final` } });
  expect(again.ok()).toBe(true);
  return (await again.json()).user;
}

async function noNotices(page, user) {
  await page.route('**/api/releases**', route => route.fulfill({ json: { viewer_id: user.id, releases: [], can_prompt: false } }));
  await page.route('**/api/account/merges/pending', route => route.fulfill({ json: { viewer_id: user.id, operations: [] } }));
}

async function destination(page, product, name) {
  return product.tab ? page.getByRole('tablist', { name: /Kontobereiche|Account sections/ }).getByRole('tab', { name, exact: true })
    : page.locator('[data-account-navigation]').getByRole('link', { name, exact: true });
}

for (const product of products) for (const language of ['de', 'en']) {
  test(`${product.game} account uses the same settings order and native three-part flow (${language})`, async ({ page }, testInfo) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const user = await createAccount(page, `suiteaccount_${product.game}_${language}`, language, product);
    await noNotices(page, user);
    await page.goto(product.lobby);
    const entry = page.locator(`.suite-header__nav a[href="${product.entry}"]`);
    await expect(entry).toHaveText(language === 'de' ? 'Konto' : 'Account');
    await entry.click();
    await expect(page).toHaveURL(new URL(product.entry, page.url()).href);
    await expect(page.locator(product.statistics)).toBeVisible();
    const labels = language === 'de' ? ['Statistik', 'Erfolge', 'Einstellungen'] : ['Statistics', 'Achievements', 'Settings'];
    await (await destination(page, product, labels[2])).click();
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    const groups = page.locator('[data-account-section]');
    await expect(groups).toHaveCount(4);
    expect(await groups.evaluateAll(nodes => nodes.map(node => node.dataset.accountSection))).toEqual(['access', 'play', 'social', 'help']);
    const navigation = product.tab ? page.getByRole('tablist', { name: /Kontobereiche|Account sections/ }) : page.locator('[data-account-navigation]');
    expect(await navigation.locator(product.tab ? '[role=tab]' : 'a').allTextContents()).toEqual(labels);
    for (let index = 0; index < 4; index += 1) {
      await expect(groups.nth(index).locator(':scope > summary')).toContainText(names[language][index]);
      await expect(groups.nth(index)).not.toHaveAttribute('open', '');
    }
    for (const [size, viewport] of [['mobile', { width: 320, height: 844 }], ['tablet-portrait', { width: 768, height: 1024 }], ['tablet-landscape', { width: 1024, height: 768 }]]) {
      await page.setViewportSize(viewport);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const layout = await navigation.locator(product.tab ? '[role=tab]' : 'a').evaluateAll(nodes => nodes.map(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        const bounds = element.getBoundingClientRect(), textBounds = range.getBoundingClientRect(), style = getComputedStyle(element);
        return { label: element.textContent.trim(), top: Math.round(bounds.top), lines: range.getClientRects().length,
          height: bounds.height, fits: element.scrollWidth <= element.clientWidth,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
          bounds: { left: bounds.left, right: bounds.right, width: bounds.width },
          textBounds: { left: textBounds.left, right: textBounds.right, width: textBounds.width },
          font: style.font, padding: [style.paddingLeft, style.paddingRight] };
      }));
      expect(new Set(layout.map(item => item.top)).size).toBe(1);
      expect(layout.every(item => item.lines === 1 && item.height >= 44 && item.fits), `${product.game}/${language} ${viewport.width}x${viewport.height}: ${JSON.stringify(layout)}`).toBe(true);
      expect(await page.locator('h1').evaluateAll(nodes => nodes.every(element => element.scrollWidth <= element.clientWidth + 1))).toBe(true);
      expect(await groups.evaluateAll(nodes => nodes.every(element => getComputedStyle(element).backgroundColor !== 'rgba(0, 0, 0, 0)'))).toBe(true);
      if (language === 'de') await page.screenshot({ path: testInfo.outputPath(`${product.game}-${size}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 320, height: 844 });
    await groups.nth(0).locator(':scope > summary').click();
    await expect(page.locator('[data-username-settings]')).toHaveCount(1);
    await expect(page.locator('[data-passkey-settings]')).toBeHidden();
    await expect(page.locator('[data-email-settings]')).toBeHidden();
    await (await destination(page, product, labels[0])).click();
    await expect(page.locator(product.statistics)).toBeVisible();
    await (await destination(page, product, labels[1])).click();
    await expect(page.locator(product.achievements)).toBeVisible();
    await (await destination(page, product, labels[2])).click();
    const help = page.locator('[data-account-section="help"]');
    await expect(help).toBeVisible();
    await help.locator(':scope > summary').click();
    const support = help.locator('.release-notes-support');
    await support.locator(':scope > summary').click();
    await expect(support.locator('a')).toHaveText(language === 'de'
      ? ['Problem auf GitHub melden', 'Ausführliche Versionshistorie auf GitHub']
      : ['Report a problem on GitHub', 'Detailed version history on GitHub']);
    for (const destination of ['issues', 'changelog']) {
      await expect(support.locator(`a[href="/go/github/${destination}"]`)).toBeVisible();
      await expect(support.locator(`a[href="/go/github/${destination}"]`)).toHaveAttribute('rel', 'noopener noreferrer');
    }
    for (const selector of ['[data-game-tour-settings]', '[data-release-history]']) {
      for (const details of await help.locator(selector).locator('xpath=ancestor::details').all()) {
        if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
      }
      await expect(help.locator(selector)).toBeVisible();
    }
    const tours = help.locator('[data-game-tour-settings]');
    await expect(tours.locator('[data-tour-enabled]')).toBeEnabled();
    const currentAuth = await (await page.request.get('/api/auth/me')).json();
    const wattenTourAvailable = product.game === 'watten' || currentAuth.game_access?.watten_public || currentAuth.game_access?.watten_preview;
    const expectedTourGames = ['zdwa', 'zilch', 'hausdepp', ...(wattenTourAvailable ? ['watten'] : [])];
    await expect(tours.locator('[data-tour-action="start"]')).toHaveCount(expectedTourGames.length);
    expect(await tours.locator('[data-tour-action="start"]').evaluateAll(buttons => buttons.map(button => button.dataset.tourGame))).toEqual(expectedTourGames);
    expect(await tours.locator('[data-tour-action="view"]').evaluateAll(buttons => buttons.map(button => button.dataset.tourGame))).toEqual(expectedTourGames);
    if (language === 'de') {
      await page.setViewportSize({ width: 320, height: 844 });
      await help.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${product.game}-help-mobile.png`), fullPage: true });
    }
    await help.locator(':scope > summary').click();
    await page.unroute('**/api/account/merges/pending');
    await page.route('**/api/account/merges/pending', route => route.fulfill({ json: { viewer_id: user.id, operations: [operation('visible-merge', user.id)] } }));
    await page.reload();
    await expect(page.locator('[data-account-merge-operation="visible-merge"]')).toBeVisible();
    await expect(page.locator('.account-merge-notice__games dt')).toHaveText(['ZDWA', 'Zilch', 'Hausdepp', 'Watten']);
    await expect(page.locator('.account-merge-notice__games dd span').filter({ hasText: language === 'de' ? 'Anfänger → Profi' : 'Beginner → Pro' })).toHaveCount(4);
    if (language === 'de') await page.screenshot({ path: testInfo.outputPath(`${product.game}-merge-mobile.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

function operation(id, userId) {
  return { operation_id: id, target_user_id: userId, acknowledged: false, created_at: '2026-10-25T12:00:00Z', games:
    Object.fromEntries(['zdwa', 'zilch', 'hausdepp', 'watten'].map(game => [game, {
      before_points: 10, after_points: 25,
      before_rank: { ...(game === 'zdwa' ? { key: 'novice' } : {}), de: 'Anfänger', en: 'Beginner' },
      after_rank: { de: 'Profi', en: 'Pro' }, achievement_count: 6,
      inherited_achievement_count: 2, new_achievement_count: 1, games_played: 12,
    }])),
  };
}

test('merge notices acknowledge one exact operation with the mounted account proof', async ({ page }) => {
  const user = await createAccount(page, 'suiteaccount_notice');
  const operations = [operation('00000000-0000-4000-8000-000000000001', user.id), operation('00000000-0000-4000-8000-000000000002', user.id)];
  await noNotices(page, user);
  await page.unroute('**/api/account/merges/pending');
  await page.route('**/api/account/merges/**', async route => {
    expect(route.request().headers()['x-account-expected-id']).toBe(String(user.id));
    if (route.request().method() === 'GET') return route.fulfill({ json: { viewer_id: user.id, operations } });
    expect(route.request().headers()['x-csrf-token']).toBeTruthy();
    expect(new URL(route.request().url()).pathname).toBe(`/api/account/merges/${operations[0].operation_id}/acknowledge`);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto('/konto#settings');
  const notices = page.locator('[data-account-merge-operation]');
  await expect(notices).toHaveCount(2);
  const first = page.locator(`[data-account-merge-operation="${operations[0].operation_id}"]`);
  await expect(first).toContainText('10 → 25');
  await expect(first).toContainText('6 Erfolge');
  await first.getByRole('button', { name: 'Gesehen' }).click();
  await expect(first).toHaveCount(0);
  await expect(page.locator(`[data-account-merge-operation="${operations[1].operation_id}"]`)).toBeVisible();
});

test('the standalone merge notice aborts a delayed private read on account change', async ({ page }) => {
  const user = await createAccount(page, 'suiteaccount_late_notice');
  await noNotices(page, user);
  await page.unroute('**/api/account/merges/pending');
  let release, requested = false;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/api/account/merges/pending', async route => {
    requested = true; await gate;
    await route.fulfill({ json: { viewer_id: user.id, operations: [operation('late', user.id)] } }).catch(() => {});
  });
  try {
    // Labelled component harness: the real module and /me request are used;
    // there is no outer account renderer to hide an unsafe late write for it.
    await page.route('**/suite-notice-harness', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="de"><body><main><h1>Merge notice lifecycle harness</h1><div id="notice" hidden></div></main></body></html>' }));
    await page.goto('/suite-notice-harness');
    await page.evaluate(async userId => {
      const { mountAccountMergeNotice } = await import('/static/account-merge-notice.js');
      mountAccountMergeNotice(document.getElementById('notice'), { userId });
    }, user.id);
    await expect.poll(() => requested).toBe(true);
    const aborted = page.waitForEvent('requestfailed', request => new URL(request.url()).pathname === '/api/account/merges/pending');
    await page.evaluate(id => window.dispatchEvent(new CustomEvent('zdwa:auth-state', { detail: { authenticated: true, user: { id } } })), user.id + 1);
    await aborted;
    release();
    await expect(page.locator('[data-account-merge-operation]')).toHaveCount(0);
    await expect(page.locator('#notice')).toBeHidden();
  } finally { release(); }
});

test('merge notice resumes after page restoration while old ACK identity verification is delayed', async ({ page }) => {
  const user = await createAccount(page, 'suiteaccount_restored_notice');
  await noNotices(page, user);
  await page.unroute('**/api/account/merges/pending');
  let reads = 0, writes = 0, release, verificationReached;
  const gate = new Promise(resolve => { release = resolve; });
  const verifiedRequest = new Promise(resolve => { verificationReached = resolve; });
  await page.route('**/api/account/merges/**', route => {
    if (route.request().method() === 'POST') { writes += 1; return route.fulfill({ json: { ok: true } }); }
    reads += 1;
    return route.fulfill({ json: { viewer_id: user.id, operations: [operation('restored', user.id)] } });
  });
  await page.route('**/suite-restored-notice-harness', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><html lang="de"><body><main><div id="notice" hidden></div></main></body></html>' }));
  try {
    await page.goto('/suite-restored-notice-harness');
    await page.evaluate(async userId => {
      const { mountAccountMergeNotice } = await import('/static/account-merge-notice.js');
      mountAccountMergeNotice(document.getElementById('notice'), { userId });
    }, user.id);
    const card = page.locator('[data-account-merge-operation="restored"]');
    await expect(card).toBeVisible();
    let held = false;
    await page.route('**/api/auth/me', async route => {
      const response = await route.fetch();
      if (!held) { held = true; verificationReached(); await gate; }
      await route.fulfill({ response });
    });
    await card.getByRole('button', { name: 'Gesehen' }).click();
    await verifiedRequest;
    // Controlled lifecycle events test the real module without claiming that
    // this harness was physically stored in the browser's BFCache.
    await page.evaluate(() => {
      dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
      dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    });
    await expect(card).toHaveCount(0);
    release();
    await expect(card).toBeVisible();
    expect(reads).toBe(2);
    expect(writes).toBe(0);
    await card.getByRole('button', { name: 'Gesehen' }).click();
    await expect(card).toHaveCount(0);
    expect(writes).toBe(1);
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

for (const game of ['hausdepp', 'watten']) for (const language of ['de', 'en']) {
  test(`${game} release notes open from lobby and remain readable in account settings (${language})`, async ({ page }, testInfo) => {
    const user = await createAccount(page, `suiteaccount_release_${game}_${language}`, language);
    let revision = '1'.repeat(40), acknowledged = false;
    const reads = [], writes = [];
    await page.route('**/api/account/merges/pending', route => route.fulfill({ json: { viewer_id: user.id, operations: [] } }));
    await page.route('**/api/releases**', route => {
      const request = route.request(), url = new URL(request.url());
      expect(url.searchParams.get('game_type')).toBe(game);
      if (request.method() === 'POST') {
        expect(request.headers()['x-csrf-token']).toBeTruthy();
        expect(request.postDataJSON()).toEqual({ viewer_id: user.id });
        writes.push(url.pathname); acknowledged = true;
        return route.fulfill({ json: { ok: true } });
      }
      reads.push(url.pathname);
      expect(url.searchParams.get('language')).toBe(language);
      return route.fulfill({ json: { viewer_id: user.id, current_version: '4.6.0', can_prompt: true, releases: [{
        revision, version: '4.6.0', published_at: '2026-10-25T12:00:00Z', acknowledged, can_announce: true,
        title: language === 'de' ? 'Neuigkeiten am Tisch' : 'Updates at the table',
        changes: [language === 'de' ? 'Der Kontobereich ist übersichtlich geordnet.' : 'Your account settings are clearly organized.'],
      }] } });
    });
    await page.goto(`/${game}?pwa=${game}`);
    const dialog = page.locator('.release-notes-dialog');
    await expect(dialog).toHaveAttribute('data-revision', revision);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: language === 'de' ? 'Verstanden' : 'Got it', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([`/api/releases/${revision}/acknowledge`]);
    revision = '2'.repeat(40); acknowledged = false;
    const accountPath = game === 'hausdepp' ? '/hausdepp/konto' : '/watten/konto/fortschritt';
    await page.locator(`.suite-header__nav a[href="${accountPath}"]`).click();
    await expect(page).toHaveURL(new URL(accountPath, page.url()).href);
    await expect(dialog).toHaveAttribute('data-revision', revision);
    await dialog.getByRole('button', { name: language === 'de' ? 'Verstanden' : 'Got it', exact: true }).click();
    revision = '3'.repeat(40); acknowledged = false;
    await page.goto(`/${game}/konto/einstellungen`);
    await expect(dialog).toHaveAttribute('data-revision', revision);
    await dialog.getByRole('button', { name: language === 'de' ? 'Verstanden' : 'Got it', exact: true }).click();
    for (const details of await page.locator('[data-release-history]').locator('xpath=ancestor::details').all()) {
      if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    }
    await expect(page.locator('[data-release-history]')).toContainText(language === 'de' ? 'Neuigkeiten am Tisch' : 'Updates at the table');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator('[data-account-section="help"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`${game}-release-help-${language}.png`), fullPage: true });
    expect(reads.length).toBeGreaterThanOrEqual(3);
  });
}
