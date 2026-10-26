import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const sources = Object.fromEntries(await Promise.all(['player-allowlist', 'friend-activity'].map(async name => [name,
  (await readFile(new URL(`../frontend/shared/${name}.js`, import.meta.url), 'utf8'))
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '')])));
const settle = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve(); };
class Events {
  listeners = new Map();
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) { return Promise.all([...this.listeners.get(event.type) || []].map(callback => callback(event))); }
  emit(type, detail) { return this.dispatchEvent({ type, detail, preventDefault() {} }); }
}
function fixture(kind) {
  const window = new Events(), requests = [], writes = [];
  class Element extends Events {
    isConnected = true; dataset = {}; children = []; classList = { add() {} };
    set textContent(value) { writes.push(String(value)); }
    setAttribute() {}
    append(...children) { this.children.push(...children); writes.push('append'); }
    replaceChildren(...children) { this.children = children; writes.push('replace'); }
    querySelectorAll() { return []; }
  }
  const mount = new Element();
  window.ZDWA_I18N = { t: value => value };
  const functions = runInNewContext(`${sources[kind === 'friend' ? 'friend-activity' : 'player-allowlist']}\n({ ${kind === 'friend' ? 'mountFriendActivitySettings' : 'mountAllowlistSettings, mountProfileAllowlist'} });`, {
    window, document: { createElement: () => new Element() }, AbortSignal,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    apiFetch(path, options) { let resolve; const promise = new Promise(yes => { resolve = yes; }); requests.push({ path, options, resolve }); return promise; },
    zilchPath: path => `/zilch${path}`, zdwaPath: path => path,
  });
  const mountAgain = () => kind === 'friend' ? functions.mountFriendActivitySettings(mount)
    : kind === 'profile' ? functions.mountProfileAllowlist(mount, { userId: 9, context: 'zilch' })
      : functions.mountAllowlistSettings(mount, { context: 'zilch' });
  const reply = async (index, viewerId) => {
    requests[index].resolve({ ok: true, json: async () => kind === 'friend'
      ? { viewer_id: viewerId, enabled: true } : { viewer_id: viewerId, audience: 'all', limit: 100, players: [] } });
    await settle();
  };
  const auth = id => window.emit('zdwa:auth-state', { authenticated: true, user: { id } });
  mountAgain();
  return { window, mount, requests, writes, reply, auth, mountAgain, submit: () => mount.children[0].emit('submit') };
}

for (const kind of ['settings', 'profile', 'friend']) {
  test(`${kind}: a late auth event after mount removal cannot start another read or restore detached controls`, async () => {
    const f = fixture(kind);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].path, kind === 'friend' ? '/api/friend-activity/preferences' : '/api/web-push/allowlist');
    // Real WebKit sequence: account retirement removes the widget while an
    // older /me response still publishes its auth event to existing listeners.
    f.mount.isConnected = false;
    f.auth(1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.window.listeners.get('zdwa:auth-state').size, 0);
    const writes = f.writes.length;
    await f.reply(0, 1);
    assert.equal(f.writes.length, writes);
    f.auth(2);
    assert.equal(f.requests.length, 1);
  });

  test(`${kind}: connected public controls keep auth refresh across page lifecycle events and reject older read results`, async () => {
    const f = fixture(kind);
    await f.reply(0, 1);
    f.auth(1); assert.equal(f.requests.length, 1);
    f.window.emit('beforeunload'); f.window.emit('pagehide'); f.window.emit('pageshow');
    f.auth(2); assert.equal(f.requests.length, 2);
    f.auth(3); assert.equal(f.requests.length, 3);
    await f.reply(2, 3);
    const writes = f.writes.length;
    await f.reply(1, 2);
    assert.equal(f.writes.length, writes);
    f.auth(3); assert.equal(f.requests.length, 3);
  });
}

test('friend settings can remount the same node without an old completion retiring its new owner', async () => {
  const f = fixture('friend');
  f.mount.isConnected = false; f.auth(1);
  assert.equal(f.window.listeners.get('zdwa:auth-state').size, 0);
  assert.equal(f.mount.dataset.friendActivityBound, undefined);
  f.mount.isConnected = true; f.mountAgain();
  assert.equal(f.requests.length, 2);
  assert.equal(f.mount.dataset.friendActivityBound, 'true');
  await f.reply(0, 1);
  assert.equal(f.mount.dataset.friendActivityBound, 'true');
  await f.reply(1, 2);
  f.auth(2); assert.equal(f.requests.length, 2);
});

test('friend settings preserve a connected save and discard its older completion after another viewer is projected', async () => {
  const f = fixture('friend'), preferences = [];
  f.window.addEventListener('zdwa:friend-activity-preference', event => preferences.push(event.detail.enabled));
  await f.reply(0, 1);
  const saved = f.submit();
  assert.deepEqual(JSON.parse(f.requests[1].options.body), { viewer_id: 1, enabled: true });
  await f.reply(1, 1); await saved;
  assert.deepEqual(preferences, [true]);
  const oldSave = f.submit();
  assert.equal(f.requests[2].options.method, 'PUT');
  f.auth(2); await f.reply(3, 2);
  const writes = f.writes.length;
  await f.reply(2, 1); await oldSave;
  assert.equal(f.writes.length, writes);
  assert.deepEqual(preferences, [true]);
  f.auth(2); assert.equal(f.requests.length, 4);
});
