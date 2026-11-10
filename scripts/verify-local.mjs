import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { adoptIntegrationReceipt } from './integration-receipt.mjs';
import { BROWSER_SUITES, RECEIPT_LIFETIME_MS, REQUIRED_CHECKS, acquireVerificationLock, assertFullBrowserResult, assertUnfilteredEnvironment, commandEnvironment,
  environmentFingerprint, git, gitContext, localDockerEndpoint, pushedCommits, pythonExecutable, readReceipt,
  receiptError, receiptPath, runCommand, saveReceipt } from './local-checks.mjs';

// Passed check groups and browser suites are remembered per Git tree. A later
// run on exactly the same tree and environment (within the receipt lifetime)
// repeats only what failed or never ran; any changed file means a new tree.
export function stageCachePath(context) {
  return join(context.common, 'local-checks', 'stages', `${context.tree}.json`);
}

export function readStageCache(context, environment, now = Date.now()) {
  let cache;
  try { cache = JSON.parse(readFileSync(stageCachePath(context), 'utf8')); } catch { return { checks: {}, browser: {} }; }
  if (cache?.schemaVersion !== 1 || cache.tree !== context.tree || cache.environment !== environment) return { checks: {}, browser: {} };
  const fresh = entry => {
    const time = Date.parse(entry?.finishedAt);
    return entry?.exitCode === 0 && Number.isFinite(time) && time <= now && now - time <= RECEIPT_LIFETIME_MS;
  };
  const keep = (entries, allowed) => Object.fromEntries(Object.entries(entries || {})
    .filter(([name, entry]) => allowed.includes(name) && entry?.name === name && fresh(entry)));
  return { checks: keep(cache.checks, REQUIRED_CHECKS.filter(name => !['browser', 'diff'].includes(name))),
    browser: keep(cache.browser, BROWSER_SUITES) };
}

