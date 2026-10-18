import { execFileSync, spawnSync } from 'node:child_process';
import { checkReceipt, verifyLocal } from './verify-local.mjs';
import { git, gitContext } from './local-checks.mjs';
import { publishVerification } from './publish-local-verification.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.some(arg => ['--no-verify', '-f'].includes(arg) || arg.startsWith('--force') || arg.startsWith('+'))) {
    throw new Error('Unchecked and forced pushes are not supported.');
  }
  git(['fetch', 'origin']);
  const before = gitContext();
  if (before.dirty) throw new Error('Commit source changes before pushing.');
  git(['merge-base', '--is-ancestor', before.base, before.head]);
  try { checkReceipt(); }
  catch { await verifyLocal(); }
  // A successful test run cannot authorize a different develop base or commit.
  git(['fetch', 'origin']);
  checkReceipt();
  execFileSync('git', ['diff', '--check'], { stdio: 'inherit' });
  const result = spawnSync('git', ['push', ...args], { stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (result.status === 0 && !args.some(arg => ['--dry-run', '-n'].includes(arg))) publishVerification();
}

main().catch(error => { console.error(`[local] ${error.message}`); process.exitCode = 1; });
