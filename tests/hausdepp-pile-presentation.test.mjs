import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../frontend/hausdepp/pile-presentation.js', import.meta.url), 'utf8');
const { createPilePresentation } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const state = (version, discard, burned_count = 0) => ({ version, discard, burned_count });

test('a public packet adds each paper only at its arrival and stays busy until the last', () => {
  const pile = createPilePresentation();
  pile.quiet(state(1, ['acorns-U']));
  const token = pile.accept(state(2, ['acorns-U', 'hearts-U', 'bells-U']), true);
  assert.deepEqual(pile.state, { discard: ['acorns-U'], burned_count: 0, pending: true });
  pile.arrive(token, 'hearts-U');
  assert.deepEqual(pile.state.discard, ['acorns-U', 'hearts-U']);
  assert.equal(pile.state.pending, true);
  pile.arrive(token, 'bells-U'); pile.finish(token);
  assert.deepEqual(pile.state, { discard: ['acorns-U', 'hearts-U', 'bells-U'], burned_count: 0, pending: false });
});

test('same-version UI renders and private refills cannot reveal an in-flight paper', () => {
  const pile = createPilePresentation();
  pile.quiet(state(1, ['acorns-U']));
  const token = pile.accept(state(2, ['acorns-U', 'hearts-U']), true);
  assert.equal(pile.accept(state(2, ['acorns-U', 'hearts-U']), true), null);
  pile.accept(state(3, ['acorns-U', 'hearts-U']));
  assert.deepEqual(pile.state.discard, ['acorns-U']);
  pile.arrive(token, 'hearts-U'); pile.finish(token);
  assert.deepEqual(pile.state.discard, ['acorns-U', 'hearts-U']);
});

test('a burn first receives the thrown card, then removes its papers and unlocks at the cleared stack', () => {
  const pile = createPilePresentation();
  pile.quiet(state(1, ['acorns-U']));
  const token = pile.accept(state(2, [], 2), true);
  pile.arrive(token, 'hearts-10');
  assert.deepEqual(pile.state.discard, ['acorns-U', 'hearts-10']);
  pile.depart(token, 'acorns-U'); pile.depart(token, 'hearts-10');
  assert.deepEqual(pile.state, { discard: [], burned_count: 0, pending: true });
  pile.finish(token);
  assert.deepEqual(pile.state, { discard: [], burned_count: 2, pending: false });
});

test('a queued pickup and next throw keep their independent arrivals and current accepted ending', () => {
  const pile = createPilePresentation();
  pile.quiet(state(1, ['acorns-U']));
  const pickup = pile.accept(state(2, []), true);
  const play = pile.accept(state(3, ['bells-O']), true);
  pile.depart(pickup, 'acorns-U'); pile.finish(pickup);
  assert.deepEqual(pile.state, { discard: [], burned_count: 0, pending: true });
  pile.arrive(play, 'bells-O'); pile.finish(play);
  assert.deepEqual(pile.state, { discard: ['bells-O'], burned_count: 0, pending: false });
});

test('cancel, skipped versions and quiet hydration invalidate every old arrival token', () => {
  const pile = createPilePresentation();
  pile.quiet(state(1, ['acorns-U']));
  const stale = pile.accept(state(2, ['acorns-U', 'hearts-U']), true);
  pile.quiet(state(5, ['bells-A'], 8));
  assert.equal(pile.arrive(stale, 'hearts-U'), false);
  assert.equal(pile.depart(stale, 'bells-A'), false);
  assert.equal(pile.finish(stale), false);
  assert.deepEqual(pile.state, { discard: ['bells-A'], burned_count: 8, pending: false });
});
