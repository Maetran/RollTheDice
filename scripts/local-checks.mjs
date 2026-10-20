import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveBrowserShards } from './test-parallelism.mjs';

export const REQUIRED_CHECKS = ['quality', 'tools', 'backend', 'image-build', 'production-image', 'browser', 'diff'];
export const BROWSER_SUITES = ['main-1', 'main-2', 'main-3', 'main-4', 'username', 'passkeys', 'hausdepp-passkeys'];
export const RECEIPT_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function git(args, cwd = process.cwd()) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function pythonExecutable(cwd = process.cwd(), env = process.env) {
  if (env.PLAYWRIGHT_PYTHON) return env.PLAYWRIGHT_PYTHON;
  const local = join(cwd, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return existsSync(local) ? local : 'python3';
}

export function commandEnvironment(cwd = process.cwd(), env = process.env) {
  const python = pythonExecutable(cwd, env);
  return { ...env, PLAYWRIGHT_PYTHON: python,
    PATH: python.includes('/') || python.includes('\\') ? `${dirname(python)}${process.platform === 'win32' ? ';' : ':'}${env.PATH || ''}` : env.PATH };
}

export function gitContext(cwd = process.cwd()) {
  const root = git(['rev-parse', '--show-toplevel'], cwd);
  const common = resolve(root, git(['rev-parse', '--git-common-dir'], root));
  const head = git(['rev-parse', 'HEAD'], root);
  const tree = git(['rev-parse', 'HEAD^{tree}'], root);
  const base = git(['rev-parse', 'refs/remotes/origin/develop'], root);
  return { root, common, head, tree, base,
    dirty: Boolean(git(['status', '--porcelain=v1', '--untracked-files=all'], root)) };
}

export function environmentFingerprint(cwd = process.cwd(), env = commandEnvironment(cwd)) {
  const python = pythonExecutable(cwd, env);
  const version = execFileSync(python, ['-VV'], { cwd, env, encoding: 'utf8' }).trim();
  const packages = JSON.parse(execFileSync(python, ['-m', 'pip', 'list', '--format=json', '--disable-pip-version-check'],
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const nodeLock = join(cwd, 'node_modules/.package-lock.json');
  const overrides = Object.fromEntries(Object.entries(env).filter(([name]) =>
    /^(PLAYWRIGHT_|PYTEST_|ROLLTHEDICE_|NODE_OPTIONS$|CI$|DOCKER_|BUILDX_|BUILDKIT_)/.test(name)).sort());
  return createHash('sha256').update(JSON.stringify({ node: process.version, python: version, packages, overrides,
    browserShards: resolveBrowserShards({ root: cwd, environment: env }),
    nodeDependencies: existsSync(nodeLock) ? readFileSync(nodeLock, 'utf8') : null })).digest('hex');
}

export function assertFullBrowserResult(summary) {
  // Summaries written before configurable parallelism always used four shards.
  const mainShards = summary?.mainShards === undefined ? 4 : summary.mainShards;
  const supported = [4, 6, 8].includes(mainShards);
  const required = supported ? [...Array.from({ length: mainShards }, (_, index) => `main-${index + 1}`),
    'username', 'passkeys', 'hausdepp-passkeys'] : [];
  if (!supported || summary?.fullRun !== true || !Array.isArray(summary.results)
    || summary.results.length !== required.length
    || new Set(summary.results.map(item => item?.name)).size !== required.length
    || required.some(name => !summary.results.some(item => item?.name === name && item.exitCode === 0))) {
    throw new Error('Browser verification requires a supported main-shard count (4, 6 or 8), every main shard and all three account suites, unfiltered and successful.');
  }
}

export function receiptError(receipt, context, environment, now = Date.now()) {
  if (!receipt || receipt.schemaVersion !== 1) return 'No complete local verification receipt exists.';
  if (context.dirty) return 'The working tree has changed; commit the changes before verifying.';
  if (receipt.head !== context.head || receipt.tree !== context.tree) return 'This commit has not been verified locally.';
  if (receipt.base !== context.base) return 'origin/develop changed after verification; integrate it and verify again.';
  if (receipt.environment !== environment) return 'The Python or Node environment changed after verification.';
  const timestamp = Date.parse(receipt.finishedAt);
  if (!Number.isFinite(timestamp) || timestamp > now || now - timestamp > RECEIPT_LIFETIME_MS) return 'Local verification is older than 24 hours or has an invalid timestamp.';
  if (!Array.isArray(receipt.checks) || receipt.checks.length !== REQUIRED_CHECKS.length
    || REQUIRED_CHECKS.some(name => receipt.checks.filter(item => item.name === name).length !== 1
      || receipt.checks.find(item => item.name === name).exitCode !== 0)) {
    return 'A required local check is missing or failed.';
  }
  try { assertFullBrowserResult(receipt.browser); } catch (error) { return error.message; }
  return null;
}

export function receiptPath(context) {
  return join(context.common, 'local-checks', 'receipts', `${context.head}.json`);
}

export function readReceipt(context) {
  try { return JSON.parse(readFileSync(receiptPath(context), 'utf8')); } catch { return null; }
}

export function saveReceipt(context, receipt) {
  const path = receiptPath(context);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}

export function acquireVerificationLock(context) {
  const path = join(context.common, 'local-checks', 'running.json');
  mkdirSync(dirname(path), { recursive: true });
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, root: context.root, token }), { flag: 'wx', mode: 0o600 });
      return () => {
        try { if (JSON.parse(readFileSync(path, 'utf8')).token === token) unlinkSync(path); } catch { /* Already released. */ }
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner;
      try { owner = JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error(`Unreadable verification lock: ${path}`); }
      try { process.kill(owner.pid, 0); }
      catch (failure) {
        if (failure.code === 'ESRCH' && attempt === 0) { unlinkSync(path); continue; }
        throw new Error(`Cannot determine the owner of verification lock ${path}`);
      }
      throw new Error(`A full local verification is already running (PID ${owner.pid}, ${owner.root}).`);
    }
  }
  throw new Error('Could not acquire the local verification lock.');
}

