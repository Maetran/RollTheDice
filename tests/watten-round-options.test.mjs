import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/round-options.js", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const { WATTEN_MESSAGES } = await import(`data:text/javascript;base64,${Buffer.from(catalogSource).toString("base64")}`);
const esc = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function markup(overrides = {}, language = "de") {
  const context = { esc, t: (key, values = {}) => WATTEN_MESSAGES[language][key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ""),
    isCard: () => false, cardFace: () => "" };
  runInNewContext(source.replace(/^import .*;\n/gm, "").replaceAll("export function ", "function ") + "\nthis.render = roundOptionsMarkup;", context);
  const vm = { paused: false, busy: false, actions: ["bloedeln_accept", "bloedeln_decline"],
    room: { seats: [{ name: "Geber" }, { name: "Ansager" }, { name: "Hansl <&>" }, { name: "Toni" }] },
    engine: { phase: "show_ready", preplay: { bloedeln_consent: { pending: true, decisions: [{ seat: 2, accepted: null }, { seat: 3, accepted: null }] } } }, ...overrides };
  return context.render(vm);
}

test("both Blödeln choices are immediately visible without opening an options disclosure", () => {
  for (const language of ["de", "en"]) {
    const html = markup({}, language);
    assert.match(html, /data-kind="bloedeln_accept"/);
    assert.match(html, /data-kind="bloedeln_decline"/);
    assert.doesNotMatch(html, /<details/);
    assert.match(html, /Hansl &lt;&amp;>/);
    assert.match(html, /data-watten-bloedeln-seat="2" data-decision="waiting"/);
    assert.ok(!html.includes("roundOptions."), "all visible copy is translated");
  }
});

test("the other player and observers see the first answer while the second remains pending", () => {
  const html = markup({ actions: [], engine: { phase: "play", preplay: { bloedeln_consent: {
    pending: true, decisions: [{ seat: 2, accepted: false }, { seat: 3, accepted: null }],
  } } } });
  assert.match(html, /data-watten-bloedeln-seat="2" data-decision="no"/);
  assert.match(html, /data-watten-bloedeln-seat="3" data-decision="waiting"/);
  assert.match(html, /data-watten-bloedeln-waiting/);
  assert.doesNotMatch(html, /<button/);
});

test("one no stays a visible declined result even after the second player answers yes", () => {
  const html = markup({ actions: [], engine: { phase: "play", preplay: { bloedeln_consent: {
    pending: false, decisions: [{ seat: 2, accepted: false }, { seat: 3, accepted: true }],
  } } } });
  assert.match(html, /Kein Blödeln/);
  assert.match(html, /data-watten-bloedeln-consent="settled"/);
  assert.doesNotMatch(html, /data-watten-bloedeln-waiting/);
});

test("paused play, completed first tricks and grandfathered rounds do not offer stale consent", () => {
  assert.equal(markup({ paused: true }), "");
  assert.equal(markup({ actions: [], engine: { phase: "play", last_trick: { winner: 0 }, preplay: {
    bloedeln_consent: { pending: false, decisions: [{ seat: 2, accepted: true }, { seat: 3, accepted: true }] },
  } } }), "");
  assert.equal(markup({ actions: [], engine: { phase: "play", preplay: {
    bloedeln_consent: { pending: false, decisions: [] },
  } } }), "");
});

test("a second preplay option does not hide the mandatory Blödeln decision", () => {
  const html = markup({ actions: ["bloedeln_accept", "bloedeln_decline", "request_schoeneres"] });
  assert.ok(html.indexOf('data-kind="bloedeln_accept"') < html.indexOf("<details"));
  assert.match(html, /data-kind="request_schoeneres"/);
  assert.doesNotMatch(html, /data-kind="request_bloedeln"/);
});
