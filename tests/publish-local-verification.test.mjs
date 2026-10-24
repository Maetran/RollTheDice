import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { BROWSER_SUITES, REQUIRED_CHECKS, environmentFingerprint, gitContext, receiptPath, saveReceipt } from '../scripts/local-checks.mjs';
import { STATUS_CONTEXT, githubRepository, publishVerification, verificationStatus } from '../scripts/publish-local-verification.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const actualGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const owner = 'TrustedOwner';
const repository = `${owner}/RollTheDice`;

function fixture(t, { save = true, pushed = true } = {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'rollthedice-status-tests-')));
  const cwd = join(directory, 'checkout'), bare = join(directory, 'origin.git'), bin = join(directory, 'bin');
  mkdirSync(cwd); mkdirSync(bin);
  const environment = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete environment[key];
  const git = args => execFileSync(actualGit, args, { cwd, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '--initial-branch=develop']);
  git(['config', 'user.name', 'Publisher test']); git(['config', 'user.email', 'publisher@example.invalid']);
  writeFileSync(join(cwd, 'README.md'), 'Original base\n');
  git(['add', '.']); git(['commit', '-qm', 'Base']);
  git(['init', '-q', '--bare', bare]); git(['remote', 'add', 'origin', bare]);
  git(['push', '-q', 'origin', 'HEAD:refs/heads/develop']);
  git(['fetch', '-q', 'origin']);
  git(['checkout', '-qb', 'codex/publisher-test']);
  writeFileSync(join(cwd, 'README.md'), 'Verified feature\n');
  git(['commit', '-qam', 'Feature']);
  const push = () => git(['push', '-q', 'origin', 'HEAD:refs/heads/codex/publisher-test']);
  if (pushed) push();
  const context = gitContext(cwd);
  const receipt = { schemaVersion: 1, head: context.head, tree: context.tree, base: context.base,
    environment: environmentFingerprint(cwd), finishedAt: new Date(Date.now() - 1000).toISOString(),
    checks: REQUIRED_CHECKS.map(name => ({ name, exitCode: 0 })),
    browser: { fullRun: true, results: BROWSER_SUITES.map(name => ({ name, exitCode: 0 })) } };
  if (save) saveReceipt(context, receipt);

  // Git fetch/push use the real local bare origin. Only the URL presented to
  // the publisher is translated, so no test contacts a real GitHub remote.
  const wrapper = join(bin, 'git');
  const nodeProgram = join(bin, 'git-wrapper.cjs');
  writeFileSync(nodeProgram, `
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (JSON.stringify(args) === JSON.stringify(['remote', 'get-url', 'origin'])) {
  console.log('https://github.com/${repository}.git');
} else {
  const result = spawnSync(${JSON.stringify(actualGit)}, args, { stdio: 'inherit' });
  if (result.error) { console.error(result.error.message); process.exitCode = 1; }
  else process.exitCode = result.status ?? 1;
}
`);
  const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(nodeProgram)} "$@"\n`);
  chmodSync(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath || ''}`;
  t.after(() => { process.env.PATH = oldPath; rmSync(directory, { recursive: true, force: true }); });
  return { directory, cwd, bare, git, push, context, receipt };
}

