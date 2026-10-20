import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/decor-sync.js", import.meta.url), "utf8");
const { preserveNewerTableProps } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const room = (revision, round = 1, game = "table") => ({
  _hausdepp_tournament: { round_number: round },
  _hausdepp: { version: 42 },
  _hausdepp_table_props: { schema_version: 1, game_id: game, round_number: round, revision, objects: { nuts: { remaining: 16 - revision } } },
});

test("a slower scoreboard retains newer shared use while accepting its card snapshot", () => {
  const previous = room(4), incoming = room(3);
  incoming._hausdepp.version = 43;
  const merged = preserveNewerTableProps(previous, incoming, "table");
  assert.equal(merged._hausdepp_table_props, previous._hausdepp_table_props);
  assert.equal(merged._hausdepp.version, 43);
  assert.equal(incoming._hausdepp_table_props.revision, 3);
});

test("newer and equal cosmetic revisions accept the incoming snapshot", () => {
  for (const revision of [4, 5]) {
    const incoming = room(revision);
    assert.equal(preserveNewerTableProps(room(4), incoming, "table"), incoming);
  }
});

test("a new round and a different table never inherit earlier consumption", () => {
  for (const [previous, incoming] of [[room(4), room(0, 2)], [room(4, 1, "other"), room(0)]]) {
    assert.equal(preserveNewerTableProps(previous, incoming, "table"), incoming);
  }
});

test("missing and unsupported projections keep the supplied room unchanged", () => {
  const unsupported = room(0); unsupported._hausdepp_table_props.schema_version = 2;
  for (const incoming of [{}, unsupported]) assert.equal(preserveNewerTableProps(room(4), incoming, "table"), incoming);
  const incoming = room(0);
  assert.equal(preserveNewerTableProps(null, incoming, "table"), incoming);
});
