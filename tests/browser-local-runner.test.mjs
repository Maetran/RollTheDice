import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIGS, createSuitePlan, parseArguments, reservePort, runLocalBrowserTests } from '../scripts/test-browser-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const names = ['main-1', 'main-2', 'main-3', 'main-4', 'username', 'passkeys', 'hausdepp-passkeys'];

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-runner-node-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'fake-playwright.mjs');
  await writeFile(cli, `
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
const env = process.env;
const name = path.basename(env.PLAYWRIGHT_TEST_DIR);
const record = type => appendFileSync(env.FAKE_EVENTS, JSON.stringify({ type, name, time: Date.now(),
  port: env.ROLLTHEDICE_TEST_PORT, directory: env.PLAYWRIGHT_TEST_DIR, output: env.PLAYWRIGHT_OUTPUT_DIR,
  html: env.PLAYWRIGHT_HTML_OUTPUT_DIR, python: env.PLAYWRIGHT_PYTHON, args: process.argv.slice(2) }) + '\\n');
record('start');
console.log('kept stdout ' + name); console.error('kept stderr ' + name);
writeFileSync(path.join(env.PLAYWRIGHT_TEST_DIR, 'accounts.sqlite3'), 'isolated test accounts');
mkdirSync(env.PLAYWRIGHT_OUTPUT_DIR, { recursive: true });
writeFileSync(path.join(env.PLAYWRIGHT_OUTPUT_DIR, 'trace.zip'), 'retained trace evidence');
mkdirSync(env.PLAYWRIGHT_HTML_OUTPUT_DIR, { recursive: true });
writeFileSync(path.join(env.PLAYWRIGHT_HTML_OUTPUT_DIR, 'index.html'), 'retained HTML report');
if (env.FAKE_BLOCK === '1') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  writeFileSync(env.FAKE_PIDS, JSON.stringify({ parent: process.pid, descendant: child.pid }));
  setInterval(() => {}, 1000);
} else setTimeout(() => { record('end'); process.exit(env.FAKE_FAIL === name ? 7 : 0); }, name.startsWith('main-') ? 180 : 30);
`);
  return { directory, cli, events: path.join(directory, 'events.jsonl') };
}

function cleanEnvironment(extra = {}) {
  const environment = { ...process.env, ...extra };
  for (const key of ['PLAYWRIGHT_BASE_URL', 'PLAYWRIGHT_LOCAL_OUTPUT_DIR', 'PLAYWRIGHT_HTML_OUTPUT_DIR']) delete environment[key];
  return environment;
}

test('the default plan covers four one-worker shards and every isolated account suite exactly once', () => {
  const plan = createSuitePlan({ root: '/repo', temporaryDirectory: '/tmp/owned', outputDirectory: '/reports/run',
    ports: [18100, 18101, 18102, 18103, 18104, 18105, 18106],
    environment: { PLAYWRIGHT_PYTHON: '/python with spaces/bin/python', PLAYWRIGHT_OUTPUT_DIR: '/inherited' } });
  assert.deepEqual(plan.map(item => item.name), names);
  for (const [index, suite] of plan.entries()) {
    assert.equal(suite.args.filter(arg => arg === '--workers=1').length, 1);
    assert.equal(suite.args.filter(arg => arg === '--forbid-only').length, 1);
    assert.equal(suite.args.filter(arg => arg === '--retries=0').length, 1);
    assert.equal(suite.env.PLAYWRIGHT_PYTHON, '/python with spaces/bin/python');
    assert.equal(suite.env.ROLLTHEDICE_TEST_PORT, String(18100 + index));
    assert.equal(suite.env.PLAYWRIGHT_OUTPUT_DIR, suite.outputDir);
    assert.equal(suite.env.PLAYWRIGHT_BASE_URL, undefined);
    if (index < 4) assert.ok(suite.args.includes('--shard=' + (index + 1) + '/4'));
    else assert.ok(!suite.args.some(arg => arg.startsWith('--shard=')));
  }
  for (const field of ['testDirectory', 'outputDir', 'htmlDir', 'logPath']) assert.equal(new Set(plan.map(item => item[field])).size, 7);
});

test('the real Playwright CLI refuses focused tests in unfiltered and filtered runner plans before executing them', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-runner-focused-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = path.join(directory, 'test-body-ran');
  await writeFile(path.join(directory, CONFIGS.username), "module.exports = { testDir: __dirname, forbidOnly: false, reporter: 'list' };\n");
  await writeFile(path.join(directory, 'focused.spec.js'), `
const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
test.only('focused case', () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected execution'));
`);
  for (const filters of [[], ['--grep', 'focused case']]) {
    const [suite] = createSuitePlan({ root: directory, temporaryDirectory: directory, outputDirectory: directory,
      suites: ['username'], ports: [18200], filters, environment: cleanEnvironment() });
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), ...suite.args], {
      cwd: directory, env: suite.env, encoding: 'utf8', timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    assert.equal(result.status, 1, output);
    assert.match(output, /--forbid-only/);
    assert.match(output, /focused\.spec\.js/);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  }
});

