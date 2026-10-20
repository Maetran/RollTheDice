import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../app/static/watten-sw.js', import.meta.url), 'utf8');
const origin = 'https://local.watten.localhost:8127';
const table = '/watten/spiel/0123456789abcdef';
const icon = '/static/watten/icons/watten-icon-192.png';
const payload = (extra = {}) => ({ title: 'Watten: Grüezi <Anna> & Bob', body: 'Eine Runde? A round? 🎉',
  tag: 'game-invite-watten-0123456789abcdef', url: table, icon, badge: icon, ...extra });

function fixture({ permission = 'granted', windows = [] } = {}) {
  const handlers = new Map(), shown = [], opened = [], fetches = [], clientQueries = [];
  let skipped = 0, claimed = 0;
  const self = { location: { origin }, Notification: { permission },
    addEventListener: (name, handler) => handlers.set(name, handler),
    skipWaiting: () => { skipped += 1; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); } },
    clients: { claim: async () => { claimed += 1; },
      matchAll: async query => { clientQueries.push(query); return windows; },
      openWindow: async url => { opened.push(url); } } };
  const context = vm.createContext({ self, URL, Response, fetch: async (...args) => { fetches.push(args); return new Response('online'); },
    caches: new Proxy({}, { get() { assert.fail('Worker must never access Cache Storage'); } }) });
  vm.runInContext(source, context, { filename: 'watten-sw.js' });
  async function dispatch(name, event = {}) {
    const pending = [];
    handlers.get(name)({ ...event, waitUntil(value) { assert.equal(typeof value?.then, 'function'); pending.push(value); } });
    await Promise.all(pending);
    return pending.length;
  }
  return { self, context, shown, opened, fetches, clientQueries, dispatch,
    push: value => dispatch('push', { data: { json: () => value } }),
    async click(data, extra = {}) {
      let closed = 0;
      const count = await dispatch('notificationclick', { notification: { data, close() { closed += 1; } }, ...extra });
      assert.equal(closed, 1); assert.equal(count, 1);
    },
    async request(url, extra = {}) {
      let response;
      await dispatch('fetch', { request: { url, method: 'GET', mode: 'navigate', ...extra },
        respondWith(value) { assert.equal(response, undefined); response = value; } });
      return response;
    },
    lifecycle: () => ({ skipped, claimed }) };
}

test('actual push handler shows bounded literal DE/EN text, fixed Watten artwork and only a private relative path', async () => {
  const f = fixture();
  assert.equal(await f.push(payload()), 1);
  assert.equal(f.shown.length, 1);
  assert.equal(f.shown[0].title, payload().title);
  assert.equal(f.shown[0].options.body, payload().body);
  assert.deepEqual(JSON.parse(JSON.stringify(f.shown[0].options)), {
    body: payload().body, tag: payload().tag, icon, badge: icon, renotify: false, data: { url: table },
  });
  assert.deepEqual(f.opened, []); assert.deepEqual(f.fetches, []);
});

test('permission denied, default, unavailable or browser show rejection never prompts or displays fallback', async () => {
  for (const permission of ['default', 'denied', undefined]) {
    const f = fixture(); f.self.Notification.permission = permission;
    await f.push(payload()); assert.equal(f.shown.length, 0);
  }
  const missing = fixture(); delete missing.self.Notification;
  await missing.push(payload()); assert.equal(missing.shown.length, 0);
  const rejecting = fixture(); let attempts = 0;
  rejecting.self.registration.showNotification = async () => { attempts += 1; throw Error('permission revoked'); };
  assert.equal(await rejecting.push(payload()), 1); assert.equal(attempts, 1); assert.deepEqual(rejecting.opened, []);
});

test('invalid payloads are discarded atomically including hidden fields, oversized text and non-plain controls', async () => {
  const f = fixture();
  for (const value of [undefined, null, false, [], 'Watten', {}, payload({ title: '' }), payload({ title: ' ' }),
    payload({ title: 'a'.repeat(101) }), payload({ body: 'a'.repeat(401) }), payload({ body: null }),
    payload({ title: 'Hello\nworld' }), payload({ body: '\u202esecret' }), payload({ body: 'x\u0000y' }),
    payload({ tag: '' }), payload({ tag: 'a'.repeat(129) }), payload({ tag: 'tag with space' }),
    payload({ tag: '<b>html</b>' }), payload({ icon: 'https://evil.test/pixel' }), payload({ badge: '/static/icons/icon-192.png' }),
    payload({ hand: ['secret-card'] }), payload({ account_id: 42 }), payload({ url: undefined })]) await f.push(value);
  await f.dispatch('push', {});
  await f.dispatch('push', { data: { json() { throw Error('bad JSON'); } } });
  assert.equal(f.shown.length, 0); assert.deepEqual(f.opened, []);
  await f.push(payload({ title: 'a'.repeat(100), body: 'b'.repeat(400), tag: 't'.repeat(128) }));
  assert.equal(f.shown.length, 1);
});

