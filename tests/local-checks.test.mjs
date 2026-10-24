import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { REQUIRED_CHECKS, BROWSER_SUITES, RECEIPT_LIFETIME_MS, acquireVerificationLock,
  assertLocalDockerEndpoint, assertUnfilteredEnvironment, git, gitContext, pushedCommits, receiptError,
  readReceipt, runCommand, saveReceipt } from '../scripts/local-checks.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.now();
const context = { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40), dirty: false };
const receipt = () => ({ schemaVersion: 1, ...context, environment: 'installed-dependencies',
  finishedAt: new Date(now).toISOString(), checks: REQUIRED_CHECKS.map(name => ({ name, exitCode: 0 })),
  browser: { fullRun: true, results: BROWSER_SUITES.map(name => ({ name, exitCode: 0 })) } });

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'rollthedice-push-gate-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function repository(t) {
  const directory = temporary(t);
  git(['init', '-q', '--initial-branch=codex/gate-test'], directory);
  git(['config', 'user.name', 'Gate test'], directory);
  git(['config', 'user.email', 'gate@example.invalid'], directory);
  git(['commit', '-qm', 'Initial fixture', '--allow-empty'], directory);
  git(['update-ref', 'refs/remotes/origin/develop', 'HEAD'], directory);
  return directory;
}

test('the push receipt binds every completed group, exact commit, base and environment', async t => {
  assert.equal(REQUIRED_CHECKS.length, 7, 'Full check groups stay unchanged when adding a browser pool');
  assert.equal(BROWSER_SUITES.length, 8);
  assert.equal(receiptError(receipt(), context, 'installed-dependencies', now), null);
  const cases = [
    ['no receipt', null],
    ['unsupported format', { ...receipt(), schemaVersion: 0 }],
    ['different commit', { ...receipt(), head: 'd'.repeat(40) }],
    ['different tree', { ...receipt(), tree: 'd'.repeat(40) }],
    ['new develop base', { ...receipt(), base: 'd'.repeat(40) }],
    ['changed dependencies', { ...receipt(), environment: 'other' }],
    ['expired', { ...receipt(), finishedAt: new Date(now - RECEIPT_LIFETIME_MS - 1).toISOString() }],
    ['future timestamp', { ...receipt(), finishedAt: new Date(now + 1).toISOString() }],
    ['invalid timestamp', { ...receipt(), finishedAt: 'tomorrow' }],
    ['missing image build', { ...receipt(), checks: receipt().checks.filter(check => check.name !== 'image-build') }],
    ['one failed stage', { ...receipt(), checks: receipt().checks.map((check, i) => ({ ...check, exitCode: i ? 0 : 1 })) }],
    ['duplicate success hiding failure', { ...receipt(), checks: [...receipt().checks, { name: 'backend', exitCode: 1 }] }],
    ['only a focused browser run', { ...receipt(), browser: { ...receipt().browser, fullRun: false } }],
    ['missing account suite', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.filter(item => item.name !== 'passkeys') } }],
    ['legacy seven-pool proof without public Watten', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.filter(item => item.name !== 'watten-public') } }],
    ['failed public Watten pool', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.map(item => ({ ...item, exitCode: item.name === 'watten-public' ? 1 : 0 })) } }],
    ['duplicate pool replacing public Watten', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.map(item => item.name === 'watten-public' ? { name: 'username', exitCode: 0 } : item) } }],
    ['one browser shard failed', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.map((item, i) => ({ ...item, exitCode: i === 3 ? 1 : 0 })) } }],
    ['duplicate browser shard', { ...receipt(), browser: { fullRun: true,
      results: receipt().browser.results.map((item, i) => i === 3 ? { name: 'main-1', exitCode: 0 } : item) } }],
  ];
  for (const [name, candidate] of cases) await t.test(name,
    () => assert.ok(receiptError(candidate, context, 'installed-dependencies', now)));
  assert.match(receiptError(receipt(), { ...context, dirty: true }, 'installed-dependencies', now), /working tree/);
});

test('receipts and the full-run mutex are shared across worktrees of one repository', t => {
  const directory = repository(t);
  const second = join(temporary(t), 'second');
  git(['worktree', 'add', '-q', '-b', 'codex/second', second], directory);
  const firstContext = gitContext(directory);
  const secondContext = gitContext(second);
  assert.equal(firstContext.common, secondContext.common);
  saveReceipt(firstContext, { proof: 'shared metadata' });
  assert.deepEqual(readReceipt(secondContext), { proof: 'shared metadata' });
  const release = acquireVerificationLock(firstContext);
  try { assert.throws(() => acquireVerificationLock(secondContext), /already running/); }
  finally { release(); }
  acquireVerificationLock(secondContext)();
});

