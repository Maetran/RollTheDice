const { defineConfig } = require("@playwright/test");
const { browserTestEnvironment } = require("./scripts/playwright-test-environment.cjs");

const isolated = browserTestEnvironment({ name: "passkeys", portVariable: "ROLLTHEDICE_PASSKEY_TEST_PORT", defaultPort: 8012,
  defaultOutputDir: "test-results/passkeys" });
const { port } = isolated;
// A registrable reserved localhost subdomain models the production RP hierarchy.
// Bare localhost itself cannot be used as an RP suffix from zilch.localhost.
const baseURL = `http://rollthedice.localhost:${port}`;

module.exports = defineConfig({
  testDir: "tests/browser-passkeys",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: isolated.reporter,
  outputDir: isolated.outputDir,
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Chromium resolves reserved localhost names to loopback; no DNS or TLS
    // exceptions are added, so native secure-context checks stay meaningful.
  },
  webServer: {
    command: `${isolated.python} -m uvicorn scripts.browser_test_app:create_application --factory --no-proxy-headers --host 127.0.0.1 --port ${port} --ws-max-size 65536`,
    env: {
      PLAYWRIGHT_TEST_DIR: isolated.directory, DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATABASE_URL: isolated.databaseURL,
      ROLLTHEDICE_SITE_ORIGIN: baseURL,
      ROLLTHEDICE_ZILCH_ORIGIN: `http://zilch.rollthedice.localhost:${port}`,
      ROLLTHEDICE_PASSKEYS_ENABLED: "1",
      ROLLTHEDICE_WEBAUTHN_RP_ID: "rollthedice.localhost",
      ROLLTHEDICE_WEBAUTHN_RP_NAME: "RollTheDice browser test",
      ROLLTHEDICE_COOKIE_SECURE: "0",
      ROLLTHEDICE_COOKIE_DOMAIN: "",
      ROLLTHEDICE_EMAIL_ENABLED: "0",
      ROLLTHEDICE_RESEND_API_KEY: "",
      ROLLTHEDICE_EMAIL_FROM: "",
      ROLLTHEDICE_TURNSTILE_SITE_KEY: "",
      ROLLTHEDICE_TURNSTILE_SECRET: "",
      ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY: "",
      ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY: "",
      ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT: "",
      ROLLTHEDICE_ADMIN_USERNAME: "Admin",
      ROLLTHEDICE_FOUNDER_USER_ID: "1",
      ROLLTHEDICE_ADMIN_PASSWORD: "temporary-password-123",
      ROLLTHEDICE_ZILCH_ACCESS_MODE: "public",
    },
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: isolated.gracefulShutdown,
    timeout: 20000,
  },
});
