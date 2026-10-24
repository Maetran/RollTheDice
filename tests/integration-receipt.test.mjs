import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { adoptIntegrationReceipt } from '../scripts/integration-receipt.mjs';
import { BROWSER_SUITES, REQUIRED_CHECKS, gitContext, receiptError, receiptPath, saveReceipt } from '../scripts/local-checks.mjs';

const environment = 'current-installed-environment';

function repository(t) {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'rollthedice-integration-proof-')));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete env[key];
  const git = args => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '--initial-branch=develop']);
  git(['config', 'user.name', 'Integration proof test']); git(['config', 'user.email', 'proof@example.invalid']);
  writeFileSync(join(cwd, 'README.md'), 'Base\n');
  git(['add', '.']); git(['commit', '-qm', 'Develop base']);
  const firstParent = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/develop', firstParent]);
  return { cwd, git, firstParent };
}

function proof(context) {
  const finishedAt = new Date(Date.now() - 1000).toISOString();
  return { schemaVersion: 1, head: context.head, tree: context.tree, base: context.base, environment, finishedAt,
    checks: REQUIRED_CHECKS.map(name => ({ name, exitCode: 0, finishedAt, logPath: `/kept/${name}.log` })),
    browser: { fullRun: true, results: BROWSER_SUITES.map(name => ({ name, exitCode: 0, logPath: `/kept/${name}.log` })) },
    output: '/kept/original-reports' };
}

function sourceBranch(f) {
  f.git(['checkout', '-qb', 'codex/source']);
  writeFileSync(join(f.cwd, 'feature.txt'), 'Verified source\n');
  f.git(['add', '.']); f.git(['commit', '-qm', 'Source feature']);
  const sourceContext = gitContext(f.cwd);
  const sourceReceipt = proof(sourceContext);
  saveReceipt(sourceContext, sourceReceipt);
  return { ...f, sourceContext, sourceReceipt, sourceHead: sourceContext.head };
}

function integration(t) {
  const f = sourceBranch(repository(t));
  f.git(['checkout', '-q', 'develop']);
  f.git(['merge', '-q', '--no-ff', '--no-edit', 'codex/source']);
  f.git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  return { ...f, context: gitContext(f.cwd) };
}

test('an unchanged normal PR merge inherits complete source evidence without rewriting reports or timestamps', t => {
  const f = integration(t);
  const sourcePath = receiptPath(f.sourceContext), original = readFileSync(sourcePath, 'utf8');
  const messages = [];
  t.mock.method(console, 'log', message => messages.push(message));
  const adopted = adoptIntegrationReceipt(f.context, environment);
  assert.ok(adopted);
  assert.equal(adopted.head, f.context.head);
  assert.equal(adopted.base, f.context.base);
  assert.equal(adopted.tree, f.sourceContext.tree);
  assert.equal(adopted.inheritedFrom, f.sourceHead);
  assert.equal(adopted.sourceBase, f.firstParent);
  assert.equal(adopted.finishedAt, f.sourceReceipt.finishedAt);
  assert.equal(adopted.output, f.sourceReceipt.output);
  assert.deepEqual(adopted.checks, f.sourceReceipt.checks);
  assert.deepEqual(adopted.browser, f.sourceReceipt.browser);
  assert.equal(receiptError(adopted, f.context, environment), null);
  assert.equal(readFileSync(sourcePath, 'utf8'), original);
  assert.equal(existsSync(receiptPath(f.context)), false, 'Only the caller may persist the inherited receipt');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Reusing complete local checks from source/);
  assert.ok(messages[0].includes(f.sourceHead));
});

test('master fast-forwarding to the same verified develop merge can inherit the same source evidence', t => {
  const f = integration(t);
  f.git(['checkout', '-qb', 'master', f.firstParent]);
  f.git(['merge', '-q', '--ff-only', 'develop']);
  const context = gitContext(f.cwd);
  const adopted = adoptIntegrationReceipt(context, environment);
  assert.equal(adopted?.head, f.context.head);
  assert.equal(adopted?.finishedAt, f.sourceReceipt.finishedAt);
});

test('dirty, stale or advanced checkout contexts cannot adopt', async t => {
  for (const kind of ['dirty', 'advanced-base', 'stale-head', 'stale-dirty-flag']) await t.test(kind, child => {
    const f = integration(child);
    let context = f.context;
    if (kind === 'dirty' || kind === 'stale-dirty-flag') {
      writeFileSync(join(f.cwd, 'README.md'), 'Unverified edit\n');
      if (kind === 'dirty') context = gitContext(f.cwd);
    } else {
      writeFileSync(join(f.cwd, 'README.md'), 'Next develop\n');
      f.git(['commit', '-qam', 'Advanced develop']);
      if (kind === 'advanced-base') {
        f.git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
        f.git(['checkout', '-q', '--detach', f.context.head]);
        context = gitContext(f.cwd);
      }
    }
    assert.equal(adoptIntegrationReceipt(context, environment), null);
  });
});

