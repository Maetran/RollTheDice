import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/round-options.js", import.meta.url), "utf8");
const gameSource = await readFile(new URL("../frontend/watten/game.js", import.meta.url), "utf8");
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
  return { paused: false, busy: false, viewerSeat: 2, actions: ["request_bloedeln"],
    room: { seats: [{ name: "Geber" }, { name: "Ansager" }, { name: "Hansl <&>" }, { name: "Toni" }] },
    engine: { phase: "show_ready", dealer_seat: 0, current_trick: { cards: [] }, preplay: { pending: null, bloedeln_status: "available" } }, ...overrides };
}
const pending = { phase: "play", dealer_seat: 0, current_trick: { cards: [] }, preplay: {
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
    const html = render(view({ viewerSeat: 3, actions: ["preplay_accept", "preplay_decline"], engine: pending }));
    assert.match(html, /data-watten-preplay-pending="bloedeln"/);
    assert.match(html, /Hansl &lt;&amp;>/);
    assert.ok(html.includes(language === "de" ? "will blödeln" : "wants to play Blödeln"));
    assert.match(html, /data-watten-action="preplay_accept"/);
    assert.match(html, /data-watten-action="preplay_decline"/);
    assert.doesNotMatch(html, /data-watten-action="request_bloedeln"|<details/);
    const requester = render(view({ actions: [], engine: pending }));
    assert.ok(requester.includes(language === "de" ? "Du fragst" : "You ask"));
    assert.match(requester, /Toni/);
    assert.ok(requester.includes(WATTEN_MESSAGES[language]["roundOptions.bloedeln.description"]));
    const observer = render(view({ viewerSeat: 0, actions: [], engine: pending }));
    assert.doesNotMatch(observer, /<button/);
    assert.match(observer, /role="status"/);
    assert.match(observer, /Toni/);
    assert.match(observer, /Hansl &lt;&amp;>/);
    assert.ok(!observer.includes(WATTEN_MESSAGES[language]["roundOptions.bloedeln.description"]));
    assert.equal(render(view({ viewerSeat: null, actions: [], engine: pending })), observer);
  });

  test(`${language}: only an accepted request shows a status, until the first card`, () => {
    const render = renderer(language).render;
    for (const status of ["accepted", "declined"]) {
      const engine = { phase: "play", dealer_seat: 0, current_trick: { cards: [] }, preplay: { pending: null, bloedeln_status: status } };
      const html = render(view({ viewerSeat: 0, actions: [], engine }));
      if (status === "declined") {
        assert.equal(html, "");
        continue;
      }
      assert.match(html, new RegExp(`data-watten-bloedeln-status="${status}"`));
      assert.match(html, /Hansl &lt;&amp;>/);
      assert.match(html, /Toni/);
      assert.ok(html.includes(language === "de" ? "blödeln." : "are playing Blödeln."));
      assert.ok(!html.includes(language === "de" ? "Du und" : "You and"));
      assert.doesNotMatch(html, /<button|data-watten-preplay-pending/);
      engine.current_trick.cards.push({ seat: 0, card: "bells-7" });
      assert.equal(render(view({ actions: [], engine })), "");
    }
  });

  test(`${language}: agreed Blödeln names the actual non-callers for every dealer and viewer role`, () => {
    const render = renderer(language).render;
    for (const dealer of [0, 1, 2, 3]) {
      const participants = [(dealer + 2) % 4, (dealer + 3) % 4];
      const engine = { phase: "show_ready", dealer_seat: dealer, current_trick: { cards: [] },
        preplay: { pending: null, bloedeln_status: "accepted" } };
      for (const viewerSeat of [0, 1, 2, 3, null]) {
        const vm = view({ viewerSeat, actions: [], engine });
        const html = render(vm);
        const involved = participants.includes(viewerSeat);
        assert.equal(html.includes(language === "de" ? "Du und" : "You and"), involved);
        for (const seat of participants.filter(seat => seat !== viewerSeat)) {
          assert.ok(html.includes(esc(vm.room.seats[seat].name)));
        }
        for (const seat of [dealer, (dealer + 1) % 4]) {
          assert.ok(!html.includes(esc(vm.room.seats[seat].name)), "an inspector is never named as a Blödeln participant");
        }
        assert.doesNotMatch(html, /<button|data-card=|wt-card/);
        assert.ok(!html.includes("Ihr blödelt"));
      }
    }
  });

  test(`${language}: live waiting advice reads the current pending DTO and names its responder`, () => {
    const context = { session: {}, t: (key, values = {}) => WATTEN_MESSAGES[language][key]
      .replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "") };
    const liveSource = gameSource.slice(gameSource.indexOf("function liveMessage("), gameSource.indexOf("\nfunction render(", gameSource.indexOf("function liveMessage(")));
    runInNewContext(`${liveSource}\nthis.live = liveMessage;`, context);
    const snapshot = view();
    const waiting = context.live(snapshot, pending, []);
    assert.equal(waiting, language === "de" ? "Toni entscheidet über Blödeln." : "Toni is deciding on Blödeln.");
    const recipient = context.live(snapshot, pending, ["preplay_accept", "preplay_decline"]);
    assert.equal(recipient, WATTEN_MESSAGES[language]["roundOptions.bloedeln.pending"].replace("{name}", "Hansl <&>"));
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
