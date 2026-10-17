const playwright = require('@playwright/test');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { pythonExecutable } = require('./browser-config');

const root = path.resolve(__dirname, '..');

function serverEnvironment(directory, configured = {}) {
  // A developer's shell may carry real database, email or push credentials.
  // Test children get explicit local settings and no inherited product config.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('ROLLTHEDICE_')));
  return {
    ...env,
    FORWARDED_ALLOW_IPS: '127.0.0.1',
    ANALYTICS_DATA_PATH: directory,
    ROLLTHEDICE_DATABASE_URL: `sqlite:///${path.join(directory, 'accounts.sqlite3')}`,
    ROLLTHEDICE_ADMIN_USERNAME: 'Admin',
    ROLLTHEDICE_ADMIN_PASSWORD: 'temporary-password-123',
    ROLLTHEDICE_FOUNDER_USER_ID: '1',
    ROLLTHEDICE_COOKIE_SECURE: '0',
    ROLLTHEDICE_COOKIE_DOMAIN: '',
    ROLLTHEDICE_EMAIL_ENABLED: '0',
    ROLLTHEDICE_RESEND_API_KEY: '',
    ROLLTHEDICE_EMAIL_FROM: '',
    ROLLTHEDICE_TURNSTILE_SITE_KEY: '',
    ROLLTHEDICE_TURNSTILE_SECRET: '',
    ROLLTHEDICE_WEB_PUSH_VAPID_PUBLIC_KEY: '',
    ROLLTHEDICE_WEB_PUSH_VAPID_PRIVATE_KEY: '',
    ROLLTHEDICE_WEB_PUSH_VAPID_SUBJECT: '',
    ROLLTHEDICE_PASSKEYS_ENABLED: '0',
    ROLLTHEDICE_GAME_CREATE_BURST_MAX: '100',
    ROLLTHEDICE_GAME_CREATE_IP_MAX: '200',
    ROLLTHEDICE_GAME_CREATE_GLOBAL_MAX: '500',
    ROLLTHEDICE_MAX_WEBSOCKETS_PER_ADDRESS: '100',
    ROLLTHEDICE_MAX_WEBSOCKETS_GLOBAL: '500',
    ROLLTHEDICE_ZILCH_ACCESS_MODE: 'preview',
    ...configured,
  };
}

async function stopServer(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once('close', resolve));
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await closed; } finally { clearTimeout(force); }
}

async function startServer(settings, workerInfo) {
  if (settings.externalBaseURL) {
    // Also catches the CLI/IDE --workers override, which supersedes config.
    if (workerInfo.config.workers !== 1) {
      throw new Error('PLAYWRIGHT_BASE_URL shares an existing server; run it with --workers=1');
    }
    return { baseURL: settings.externalBaseURL, upstreamOrigin: settings.externalBaseURL, close: async () => {} };
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), `rollthedice-browser-${workerInfo.workerIndex}-`));
  const child = spawn(pythonExecutable, [path.join(__dirname, 'browser_server.py'), '--directory', directory, '--mode', settings.mode], {
    cwd: root,
    env: serverEnvironment(directory, settings.env),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let launchError;
  const capture = data => { output = (output + data.toString()).slice(-16000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', error => { launchError = error; });
  const close = async () => {
    try { await stopServer(child); } finally { await rm(directory, { recursive: true, force: true }); }
  };
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Browser server exited: ${output}`);
      let address;
      try { address = JSON.parse(await readFile(path.join(directory, 'server.json'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
      if (address) {
        try {
          const response = await fetch(`${address.upstreamOrigin}/api/auth/me`, { signal: AbortSignal.timeout(1000) });
          if (response.ok) return { ...address, close };
        } catch { /* The socket is bound before migrations and application startup finish. */ }
      }
      await delay(100);
    }
    throw new Error(`Browser server did not become ready within 30 seconds: ${output}`);
  } catch (error) {
    await close();
    throw error;
  }
}

const test = playwright.test.extend({
  browserServer: [async ({}, use, workerInfo) => {
    const settings = workerInfo.project.metadata.browserServer;
    if (!settings) throw new Error('This browser suite requires browserServer metadata in its Playwright config');
    const server = await startServer(settings, workerInfo);
    try { await use(server); } finally { await server.close(); }
  }, { scope: 'worker', timeout: 45000 }],
  baseURL: async ({ browserServer }, use) => { await use(browserServer.baseURL); },
  upstreamOrigin: [async ({ browserServer }, use) => { await use(browserServer.upstreamOrigin); }, { scope: 'worker' }],
});

module.exports = { ...playwright, test };
