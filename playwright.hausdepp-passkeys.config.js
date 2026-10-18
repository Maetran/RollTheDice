const { defineConfig } = require('@playwright/test');
const { browserTestEnvironment } = require('./scripts/playwright-test-environment.cjs');

const isolated = browserTestEnvironment({ name: 'hausdepp-passkeys',
  portVariable: 'ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT', defaultPort: 8054 });
const { port } = isolated;

module.exports = defineConfig({
  testDir: 'tests/browser-hausdepp-passkeys',
  timeout: 30000,
  workers: 1,
  retries: 0,
  reporter: isolated.reporter,
  outputDir: isolated.outputDir,
  use: {
    baseURL: 'https://hausdepp.zockdiewandan.online',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // All document/API traffic is relayed by the test to loopback. A missed
    // route must fail DNS rather than ever contact a production product host.
    launchOptions: { args: ['--host-resolver-rules=MAP hausdepp.zockdiewandan.online ~NOTFOUND, MAP zockdiewandan.online ~NOTFOUND, MAP zilch.zockdiewandan.online ~NOTFOUND'] },
  },
  webServer: {
    // Models the trusted local TLS-terminating reverse proxy; only loopback
    // may supply the HTTPS forwarded scheme used by the fixed-origin policy.
    command: `${isolated.python} -m uvicorn scripts.browser_test_app:create_application --factory --proxy-headers --forwarded-allow-ips=127.0.0.1 --host 127.0.0.1 --port ${port}`,
    env: {
      PLAYWRIGHT_TEST_DIR: isolated.directory, DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATABASE_URL: isolated.databaseURL,
      ROLLTHEDICE_SITE_ORIGIN: 'https://zockdiewandan.online',
      ROLLTHEDICE_ZILCH_ORIGIN: 'https://zilch.zockdiewandan.online',
      ROLLTHEDICE_PASSKEYS_ENABLED: '1',
      ROLLTHEDICE_WEBAUTHN_RP_ID: 'zockdiewandan.online',
      ROLLTHEDICE_COOKIE_SECURE: '1', ROLLTHEDICE_COOKIE_DOMAIN: '',
      ROLLTHEDICE_EMAIL_ENABLED: '0', ROLLTHEDICE_RESEND_API_KEY: '', ROLLTHEDICE_EMAIL_FROM: '',
      ROLLTHEDICE_TURNSTILE_SITE_KEY: '', ROLLTHEDICE_TURNSTILE_SECRET: '',
      ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY: '', ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY: '', ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT: '',
      ROLLTHEDICE_ADMIN_USERNAME: 'Admin', ROLLTHEDICE_FOUNDER_USER_ID: '1',
      ROLLTHEDICE_ADMIN_PASSWORD: 'temporary-password-123', ROLLTHEDICE_ZILCH_ACCESS_MODE: 'public',
    },
    url: `http://127.0.0.1:${port}/api/auth/me`,
    reuseExistingServer: false,
    gracefulShutdown: isolated.gracefulShutdown,
    timeout: 20000,
  },
});
