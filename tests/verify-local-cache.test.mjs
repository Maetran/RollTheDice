import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { BROWSER_SUITES, RECEIPT_LIFETIME_MS, REQUIRED_CHECKS, assertFullBrowserResult } from '../scripts/local-checks.mjs';
import { mergeBrowserResults, readStageCache, saveStageCache, stageCachePath } from '../scripts/verify-local.mjs';

const tree = 'b'.repeat(40);
const environment = 'installed-dependencies';
const at = offset => new Date(Date.now() + offset).toISOString();
const passed = (name, offset = -1000) => ({ name, exitCode: 0, startedAt: at(offset - 1000), finishedAt: at(offset) });

function context(t) {
  const common = mkdtempSync(join(tmpdir(), 'rollthedice-stage-cache-'));
  t.after(() => rmSync(common, { recursive: true, force: true }));
  return { common, tree };
}

test('only groups and suites that passed on the same tree and environment are reused', t => {
  const owner = context(t);
  const checks = [passed('quality'), { ...passed('tools'), exitCode: 1 }, passed('backend'), passed('browser'), passed('diff')];
  const browser = [passed('main-1'), { ...passed('main-2'), exitCode: 1 }, passed('username')];
  saveStageCache(owner, environment, checks, browser);
  const cache = readStageCache(owner, environment);
  assert.deepEqual(Object.keys(cache.checks).sort(), ['backend', 'quality']);
  assert.deepEqual(Object.keys(cache.browser).sort(), ['main-1', 'username']);
  // Browser and diff are never reused as whole groups: browser is rebuilt from its suites, diff is instant.
  assert.equal(cache.checks.browser, undefined);
  assert.equal(cache.checks.diff, undefined);
  assert.deepEqual(readStageCache(owner, 'changed-dependencies'), { checks: {}, browser: {} });
  assert.deepEqual(readStageCache({ ...owner, tree: 'c'.repeat(40) }, environment), { checks: {}, browser: {} });
});

test('results older than the receipt lifetime, from the future or malformed are ignored', t => {
  const owner = context(t);
  mkdirSync(dirname(stageCachePath(owner)), { recursive: true });
  writeFileSync(stageCachePath(owner), JSON.stringify({ schemaVersion: 1, tree, environment,
    checks: { quality: passed('quality', -RECEIPT_LIFETIME_MS - 1000), tools: passed('tools', 60_000),
      backend: { ...passed('backend'), name: 'quality' }, 'image-build': passed('image-build'), unknown: passed('unknown') },
    browser: { 'main-1': passed('main-1'), 'main-999': passed('main-999') } }));
  const cache = readStageCache(owner, environment);
  assert.deepEqual(Object.keys(cache.checks), ['image-build']);
  assert.deepEqual(Object.keys(cache.browser), ['main-1']);
  writeFileSync(stageCachePath(owner), 'not json');
  assert.deepEqual(readStageCache(owner, environment), { checks: {}, browser: {} });
});

test('a partial browser rerun plus earlier passes forms a full result only when every suite is covered', () => {
  const [first, ...rest] = BROWSER_SUITES;
  const earlier = Object.fromEntries(rest.map(name => [name, { ...passed(name), status: 'passed' }]));
  const run = { fullRun: false, filters: [], results: [{ ...passed(first), status: 'passed' }] };
  const merged = mergeBrowserResults(run, earlier);
  assert.equal(merged.fullRun, true);
  assert.deepEqual(merged.reusedSuites, rest);
  assert.deepEqual(merged.results.map(item => item.name), BROWSER_SUITES);
  assertFullBrowserResult(merged);
  // A failed rerun stays failed; a missing suite is never treated as passed.
  const failed = mergeBrowserResults({ ...run, results: [{ ...passed(first), exitCode: 1, status: 'failed' }] }, earlier);
  assert.throws(() => assertFullBrowserResult(failed));
  const missing = mergeBrowserResults(run, Object.fromEntries(rest.slice(1).map(name => [name, passed(name)])));
  assert.equal(missing.fullRun, false);
  assert.throws(() => assertFullBrowserResult(missing));
  // A filtered or interrupted rerun never completes a receipt.
  assert.equal(mergeBrowserResults({ ...run, filters: ['--grep', 'x'] }, earlier).fullRun, false);
  assert.equal(mergeBrowserResults({ ...run, interruption: 'SIGINT' }, earlier).fullRun, false);
  assert.equal(REQUIRED_CHECKS.length, 7);
});