test('the real Playwright CLI preserves a first-attempt failure with CI enabled instead of retrying it', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-runner-retry-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const attempts = path.join(directory, 'attempts.txt');
  await writeFile(path.join(directory, CONFIGS.username), "module.exports = { testDir: __dirname, retries: 1, reporter: 'list' };\n");
  await writeFile(path.join(directory, 'retry.spec.js'), `
const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
test('passes only on retry', () => {
  require('node:fs').appendFileSync(${JSON.stringify(attempts)}, 'attempt\\n');
  if (test.info().retry === 0) throw new Error('first attempt failed');
});
`);
  const [suite] = createSuitePlan({ root: directory, temporaryDirectory: directory, outputDirectory: directory,
    suites: ['username'], ports: [18200], environment: cleanEnvironment({ CI: '1' }) });
  const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), ...suite.args], {
    cwd: directory, env: suite.env, encoding: 'utf8', timeout: 15000,
  });
  const output = result.stdout + result.stderr;
  assert.equal(result.status, 1, output);
  assert.match(output, /first attempt failed/);
  assert.equal(await readFile(attempts, 'utf8'), 'attempt\n');
});

test('config filtering cannot override worker, shard, server or report isolation', () => {
  assert.deepEqual(parseArguments(['--config', 'playwright.passkeys.config.js', '--', 'passkeys.spec.js', '--grep', 'sign in']), {
    suites: ['passkeys'], filters: ['passkeys.spec.js', '--grep', 'sign in'], outputDirectory: undefined, portBase: undefined,
  });
  for (const argument of ['--workers=8', '-j8', '--shard=2/2', '--config=x', '-cother.js', '--output=x', '--reporter=list', '--ui', '--retries=1']) {
    assert.throws(() => parseArguments(['--', argument]), /owns isolation/);
  }
  assert.throws(() => parseArguments(['--suite', 'unknown']), /Unknown/);
  assert.throws(() => parseArguments(['--suite', 'main', '--config', 'playwright.config.js']), /Duplicate/);
  assert.throws(() => parseArguments(['--port-base', '0']), /port-base/);
});

test('full orchestration retains failures and reports while extras run only after all four shards', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'output');
  const summary = await runLocalBrowserTests({ outputDirectory: output }, { root, cliPath: f.cli, quiet: true,
    environment: cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_FAIL: 'main-2', PLAYWRIGHT_PYTHON: '/chosen/python' }) });
  assert.equal(summary.fullRun, true);
  assert.equal(summary.exitCode, 1);
  assert.deepEqual(summary.results.map(item => item.name), names);
  assert.deepEqual(summary.results.map(item => item.exitCode), [0, 7, 0, 0, 0, 0, 0]);
  const events = (await readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const starts = events.filter(event => event.type === 'start');
  assert.equal(starts.length, 7);
  assert.equal(new Set(starts.map(item => item.port)).size, 7);
  assert.equal(new Set(starts.map(item => item.directory)).size, 7);
  const mainEnds = events.filter(event => event.type === 'end' && event.name.startsWith('main-'));
  assert.ok(Math.max(...starts.slice(0, 4).map(item => item.time)) < Math.min(...mainEnds.map(item => item.time)), 'Four main shards really overlap');
  let previousEnd = Math.max(...mainEnds.map(item => item.time));
  for (const name of names.slice(4)) {
    const start = events.find(item => item.name === name && item.type === 'start');
    assert.ok(start.time >= previousEnd, `${name} runs serially after preceding suites`);
    previousEnd = events.find(item => item.name === name && item.type === 'end').time;
  }
  for (const result of summary.results) {
    const log = await readFile(result.logPath, 'utf8');
    assert.match(log, /kept stdout/); assert.match(log, /kept stderr/);
    assert.equal(await readFile(path.join(result.outputDir, 'trace.zip'), 'utf8'), 'retained trace evidence');
    assert.equal(await readFile(path.join(result.htmlDir, 'index.html'), 'utf8'), 'retained HTML report');
  }
  for (const start of starts) await assert.rejects(readFile(path.join(start.directory, 'accounts.sqlite3')), { code: 'ENOENT' });
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8')), summary);
});

test('filtered success is explicitly partial, and occupied output/ports never reuse another run', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'partial');
  const options = { outputDirectory: output, suites: ['username'], filters: ['--grep', 'one case'] };
  const deps = { root, cliPath: f.cli, quiet: true, environment: cleanEnvironment({ FAKE_EVENTS: f.events }) };
  const summary = await runLocalBrowserTests(options, deps);
  assert.equal(summary.fullRun, false); assert.equal(summary.exitCode, 0);
  assert.deepEqual(summary.results.map(item => item.name), ['username']);
  await assert.rejects(runLocalBrowserTests(options, deps), /non-empty/);
  const occupied = await reservePort();
  t.after(() => occupied.release());
  const blocked = await runLocalBrowserTests({ outputDirectory: path.join(f.directory, 'busy'), suites: ['username'], portBase: occupied.port }, deps);
  assert.equal(blocked.exitCode, 1); assert.equal(blocked.fullRun, false);
  assert.match(blocked.error, /EADDRINUSE/);
  assert.equal(blocked.results[0].status, 'not-started');
  assert.equal(occupied.port, blocked.results[0].port);
  await assert.rejects(runLocalBrowserTests({ outputDirectory: path.join(f.directory, 'external') }, {
    ...deps, environment: { PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:8000' },
  }), /PLAYWRIGHT_BASE_URL/);
});

