import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/room/audio-contract.js", import.meta.url), "utf8");
const { voiceAccountSeat, continuationGameId } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

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

test("a continuation requires the confirmed source and stable group as well as a fresh safe target", () => {
  const valid = { source_game_id: "source", voice_group_id: "first-table", game_id: "next-game" };
  const expected = { sourceId: "source", groupId: "first-table" };
  assert.equal(continuationGameId(valid, expected), "next-game");
  for (const value of [null, {}, { ...valid, source_game_id: "foreign" }, { ...valid, voice_group_id: "other" },
    { ...valid, game_id: "source" }, { ...valid, game_id: "/spiel/foreign" }, { ...valid, game_id: "https://evil.invalid" },
    { ...valid, game_id: "x".repeat(65) }, { ...valid, game_id: 123 }]) assert.equal(continuationGameId(value, expected), null);
  assert.equal(continuationGameId({ ...valid, source_game_id: "", voice_group_id: "" }, { sourceId: "" }), null);
});
