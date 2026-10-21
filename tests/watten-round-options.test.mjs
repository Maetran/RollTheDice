import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/round-options.js", import.meta.url), "utf8");
const catalogSource = await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8");
const { WATTEN_MESSAGES } = await import(`data:text/javascript;base64,${Buffer.from(catalogSource).toString("base64")}`);
const esc = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function renderer(language = "de") {
  const context = { esc, t: (key, values = {}) => WATTEN_MESSAGES[language][key].replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "") };
  runInNewContext(source.replace(/^import .*;\n/gm, "").replaceAll("export function ", "function ")
    + "\nthis.render = roundOptionsMarkup; this.cards = bloedelnCardsMarkup;", context);
  return context;
}
function view(overrides = {}) {
  return { paused: false, busy: false, actions: ["request_bloedeln"],
    room: { seats: [{ name: "Geber" }, { name: "Ansager" }, { name: "Hansl <&>" }, { name: "Toni" }] },
    engine: { phase: "show_ready", current_trick: { cards: [] }, preplay: { pending: null, bloedeln_status: "available" } }, ...overrides };
}
const pending = { phase: "play", current_trick: { cards: [] }, preplay: {
  pending: { kind: "bloedeln", requester: 2, responder: 3 }, bloedeln_status: "pending",
} };

for (const language of ["de", "en"]) {
  test(`${language}: the optional Blödeln request is immediately visible without a disclosure or mandatory choices`, () => {
    const html = renderer(language).render(view());
    assert.match(html, /data-watten-action="request_bloedeln"/);
    assert.match(html, /Blödeln\?/);
    assert.doesNotMatch(html, /<details|data-watten-action="preplay_(?:accept|decline)"|data-watten-preplay-pending/);
    assert.ok(!html.includes("roundOptions."), "all visible copy is translated");
  });

  test(`${language}: only the recipient gets yes/no on the named request`, () => {
    const render = renderer(language).render;
    const html = render(view({ actions: ["preplay_accept", "preplay_decline"], engine: pending }));
    assert.match(html, /data-watten-preplay-pending="bloedeln"/);
    assert.match(html, /Hansl &lt;&amp;>/);
    assert.ok(html.includes(language === "de" ? "will blödeln" : "wants to play Blödeln"));
    assert.match(html, /data-watten-action="preplay_accept"/);
    assert.match(html, /data-watten-action="preplay_decline"/);
    assert.doesNotMatch(html, /data-watten-action="request_bloedeln"|<details/);
    const observer = render(view({ actions: [], engine: pending }));
    assert.doesNotMatch(observer, /<button/);
    assert.match(observer, /role="status"/);
    assert.match(observer, /Toni/);
  });

  test(`${language}: the short accepted/declined status yields the centre after the first card`, () => {
    const render = renderer(language).render;
    for (const status of ["accepted", "declined"]) {
      const engine = { phase: "play", current_trick: { cards: [] }, preplay: { pending: null, bloedeln_status: status } };
      const html = render(view({ actions: [], engine }));
      assert.match(html, new RegExp(`data-watten-bloedeln-status="${status}"`));
      assert.ok(html.includes(WATTEN_MESSAGES[language][status === "accepted" ? "roundOptions.bloedeln.enabled" : "roundOptions.bloedeln.disabled"]));
      assert.doesNotMatch(html, /<button|data-watten-preplay-pending/);
      engine.current_trick.cards.push({ seat: 0, card: "bells-7" });
      assert.equal(render(view({ actions: [], engine })), "");
    }
  });
}

test("other preplay options retain their disclosure after the directly accessible Blödeln request", () => {
  const html = renderer().render(view({ actions: ["request_bloedeln", "request_schoeneres"] }));
  assert.ok(html.indexOf('data-watten-action="request_bloedeln"') < html.indexOf("<details"));
  assert.match(html, /data-watten-action="request_schoeneres"/);
  assert.equal(html.match(/data-watten-action="request_bloedeln"/g).length, 1);
});

test("busy request answers are disabled and paused/completed rounds offer no stale choice", () => {
  const render = renderer().render;
  const html = render(view({ busy: true, actions: ["preplay_accept", "preplay_decline"], engine: pending }));
  assert.equal((html.match(/ disabled/g) || []).length, 2);
  assert.equal(render(view({ paused: true })), "");
  assert.equal(render(view({ actions: [], engine: { phase: "deal_complete", last_trick: { winner: 0 }, preplay: { bloedeln_status: "accepted" } } })), "");
  assert.equal(render(view({ actions: [], engine: { phase: "play", preplay: { pending: null, bloedeln_status: null } } })), "");
});

test("the preparation area never reveals a future forced card, including an own private projection", () => {
  const render = renderer();
  for (const status of ["available", "pending", "accepted", "declined"]) {
    const vm = view({ engine: { phase: "play", preplay: { bloedeln_status: status,
      bloedeln_cards: [{ seat: 2, card: "hearts-A" }, { seat: 3, card: "bells-7" }] } } });
    assert.equal(render.cards(vm), "");
  }
});
