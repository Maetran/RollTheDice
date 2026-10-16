const { test, expect, request } = require('@playwright/test');

const HOUSE_ORIGIN = 'https://hausdepp.zockdiewandan.online';
const port = Number(process.env.ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT || 8054);
const upstreamOrigin = `http://127.0.0.1:${port}`;

async function isolatedHouseTransport(context, clientNumber) {
  const transport = await request.newContext();
  const unexpected = [];
  await context.route('**/*', async route => {
    const original = route.request();
    const target = new URL(original.url());
    if (target.origin !== HOUSE_ORIGIN) {
      unexpected.push(`${target.origin}${target.pathname}`);
      return route.abort();
    }
    const headers = { ...await original.allHeaders(), host: target.host, 'x-forwarded-proto': 'https',
      'x-forwarded-for': `192.0.2.${clientNumber}` };
    delete headers['content-length'];
    const upstream = new URL(`${target.pathname}${target.search}`, upstreamOrigin);
    expect(upstream.origin).toBe(upstreamOrigin);
    const response = await transport.fetch(upstream.href, {
      method: original.method(), headers, data: original.postDataBuffer() || undefined, maxRedirects: 0,
    });
    await route.fulfill({ response });
  });
  // Presence/chat are outside this native-credential test. No WebSocket may
  // leave loopback or reach production, including after a successful sign-in.
  await context.routeWebSocket('wss://hausdepp.zockdiewandan.online/**', () => {});
  return { unexpected, dispose: () => transport.dispose() };
}

for (const language of ['de', 'en']) for (const installed of [false, true]) {
  test(`${language}: native House passkey signup and sign-in retain the ${installed ? 'installed PWA' : 'browser'} origin`, async ({ page, context }, testInfo) => {
    const relay = await isolatedHouseTransport(context, 10 + (language === 'en' ? 2 : 0) + Number(installed));
    await context.addInitScript(({ language, installed }) => {
      localStorage.setItem('zdwa_language', language);
      if (installed) {
        Object.defineProperty(navigator, 'standalone', { value: true });
        sessionStorage.setItem('rollthedice:pwa-entry:v1', 'hausdepp');
      }
    }, { language, installed });
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
      protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    const navigations = [];
    page.on('framenavigated', frame => { if (frame === page.mainFrame() && frame.url() !== 'about:blank') navigations.push(frame.url()); });
    try {
      await page.goto(`${HOUSE_ORIGIN}/hausdepp${installed ? '?pwa=hausdepp' : ''}`);
      expect(await page.evaluate(() => isSecureContext)).toBe(true);
      await page.locator('#hausdeppRegister').click();
      await expect(page).toHaveURL(`${HOUSE_ORIGIN}/hausdepp/anmelden?return_to=%2Fhausdepp#zilchRegistrationForm`);
      await expect(page.locator('#zilchLoginTitle')).toHaveText(language === 'de' ? 'Bei Hausdepp anmelden' : 'Sign in to Hausdepp');
      await expect(page.locator('html')).toHaveAttribute('data-hausdepp-login', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-game', 'hausdepp');
      expect(await page.locator('.zilch-login-card').evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
      expect((await page.locator('#zilchPasskeyLoginButton').boundingBox()).height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('data-pwa-product', 'hausdepp');
      await page.screenshot({ path: testInfo.outputPath('house-sign-in.png'), fullPage: true });
      const username = `HouseNative_${language}_${installed ? 'PWA' : 'Web'}`;
      await page.locator('#zilchRegistrationUsername').fill(username);
      await page.locator('#zilchRegistrationMethod').selectOption('passkey');
      const signup = page.waitForResponse(response => response.url() === `${HOUSE_ORIGIN}/api/auth/passkeys/signup/verify`).catch(() => null);
      const [options] = await Promise.all([
        page.waitForResponse(response => response.url() === `${HOUSE_ORIGIN}/api/auth/passkeys/signup/options`),
        page.locator('#zilchRegisterButton').click(),
      ]);
      expect(options.status()).toBe(200);
      const verified = await signup;
      expect(verified).not.toBeNull();
      expect(verified.status()).toBe(201);
      await expect(page).toHaveURL(`${HOUSE_ORIGIN}/hausdepp`);
      await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
      const created = await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
      expect(created.user.username).toBe(username);
      expect(created.user.is_owner).toBeFalsy();
      expect(created.user.has_password).toBe(false);
      const enrolled = (await client.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
      expect(enrolled).toHaveLength(1);
      expect(enrolled[0].rpId).toBe('zockdiewandan.online');
      await context.clearCookies();
      await page.goto(`${HOUSE_ORIGIN}/hausdepp`);
      if (installed) await page.evaluate(() => sessionStorage.removeItem('rollthedice:pwa-entry:v1'));
      await page.locator('#hausdeppSignIn').click();
      const returnTo = installed && language === 'de' ? '/hausdepp?resume=1' : '/hausdepp';
      if (installed) {
        // Exercise both a safe direct query and the fixed House host's empty
        // return_to fallback, without an apex continuation or a new session.
        await page.goto(`${HOUSE_ORIGIN}/zilch/anmelden${language === 'de' ? `?return_to=${encodeURIComponent(returnTo)}` : ''}`);
      }
      await expect(page.locator('#zilchPasskeyLoginButton')).toBeVisible();
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('data-pwa-product', 'hausdepp');
      if (installed) expect(await page.evaluate(() => sessionStorage.getItem('rollthedice:pwa-entry:v1'))).toBe('hausdepp');
      let assertionRequest;
      page.on('request', request => {
        if (request.url() === `${HOUSE_ORIGIN}/api/auth/passkeys/authentication/verify`) assertionRequest = request;
      });
      const authenticated = page.waitForResponse(response => response.url() === `${HOUSE_ORIGIN}/api/auth/passkeys/authentication/verify`);
      await page.locator('#zilchPasskeyLoginButton').click();
      expect((await authenticated).status()).toBe(200);
      await expect(page).toHaveURL(`${HOUSE_ORIGIN}${returnTo}`);
      await expect(page.locator('#hausdeppCreateForm')).toBeVisible();
      expect((await assertionRequest.allHeaders()).origin).toBe(HOUSE_ORIGIN);
      const clientData = JSON.parse(Buffer.from(assertionRequest.postDataJSON().credential.response.clientDataJSON, 'base64url').toString());
      expect(clientData).toMatchObject({ origin: HOUSE_ORIGIN, type: 'webauthn.get' });
      const current = await page.evaluate(() => fetch('/api/auth/me').then(response => response.json()));
      expect(current.user.id).toBe(created.user.id);
      const used = (await client.send('WebAuthn.getCredentials', { authenticatorId })).credentials;
      expect(used).toHaveLength(1);
      expect(used[0].credentialId).toBe(enrolled[0].credentialId);
      expect(used[0].signCount).toBeGreaterThan(enrolled[0].signCount);
      expect(navigations.every(url => new URL(url).origin === HOUSE_ORIGIN)).toBe(true);
      expect(relay.unexpected).toEqual([]);
    } finally {
      await context.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
      await client.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId }).catch(() => {});
      await client.detach().catch(() => {});
      await relay.dispose();
    }
  });
}
