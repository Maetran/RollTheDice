import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveBrowserShards, validateBrowserShards } from '../scripts/test-parallelism.mjs';

test('only measured shard counts are supported; malformed settings fail visibly', () => {
  for (const count of [4, 6, 8, '4', '6', '8']) assert.equal(validateBrowserShards(count), Number(count));
  for (const value of [0, 1, 5, 10, 18, '', '04', ' 6', '6.0', true, null, undefined]) {
    assert.throws(() => validateBrowserShards(value), /4, 6 or 8/);
  }
});

test('CLI overrides environment, which overrides the shared repository-local default', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'browser-parallelism-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  git(['init', '--quiet']);
  assert.equal(resolveBrowserShards({ root, environment: {} }), 4);
  git(['config', '--local', 'rollthedice.browserShards', '6']);
  assert.equal(resolveBrowserShards({ root, environment: {} }), 6);
  assert.equal(resolveBrowserShards({ root, environment: { ROLLTHEDICE_BROWSER_SHARDS: '8' } }), 8);
  assert.equal(resolveBrowserShards({ root, environment: { ROLLTHEDICE_BROWSER_SHARDS: '8' }, shards: 4 }), 4);
  git(['config', '--local', 'rollthedice.browserShards', '18']);
  assert.throws(() => resolveBrowserShards({ root, environment: {} }), /4, 6 or 8/);
  assert.throws(() => resolveBrowserShards({ root, environment: { ROLLTHEDICE_BROWSER_SHARDS: '' } }), /4, 6 or 8/);
});
