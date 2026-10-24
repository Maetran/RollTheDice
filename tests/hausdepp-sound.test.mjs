import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const catalog = dataURL(await readFile(new URL("../frontend/shared/tavern-catalog.js", import.meta.url), "utf8"));
const { TAVERN_FAMILIES } = await import(catalog);
const shuffle = dataURL(await readFile(new URL("../frontend/shared/tavern-shuffle.js", import.meta.url), "utf8"));
const engine = dataURL((await readFile(new URL("../frontend/shared/tavern-sound.js", import.meta.url), "utf8"))
  .replace('"./tavern-catalog.js"', JSON.stringify(catalog)).replace('"./tavern-shuffle.js"', JSON.stringify(shuffle)));
const source = (await readFile(new URL("../frontend/hausdepp/sound.js", import.meta.url), "utf8"))
  .replace('"../shared/tavern-sound.js"', JSON.stringify(engine));
const { createHausdeppSound } = await import(dataURL(source));
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup({ fetchAsset, decode, resume, suspend, random = () => 0,
  families = [TAVERN_FAMILIES.find(family => family.id === "cambridge")], storage, failCurve } = {}) {
  const contexts = [], requests = [], timers = new Map(), lifecycle = new EventTarget(), states = [];
  const handlers = new Map(), addListener = lifecycle.addEventListener.bind(lifecycle), removeListener = lifecycle.removeEventListener.bind(lifecycle);
  lifecycle.addEventListener = (type, listener, options) => {
    handlers.set(type, { listener, options }); addListener(type, listener, options);
  };
  lifecycle.removeEventListener = (type, listener, options) => {
    if (handlers.get(type)?.listener === listener) handlers.delete(type);
    removeListener(type, listener, options);
  };
  let timerId = 0, wallTime = 0;
  const parameter = () => ({
    events: [],
    setValueAtTime(value, at) { this.events.push({ kind: "set", value, at }); },
    linearRampToValueAtTime(value, at) { this.events.push({ kind: "linear", value, at }); },
    exponentialRampToValueAtTime(value, at) { this.events.push({ kind: "exponential", value, at }); },
    cancelScheduledValues(at) { this.events.push({ kind: "cancel", at }); },
    setValueCurveAtTime(values, at, duration) {
      if (failCurve?.()) throw new Error("scheduling failed");
      this.events.push({ kind: "curve", values, at, duration });
    },
  });
  class Node {
    connections = [];
    gain = parameter();
    frequency = parameter();
    active = false;
    stopped = false;
    disconnected = false;
    constructor(context, kind) { this.context = context; this.kind = kind; context.nodes.push(this); }
    connect(target) { this.connections.push(target); return target; }
    disconnect() { this.disconnected = true; this.connections = []; }
    start(at, offset) { this.active = true; this.startAt = at; this.offset = offset; }
    stop(when = this.context.currentTime) {
      this.stopAt = when;
      if (when <= this.context.currentTime) this.finish();
    }
    finish() {
      this.active = false; this.stopped = true;
      this.onended?.();
    }
  }
  class Context {
    state = "suspended";
    currentTime = 0;
    destination = { kind: "speakers" };
    nodes = [];
    resumes = 0;
    suspends = 0;
    closes = 0;
    constructor() { contexts.push(this); }
    resume() {
      this.resumes++;
      if (resume) return resume(this);
      this.state = "running"; return Promise.resolve();
    }
    suspend() {
      this.suspends++;
      if (suspend) return suspend(this);
      this.state = "suspended"; return Promise.resolve();
    }
    close() { this.closes++; this.state = "closed"; return Promise.resolve(); }
    decodeAudioData(data) { return decode ? decode(data, this) : Promise.resolve({ data, duration: 4 }); }
    createOscillator() { return new Node(this, "tone"); }
    createGain() { return new Node(this, "gain"); }
    createBufferSource() { return new Node(this, "clip"); }
  }
  const fetch = async (url, options) => {
    const request = { url, options }; requests.push(request);
    return fetchAsset ? fetchAsset(request) : { ok: true, arrayBuffer: async () => {
      const data = new ArrayBuffer(8); data.asset = url; return data;
    } };
  };
  const sound = createHausdeppSound({ AudioContext: Context, fetch, lifecycle, random, families, storage: storage ?? { getItem() { return null; }, setItem() {} },
    onState: state => states.push(state),
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms, due: wallTime + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const tick = (milliseconds, audioMilliseconds = milliseconds) => {
    wallTime += milliseconds;
    for (const context of contexts) {
      if (context.state === "running") context.currentTime += audioMilliseconds / 1000;
      for (const node of [...context.nodes]) if (node.active && node.stopAt <= context.currentTime) node.finish();
    }
    for (const [id, timer] of [...timers]) if (timer.due <= wallTime) {
      timers.delete(id); timer.callback();
    }
  };
  const clips = () => contexts.flatMap(context => context.nodes.filter(node => node.kind === "clip" && node.active));
  const tones = () => contexts.flatMap(context => context.nodes.filter(node => node.kind === "tone" && node.active));
  return { sound, contexts, requests, timers, lifecycle, handlers, states, tick, clips, tones };
}

test("default-off sound never opens a context, fetches assets or schedules background work", async () => {
  const app = setup();
  app.sound.unlock(); app.sound.cue("mic-on"); app.sound.cue("voice-off");
  await app.sound.setEnabled(false);
  assert.equal(app.sound.snapshot().enabled, false);
  assert.equal(app.contexts.length, 0); assert.equal(app.requests.length, 0); assert.equal(app.timers.size, 0);
  app.sound.destroy(); app.sound.destroy();
  assert.equal(await app.sound.setEnabled(true), false);
  assert.equal(app.contexts.length, 0);
});

test("opt-in loads bounded same-origin clips once and routes only to local speakers", async () => {
  const app = setup();
  assert.equal(await app.sound.setEnabled(true), true);
  assert.equal(app.contexts.length, 1); assert.equal(app.requests.length, 4);
  for (const request of app.requests) {
    assert.match(request.url, /^\/static\/audio\/hausdepp\/[a-z0-9-]+\.mp3\?v=/);
    assert.equal(request.options.mode, "same-origin"); assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.cache, "force-cache");
  }
  assert.equal(app.sound.snapshot().status, "playing");
  assert.equal(app.clips().length, 1); assert.equal(app.clips()[0].loop, true);
  for (const node of app.contexts[0].nodes.filter(node => node.kind === "gain")) {
    assert.deepEqual(node.connections, [app.contexts[0].destination]);
  }
  app.sound.cue("voice-on"); app.sound.cue("mic-on");
  assert.equal(app.tones().length, 1, "rapid confirmations must not sum into a louder sound");
  await app.sound.setEnabled(true);
  assert.equal(app.requests.length, 4); assert.equal(app.clips().length, 1);
  app.sound.destroy();
});

test("each of the ten room choices loads only that room and the three shared details", async () => {
  for (let index = 0; index < 10; index++) {
    // Include both ends of Math.random's range and every interval boundary.
    const app = setup({ random: () => index === 9 ? 0.9999999999999999 : index / 10 });
    assert.equal(await app.sound.setEnabled(true), true);
    const filename = index === 0 ? "tavern-room" : `tavern-room-${String(index + 1).padStart(2, "0")}`;
    assert.equal(app.requests.length, 4);
    assert.deepEqual(app.requests.map(request => request.url.split("/").at(-1).split("?")[0]),
      [`${filename}.mp3`, "glasses.mp3", "dishwasher.mp3", "laughter.mp3"]);
    assert.match(app.clips()[0].buffer.data.asset, new RegExp(`/${filename}\\.mp3\\?v=`));
    app.sound.destroy();
  }
});

test("off/on uses the next variant, unchanged on/unlock preserves the current room", async () => {
  const app = setup();
  await app.sound.setEnabled(true);
  const firstRoom = app.clips()[0];
  await app.sound.setEnabled(true); app.sound.unlock(); await turn();
  assert.equal(app.clips()[0], firstRoom); assert.equal(app.requests.length, 4);
  for (const filename of ["tavern-room-02", "tavern-room-03"]) {
    await app.sound.setEnabled(false);
    assert.equal(firstRoom.buffer, null, "retired sources release their decoded buffer reference");
    await app.sound.setEnabled(true);
    assert.ok(app.clips()[0].buffer.data.asset.includes(`/${filename}.mp3`));
    assert.equal(app.contexts[0].nodes.filter(node => node.kind === "clip" && node.buffer).length, 1);
  }
  assert.equal(app.requests.length, 6);
  assert.equal(app.requests.filter(request => !request.url.includes("tavern-room")).length, 3);
  app.sound.destroy();
});

test("off immediately stops ambience, allows one final short tone and then stays silent", async () => {
  const app = setup(); await app.sound.setEnabled(true); app.tick(1000);
  app.sound.cue("mic-on");
  const oldNodes = app.contexts[0].nodes.filter(node => node.kind !== "gain");
  assert.equal(await app.sound.setEnabled(false), true);
  assert.ok(oldNodes.every(node => node.stopped && node.disconnected));
  assert.equal(app.clips().length, 0); assert.equal(app.tones().length, 1);
  app.sound.cue("voice-on"); app.sound.cue("mic-off"); app.sound.unlock();
  assert.equal(app.tones().length, 1);
  app.tick(160); await turn();
  assert.equal(app.clips().length, 0); assert.equal(app.tones().length, 0);
  assert.equal(app.timers.size, 0); assert.equal(app.contexts[0].state, "suspended");
  app.tick(60000); assert.equal(app.clips().length, 0);
  app.sound.destroy();
});

test("off during a pending resume cannot fetch or start sound after the old grant arrives", async () => {
  const pending = deferred();
  const app = setup({ resume: context => pending.promise.then(() => { context.state = "running"; }) });
  const enabling = app.sound.setEnabled(true);
  assert.equal(app.contexts.length, 1); assert.equal(app.requests.length, 0);
  await app.sound.setEnabled(false); app.tick(160);
  pending.resolve(); assert.equal(await enabling, false);
  assert.equal(app.requests.length, 0); assert.equal(app.clips().length, 0); assert.equal(app.tones().length, 0);
  assert.equal(app.contexts[0].state, "suspended");
  app.sound.destroy();
});

test("off aborts fetches and a new activation waits for a retired decode before decoding again", async () => {
  const decodes = [];
  let concurrent = 0, maxConcurrent = 0;
  const app = setup({ decode: data => {
    const work = deferred(); concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent);
    decodes.push({ ...work, data });
    return work.promise.finally(() => concurrent--);
  } });
  const first = app.sound.setEnabled(true); await turn();
  assert.equal(decodes.length, 1, "decoding is serial, including the three details");
  await app.sound.setEnabled(false); app.tick(160);
  assert.ok(app.requests.every(request => request.options.signal.aborted));
  const second = app.sound.setEnabled(true); await turn();
  assert.equal(decodes.length, 1, "a revision guard alone would still start a second decode");
  decodes[0].resolve({ data: decodes[0].data, duration: 4, retired: true });
  await turn();
  assert.equal(await first, false); assert.equal(app.clips().length, 0);
  for (let index = 1; index <= 4; index++) {
    assert.equal(decodes.length, index + 1);
    decodes[index].resolve({ data: decodes[index].data, duration: 4 }); await turn();
  }
  assert.equal(await second, true);
  assert.equal(maxConcurrent, 1);
  assert.ok(app.clips()[0].buffer.data.asset.includes("/tavern-room-02.mp3"));
  assert.equal(app.contexts[0].nodes.filter(node => node.kind === "clip" && node.buffer).length, 1);
  app.sound.destroy();
});

