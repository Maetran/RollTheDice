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

async function fixture(page, {
  user = firstAccount, documentLanguage = 'de', mountBeforeAuth = false, expectClaim = true,
  delayPrompt = false, promptResponse = { show_prompt: true, interval_days: 7 },
} = {}) {
  const state = {
    user, hasCredentials: false, delayMe: false, delayed: null,
    delayPrompt, delayedPrompt: null, promptResponse, promptRequests: 0,
  };
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
    if (pathname === '/api/auth/passkeys/prompt') {
      state.promptRequests += 1;
      const snapshot = { ...state.promptResponse };
      if (state.delayPrompt) {
        state.delayPrompt = false;
        state.delayedPrompt = () => route.fulfill({ json: snapshot });
        return;
      }
      return route.fulfill({ json: snapshot });
    }
    if (pathname === '/api/auth/passkeys/reauthentication/options') {
      return route.fulfill({ json: { token: 'account-action-proof', options: {
        challenge: Buffer.alloc(32, 9).toString('base64url'),
        rpId: 'passkey-auth-state.test', userVerification: 'required',
      } } });
    }
    if (pathname === '/api/auth/passkeys/41' && route.request().method() === 'DELETE') {
      state.hasCredentials = false;
      return route.fulfill({ json: { ok: true } });
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
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="${documentLanguage}"><body>
      <aside id="prompt" hidden></aside>
      <section data-passkey-section><div id="settings"></div></section></body></html>` });
  });
  await page.goto(`${origin}/`);
  await page.evaluate(async ({ mountBeforeAuth }) => {
    window.accountBundle = await import('/account.js');
    window.companionBundle = await import('/companion.js');
    window.promptEvents = 0;
    window.addEventListener('zdwa:passkey-prompt-state', () => { window.promptEvents += 1; });
    if (mountBeforeAuth) window.accountBundle.mountPasskeyPrompt(document.querySelector('#prompt'), {
      accountUrl: '/konto?passkey=1#settings',
    });
    const auth = await window.accountBundle.loadAuth();
    window.accountBundle.mountPasskeyPrompt(document.querySelector('#prompt'), {
      auth, accountUrl: '/konto?passkey=1#settings',
    });
    window.authEvents = [];
    window.addEventListener('zdwa:auth-state', event => window.authEvents.push(event.detail));
  }, { mountBeforeAuth });
  if (!expectClaim) await expect(page.locator('#prompt')).toBeHidden();
  else if (delayPrompt) await expect.poll(() => Boolean(state.delayedPrompt)).toBe(true);
  else {
    await expect.poll(() => page.evaluate(() => window.promptEvents)).toBe(1);
    if (promptResponse.show_prompt) await expect(page.locator('#prompt')).toBeVisible();
    else await expect(page.locator('#prompt')).toBeHidden();
  }
  return state;
}

async function delayCompanionIdentity(page, state) {
  state.delayMe = true;
  await page.evaluate(() => {
    window.pendingIdentity = window.companionBundle.loadAuth({ refresh: true });
  });
  await expect.poll(() => Boolean(state.delayed)).toBe(true);
}

test('initial null and anonymous auth can render without throwing or claiming a reminder', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const state = await fixture(page, { user: null, mountBeforeAuth: true, expectClaim: false });
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await window.accountBundle.loadAuth();
  });
  await expect(page.locator('#prompt')).toBeHidden();
  expect(state.promptRequests).toBe(0);
  expect(await page.evaluate(() => window.promptEvents)).toBe(0);
  expect(await page.evaluate(async () => (await window.accountBundle.loadAuth()).user)).toBeNull();
  expect(errors).toEqual([]);
});

test('account language reload does not consume a reminder before the translated document is ready', async ({ page }) => {
  const state = await fixture(page, {
    user: { ...firstAccount, preferences: { preferred_language: 'en' } },
    documentLanguage: 'de', expectClaim: false,
  });
  await page.evaluate(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await window.accountBundle.loadAuth({ refresh: true });
  });
  await expect(page.locator('#prompt')).toBeHidden();
  expect(state.promptRequests).toBe(0);

  // The real locale synchronization replaces the document. Simulate its
  // translated state here so the test can verify the claim was never reserved.
  await page.evaluate(async () => {
    document.documentElement.lang = 'en';
    const auth = await window.accountBundle.loadAuth();
    window.dispatchEvent(new CustomEvent('zdwa:auth-state', { detail: auth }));
  });
  await expect(page.locator('#prompt')).toBeVisible();
  expect(state.promptRequests).toBe(1);
});

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

test('a delayed reminder cannot reappear after passkey enrollment and later removal', async ({ page }) => {
  const state = await fixture(page, { delayPrompt: true });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  try {
    await page.evaluate(() => window.accountBundle.mountPasskeySettings(document.querySelector('#settings')));
    await page.locator('[name="current_password"]').fill('test-password-only');
    await page.locator('[name="label"]').fill('Review phone');
    await page.getByRole('button', { name: 'Passkey hinzufügen' }).click();
    await expect(page.locator('[data-passkey-list] li')).toHaveCount(1);
    await state.delayedPrompt();
    await expect.poll(() => page.evaluate(() => window.promptEvents)).toBe(1);
    await expect(page.locator('#prompt')).toBeHidden();

    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-remove-passkey]').click();
    await expect(page.locator('[data-passkey-list] li')).toHaveCount(0);
    await expect(page.locator('[data-passkey-message]')).toContainText('Passkey entfernt.');
    await expect(page.locator('#prompt')).toBeHidden();
    expect(state.promptRequests).toBe(1);
  } finally {
    await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
    await cdp.detach();
  }
});

test('a suppressed reminder with a past deadline cannot loop on a stale account inventory', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2030-01-01T12:00:01Z'));
  const state = await fixture(page, { promptResponse: {
    show_prompt: false, interval_days: 7, next_prompt_at: '2029-12-01T12:00:00Z',
  } });
  // Another device can add a passkey while this document still believes that
  // none exist. The suppressed server reply must leave a future retry boundary.
  await page.clock.fastForward(59_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.clock.runFor(20);
  await expect(page.locator('#prompt')).toBeHidden();
  expect(state.promptRequests).toBe(1);
  expect(await page.evaluate(() => window.promptEvents)).toBe(1);
});

test('a preserved document reclaims its reminder at the seven-day boundary when resumed', async ({ page }) => {
  const initialTime = new Date('2030-02-01T12:00:01Z');
  const week = 7 * 24 * 60 * 60 * 1000;
  await page.clock.install({ time: new Date(initialTime.getTime() - 1000) });
  await page.clock.pauseAt(initialTime);
  const state = await fixture(page, { promptResponse: {
    show_prompt: false, interval_days: 7,
    next_prompt_at: new Date(initialTime.getTime() + week).toISOString(),
  } });
  await page.clock.fastForward(week - 1);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await page.evaluate(() => window.accountBundle.loadAuth());
  expect(state.promptRequests).toBe(1);
  await expect(page.locator('#prompt')).toBeHidden();

  state.promptResponse = {
    show_prompt: true, interval_days: 7,
    next_prompt_at: new Date(initialTime.getTime() + 2 * week).toISOString(),
  };
  await page.clock.fastForward(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#prompt')).toBeVisible();
  expect(state.promptRequests).toBe(2);
});
