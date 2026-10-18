const { defineConfig } = require("@playwright/test");
const { browserTestEnvironment } = require("./scripts/playwright-test-environment.cjs");

const isolated = browserTestEnvironment({ name: "main", portVariable: "ROLLTHEDICE_TEST_PORT", defaultPort: 8010 });
const { port } = isolated;
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const previewAccounts = "hausdepp_chat_suite,adminhelp_zilch,previewfriend,settings_zilch_de,settings_zilch_en,forcedsettings_zilch,settings_savedchoices,pushsettings,zilchsigninready,emailsettings_zilch_de,emailsettings_zilch_en,passkeyprompt_zilch_de,passkeyprompt_zilch_en,passkeyguard_zilch,passkeydismiss_zilch,history_de_light,history_en_light,history_de_lcars,history_en_lcars,freshzilchawards,historystatsoffline,github_zdwa_issues,github_zdwa_changelog,github_zilch_issues,github_zilch_changelog";

module.exports = defineConfig({
  testDir: "tests/browser",
  testIgnore: "**/username-change.spec.js",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  // A browser process can occasionally disappear before a test has received
  // its first context (not an assertion or application failure). Retry once
  // in CI so this infrastructure-only launch flake does not hide a real
  // product regression; a repeated UI assertion still fails the run.
  retries: process.env.CI ? 1 : 0,
  reporter: isolated.reporter,
  outputDir: isolated.outputDir,
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  // One shard creates close to 200 real tables within the hourly window (plus
  // CI retries); the test-only creation limits leave headroom above that.
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `${isolated.python} -m uvicorn scripts.browser_test_app:create_application --factory --no-proxy-headers --host 127.0.0.1 --port ${port} --ws-max-size 65536`,
    env: {
      PLAYWRIGHT_TEST_DIR: isolated.directory, DATA_DIR: isolated.directory,
      ROLLTHEDICE_DATA_DIR: isolated.directory,
      ROLLTHEDICE_SITE_ORIGIN: `http://127.0.0.1:${port}`,
      ROLLTHEDICE_EMAIL_ENABLED: "0", ROLLTHEDICE_PASSKEYS_ENABLED: "0",
      ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW: "1", ROLLTHEDICE_WATTEN_GAME_PREVIEW: "1",
      ROLLTHEDICE_DATABASE_URL: isolated.databaseURL,
      ROLLTHEDICE_ADMIN_USERNAME: "Admin", ROLLTHEDICE_FOUNDER_USER_ID: "1",
      ROLLTHEDICE_ADMIN_PASSWORD: "temporary-password-123", ROLLTHEDICE_COOKIE_SECURE: "0",
      ROLLTHEDICE_GAME_CREATE_BURST_MAX: "100", ROLLTHEDICE_GAME_CREATE_IP_MAX: "600",
      ROLLTHEDICE_GAME_CREATE_GLOBAL_MAX: "1000", ROLLTHEDICE_ZILCH_PREVIEW_USERNAMES: previewAccounts,
    },
    url: baseURL,
    reuseExistingServer: false,
    gracefulShutdown: isolated.gracefulShutdown,
    timeout: 15000,
  },
});
