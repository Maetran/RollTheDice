import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../frontend/shared/game-tours.js', import.meta.url), 'utf8');
const catalog = await readFile(new URL('../frontend/i18n/catalog.js', import.meta.url), 'utf8');
const messages = runInNewContext(`${catalog.replace(/^export const /gm, 'const ')}\nGAME_TOUR_MESSAGES;`);
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const auth = (id, access = {}) => ({ authenticated: id !== null, user: id === null ? null : { id, csrf_token: `csrf-${id}` }, game_access: access });
class Events {
  listeners = new Map();
  addEventListener(name, callback) { this.listeners.set(name, [...this.listeners.get(name) || [], callback]); }
  emit(name, detail) { for (const callback of this.listeners.get(name) || []) callback({ detail }); }
}
class Row {
  dataset = {};
  set innerHTML(value) {
    this.html = value;
    this.buttons = ['start', 'view'].map(action => ({ dataset: { tourAction: action, tourGame: this.dataset.tourSettingsGame }, closest() { return this; } }));
  }
  remove() { this.parent.rows.splice(this.parent.rows.indexOf(this), 1); }
}
class Container extends Events {
  isConnected = true;
  writes = 0;
  open = true;
  set innerHTML(value) {
    this.writes++;
    this.html = value;
    this.toggle = { checked: true, disabled: false };
    this.status = { textContent: '' };
    this.list = { rows: [], querySelector(selector) { return this.rows.find(row => selector.includes(`"${row.dataset.tourSettingsGame}"`)); }, append(row) { row.parent = this; this.rows.push(row); } };
    // Also model the pre-fix initial markup for the external red/green probe.
    for (const game of new Set([...value.matchAll(/data-tour-game="(\w+)"/g)].map(match => match[1]))) {
      const row = new Row(); row.dataset.tourSettingsGame = game; row.innerHTML = ''; this.list.append(row);
    }
  }
  querySelector(selector) {
    if (selector === '[data-tour-enabled]') return this.toggle;
    if (selector === '[data-tour-settings-status]' || selector === "[role='status']") return this.status;
    if (selector === '[data-tour-settings-games]' && this.html.includes('data-tour-settings-games')) return this.list;
    return null;
  }
  click(button) { for (const callback of this.listeners.get('click') || []) callback({ target: button }); }
  games() { return this.list.rows.map(row => row.dataset.tourSettingsGame); }
}
function fixture({ game = 'zdwa', language = 'de', initialAuth, holdAuth = false, holdPreferences = false } = {}) {
  const window = new Events(), container = new Container(), visits = [], requests = [], authGate = deferred(), waiters = new Map();
  const storage = () => { const values = new Map(); return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }; };
  let current = initialAuth || auth(1);
  const location = { href: 'https://example.test/konto', assign: url => visits.push(url) };
  window.ZDWA_I18N = { getLanguage: () => language }; window.location = location;
  const document = { documentElement: { dataset: { game } }, createElement: () => new Row(), activeElement: null };
  const api = runInNewContext(`${source.replace(/^import .*;$/gm, '').replace(/export (async )?function /g, '$1function ')}\n({ mountTourSettings });`, {
    window, document, location, URL, Headers, localStorage: storage(), sessionStorage: storage(), GAME_TOUR_MESSAGES: messages,
    esc: value => String(value), loadAuth: () => holdAuth ? authGate.promise : Promise.resolve(current),
    fetch: (path, options) => {
      assert.equal(path, '/api/auth/tours');
      const result = deferred(), request = { viewer: options.headers.get('X-Watten-Expected-Account-Id'), result };
      requests.push(request); waiters.get(requests.length)?.resolve(request);
      if (!holdPreferences) result.resolve({ ok: true, json: async () => ({ enabled: true, games: {} }) });
      return result.promise;
    },
    zdwaAppEntryUrl: () => '/', zilchAppEntryUrl: () => '/zilch', hausdeppAppEntryUrl: () => '/hausdepp', wattenAppEntryUrl: () => '/watten',
  });
  return { container, document, visits, requests, mount: () => api.mountTourSettings(container), resolveAuth: value => { current = value; authGate.resolve(value); },
    emit: value => { current = value; window.emit('zdwa:auth-state', value); },
    request: count => {
      if (requests.length >= count) return Promise.resolve(requests[count - 1]);
      if (!waiters.has(count)) waiters.set(count, deferred());
      return waiters.get(count).promise;
    } };
}

