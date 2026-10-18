import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installer = join(root, 'scripts', 'install-local-hooks.mjs');
const legacy = '#!/bin/sh\nset -eu\nroot=$(git rev-parse --show-toplevel)\nexec node "$root/scripts/verify-local.mjs" --pre-push "$@"\n';

function fixture(t) {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'rollthedice-hook-tests-')));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const cwd = join(temporary, 'checkout');
  mkdirSync(cwd);
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(temporary, 'global.config') };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_PARAMETERS']) delete env[key];
  const git = args => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '--initial-branch=codex/hook-test']);
  git(['config', 'user.name', 'Hook test']); git(['config', 'user.email', 'hook@example.invalid']);
  git(['commit', '-qm', 'Fixture', '--allow-empty']);
  git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
  const install = (directory = cwd) => spawnSync(process.execPath, [installer], { cwd: directory, env, encoding: 'utf8' });
  const configured = () => git(['config', '--path', '--get', 'core.hooksPath']);
  return { temporary, cwd, env, git, install, configured };
}

function verification(cwd) {
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  writeFileSync(join(cwd, 'scripts', 'verify-local.mjs'), `
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
console.log(JSON.stringify({ args: process.argv.slice(2), input: Buffer.concat(chunks).toString('utf8') }));
`);
}

test('installation pins an executable common launcher and forwards hook arguments and stdin', t => {
  const f = fixture(t);
  verification(f.cwd);
  assert.equal(f.install().status, 0);
  const directory = f.configured();
  assert.equal(directory, join(f.cwd, '.git', 'local-checks', 'hooks'));
  assert.ok(statSync(join(directory, 'pre-push')).mode & 0o111);
  assert.equal(f.install().status, 0, 'Installing unchanged owned hooks is idempotent');
  const protocol = `refs/heads/test ${'a'.repeat(40)} refs/heads/test ${'0'.repeat(40)}\n`;
  const output = execFileSync(join(directory, 'pre-push'), ['origin', '/local/remote.git'], {
    cwd: f.cwd, env: f.env, input: protocol, encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), { args: ['--pre-push', 'origin', '/local/remote.git'], input: protocol });
  assert.ok(!existsSync(join(f.cwd, '.git/local-checks/hooks-install.lock')));
});

test('a stable launcher rejects a real push from an older worktree with no verification script', t => {
  const f = fixture(t);
  const older = f.git(['rev-parse', 'HEAD']);
  verification(f.cwd);
  f.git(['add', '.']); f.git(['commit', '-qm', 'Verification tooling']);
  assert.equal(f.install().status, 0);
  const second = join(f.temporary, 'older');
  f.git(['worktree', 'add', '-q', '-b', 'codex/older', second, older]);
  assert.ok(!existsSync(join(second, '.githooks/pre-push')));
  assert.ok(!existsSync(join(second, 'scripts/verify-local.mjs')));
  const remote = join(f.temporary, 'remote.git');
  f.git(['init', '-q', '--bare', remote]);
  const result = spawnSync('git', ['push', remote, 'HEAD:refs/heads/test'], { cwd: second, env: f.env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no scripts\/verify-local\.mjs/);
  assert.equal(f.git(['--git-dir', remote, 'for-each-ref', '--format=%(refname)']), '');
  assert.equal(spawnSync('git', ['config', '--get', 'core.hooksPath'], { cwd: second, env: f.env, encoding: 'utf8' }).stdout.trim(), f.configured());
});

for (const scope of ['global', 'worktree']) test(`effective ${scope} hooks remain configured and unmodified`, t => {
  const f = fixture(t);
  const directory = join(f.temporary, `${scope} hooks`);
  mkdirSync(directory);
  const marker = '# Foreign hook must remain installed\n';
  writeFileSync(join(directory, 'pre-push'), marker);
  if (scope === 'worktree') f.git(['config', '--local', 'extensions.worktreeConfig', 'true']);
  f.git(['config', `--${scope}`, 'core.hooksPath', directory]);
  const before = readFileSync(scope === 'global' ? f.env.GIT_CONFIG_GLOBAL : join(f.cwd, '.git/config.worktree'), 'utf8');
  const result = f.install();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Existing core.hooksPath.*is preserved/);
  assert.match(result.stderr, new RegExp(scope));
  assert.equal(f.configured(), directory);
  assert.equal(readFileSync(join(directory, 'pre-push'), 'utf8'), marker);
  assert.equal(readFileSync(scope === 'global' ? f.env.GIT_CONFIG_GLOBAL : join(f.cwd, '.git/config.worktree'), 'utf8'), before);
  assert.equal(spawnSync('git', ['config', '--local', '--get', 'core.hooksPath'], { cwd: f.cwd, env: f.env }).status, 1);
  assert.ok(!existsSync(join(f.cwd, '.git/local-checks/hooks')));
});

test('an explicitly empty effective hooksPath and a default custom hook are preserved', t => {
  const f = fixture(t);
  f.git(['config', '--global', 'core.hooksPath', '']);
  assert.match(f.install().stderr, /Existing core.hooksPath/);
  f.git(['config', '--global', '--unset', 'core.hooksPath']);
  const hook = join(f.cwd, '.git/hooks/pre-commit');
  writeFileSync(hook, '# custom pre-commit\n');
  assert.match(f.install().stderr, /Existing Git hooks are preserved/);
  assert.equal(readFileSync(hook, 'utf8'), '# custom pre-commit\n');
});

test('legacy owned relative configuration upgrades while extra or modified hooks are preserved', t => {
  const f = fixture(t);
  mkdirSync(join(f.cwd, '.githooks'));
  writeFileSync(join(f.cwd, '.githooks/pre-push'), legacy);
  f.git(['config', '--local', 'core.hooksPath', '.githooks']);
  writeFileSync(join(f.cwd, '.githooks/pre-commit'), '# custom additional hook\n');
  assert.match(f.install().stderr, /Existing core.hooksPath/);
  rmSync(join(f.cwd, '.githooks/pre-commit'));
  assert.equal(f.install().status, 0);
  assert.equal(f.configured(), join(f.cwd, '.git/local-checks/hooks'));
  assert.equal(readFileSync(join(f.cwd, '.githooks/pre-push'), 'utf8'), legacy);
  const installed = join(f.configured(), 'pre-push');
  appendFileSync(installed, '# User-added hook command\n');
  const before = readFileSync(installed, 'utf8');
  assert.match(f.install().stderr, /Existing Git hooks.*were changed/);
  assert.equal(readFileSync(installed, 'utf8'), before);
  assert.ok(!existsSync(join(f.cwd, '.git/local-checks/hooks-install.lock')));
});