function mockGitHub(f, { actor = owner, remoteTree, statuses = [], afterStatusRead, postResponse } = {}) {
  const calls = [];
  const execute = (args, options = {}) => {
    assert.equal(args[0], 'api', 'Only explicitly mocked gh api calls are accepted');
    const endpoint = args.find(value => value === 'user' || value.startsWith('repos/'));
    const methodIndex = args.indexOf('--method');
    const method = methodIndex === -1 ? 'GET' : args[methodIndex + 1];
    const call = { endpoint, method, args: [...args], input: options.input };
    calls.push(call);
    if (method === 'POST') {
      assert.equal(endpoint, `repos/${repository}/statuses/${f.receipt.head}`);
      assert.equal(args[args.indexOf('--input') + 1], '-');
      const payload = JSON.parse(options.input);
      const response = { ...payload, creator: { login: owner }, created_at: new Date().toISOString(),
        url: `https://api.github.com/repos/${repository}/statuses/${f.receipt.head}` };
      return JSON.stringify(postResponse ? postResponse(response) : response);
    }
    assert.equal(method, 'GET', 'Unexpected mutating GitHub API request');
    if (endpoint === `repos/${repository}`) return owner;
    if (endpoint === 'user') return actor;
    if (endpoint === `repos/${repository}/commits/${f.receipt.head}`) {
      if (remoteTree !== undefined) return remoteTree;
      try { return f.git(['--git-dir', f.bare, 'show', '-s', '--format=%T', f.receipt.head]); }
      catch { throw new Error('HTTP 404: the verified commit has not been pushed'); }
    }
    if (endpoint === `repos/${repository}/commits/${f.receipt.head}/status`) {
      afterStatusRead?.();
      return JSON.stringify({ statuses });
    }
    throw new Error(`Unmocked GitHub endpoint: ${endpoint}`);
  };
  return { calls, execute, writes: () => calls.filter(call => call.method !== 'GET') };
}

test('the public status uses the exact compact ISO-second contract and allows only GitHub remotes', () => {
  const receipt = { head: 'a'.repeat(40), tree: 'b'.repeat(40), base: 'c'.repeat(40), finishedAt: '2026-10-18T11:20:30.987Z' };
  assert.equal(STATUS_CONTEXT, 'Local verification');
  assert.deepEqual(verificationStatus(receipt, repository), {
    state: 'success', context: 'Local verification',
    description: JSON.stringify([1, 'b'.repeat(40), 'c'.repeat(40), '2026-10-18T11:20:30Z']),
    target_url: `https://github.com/${repository}/commit/${receipt.head}`,
  });
  for (const remote of [`git@github.com:${repository}.git`, `https://github.com/${repository}`, `ssh://git@github.com/${repository}.git`]) {
    assert.equal(githubRepository(remote), repository);
  }
  for (const remote of ['/local/origin.git', 'https://example.invalid/owner/repo', 'git@github.com:owner/repo/extra']) {
    assert.throws(() => githubRepository(remote), /github.com/);
  }
  assert.throws(() => verificationStatus({ ...receipt, tree: 'not-a-tree' }, repository), /Invalid/);
  assert.throws(() => verificationStatus({ ...receipt, finishedAt: 'yesterday' }, repository), /Invalid/);
});

test('missing or invalid full receipts never reach even the mocked GitHub API', async t => {
  for (const kind of ['missing', 'corrupt', 'wrong-head', 'failed-check', 'partial-browser', 'legacy-browser-pools', 'failed-public-browser', 'expired']) await t.test(kind, child => {
    const f = fixture(child, { save: false });
    if (kind === 'corrupt') {
      mkdirSync(dirname(receiptPath(f.context)), { recursive: true });
      writeFileSync(receiptPath(f.context), '{invalid JSON');
    } else if (kind !== 'missing') {
      const receipt = structuredClone(f.receipt);
      if (kind === 'wrong-head') receipt.head = 'a'.repeat(40);
      if (kind === 'failed-check') receipt.checks[0].exitCode = 1;
      if (kind === 'partial-browser') receipt.browser.fullRun = false;
      if (kind === 'legacy-browser-pools') receipt.browser.results = receipt.browser.results.filter(item => item.name !== 'watten-public');
      if (kind === 'failed-public-browser') receipt.browser.results.find(item => item.name === 'watten-public').exitCode = 1;
      if (kind === 'expired') receipt.finishedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      saveReceipt(f.context, receipt);
    }
    const api = mockGitHub(f);
    assert.throws(() => publishVerification({ cwd: f.cwd, execute: api.execute }));
    assert.deepEqual(api.calls, []);
  });
});

