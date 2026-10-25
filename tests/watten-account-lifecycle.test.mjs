import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../frontend/watten/account.js', import.meta.url), 'utf8');
const account = source.slice(source.indexOf("const root = document.getElementById('wattenAccount');"));
const navigation = (await readFile(new URL('../frontend/shared/account-navigation.js', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '').replace(/export function /g, 'function ');
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const auth = { authenticated: true, user: { id: 1, username: 'Viewer', preferences: { preferred_language: 'en' } },
  game_access: { watten_preview: true } };
class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  emit(type, extra = {}) { for (const callback of this.listeners.get(type) || []) callback({ type, ...extra }); }
}
class Node extends Events {
  innerHTML = ''; isConnected = true; elements = { language: {} }; children = new Map();
  querySelector(selector) {
    if (!this.children.has(selector)) this.children.set(selector, new Node());
    return this.children.get(selector);
  }
  replaceChildren() { this.innerHTML = ''; }
}
function fixture(loader) {
  const window = new Events(), document = new Events(), root = new Node(), mounts = [], current = [], destroyed = [], visits = [];
  let reads = 0;
  const location = { hash: '', search: '', assign: path => visits.push(path), reload: () => visits.push('reload') };
  window.location = location; window.ZDWA_I18N = { t: value => value };
  document.documentElement = { lang: 'en', dataset: { accountPage: 'settings' } };
  document.visibilityState = 'visible'; document.querySelector = () => null;
  document.getElementById = id => { assert.equal(id, 'wattenAccount'); return root; };
  const mount = (name, options) => {
    mounts.push(name);
    if (options?.isCurrent) current.push(options.isCurrent);
    return { destroy() { destroyed.push(name); } };
  };
  runInNewContext(`${navigation}\n${account}`, {
    window, document, location, URLSearchParams, encodeURIComponent,
    escapeHtml: value => String(value), esc: value => String(value), wattenAccountReturnPath: () => null,
    loadAuth: () => { reads += 1; return loader(); }, initializeAvatarFallbacks() {},
    initializeAppMode: () => mount('app-mode'), friendSettingsText: value => value, voicePreferenceText: value => value,
    mountUsernameSettings: () => mount('username'), mountTourSettings: () => mount('tours'),
    mountPasskeySettings: () => mount('passkeys'), mountEmailSettings: () => mount('email'),
    mountAvatarUpload: () => mount('avatar'), mountAccountVerification: () => ({}),
    mountAccountMergeNotice: (_, options) => mount('merge notice', options),
    mountVoicePreferences: (_, options) => mount('voice', options), mountFriendSettings: options => mount('friends', options),
    initializeReleaseNotes: () => mount('releases'),
  });
  return { window, document, root, mounts, current, destroyed, visits, reads: () => reads };
}

test('Watten actual account initialization cannot render or restart auth after beforeunload, focus and visibility', async () => {
  const reply = deferred(), f = fixture(() => reply.promise);
  assert.equal(f.reads(), 1);
  f.window.emit('beforeunload');
  f.window.emit('focus'); f.document.emit('visibilitychange');
  assert.equal(f.reads(), 1);
  reply.resolve(auth); await settle();
  assert.deepEqual(f.mounts, []);
  assert.equal(f.root.innerHTML, '');
  assert.deepEqual(f.visits, []);
});

test('Watten actual mounted account retires child proofs before pagehide and only reloads on a persisted restore', async () => {
  const f = fixture(() => Promise.resolve(auth));
  await settle();
  assert.ok(f.mounts.includes('friends'));
  assert.ok(f.mounts.includes('merge notice'));
  assert.equal(f.current.length, 3);
  assert.ok(f.current.every(isCurrent => isCurrent()));
  const verification = deferred(), followups = [];
  const pending = verification.promise.then(() => f.current.forEach((isCurrent, index) => {
    if (isCurrent()) followups.push(index);
  }));
  f.window.emit('beforeunload');
  assert.equal(f.root.innerHTML, '');
  assert.ok(f.current.every(isCurrent => !isCurrent()));
  assert.deepEqual(f.destroyed.sort(), ['friends', 'voice']);
  verification.resolve(); await pending;
  assert.deepEqual(followups, []);
  const reads = f.reads(), mounts = f.mounts.length;
  f.window.emit('focus'); f.document.emit('visibilitychange');
  f.window.emit('pageshow', { persisted: false }); await settle();
  assert.equal(f.reads(), reads); assert.equal(f.mounts.length, mounts);
  assert.deepEqual(f.visits, []);
  f.window.emit('pagehide', { persisted: true });
  f.window.emit('pageshow', { persisted: true }); await settle();
  assert.deepEqual(f.visits, ['reload']);
  assert.equal(f.reads(), reads);
  // A new document starts a new lifecycle and can mount its current viewer.
  const next = fixture(() => Promise.resolve(auth)); await settle();
  assert.ok(next.mounts.includes('friends'));
  assert.ok(next.current.every(isCurrent => isCurrent()));
});
