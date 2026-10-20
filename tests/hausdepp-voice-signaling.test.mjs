import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/voice-signaling.js", import.meta.url), "utf8");
const { createVoiceSignaling } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("voice replies resolve their own requests and cannot overwrite action or operation", async () => {
  const sent = [];
  const signaling = createVoiceSignaling({ send: data => { sent.push(data); return true; } });
  const first = signaling.request("state", { action: "end_game", operation: "join", request_id: "foreign" });
  const second = signaling.request("join");
  assert.equal(sent[0].action, "hausdepp_voice");
  assert.equal(sent[0].operation, "state");
  assert.equal(signaling.receive({ request_id: "foreign", ok: true }), false);
  signaling.receive({ request_id: sent[1].request_id, ok: true, member_token: "own" });
  signaling.receive({ request_id: sent[0].request_id, ok: true, state: { available: true } });
  assert.equal((await second).member_token, "own");
  assert.equal((await first).state.available, true);
  assert.equal(signaling.receive({ request_id: sent[1].request_id, ok: true }), false);
});

test("table changes reject pending requests and ignore old replies", async () => {
  const sent = [];
  const signaling = createVoiceSignaling({ send: data => { sent.push(data); return true; } });
  const pending = signaling.request("publish");
  const rejected = assert.rejects(pending, /voiceConnectionError/);
  signaling.reset();
  await rejected;
  assert.equal(signaling.receive({ request_id: sent[0].request_id, ok: true }), false);
  const next = signaling.request("resume");
  assert.notEqual(sent[0].request_id, sent[1].request_id);
  signaling.receive({ request_id: sent[1].request_id, ok: false, error_code: "hausdepp_voice_forbidden" });
  await assert.rejects(next, error => error.code === "hausdepp_voice_forbidden");
});

test("a closed game socket fails immediately without leaving a pending timeout", async () => {
  const signaling = createVoiceSignaling({ send: () => false });
  await assert.rejects(signaling.request("join"), /voiceConnectionError/);
  signaling.reset();
});