for (const language of ['de', 'en']) test(`${language}: late first auth adds the allowed Watten tour without replacing known controls`, async () => {
  const f = fixture({ language, holdAuth: true }), mounted = f.mount();
  assert.deepEqual(f.container.games(), ['zdwa', 'zilch', 'hausdepp']);
  const rows = [...f.container.list.rows], focused = rows[0].buttons[0]; f.document.activeElement = focused;
  assert.equal(f.container.toggle.disabled, true);
  f.container.click(focused);
  assert.equal(new URL(f.visits[0]).searchParams.get('tour'), 'zdwa');
  f.resolveAuth(auth(1, { watten_preview: true }));
  await mounted;
  assert.deepEqual(f.container.games(), ['zdwa', 'zilch', 'hausdepp', 'watten']);
  assert.equal(f.container.writes, 1); assert.equal(f.container.open, true);
  for (let i = 0; i < 3; i++) assert.equal(f.container.list.rows[i], rows[i]);
  assert.equal(f.document.activeElement, focused); assert.equal(f.container.toggle.disabled, false);
  assert.match(f.container.list.rows[3].html, new RegExp(messages[language].start));
});

test('same-viewer access grants and revocations update only the Watten row, without duplicate controls', async () => {
  const f = fixture({ initialAuth: auth(1, { watten_public: true }) }); await f.mount();
  const rows = [...f.container.list.rows];
  for (const access of [{}, {}, { watten_preview: true }, { watten_public: true }]) {
    f.emit(auth(1, access));
    assert.deepEqual(f.container.games(), access.watten_preview || access.watten_public ? ['zdwa', 'zilch', 'hausdepp', 'watten'] : ['zdwa', 'zilch', 'hausdepp']);
    for (let i = 0; i < 3; i++) assert.equal(f.container.list.rows[i], rows[i]);
  }
  f.emit(auth(1));
  f.container.click(rows[3].buttons[0]); // A detached old control cannot reopen the revoked game.
  assert.deepEqual(f.visits, []);
  assert.equal(f.container.writes, 1);
});

test('an older same-viewer auth completion cannot restore a revoked Watten row', async () => {
  const f = fixture({ holdAuth: true }), mounted = f.mount();
  f.emit(auth(1, { watten_preview: true }));
  assert.equal(f.container.games().includes('watten'), true);
  f.emit(auth(1));
  f.resolveAuth(auth(1, { watten_preview: true }));
  await mounted;
  assert.equal(f.container.games().includes('watten'), false);
  assert.equal(f.container.status.textContent, '');
});

test('an old account preference response cannot restore its rows or preference after an account switch', async () => {
  const f = fixture({ initialAuth: auth(1, { watten_public: true }), holdPreferences: true }), oldMount = f.mount();
  const old = await f.request(1);
  assert.equal(f.container.games().includes('watten'), true);
  f.emit(auth(2));
  assert.equal(f.container.games().includes('watten'), false);
  const nextMount = f.mount(), next = await f.request(2);
  assert.equal(next.viewer, '2');
  next.result.resolve({ ok: true, json: async () => ({ enabled: false, games: {} }) }); await nextMount;
  old.result.resolve({ ok: true, json: async () => ({ enabled: true, games: {} }) }); await oldMount;
  assert.equal(f.container.games().includes('watten'), false);
  assert.equal(f.container.toggle.checked, false); assert.equal(f.container.toggle.disabled, false);
  assert.equal(f.container.status.textContent, ''); assert.equal(f.container.writes, 1);
});

test('existing game access policy is unchanged for guests and private Watten account documents', async () => {
  for (const game of ['zdwa', 'zilch', 'hausdepp', 'watten']) {
    const f = fixture({ game, initialAuth: auth(null) }); await f.mount();
    assert.deepEqual(f.container.games(), game === 'watten' ? ['zdwa', 'zilch', 'hausdepp', 'watten'] : ['zdwa', 'zilch', 'hausdepp']);
    assert.equal(f.requests.length, 0);
  }
});
