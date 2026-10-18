import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/reactions.js", import.meta.url), "utf8");
const { createReactionFrequency, REACTION_STORAGE_PREFIX } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const echo = (emoji, ts = "2026-10-18T12:00:00Z") => ({ from_id: "own-seat", emoji, ts });
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("quick defaults stay put until the next mount, then reflect confirmed frequency", () => {
  const storage = memoryStorage();
  const model = createReactionFrequency({ userId: 7, storage });
  assert.deepEqual(model.quick, ["👍", "😂", "😮", "💩"]);
  model.prepare("🔥");
  assert.equal(model.confirm(echo("🔥"), true), true);
  assert.deepEqual(model.quick, ["👍", "😂", "😮", "💩"]);
  assert.deepEqual(createReactionFrequency({ userId: 7, storage }).quick, ["🔥", "👍", "😂", "😮"]);
  assert.deepEqual(createReactionFrequency({ userId: 8, storage }).quick, ["👍", "😂", "😮", "💩"]);
});

test("own echoes require a pending send and duplicate echoes cannot count a second send", () => {
  const storage = memoryStorage(), model = createReactionFrequency({ userId: 7, storage });
  assert.equal(model.confirm(echo("🔥"), true), false);
  model.prepare("🔥");
  assert.equal(model.confirm(echo("🔥"), false), false);
  assert.equal(model.confirm(echo("🔥"), true), true);
  model.prepare("🔥");
  assert.equal(model.confirm(echo("🔥"), true), false);
  assert.equal(model.confirm(echo("🔥", "2026-10-18T12:00:01Z"), true), true);
  const saved = JSON.parse(storage.getItem(`${REACTION_STORAGE_PREFIX}7`));
  assert.equal(saved.counts["🔥"], 2);
  assert.equal(saved.seen.length, 2);
  const refreshed = createReactionFrequency({ userId: 7, storage });
  refreshed.prepare("🔥");
  assert.equal(refreshed.confirm(echo("🔥"), true), false);
});

test("failed sends, expired pending sends and disconnects cannot raise frequency", () => {
  const storage = memoryStorage();
  let clock = 0;
  const model = createReactionFrequency({ userId: 7, storage, now: () => clock });
  const cancelled = model.prepare("🔥");
  model.cancel(cancelled);
  assert.equal(model.confirm(echo("🔥"), true), false);
  model.prepare("🔥");
  clock = 20001;
  assert.equal(model.confirm(echo("🔥"), true), false);
  model.prepare("🔥");
  model.clearPending();
  assert.equal(model.confirm(echo("🔥"), true), false);
  assert.equal(storage.getItem(`${REACTION_STORAGE_PREFIX}7`), null);
});

test("malformed storage, private browsing and invalid accounts stay usable", () => {
  for (const raw of ["malformed", "null", '{"version":1,"counts":[]}']) {
    const storage = { getItem: () => raw, setItem() {} };
    assert.deepEqual(createReactionFrequency({ userId: 7, storage }).quick, ["👍", "😂", "😮", "💩"]);
  }
  const denied = { getItem() { throw new Error("storage blocked"); }, setItem() { throw new Error("quota denied"); } };
  const model = createReactionFrequency({ userId: 7, storage: denied });
  model.prepare("🔥");
  assert.equal(model.confirm(echo("🔥"), true), true);
  for (const userId of [null, 0, "foreign-account", "7:8"]) {
    const anonymous = createReactionFrequency({ userId, storage: denied });
    anonymous.prepare("🔥");
    assert.equal(anonymous.confirm(echo("🔥"), true), false);
  }
});

test("corrupt counts and unrecognised emoji never enter personal quick buttons", () => {
  const storage = memoryStorage();
  storage.setItem(`${REACTION_STORAGE_PREFIX}7`, JSON.stringify({ version: 1,
    counts: { "👍": -1, "😂": 2.5, "😮": "9", "💩": 2000000, "🔥": 3, "🤖": 100 }, seen: [] }));
  const model = createReactionFrequency({ userId: 7, storage });
  assert.deepEqual(model.quick, ["🔥", "👍", "😂", "😮"]);
  assert.equal(model.prepare("🤖"), null);
  assert.equal(model.confirm(echo("🤖"), true), false);
});