test("an old failed request cannot disable a newer room activation", async () => {
  const firstRequest = deferred();
  const app = setup({ fetchAsset: request => {
    if (request.url.includes("/tavern-room.mp3")) return firstRequest.promise;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  } });
  const first = app.sound.setEnabled(true); await turn();
  await app.sound.setEnabled(false);
  assert.equal(await app.sound.setEnabled(true), true);
  firstRequest.reject(new Error("old request cancelled"));
  assert.equal(await first, false);
  assert.equal(app.sound.snapshot().status, "playing");
  assert.equal(app.clips().length, 1);
  app.sound.destroy();
});

test("queued jobs from rapid activations are skipped, even when the filename returns", async () => {
  const families = [{ id: "only", details: false, variants: [{ id: "room", url: "/room.mp3", gain: .065 }] }];
  const decodes = [];
  const app = setup({ families, decode: data => {
    const work = deferred(); decodes.push({ ...work, data }); return work.promise;
  } });
  const first = app.sound.setEnabled(true); await turn();
  await app.sound.setEnabled(false);
  const second = app.sound.setEnabled(true); await turn();
  await app.sound.setEnabled(false);
  const third = app.sound.setEnabled(true); await turn();
  assert.equal(decodes.length, 1);
  decodes[0].resolve({ duration: 4, retired: true }); await turn();
  assert.equal(await first, false); assert.equal(await second, false);
  assert.equal(decodes.length, 2, "the middle queued decode was retired before it could allocate");
  assert.equal(app.sound.snapshot().status, "loading"); assert.equal(app.clips().length, 0);
  const newest = { duration: 4, retired: false };
  decodes[1].resolve(newest);
  assert.equal(await third, true); assert.equal(app.clips()[0].buffer, newest);
  app.sound.destroy();
});

