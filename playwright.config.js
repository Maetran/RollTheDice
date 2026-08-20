const { defineConfig } = require("@playwright/test");

const port = Number(process.env.ROLLTHEDICE_TEST_PORT || 8010);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;

module.exports = defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `ROLLTHEDICE_DATABASE_URL=sqlite:////tmp/rollthedice-playwright.sqlite3 ROLLTHEDICE_ADMIN_USERNAME=Admin ROLLTHEDICE_ADMIN_PASSWORD=temporary-password-123 ROLLTHEDICE_COOKIE_SECURE=0 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 15000,
  },
});
