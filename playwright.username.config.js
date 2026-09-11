const { defineConfig } = require("@playwright/test");
const base = require("./playwright.config");

// Username changes must also work in the public product, where account names
// are not tied to the private preview allowlist used by the legacy UI suite.
module.exports = defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "**/username-change.spec.js",
  webServer: base.webServer ? {
    ...base.webServer,
    command: `ROLLTHEDICE_ZILCH_ACCESS_MODE=public ${base.webServer.command}`,
  } : undefined,
});