test("destroy aborts loading and a late response or decode cannot resurrect audio", async () => {
  for (const phase of ["response", "decode"]) {
    const pending = deferred();
    const app = setup(phase === "response" ? { fetchAsset: () => pending.promise }
      : { decode: () => pending.promise });
    const enabling = app.sound.setEnabled(true); await turn();
    app.lifecycle.dispatchEvent(new Event("pagehide"));
    assert.ok(app.requests.every(request => request.options.signal.aborted));
    pending.resolve(phase === "response" ? { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } : { duration: 4 });
    assert.equal(await enabling, false);
    assert.equal(app.clips().length, 0); assert.equal(app.tones().length, 0); assert.equal(app.timers.size, 0);
    assert.equal(app.contexts[0].state, "closed"); app.sound.destroy();
    assert.equal(app.contexts[0].closes, 1);
  }
});

test("loading or playback failure stops sources and can be retried through a fresh explicit opt-in", async () => {
  let fail = true;
  const app = setup({ fetchAsset: async () => ({ ok: !fail, arrayBuffer: async () => new ArrayBuffer(8) }) });
  assert.equal(await app.sound.setEnabled(true), false);
  assert.deepEqual(app.sound.snapshot(), { enabled: false, supported: true, status: "error", errorKey: "soundUnavailable" });
  assert.equal(app.clips().length, 0); assert.equal(app.tones().length, 0);
  fail = false;
  assert.equal(await app.sound.setEnabled(true), true);
  assert.equal(app.clips().length, 1);
  app.sound.destroy();
});