test('linear, octopus and amended integration trees cannot adopt', async t => {
  for (const kind of ['linear', 'octopus', 'changed-tree']) await t.test(kind, child => {
    const f = sourceBranch(repository(child));
    f.git(['checkout', '-q', 'develop']);
    if (kind === 'linear') f.git(['merge', '-q', '--ff-only', 'codex/source']);
    else if (kind === 'octopus') {
      f.git(['checkout', '-qb', 'codex/other', f.firstParent]);
      writeFileSync(join(f.cwd, 'other.txt'), 'Another source\n');
      f.git(['add', '.']); f.git(['commit', '-qm', 'Other source']);
      f.git(['checkout', '-q', 'develop']);
      f.git(['merge', '-q', '--no-ff', '--no-edit', 'codex/source', 'codex/other']);
    } else {
      f.git(['merge', '-q', '--no-ff', '--no-edit', 'codex/source']);
      writeFileSync(join(f.cwd, 'README.md'), 'Integration-only change\n');
      f.git(['commit', '-qam', 'Changed merge tree', '--amend']);
    }
    f.git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
    assert.equal(adoptIntegrationReceipt(gitContext(f.cwd), environment), null);
  });
});

test('matching tree bytes cannot substitute for first-parent ancestry in the source', t => {
  const f = repository(t);
  f.git(['checkout', '-qb', 'codex/source']);
  writeFileSync(join(f.cwd, 'same.txt'), 'Identical bytes\n');
  f.git(['add', '.']); f.git(['commit', '-qm', 'Independent source commit']);
  const sourceContext = gitContext(f.cwd);
  f.git(['checkout', '-q', 'develop']);
  writeFileSync(join(f.cwd, 'same.txt'), 'Identical bytes\n');
  f.git(['add', '.']); f.git(['commit', '-qm', 'Different develop history']);
  const firstParent = f.git(['rev-parse', 'HEAD']);
  saveReceipt(sourceContext, { ...proof(sourceContext), base: firstParent });
  f.git(['merge', '-q', '--no-ff', '--no-edit', 'codex/source']);
  f.git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  const context = gitContext(f.cwd);
  assert.equal(context.tree, sourceContext.tree, 'The ancestry guard is tested independently of tree equality');
  assert.equal(adoptIntegrationReceipt(context, environment), null);
});

test('missing, malformed, stale or incomplete source proofs all require a new full verification', async t => {
  for (const kind of ['missing', 'corrupt', 'wrong-base', 'wrong-head', 'old', 'environment', 'failed-group', 'partial-browser', 'legacy-browser-pools', 'failed-public-browser', 'malformed-group']) {
    await t.test(kind, child => {
      const f = integration(child), source = structuredClone(f.sourceReceipt);
      if (kind === 'missing') rmSync(receiptPath(f.sourceContext));
      else if (kind === 'corrupt') writeFileSync(receiptPath(f.sourceContext), '{broken JSON');
      else {
        if (kind === 'wrong-base') source.base = f.sourceHead;
        if (kind === 'wrong-head') source.head = f.context.head;
        if (kind === 'old') source.finishedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
        if (kind === 'environment') source.environment = 'different installed environment';
        if (kind === 'failed-group') source.checks[0].exitCode = 1;
        if (kind === 'partial-browser') source.browser.fullRun = false;
        if (kind === 'legacy-browser-pools') source.browser.results = source.browser.results.filter(item => item.name !== 'watten-public');
        if (kind === 'failed-public-browser') source.browser.results.find(item => item.name === 'watten-public').exitCode = 1;
        if (kind === 'malformed-group') source.checks[0] = null;
        saveReceipt(f.sourceContext, source);
      }
      assert.equal(adoptIntegrationReceipt(f.context, environment), null);
      assert.equal(existsSync(receiptPath(f.context)), false);
    });
  }
});

test('real filesystem and Git failures remain errors instead of becoming permission to adopt', async t => {
  await t.test('unreadable receipt path type', child => {
    const f = integration(child);
    rmSync(receiptPath(f.sourceContext)); mkdirSync(receiptPath(f.sourceContext));
    assert.throws(() => adoptIntegrationReceipt(f.context, environment), error => error.code === 'EISDIR');
  });
  await t.test('broken Git metadata', child => {
    const f = integration(child);
    rmSync(join(f.cwd, '.git/HEAD'));
    assert.throws(() => adoptIntegrationReceipt(f.context, environment), /not a git repository|Command failed/i);
  });
});
