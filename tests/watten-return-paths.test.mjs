import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/multigame/routes.js", import.meta.url), "utf8");
const { wattenAccountReturnPath } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const table = "/watten/spiel/0123456789abcdef";
const allowed = ["/watten", "/watten/konto", "/watten/konto/einstellungen", "/watten/konto/fortschritt", "/watten/konto/verlauf", "/watten/rangliste", "/watten/regeln", table, `${table}/zuschauen`];

test("Watten returns preserve exact native destinations including the canonical table and spectator", () => {
  for (const path of allowed) assert.equal(wattenAccountReturnPath(path), path);
});

test("Watten returns reject foreign URLs, malformed IDs, queries, fragments and nested handoffs", () => {
  for (const value of [null, undefined, true, 1, [], {}, "", "https://evil.invalid/", "//evil.invalid/",
    "/hausdepp/konto", "/watten/anmelden", "/watten/spiel/one", table.toUpperCase(), `${table}0`, table.slice(0, -1),
    `${table}/`, `${table}/zuschauen/`, `${table}?pass=secret`, `${table}#secret`, `${table}%0a`,
    `${table.replace("/spiel/", "%2fspiel%2f")}`, `/auth/continue?app=watten&path=${table}`,
    ...allowed.flatMap(path => [` ${path}`, `${path} `, `${path}?return_to=//evil.invalid`, `${path}#token=secret`])]) {
    assert.equal(wattenAccountReturnPath(value), null, JSON.stringify(value));
  }
});

test("Watten returns reject every trailing line terminator instead of normalizing it", () => {
  for (const path of allowed) {
    for (const suffix of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
      assert.equal(wattenAccountReturnPath(path + suffix), null, JSON.stringify(path + suffix));
    }
  }
});
