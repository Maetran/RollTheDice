import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
const source = readFileSync(new URL('../frontend/hausdepp/surprise-art.js', import.meta.url), 'utf8');
let serial = 0;
const load = () => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${serial++}`);
function imageQueue(t) {
  const previous = globalThis.Image, requests = [];
  globalThis.Image = class {
    constructor() { requests.push(this); }
    decode() { return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
  };
  t.after(() => { if (previous === undefined) delete globalThis.Image; else globalThis.Image = previous; });
  return requests;
}
test('known subjects are decorative and never download all artwork during import', async t => {
  const requests = imageQueue(t), api = await load();
  for (const key of ['star','hammer','ufo','portal','dragon','kraken','clock','blackhole']) {
    const markup = api.premiumSurpriseArt(key);
    assert.match(markup, /alt="" aria-hidden="true" draggable="false"/);
    assert.doesNotMatch(markup, /<button|<a\s|onload=|onclick=|data-card|data-action/);
  }
  for (const value of ['mouse','__proto__','<script>',undefined]) assert.equal(api.premiumSurpriseArt(value), '');
  assert.equal(await api.warmSurpriseArt('https://other.example/evil'), false);
  assert.equal(requests.length, 0);
});
test('one clock warm waits for both real subjects and reuses their decode promises', async t => {
  const requests = imageQueue(t), api = await load();
  const first = api.warmSurpriseArt('clock');
  assert.equal(requests.length, 2);
  assert.strictEqual(api.warmSurpriseArt('clock'), first);
  let ready = false; first.then(() => { ready = true; });
  requests.find(img => img.src.includes('clock.')).resolve();
  await Promise.resolve(); await Promise.resolve(); assert.equal(ready, false);
  requests.find(img => img.src.includes('mouse.')).resolve();
  assert.equal(await first, true);
  assert.equal(requests.length, 2);
});
test('kraken prewarm includes its realistic reaching arm and handles a failed asset', async t => {
  const requests = imageQueue(t), api = await load();
  const ready = api.warmSurpriseArt('kraken');
  assert.equal(requests.length, 2);
  requests.find(img => img.src.includes('kraken.')).resolve();
  requests.find(img => img.src.includes('tentacle.')).reject(new Error('offline'));
  assert.equal(await ready, false);
  const recovered = api.warmSurpriseArt('kraken');
  assert.equal(requests.length, 4);
  requests[2].resolve(); requests[3].resolve();
  assert.equal(await recovered, true);
});
test('mobile artwork budget bounds optional downloads and ships local WebP only', () => {
  const dir = new URL('../app/static/table-surprises/', import.meta.url);
  const files = readdirSync(dir);
  assert.equal(files.length, 10);
  let total = 0;
  for (const name of files) {
    assert.ok(name.endsWith('.webp'));
    const file = new URL(name, dir), bytes = readFileSync(file);
    assert.equal(bytes.subarray(0,4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8,12).toString(), 'WEBP');
    const size = statSync(file).size; assert.ok(size < 750_000, `${name}: ${size}`); total += size;
  }
  assert.ok(total < 5_000_000, `total artwork ${total}`);
  assert.ok(statSync(new URL('kraken.webp',dir)).size + statSync(new URL('tentacle.webp',dir)).size < 1_000_000);
});