export function saveStageCache(context, environment, checks, browserResults) {
  const path = stageCachePath(context);
  mkdirSync(dirname(path), { recursive: true });
  const passed = entries => Object.fromEntries(entries.filter(entry => entry.exitCode === 0)
    .map(({ reused, ...entry }) => [entry.name, entry]));
  const cache = { schemaVersion: 1, tree: context.tree, environment,
    checks: passed(checks.filter(entry => !['browser', 'diff'].includes(entry.name))),
    browser: passed(browserResults) };
  writeFileSync(`${path}.tmp`, `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
  // Older trees can never be reused after the receipt lifetime; keep the folder small.
  for (const name of readdirSync(dirname(path))) {
    const file = join(dirname(path), name);
    try { if (Date.now() - statSync(file).mtimeMs > 2 * RECEIPT_LIFETIME_MS) unlinkSync(file); } catch { /* Already gone. */ }
  }
}

// Combine a partial browser rerun with the suites that already passed on this tree.
export function mergeBrowserResults(run, earlier) {
  const reusedSuites = BROWSER_SUITES.filter(name => earlier[name] && !run?.results?.some(item => item.name === name));
  const results = BROWSER_SUITES.map(name => run?.results?.find(item => item.name === name)
    || (earlier[name] ? { ...earlier[name], reused: true } : { name, exitCode: 1, status: 'not-run' }));
  const completed = Boolean(run) && !run.error && !run.interruption && !(run.filters?.length)
    && run.results.every(item => ['passed', 'failed'].includes(item.status));
  const fullRun = run?.fullRun === true || (reusedSuites.length > 0 && completed
    && results.every(item => item.reused || ['passed', 'failed'].includes(item.status)));
  return { ...(run || {}), fullRun, results, reusedSuites };
}

export async function verifyLocal({ cwd = process.cwd(), fresh = false } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 22) {
    throw new Error('Full verification requires Node 22. See docs/LOCAL_CHECKS.md.');
  }
  assertUnfilteredEnvironment(process.env);
  git(['fetch', 'origin'], cwd);
  const initial = gitContext(cwd);
  if (initial.dirty) throw new Error('Commit all source changes before running npm run verify:local.');
  git(['merge-base', '--is-ancestor', initial.base, initial.head], initial.root);
  const release = acquireVerificationLock(initial);
  const env = commandEnvironment(initial.root);
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
  const id = `${initial.head.slice(0, 12)}-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const output = join(initial.root, 'test-results', 'local-checks', id);
  const container = `rollthedice-check-${id}`;
  const image = `rollthedice-local-check:${id}`;
  const checks = [];
  const failures = [];
  let browser;
  let environment;
  let dockerUsed = false;
  let outputReady = false;
  let dockerEnv;
  const startedRun = Date.now();
  const stage = async (name, command, args, options = {}) => {
    console.log(`[local] ${name} starts; log: ${join(output, `${name}.log`)}`);
    const startedAt = new Date().toISOString();
    const result = await runCommand(command, args, { cwd: initial.root, env,
      signal: controller.signal, logPath: join(output, `${name}.log`), ...options });
    const finishedAt = new Date().toISOString();
    checks.push({ name, startedAt, finishedAt, ...result });
    const seconds = Math.round((Date.parse(finishedAt) - Date.parse(startedAt)) / 1000);
    console.log(`[local] ${name}: ${result.exitCode === 0 ? 'PASS' : `FAIL (${result.exitCode})`} after ${seconds}s`);
    if (controller.signal.aborted) throw new Error('Local verification was interrupted.');
    if (result.exitCode !== 0) failures.push(name);
    return result.exitCode === 0;
  };
  const reuse = (entry) => {
    checks.push({ ...entry, reused: true });
    console.log(`[local] ${entry.name}: PASS (reused; passed on this exact tree at ${entry.finishedAt})`);
    return true;
  };
  try {
    mkdirSync(output, { recursive: true });
    outputReady = true;
    if (existsSync(receiptPath(initial))) unlinkSync(receiptPath(initial));
    environment = environmentFingerprint(initial.root, env);
    const earlier = fresh ? { checks: {}, browser: {} } : readStageCache(initial, environment);
    const reusable = Object.keys(earlier.checks).length + Object.keys(earlier.browser).length;
    if (reusable) console.log(`[local] Reusing ${reusable} groups/suites that already passed on tree ${initial.tree.slice(0, 12)}; use --fresh to repeat everything.`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const toolTests = readdirSync(join(initial.root, 'tests')).filter(name => name.endsWith('.test.mjs'))
      .sort().map(name => join('tests', name));
    if (!toolTests.length) throw new Error('No Node tooling/model tests were found.');
    const python = pythonExecutable(initial.root, env);
    const docker = !(earlier.checks['image-build'] && earlier.checks['production-image']);
    if (docker) {
      dockerEnv = { ...env, DOCKER_HOST: localDockerEndpoint(initial.root, env) };
      delete dockerEnv.DOCKER_CONTEXT;
      delete dockerEnv.BUILDX_BUILDER;
      delete dockerEnv.BUILDKIT_HOST;
    }
    const browserGroup = async () => {
      const pending = BROWSER_SUITES.filter(name => !earlier.browser[name]);
      const browserOutput = join(output, 'browser');
      let run = null;
      if (pending.length) {
        const args = ['scripts/test-browser-local.mjs', '--output-dir', browserOutput];
        if (pending.length < BROWSER_SUITES.length) for (const name of pending) args.push('--suite', name);
        await stage('browser', process.execPath, args, { killTimeout: 20000 });
        try { run = JSON.parse(readFileSync(join(browserOutput, 'summary.json'), 'utf8')); }
        catch { if (!failures.includes('browser')) failures.push('browser'); }
      }
      browser = mergeBrowserResults(run, earlier.browser);
      if (!pending.length) {
        const times = Object.values(earlier.browser);
        reuse({ name: 'browser', exitCode: 0, startedAt: times.map(item => item.startedAt).sort()[0],
          finishedAt: times.map(item => item.finishedAt).sort()[0] });
      } else if (browser.reusedSuites.length) {
        console.log(`[local] browser: reused ${browser.reusedSuites.length} passed suites, ran ${pending.length}.`);
      }
    };
    const dockerGroup = async () => {
      if (!docker) { reuse(earlier.checks['image-build']); reuse(earlier.checks['production-image']); return; }
      dockerUsed = true;
      if (await stage('image-build', 'docker', ['build', '--builder', 'default', '--platform', 'linux/amd64', '--tag', image, '.'], { env: dockerEnv })) {
        await stage('production-image', 'docker', ['run', '--platform', 'linux/amd64', '--rm', '--interactive', '--network', 'none',
          '--tmpfs', '/app/data', '--name', container, '--entrypoint', 'python', image, '-'],
        { input: readFileSync(join(initial.root, 'tests/container_smoke.py')), env: dockerEnv });
      } else failures.push('production-image (not started: image-build failed)');
    };
    const group = (name, run) => () => (earlier.checks[name] ? reuse(earlier.checks[name]) : run());
    // Independent groups start together and all finish, so one run shows every failure.
    const settled = await Promise.allSettled([
      group('quality', () => stage('quality', npm, ['run', 'check:quality']))(),
      group('tools', () => stage('tools', process.execPath, ['--test', ...toolTests]))(),
      group('backend', () => stage('backend', python, ['-m', 'pytest', '--cov', '--cov-report=term-missing']))(),
      dockerGroup(),
      browserGroup(),
    ]);
    const crashed = settled.find(result => result.status === 'rejected');
    if (crashed) throw crashed.reason;
    await stage('diff', 'git', ['diff', '--check']);
    saveStageCache(initial, environment, checks, browser?.results || []);
    if (failures.length) {
      throw new Error(`${failures.length} check group(s) failed: ${failures.join(', ')}. Logs: ${output}\n`
        + '[local] Passed groups and browser suites are kept for this exact commit; the next run repeats only the failed ones.');
    }
    assertFullBrowserResult(browser);
    git(['fetch', 'origin'], initial.root);
    const current = gitContext(initial.root);
    // A receipt is never older than its oldest reused result.
    const finishedAt = new Date(Math.min(Date.now(), ...checks.filter(item => item.reused).map(item => Date.parse(item.finishedAt)),
      ...browser.results.filter(item => item.reused && item.finishedAt).map(item => Date.parse(item.finishedAt)))).toISOString();
    const receipt = { schemaVersion: 1, head: initial.head, tree: initial.tree, base: initial.base,
      environment, finishedAt, checks, browser, output };
    const error = receiptError(receipt, current, environmentFingerprint(initial.root, env));
    if (error) throw new Error(error);
    saveReceipt(current, receipt);
    console.log(`[local] All ${REQUIRED_CHECKS.length} required groups passed for ${initial.head} in ${Math.round((Date.now() - startedRun) / 1000)}s.`);
    console.log(`[local] Results: ${output}`);
    return receipt;
  } finally {
    try {
      if (outputReady) writeFileSync(join(output, 'summary.json'), JSON.stringify({ head: initial.head, checks, browser, failures,
        interrupted: controller.signal.aborted, finishedAt: new Date().toISOString() }, null, 2));
      if (dockerUsed) {
        // These names belong to this invocation only; no shared image/container is removed.
        for (const [name, args] of [['container', ['rm', '--force', container]], ['image', ['image', 'rm', image]]]) {
          try {
            const result = await runCommand('docker', args, { cwd: initial.root, env: dockerEnv,
              signal: AbortSignal.timeout(15000), killTimeout: 1000, logPath: join(output, `${name}-cleanup.log`) });
            if (result.exitCode !== 0) console.warn(`[local] ${name} cleanup returned ${result.exitCode}; see its cleanup log.`);
          } catch (error) { console.warn(`[local] ${name} cleanup: ${error.message}`); }
        }
      }
    } finally {
      process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
      release();
    }
  }
}

export function checkReceipt(cwd = process.cwd()) {
  const context = gitContext(cwd);
  const environment = environmentFingerprint(context.root);
  let receipt = readReceipt(context);
  if (!receipt) {
    receipt = adoptIntegrationReceipt(context, environment);
    if (receipt) saveReceipt(context, receipt);
  }
  const error = receiptError(receipt, context, environment);
  if (error) throw new Error(`${error}\nRun npm run verify:local or npm run push:checked before pushing.`);
  return receipt;
}

export async function prePush(cwd = process.cwd(), input) {
  const commits = pushedCommits(input, cwd);
  if (!commits.length) return;
  git(['fetch', 'origin'], cwd);
  const context = gitContext(cwd);
  if (commits.some(commit => commit !== context.head)) {
    throw new Error('Push one verified checkout at a time; one of the outgoing commits differs from HEAD.');
  }
  checkReceipt(cwd);
  console.log(`[local] Push permitted: complete local verification for ${context.head}.`);
}

async function main() {
  const [mode] = process.argv.slice(2);
  if (mode === '--pre-push') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    await prePush(process.cwd(), Buffer.concat(chunks).toString('utf8'));
  } else if (mode === '--check-receipt') checkReceipt();
  else if (!mode || mode === '--fresh') await verifyLocal({ fresh: mode === '--fresh' });
  else throw new Error('Usage: node scripts/verify-local.mjs [--fresh | --check-receipt | --pre-push]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[local] ${error.message}`); process.exitCode = 1; });
}
