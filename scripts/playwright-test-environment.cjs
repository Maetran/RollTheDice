const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

function browserTestEnvironment({ name, portVariable, defaultPort, defaultOutputDir = "test-results" }) {
  const port = Number(process.env[portVariable] || defaultPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`Invalid ${name} test port`);
  const directory = process.env.PLAYWRIGHT_TEST_DIR
    ? path.resolve(process.env.PLAYWRIGHT_TEST_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), `rollthedice-${name}-`));
  fs.mkdirSync(directory, { recursive: true });
  const python = process.env.PLAYWRIGHT_PYTHON
    || (fs.existsSync(".venv/bin/python") ? ".venv/bin/python" : "python3");
  const htmlDirectory = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR;
  return {
    port,
    directory,
    python: shellQuote(python),
    databaseURL: `sqlite:///${path.join(directory, "accounts.sqlite3")}`,
    outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR || defaultOutputDir,
    reporter: process.env.CI || htmlDirectory
      ? [[process.env.CI ? "line" : "list"], ["html", { open: "never", ...(htmlDirectory ? { outputFolder: htmlDirectory } : {}) }]]
      : "list",
    // Let Uvicorn finish persistence when Playwright or its parent is stopped.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5000 },
  };
}

module.exports = { browserTestEnvironment, shellQuote };
