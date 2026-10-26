const { test, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

test.use({ serviceWorkers: 'block' });

const SOURCE = { id: 41, username: 'Old<Name>WithLongAccountName1234', role: 'user', is_active: false, is_merged: false };
const TARGET = { id: 42, username: 'NewAccountWithLongName123456789', role: 'user', is_active: true, is_merged: false };
const OWNER = { id: 7, username: 'MergeOwner', role: 'admin', is_admin: true, is_active: true,
  is_owner: true, is_founder: true, csrf_token: 'mounted-owner-csrf', has_password: true };
const FINGERPRINT = 'b'.repeat(64);
const PROOF_TOKEN = 'action-bound-merge-proof-token';
const games = Object.fromEntries(['zdwa', 'zilch', 'hausdepp', 'watten'].map(game => [game, {
  before_points: 10, after_points: 25,
  before_rank: { ...(game === 'zdwa' ? { key: 'novice' } : {}), de: 'Anfänger', en: 'Beginner' },
  after_rank: { de: 'Profi', en: 'Pro' }, achievement_count: 6, inherited_achievement_count: 2,
  new_achievement_count: 1, games_played: 12,
}]));
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}

async function fixture(page, { language = 'de', width = 320, owner = true, passkey = false } = {}) {
  await page.setViewportSize({ width, height: 844 });
  await page.addInitScript(language => {
    localStorage.setItem('zdwa_language', language);
    localStorage.setItem('wuerfler_theme', 'light');
  }, language);
  const state = { current: { ...OWNER, is_owner: owner, is_founder: owner }, reads: 0,
    searches: [], previews: [], applies: [], options: [], previewError: null,
    previewGate: null, applyGate: null, ambiguous: false };
  const users = [{ ...OWNER }, { ...SOURCE }, { ...TARGET },
    { ...SOURCE, id: 43, username: 'RetiredSource', is_merged: true },
    { ...TARGET, id: 44, username: 'InactiveTarget', is_active: false }];
  const auth = () => ({ authenticated: true,
    user: { ...state.current, preferences: { preferred_language: language } },
    passkeys: { enabled: passkey, has_credentials: passkey }, game_access: {},
  });
  const shell = await readFile(path.join(__dirname, '../../app/static/admin.html'), 'utf8');
  await page.route('**/api/**', route => route.fulfill({ json: { participants: [], games: [] } }));
  await page.route('**/admin', route => route.fulfill({ contentType: 'text/html', body: shell }));
  await page.route('**/api/auth/me', route => { state.reads += 1; return route.fulfill({ json: auth() }); });
  await page.route('**/api/admin/users?*', route => {
    const params = new URL(route.request().url()).searchParams;
    const query = params.get('query') || '', limit = Number(params.get('limit'));
    if (limit === 20) state.searches.push({ query, limit, offset: params.get('offset') });
    const matches = users.filter(user => user.username.toLowerCase().includes(query.toLowerCase()));
    return route.fulfill({ json: { users: matches.slice(0, limit), viewer: {
      is_owner: state.current.is_owner, is_founder: state.current.is_founder, can_create_admin: state.current.is_owner,
    } } });
  });
  await page.route('**/api/admin/account-merges/preview', async route => {
    const request = route.request();
    expect(request.headers()['x-account-expected-id']).toBe(String(OWNER.id));
    expect(request.headers()['x-csrf-token']).toBe(OWNER.csrf_token);
    state.previews.push(request.postDataJSON());
    if (state.previewGate) { const held = state.previewGate; held.entered.release(); await held.release.promise; }
    if (state.previewError) return route.fulfill({ status: 409, json: { detail: state.previewError } });
    return route.fulfill({ json: { source: { id: SOURCE.id, username: SOURCE.username },
      target: { id: TARGET.id, username: TARGET.username }, fingerprint: FINGERPRINT, games } });
  });
  await page.route('**/api/auth/passkeys/reauthentication/options', route => {
    const request = route.request();
    expect(request.headers()['x-account-expected-id']).toBe(String(OWNER.id));
    expect(request.headers()['x-csrf-token']).toBe(OWNER.csrf_token);
    state.options.push(request.postDataJSON());
    return route.fulfill({ json: { token: PROOF_TOKEN, options: {
      challenge: Buffer.alloc(32, 9).toString('base64url'), userVerification: 'required',
    } } });
  });
  await page.route('**/api/admin/account-merges/apply', async route => {
    const request = route.request();
    expect(request.headers()['x-account-expected-id']).toBe(String(OWNER.id));
    expect(request.headers()['x-csrf-token']).toBe(OWNER.csrf_token);
    state.applies.push(request.postDataJSON());
    if (state.applyGate) { const held = state.applyGate; held.entered.release(); await held.release.promise; }
    if (state.ambiguous) { state.ambiguous = false; return route.abort('connectionfailed'); }
    return route.fulfill({ json: { operation_id: 'c'.repeat(32), target_user_id: TARGET.id,
      acknowledged: false, replayed: state.applies.length > 1, games } });
  });
  await page.goto('/admin');
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  if (owner) {
    await expect(page.locator('#accountMergeTile')).toBeVisible();
    await page.locator('#accountMergeTile').click();
    await expect(page.locator('#accountMergePanel [data-account-merge-controls]')).toBeVisible();
  }
  return state;
}