test("only one detail plays beside the room and the next detail waits until it ends", async () => {
  const app = setup(); await app.sound.setEnabled(true);
  assert.equal(app.timers.size, 2); app.tick(8000);
  assert.equal(app.clips().length, 2); assert.equal(app.clips().filter(clip => clip.loop).length, 1);
  assert.equal(app.timers.size, 1);
  app.tick(50000); assert.equal(app.clips().length, 2);
  app.clips().find(clip => !clip.loop).finish();
  assert.equal(app.timers.size, 2); app.tick(25000);
  assert.equal(app.clips().length, 2);
  app.sound.destroy(); assert.equal(app.clips().length, 0); assert.equal(app.timers.size, 0);
});

test("a pending old suspend cannot silence a newly enabled room", async () => {
  const suspending = deferred();
  const app = setup({ suspend: context => suspending.promise.then(() => { context.state = "suspended"; }) });
  await app.sound.setEnabled(true);
  await app.sound.setEnabled(false); app.tick(160);
  assert.equal(app.contexts[0].state, "running");
  const enabling = app.sound.setEnabled(true); await turn();
  suspending.resolve(); await enabling; await turn();
  assert.equal(app.sound.snapshot().enabled, true);
  assert.equal(app.contexts[0].state, "running");
  assert.equal(app.clips().length, 1);
  app.sound.destroy();
});

