import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { REQUIRED_CHECKS, acquireVerificationLock, assertFullBrowserResult, assertUnfilteredEnvironment, commandEnvironment,
  environmentFingerprint, git, gitContext, localDockerEndpoint, pushedCommits, pythonExecutable, readReceipt,
  receiptError, receiptPath, runCommand, saveReceipt } from './local-checks.mjs';

export async function verifyLocal({ cwd = process.cwd() } = {}) {
  if (Number(process.versions.node.split('.')[0]) !== 22) {
    throw new Error('Full verification requires Node 22, matching the GitHub quality workflow.');
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
  let browser;
  let dockerUsed = false;
  let outputReady = false;
  let dockerEnv;
  const stage = async (name, command, args, options = {}) => {
    console.log(`[local] ${name} starts; log: ${join(output, `${name}.log`)}`);
    const startedAt = new Date().toISOString();
    const result = await runCommand(command, args, { cwd: initial.root, env,
      signal: controller.signal, logPath: join(output, `${name}.log`), ...options });
    checks.push({ name, startedAt, finishedAt: new Date().toISOString(), ...result });
    console.log(`[local] ${name}: ${result.exitCode === 0 ? 'PASS' : `FAIL (${result.exitCode})`}`);
    if (result.exitCode !== 0 || controller.signal.aborted) throw new Error(`${name} failed; see ${output}`);
  };
  try {
    mkdirSync(output, { recursive: true });
    outputReady = true;
    if (existsSync(receiptPath(initial))) unlinkSync(receiptPath(initial));
    const environment = environmentFingerprint(initial.root, env);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    await stage('quality', npm, ['run', 'check:quality']);
    const toolTests = readdirSync(join(initial.root, 'tests')).filter(name => name.endsWith('.test.mjs'))
      .sort().map(name => join('tests', name));
    if (!toolTests.length) throw new Error('No Node tooling/model tests were found.');
    await stage('tools', process.execPath, ['--test', ...toolTests]);
    await stage('backend', pythonExecutable(initial.root, env), ['-m', 'pytest', '--cov', '--cov-report=term-missing']);
    dockerEnv = { ...env, DOCKER_HOST: localDockerEndpoint(initial.root, env) };
    delete dockerEnv.DOCKER_CONTEXT;
    delete dockerEnv.BUILDX_BUILDER;
    delete dockerEnv.BUILDKIT_HOST;
    dockerUsed = true;
    await stage('image-build', 'docker', ['build', '--builder', 'default', '--platform', 'linux/amd64', '--tag', image, '.'], { env: dockerEnv });
    await stage('production-image', 'docker', ['run', '--platform', 'linux/amd64', '--rm', '--interactive', '--network', 'none',
      '--tmpfs', '/app/data', '--name', container, '--entrypoint', 'python', image, '-'],
    { input: readFileSync(join(initial.root, 'tests/container_smoke.py')), env: dockerEnv });
    const browserOutput = join(output, 'browser');
    await stage('browser', process.execPath, ['scripts/test-browser-local.mjs', '--output-dir', browserOutput], { killTimeout: 20000 });
    browser = JSON.parse(readFileSync(join(browserOutput, 'summary.json'), 'utf8'));
    assertFullBrowserResult(browser);
    await stage('diff', 'git', ['diff', '--check']);
    git(['fetch', 'origin'], initial.root);
    const current = gitContext(initial.root);
    const receipt = { schemaVersion: 1, head: initial.head, tree: initial.tree, base: initial.base,
      environment, finishedAt: new Date().toISOString(), checks, browser, output };
    const error = receiptError(receipt, current, environmentFingerprint(initial.root, env));
    if (error) throw new Error(error);
    saveReceipt(current, receipt);
    console.log(`[local] All ${REQUIRED_CHECKS.length} required groups passed for ${initial.head}.`);
    console.log(`[local] Results: ${output}`);
    return receipt;
  } finally {
    try {
      if (outputReady) writeFileSync(join(output, 'summary.json'), JSON.stringify({ head: initial.head, checks, browser,
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
  const receipt = readReceipt(context);
  const error = receiptError(receipt, context, environmentFingerprint(context.root));
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
  else if (!mode) await verifyLocal();
  else throw new Error('Usage: node scripts/verify-local.mjs [--check-receipt | --pre-push]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`[local] ${error.message}`); process.exitCode = 1; });
}
