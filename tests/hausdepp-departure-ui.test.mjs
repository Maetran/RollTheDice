import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const { mountHausdeppDepartureUI } = await import(dataURL(await readFile(new URL("../frontend/hausdepp/departure-ui.js", import.meta.url), "utf8")));
const { mountHandSelection } = await import(dataURL(await readFile(new URL("../frontend/hausdepp/hand-selection.js", import.meta.url), "utf8")));
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
  removeAttribute(key) { this.attributes.delete(key); }
  append(node) { node.remove(); node.parentElement = this; this.children.push(node); }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
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
  focus() { globalThis.document.activeElement = this; }
}

function setup(language = "de", initialState = {}) {
  const body = new Element(), handControls = new Element(), spectatorControls = new Element(), result = new Element(), account = new Element();
  account.account = true; result.append(account);
  globalThis.document = { body, createElement: () => new Element(),
    querySelector: () => result };
  const state = { connected: true, busy: false, spectating: false, version: 7,
    permissions: { can_leave: true, forfeits_round: true, ends_tournament_participation: false }, ...initialState };
  const prompts = [], dismissals = [], requests = [], pending = [], timers = new Map();
  let timerId = 0;
  let confirm = true, sendOk = true, left = 0;
  globalThis.window = { ZDWA_UI: {
    confirm(options) { prompts.push(options); return confirm; },
    dismiss(id, value) { dismissals.push({ id, value }); return true; },
  } };
  const ui = mountHausdeppDepartureUI({ t: key => HAUSDEPP_MESSAGES[language][key] || key, handControls, spectatorControls,
    getState: () => state,
    send(message) { requests.push(message); return sendOk; }, onLeft() { left++; },
    onPendingChange(value) { state.busy = value; pending.push(value); },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return { ui, body, state, prompts, dismissals, requests, pending, handControls, spectatorControls, result, timers,
    button: handControls.children[0] || spectatorControls.children[0], resultButton: result.children[0], notice: body.children[0],
    setConfirm(value) { confirm = value; }, setSendOk(value) { sendOk = value; }, get left() { return left; } };
}

for (const language of ["de", "en"]) {
  test(`${language}: confirmed active departure sends its own action and waits for server success`, () => {
    const app = setup(language);
    app.state.permissions.ends_tournament_participation = true; app.ui.render();
    app.button.click(); app.resultButton.click();
    assert.equal(app.prompts.length, 1);
    assert.equal(app.prompts[0].message, `${HAUSDEPP_MESSAGES[language].departureForfeitConfirm}\n\n${HAUSDEPP_MESSAGES[language].departureTournamentConfirm}`);
    assert.equal(app.prompts[0].id, "hausdepp-departure");
    assert.equal(app.prompts[0].kind, "hausdepp-departure");
    assert.equal(app.prompts[0].title, HAUSDEPP_MESSAGES[language].departureTournament);
    assert.equal(app.prompts[0].confirmLabel, HAUSDEPP_MESSAGES[language].departureTournament);
    assert.equal(app.prompts[0].cancelLabel, HAUSDEPP_MESSAGES[language].departureStay);
    assert.equal(app.prompts[0].danger, true);
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
  assert.equal(app.prompts.at(-1).message, HAUSDEPP_MESSAGES.de.departureFinishedConfirm);
  assert.equal(app.pending.length, 0);
  app.ui.destroy();
});

function deferredChoice() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("an asynchronous dialog prevents duplicate prompts and waits for acceptance and a server receipt", async () => {
  const app = setup(), choice = deferredChoice();
  app.setConfirm(choice.promise);
  app.resultButton.click(); app.button.click(); app.resultButton.click();
  assert.equal(app.prompts.length, 1);
  assert.equal(globalThis.document.activeElement, app.resultButton);
  assert.deepEqual(app.requests, []);
  assert.deepEqual(app.pending, []);
  assert.equal(app.timers.size, 0);
  choice.resolve(true); await choice.promise;
  assert.deepEqual(app.requests, [{ action: "hausdepp_leave_game", version: 7 }]);
  assert.equal(app.left, 0);
  assert.equal(app.ui.receive({ left_hausdepp_game: true }), true);
  assert.equal(app.left, 1);
  app.ui.destroy();
});

for (const decision of ["cancel", "rejection"]) {
  test(`an asynchronous ${decision} keeps the player at the table and permits a new prompt`, async () => {
    const app = setup(), choice = deferredChoice();
    app.setConfirm(choice.promise); app.button.click();
    if (decision === "cancel") choice.resolve(false);
    else choice.reject(new Error("Dialog unavailable"));
    await choice.promise.catch(() => {});
    assert.deepEqual(app.requests, []);
    assert.deepEqual(app.pending, []);
    assert.equal(app.left, 0);
    app.setConfirm(false); app.button.click();
    assert.equal(app.prompts.length, 2);
    app.ui.destroy();
  });
}

test("ordinary player actions keep the dialog open and confirmation sends the latest version", async () => {
  const app = setup(), choice = deferredChoice();
  app.setConfirm(choice.promise); app.button.click();
  app.state.version = 8; app.ui.render();
  assert.deepEqual(app.dismissals, []);
  assert.deepEqual(app.requests, []);
  choice.resolve(true); await choice.promise;
  assert.deepEqual(app.requests, [{ action: "hausdepp_leave_game", version: 8 }]);
  assert.equal(app.left, 0);
  app.ui.destroy();
});

for (const change of ["forfeit", "tournament", "permissions", "busy", "spectator", "disconnect", "destroy"]) {
  test(`a ${change} change dismisses only this asynchronous prompt and ignores late acceptance`, async () => {
    const app = setup(), choice = deferredChoice();
    app.setConfirm(choice.promise); app.button.click();
    if (change === "forfeit") app.state.permissions.forfeits_round = false;
    if (change === "tournament") app.state.permissions.ends_tournament_participation = true;
    if (change === "permissions") app.state.permissions.can_leave = false;
    if (change === "busy") app.state.busy = true;
    if (change === "spectator") app.state.spectating = true;
    if (change === "disconnect") app.ui.disconnected();
    else if (change === "destroy") app.ui.destroy();
    else app.ui.render();
    assert.deepEqual(app.dismissals, [{ id: "hausdepp-departure", value: false }]);
    choice.resolve(true); await choice.promise;
    assert.deepEqual(app.requests, []);
    assert.deepEqual(app.pending, []);
    assert.equal(app.left, 0);
    assert.equal(app.timers.size, 0);
    if (change === "spectator") { app.button.click(); assert.equal(app.left, 1); }
    app.ui.destroy();
  });
}

test("confirmation rechecks changed state even before its next render", async () => {
  const app = setup(), choice = deferredChoice();
  app.setConfirm(choice.promise); app.button.click();
  app.state.permissions.forfeits_round = false;
  choice.resolve(true); await choice.promise;
  assert.deepEqual(app.requests, []);
  assert.equal(app.left, 0);
  assert.equal(app.notice.textContent, HAUSDEPP_MESSAGES.de.departureChanged);
  app.ui.destroy();
});

for (const ending of ["cancel", "confirm", "disconnect", "destroy"]) {
  test(`the localized close label is restored for the next shared dialog after ${ending}`, async () => {
    const app = setup("en"), choice = deferredChoice(), close = new Element();
    close.setAttribute("aria-label", "Dialog schließen");
    app.setConfirm(choice.promise); app.button.click();
    app.prompts[0].onOpen({ dialog: { querySelector: () => close } });
    assert.equal(close.getAttribute("aria-label"), HAUSDEPP_MESSAGES.en.departureStay || "departureStay");
    if (ending === "disconnect") app.ui.disconnected();
    if (ending === "destroy") app.ui.destroy();
    choice.resolve(ending !== "cancel"); await choice.promise;
    assert.equal(close.getAttribute("aria-label"), "Dialog schließen");
    if (ending !== "confirm") assert.deepEqual(app.requests, []);
    app.ui.destroy();
  });
}

test("an unavailable suite dialog never falls back to a native browser confirmation", () => {
  const app = setup();
  globalThis.window = { confirm() { throw new Error("A native dialog must not open"); } };
  app.button.click();
  assert.deepEqual(app.requests, []);
  assert.equal(app.left, 0);
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
  app.ui.destroy(); app.ui.destroy();
  assert.equal(app.handControls.children.length, 0); assert.equal(app.result.children.length, 1);
});

for (const language of ["de", "en"]) {
  for (const phase of ["connecting", "waiting", "peeking", "playing", "paused", "finished", "aborted", "disconnected"]) {
    test(`${language}: spectators can leave ${phase} immediately without gameplay permission or a game action`, () => {
      const app = setup(language, { spectating: true, phase, connected: !["connecting", "disconnected"].includes(phase),
        busy: true, version: undefined, permissions: undefined });
      app.setConfirm(false);
      assert.equal(app.button.hidden, false);
      assert.equal(app.button.disabled, false);
      assert.equal(app.button.getAttribute("aria-label"), HAUSDEPP_MESSAGES[language].departureTable);
      assert.equal(app.button.getAttribute("aria-busy"), "false");
      assert.deepEqual(app.handControls.children, []);
      assert.deepEqual(app.spectatorControls.children, [app.button]);
      app.button.click(); app.button.click(); app.resultButton.click();
      assert.equal(app.left, 1);
      assert.deepEqual(app.prompts, []);
      assert.deepEqual(app.requests, []);
      assert.deepEqual(app.pending, []);
      assert.equal(app.timers.size, 0);
      app.ui.destroy();
      assert.deepEqual(app.spectatorControls.children, []);
    });
  }
  test(`${language}: spectator result exit stays local even when tournament departure permissions are present`, () => {
    const app = setup(language, { spectating: true, connected: false, busy: true,
      permissions: { can_leave: false, forfeits_round: true, ends_tournament_participation: true } });
    assert.equal(app.resultButton.hidden, false);
    assert.equal(app.resultButton.disabled, false);
    assert.equal(app.resultButton.textContent, HAUSDEPP_MESSAGES[language].departureTable);
    app.resultButton.click();
    assert.equal(app.left, 1);
    assert.deepEqual(app.requests, []);
    assert.deepEqual(app.prompts, []);
    app.ui.destroy();
  });
}

test("the same exit follows a role change without moving a participant's hand controls", () => {
  const app = setup();
  app.state.spectating = true; app.ui.render();
  assert.deepEqual(app.handControls.children, []);
  assert.deepEqual(app.spectatorControls.children, [app.button]);
  app.state.spectating = false; app.ui.render();
  assert.deepEqual(app.spectatorControls.children, []);
  assert.deepEqual(app.handControls.children, [app.button]);
  app.button.click();
  assert.deepEqual(app.requests, [{ action: "hausdepp_leave_game", version: 7 }]);
  assert.equal(app.left, 0);
  app.ui.destroy();
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

test("rotation keeps the exit in the hand rail while the same selection switch moves to the desktop bar and back", () => {
  const hand = new Element(), tools = new Element(), reactions = new Element();
  const wide = new EventTarget(); wide.matches = false;
  globalThis.document = { createElement: () => new Element() };
  globalThis.matchMedia = () => wide;
  const ui = mountHandSelection({ handRegion: hand, tools, reactions, t: key => key, onChange() {}, onPlay() {} });
  const toggle = ui.controls.children[0], exit = new Element();
  ui.controls.append(exit);
  const bar = hand.children.find(node => node.id === "hausdeppHandActions");
  assert.deepEqual(ui.controls.children, [toggle, exit]);
  wide.matches = true; wide.dispatchEvent(new Event("change"));
  assert.equal(toggle.parentElement, bar);
  assert.deepEqual(ui.controls.children, [exit]);
  wide.matches = false; wide.dispatchEvent(new Event("change"));
  assert.deepEqual(ui.controls.children, [toggle, exit]);
  assert.equal(toggle.parentElement, ui.controls);
  ui.destroy();
  wide.matches = true; wide.dispatchEvent(new Event("change"));
  assert.deepEqual(ui.controls.children, [toggle, exit]);
});
