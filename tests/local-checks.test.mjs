import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { REQUIRED_CHECKS, BROWSER_SUITES, RECEIPT_LIFETIME_MS, acquireVerificationLock,
  assertFullBrowserResult, assertLocalDockerEndpoint, assertUnfilteredEnvironment, environmentFingerprint,
  git, gitContext, pushedCommits, receiptError,
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
    ['missing account suite', { ...receipt(), browser: { fullRun: true, results: receipt().browser.results.slice(0, 6) } }],
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

test('full browser proof requires every declared shard and account suite exactly once', async t => {
  assert.doesNotThrow(() => assertFullBrowserResult(receipt().browser));
  for (const mainShards of [4, 6, 8]) {
    await t.test(`${mainShards} main shards`, () => {
      const names = [...Array.from({ length: mainShards }, (_, index) => `main-${index + 1}`),
        'username', 'passkeys', 'hausdepp-passkeys'];
      const browser = { fullRun: true, mainShards, results: names.map(name => ({ name, exitCode: 0 })) };
      assert.doesNotThrow(() => assertFullBrowserResult(browser));
      assert.doesNotThrow(() => assertFullBrowserResult({ ...browser, results: [...browser.results].reverse() }));
      for (let index = 0; index < browser.results.length; index++) {
        const missing = { ...browser, results: browser.results.filter((_, i) => i !== index) };
        assert.throws(() => assertFullBrowserResult(missing), /every main shard/);
        const duplicate = { ...browser, results: browser.results.map((item, i) =>
          i === index ? browser.results[(index + 1) % browser.results.length] : item) };
        assert.throws(() => assertFullBrowserResult(duplicate), /every main shard/);
        const failed = { ...browser, results: browser.results.map((item, i) =>
          i === index ? { ...item, exitCode: 1 } : item) };
        assert.throws(() => assertFullBrowserResult(failed), /successful/);
      }
      assert.throws(() => assertFullBrowserResult({ ...browser,
        results: [...browser.results, { name: `main-${mainShards + 1}`, exitCode: 0 }] }), /every main shard/);
      // A larger declared count cannot be backed by a smaller legacy result set.
      if (mainShards > 4) {
        assert.throws(() => assertFullBrowserResult({ ...receipt().browser, mainShards }), /every main shard/);
        assert.throws(() => assertFullBrowserResult({ ...browser, mainShards: undefined }), /every main shard/);
      }
      assert.equal(receiptError({ ...receipt(), browser }, context, 'installed-dependencies', now), null);
    });
  }
  for (const mainShards of [0, 1, 5, 7, 9, 18, '6', null, NaN]) {
    assert.throws(() => assertFullBrowserResult({ ...receipt().browser, mainShards }), /supported main-shard count/);
  }
  assert.throws(() => assertFullBrowserResult({ ...receipt().browser, results: [null, ...receipt().browser.results.slice(1)] }),
    /every main shard/);
});

test('changing the effective Git-local browser parallelism invalidates the environment receipt', t => {
  const directory = repository(t);
  const python = join(directory, 'fixture-python');
  writeFileSync(python, `#!/usr/bin/env node\nprocess.stdout.write(process.argv[2] === '-VV' ? 'Python fixture\\n' : '[]\\n');\n`);
  chmodSync(python, 0o700);
  const environment = { PATH: process.env.PATH, PLAYWRIGHT_PYTHON: python };
  const fallback = environmentFingerprint(directory, environment);
  git(['config', '--local', 'rollthedice.browserShards', '4'], directory);
  assert.equal(environmentFingerprint(directory, environment), fallback);
  git(['config', '--local', 'rollthedice.browserShards', '6'], directory);
  const six = environmentFingerprint(directory, environment);
  assert.notEqual(six, fallback);
  const proof = { ...receipt(), environment: six };
  assert.equal(receiptError(proof, context, six, now), null);
  git(['config', '--local', 'rollthedice.browserShards', '8'], directory);
  const eight = environmentFingerprint(directory, environment);
  assert.notEqual(eight, six);
  assert.match(receiptError(proof, context, eight, now), /environment changed/);
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
  for (const name of ['local-checks.mjs', 'test-parallelism.mjs', 'verify-local.mjs', 'integration-receipt.mjs', 'install-local-hooks.mjs']) {
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