export async function runCommand(command, args, { cwd = process.cwd(), env = process.env,
  logPath, input, signal, killTimeout = 5000 } = {}) {
  if (signal?.aborted) throw new Error('Local verification was interrupted.');
  const log = logPath ? createWriteStream(logPath, { flags: 'wx' }) : null;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32',
      stdio: [input ? 'pipe' : 'ignore', log ? 'pipe' : 'inherit', log ? 'pipe' : 'inherit'] });
    if (log) { child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false }); }
    let killTimer;
    const kill = signalName => {
      if (!child.pid) return;
      try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, signalName); } catch { /* Already exited. */ }
    };
    const stop = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), killTimeout);
      killTimer.unref();
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (input) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    child.on('error', error => { clearTimeout(killTimer); signal?.removeEventListener('abort', stop); log?.end(); reject(error); });
    child.on('close', (code, interrupted) => {
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', stop);
      const finish = () => resolvePromise({ exitCode: code ?? (interrupted ? 130 : 1) });
      if (log) log.end(finish); else finish();
    });
  });
}

export function pushedCommits(input, cwd = process.cwd()) {
  return [...new Set(input.trim().split('\n').filter(Boolean).flatMap(line => {
    const fields = line.trim().split(/\s+/);
    const [localRef, sha, remoteRef, remoteSha] = fields;
    if (fields.length !== 4 || !localRef || !remoteRef || !/^[0-9a-f]{40,64}$/.test(sha)
      || !/^[0-9a-f]{40,64}$/.test(remoteSha)) throw new Error('Malformed pre-push input.');
    if (/^0+$/.test(sha)) return [];
    return [git(['rev-parse', `${sha}^{commit}`], cwd)];
  }))];
}

export function assertLocalDockerEndpoint(endpoint) {
  if (!endpoint?.startsWith('unix://') && !endpoint?.startsWith('npipe://')) {
    throw new Error('Local verification requires a local Docker socket; remote Docker endpoints are refused.');
  }
}

export function assertUnfilteredEnvironment(env) {
  if (env.PYTEST_ADDOPTS?.trim()) {
    throw new Error('PYTEST_ADDOPTS must be unset for full local verification; focused runs cannot authorize a push.');
  }
}

export function localDockerEndpoint(cwd = process.cwd(), env = process.env) {
  const inspect = ['context', 'inspect', ...(env.DOCKER_CONTEXT ? [env.DOCKER_CONTEXT] : []), '--format', '{{.Endpoints.docker.Host}}'];
  const endpoint = (!env.DOCKER_CONTEXT && env.DOCKER_HOST) || execFileSync('docker', inspect,
    { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  assertLocalDockerEndpoint(endpoint);
  return endpoint;
}
