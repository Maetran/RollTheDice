const { defineConfig } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const port = Number(process.env.ROLLTHEDICE_PASSKEY_TEST_PORT || 8012);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid passkey test port");
// A registrable reserved localhost subdomain models the production RP hierarchy.
// Bare localhost itself cannot be used as an RP suffix from zilch.localhost.
const baseURL = `http://rollthedice.localhost:${port}`;
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rollthedice-passkey-browser-"));
const pythonExecutable = process.env.PLAYWRIGHT_PYTHON
  || (fs.existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");
const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

module.exports = defineConfig({
  testDir: "tests/browser-passkeys",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "test-results/passkeys",
  use: {
    baseURL,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    // Chromium resolves reserved localhost names to loopback; no DNS or TLS
    // exceptions are added, so native secure-context checks stay meaningful.
  },
  webServer: {
    command: `${shellQuote(pythonExecutable)} -m uvicorn app.main:app --host 127.0.0.1 --port ${port} --ws-max-size 65536`,
    env: {
      ROLLTHEDICE_DATABASE_URL: `sqlite:///${path.join(testDirectory, "accounts.sqlite3")}`,
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
      ROLLTHEDICE_ADMIN_PASSWORD: "temporary-password-123",
      ROLLTHEDICE_ZILCH_ACCESS_MODE: "public",
    },
    url: baseURL,
    reuseExistingServer: false,
    timeout: 20000,
  },
});