const distinctRooms = ['a', 'b'].map(id => ({ id, details: false,
  variants: [{ id, url: `/${id}.mp3`, gain: .065 }] }));
const roomsPlaying = app => app.clips().filter(clip => clip.loop);
const curveOf = source => source.connections[0].gain.events.find(event => event.kind === 'curve');

test('rotation waits for AudioContext time, then fades at equal power and retires the outgoing buffer', async () => {
  const app = setup({ families: distinctRooms, random: () => .5 });
  await app.sound.setEnabled(true);
  const original = roomsPlaying(app)[0];
  assert.equal(original.offset, 2, 'each loop starts at a random point within its decoded duration');
  app.contexts[0].state = 'suspended';
  app.tick(300000); await turn();
  assert.equal(app.requests.length, 1, 'wall time in a suspended context must not advance rotation');
  app.contexts[0].state = 'running';
  app.tick(240000); await turn();
  assert.equal(roomsPlaying(app).length, 2);
  const incoming = roomsPlaying(app).find(source => source !== original);
  const outgoingCurve = curveOf(original), incomingCurve = curveOf(incoming);
  assert.equal(outgoingCurve.duration, 20); assert.equal(incomingCurve.duration, 20);
  assert.equal(outgoingCurve.at, app.contexts[0].currentTime);
  for (let index = 0; index < outgoingCurve.values.length; index++) {
    const power = outgoingCurve.values[index] ** 2 + incomingCurve.values[index] ** 2;
    assert.ok(Math.abs(power - .065 ** 2) < .00000001, 'the middle of the fade must not dip');
  }
  assert.equal(incoming.connections[0].gain.events.filter(event => event.kind === 'set').length, 0,
    'an incoming curve must not overlap a same-time setValueAtTime event');
  assert.equal(app.timers.size, 0, 'no third room can load before the outgoing source ends');
  app.tick(20000); await turn();
  assert.deepEqual(roomsPlaying(app), [incoming]); assert.equal(original.buffer, null);
  assert.equal(app.timers.size, 1);
  app.sound.destroy();
});

test('a delayed next decode keeps the old loop at full gain until the new buffer is ready', async () => {
  const pending = deferred();
  const app = setup({ families: distinctRooms, decode: data => data.asset === '/b.mp3'
    ? pending.promise : Promise.resolve({ data, duration: 4 }) });
  await app.sound.setEnabled(true); const original = roomsPlaying(app)[0];
  app.tick(180000); await turn(); app.tick(600000); await turn();
  assert.deepEqual(roomsPlaying(app), [original]); assert.equal(curveOf(original), undefined);
  assert.equal(app.requests.length, 2);
  pending.resolve({ duration: 4 }); await turn();
  assert.equal(roomsPlaying(app).length, 2);
  assert.equal(curveOf(original).at, app.contexts[0].currentTime, 'late background timers must not backdate a fade');
  await app.sound.setEnabled(false); app.tick(160);
  assert.equal(roomsPlaying(app).length, 0); assert.equal(app.timers.size, 0);
  assert.ok(app.contexts[0].nodes.filter(node => node.kind === 'clip').every(node => node.buffer === null));
  app.sound.destroy();
});

test('offline rotation preserves playback and retries another recording without repeating the audible room', async () => {
  const app = setup({ families: distinctRooms, fetchAsset: request => ({ ok: request.url !== '/b.mp3',
    arrayBuffer: async () => { const data = new ArrayBuffer(8); data.asset = request.url; return data; } }) });
  await app.sound.setEnabled(true); const original = roomsPlaying(app)[0];
  app.tick(180000); await turn();
  assert.deepEqual(roomsPlaying(app), [original]);
  assert.deepEqual(app.sound.snapshot(), { enabled: true, supported: true, status: 'playing', errorKey: '' });
  app.tick(30000); await turn();
  assert.deepEqual(app.requests.map(request => request.url), ['/a.mp3', '/b.mp3', '/b.mp3']);
  assert.deepEqual(roomsPlaying(app), [original]);
  app.sound.destroy();
});

