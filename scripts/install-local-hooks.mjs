import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitContext } from './local-checks.mjs';

const installerRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'rollthedice-local-verification';
const hash = value => createHash('sha256').update(value).digest('hex');
const activeHookNames = directory => existsSync(directory)
  ? readdirSync(directory).filter(name => !name.endsWith('.sample') && !name.startsWith('.')) : [];
const legacyHook = '#!/bin/sh\nset -eu\nroot=$(git rev-parse --show-toplevel)\nexec node "$root/scripts/verify-local.mjs" --pre-push "$@"\n';

function gitConfiguration(args, cwd, env) {
  return execFileSync('git', ['config', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function effectiveHooksPath(cwd, env = process.env) {
  let raw;
  try { raw = gitConfiguration(['--null', '--show-scope', '--show-origin', '--get', 'core.hooksPath'], cwd, env); }
  catch (error) { if (error.status === 1) return null; throw error; }
  const [scope, origin, value] = raw.split('\0');
  const expanded = gitConfiguration(['--path', '--get', 'core.hooksPath'], cwd, env).replace(/\r?\n$/, '');
  return { scope, origin, value, path: resolve(cwd, expanded) };
}

function assertManagedDirectory(directory) {
  if (!existsSync(directory)) return null;
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) {
    throw new Error(`Existing Git hooks at ${directory} are preserved; the managed path must be a real directory.`);
  }
  const contents = readdirSync(directory);
  if (!contents.length) return null;
  const metadataPath = join(directory, '.owner.json');
  const hookPath = join(directory, 'pre-push');
  let metadata;
  try {
    if (lstatSync(metadataPath).isSymbolicLink() || lstatSync(hookPath).isSymbolicLink()) throw new Error('symlink');
    metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
  } catch { throw new Error(`Existing Git hooks at ${directory} are preserved; no valid installer ownership record exists.`); }
  if (metadata.owner !== owner || metadata.schemaVersion !== 1 || metadata.hookHash !== hash(readFileSync(hookPath))) {
    throw new Error(`Existing Git hooks at ${directory} were changed; integrate the verification hook without overwriting them.`);
  }
  return metadata;
}

export function installLocalHooks({ cwd = process.cwd(), env = process.env } = {}) {
  const context = gitContext(cwd);
  const directory = join(context.common, 'local-checks', 'hooks');
  const template = readFileSync(join(installerRoot, '.githooks', 'pre-push'));
  const configured = effectiveHooksPath(context.root, env);
  if (configured && configured.path !== directory) {
    const legacyDirectory = join(context.root, '.githooks');
    const previousHook = join(legacyDirectory, 'pre-push');
    const previousContent = existsSync(previousHook) ? readFileSync(previousHook, 'utf8') : null;
    const ours = configured.scope === 'local' && configured.path === legacyDirectory
      && existsSync(legacyDirectory) && !lstatSync(legacyDirectory).isSymbolicLink()
      && activeHookNames(legacyDirectory).every(name => name === 'pre-push')
      && (previousContent === legacyHook || previousContent === template.toString('utf8'));
    if (!ours) throw new Error(`Existing core.hooksPath (${configured.value}, ${configured.scope}, ${configured.origin}) is preserved; integrate the local verification hook there explicitly.`);
  }
  if (!configured && activeHookNames(join(context.common, 'hooks')).length) {
    throw new Error('Existing Git hooks are preserved. Chain the local pre-push check into that hook before installing.');
  }
  // The lock and launcher live outside every checkout. Changing to an older
  // branch cannot remove the pre-push check or silently fall back to no hook.
  const parent = dirname(directory);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const lock = join(parent, 'hooks-install.lock');
  const token = randomUUID();
  try { writeFileSync(lock, token, { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error(`Hook installation is already locked: ${lock}`);
    throw error;
  }
  let temporary;
  try {
    if (JSON.stringify(effectiveHooksPath(context.root, env)) !== JSON.stringify(configured)) {
      throw new Error('The effective hook configuration changed during installation; existing hooks are preserved.');
    }
    assertManagedDirectory(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    temporary = join(directory, `.pre-push-${token}`);
    writeFileSync(temporary, template, { flag: 'wx', mode: 0o755 });
    chmodSync(temporary, 0o755);
    renameSync(temporary, join(directory, 'pre-push'));
    temporary = null;
    writeFileSync(join(directory, '.owner.json'), JSON.stringify({ owner, schemaVersion: 1, hookHash: hash(template) }) + '\n', { mode: 0o600 });
    // Never replace global or worktree-specific configuration. A foreign
    // effective value was rejected above; a matching worktree value stays put.
    if (configured?.scope !== 'worktree') gitConfiguration(['--local', 'core.hooksPath', directory], context.root, env);
    const applied = effectiveHooksPath(context.root, env);
    if (applied?.path !== directory) throw new Error('The effective hook path changed during installation; verify Git configuration before pushing.');
    return { root: context.root, hooksPath: directory };
  } finally {
    if (temporary && existsSync(temporary)) unlinkSync(temporary);
    try { if (readFileSync(lock, 'utf8') === token) unlinkSync(lock); } catch { /* Already removed. */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const installed = installLocalHooks();
    console.log(`Local pre-push verification enabled for all repository worktrees: ${installed.hooksPath}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
