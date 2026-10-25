import assert from 'node:assert/strict';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CONFIGS, collectFilteredTests, createSuitePlan, parseArguments, reservePort, runLocalBrowserTests } from '../scripts/test-browser-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const names = ['main-1', 'main-2', 'main-3', 'main-4', 'watten-public', 'username', 'passkeys', 'hausdepp-passkeys'];

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
if (process.argv.includes('--list')) {
  record('list');
  const count = env.FAKE_SELECTION ? (JSON.parse(env.FAKE_SELECTION)[name] || 0) : 1;
  const report = { config: {}, errors: [], suites: count ? [{ specs: [{ title: 'selected case',
    tests: Array.from({ length: count }, () => ({ projectId: '', results: [] })) }] }] : [] };
  writeFileSync(env.PLAYWRIGHT_JSON_OUTPUT_FILE, env.FAKE_LIST_DATA || JSON.stringify(report));
  process.exit(0);
}
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

test('the default plan covers four one-worker shards, public Watten and every isolated account suite exactly once', () => {
  const plan = createSuitePlan({ root: '/repo', temporaryDirectory: '/tmp/owned', outputDirectory: '/reports/run',
    ports: [18100, 18101, 18102, 18103, 18104, 18105, 18106, 18107],
    environment: { PLAYWRIGHT_PYTHON: '/python with spaces/bin/python', PLAYWRIGHT_OUTPUT_DIR: '/inherited' } });
  assert.deepEqual(plan.map(item => item.name), names);
  for (const [index, suite] of plan.entries()) {
    assert.equal(suite.args.filter(arg => arg === '--workers=1').length, 1);
    assert.equal(suite.args.filter(arg => arg === '--forbid-only').length, 1);
    assert.equal(suite.args.filter(arg => arg === '--retries=0').length, 1);
    assert.equal(suite.env.PLAYWRIGHT_PYTHON, '/python with spaces/bin/python');
    assert.equal(suite.env.ROLLTHEDICE_TEST_PORT, String(18100 + index));
    assert.equal(suite.env.ROLLTHEDICE_WATTEN_PUBLIC_TEST_PORT, String(18100 + index));
    assert.equal(suite.env.PLAYWRIGHT_OUTPUT_DIR, suite.outputDir);
    assert.equal(suite.env.PLAYWRIGHT_BASE_URL, undefined);
    if (index < 4) assert.ok(suite.args.includes('--shard=' + (index + 1) + '/4'));
    else assert.ok(!suite.args.some(arg => arg.startsWith('--shard=')));
  }
  for (const field of ['testDirectory', 'outputDir', 'htmlDir', 'logPath']) assert.equal(new Set(plan.map(item => item[field])).size, 8);
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
  assert.equal(parseArguments(['--port-base', '65528']).portBase, 65528);
  assert.throws(() => parseArguments(['--port-base', '65529']), /port-base/);
  const plan = createSuitePlan({ root: '/repo', temporaryDirectory: '/tmp/owned', outputDirectory: '/reports/run',
    ports: Array.from({ length: 8 }, (_, index) => 65528 + index), environment: {} });
  assert.equal(plan.at(-1).port, 65535);
});

test('full orchestration retains failures and reports while extras run only after all four shards', async t => {
  const f = await fixture(t);
  const output = path.join(f.directory, 'output');
  const summary = await runLocalBrowserTests({ outputDirectory: output }, { root, cliPath: f.cli, quiet: true,
    environment: cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_FAIL: 'main-2', PLAYWRIGHT_PYTHON: '/chosen/python' }) });
  assert.equal(summary.fullRun, true);
  assert.equal(summary.exitCode, 1);
  assert.deepEqual(summary.results.map(item => item.name), names);
  assert.deepEqual(summary.results.map(item => item.exitCode), [0, 7, 0, 0, 0, 0, 0, 0]);
  const events = (await readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const starts = events.filter(event => event.type === 'start');
  assert.equal(starts.length, 8);
  assert.equal(new Set(starts.map(item => item.port)).size, 8);
  assert.equal(new Set(starts.map(item => item.directory)).size, 8);
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

test('a filtered total of zero is refused before running any otherwise successful empty shard', async t => {
  const f = await fixture(t);
  const summary = await runLocalBrowserTests({ outputDirectory: path.join(f.directory, 'zero'),
    suites: ['main'], filters: ['--grep', 'mistyped title'] }, { root, cliPath: f.cli, quiet: true,
    environment: cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_SELECTION: '{}' }) });
  assert.equal(summary.exitCode, 1);
  assert.equal(summary.selectedTests, 0);
  assert.equal(summary.fullRun, false);
  assert.match(summary.error, /selected no tests/);
  assert.ok(summary.results.every(item => item.status === 'not-started'));
  const events = (await readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(events.length, 4);
  assert.ok(events.every(event => event.type === 'list'));
});