test('hook input resolves annotated tags, ignores deletions, rejects malformed records', t => {
  const directory = repository(t);
  const head = git(['rev-parse', 'HEAD'], directory);
  git(['tag', '-a', 'v1.0.0', '-m', 'Fixture release'], directory);
  const tag = git(['rev-parse', 'v1.0.0'], directory);
  const zero = '0'.repeat(40);
  assert.deepEqual(pushedCommits(`refs/heads/test ${head} refs/heads/test ${zero}\nrefs/tags/v1.0.0 ${tag} refs/tags/v1.0.0 ${zero}\n`, directory), [head]);
  assert.deepEqual(pushedCommits(`(delete) ${zero} refs/heads/test ${head}\n`, directory), []);
  assert.throws(() => pushedCommits(`refs/heads/test ${head} refs/heads/test`, directory), /Malformed/);
  assert.throws(() => pushedCommits('anything not-a-sha other wrong', directory), /Malformed/);
});

test('the installed hook rejects a real unverified push before it reaches the remote', t => {
  const directory = repository(t);
  const remote = join(temporary(t), 'remote.git');
  git(['init', '-q', '--bare', remote], directory);
  git(['remote', 'add', 'origin', remote], directory);
  cpSync(join(root, '.githooks'), join(directory, '.githooks'), { recursive: true });
  mkdirSync(join(directory, 'scripts'));
  for (const name of ['local-checks.mjs', 'verify-local.mjs', 'integration-receipt.mjs', 'install-local-hooks.mjs']) {
    cpSync(join(root, 'scripts', name), join(directory, 'scripts', name));
  }
  git(['add', '.'], directory);
  git(['commit', '-qm', 'Install fixture hook'], directory);
  execFileSync(process.execPath, ['scripts/install-local-hooks.mjs'], { cwd: directory });
  assert.throws(() => execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/codex/test'],
    { cwd: directory, stdio: 'pipe' }), error => {
    assert.match(error.stderr.toString(), /No complete local verification receipt/);
    return true;
  });
  assert.equal(git(['--git-dir', remote, 'for-each-ref', '--format=%(refname)'], directory), '');
});

test('hook installation preserves another hook or configured hook directory', t => {
  const directory = repository(t);
  git(['config', 'core.hooksPath', 'custom-hooks'], directory);
  assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts/install-local-hooks.mjs')],
    { cwd: directory, stdio: 'pipe' }), error => /Existing core.hooksPath/.test(error.stderr.toString()));
  assert.equal(git(['config', '--get', 'core.hooksPath'], directory), 'custom-hooks');
  git(['config', '--unset', 'core.hooksPath'], directory);
  writeFileSync(join(directory, '.git/hooks/pre-commit'), '# Existing hook\n');
  assert.throws(() => execFileSync(process.execPath, [join(root, 'scripts/install-local-hooks.mjs')],
    { cwd: directory, stdio: 'pipe' }), error => /Existing Git hooks/.test(error.stderr.toString()));
  assert.equal(readFileSync(join(directory, '.git/hooks/pre-commit'), 'utf8'), '# Existing hook\n');
});

test('a local Docker smoke test refuses every network or SSH daemon endpoint', () => {
  for (const endpoint of ['ssh://zdwa', 'tcp://127.0.0.1:2375', 'https://example.invalid', '', undefined]) {
    assert.throws(() => assertLocalDockerEndpoint(endpoint), /local Docker socket/);
  }
  assert.doesNotThrow(() => assertLocalDockerEndpoint('unix:///var/run/docker.sock'));
});

test('pytest environment filters cannot silently create a full-run receipt', () => {
  for (const value of ['-k harmless', '--ignore=tests', '--deselect tests/test_auth.py', '-m smoke']) {
    assert.throws(() => assertUnfilteredEnvironment({ PYTEST_ADDOPTS: value }), /must be unset/);
  }
  assert.doesNotThrow(() => assertUnfilteredEnvironment({}));
});

test('abort escalates only its own subprocess and leaves a foreign process alive', async t => {
  const directory = temporary(t);
  const ready = join(directory, 'ready');
  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => foreign.kill('SIGKILL'));
  const controller = new AbortController();
  const running = runCommand(process.execPath, ['-e',
    `require('fs').writeFileSync(process.argv[1], String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);`, ready],
  { signal: controller.signal, killTimeout: 50, logPath: join(directory, 'child.log') });
  for (let tries = 0; !existsSync(ready) && tries < 100; tries++) await delay(10);
  assert.ok(existsSync(ready));
  const childPid = Number(readFileSync(ready, 'utf8'));
  controller.abort();
  assert.notEqual((await running).exitCode, 0);
  assert.throws(() => process.kill(childPid, 0), /ESRCH/);
  assert.doesNotThrow(() => process.kill(foreign.pid, 0));
});
