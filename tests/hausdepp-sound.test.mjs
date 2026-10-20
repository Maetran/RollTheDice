import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/sound.js", import.meta.url), "utf8");
const { createHausdeppSound } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup({ fetchAsset, decode, resume, suspend, random = () => 0 } = {}) {
  const contexts = [], requests = [], timers = new Map(), lifecycle = new EventTarget(), states = [];
  let timerId = 0;
  const parameter = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} });
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
    start() { this.active = true; }
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
    return fetchAsset ? fetchAsset(request) : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
  const sound = createHausdeppSound({ AudioContext: Context, fetch, lifecycle, random,
    onState: state => states.push(state),
    setTimeout(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const tick = milliseconds => {
    for (const context of contexts) {
      context.currentTime += milliseconds / 1000;
      for (const node of [...context.nodes]) if (node.active && node.stopAt <= context.currentTime) node.finish();
    }
    for (const [id, timer] of [...timers]) if (timer.ms <= milliseconds) {
      timers.delete(id); timer.callback();
    }
  };
  const clips = () => contexts.flatMap(context => context.nodes.filter(node => node.kind === "clip" && node.active));
  const tones = () => contexts.flatMap(context => context.nodes.filter(node => node.kind === "tone" && node.active));
  return { sound, contexts, requests, timers, lifecycle, states, tick, clips, tones };
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
    assert.match(request.url, /^\/static\/audio\/hausdepp\/[a-z-]+\.mp3\?v=/);
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

test("late decoding stays silent after off and a new opt-in reuses only decoded buffers", async () => {
  const decodes = [];
  const app = setup({ decode: () => { const work = deferred(); decodes.push(work); return work.promise; } });
  const first = app.sound.setEnabled(true); await turn();
  assert.equal(decodes.length, 4);
  await app.sound.setEnabled(false); app.tick(160);
  for (const decode of decodes) decode.resolve({ duration: 4 });
  assert.equal(await first, false); assert.equal(app.clips().length, 0);
  assert.equal(await app.sound.setEnabled(true), true);
  assert.equal(app.requests.length, 4); assert.equal(app.clips().length, 1);
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
  assert.equal(app.timers.size, 1); app.tick(8000);
  assert.equal(app.clips().length, 2); assert.equal(app.clips().filter(clip => clip.loop).length, 1);
  assert.equal(app.timers.size, 0);
  app.tick(50000); assert.equal(app.clips().length, 2);
  app.clips().find(clip => !clip.loop).finish();
  assert.equal(app.timers.size, 1); app.tick(25000);
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