for (const selected of [1, 3]) test(`filtered ${selected}-test selection on one shard permits the three empty shards`, async t => {
  const f = await fixture(t);
  const summary = await runLocalBrowserTests({ outputDirectory: path.join(f.directory, 'selected'),
    suites: ['main'], filters: ['one.spec.js', '--grep', 'one case'] }, { root, cliPath: f.cli, quiet: true,
    environment: cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_SELECTION: JSON.stringify({ 'main-2': selected }) }) });
  assert.equal(summary.exitCode, 0);
  assert.equal(summary.selectedTests, selected);
  assert.equal(summary.fullRun, false);
  assert.deepEqual(summary.results.map(item => item.selectedTests), [0, selected, 0, 0]);
  const events = (await readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const listed = events.filter(event => event.type === 'list'), started = events.filter(event => event.type === 'start');
  assert.equal(listed.length, 4); assert.equal(started.length, 4);
  for (const listing of listed) {
    const execution = started.find(item => item.name === listing.name);
    assert.deepEqual(listing.args, [...execution.args, '--list', '--reporter=json']);
    assert.equal(listing.directory, execution.directory);
    assert.equal(listing.port, execution.port);
    assert.ok(execution.args.includes('--pass-with-no-tests'));
  }
});

test('a malformed or structurally invalid selection report fails closed', async t => {
  const f = await fixture(t);
  const invalid = ['not JSON', '{}', JSON.stringify({ config: {}, errors: ['collection failed'], suites: [] }),
    JSON.stringify({ config: {}, errors: [], suites: [{ specs: [{ title: 'case', tests: [{}] }] }] })];
  for (const [index, report] of invalid.entries()) {
    const summary = await runLocalBrowserTests({ outputDirectory: path.join(f.directory, `invalid-${index}`),
      suites: ['username'], filters: ['--grep', 'case'] }, { root, cliPath: f.cli, quiet: true,
      environment: cleanEnvironment({ FAKE_EVENTS: f.events, FAKE_LIST_DATA: report }) });
    assert.equal(summary.exitCode, 1);
    assert.ok(summary.error);
    assert.ok(summary.results.every(item => item.status === 'not-started'));
  }
  const events = (await readFile(f.events, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.ok(events.every(event => event.type === 'list'));
});

test('real Playwright JSON collection selects zero, one or multiple tests without executing bodies', async t => {
  const f = await fixture(t);
  const marker = path.join(f.directory, 'body-ran');
  await writeFile(path.join(f.directory, CONFIGS.main), "module.exports = { testDir: __dirname, fullyParallel: false };\n");
  await writeFile(path.join(f.directory, 'selection.spec.js'), `
const { test } = require(${JSON.stringify(require.resolve('@playwright/test'))});
for (const title of ['chosen one', 'chosen two']) test(title, () => require('node:fs').writeFileSync(${JSON.stringify(marker)}, title));
`);
  for (const [index, [filter, expected]] of [['mistyped', 0], ['chosen one', 1], ['chosen', 2]].entries()) {
    const directory = path.join(f.directory, `real-${index}`);
    const plan = createSuitePlan({ root: f.directory, temporaryDirectory: directory, outputDirectory: directory,
      ports: [18200, 18201, 18202, 18203], suites: ['main'], filters: ['selection.spec.js', '--grep', filter],
      environment: cleanEnvironment({ PLAYWRIGHT_JSON_OUTPUT_NAME: 'inherited-report.json' }) });
    for (const suite of plan) {
      await mkdir(suite.testDirectory, { recursive: true });
      await mkdir(path.dirname(suite.logPath), { recursive: true });
    }
    const counts = await collectFilteredTests(plan, require.resolve('@playwright/test/cli'), f.directory);
    assert.equal(counts.reduce((sum, count) => sum + count, 0), expected);
    assert.equal(counts.filter(count => count > 0).length, expected ? 1 : 0);
    await assert.rejects(readFile(marker), { code: 'ENOENT' });
  }
});

test('all five configs preserve Python/output overrides and use distinct test databases without server reuse', async t => {
  const f = await fixture(t);
  for (const [index, config] of Object.values(CONFIGS).entries()) {
    const directory = path.join(f.directory, `config-${index}`);
    const environment = cleanEnvironment({ PLAYWRIGHT_TEST_DIR: directory, PLAYWRIGHT_PYTHON: "/chosen python's/bin/python",
      PLAYWRIGHT_OUTPUT_DIR: path.join(directory, 'artifacts'), PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(directory, 'html'),
      ROLLTHEDICE_TEST_PORT: '18200', ROLLTHEDICE_PASSKEY_TEST_PORT: '18201', ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT: '18202',
      ROLLTHEDICE_WATTEN_PUBLIC_TEST_PORT: '18203' });
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
    if (config === CONFIGS['watten-public']) {
      assert.equal(loaded.testMatch, '**/watten-public-language.spec.js');
      assert.equal(loaded.use.baseURL, 'http://127.0.0.1:18203');
      assert.equal(loaded.webServer.env.ROLLTHEDICE_SITE_ORIGIN, loaded.use.baseURL);
      assert.equal(loaded.webServer.env.ROLLTHEDICE_WATTEN_PUBLIC_BETA, '1');
      for (const flag of ['ACCOUNT', 'GAME', 'FOUNDER']) {
        assert.equal(loaded.webServer.env[`ROLLTHEDICE_WATTEN_${flag}_PREVIEW`], '0');
      }
      assert.equal(loaded.use.serviceWorkers, 'block');
      assert.equal(loaded.retries, 0);
    }
  }
});

test('direct Playwright defaults clean only their own pool and preserve sibling verification evidence', async t => {
  const f = await fixture(t);
  const evidence = path.join(f.directory, 'test-results', 'local-checks', 'proof.json');
  const peer = path.join(f.directory, 'test-results', 'direct', 'foreign', 'trace.zip');
  for (const file of [evidence, peer]) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'preserved evidence');
  }
  const spec = path.join(f.directory, 'minimal.spec.cjs');
  await writeFile(spec, `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
test('browser-free evidence check', () => expect(1).toBe(1));`);
  for (const name of ['main', 'hausdepp-passkeys']) {
    const stale = path.join(f.directory, 'test-results', 'direct', name, 'stale.txt');
    await mkdir(path.dirname(stale), { recursive: true });
    await writeFile(stale, 'old output from this pool');
    const config = path.join(f.directory, `playwright-${name}.config.cjs`);
    await writeFile(config, `const { browserTestEnvironment } = require(${JSON.stringify(path.join(root, 'scripts/playwright-test-environment.cjs'))});
const isolated = browserTestEnvironment({ name: ${JSON.stringify(name)}, portVariable: 'TEST_EVIDENCE_PORT', defaultPort: 18210 });
module.exports = { testDir: __dirname, testMatch: 'minimal.spec.cjs', workers: 1, retries: 0, reporter: 'line', outputDir: isolated.outputDir };`);
    const environment = cleanEnvironment({ PLAYWRIGHT_TEST_DIR: path.join(f.directory, `data-${name}`) });
    delete environment.PLAYWRIGHT_OUTPUT_DIR;
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test', `--config=${config}`], {
      cwd: f.directory, env: environment, encoding: 'utf8', timeout: 15000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(await readFile(evidence, 'utf8'), 'preserved evidence');
    assert.equal(await readFile(peer, 'utf8'), 'preserved evidence');
    await assert.rejects(readFile(stale), { code: 'ENOENT' });
  }
});

test('public language cases collect only in the public config and never in either preview config', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'browser-public-collection-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const config of [CONFIGS.main, CONFIGS['watten-public'], 'playwright.watten.config.js']) {
    const environment = cleanEnvironment({ PLAYWRIGHT_TEST_DIR: path.join(directory, config),
      PLAYWRIGHT_OUTPUT_DIR: path.join(directory, config, 'artifacts'), ROLLTHEDICE_WATTEN_PUBLIC_TEST_PORT: '18203' });
    environment.PLAYWRIGHT_HTML_OUTPUT_DIR = path.join(directory, config, 'html');
    const result = spawnSync(process.execPath, [require.resolve('@playwright/test/cli'), 'test',
      `--config=${path.join(root, config)}`, '--list', 'watten-public-language.spec.js'], {
      cwd: root, env: environment, encoding: 'utf8', timeout: 15000,
    });
    const output = result.stdout + result.stderr;
    const publicPool = config === CONFIGS['watten-public'];
    assert.equal(result.status, publicPool ? 0 : 1, output);
    assert.match(output, publicPool ? /Total: 2 tests in 1 file/ : /No tests found/);
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
