const { test, expect } = require('@playwright/test');
const { build } = require('esbuild');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { player, create, action } = require('./helpers/watten-journey.cjs');

test('blind trick remains visible after an immediate human lead while real CPUs wait', async ({ browser }) => {
  test.setTimeout(90_000);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'watten-blind-reveal-'));
  const port = await new Promise((resolve, reject) => {
    const listener = net.createServer(); listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const value = listener.address().port; listener.close(error => error ? reject(error) : resolve(value));
    });
  });
  const baseURL = `http://127.0.0.1:${port}`;
  const python = process.env.PLAYWRIGHT_PYTHON || (fs.existsSync('.venv/bin/python') ? path.resolve('.venv/bin/python') : 'python3');
  const env = { ...process.env, PLAYWRIGHT_TEST_DIR: directory, DATA_DIR: directory, ROLLTHEDICE_DATA_DIR: directory,
    ROLLTHEDICE_DATABASE_URL: `sqlite:///${path.join(directory, 'accounts.sqlite3')}`, ROLLTHEDICE_SITE_ORIGIN: baseURL,
    ROLLTHEDICE_EMAIL_ENABLED: '0', ROLLTHEDICE_PASSKEYS_ENABLED: '0', ROLLTHEDICE_WATTEN_PUBLIC_BETA: '0',
    ROLLTHEDICE_WATTEN_ACCOUNT_PREVIEW: '1', ROLLTHEDICE_WATTEN_GAME_PREVIEW: '1',
    ROLLTHEDICE_ADMIN_USERNAME: 'Admin', ROLLTHEDICE_FOUNDER_USER_ID: '1',
    ROLLTHEDICE_ADMIN_PASSWORD: 'temporary-password-123', ROLLTHEDICE_COOKIE_SECURE: '0' };
  const server = spawn(python, ['-m', 'uvicorn', 'tests.browser.fixtures.watten_blind_hold_app:create_application',
    '--factory', '--no-proxy-headers', '--host', '127.0.0.1', '--port', String(port), '--ws-max-size', '65536'], { env });
  let logs = ''; server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
  let host;
  try {
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
      try { return (await fetch(`${baseURL}/api/health`)).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    const wrapped = { newContext: opts => browser.newContext({ ...opts, viewport: { width: 440, height: 956 }, serviceWorkers: 'block' }) };
    host = await player(wrapped, baseURL);
    // Use the freshly built source, without mutating the shared generated file.
    const bundle = await build({ entryPoints: [path.join(__dirname, '../../frontend/watten/game.js')], bundle: true,
      write: false, format: 'esm', platform: 'browser', target: 'es2020', logLevel: 'silent' });
    await host.page.route('**/static/watten-game.js?*', route => route.fulfill({
      status: 200, contentType: 'application/javascript', body: bundle.outputFiles[0].text,
    }));
    await create([host], { count: 4, determination: 'ladinisch', target: 21, cpuFill: true });
    await expect.poll(() => {
      const engine = host.traffic.snapshot?.engine;
      return engine?.actions.includes('show_ready') || engine?.actions.includes('inspection_ack') || engine?.actions.includes('play_card');
    }, { timeout: 20_000 }).toBeTruthy();
    if (host.traffic.snapshot.engine.actions.includes('show_ready')) await action([host], 'show_ready');
    await expect.poll(() => host.traffic.snapshot.engine.actions.includes('inspection_ack'), { timeout: 20_000 }).toBe(true);
    await action([host], 'inspection_ack');
    await expect.poll(() => host.traffic.snapshot.engine.actions.includes('play_card'), { timeout: 20_000 }).toBe(true);
    let before = host.traffic.snapshot.engine.opportunity;
    await host.page.locator('[data-wt-hand] button[data-card="hearts-7"]').press('Enter');
    await expect.poll(() => host.traffic.snapshot.engine.opportunity).not.toBe(before);
    await expect.poll(() => {
      const engine = host.traffic.snapshot.engine;
      return engine.last_trick?.cards.length === 4 && engine.last_trick.winner === engine.viewer.seat
        && engine.actions.includes('play_card');
    }, { timeout: 10_000 }).toBe(true);
    const group = host.page.locator('[data-wt-motion="collect"]');
    await expect(group).toHaveCount(1);
    expect(await group.evaluate(node => ({ duration: node.getAnimations()[0].effect.getTiming().duration,
      cards: node.children.length, opacity: getComputedStyle(node).opacity })))
      .toEqual({ duration: 4600, cards: 4, opacity: '1' });
    before = host.traffic.snapshot.engine.opportunity;
    const lead = host.traffic.snapshot.engine.hand[0].card;
    await host.page.locator(`[data-wt-hand] button[data-card="${lead}"]`).press('Enter');
    await expect.poll(() => host.traffic.snapshot.engine.opportunity).not.toBe(before);
    await expect.poll(() => host.traffic.snapshot.engine.current_trick.cards.length).toBe(1);
    await host.page.waitForTimeout(1100);
    expect(host.traffic.snapshot.engine.current_trick.cards).toHaveLength(1);
    await expect(group).toHaveCount(1);
    await expect.poll(() => host.traffic.snapshot.engine.current_trick.cards.length, { timeout: 8_000 }).toBeGreaterThan(1);
    expect(host.traffic.errors).toEqual([]);
  } finally {
    await host?.context.close();
    if (server.exitCode === null) {
      server.kill('SIGTERM');
      await new Promise(resolve => { const timer = setTimeout(() => { server.kill('SIGKILL'); resolve(); }, 5000);
        server.once('exit', () => { clearTimeout(timer); resolve(); }); });
    }
    await rm(directory, { recursive: true, force: true });
  }
});