test('native scheduling failure during fade setup restores the old loop and retires the incoming source', async () => {
  let calls = 0;
  const app = setup({ families: distinctRooms, failCurve: () => ++calls === 2 });
  await app.sound.setEnabled(true); const original = roomsPlaying(app)[0];
  app.tick(180000); await turn();
  assert.deepEqual(roomsPlaying(app), [original]);
  assert.equal(original.stopped, false);
  assert.equal(original.connections[0].gain.events.at(-1).value, .065);
  assert.equal(app.contexts[0].nodes.filter(node => node.kind === 'clip' && node.buffer).length, 1);
  assert.equal(app.timers.size, 1);
  app.sound.destroy();
});

test('details stop at the fade and only return after Cambridge becomes the sole active room', async () => {
  const cambridge = TAVERN_FAMILIES.find(family => family.id === 'cambridge');
  const app = setup({ families: [{ ...cambridge, variants: cambridge.variants.slice(0, 1) }, distinctRooms[1]] });
  await app.sound.setEnabled(true); app.tick(8000);
  const detail = app.clips().find(source => !source.loop);
  assert.ok(detail); assert.equal(app.requests.length, 4);
  app.tick(172000); await turn();
  assert.equal(detail.buffer, null); assert.equal(app.requests.length, 5);
  app.tick(20000); await turn();
  assert.equal(app.timers.size, 1, 'a non-Cambridge room has only a rotation timer');
  app.tick(180000); await turn(); app.tick(20000); await turn();
  assert.equal(app.timers.size, 2, 'Cambridge details restart after the outgoing room is retired');
  app.tick(8000); assert.equal(app.clips().filter(source => !source.loop).length, 1);
  app.sound.destroy();
});

test('pagehide during an in-flight rotation aborts the request and cannot restart loops or timers', async () => {
  const pending = deferred();
  const app = setup({ families: distinctRooms, fetchAsset: request => request.url === '/b.mp3' ? pending.promise
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) } });
  await app.sound.setEnabled(true); app.tick(180000); await turn();
  app.lifecycle.dispatchEvent(new Event('pagehide'));
  assert.equal(app.requests.at(-1).options.signal.aborted, true);
  pending.resolve({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }); await turn();
  assert.equal(app.clips().length, 0); assert.equal(app.timers.size, 0);
  assert.equal(app.contexts[0].state, 'closed');
  assert.ok(app.contexts[0].nodes.filter(node => node.kind === 'clip').every(node => node.buffer === null));
});

test('enabled interrupted ambience resumes on the next gesture; default-off and teardown stay inactive', async () => {
  const app = setup();
  for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) {
    assert.deepEqual(app.handlers.get(type).options, { capture: true, passive: true });
    app.lifecycle.dispatchEvent(new Event(type));
  }
  await turn();
  assert.equal(app.contexts.length, 0); assert.equal(app.requests.length, 0);
  await app.sound.setEnabled(true);
  const context = app.contexts[0], room = roomsPlaying(app)[0], requests = app.requests.length;
  for (const [type, state] of [['pointerdown', 'interrupted'], ['pointerup', 'suspended'], ['touchend', 'interrupted'], ['keydown', 'suspended']]) {
    context.state = state;
    const resumes = context.resumes;
    app.lifecycle.dispatchEvent(new Event(type)); await turn();
    assert.equal(context.resumes, resumes + 1);
    assert.equal(context.state, 'running');
    assert.deepEqual(roomsPlaying(app), [room]); assert.equal(app.requests.length, requests);
    assert.equal(app.sound.snapshot().enabled, true);
  }
  await app.sound.setEnabled(false); app.tick(160); await turn();
  const resumes = context.resumes;
  app.lifecycle.dispatchEvent(new Event('pointerdown')); await turn();
  assert.equal(context.resumes, resumes, 'disabled sound must not resume on unrelated table gestures');
  app.sound.destroy();
  assert.equal(app.handlers.size, 0, 'teardown removes pagehide and all capture handlers');
  app.lifecycle.dispatchEvent(new Event('keydown')); await turn();
  assert.equal(context.resumes, resumes); assert.equal(context.closes, 1);
});

