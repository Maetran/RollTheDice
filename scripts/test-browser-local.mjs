#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const CONFIGS = Object.freeze({
  main: 'playwright.config.js',
  username: 'playwright.username.config.js',
  passkeys: 'playwright.passkeys.config.js',
  'hausdepp-passkeys': 'playwright.hausdepp-passkeys.config.js',
});

export function parseArguments(argv) {
  const options = { suites: [], filters: [], outputDirectory: undefined, portBase: undefined };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--') { options.filters = argv.slice(index + 1); break; }
    if (argument === '--help' || argument === '-h') { options.help = true; continue; }
    if (!['--suite', '--config', '--output-dir', '--port-base'].includes(argument)) {
      throw new Error(`Unknown runner option ${argument}; put Playwright filters after --`);
    }
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${argument} requires a value`);
    if (argument === '--output-dir') options.outputDirectory = value;
    else if (argument === '--port-base') {
      options.portBase = Number(value);
      if (!Number.isInteger(options.portBase) || options.portBase < 1024 || options.portBase > 65529) {
        throw new Error('--port-base must be an integer from 1024 to 65529');
      }
    } else {
      const suite = argument === '--suite' ? value : Object.keys(CONFIGS).find(name => CONFIGS[name] === path.basename(value));
      if (!Object.hasOwn(CONFIGS, suite)) throw new Error(`Unknown browser suite/config: ${value}`);
      if (options.suites.includes(suite)) throw new Error(`Duplicate browser suite: ${suite}`);
      options.suites.push(suite);
    }
  }
  // These switches could silently bypass isolation, change the four shards or
  // replace the durable report. Filters such as files, --grep and --project work.
  for (const argument of options.filters) {
    if (/^(--(?:config|shard|workers|output|reporter|ui|ui-host|ui-port)(?:=|$)|-c|-j)/.test(argument)) {
      throw new Error(`The local runner owns isolation option ${argument}`);
    }
  }
  return options;
}

function suiteDefinitions(suites = []) {
  const chosen = suites.length ? suites : Object.keys(CONFIGS);
  if (new Set(chosen).size !== chosen.length || chosen.some(name => !Object.hasOwn(CONFIGS, name))) {
    throw new Error('Select each known browser suite at most once');
  }
  const definitions = [];
  for (const suite of Object.keys(CONFIGS)) {
    if (!chosen.includes(suite)) continue;
    if (suite === 'main') for (let shard = 1; shard <= 4; shard++) definitions.push({ name: `main-${shard}`, suite, shard });
    else definitions.push({ name: suite, suite });
  }
  return definitions;
}

export function createSuitePlan({ root = repositoryRoot, temporaryDirectory, outputDirectory, htmlDirectory, ports,
  suites = [], filters = [], environment = process.env }) {
  const definitions = suiteDefinitions(suites);
  if (ports.length !== definitions.length || new Set(ports).size !== ports.length
      || ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535)) throw new Error('Each suite needs a distinct valid port');
  return definitions.map((definition, index) => {
    const directory = path.join(outputDirectory, definition.name);
    const outputDir = path.join(directory, 'artifacts');
    const htmlDir = htmlDirectory ? path.join(htmlDirectory, path.basename(outputDirectory), definition.name) : path.join(directory, 'html');
    const testDirectory = path.join(temporaryDirectory, definition.name);
    const port = ports[index];
    const env = { ...environment, ROLLTHEDICE_TEST_PORT: String(port), ROLLTHEDICE_PASSKEY_TEST_PORT: String(port),
      ROLLTHEDICE_HAUSDEPP_PASSKEY_TEST_PORT: String(port), PLAYWRIGHT_TEST_DIR: testDirectory,
      PLAYWRIGHT_OUTPUT_DIR: outputDir, PLAYWRIGHT_HTML_OUTPUT_DIR: htmlDir, TMPDIR: testDirectory };
    delete env.PLAYWRIGHT_BASE_URL;
    const args = ['test', `--config=${path.join(root, CONFIGS[definition.suite])}`, '--workers=1'];
    if (definition.shard) args.push(`--shard=${definition.shard}/4`);
    // A targeted file may belong to just one shard. A full run must never hide
    // an accidentally empty configuration with this option.
    if (filters.length) args.push('--pass-with-no-tests');
    args.push(...filters);
    return { ...definition, port, args, env, testDirectory, outputDir, htmlDir, logPath: path.join(directory, 'runner.log') };
  });
}

export async function reservePort(preferredPort = 0) {
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: preferredPort, exclusive: true }, resolve);
  });
  const port = server.address().port;
  return { port, release: () => new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close(error => error ? reject(error) : resolve());
  }) };
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function processTable() {
  if (process.platform === 'win32') return new Map();
  const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pgid=,lstart=']);
  const records = new Map();
  for (const line of stdout.split('\n')) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (match) records.set(Number(match[1]), { pid: Number(match[1]), parent: Number(match[2]), group: Number(match[3]), birth: match[4] });
  }
  return records;
}

async function rememberChildren(record) {
  const table = await processTable();
  const owned = new Set([record.child.pid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table.values()) if (owned.has(entry.parent) && !owned.has(entry.pid)) {
      owned.add(entry.pid); changed = true;
    }
  }
  for (const pid of owned) if (table.has(pid)) record.owned.set(pid, table.get(pid));
}

async function signalRemembered(record, signal, { descendantsOnly = false } = {}) {
  const current = await processTable();
  for (const entry of record.owned.values()) {
    if (descendantsOnly && entry.pid === record.child.pid) continue;
    const actual = current.get(entry.pid);
    // Recheck process identity; never signal an unrelated process after PID reuse.
    if (!actual || actual.birth !== entry.birth || actual.group !== entry.group) continue;
    try { process.kill(entry.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

async function stopProcess(record) {
  if (record.stopping) return record.stopping;
  record.stopping = (async () => {
    await rememberChildren(record);
    if (record.child.pid) {
      // Give Playwright the first chance to flush traces and gracefully stop
      // its own webServer before reaping any surviving detached descendants.
      try { record.child.kill('SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    let timeout;
    try { await Promise.race([record.closed, new Promise(resolve => { timeout = setTimeout(resolve, 7000); })]); }
    finally { clearTimeout(timeout); }
    await signalRemembered(record, 'SIGTERM');
    await delay(250);
    await signalRemembered(record, 'SIGKILL');
  })();
  return record.stopping;
}

async function makeOutputDirectory(root, requested) {
  if (!requested) {
    const parent = path.join(root, 'test-results', 'local');
    await mkdir(parent, { recursive: true });
    return mkdtemp(path.join(parent, 'run-'));
  }
  const directory = path.resolve(root, requested);
  await mkdir(directory, { recursive: true });
  if ((await readdir(directory)).length) throw new Error(`Refusing to overwrite non-empty browser output directory: ${directory}`);
  return directory;
}

export async function runLocalBrowserTests(options = {}, dependencies = {}) {
  const root = dependencies.root || repositoryRoot;
  const environment = dependencies.environment || process.env;
  if (environment.PLAYWRIGHT_BASE_URL) throw new Error('PLAYWRIGHT_BASE_URL cannot be used by the isolated local runner');
  const definitions = suiteDefinitions(options.suites);
  const outputDirectory = await makeOutputDirectory(root, options.outputDirectory || environment.PLAYWRIGHT_LOCAL_OUTPUT_DIR);
  const lock = await open(path.join(outputDirectory, '.runner.lock'), 'wx');
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'rollthedice-local-browser-'));
  const reservations = [];
  const active = new Set();
  const summary = { fullRun: false, startedAt: new Date().toISOString(), outputDirectory, filters: options.filters || [],
    results: definitions.map((suite, index) => ({ name: suite.name, exitCode: 1, port: options.portBase ? options.portBase + index : 0,
      outputDir: path.join(outputDirectory, suite.name, 'artifacts'), logPath: path.join(outputDirectory, suite.name, 'runner.log'),
      status: 'not-started' })) };
  let interruption;
  let persist = Promise.resolve();
  const save = () => {
    const serialized = JSON.stringify(summary, null, 2) + '\n';
    persist = persist.then(async () => {
      await writeFile(path.join(outputDirectory, 'summary.json.tmp'), serialized);
      await rename(path.join(outputDirectory, 'summary.json.tmp'), path.join(outputDirectory, 'summary.json'));
    });
    return persist;
  };
  const onSignal = signal => {
    interruption ||= signal;
    for (const record of active) void stopProcess(record).catch(error => { summary.cleanupError = error.message; });
  };
  const onInterrupt = () => onSignal('SIGINT');
  const onTerminate = () => onSignal('SIGTERM');
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);
  try {
    const count = definitions.length;
    for (let index = 0; index < count; index++) reservations.push(await reservePort(options.portBase ? options.portBase + index : 0));
    const plan = createSuitePlan({ root, temporaryDirectory, outputDirectory,
      htmlDirectory: environment.PLAYWRIGHT_HTML_OUTPUT_DIR ? path.resolve(root, environment.PLAYWRIGHT_HTML_OUTPUT_DIR) : undefined,
      ports: reservations.map(item => item.port), suites: options.suites, filters: options.filters, environment });
    summary.results = plan.map(suite => ({ name: suite.name, exitCode: 1, port: suite.port, outputDir: suite.outputDir,
      htmlDir: suite.htmlDir, logPath: suite.logPath, status: 'not-started' }));
    for (const suite of plan) {
      await mkdir(suite.testDirectory, { recursive: true });
      await mkdir(path.dirname(suite.logPath), { recursive: true });
      await writeFile(suite.logPath, '');
    }
    await save();
    const cli = dependencies.cliPath || require.resolve('@playwright/test/cli');
    const runSuite = async suite => {
      const result = summary.results.find(item => item.name === suite.name);
      if (interruption) { result.status = 'interrupted'; result.exitCode = interruption === 'SIGINT' ? 130 : 143; return; }
      await reservations[plan.indexOf(suite)].release();
      result.status = 'running'; result.startedAt = new Date().toISOString();
      const log = createWriteStream(suite.logPath, { flags: 'a' });
      log.write(`Suite ${suite.name}; port ${suite.port}; output ${suite.outputDir}\n`);
      const child = spawn(process.execPath, [cli, ...suite.args], { cwd: root, env: suite.env,
        detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
      let finish;
      const record = { child, owned: new Map(), closed: new Promise(resolve => { finish = resolve; }) };
      active.add(record);
      child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
      const interval = setInterval(() => { void rememberChildren(record).catch(() => {}); }, 500);
      interval.unref();
      child.once('error', error => { result.error = error.message; });
      child.once('close', (code, signal) => { finish({ code, signal }); });
      if (interruption) void stopProcess(record).catch(error => { summary.cleanupError = error.message; });
      const outcome = await record.closed;
      clearInterval(interval);
      if (record.stopping) await record.stopping;
      // Playwright normally reaps its server. Reap any recorded descendant
      // left by a crashed CLI too, without touching other worktrees' processes.
      await signalRemembered(record, 'SIGTERM', { descendantsOnly: true });
      await delay(50);
      await signalRemembered(record, 'SIGKILL', { descendantsOnly: true });
      active.delete(record);
      result.exitCode = interruption ? interruption === 'SIGINT' ? 130 : 143 : outcome.code ?? 1;
      result.signal = outcome.signal; result.status = result.exitCode === 0 ? 'passed' : interruption ? 'interrupted' : 'failed';
      result.finishedAt = new Date().toISOString();
      await new Promise(resolve => log.end(resolve));
      if (!dependencies.quiet) console.log(`${suite.name}: ${result.status} (exit ${result.exitCode}); ${suite.logPath}`);
      await save();
    };
    const mainResults = await Promise.allSettled(plan.filter(suite => suite.suite === 'main').map(runSuite));
    const failedRunner = mainResults.find(result => result.status === 'rejected');
    if (failedRunner) throw failedRunner.reason;
    for (const suite of plan.filter(suite => suite.suite !== 'main')) await runSuite(suite);
    summary.fullRun = !interruption && !(options.suites?.length) && !summary.filters.length
      && summary.results.length === 7 && summary.results.every(result => ['passed', 'failed'].includes(result.status));
  } catch (error) {
    summary.error = error.message;
    await Promise.all([...active].map(stopProcess));
  } finally {
    process.off('SIGINT', onInterrupt); process.off('SIGTERM', onTerminate);
    await Promise.all(reservations.map(item => item.release()));
    await rm(temporaryDirectory, { recursive: true, force: true });
    await lock.close();
    await rm(path.join(outputDirectory, '.runner.lock'), { force: true });
    summary.finishedAt = new Date().toISOString();
    summary.interruption = interruption || null;
    summary.exitCode = interruption ? interruption === 'SIGINT' ? 130 : 143
      : summary.error || summary.cleanupError || summary.results.some(result => result.exitCode !== 0) ? 1 : 0;
    await save();
  }
  return summary;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/test-browser-local.mjs [--output-dir NEW_DIR] [--port-base PORT] [--suite NAME | --config FILE] [-- PLAYWRIGHT_FILTERS]\n'
      + 'Default: four isolated main shards (one worker each), then username, passkeys and hausdepp-passkeys serially.\n'
      + 'PLAYWRIGHT_PYTHON is preserved. PLAYWRIGHT_LOCAL_OUTPUT_DIR selects the run output; logs, HTML and traces are retained.');
    return;
  }
  const summary = await runLocalBrowserTests(options);
  console.log(`Browser result: ${summary.exitCode === 0 ? 'passed' : 'failed'}; fullRun=${summary.fullRun}; ${path.join(summary.outputDirectory, 'summary.json')}`);
  if (summary.error) console.error(summary.error);
  process.exitCode = summary.exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
