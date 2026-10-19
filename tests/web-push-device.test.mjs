import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../frontend/shared/web-push.js', import.meta.url), 'utf8'))
  .replace(/^import .* from ['"]\.\/auth\.js['"];\s*/m, '')
  .replace(/export (?=(?:async )?function )/g, '');
const origin = 'https://hausdepp.zockdiewandan.online';
const endpoint = 'https://fcm.googleapis.com/fcm/send/private-device-fixture';
const snapshot = (keys = {}) => ({ endpoint, keys: { p256dh: 'current-public-key', auth: 'current-auth-key', ...keys } });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(condition) {
  for (let count = 0; count < 40 && !condition(); count += 1) await tick();
  assert.ok(condition(), 'expected asynchronous boundary was not reached');
}

// Run the real shared module in a separate browser-shaped context for each test.
// Only the transport, permission sheet and worker APIs are doubles; nothing here
// contacts a real Push service or changes an actual account/device subscription.
function fixture({ subscribed = true, local = snapshot(), checked = true,
  worker = '/hausdepp-sw.js', scope = '/hausdepp', manifest = 'hausdepp', permission = 'granted',
  statusHook, checkHook, localHook, initialAccount } = {}) {
  const calls = [], events = new Map(), registrationReads = [];
  const counts = { subscribe: 0, unsubscribe: 0, permission: 0, local: 0 };
  let currentLocal = local;
  const subscription = () => currentLocal && { toJSON: () => structuredClone(currentLocal),
    unsubscribe: async () => { counts.unsubscribe += 1; currentLocal = null; return true; } };
  const registration = {
    scope: new URL(scope, origin).href,
    active: worker ? { scriptURL: new URL(worker, origin).href, state: 'activated' } : null,
    pushManager: {
      getSubscription: async () => { counts.local += 1; if (localHook) await localHook(); return subscription(); },
      subscribe: async () => { counts.subscribe += 1; currentLocal = snapshot(); return subscription(); },
    },
  };
  const win = {
    isSecureContext: true, PushManager: class {}, Notification: {}, HAUSDEPP_PWA: manifest === 'hausdepp' ? {} : undefined,
    setTimeout, clearTimeout,
    addEventListener: (type, callback) => {
      if (!events.has(type)) events.set(type, new Set());
      events.get(type).add(callback);
    },
  };
  if (initialAccount !== undefined) win[Symbol.for('rollthedice.auth-state')] = {
    cache: { authenticated: initialAccount !== null, user: initialAccount === null ? null : { id: initialAccount } },
  };
  const Notification = { permission,
    requestPermission: async () => { counts.permission += 1; Notification.permission = 'granted'; return 'granted'; } };
  const apiFetch = async (url, options = {}) => {
    const call = { url, method: options.method || 'GET', options,
      body: options.body ? JSON.parse(options.body) : undefined };
    calls.push(call);
    if (url === '/api/web-push/subscription' && call.method === 'GET') {
      if (statusHook) return statusHook(call);
      return response({ viewer_id: 1, available: true, subscribed, public_key: 'BA' + 'A'.repeat(85),
        game_invites_enabled: true, daily_reminder_enabled: false, release_notifications_enabled: false });
    }
    if (url === '/api/web-push/subscription/check') return checkHook ? checkHook(call) : response({ device_subscribed: checked });
    if (url === '/api/web-push/subscription' && call.method === 'PUT') return response({ viewer_id: 1, subscribed: true });
    assert.fail(`unexpected transport ${call.method} ${url}`);
  };
  const context = vm.createContext({ apiFetch, URL, Uint8Array, atob, console, window: win, Notification,
    document: { querySelector: () => ({ dataset: { pwaProduct: manifest }, href: `${origin}/${manifest === 'zdwa' ? '' : `${manifest}-`}manifest.webmanifest` }) },
    location: { origin, href: `${origin}/hausdepp/konto/einstellungen`, hostname: new URL(origin).hostname, pathname: '/hausdepp/konto/einstellungen' },
    navigator: { serviceWorker: {
      getRegistration: async path => { registrationReads.push(path); return registration; },
      get ready() {
        if (manifest === 'hausdepp') assert.fail('narrow Hausdepp settings must not wait for a controlling-page worker');
        return Promise.resolve(registration);
      },
    } },
  });
  vm.runInContext(`${source}\nglobalThis.pushModule = { getGameInvitePushStatus, enableGameInvitePush };`, context);
  return { ...context.pushModule, calls, counts, registration, registrationReads,
    auth(userId) { for (const fn of events.get('zdwa:auth-state') || []) fn({ detail: { authenticated: userId !== null,
      user: userId === null ? null : { id: userId } } }); },
    checks: () => calls.filter(call => call.url.endsWith('/check')),
    writes: () => calls.filter(call => call.method === 'PUT' || call.method === 'DELETE'),
  };
}

test('another account device does not make the current Hausdepp device subscribed', async () => {
  const f = fixture({ subscribed: true, local: null });
  const status = await f.getGameInvitePushStatus();
  assert.equal(status.subscribed, true);
  assert.equal(status.device_subscribed, false);
  assert.equal(f.checks().length, 0);
  assert.equal(f.counts.subscribe, 0);
  assert.equal(f.counts.permission, 0);
  assert.deepEqual(f.writes(), []);
});

test('a local subscription is checked with full keys, actual product and captured account without registering it', async () => {
  const f = fixture();
  const status = await f.getGameInvitePushStatus();
  assert.equal(status.device_subscribed, true);
  assert.equal(f.checks().length, 1);
  const [call] = f.checks();
  assert.equal(call.method, 'POST');
  assert.deepEqual(call.body, { ...snapshot(), product_context: 'hausdepp' });
  assert.equal(new Headers(call.options.headers).get('X-Push-Expected-Account-Id'), '1');
  assert.equal(call.url, '/api/web-push/subscription/check', 'capability data never enters a URL');
  assert.deepEqual(f.writes(), []);
  assert.equal(f.counts.subscribe, 0);
  assert.equal(f.counts.permission, 0);
});

test('a stale or other-account endpoint stays visibly unregistered and is repaired only on explicit enable', async () => {
  const changedKeys = snapshot({ p256dh: 'rotated-public-key', auth: 'rotated-auth-key' });
  const f = fixture({ local: changedKeys, checked: false });
  assert.equal((await f.getGameInvitePushStatus()).device_subscribed, false);
  assert.deepEqual(f.checks()[0].body, { ...changedKeys, product_context: 'hausdepp' });
  assert.deepEqual(f.writes(), []);
  await f.enableGameInvitePush();
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.writes()[0].body, { ...changedKeys, product_context: 'hausdepp' });
  assert.equal(new Headers(f.writes()[0].options.headers).get('X-Push-Expected-Account-Id'), '1');
  assert.equal(f.counts.subscribe, 0, 'an existing local subscription does not need a new endpoint');
});

test('Hausdepp never checks or subscribes an unrelated active worker or an invalid scope', async () => {
  for (const options of [
    { worker: '/sw.js', scope: '/' },
    { worker: '/zilch-sw.js', scope: '/hausdepp' },
    { worker: '/hausdepp-sw.js', scope: '/' },
    { worker: 'https://foreign.test/hausdepp-sw.js', scope: '/hausdepp' },
  ]) {
    const f = fixture(options);
    // A pending Hausdepp update does not make the active wrong worker safe.
    f.registration.waiting = { scriptURL: `${origin}/hausdepp-sw.js`, state: 'installed' };
    const status = await f.getGameInvitePushStatus();
    assert.equal(status.device_subscribed, false, JSON.stringify(options));
    assert.equal(f.counts.local, 0);
    assert.equal(f.counts.subscribe, 0);
    assert.equal(f.checks().length, 0);
    assert.deepEqual(f.writes(), []);
  }
});

test('known ZDWA and Zilch workers supply their own explicit product rather than a page guess', async () => {
  for (const product of ['zdwa', 'zilch']) {
    const f = fixture({ manifest: product, worker: product === 'zdwa' ? '/sw.js' : '/zilch-sw.js', scope: '/' });
    assert.equal((await f.getGameInvitePushStatus()).device_subscribed, true);
    assert.equal(f.checks()[0].body.product_context, product);
    await f.enableGameInvitePush();
    assert.equal(f.writes()[0].body.product_context, product);
  }
});

test('switching account while local subscription is being read discards the status before checking the endpoint', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ localHook: () => gate });
  f.auth(1);
  const pending = f.getGameInvitePushStatus();
  await until(() => f.counts.local === 1);
  f.auth(2);
  release();
  await assert.rejects(pending);
  assert.equal(f.checks().length, 0);
  assert.deepEqual(f.writes(), []);
  await assert.rejects(f.enableGameInvitePush());
  assert.deepEqual(f.writes(), []);
});

