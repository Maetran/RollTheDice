const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");

const port = Number(process.env.ROLLTHEDICE_TEST_PORT || 8010);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${port}`;
const testDatabase = `/tmp/rollthedice-playwright-${process.pid}.sqlite3`;
const pythonExecutable = process.env.PLAYWRIGHT_PYTHON
  || (fs.existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");

module.exports = defineConfig({
  testDir: "tests/browser",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : "list",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: `ROLLTHEDICE_DATABASE_URL=sqlite:///${testDatabase} ROLLTHEDICE_ADMIN_USERNAME=Admin ROLLTHEDICE_ADMIN_PASSWORD=temporary-password-123 ROLLTHEDICE_COOKIE_SECURE=0 ROLLTHEDICE_GAME_CREATE_BURST_MAX=100 ROLLTHEDICE_GAME_CREATE_IP_MAX=200 ROLLTHEDICE_GAME_CREATE_GLOBAL_MAX=500 ${pythonExecutable} -m uvicorn app.main:app --host 127.0.0.1 --port ${port} --ws-max-size 65536`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 15000,
  },
});
