import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/hausdepp/cards.js', import.meta.url), 'utf8');
let sequence = 0;
const load = () => import(`data:text/javascript;base64,${Buffer.from(source + `\n// fixture ${sequence++}`).toString('base64')}`);
const pathname = url => new URL(url, 'https://hausdepp.zockdiewandan.online').pathname;

test('all 36 lobby cells use the same full-deck geometry and retain the full atlas by default', async () => {
  const cards = await load();
  const deck = Object.keys(cards.CARD_CORNERS);
  assert.equal(deck.length, 36);
  for (const [index, card] of deck.entries()) {
    const full = cards.cardArt(card);
    const lobby = cards.cardArt(card, cards.LOBBY_CARD_ASSET_URL);
    const normalize = markup => markup.replaceAll(/hd-card-paper-\d+/g, 'hd-card-paper');
    assert.equal(normalize(lobby), normalize(full.replace(cards.CARD_ASSET_URLS[0], cards.LOBBY_CARD_ASSET_URL)), card);
    assert.match(full, /href="\/static\/hausdepp\/cards-atlas\.webp\?/);
    assert.match(lobby, /href="\/static\/hausdepp\/cards-lobby-atlas\.webp\?/);
    assert.match(lobby, new RegExp(`width="3240" height="2280" x="${-(index % 9) * 360}" y="${-Math.floor(index / 9) * 570}"`));
  }
});

test('lobby decoding never warms table images; table decoding remains separate', async t => {
  const originalImage = globalThis.Image;
  t.after(() => { globalThis.Image = originalImage; });
  const images = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    decode() { return Promise.resolve(); }
  };
  const cards = await load();
  await cards.prepareLobbyCardAssets();
  await cards.prepareLobbyCardAssets();
  assert.deepEqual(images.map(image => pathname(image.src)), ['/static/hausdepp/cards-lobby-atlas.webp']);
  assert.equal(images[0].decoding, 'sync');
  await cards.prepareCardAssets();
  assert.deepEqual(images.slice(1).map(image => pathname(image.src)),
    ['/static/hausdepp/cards-atlas.webp', '/static/hausdepp/card-back.webp']);
});

test('failed lobby decoding can retry the small face atlas without loading the private deck', async t => {
  const originalImage = globalThis.Image;
  t.after(() => { globalThis.Image = originalImage; });
  const images = [];
  globalThis.Image = class {
    constructor() { images.push(this); }
    decode() { return images.length === 1 ? Promise.reject(new Error('image unavailable')) : Promise.resolve(); }
  };
  const cards = await load();
  await assert.rejects(cards.prepareLobbyCardAssets(), /image unavailable/);
  await cards.prepareLobbyCardAssets();
  assert.deepEqual(images.map(image => pathname(image.src)),
    ['/static/hausdepp/cards-lobby-atlas.webp', '/static/hausdepp/cards-lobby-atlas.webp']);
});