function selector(page, kind) {
  return page.locator(`.merge-selector:has(#accountMerge${kind}Search)`);
}
async function pick(page, kind, account) {
  const area = selector(page, kind);
  await area.locator('input[type=search]').fill(account.username);
  await area.locator('button[type=submit]').click();
  await area.locator('.merge-result').filter({ hasText: `#${account.id}` }).click();
  await expect(area.locator('.merge-selected strong')).toHaveText(`${account.username} · #${account.id}`);
}
async function preview(page) {
  await pick(page, 'Source', SOURCE); await pick(page, 'Target', TARGET);
  await page.locator('.merge-preview-button').click();
  await expect(page.locator('.merge-game')).toHaveCount(4);
  await expect(page.locator('.merge-confirm-form')).toBeVisible();
}
async function confirmPassword(page) {
  await page.locator('.merge-confirmation input').check();
  await page.locator('#accountMergePassword').fill('owner-password-for-this-test');
  await expect(page.locator('.merge-confirm-form button[type=submit]')).toBeEnabled();
}

for (const language of ['de', 'en']) {
  test(`${language}: account merge preview is readable on mobile and tablets and applies one confirmed pair`, async ({ page }, testInfo) => {
    const state = await fixture(page, { language });
    await preview(page);
    expect(state.searches).toEqual([
      { query: SOURCE.username, limit: 20, offset: '0' }, { query: TARGET.username, limit: 20, offset: '0' },
    ]);
    expect(state.previews).toEqual([{ source_user_id: SOURCE.id, target_user_id: TARGET.id }]);
    await expect(page.locator('#accountMergePanel .merge-game h4')).toHaveText(['ZDWA', 'Zilch', 'Hausdepp', 'Watten']);
    await expect(page.locator('.merge-game dd').filter({ hasText: language === 'de' ? 'Anfänger → Profi' : 'Beginner → Pro' })).toHaveCount(4);
    await expect(page.locator('#accountMergePanel Name')).toHaveCount(0);
    await expect(page.locator('.merge-confirm-form button[type=submit]')).toBeDisabled();
    for (const [name, viewport] of [['mobile', { width: 320, height: 844 }],
      ['tablet-portrait', { width: 768, height: 1024 }], ['tablet-landscape', { width: 1024, height: 768 }]]) {
      await page.setViewportSize(viewport);
      const layout = await page.locator('#accountMergePanel').evaluate(panel => ({
        width: document.documentElement.scrollWidth, viewport: innerWidth,
        controls: [...panel.querySelectorAll('button,input:not([type=checkbox]),select')]
          .filter(item => item.checkVisibility()).map(item => {
            const rect = item.getBoundingClientRect(); return { left: rect.left, right: rect.right, height: rect.height };
          }),
      }));
      expect(layout.width).toBeLessThanOrEqual(layout.viewport + 1);
      for (const item of layout.controls) {
        expect(item.left).toBeGreaterThanOrEqual(-1); expect(item.right).toBeLessThanOrEqual(layout.viewport + 1);
        expect(item.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: testInfo.outputPath(`merge-${language}-${name}.png`), fullPage: true });
    }
    await confirmPassword(page);
    await page.locator('.merge-confirm-form button[type=submit]').click();
    await expect(page.locator('.merge-success')).toHaveText(language === 'de' ? 'Zusammenführung abgeschlossen.' : 'Account merge complete.');
    expect(state.applies).toHaveLength(1);
    expect(state.applies[0]).toEqual({ source_user_id: SOURCE.id, target_user_id: TARGET.id,
      fingerprint: FINGERPRINT, idempotency_key: expect.stringMatching(/^[a-f0-9-]{36}$/), confirmed: true,
      current_password: 'owner-password-for-this-test' });
    await expect(page.locator('#accountMergePassword')).toHaveValue('');
  });
}