test('a different authenticated actor or remote tree cannot authorize a POST', async t => {
  for (const variant of ['actor', 'tree']) await t.test(variant, child => {
    const f = fixture(child);
    const api = mockGitHub(f, variant === 'actor' ? { actor: 'DifferentUser' } : { remoteTree: 'd'.repeat(40) });
    assert.throws(() => publishVerification({ cwd: f.cwd, execute: api.execute }), variant === 'actor' ? /Only repository owner/ : /Push the verified commit/);
    assert.deepEqual(api.writes(), []);
  });
});

test('a locally verified commit must actually exist in the pushed origin before publication', t => {
  const f = fixture(t, { pushed: false });
  const api = mockGitHub(f);
  assert.throws(() => publishVerification({ cwd: f.cwd, execute: api.execute }), /not been pushed/);
  assert.deepEqual(api.writes(), []);
});

test('a valid pushed receipt publishes one exact status to github.com and confirms its owner', t => {
  const f = fixture(t);
  const api = mockGitHub(f);
  const result = publishVerification({ cwd: f.cwd, execute: api.execute });
  assert.equal(api.writes().length, 1);
  const payload = JSON.parse(api.writes()[0].input);
  assert.deepEqual(payload, { state: 'success', context: 'Local verification',
    description: JSON.stringify([1, f.receipt.tree, f.receipt.base, new Date(f.receipt.finishedAt).toISOString().replace(/\.\d{3}Z$/, 'Z')]),
    target_url: `https://github.com/${repository}/commit/${f.receipt.head}` });
  assert.equal(result.creator.login, owner);
  for (const call of api.calls) {
    assert.equal(call.args[call.args.indexOf('--hostname') + 1], 'github.com', 'Pin every API request independently of inherited GH_HOST');
  }
});

test('an identical owner-issued status is reused while another actor cannot supply the proof', async t => {
  for (const trusted of [true, false]) await t.test(trusted ? 'owner proof' : 'foreign proof', child => {
    const f = fixture(child);
    const existing = { ...verificationStatus(f.receipt, repository), creator: { login: trusted ? owner : 'DifferentUser' } };
    const api = mockGitHub(f, { statuses: [existing] });
    const result = publishVerification({ cwd: f.cwd, execute: api.execute });
    assert.equal(api.writes().length, trusted ? 0 : 1);
    assert.equal(result.creator.login, owner);
    assert.equal(result.description, existing.description);
  });
});

test('a checkout changed during API reads cannot reuse or create a status', t => {
  const f = fixture(t);
  const api = mockGitHub(f, { afterStatusRead: () => writeFileSync(join(f.cwd, 'README.md'), 'Changed during publication\n') });
  assert.throws(() => publishVerification({ cwd: f.cwd, execute: api.execute }), /working tree|changed|commit/i);
  assert.deepEqual(api.writes(), []);
});

test('a malformed or foreign POST response is rejected without retrying the write', async t => {
  const cases = {
    state: status => ({ ...status, state: 'pending' }),
    context: status => ({ ...status, context: 'Different context' }),
    description: status => ({ ...status, description: 'Not the compact proof' }),
    actor: status => ({ ...status, creator: { login: 'DifferentUser' } }),
    missingActor: status => ({ ...status, creator: undefined }),
  };
  for (const [name, postResponse] of Object.entries(cases)) await t.test(name, child => {
    const f = fixture(child);
    const api = mockGitHub(f, { postResponse });
    assert.throws(() => publishVerification({ cwd: f.cwd, execute: api.execute }), /owner-issued verification status/);
    assert.equal(api.writes().length, 1);
  });
});

test('an unchanged develop merge retains the original source status without publishing a new base', t => {
  const f = fixture(t);
  f.git(['checkout', '-q', 'develop']);
  f.git(['merge', '--no-ff', '-qm', 'Merge the verified feature', 'codex/publisher-test']);
  f.git(['push', '-q', 'origin', 'HEAD:refs/heads/develop']);
  const api = mockGitHub(f);
  assert.deepEqual(publishVerification({ cwd: f.cwd, execute: api.execute }),
    { published: false, inheritedFrom: f.receipt.head });
  assert.deepEqual(api.calls, []);
});
