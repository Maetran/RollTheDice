import { readFileSync } from 'node:fs';
import { git, gitContext, receiptError, receiptPath } from './local-checks.mjs';

function matchesCheckout(context) {
  const actual = gitContext(context.root);
  return !actual.dirty && ['head', 'tree', 'base', 'common'].every(key => actual[key] === context[key]);
}

/** Reuse source evidence only for the current, unchanged two-parent develop merge. */
export function adoptIntegrationReceipt(context, environment) {
  if (!context || context.dirty || context.head !== context.base || !matchesCheckout(context)) return null;
  const parents = git(['show', '-s', '--format=%P', context.head], context.root).split(/\s+/).filter(Boolean);
  if (parents.length !== 2) return null;
  const [firstParent, sourceHead] = parents;
  if (git(['rev-parse', `${sourceHead}^{tree}`], context.root) !== context.tree) return null;
  try { git(['merge-base', '--is-ancestor', firstParent, sourceHead], context.root); }
  catch (error) { if (error.status === 1) return null; throw error; }

  const sourceContext = { ...context, head: sourceHead, tree: context.tree, base: firstParent, dirty: false };
  let source;
  try { source = JSON.parse(readFileSync(receiptPath(sourceContext), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
  try { if (receiptError(source, sourceContext, environment)) return null; }
  catch (error) { if (error instanceof TypeError) return null; throw error; }
  if (!matchesCheckout(context)) return null;

  // Preserve the actual test completion and every report. This is an inherited
  // proof for identical sources, never a claim that the merge SHA was rerun.
  const inherited = { ...source, head: context.head, tree: context.tree, base: context.base,
    inheritedFrom: sourceHead, sourceBase: firstParent };
  console.log(`[local] Reusing complete local checks from source ${sourceHead} (base ${firstParent}, completed ${source.finishedAt}) `
    + `for unchanged integration tree ${context.tree} at ${context.head}.`);
  return inherited;
}