test('ordinary admins cannot open the owner merge module', async ({ page }) => {
  const state = await fixture(page, { owner: false });
  await expect(page.locator('#accountMergeTile')).toBeHidden();
  await expect(page.locator('#accountMergePanel')).toBeHidden();
  expect(state.previews).toEqual([]); expect(state.applies).toEqual([]);
});

test('source eligibility allows inactive ordinary accounts and rejects protected or retired accounts', async ({ page }) => {
  await fixture(page);
  const source = selector(page, 'Source');
  await source.locator('button[type=submit]').click();
  await expect(source.locator('.merge-result').filter({ hasText: `#${OWNER.id}` })).toBeDisabled();
  await expect(source.locator('.merge-result').filter({ hasText: '#43' })).toBeDisabled();
  await expect(source.locator('.merge-result').filter({ hasText: `#${SOURCE.id}` })).toBeEnabled();
  const target = selector(page, 'Target');
  await target.locator('button[type=submit]').click();
  await expect(target.locator('.merge-result').filter({ hasText: '#44' })).toBeDisabled();
});

test('changing account search clears preview and confirmation and a stale preview needs fresh selection proof', async ({ page }) => {
  const state = await fixture(page);
  await preview(page); await confirmPassword(page);
  await selector(page, 'Source').locator('input[type=search]').fill('changed');
  await expect(page.locator('.merge-game')).toHaveCount(0);
  await expect(page.locator('#accountMergePassword')).toHaveValue('');
  await expect(page.locator('.merge-confirmation input')).not.toBeChecked();
  await expect(page.locator('.merge-preview-button')).toBeDisabled();
  state.previewError = 'merge_preview_stale';
  await pick(page, 'Source', SOURCE);
  await page.locator('.merge-preview-button').click();
  await expect(page.locator('[data-account-merge-status]')).toContainText('neue Vorschau');
  await expect(page.locator('.merge-confirm-form')).toBeHidden();
  expect(state.applies).toEqual([]);
});

test('a held apply prevents duplicate submission and an uncertain reply reuses the exact operation key', async ({ page }) => {
  const state = await fixture(page);
  await preview(page); await confirmPassword(page);
  const held = { entered: gate(), release: gate() }; state.applyGate = held; state.ambiguous = true;
  try {
    await page.locator('.merge-confirm-form button[type=submit]').click();
    await held.entered.promise;
    await expect(page.locator('.merge-confirm-form button[type=submit]')).toBeDisabled();
    await expect(selector(page, 'Source').locator('input[type=search]')).toBeDisabled();
    expect(state.applies).toHaveLength(1);
  } finally { held.release.release(); }
  await expect(page.locator('[data-account-merge-status]')).toContainText('Ergebnis ist noch unklar');
  await expect(page.locator('#accountMergePassword')).toHaveValue('');
  await expect(selector(page, 'Target').locator('input[type=search]')).toBeDisabled();
  state.applyGate = null;
  await confirmPassword(page);
  await page.locator('.merge-confirm-form button[type=submit]').click();
  await expect(page.locator('.merge-success')).toBeVisible();
  expect(state.applies).toHaveLength(2);
  expect(state.applies[1].idempotency_key).toBe(state.applies[0].idempotency_key);
  expect(state.applies[1]).toEqual(state.applies[0]);
});

test('a delayed preview cannot restore private state after the mounted owner changes', async ({ page }) => {
  const state = await fixture(page);
  await pick(page, 'Source', SOURCE); await pick(page, 'Target', TARGET);
  const held = { entered: gate(), release: gate() }; state.previewGate = held;
  try {
    await page.locator('.merge-preview-button').click(); await held.entered.promise;
    state.current = { ...OWNER, id: OWNER.id + 1, csrf_token: 'other-owner-csrf' };
    await page.evaluate(user => window.dispatchEvent(new CustomEvent('zdwa:auth-state', {
      detail: { authenticated: true, user },
    })), state.current);
    await expect(page.locator('#accountMergeTile')).toBeHidden();
    await expect(page.locator('.merge-game')).toHaveCount(0);
  } finally { held.release.release(); }
  await expect(page.locator('#accountMergePanel')).toBeHidden();
  expect(state.applies).toEqual([]);
});