test('all four configs preserve Python/output overrides and use distinct test databases without server reuse', async t => {
  const f = await fixture(t);
  for (const [index, config] of Object.values(CONFIGS).entries()) {
    const directory = path.join(f.directory, `config-${index}`);
    const environment = cleanEnvironment({ PLAYWRIGHT_TEST_DIR: directory, PLAYWRIGHT_PYTHON: "/chosen python's/bin/python",
      PLAYWRIGHT_OUTPUT_DIR: path.join(directory, 'artifacts'), PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, 'html'),
      ROLLTHEDICE_TEST_PORT: '18200', ROLLTHEDICE_PASSKEY_TEST_PORT: '18201', ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT: '18202' });
    // cleanEnvironment removes inherited HTML settings; this test supplies one explicitly.
    environment.PLAYWRIGHT_HTML_OUTPUT_DIR = path.join(directory, 'html');
    const loaded = JSON.parse(execFileSync(process.execPath, ['-e', `console.log(JSON.stringify(require(${JSON.stringify(path.join(root, config))})))`], { cwd: root, env: environment, encoding: 'utf8' }));
    assert.equal(loaded.webServer.reuseExistingServer, false);
    assert.equal(loaded.webServer.env.ROLLTHEDICE_DATABASE_URL, `sqlite:///${path.join(directory, 'accounts.sqlite3')}`);
    assert.equal(loaded.webServer.env.PLAYWRIGHT_TEST_DIR, directory);
    assert.equal(loaded.webServer.env.DATA_DIR, directory);
    assert.match(loaded.webServer.command, /scripts\.browser_test_app:create_application --factory/);
    assert.match(loaded.webServer.command, /^'\/chosen python'\\''s\/bin\/python'/);
    assert.equal(loaded.outputDir, path.join(directory, 'artifacts'));
    assert.deepEqual(loaded.reporter.at(-1), ['html', { open: 'never', outputFolder: path.join(directory, 'html') }]);
    if (config.includes('username')) assert.equal(loaded.webServer.env.ROLLTHEDICE_ZILCH_ACCESS_MODE, 'public');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} reaps only owned CLI/server descendants and retains its summary/logs`, { skip: process.platform === 'win32' }, async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'interrupted');
  const pidFile = path.join(f.directory, 'owned-pids.json');
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => unrelated.kill('SIGTERM'));
  const environment = cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_BLOCK: '1', FAKE_PIDS: pidFile });
  const runner = spawn(process.execPath, ['--input-type=module', '-e', `
import { runLocalBrowserTests } from ${JSON.stringify(new URL('../scripts/test-browser-local.mjs', import.meta.url).href)};
const result = await runLocalBrowserTests({ outputDirectory: ${JSON.stringify(output)}, suites: ['username'] },
  { root: ${JSON.stringify(root)}, cliPath: ${JSON.stringify(f.cli)}, quiet: true });
process.exitCode = result.exitCode;`], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => runner.kill('SIGTERM'));
  const finished = new Promise(resolve => runner.once('close', (code, stoppedBy) => resolve({ code, stoppedBy })));
  let pids;
  for (let attempt = 0; attempt < 100 && !pids; attempt++) {
    try { pids = JSON.parse(await readFile(pidFile, 'utf8')); } catch { await delay(20); }
  }
  assert.ok(pids, 'The owned CLI and detached server have started');
  runner.kill(signal);
  const outcome = await finished;
  assert.equal(outcome.code, signal === 'SIGINT' ? 130 : 143);
  const summary = JSON.parse(await readFile(path.join(output, 'summary.json'), 'utf8'));
  assert.equal(summary.fullRun, false); assert.equal(summary.interruption, signal);
  assert.equal(summary.results[0].exitCode, outcome.code);
  assert.equal(unrelated.exitCode, null, 'A foreign process remains running');
  for (const pid of Object.values(pids)) {
    let running = true;
    for (let attempt = 0; attempt < 50 && running; attempt++) {
      try { process.kill(pid, 0); await delay(20); } catch (error) { assert.equal(error.code, 'ESRCH'); running = false; }
    }
    assert.equal(running, false, `Owned process ${pid} was reaped`);
  }
  const start = JSON.parse((await readFile(f.events, 'utf8')).trim().split('\n')[0]);
  await assert.rejects(readFile(start.directory), { code: 'ENOENT' });
  assert.match(await readFile(summary.results[0].logPath, 'utf8'), /kept stdout/);
});
