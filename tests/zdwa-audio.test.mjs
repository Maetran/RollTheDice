import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/room/audio-contract.js", import.meta.url), "utf8");
const { voiceAccountSeat, continuationGameId, canCarryVoice, createAudioGame } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("only the bound account's own human seat can create voice; names and spectator IDs confer no access", () => {
  const seat = { id: "p1", user_id: 17, name: "Same name" };
  const board = { _players: [seat, { id: "cpu", user_id: 17, name: "CPU", is_cpu: true },
    { id: "p2", user_id: 18, name: "Same name" }, { id: "guest", name: "Same name" }] };
  assert.equal(voiceAccountSeat(board, "p1", 17), seat);
  assert.equal(voiceAccountSeat({ _participants: [seat] }, "p1", 17), seat);
  for (const [player, account, spectator] of [["p1", 17, true], ["cpu", 17], ["p2", 17], ["guest", 17],
    ["p1", null], ["p1", 0], ["p1", "17"], [null, 17], ["S-p1", 17]]) {
    assert.equal(voiceAccountSeat(board, player, account, spectator), null);
  }
  assert.equal(voiceAccountSeat(null, "p1", 17), null);
});

test("continuity requires voice availability but preserves an available table's manual listening off", () => {
  const board = { _finished: true, _players: [{ id: "p1", user_id: 17 }] };
  assert.equal(canCarryVoice(board, "p1", 17, { available: true, audio: false }), true);
  assert.equal(canCarryVoice(board, "p1", 17, { available: false, audio: true }), false);
  assert.equal(canCarryVoice({ ...board, _finished: false }, "p1", 17, { available: true }), false);
  assert.equal(canCarryVoice({ ...board, _aborted: true }, "p1", 17, { available: true }), false);
});

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const auth = id => ({ authenticated: id !== null, user: id === null ? null : { id, csrf_token: `csrf-${id}` } });
const next = { game_id: "next", source_game_id: "source", voice_group_id: "source" };
function creation({ replies, identity = () => auth(17), current = () => true } = {}) {
  const calls = [], handoffs = []; let reads = 0;
  const run = () => createAudioGame({ body: { name: "Next", mode: "2", source_game_id: "must-be-stripped" },
    sourceId: "source", expectedAccountId: 17, carry: true, isCurrent: current,
    loadAuth: async options => { assert.deepEqual(options, { refresh: true }); return identity(++reads); },
    fetcher: async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return replies[calls.length - 1]; },
    handoff: value => { handoffs.push(value); return continuationGameId(value, { sourceId: "source" }) !== null; },
  });
  return { run, calls, handoffs, reads: () => reads };
}

test("confirmed retired-source 404/409 performs exactly one independent create after fresh same-account verification", async () => {
  for (const [status, detail] of [[404, "zdwa_voice_source_not_found"], [409, "zdwa_voice_source_unavailable"]]) {
    const f = creation({ replies: [response(status, { detail }), response(200, { game_id: "fresh" })] });
    assert.deepEqual(await f.run(), { game_id: "fresh" });
    assert.equal(f.calls.length, 2); assert.equal(f.reads(), 2);
    assert.equal(f.calls[0].body.source_game_id, "source");
    assert.equal("source_game_id" in f.calls[1].body, false);
    assert.equal(f.calls[1].headers["X-CSRF-Token"], "csrf-17");
    assert.deepEqual(f.handoffs, []);
  }
});

test("auth, CSRF, generic/proxy errors and a failed independent create cannot trigger another create", async () => {
  for (const [status, detail] of [[401, "zdwa_voice_source_not_found"], [403, "zdwa_voice_source_unavailable"],
    [409, "csrf_rejected"], [404, "Not Found"], [409, "other"], [503, "zdwa_voice_source_unavailable"]]) {
    const f = creation({ replies: [response(status, { detail })] });
    await assert.rejects(f.run(), /HTTP/); assert.equal(f.calls.length, 1); assert.deepEqual(f.handoffs, []);
  }
  const f = creation({ replies: [response(404, { detail: "zdwa_voice_source_not_found" }),
    response(409, { detail: "zdwa_voice_source_unavailable" })] });
  await assert.rejects(f.run(), /HTTP 409/); assert.equal(f.calls.length, 2); assert.deepEqual(f.handoffs, []);
});

test("a changed account or retired page prevents the independent retry", async () => {
  for (const second of [auth(18), auth(null)]) {
    const f = creation({ replies: [response(404, { detail: "zdwa_voice_source_not_found" })],
      identity: read => read === 1 ? auth(17) : second });
    await assert.rejects(f.run(), /account_changed/); assert.equal(f.calls.length, 1); assert.deepEqual(f.handoffs, []);
  }
  let current = true;
  const f = creation({ replies: [response(409, { detail: "zdwa_voice_source_unavailable" })], current: () => current,
    identity: read => { if (read === 2) current = false; return auth(17); } });
  await assert.rejects(f.run(), /account_changed/); assert.equal(f.calls.length, 1);
});

test("a retired page cannot hand off a successful response that arrived after navigation", async () => {
  let current = true;
  const late = response(200, next);
  late.json = async () => { current = false; return next; };
  const f = creation({ replies: [late], current: () => current });
  await assert.rejects(f.run(), /account_changed/);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.handoffs, []);
});

test("valid continuity still hands off the confirmed target exactly once", async () => {
  const f = creation({ replies: [response(200, next)] });
  assert.deepEqual(await f.run(), next); assert.equal(f.calls.length, 1); assert.equal(f.reads(), 1);
  assert.deepEqual(f.handoffs, [next]);
});

test("a continuation requires the confirmed source and stable group as well as a fresh safe target", () => {
  const valid = { source_game_id: "source", voice_group_id: "first-table", game_id: "next-game" };
  const expected = { sourceId: "source", groupId: "first-table" };
  assert.equal(continuationGameId(valid, expected), "next-game");
  for (const value of [null, {}, { ...valid, source_game_id: "foreign" }, { ...valid, voice_group_id: "other" },
    { ...valid, game_id: "source" }, { ...valid, game_id: "/spiel/foreign" }, { ...valid, game_id: "https://evil.invalid" },
    { ...valid, game_id: "x".repeat(65) }, { ...valid, game_id: 123 }]) assert.equal(continuationGameId(value, expected), null);
  assert.equal(continuationGameId({ ...valid, source_game_id: "", voice_group_id: "" }, { sourceId: "" }), null);
});
