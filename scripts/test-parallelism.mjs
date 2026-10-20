import { execFileSync } from 'node:child_process';

export const BROWSER_SHARD_COUNTS = Object.freeze([4, 6, 8]);

export function validateBrowserShards(value) {
  if (!BROWSER_SHARD_COUNTS.includes(Number(value)) || !/^[468]$/.test(String(value))) {
    throw new Error('Browser shards must be one of 4, 6 or 8');
  }
  return Number(value);
}

// Repository-local Git configuration belongs to this machine and is shared by
// its worktrees. It never changes another developer's default via a commit.
export function resolveBrowserShards({ root = process.cwd(), environment = process.env, shards } = {}) {
  if (shards !== undefined) return validateBrowserShards(shards);
  if (environment.ROLLTHEDICE_BROWSER_SHARDS !== undefined) {
    return validateBrowserShards(environment.ROLLTHEDICE_BROWSER_SHARDS);
  }
  let configured;
  try {
    configured = execFileSync('git', ['config', '--local', '--get', 'rollthedice.browserShards'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    if (error.status !== 1) throw new Error(`Cannot read local browser parallelism: ${error.message}`, { cause: error });
    return 4;
  }
  return validateBrowserShards(configured);
}