test('an account switch during the server check cannot revive readiness from the old account', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ checkHook: () => ({ ok: true, json: async () => { await gate; return { device_subscribed: true }; } }) });
  f.auth(1);
  const pending = f.getGameInvitePushStatus();
  await until(() => f.checks().length === 1);
  f.auth(2);
  release();
  await assert.rejects(pending);
  await assert.rejects(f.enableGameInvitePush());
  assert.deepEqual(f.writes(), []);
});

test('an explicit enable captures its initiating account through asynchronous worker operations', async () => {
  let release, pause = false;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ checked: false, localHook: () => pause ? gate : undefined });
  f.auth(1);
  await f.getGameInvitePushStatus();
  pause = true;
  const pending = f.enableGameInvitePush();
  await until(() => f.counts.local === 2);
  f.auth(2);
  release();
  await assert.rejects(pending);
  assert.deepEqual(f.writes(), []);
  assert.equal(f.counts.subscribe, 0);
});

for (const initialAccount of [undefined, 1]) {
  test(`initial auth hydration of the same account is not a switch (cached=${initialAccount !== undefined})`, async () => {
    let finish;
    const gate = new Promise(resolve => { finish = resolve; });
    const f = fixture({ initialAccount, local: null, statusHook: async () => {
      await gate;
      return response({ viewer_id: 1, available: false, subscribed: true });
    } });
    const pending = f.getGameInvitePushStatus();
    await until(() => f.calls.length === 1);
    f.auth(1);
    finish();
    const status = await pending;
    assert.equal(status.viewer_id, 1);
    assert.equal(status.available, false);
    assert.deepEqual(f.writes(), []);
  });
}

test('a different first auth identity cannot apply an older response while identity was unknown', async () => {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const f = fixture({ local: null, statusHook: async () => {
    await gate;
    return response({ viewer_id: 1, available: true, subscribed: true });
  } });
  const pending = f.getGameInvitePushStatus();
  await until(() => f.calls.length === 1);
  f.auth(2);
  finish();
  await assert.rejects(pending, error => error.code === 'web_push_account_changed');
  assert.deepEqual(f.writes(), []);
});