test('fresh identity verification stops apply without using another owners CSRF token', async ({ page }) => {
  const state = await fixture(page);
  await preview(page); await confirmPassword(page);
  state.current = { ...OWNER, id: OWNER.id + 1, csrf_token: 'other-owner-csrf' };
  await page.locator('.merge-confirm-form button[type=submit]').click();
  await expect(page.locator('#accountMergeTile')).toBeHidden();
  await expect(page.locator('#accountMergePassword')).toHaveValue('');
  expect(state.applies).toEqual([]);
});

test('page lifecycle suspension clears secrets and requires a freshly verified preview on restore', async ({ page }) => {
  const state = await fixture(page);
  await preview(page); await confirmPassword(page);
  const reads = state.reads;
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('#accountMergePassword')).toHaveValue('');
  await expect(page.locator('.merge-confirmation input')).not.toBeChecked();
  await expect(page.locator('.merge-game')).toHaveCount(0);
  await expect(page.locator('.merge-confirm-form')).toBeHidden();
  await expect.poll(() => state.reads).toBeGreaterThan(reads);
  expect(state.applies).toEqual([]);
});

test('passkey confirmation carries the real action target and exactly one proof type', async ({ page }) => {
  // Exercise the actual WebAuthn conversion helper with a controlled device
  // result. Signature validation belongs to the backend passkey suite.
  await page.addInitScript(() => {
    window.PublicKeyCredential = class {};
    Object.defineProperty(navigator, 'credentials', { configurable: true, value: {
      create() {},
      async get({ publicKey }) {
        window.mergePasskeyChallenge = [...new Uint8Array(publicKey.challenge)];
        return { id: 'device-credential', rawId: new Uint8Array([1, 2, 3]).buffer, type: 'public-key',
          response: { clientDataJSON: new Uint8Array([4, 5]).buffer,
            authenticatorData: new Uint8Array([6, 7]).buffer, signature: new Uint8Array([8, 9]).buffer },
          getClientExtensionResults: () => ({}) };
      },
    } });
  });
  const state = await fixture(page, { passkey: true });
  await preview(page);
  await expect(page.locator('#accountMergeMethod')).toHaveValue('passkey');
  await page.locator('.merge-confirmation input').check();
  await page.locator('.merge-confirm-form button[type=submit]').click();
  await expect(page.locator('.merge-success')).toBeVisible();
  expect(state.options).toEqual([{ action: 'merge_accounts', target: `${SOURCE.id}:${TARGET.id}:${FINGERPRINT}` }]);
  expect(state.applies).toHaveLength(1);
  expect(state.applies[0].current_password).toBeUndefined();
  expect(state.applies[0].passkey).toEqual({ token: PROOF_TOKEN, credential: {
    id: 'device-credential', rawId: 'AQID', type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON: 'BAU', authenticatorData: 'Bgc', signature: 'CAk' },
  } });
  expect(await page.evaluate(() => window.mergePasskeyChallenge)).toEqual(Array(32).fill(9));
});

