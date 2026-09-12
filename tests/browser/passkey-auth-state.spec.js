const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');

const origin = 'https://passkey-auth-state.test';
const firstAccount = { id: 301, username: 'FirstPlayer', csrf_token: 'first-csrf', must_change_password: false };
const secondAccount = { id: 302, username: 'SecondPlayer', csrf_token: 'second-csrf', must_change_password: false };
let bundles;

test.beforeAll(async () => {
  // Product entry points each bundle auth.js independently. Loading one module
  // twice would miss the state split that caused the original regression.
  bundles = await Promise.all(['account', 'companion'].map(async name => {
    const result = await build({
      stdin: {
        contents: `export * from './frontend/shared/auth.js'; export const entryName = '${name}';`,
        resolveDir: process.cwd(),
        sourcefile: `${name}-entry.js`,
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
    });
    return result.outputFiles[0].text;
  }));
});

async function fixture(page) {
  const state = { user: firstAccount, hasCredentials: false, delayMe: false, delayed: null };
  const authPayload = () => ({
    authenticated: Boolean(state.user),
    user: state.user,
    passkeys: { enabled: true, ...(state.user ? { has_credentials: state.hasCredentials } : {}) },
  });
  await page.route(`${origin}/**`, async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/account.js' || pathname === '/companion.js') {
      return route.fulfill({ contentType: 'text/javascript', body: bundles[pathname === '/account.js' ? 0 : 1] });
    }
    if (pathname === '/api/auth/me') {
      const snapshot = authPayload();
      if (state.delayMe) {
        state.delayMe = false;
        state.delayed = () => route.fulfill({ json: snapshot });
        return;
      }
      return route.fulfill({ json: snapshot });
    }
    if (pathname === '/api/auth/logout') {
      state.user = null;
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === '/api/auth/login') {
      state.user = secondAccount;
      state.hasCredentials = false;
      return route.fulfill({ json: { authenticated: true, user: state.user } });
    }
    if (pathname === '/api/auth/passkeys') {
      return route.fulfill({ json: {
        enabled: true,
        credentials: state.hasCredentials ? [{ id: 41, label: 'Review phone' }] : [],
      } });
    }
    if (pathname === '/api/auth/passkeys/registration/options') {
      return route.fulfill({ json: { options: {
        challenge: Buffer.alloc(32, 7).toString('base64url'),
        rp: { id: 'passkey-auth-state.test', name: 'Passkey state regression' },
        user: { id: Buffer.from('first-player').toString('base64url'), name: firstAccount.username, displayName: firstAccount.username },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      } } });
    }
    if (pathname === '/api/auth/passkeys/registration/verify') {
      state.hasCredentials = true;
      return route.fulfill({ json: { ok: true, credential: { id: 41, label: 'Review phone' } } });
    }
    if (pathname !== '/') throw new Error(`Unexpected fixture request: ${pathname}`);
    return route.fulfill({ contentType: 'text/html', body: `
      <aside id="prompt" hidden></aside>
      <section data-passkey-section><div id="settings"></div></section>` });
  });
  await page.goto(`${origin}/`);
  await page.evaluate(async () => {
    window.accountBundle = await import('/account.js');
    window.companionBundle = await import('/companion.js');
    const auth = await window.accountBundle.loadAuth();
    window.accountBundle.mountPasskeyPrompt(document.querySelector('#prompt'), {
      auth, accountUrl: '/konto?passkey=1#settings',
    });
    window.authEvents = [];
    window.addEventListener('zdwa:auth-state', event => window.authEvents.push(event.detail));
  });
  await expect(page.locator('#prompt')).toBeVisible();
  return state;
}

async function delayCompanionIdentity(page, state) {
  state.delayMe = true;
  await page.evaluate(() => {
    window.pendingIdentity = window.companionBundle.loadAuth({ refresh: true });
  });
  await expect.poll(() => Boolean(state.delayed)).toBe(true);
}

test('a delayed identity from another bundle cannot restore the prompt after passkey enrollment', async ({ page }) => {
  const state = await fixture(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.evaluate(() => window.accountBundle.mountPasskeySettings(document.querySelector('#settings')));
  await delayCompanionIdentity(page, state);
  await page.locator('[name="current_password"]').fill('test-password-only');
  await page.locator('[name="label"]').fill('Review phone');
  await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
  await expect(page.locator('[data-passkey-list]')).toContainText('Review phone');
  await expect(page.locator('#prompt')).toBeHidden();
  await expect(page.locator('[name="current_password"]')).toHaveValue('');
  await state.delayed();
  const resolved = await page.evaluate(() => window.pendingIdentity);
  expect(resolved.passkeys.has_credentials).toBe(true);
  await expect(page.locator('#prompt')).toBeHidden();
  expect(await page.evaluate(async () => (await window.companionBundle.loadAuth()).passkeys.has_credentials)).toBe(true);
});

test('logout in another bundle cannot return an old signed-in identity to waiting UI', async ({ page }) => {
  const state = await fixture(page);
  await delayCompanionIdentity(page, state);
  await page.evaluate(() => window.accountBundle.logout());
  await expect(page.locator('#prompt')).toBeHidden();
  await state.delayed();
  const resolved = await page.evaluate(() => window.pendingIdentity);
  expect(resolved.authenticated).toBe(false);
  expect(resolved.user).toBeNull();
  await expect(page.locator('#prompt')).toBeHidden();
  expect(await page.evaluate(() => window.authEvents.every(event => !event.authenticated))).toBe(true);
});

test('switching accounts keeps the new identity when another bundle finishes an old read', async ({ page }) => {
  const state = await fixture(page);
  await delayCompanionIdentity(page, state);
  await page.evaluate(() => window.accountBundle.login('SecondPlayer', 'test-password-only'));
  // The login response has no credential inventory. The previous account's
  // missing-passkey hint must not be inherited while the fresh lookup runs.
  await expect(page.locator('#prompt')).toBeHidden();
  await page.evaluate(() => window.accountBundle.loadAuth({ refresh: true }));
  await expect(page.locator('#prompt')).toBeVisible();
  await state.delayed();
  const resolved = await page.evaluate(() => window.pendingIdentity);
  expect(resolved.user.id).toBe(secondAccount.id);
  expect(await page.evaluate(async () => (await window.companionBundle.loadAuth()).user.id)).toBe(secondAccount.id);
  expect(await page.evaluate(() => window.authEvents.every(event => event.user?.id === 302))).toBe(true);
});
