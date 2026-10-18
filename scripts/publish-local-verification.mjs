import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReceipt } from './verify-local.mjs';
import { git } from './local-checks.mjs';

export const STATUS_CONTEXT = 'Local verification';

export function githubRepository(remote) {
  const match = remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (!match) throw new Error('Publishing local verification requires an origin on github.com.');
  return match[1];
}

export function verificationStatus(receipt, repository) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)
    || !/^[0-9a-f]{40}$/.test(receipt.head) || !/^[0-9a-f]{40}$/.test(receipt.tree)
    || !/^[0-9a-f]{40}$/.test(receipt.base) || !Number.isFinite(Date.parse(receipt.finishedAt))) {
    throw new Error('Invalid local verification status metadata.');
  }
  // GitHub status timestamps have second precision. Round the completion time
  // to that same precision so a status published in the same second is valid.
  const completed = new Date(receipt.finishedAt).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return { state: 'success', context: STATUS_CONTEXT,
    description: JSON.stringify([1, receipt.tree, receipt.base, completed]),
    target_url: `https://github.com/${repository}/commit/${receipt.head}` };
}

function gh(args, { cwd, input } = {}) {
  return execFileSync('gh', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

export function publishVerification({ cwd = process.cwd(), execute = gh } = {}) {
  git(['fetch', 'origin'], cwd);
  const receipt = checkReceipt(cwd);
  const repository = githubRepository(git(['remote', 'get-url', 'origin'], cwd));
  const owner = execute(['api', '--hostname', 'github.com', `repos/${repository}`, '--jq', '.owner.login'], { cwd });
  const actor = execute(['api', '--hostname', 'github.com', 'user', '--jq', '.login'], { cwd });
  if (owner !== actor) throw new Error(`Only repository owner ${owner} may publish the trusted local verification status; signed in as ${actor}.`);
  const remoteTree = execute(['api', '--hostname', 'github.com', `repos/${repository}/commits/${receipt.head}`, '--jq', '.commit.tree.sha'], { cwd });
  if (remoteTree !== receipt.tree) throw new Error('Push the verified commit to origin before publishing its local verification status.');
  const payload = verificationStatus(receipt, repository);
  const existing = JSON.parse(execute(['api', '--hostname', 'github.com', `repos/${repository}/commits/${receipt.head}/status`], { cwd }));
  const latest = existing.statuses?.find(status => status.context === STATUS_CONTEXT);
  // Network reads must not authorize a checkout that changed in the meantime.
  const current = checkReceipt(cwd);
  if (current.head !== receipt.head || current.tree !== receipt.tree || current.base !== receipt.base) {
    throw new Error('The verified checkout changed before publication.');
  }
  if (latest?.creator?.login === owner && latest.state === 'success' && latest.description === payload.description) {
    console.log(`[local] Existing trusted verification status retained for ${receipt.head}.`);
    return latest;
  }
  const status = JSON.parse(execute(['api', '--hostname', 'github.com', '--method', 'POST', `repos/${repository}/statuses/${receipt.head}`, '--input', '-'],
    { cwd, input: JSON.stringify(payload) }));
  if (status.state !== 'success' || status.context !== STATUS_CONTEXT
    || status.description !== payload.description || status.creator?.login !== owner) {
    throw new Error('GitHub did not confirm the expected owner-issued verification status.');
  }
  console.log(`[local] Full local verification published for ${receipt.head}: ${payload.target_url}`);
  return status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { publishVerification(); }
  catch (error) { console.error(`[local] ${error.message}`); process.exitCode = 1; }
}