test('real owner HTTP flow retires only the source credentials and delivers the saved merge notice', async ({ browser }, testInfo) => {
  const contexts = [];
  try {
    for (let index = 0; index < 4; index += 1) {
      contexts.push(await browser.newContext({ baseURL: testInfo.project.use.baseURL, serviceWorkers: 'block' }));
    }
    const [ownerPage, sourcePage, targetPage, loginCheck] = await Promise.all(contexts.map(context => context.newPage()));
    const ownerPassword = 'temporary-password-123';
    const ownerLogin = await ownerPage.request.post('/api/auth/login', {
      data: { username: 'Admin', password: ownerPassword },
    });
    expect(ownerLogin.status()).toBe(200);
    const ownerIdentity = (await ownerLogin.json()).user;
    expect(ownerIdentity).toMatchObject({ is_admin: true, is_owner: true, is_founder: true });
    const people = [];
    for (const [kind, accountPage] of [['Source', sourcePage], ['Target', targetPage]]) {
      const username = `MergeUI_${kind}`;
      const temporary = `merge-ui-${kind.toLowerCase()}-temporary-password`;
      const password = `merge-ui-${kind.toLowerCase()}-final-password`;
      const created = await ownerPage.request.post('/api/admin/users', {
        headers: { 'X-CSRF-Token': ownerIdentity.csrf_token },
        data: { username, temporary_password: temporary, role: 'user' },
      });
      expect(created.status()).toBe(201);
      const account = (await created.json()).user;
      const firstLogin = await accountPage.request.post('/api/auth/login', { data: { username, password: temporary } });
      expect(firstLogin.status()).toBe(200);
      const first = (await firstLogin.json()).user;
      expect((await accountPage.request.post('/api/auth/change-password', {
        headers: { 'X-CSRF-Token': first.csrf_token }, data: { current_password: temporary, new_password: password },
      })).status()).toBe(200);
      const signedIn = await accountPage.request.post('/api/auth/login', { data: { username, password } });
      expect(signedIn.status()).toBe(200);
      const identity = (await signedIn.json()).user;
      expect((await accountPage.request.put('/api/auth/preferences/language', {
        headers: { 'X-CSRF-Token': identity.csrf_token },
        data: { preferred_language: kind === 'Source' ? 'en' : 'de' },
      })).status()).toBe(200);
      people.push({ ...account, password, identity });
    }
    const [source, target] = people;
    await ownerPage.setViewportSize({ width: 320, height: 844 });
    await ownerPage.goto('/admin');
    await ownerPage.locator('#accountMergeTile').click();
    await pick(ownerPage, 'Source', source); await pick(ownerPage, 'Target', target);
    const previewResponse = ownerPage.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/account-merges/preview');
    await ownerPage.locator('.merge-preview-button').click();
    const previewReply = await previewResponse;
    expect(previewReply.status()).toBe(200);
    expect(previewReply.request().headers()['x-account-expected-id']).toBe(String(ownerIdentity.id));
    const projected = await previewReply.json();
    expect(projected.source.id).toBe(source.id); expect(projected.target.id).toBe(target.id);
    expect(Object.keys(projected.games).sort()).toEqual(['hausdepp', 'watten', 'zdwa', 'zilch']);
    await expect(ownerPage.locator('.merge-game')).toHaveCount(4);
    await ownerPage.locator('.merge-confirmation input').check();
    await ownerPage.locator('#accountMergePassword').fill(ownerPassword);
    const appliedResponse = ownerPage.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/account-merges/apply');
    await ownerPage.locator('.merge-confirm-form button[type=submit]').click();
    const appliedReply = await appliedResponse;
    expect(appliedReply.status()).toBe(200);
    const operation = await appliedReply.json();
    expect(operation.target_user_id).toBe(target.id); expect(operation.replayed).toBe(false);
    await expect(ownerPage.locator('.merge-success')).toBeVisible();
    await expect(ownerPage.locator('#accountMergePassword')).toHaveValue('');
    await ownerPage.screenshot({ path: testInfo.outputPath('real-owner-merge-success-mobile.png'), fullPage: true });

    const oldSession = await (await sourcePage.request.get('/api/auth/me')).json();
    expect(oldSession.authenticated).toBe(false); expect(oldSession.user).toBeNull();
    expect((await sourcePage.request.post('/api/auth/login', {
      data: { username: source.username, password: source.password },
    })).status()).toBe(401);
    const surviving = (await (await targetPage.request.get('/api/auth/me')).json()).user;
    expect(surviving).toMatchObject({ id: target.id, username: target.username,
      csrf_token: target.identity.csrf_token, preferences: { preferred_language: 'de' } });
    expect((await loginCheck.request.post('/api/auth/login', {
      data: { username: target.username, password: target.password },
    })).status()).toBe(200);
    const pending = await targetPage.request.get('/api/account/merges/pending', {
      headers: { 'X-Account-Expected-Id': String(target.id) },
    });
    expect(pending.status()).toBe(200);
    expect((await pending.json()).operations.map(value => value.operation_id)).toEqual([operation.operation_id]);
    await targetPage.setViewportSize({ width: 320, height: 844 });
    await targetPage.goto('/konto#settings');
    const notice = targetPage.locator(`[data-account-merge-operation="${operation.operation_id}"]`);
    await expect(notice).toBeVisible();
    await expect(notice.locator('.account-merge-notice__games dt')).toHaveText(['ZDWA', 'Zilch', 'Hausdepp', 'Watten']);
    await targetPage.screenshot({ path: testInfo.outputPath('real-target-merge-notice-mobile.png'), fullPage: true });
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
