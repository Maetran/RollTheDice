import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dataURL = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const soundSource = await readFile(new URL("../frontend/hausdepp/sound-ui.js", import.meta.url), "utf8");
const voiceSource = (await readFile(new URL("../frontend/hausdepp/voice-ui.js", import.meta.url), "utf8"))
  .replace('import { escapeHtml as esc } from "../shared/auth.js";', 'const esc = value => String(value);');
const { mountHausdeppSoundUI } = await import(dataURL(soundSource));
const { mountHausdeppVoiceUI } = await import(dataURL(voiceSource));
const { HAUSDEPP_MESSAGES } = await import(dataURL(await readFile(new URL("../frontend/i18n/catalog.js", import.meta.url), "utf8")));
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

class Element extends EventTarget {
  children = [];
  parentElement = null;
  attributes = new Map();
  dataset = {};
  className = "";
  textContent = "";
  hidden = false;
  disabled = false;
  classList = {
    add: name => { if (!this.className.split(" ").includes(name)) this.className = `${this.className} ${name}`.trim(); },
    remove: name => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); },
    toggle: (name, active) => this.classList[active ? "add" : "remove"](name),
  };
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } }
  prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); }
  insertBefore(node, before) {
    node.remove(); node.parentElement = this;
    const index = this.children.indexOf(before);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
  }
  after(node) {
    const parent = this.parentElement, index = parent.children.indexOf(this);
    node.remove(); node.parentElement = parent; parent.children.splice(index + 1, 0, node);
  }
  remove() {
    if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
    this.parentElement = null;
  }
  replaceChildren(...nodes) { for (const child of [...this.children]) child.remove(); this.append(...nodes); }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith(".") ? node.className.split(" ").includes(selector.slice(1))
      : selector.startsWith("#") ? node.id === selector.slice(1) : false;
    return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  click() { if (!this.disabled) this.dispatchEvent(new Event("click")); }
}

function setup(language = "de") {
  const body = new Element(), tools = new Element(), help = new Element();
  tools.className = "hd-header-tools"; help.className = "hd-game-help"; body.append(tools, help);
  globalThis.document = { body, activeElement: null, createElement: () => new Element(),
    querySelector: selector => body.querySelector(selector), querySelectorAll: selector => body.querySelectorAll(selector) };
  const soundListeners = new Set(), voiceListeners = new Set(), cues = [], calls = [];
  const soundState = { enabled: false, supported: true, status: "idle", errorKey: "" };
  const voiceState = { supported: true, available: true, audio: false, microphone: false, connected: true,
    status: "idle", errorKey: "", members: [], mutedUsers: [] };
  const updateSound = changes => { Object.assign(soundState, changes); for (const listener of soundListeners) listener({ ...soundState }); };
  const updateVoice = changes => { Object.assign(voiceState, changes); for (const listener of voiceListeners) listener({ ...voiceState }); };
  const sound = { snapshot: () => ({ ...soundState }),
    subscribe(listener) { soundListeners.add(listener); listener(this.snapshot()); return () => soundListeners.delete(listener); },
    unlock() { calls.push("unlock"); },
    setEnabled(enabled) { calls.push(enabled); updateSound({ enabled }); return Promise.resolve(true); },
    cue(kind) { if (soundState.enabled) cues.push(kind); } };
  const controller = { snapshot: () => ({ ...voiceState }),
    subscribe(listener) { voiceListeners.add(listener); listener(this.snapshot()); return () => voiceListeners.delete(listener); },
    setAudio(enabled) { updateVoice({ audio: enabled, ...(!enabled ? { microphone: false } : {}) }); return Promise.resolve(true); },
    setMicrophone(enabled) { updateVoice({ microphone: enabled }); return Promise.resolve(true); },
  };
  const t = key => HAUSDEPP_MESSAGES[language][key] || key;
  const soundUI = mountHausdeppSoundUI({ controller: sound, t });
  const voiceUI = mountHausdeppVoiceUI({ controller, sound, t, userId: 1, getPlayers: () => [] });
  const $ = id => body.querySelector(`#${id}`);
  return { sound, controller, soundUI, voiceUI, $, tools, calls, cues, updateSound, updateVoice,
    destroy() { soundUI.destroy(); voiceUI.destroy(); } };
}

for (const language of ["de", "en"]) {
  test(`${language}: local sound opt-in and reattachment preserve the same accessible switch`, async () => {
    const app = setup(language), button = app.$("hausdeppSound");
    assert.equal(button.getAttribute("aria-pressed"), "false");
    assert.equal(button.getAttribute("aria-label"), HAUSDEPP_MESSAGES[language].soundOn);
    button.click(); await settle();
    assert.deepEqual(app.calls, ["unlock", true]);
    assert.equal(button.getAttribute("aria-label"), HAUSDEPP_MESSAGES[language].soundOff);
    const nextTools = new Element(); nextTools.className = "hd-header-tools";
    app.tools.remove(); document.body.append(nextTools);
    app.voiceUI.attach(); app.soundUI.attach();
    assert.equal(app.$("hausdeppSound"), button);
    assert.equal(nextTools.children[0].className, "hd-voice-controls");
    assert.equal(nextTools.children[1].className, "hd-sound-controls");
    button.click(); await settle(); assert.equal(button.getAttribute("aria-pressed"), "false");
    app.destroy(); assert.equal(app.$("hausdeppSound"), null);
  });
}