const badTargets = [
  'https://evil.test/watten', `${origin}.evil.test${table}`, `https://local.watten.localhost:8128${table}`,
  `http://local.watten.localhost:8127${table}`, `//local.watten.localhost:8127${table}`, 'javascript:alert(1)', 'data:text/html,hello',
  '/hausdepp', '/zilch', '/', '/wattenish', '/watten/account', '/watten/konto', '/watten/api/games', '/watten/',
  `${table}?pass=secret`, `${table}?token=secret`, `${table}#secret`, `${table}?`, `${table}#`,
  '/watten/spiel/0123456789abcdeg', '/watten/spiel/0123456789ABCDEF', `${table}/`, `${table}/../0123456789abcdef`,
  '/other/../watten', '/%77atten', '/watten%2fspiel%2f0123456789abcdef', `\\local.watten.localhost:8127${table}`,
  `https://user:secret@local.watten.localhost:8127${table}`, ` ${table}`, `${table}\n`, '', null, 1,
];

test('push and notificationclick independently reject foreign, lookalike, encoded and secret-bearing targets without fallback', async () => {
  const f = fixture();
  for (const url of badTargets) { await f.push(payload({ url })); await f.click({ url }); }
  assert.equal(f.shown.length, 0); assert.deepEqual(f.opened, []); assert.deepEqual(f.clientQueries, []);
});

test('canonical lobby, table and spectator destinations work on relative or exact same-origin links', async () => {
  for (const path of ['/watten', table, `${table}/zuschauen`]) {
    for (const url of [path, `${origin}${path}`]) {
      const f = fixture(); await f.push(payload({ url }));
      assert.equal(f.shown[0].options.data.url, path);
      await f.click(f.shown[0].options.data);
      assert.deepEqual(f.opened, [`${origin}${path}`]);
    }
  }
});

test('click focuses only the exact permitted Watten window and never navigates another product or running table', async () => {
  const focused = [], navigated = [];
  const client = url => ({ url, async focus() { focused.push(url); }, async navigate(value) { navigated.push(value); } });
  const other = [client(`${origin}/hausdepp/spiel/0123456789abcdef`), client(`${origin}/zilch`),
    client(`${origin}/watten/spiel/ffffffffffffffff`), client(`https://evil.test${table}`), client(`${origin}${table}?token=private`)];
  const exact = client(`${origin}${table}`);
  const f = fixture({ windows: [...other, exact] });
  await f.click({ url: table });
  assert.deepEqual(focused, [exact.url]); assert.deepEqual(navigated, []); assert.deepEqual(f.opened, []);
  assert.deepEqual(JSON.parse(JSON.stringify(f.clientQueries)), [{ type: 'window', includeUncontrolled: true }]);
  const separate = fixture({ windows: other }); await separate.click({ url: table });
  assert.deepEqual(separate.opened, [`${origin}${table}`]); assert.deepEqual(navigated, []);
  assert.deepEqual(focused, [exact.url]);
});

test('invalid click data, unsupported action and rejected client operations never open a fallback', async () => {
  const f = fixture();
  for (const data of [undefined, null, [], {}, { url: table, account_id: 1 }, { url: table, pass: 'secret' }]) await f.click(data);
  await f.click({ url: table }, { action: 'unknown' });
  assert.deepEqual(f.opened, []); assert.deepEqual(f.clientQueries, []);
  f.self.clients.matchAll = async () => { throw Error('client lookup rejected'); };
  await f.click({ url: table }); assert.deepEqual(f.opened, []);
  const focusFailure = fixture({ windows: [{ url: `${origin}${table}`, async focus() { throw Error('focus rejected'); } }] });
  await focusFailure.click({ url: table }); assert.deepEqual(focusFailure.opened, []);
  const openFailure = fixture(); let attempts = 0;
  openFailure.self.clients.openWindow = async () => { attempts += 1; throw Error('open rejected'); };
  await openFailure.click({ url: table }); assert.equal(attempts, 1);
});

test('waiting lifecycle and claim remain unchanged and no operation uses Cache Storage', async () => {
  const f = fixture();
  await f.dispatch('message', { data: { type: 'OTHER' } });
  await f.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  assert.equal(await f.dispatch('activate'), 1);
  assert.deepEqual(f.lifecycle(), { skipped: 1, claimed: 1 });
  await f.push(payload()); await f.click({ url: table });
  assert.deepEqual(f.fetches, []);
});

test('native navigation stays network-only with no-store and a truthful private-free offline503', async () => {
  const f = fixture();
  const online = await f.request(`${origin}${table}`);
  assert.equal(await online.text(), 'online'); assert.equal(f.fetches[0][1].cache, 'no-store');
  f.context.fetch = async () => { throw Error('offline'); };
  const offline = await f.request(`${origin}/watten/konto`);
  assert.equal(offline.status, 503); assert.equal(offline.headers.get('cache-control'), 'no-store');
  assert.equal(offline.headers.get('x-robots-tag'), 'noindex, nofollow');
  const body = await offline.text();
  assert.match(body, /Karten und Kontodaten werden nicht offline gespeichert/); assert.match(body, /cards and account data are never stored/);
  assert.doesNotMatch(body, /secret-card|account_id|0123456789abcdef/);
});

test('cross-origin fetch stays untouched and API, asset and other-product failure never receives a Watten shell', async () => {
  const f = fixture();
  assert.equal(await f.request(`https://evil.test${table}`), undefined); assert.deepEqual(f.fetches, []);
  f.context.fetch = async () => { throw Error('offline'); };
  for (const [path, extra] of [['/api/watten/account', { mode: 'cors' }], ['/static/watten/account.js', { mode: 'cors' }],
    ['/hausdepp', {}], ['/zilch', {}], [table, { method: 'POST' }]]) {
    await assert.rejects(f.request(`${origin}${path}`, extra), /offline/);
  }
});
