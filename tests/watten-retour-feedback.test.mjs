import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = (await readFile(new URL("../frontend/watten/retourschneider.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").replace(/export /g, "");
class Element {
  children = []; dataset = {}; hidden = false; innerHTML = ""; listeners = new Map(); isConnected = true;
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren() { this.children = []; this.innerHTML = ""; }
  remove() { this.isConnected = false; }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
}
function fixture({ storage = new Map(), accountId = 1 } = {}) {
  const body = new Element(), banner = new Element(), live = new Element(), timers = new Map();
  let serial = 0;
  const create = runInNewContext(`${source};createRetourAnnouncement`, {
    document: { body, createElement: () => new Element() }, t: key => key, esc: text => text,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: fn => { const id = ++serial; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
  });
  const controller = create(banner, { accountId, liveNode: live });
  const notice = body.children.find(node => node !== banner);
  return { controller, banner, notice, live, storage, timers,
    dismiss: () => notice.listeners.get("click")({ target: { closest: () => true } }) };
}
const vm = (status, { deal = "offer-deal", match = "match-1", player = "p1" } = {}) => ({ snapshot: { id: match }, playerId: player,
  engine: { deal_id: deal, retourschneider: { status, after_deal_id: "offer-deal", members: ["p1", "p3"] } } });

test("compact Retour choices keep the full conditions and accessible decision names, including the saved-yes waiting state", () => {
  const messages = {
    "retour.title": "Play a Retourschneider?", "retour.titleShort": "Retourschneider?", "retour.offer": "Erase the score; every remaining round must be won. A loss costs two marks.",
    "retour.accept": "Yes, Retourschneider", "retour.decline": "No, keep our score", "retour.acceptShort": "Yes", "retour.declineShort": "No",
    "retour.details": "Retourschneider conditions", "retour.partnerWaiting": "Your yes is saved. {names} still needs to agree.",
  };
  const markup = runInNewContext(`${source};retourschneiderChoiceMarkup`, { esc: text => text,
    t: (key, values = {}) => (messages[key] || key).replace("{names}", values.names || "") });
  const model = { ...vm("available"), actions: ["retourschneider"], room: { seats: [
    { participant_id: "p1", name: "Own" }, { participant_id: "p3", name: "Partner" }] } };
  const initial = markup(model);
  assert.match(initial, /class="wt-retour-rules" role="region" tabindex="0" aria-label="Retourschneider conditions"/);
  assert.ok(initial.includes(messages["retour.offer"]), "the complete consequences remain in the keyboard-reachable rule body");
  assert.match(initial, /<h3 aria-label="Play a Retourschneider\?">/);
  assert.match(initial, /class="wt-retour-title-short" aria-hidden="true">Retourschneider\?</);
  assert.match(initial, /aria-label="Yes, Retourschneider"/);
  assert.match(initial, /aria-label="No, keep our score"/);
  assert.match(initial, /class="wt-retour-choice-short" aria-hidden="true">Yes</);
  assert.equal((initial.match(/data-watten-action="retourschneider"/g) || []).length, 2);
  model.engine.retourschneider.accepted_by = ["p1"];
  const accepted = markup(model);
  assert.match(accepted, /Your yes is saved. Partner still needs to agree./);
  assert.ok(accepted.includes(messages["retour.offer"]));
  assert.doesNotMatch(accepted, /data-watten-action="retourschneider"/);
});

test("a declined joint choice explains the preserved score and survives the immediate next deal until dismissed", () => {
  const f = fixture(); f.controller.update(vm("available"));
  f.controller.update(vm("declined"));
  assert.equal(f.notice.hidden, false); assert.match(f.notice.innerHTML, /retour.declinedTitle/); assert.match(f.notice.innerHTML, /retour.declined/);
  assert.equal(f.banner.hidden, true, "declines do not run the accepted full-screen animation");
  f.controller.update(vm("declined", { deal: "next-deal" })); assert.equal(f.notice.hidden, false);
  f.dismiss(); f.controller.update(vm("declined", { deal: "next-deal" })); assert.equal(f.notice.hidden, true);
});

test("a late next-deal snapshot still explains a choice observed before the decline arrived", () => {
  const f = fixture(); f.controller.update(vm("available"));
  f.controller.update(vm("declined", { deal: "next-deal" })); assert.equal(f.notice.hidden, false);
});

test("old decisions, opponents and spectators do not receive an own-team explanation", () => {
  for (const options of [{ deal: "later-deal" }, { player: "p2" }, { player: null }]) {
    const f = fixture(); f.controller.update(vm("declined", options)); assert.equal(f.notice.hidden, true);
  }
});

test("decision notices remain scoped to the account and match and do not repeat after reload", () => {
  const f = fixture(); f.controller.update(vm("declined")); assert.equal(f.notice.hidden, false);
  const repeat = fixture({ storage: f.storage }); repeat.controller.update(vm("declined")); assert.equal(repeat.notice.hidden, true);
  const otherAccount = fixture({ storage: f.storage, accountId: 2 }); otherAccount.controller.update(vm("declined")); assert.equal(otherAccount.notice.hidden, false);
  const otherMatch = fixture({ storage: f.storage }); otherMatch.controller.update(vm("declined", { match: "match-2" })); assert.equal(otherMatch.notice.hidden, false);
});

test("accepted challenges retain their separate one-time animation and accessible live announcement", () => {
  const f = fixture(); f.controller.update(vm("active"));
  assert.equal(f.banner.hidden, false); assert.equal(f.notice.hidden, true); assert.equal(f.timers.size, 2);
  assert.match(f.banner.innerHTML, /retour.announcementTitle/);
  f.controller.update(vm("active", { deal: "next-deal" })); assert.equal(f.timers.size, 2);
  f.controller.destroy(); assert.equal(f.timers.size, 0); assert.equal(f.banner.isConnected, false); assert.equal(f.notice.isConnected, false); assert.equal(f.live.textContent, "");
});