test("voice and microphone confirmations obey local sound opt-in and actual user changes", async () => {
  const app = setup(), output = app.$("hausdeppVoiceAudio"), microphone = app.$("hausdeppVoiceMicrophone");
  output.click(); await settle(); microphone.click(); await settle();
  assert.deepEqual(app.cues, []);
  app.updateSound({ enabled: true });
  microphone.click(); await settle();
  microphone.click(); await settle();
  assert.deepEqual(app.cues, ["mic-off", "mic-on"]);
  // Automatic capture loss or state rendering is deliberately silent.
  app.updateVoice({ microphone: false }); app.voiceUI.render();
  assert.deepEqual(app.cues, ["mic-off", "mic-on"]);
  app.controller.setMicrophone = () => Promise.resolve(false);
  microphone.click(); await settle();
  assert.deepEqual(app.cues, ["mic-off", "mic-on"]);
  output.click(); await settle(); output.click(); await settle();
  assert.deepEqual(app.cues, ["mic-off", "mic-on", "voice-off", "voice-on"]);
  app.updateSound({ enabled: false }); output.click(); await settle();
  assert.deepEqual(app.cues, ["mic-off", "mic-on", "voice-off", "voice-on"]);
  app.destroy();
});

test("late activation replies cannot confirm a retired voice or microphone action", async () => {
  const app = setup(), output = app.$("hausdeppVoiceAudio"), microphone = app.$("hausdeppVoiceMicrophone");
  app.updateSound({ enabled: true });
  const joining = deferred(), enabling = deferred();
  app.controller.setAudio = enabled => {
    app.updateVoice({ audio: enabled, microphone: false });
    return enabled ? joining.promise : Promise.resolve(true);
  };
  output.click(); output.click(); joining.resolve(true); await settle();
  assert.deepEqual(app.cues, ["voice-off"]);
  app.updateVoice({ audio: true });
  app.controller.setMicrophone = () => enabling.promise;
  microphone.click();
  app.voiceUI.destroy();
  app.updateVoice({ microphone: true }); enabling.resolve(true); await settle();
  assert.deepEqual(app.cues, ["voice-off"]);
  app.soundUI.destroy();
});

test("unsupported sound stays disabled and playback failure does not disable voice", async () => {
  const app = setup(), sound = app.$("hausdeppSound"), output = app.$("hausdeppVoiceAudio");
  app.updateSound({ supported: false });
  assert.equal(sound.disabled, true); sound.click(); assert.deepEqual(app.calls, []);
  assert.equal(app.$("hausdeppSoundDescription").textContent, HAUSDEPP_MESSAGES.de.soundUnsupported);
  app.updateSound({ supported: true, errorKey: "soundUnavailable", status: "error" });
  output.click(); await settle();
  assert.equal(output.getAttribute("aria-pressed"), "true");
  assert.deepEqual(app.cues, []);
  app.destroy();
});

const wattenSource = (await readFile(new URL('../frontend/watten/sound.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
const { mountWattenSoundUI } = await import(dataURL(wattenSource));
for (const language of ['de', 'en']) {
  test(`${language}: labelled Watten ambience opt-in survives relocation and stays independent of voice`, async () => {
    const app = setup(language), container = new Element(), waiting = new Element();
    document.body.append(container, waiting);
    const ui = mountWattenSoundUI({ controller: app.sound, container, t: key => HAUSDEPP_MESSAGES[language][key] });
    const button = container.querySelector('#wattenSound');
    assert.equal(button.getAttribute('aria-label'), HAUSDEPP_MESSAGES[language].soundOn);
    assert.match(button.innerHTML, new RegExp(HAUSDEPP_MESSAGES[language].soundAmbienceLabel));
    assert.equal(button.getAttribute('aria-pressed'), 'false');
    const before = app.calls.length, voiceBefore = app.controller.snapshot();
    waiting.append(container); button.click(); await settle();
    assert.equal(button.getAttribute('aria-pressed'), 'true');
    assert.equal(waiting.querySelector('#wattenSound'), button);
    assert.deepEqual(app.calls.slice(before), ['unlock', true]);
    assert.deepEqual(app.controller.snapshot(), voiceBefore, 'ambience must not change microphone or voice participation');
    app.updateSound({ status: 'error', enabled: false, errorKey: 'soundUnavailable' });
    assert.equal(button.dataset.error, 'true');
    assert.equal(button.title, HAUSDEPP_MESSAGES[language].soundUnavailable);
    app.updateSound({ supported: false }); assert.equal(button.disabled, true);
    ui.destroy(); assert.equal(waiting.querySelector('#wattenSound'), null);
    app.destroy();
  });
}
