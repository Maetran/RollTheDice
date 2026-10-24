import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/shared/voice-table-lifecycle.js", import.meta.url), "utf8");
const { createVoiceTableLifecycle, queueVoiceTableLeft, showVoiceTableLeft } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const storage = () => {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
function setup(options = {}) {
  const store = options.storage ?? storage(), listeners = new Set(), calls = [], notices = [];
  let state = { available: false, audio: false, microphone: false };
  const emit = update => { state = { ...state, ...update }; for (const listener of listeners) listener(state); };
  const transport = {
    snapshot: () => ({ ...state }),
    setAudio(value) { calls.push(["audio", value]); emit({ audio: value, microphone: false }); return Promise.resolve(true); },
    setMicrophone(value) { calls.push(["mic", value]); emit({ microphone: value }); return Promise.resolve(true); },
    receive(update) { emit(update); return Promise.resolve(true); },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
    destroy() { calls.push(["destroy"]); emit({ audio: false, microphone: false }); },
  };
  const lifecycle = createVoiceTableLifecycle({ controller: transport, userId: 7, gameType: "watten", storage: store,
    notify: key => notices.push(key), ...options });
  return { lifecycle, controller: lifecycle.controller, transport, store, emit, calls, notices, listeners };
}

test("new tables stay silent unless the profile explicitly enables listening; discovery never captures", async () => {
  for (const defaultListening of [undefined, false, "true", true]) {
    const f = setup({ defaultListening });
    f.lifecycle.enter({ gameId: "first" });
    assert.equal(f.controller.snapshot().audio, false);
    f.emit({ available: true });
    assert.equal(f.controller.snapshot().audio, defaultListening === true);
    assert.equal(f.controller.snapshot().microphone, false);
    assert.equal(f.calls.some(([action]) => action === "mic"), false);
  }
});

test("same-game start keeps capture; authorized new-game handoff retires capture and retains listening", async () => {
  const f = setup(); f.lifecycle.enter({ gameId: "first" }); f.emit({ available: true });
  await f.controller.setAudio(true); await f.controller.setMicrophone(true);
  f.lifecycle.enter({ gameId: "first", groupId: "series" });
  assert.equal(f.controller.snapshot().microphone, true);
  f.lifecycle.handoff("second");
  assert.equal(f.controller.snapshot().microphone, false);
  f.lifecycle.enter({ gameId: "second", groupId: "series" });
  assert.equal(f.controller.snapshot().audio, true);
  assert.equal(f.calls.filter(([action, enabled]) => action === "audio" && enabled).length, 1);
  const persisted = [...f.store.values.values()].join("");
  assert.doesNotMatch(persisted, /microphone|capture|token/);
  const next = setup({ storage: f.store }); next.lifecycle.enter({ gameId: "second", groupId: "series" });
  next.emit({ available: true });
  assert.equal(next.controller.snapshot().audio, true);
  assert.equal(next.controller.snapshot().microphone, false);
});

test("manual off beats profile on through reload and rematch; unrelated tables and accounts use their own default", async () => {
  const f = setup({ defaultListening: true }); f.lifecycle.enter({ gameId: "first" }); f.emit({ available: true });
  await f.controller.setAudio(false);
  const reload = setup({ defaultListening: true, storage: f.store });
  reload.lifecycle.enter({ gameId: "first" }); reload.emit({ available: true });
  assert.equal(reload.controller.snapshot().audio, false);
  reload.lifecycle.handoff("second");
  const rematch = setup({ defaultListening: true, storage: f.store });
  rematch.lifecycle.enter({ gameId: "second", groupId: "first" }); rematch.emit({ available: true });
  assert.equal(rematch.controller.snapshot().audio, false);
  const other = setup({ storage: f.store, userId: 8 }); other.lifecycle.enter({ gameId: "second" }); other.emit({ available: true });
  assert.equal(other.controller.snapshot().audio, false);
  rematch.lifecycle.enter({ gameId: "unrelated" });
  assert.equal(rematch.controller.snapshot().audio, false);
  rematch.emit({ available: true });
  assert.equal(rematch.controller.snapshot().audio, true);
});

test("revoked or failed membership cannot automatically rejoin; explicit retry remains available", async () => {
  const f = setup({ defaultListening: true }); f.lifecycle.enter({ gameId: "first" }); f.emit({ available: true });
  f.emit({ available: false, audio: false }); f.emit({ available: true });
  assert.equal(f.calls.filter(([action, enabled]) => action === "audio" && enabled).length, 1);
  assert.deepEqual(f.notices, ["voiceEnded"]);
  await f.controller.setAudio(true);
  assert.equal(f.controller.snapshot().audio, true);
  f.lifecycle.revoke(); f.emit({ available: false }); f.emit({ available: true });
  assert.equal(f.controller.snapshot().audio, false);
  assert.equal(f.store.values.size, 0);
  f.controller.destroy(); assert.equal(f.listeners.size, 0);
});

test("table leave clears the override and delivers one account-scoped target-page notice", async () => {
  const f = setup(); f.lifecycle.enter({ gameId: "first" }); f.emit({ available: true });
  await f.controller.setAudio(true); f.lifecycle.leave();
  assert.equal(f.controller.snapshot().audio, false); assert.equal(f.store.values.size, 0);
  queueVoiceTableLeft({ storage: f.store, userId: 7, gameType: "watten" });
  const notices = [], options = { storage: f.store, userId: 7, gameType: "watten", t: key => `translated:${key}`,
    toast: (...args) => notices.push(args) };
  showVoiceTableLeft(options); showVoiceTableLeft(options);
  assert.deepEqual(notices, [["translated:voiceTableLeft", { duration: 6000 }]]);
  queueVoiceTableLeft({ storage: f.store, userId: 8, gameType: "watten" });
  showVoiceTableLeft(options); assert.equal(notices.length, 1);
});

test("unavailable or malformed storage never enables a microphone or bypasses the profile default", () => {
  const broken = { getItem() { throw Error("denied"); }, setItem() { throw Error("denied"); }, removeItem() { throw Error("denied"); } };
  const f = setup({ storage: broken }); f.lifecycle.enter({ gameId: "first" }); f.emit({ available: true });
  assert.equal(f.controller.snapshot().audio, false);
  f.lifecycle.handoff("second"); f.lifecycle.leave(); f.controller.destroy();
  const malformed = storage(); malformed.setItem("rollthedice.voice.table.watten.7", '{"listening":true,"games":[9]}');
  const g = setup({ storage: malformed }); g.lifecycle.enter({ gameId: "first" }); g.emit({ available: true });
  assert.equal(g.controller.snapshot().audio, false);
});
