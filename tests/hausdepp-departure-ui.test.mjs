import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { mountHausdeppDepartureUI } = await import(dataURL(await readFile(new URL("../frontend/hausdepp/departure-ui.js", import.meta.url), "utf8")));
const { HAUSDEPP_MESSAGES } = await import(dataURL(await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8")));

class Element extends EventTarget {
  children = [];
  parentElement = null;
  attributes = new Map();
  className = "";
  disabled = false;
  classList = {
    toggle: (name, active) => { this.className = active ? name : ""; },
    remove: () => { this.className = ""; },
  };
  setAttribute(key, value) { this.attributes.set(key, String(value)); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  append(node) { node.remove(); node.parentElement = this; this.children.push(node); }
  insertBefore(node, before) {
    node.remove(); node.parentElement = this;
    this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, node);
  }
  querySelector() { return this.children.find(child => child.account) || null; }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

function setup(language = "de") {
  const body = new Element(), heading = new Element(), result = new Element(), account = new Element();
  account.account = true; result.append(account);
  globalThis.document = { body, createElement: () => new Element(),
    querySelector: selector => selector === ".hd-room-heading" ? heading : result };
  const state = { connected: true, busy: false, spectating: false, version: 7,
    permissions: { can_leave: true, forfeits_round: true, ends_tournament_participation: false } };
  const prompts = [], requests = [], pending = [], timers = new Map();
  let timerId = 0;
  let confirm = true, sendOk = true, left = 0;
  const ui = mountHausdeppDepartureUI({ t: key => HAUSDEPP_MESSAGES[language][key] || key,
    getState: () => state, confirm(message) { prompts.push(message); return confirm; },
    send(message) { requests.push(message); return sendOk; }, onLeft() { left++; },
    onPendingChange(value) { state.busy = value; pending.push(value); },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { ui, body, state, prompts, requests, pending, heading, result, timers,
    button: heading.children[0], resultButton: result.children[0], notice: body.children[0],
    setConfirm(value) { confirm = value; }, setSendOk(value) { sendOk = value; }, get left() { return left; } };
}

for (const language of ["de", "en"]) {
  test(`${language}: confirmed active departure sends its own action and waits for server success`, () => {
    const app = setup(language);
    app.state.permissions.ends_tournament_participation = true; app.ui.render();
    app.button.click(); app.resultButton.click();
    assert.equal(app.prompts.length, 1);
    assert.equal(app.prompts[0], `${HAUSDEPP_MESSAGES[language].departureForfeitConfirm}\n\n${HAUSDEPP_MESSAGES[language].departureTournamentConfirm}`);
    assert.deepEqual(app.requests, [{ action: "hausdepp_leave_game", version: 7 }]);
    assert.equal(app.left, 0); assert.equal(app.button.disabled, true);
    assert.equal(app.ui.receive({ scoreboard: {} }), false); assert.equal(app.left, 0);
    assert.equal(app.ui.receive({ left_hausdepp_game: true, redirect: "/hausdepp" }), true);
    assert.equal(app.left, 1);
    assert.equal(app.timers.size, 0);
    assert.equal(app.ui.receive({ left_hausdepp_game: true }), false);
    app.ui.destroy();
  });
}

test("cancelling and an already finished hand never claim a forfeited round", () => {
  const app = setup(); app.setConfirm(false);
  app.button.click(); assert.equal(app.requests.length, 0); assert.equal(app.left, 0);
  app.state.permissions.forfeits_round = false;
  app.button.click();
  assert.equal(app.prompts.at(-1), HAUSDEPP_MESSAGES.de.departureFinishedConfirm);
  assert.equal(app.pending.length, 0);
  app.ui.destroy();
});

test("stale state and persistence rejection keep the player at the table and allow a fresh confirmation", () => {
  const app = setup(); app.button.click();
  app.state.version = 8;
  assert.equal(app.ui.reject({ error_code: "hausdepp_stale_version" }), true);
  assert.equal(app.left, 0); assert.equal(app.button.disabled, false);
  assert.equal(app.notice.textContent, HAUSDEPP_MESSAGES.de.departureChanged);
  app.button.click(); assert.equal(app.requests.at(-1).version, 8); assert.equal(app.prompts.length, 2);
  app.ui.reject({ error_code: "hausdepp_departure_persistence_failed" });
  assert.equal(app.notice.textContent, HAUSDEPP_MESSAGES.de.departureFailed);
  assert.equal(app.left, 0); app.ui.destroy();
});

test("lost connection and missing permissions never navigate or silently submit again", () => {
  const app = setup(); app.button.click(); app.state.connected = false; app.ui.disconnected();
  assert.equal(app.left, 0); assert.equal(app.requests.length, 1);
  assert.equal(app.notice.textContent, HAUSDEPP_MESSAGES.de.departureConnectionLost);
  app.state.connected = true; app.state.permissions.can_leave = false; app.ui.render();
  assert.equal(app.button.hidden, true); app.button.click(); assert.equal(app.requests.length, 1);
  app.state.permissions.can_leave = true; app.state.spectating = true; app.ui.render();
  assert.equal(app.button.hidden, true); app.button.click(); assert.equal(app.requests.length, 1);
  app.ui.destroy(); app.ui.destroy();
  assert.equal(app.heading.children.length, 0); assert.equal(app.result.children.length, 1);
});

test("an unconfirmed departure has a bounded wait and only an explicit retry sends again", () => {
  const app = setup(); app.button.click();
  assert.equal(app.timers.size, 1);
  for (const [id, callback] of [...app.timers]) { app.timers.delete(id); callback(); }
  assert.equal(app.state.busy, false); assert.equal(app.button.disabled, false);
  assert.equal(app.left, 0); assert.equal(app.requests.length, 1);
  assert.equal(app.notice.textContent, HAUSDEPP_MESSAGES.de.departureConnectionLost);
  app.button.click(); assert.equal(app.requests.length, 2); assert.equal(app.prompts.length, 2);
  app.ui.destroy(); assert.equal(app.timers.size, 0);
});