for (const phase of ['request', 'curve']) {
  test(`${phase} rotation failures during a detail retain exactly one detail chain`, async () => {
    const cambridge = TAVERN_FAMILIES.find(family => family.id === 'cambridge');
    const app = setup({ families: [{ ...cambridge, variants: cambridge.variants.slice(0, 1) }, distinctRooms[1]],
      failCurve: () => phase === 'curve',
      fetchAsset: request => ({ ok: phase !== 'request' || request.url !== '/b.mp3',
        arrayBuffer: async () => { const data = new ArrayBuffer(8); data.asset = request.url; return data; } }),
    });
    await app.sound.setEnabled(true);
    app.tick(180000); await turn();
    const activeDetail = () => app.clips().filter(source => !source.loop);
    const original = activeDetail()[0]; assert.ok(original);
    for (let failure = 0; failure < 3; failure++) {
      assert.deepEqual(activeDetail(), [original]);
      assert.equal(app.timers.size, 1, 'a playing detail owns its chain; only the rotation retry may be pending');
      app.tick(30000); await turn();
    }
    original.finish();
    assert.equal(app.timers.size, 2, 'its own onended schedules one detail beside the rotation retry');
    app.tick(25000); await turn();
    assert.equal(activeDetail().length, 1); assert.equal(app.timers.size, 1);
    app.tick(5000); await turn();
    assert.equal(activeDetail().length, 1); assert.equal(app.timers.size, 1,
      'another rotation failure must not append a second detail timer');
    activeDetail()[0].finish();
    assert.equal(app.timers.size, 2);
    app.tick(25000); await turn();
    assert.equal(activeDetail().length, 1); assert.equal(app.timers.size, 1);
    app.sound.destroy(); assert.equal(app.timers.size, 0);
  });
}

test('failed Cambridge details retire the pending room decode before it can become an orphan buffer', async t => {
  const pendingRoom = deferred(), failedDetail = deferred();
  let roomDecodes = 0, detailFetches = 0;
  const families = ['a', 'b', 'c'].map(id => ({ id, details: id === 'b',
    variants: [{ id, url: `/${id}.mp3`, gain: .065 }] }));
  const app = setup({ families,
    decode: data => data.asset === '/b.mp3' && ++roomDecodes === 1 ? pendingRoom.promise
      : Promise.resolve({ data, duration: 4 }),
    fetchAsset: request => {
      if (request.url.includes('/glasses.mp3') && ++detailFetches === 1) return failedDetail.promise;
      return { ok: true, arrayBuffer: async () => { const data = new ArrayBuffer(8); data.asset = request.url; return data; } };
    },
  });
  t.after(() => app.sound.destroy());
  await app.sound.setEnabled(true);
  const original = roomsPlaying(app)[0];
  app.tick(180000); await turn();
  assert.equal(roomDecodes, 1, 'the next room is decoding while its detail fetch is still pending');
  failedDetail.reject(new Error('detail unavailable')); await turn();
  assert.deepEqual(roomsPlaying(app), [original]);
  const aborted = app.requests.find(request => request.url === '/b.mp3').options.signal.aborted;
  pendingRoom.resolve({ data: { asset: '/b.mp3' }, duration: 4, retired: true }); await turn();
  assert.equal(aborted, true, 'a failed detail must invalidate and abort its still-decoding room job');
  app.tick(30000); await turn(); // C loads after the retired B decode has completed.
  assert.equal(roomsPlaying(app).length, 2);
  app.tick(20000); await turn();
  app.tick(180000); await turn(); // A in the next family bag.
  app.tick(20000); await turn();
  app.tick(180000); await turn(); // B must fetch/decode again, rather than reuse its retired result.
  assert.equal(app.requests.filter(request => request.url === '/b.mp3').length, 2);
  assert.equal(roomDecodes, 2);
  assert.ok(roomsPlaying(app).every(source => !source.buffer.retired));
});
