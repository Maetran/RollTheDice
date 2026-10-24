import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const source = await readFile(new URL('../frontend/shared/tavern-shuffle.js', import.meta.url), 'utf8');
const { createTavernShuffle } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const families = [
  { id: 'cambridge', details: true, variants: Array.from({ length: 10 }, (_, index) => ({ id: `old-${index}` })) },
  ...['cafe', 'pub', 'restaurant'].map(id => ({ id, details: false, variants: [{ id }] })),
];
const memory = () => { let value = null; return { getItem: () => value, setItem(key, next) { value = next; } }; };

test('original recordings have equal bag weight even when Cambridge has ten variants', () => {
  const shuffle = createTavernShuffle({ families, random: () => .99, storage: memory() });
  const draws = Array.from({ length: 80 }, () => shuffle.next());
  for (let index = 0; index < draws.length; index += families.length) {
    assert.deepEqual(new Set(draws.slice(index, index + families.length).map(clip => clip.familyId)),
      new Set(families.map(family => family.id)));
  }
  for (let index = 1; index < draws.length; index++) assert.notEqual(draws[index].familyId, draws[index - 1].familyId);
  const old = draws.filter(clip => clip.familyId === 'cambridge');
  assert.equal(new Set(old.slice(0, 10).map(clip => clip.id)).size, 10);
  assert.equal(new Set(old.slice(10, 20).map(clip => clip.id)).size, 10);
  assert.notEqual(old[9].id, old[10].id);
  assert.ok(old.every(clip => clip.details));
  assert.ok(draws.filter(clip => clip.familyId !== 'cambridge').every(clip => !clip.details));
});

test('bag state survives reload per origin and never persists enabled sound or account state', () => {
  const storage = memory(), draws = [];
  for (let index = 0; index < 40; index++) draws.push(createTavernShuffle({ families, random: () => 0, storage }).next());
  for (let index = 1; index < draws.length; index++) assert.notEqual(draws[index].familyId, draws[index - 1].familyId);
  const saved = JSON.parse(storage.getItem());
  assert.deepEqual(Object.keys(saved).sort(), ['lastFamily', 'lastVariants', 'remaining', 'variants']);
  assert.equal(new Set(draws.filter(clip => clip.familyId === 'cambridge').map(clip => clip.id)).size, 10);
  const otherOrigin = createTavernShuffle({ families, random: () => 0, storage: memory() });
  assert.equal(otherOrigin.next().id, draws[0].id);
});

test('a single family retains the ten old variants without consecutive repeats across bag boundaries', () => {
  const shuffle = createTavernShuffle({ families: families.slice(0, 1), random: () => 0, storage: memory() });
  const ids = Array.from({ length: 21 }, () => shuffle.next().id);
  assert.equal(new Set(ids.slice(0, 10)).size, 10);
  assert.notEqual(ids[9], ids[10]); assert.notEqual(ids[19], ids[20]);
});

test('unavailable storage and invalid catalog remnants fall back to valid in-memory bags', () => {
  for (const value of ['null', '[]', '{broken', JSON.stringify({ remaining: ['removed', 'pub', 'pub'],
    variants: { pub: ['removed'], cambridge: ['old-0', 'old-0'] }, lastFamily: 'removed' })]) {
    const storage = { getItem: () => value, setItem() { throw new Error('blocked'); } };
    const shuffle = createTavernShuffle({ families, random: () => 0, storage });
    const clips = Array.from({ length: 12 }, () => shuffle.next());
    assert.ok(clips.every(clip => clip.id && families.some(family => family.id === clip.familyId)));
  }
  const shuffle = createTavernShuffle({ families, storage: { getItem() { throw new Error('denied'); }, setItem() {} } });
  assert.ok(shuffle.next().id);
});
