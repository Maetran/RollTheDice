const { defineConfig } = require('@playwright/test');
const { browserTestEnvironment } = require('./scripts/playwright-test-environment.cjs');

const isolated = browserTestEnvironment({ name: 'watten', portVariable: 'ROLLTHEDICE_WATTEN_TEST_PORT', defaultPort: 8034,
  defaultOutputDir: 'test-results/browser/watten' });
const baseURL = `http://127.0.0.1:${isolated.port}`;

module.exports = defineConfig({
  testDir: 'tests/browser', testMatch: 'watten-game.spec.js',
  fullyParallel: false, workers: 1, timeout: 45000,
  reporter: isolated.reporter, outputDir: isolated.outputDir,
  use: { baseURL, browserName: 'chromium', serviceWorkers: 'block',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: `${isolated.python} -m uvicorn scripts.browser_test_app:create_application --factory --no-proxy-headers --host 127.0.0.1 --port ${isolated.port} --ws-max-size 65536`,
    env: {
      PLAYWRIGHT_TEST_DIR: isolated.directory, DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATA_DIR: isolated.directory, ROLLTHEDICE_DATABASE_URL: isolated.databaseURL,
      ROLLTHEDICE_SITE_ORIGIN: baseURL, ROLLTHEDICE_COOKIE_SECURE: '0',
      ROLLTHEDICE_EMAIL_ENABLED: '0', ROLLTHEDICE_PASSKEYS_ENABLED: '0',
      ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW: '1', ROLLTHEDICE_WATTEN_GAME_PREVIEW: '1',
      ROLLTHEDICE_ADMIN_USERNAME: 'Admin', ROLLTHEDICE_FOUNDER_USER_ID: '1',
      ROLLTHEDICE_ADMIN_PASSWORD: 'temporary-password-123',
      ROLLTHEDICE_GAME_CREATE_BURST_MAX: '100', ROLLTHEDICE_GAME_CREATE_IP_MAX: '600',
      ROLLTHEDICE_GAME_CREATE_GLOBAL_MAX: '1000',
    },
    url: baseURL, reuseExistingServer: false, gracefulShutdown: isolated.gracefulShutdown, timeout: 20000,
  },
});
