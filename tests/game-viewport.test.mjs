import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = (await readFile(new URL('../frontend/shared/game-viewport.js', import.meta.url), 'utf8'))
  .replace(/export (?=function )/g, '');

class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  emit(type) {
    for (const callback of this.listeners.get(type) || []) callback({ type, target: this });
  }
}

class Element extends Events {
  constructor(tagName = 'div', properties = {}) {
    super();
    this.tagName = tagName.toUpperCase();
    this.type = 'text';
    this.scrollLeft = 0;
    this.scrollTop = 0;
    this.disabled = false;
    this.readOnly = false;
    this.isContentEditable = false;
    this.values = new Map();
    this.style = {
      setProperty: (name, value) => this.values.set(name, value),
      removeProperty: name => this.values.delete(name),
      getPropertyValue: name => this.values.get(name) || '',
    };
    this.computedStyle = { position: 'static', overflow: 'visible', overflowX: 'visible', overflowY: 'visible' };
    Object.assign(this, properties);
  }
  matches() {
    return this.tagName === 'TEXTAREA' || (this.tagName === 'INPUT' &&
      !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden'].includes(this.type));
  }
  scrollTo(left, top) {
    this.scrollLeft = typeof left === 'object' ? left.left ?? this.scrollLeft : left;
    this.scrollTop = typeof left === 'object' ? left.top ?? this.scrollTop : top;
  }
}

// Execute the actual module with deterministic browser events and time. Root
// offsets are independent: Safari can leave either the document or body offset
// behind even when the visible page looks as though it has returned to zero.
function fixture({ position = 'fixed', overflow = 'hidden', activeElement } = {}) {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  const frames = new Map();
  const root = new Element('html');
  const body = new Element('body');
  const sheet = new Element('section', { scrollTop: 213, scrollLeft: 17 });
  root.computedStyle = { position: 'static', overflow, overflowX: overflow, overflowY: overflow };
  body.computedStyle = { position, overflow: 'hidden', overflowX: 'hidden', overflowY: 'hidden' };
  const document = Object.assign(new Events(), {
    documentElement: root, body, scrollingElement: root, activeElement: activeElement || body,
    querySelectorAll: () => [sheet],
  });
  const viewport = Object.assign(new Events(), { width: 440, height: 956, offsetLeft: 0, offsetTop: 0, scale: 1 });
  const orientation = new Events();
  const win = Object.assign(new Events(), {
    innerWidth: 440, innerHeight: 956, scrollX: 0, scrollY: 0,
    visualViewport: viewport, screen: { orientation },
  });
  Object.defineProperties(win, {
    pageXOffset: { get: () => win.scrollX },
    pageYOffset: { get: () => win.scrollY },
  });
  win.scrollTo = (left, top) => {
    win.scrollX = typeof left === 'object' ? left.left ?? win.scrollX : left;
    win.scrollY = typeof left === 'object' ? left.top ?? win.scrollY : top;
  };
  const getComputedStyle = element => element.computedStyle;
  const requestAnimationFrame = callback => { const id = nextId++; frames.set(id, callback); return id; };
  const setTimeout = (callback, delay) => { const id = nextId++; timers.set(id, { callback, at: now + delay }); return id; };
  Object.assign(win, { getComputedStyle, requestAnimationFrame, setTimeout, clearTimeout: id => timers.delete(id) });
  const context = vm.createContext({ window: win, document, HTMLElement: Element, getComputedStyle,
    requestAnimationFrame, cancelAnimationFrame: id => frames.delete(id), setTimeout, clearTimeout: id => timers.delete(id) });
  vm.runInContext(`${source}\nglobalThis.initialize = initializeGameViewport;`, context);
  const flushFrames = () => {
    for (let count = 0; frames.size; count += 1) {
      assert.ok(count < 20, 'viewport recovery must not create a permanent frame loop');
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(now);
    }
  };
  return {
    win, document, root, body, viewport, orientation, sheet,
    initialize: context.initialize,
    flushFrames,
    advance(milliseconds) {
      const end = now + milliseconds;
      for (;;) {
        const next = [...timers.entries()].filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        flushFrames();
      }
      now = end;
      flushFrames();
    },
    displace() {
      win.scrollX = 13;
      win.scrollY = 104;
      root.scrollLeft = 7;
      root.scrollTop = 83;
      body.scrollLeft = 11;
      body.scrollTop = 61;
    },
    offsets: () => [win.scrollX, win.scrollY, root.scrollLeft, root.scrollTop, body.scrollLeft, body.scrollTop],
    variables: () => [...root.values.entries()],
  };
}

const recovered = f => assert.deepEqual(f.offsets(), [0, 0, 0, 0, 0, 0]);
const displaced = f => assert.deepEqual(f.offsets(), [13, 104, 7, 83, 11, 61]);

test('portrait/landscape/portrait clears Safari root offsets while preserving sheet and history scrolling', () => {
  const f = fixture();
  f.initialize();
  f.displace();
  Object.assign(f.win, { innerWidth: 956, innerHeight: 440 });
  // iOS can deliver orientationchange while visualViewport still reports the
  // previous orientation. That stale height must not become a keyboard inset.
  f.win.emit('orientationchange');
  f.flushFrames();
  recovered(f);
  assert.deepEqual(f.variables(), []);

  Object.assign(f.viewport, { width: 956, height: 440, offsetTop: 36 });
  f.displace();
  f.advance(1000);
  recovered(f);
  Object.assign(f.win, { innerWidth: 440, innerHeight: 956 });
  f.displace();
  f.win.emit('orientationchange');
  f.flushFrames();
  recovered(f);
  assert.deepEqual(f.variables(), [], 'stale landscape metrics must not shift the portrait table');
  assert.equal(f.sheet.scrollTop, 213);
  assert.equal(f.sheet.scrollLeft, 17);
});

test('settlement recovers an offset that appears after the last rotation resize event', () => {
  const f = fixture();
  f.initialize();
  f.win.emit('orientationchange');
  f.flushFrames();
  f.advance(260);
  f.displace();
  f.advance(740);
  recovered(f);
});

test('absolute full-screen bodies receive the same root recovery as fixed game bodies', () => {
  const f = fixture({ position: 'absolute' });
  f.initialize();
  f.displace();
  f.orientation.emit('change');
  f.flushFrames();
  recovered(f);
});

test('ordinary scrolling documents, including the Watten table, retain their scroll position on rotation', () => {
  for (const options of [{ position: 'static', overflow: 'visible' }, { position: 'fixed', overflow: 'visible' },
    { position: 'static', overflow: 'hidden' }]) {
    const f = fixture(options);
    f.initialize();
    f.displace();
    f.win.emit('orientationchange');
    f.advance(1000);
    displaced(f);
  }
});

test('editable focus protects browser scrolling even before a software keyboard has opened', () => {
  for (const element of [new Element('textarea'), new Element('input'), new Element('div', { isContentEditable: true })]) {
    const f = fixture({ activeElement: element });
    f.initialize();
    f.displace();
    f.win.emit('orientationchange');
    f.advance(1000);
    displaced(f);
    assert.deepEqual(f.variables(), []);
  }
});

test('buttons and read-only controls do not prevent recovering the game surface', () => {
  for (const element of [new Element('button'), new Element('input', { type: 'button' }),
    new Element('input', { readOnly: true }), new Element('textarea', { disabled: true })]) {
    const f = fixture({ activeElement: element });
    f.initialize();
    f.displace();
    f.win.emit('orientationchange');
    f.flushFrames();
    recovered(f);
  }
});

test('keyboard geometry tracks chat height and protects root scroll throughout the dismissal animation', () => {
  const f = fixture({ activeElement: new Element('textarea') });
  Object.assign(f.viewport, { height: 500, offsetTop: 48 });
  f.displace();
  f.initialize();
  displaced(f);
  assert.equal(f.root.style.getPropertyValue('--game-viewport-height'), '500px');
  assert.equal(f.root.style.getPropertyValue('--game-viewport-top'), '48px');
  assert.equal(f.root.style.getPropertyValue('--game-viewport-bottom'), '408px');

  f.document.activeElement = f.body;
  f.document.emit('focusout');
  f.flushFrames();
  f.advance(260);
  displaced(f);
  assert.equal(f.root.style.getPropertyValue('--game-viewport-height'), '500px');

  // The keyboard may finish closing without another visualViewport event.
  Object.assign(f.viewport, { height: 956, offsetTop: 0 });
  f.advance(740);
  recovered(f);
  assert.deepEqual(f.variables(), []);
  assert.equal(f.sheet.scrollTop, 213);
});

test('blur settlement recovers focus scrolling when no keyboard geometry was reported', () => {
  const f = fixture({ activeElement: new Element('input') });
  f.initialize();
  f.displace();
  f.document.activeElement = f.body;
  f.document.emit('focusout');
  f.advance(1000);
  recovered(f);
});

test('pinch zoom preserves the visual viewport and root scrolling until scale returns to one', () => {
  const f = fixture();
  f.initialize();
  f.displace();
  Object.assign(f.viewport, { scale: 1.5, width: 293, height: 637, offsetTop: 29 });
  f.win.emit('orientationchange');
  f.advance(1000);
  displaced(f);
  assert.deepEqual(f.variables(), []);

  Object.assign(f.viewport, { scale: 1, width: 440, height: 956, offsetTop: 0 });
  f.viewport.emit('resize');
  f.flushFrames();
  recovered(f);
});

test('page restoration and layout width resize both recover displaced game roots', () => {
  for (const event of ['pageshow', 'resize']) {
    const f = fixture();
    f.initialize();
    f.displace();
    if (event === 'resize') Object.assign(f.win, { innerWidth: 956, innerHeight: 440 });
    f.win.emit(event);
    f.advance(1000);
    recovered(f);
  }
});
