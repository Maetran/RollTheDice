import { createHausdeppVoice } from "../hausdepp/voice.js";
import { createVoiceSignaling } from "../hausdepp/voice-signaling.js";
import { createVoiceTableLifecycle, queueVoiceTableLeft, showVoiceStatus } from "../shared/voice-table-lifecycle.js";
import { createTavernSound } from "../shared/tavern-sound.js";
import { escapeHtml as esc } from "../shared/auth.js";
import { HAUSDEPP_MESSAGES, ZDWA_AUDIO_MESSAGES } from "../i18n/catalog.js";
import { zdwaPath } from "../multigame/routes.js";
import { continuationGameId, voiceAccountSeat } from "./audio-contract.js";

export const roomAudioText = key => {
  const language = window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
  return ZDWA_AUDIO_MESSAGES[language][key] ?? HAUSDEPP_MESSAGES[language][key] ?? key;
};
const safely = operation => { void Promise.resolve(operation).catch(() => {}); };

/** One local audio hub; only a privately bound account seat can create voice. */
export function createRoomAudio({ gameId, send, spectator = false }) {
  let auth = null, board = null, playerId = null, bound = false, online = false, stopped = false;
  let controller = null, lifecycle = null, signaling = null, unsubscribeVoice = null;
  let voiceUserId = null, rosterSignature = "";
  const lifetime = new AbortController();
  const sound = createTavernSound();
  const toggle = document.createElement("button");
  toggle.id = "roomAudioButton"; toggle.type = "button"; toggle.className = "small ghost room-audio-toggle";
  toggle.setAttribute("aria-haspopup", "dialog"); toggle.setAttribute("aria-controls", "roomAudioPanel");
  toggle.setAttribute("aria-expanded", "false");
  const panel = document.createElement("dialog");
  panel.id = "roomAudioPanel"; panel.className = "room-audio-panel";
  panel.setAttribute("aria-labelledby", "roomAudioTitle");
  panel.innerHTML = `<div class="room-audio-head"><h2 id="roomAudioTitle"></h2><button type="button" data-audio-close>×</button></div>
    <section data-room-voice hidden><h3 data-audio-voice-heading></h3><div class="room-audio-buttons"><button type="button" data-room-listening></button><button type="button" data-room-microphone></button></div>
      <p class="small" data-room-voice-status role="status"></p><ul class="room-audio-roster" data-room-voice-roster></ul><p class="small" data-room-voice-privacy></p></section>
    <section><h3 data-audio-ambient-heading></h3><button type="button" data-room-ambience></button><p class="small" data-room-sound-status role="status"></p><p class="small" data-room-sound-description></p></section>
    <p class="small" data-room-profile-hint></p><a class="small" data-room-profile-link></a>`;
  document.body.append(panel);
  document.querySelector(".room-header-overflow")?.before(toggle);
  const find = selector => panel.querySelector(selector);
  const listening = find("[data-room-listening]"), mic = find("[data-room-microphone]"), ambience = find("[data-room-ambience]");
  const roster = find("[data-room-voice-roster]");
  const text = (selector, key) => { find(selector).textContent = roomAudioText(key); };
  const close = () => { panel.close(); };
  toggle.addEventListener("click", () => {
    document.getElementById("roomHeaderMenuToggle")?.getAttribute("aria-expanded") === "true"
      && document.getElementById("roomHeaderMenuToggle").click();
    if (!panel.open) panel.showModal();
    toggle.setAttribute("aria-expanded", "true");
  }, { signal: lifetime.signal });
  find("[data-audio-close]").addEventListener("click", close, { signal: lifetime.signal });
  panel.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    if (!stopped) toggle.focus({ preventScroll: true });
  }, { signal: lifetime.signal });
  panel.addEventListener("keydown", event => {
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll('button:not(:disabled), a[href]')].filter(element => element.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, { signal: lifetime.signal });
  listening.addEventListener("click", () => {
    if (controller) safely(controller.setAudio(!controller.snapshot().audio));
  }, { signal: lifetime.signal });
  mic.addEventListener("click", () => {
    if (controller) safely(controller.setMicrophone(!controller.snapshot().microphone));
  }, { signal: lifetime.signal });
  ambience.addEventListener("click", () => safely(sound.setEnabled(!sound.snapshot().enabled)), { signal: lifetime.signal });
  roster.addEventListener("click", event => {
    const button = event.target.closest("[data-room-voice-mute]");
    if (button && controller) controller.muteUser(Number(button.dataset.roomVoiceMute), button.getAttribute("aria-pressed") !== "true");
  }, { signal: lifetime.signal });

  function render() {
    if (stopped) return;
    toggle.textContent = roomAudioText("button"); toggle.title = roomAudioText("title");
    toggle.setAttribute("aria-label", roomAudioText("title"));
    text("#roomAudioTitle", "title"); text("[data-audio-close]", "close");
    text("[data-audio-voice-heading]", "voiceTitle"); text("[data-audio-ambient-heading]", "soundAmbienceLabel");
    text("[data-room-sound-description]", "soundDescription"); text("[data-room-profile-hint]", "voiceProfileHint");
    text("[data-room-profile-link]", "profile"); find("[data-room-profile-link]").href = zdwaPath("/konto#settings");
    find("[data-room-profile-link]").hidden = !auth?.authenticated;
    const soundState = sound.snapshot();
    ambience.textContent = roomAudioText(soundState.enabled ? "soundOff" : "soundOn");
    ambience.setAttribute("aria-pressed", String(soundState.enabled)); ambience.disabled = !soundState.supported;
    text("[data-room-sound-status]", soundState.errorKey || (soundState.status === "loading" ? "soundLoading"
      : !soundState.supported ? "soundUnsupported" : soundState.enabled ? "soundEnabled" : "soundDisabled"));
    find("[data-room-voice]").hidden = !controller;
    if (!controller) return;
    const state = controller.snapshot();
    listening.textContent = roomAudioText(state.audio ? "voiceAudioOff" : "voiceAudioOn");
    listening.setAttribute("aria-pressed", String(state.audio));
    listening.disabled = !state.supported || !state.available || !bound || !online;
    mic.textContent = roomAudioText(state.microphone ? "voiceMicOff" : "voiceMicOn");
    mic.setAttribute("aria-pressed", String(state.microphone));
    mic.disabled = !state.audio || !state.connected || !online || !bound || state.status === "blocked";
    const status = state.errorKey || (!state.available ? "voiceUnavailable" : { connecting: "voiceConnecting",
      reconnecting: "voiceReconnecting", blocked: "voicePlaybackBlocked" }[state.status])
      || (state.microphone ? "voiceTalking" : state.audio ? "voiceListening" : "voiceOff");
    text("[data-room-voice-status]", status); text("[data-room-voice-privacy]", "privacy");
    const players = board?._participants || board?._players || [];
    const rows = state.members.map(member => ({ ...member,
      name: players.find(player => Number(player.user_id) === member.user_id)?.name || "",
      muted: state.mutedUsers.includes(String(member.user_id)),
    })).filter(member => member.name);
    const signature = JSON.stringify([rows, roomAudioText("voiceMute")]);
    if (rosterSignature !== signature) {
      rosterSignature = signature;
      roster.innerHTML = rows.map(member => `<li><span>${esc(member.name)}<small>${esc(roomAudioText(member.microphone ? "voiceTalking" : member.audio ? "voiceListening" : "voiceOff"))}</small></span>${member.user_id === voiceUserId ? ""
        : `<button type="button" data-room-voice-mute="${member.user_id}" aria-pressed="${member.muted}">${esc(roomAudioText(member.muted ? "voiceLocallyMuted" : "voiceMute"))}</button>`}</li>`).join("");
    }
  }
  function retireVoice(revoke = false) {
    if (revoke) lifecycle?.revoke();
    unsubscribeVoice?.(); unsubscribeVoice = null;
    controller?.destroy(); controller = null;
    signaling?.reset(); signaling = null; lifecycle = null; voiceUserId = null;
    roster.replaceChildren(); rosterSignature = "";
  }
  function update() {
    if (stopped) return;
    const own = auth?.authenticated && voiceAccountSeat(board, playerId, auth.user?.id, spectator);
    if (!own || board?._voice_enabled === false || board?._aborted || board?._auto_single || String(board?._mode) === "1") {
      if (controller) retireVoice(true);
      render(); return;
    }
    if (!controller) {
      voiceUserId = auth.user.id;
      signaling = createVoiceSignaling({ action: "zdwa_voice", send: value => !stopped && bound && online && send(value) });
      const transport = createHausdeppVoice({ userId: voiceUserId, t: roomAudioText,
        send: (operation, payload) => signaling.request(operation, payload) });
      lifecycle = createVoiceTableLifecycle({ controller: transport, userId: voiceUserId, gameType: "zdwa",
        defaultListening: auth.user.preferences?.voice_listening_default === true,
        notify: key => showVoiceStatus(roomAudioText(key)) });
      controller = lifecycle.controller;
      lifecycle.enter({ gameId, groupId: board._voice_group_id || gameId });
      unsubscribeVoice = controller.subscribe(render);
      if (bound && online) safely(controller.connected());
    } else lifecycle.enter({ gameId, groupId: board._voice_group_id || gameId });
    render();
  }
  const unsubscribeSound = sound.subscribe(render);
  function destroy() {
    if (stopped) return;
    retireVoice(); stopped = true; unsubscribeSound(); sound.destroy(); lifetime.abort();
    panel.remove(); toggle.remove();
  }
  window.addEventListener("pagehide", destroy, { signal: lifetime.signal });
  // This listener must survive pagehide: BFCache restores a retired document.
  window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
  window.addEventListener("zdwa:auth-state", event => {
    if (voiceUserId !== null && (!event.detail?.authenticated || event.detail.user?.id !== voiceUserId)) {
      retireVoice(true); auth = event.detail; render();
    }
  }, { signal: lifetime.signal });
  return {
    updateAuth(value) {
      if (voiceUserId !== null && value?.user?.id !== voiceUserId) retireVoice(true);
      auth = value; update();
    },
    update(value, ownId) { board = value; playerId = ownId; update(); },
    socketOpen() { online = true; bound = false; render(); },
    bound() { bound = true; online = true; if (controller) safely(controller.connected()); render(); },
    receive(message) {
      if (!message?.zdwa_voice) return false;
      if (controller && bound && online) {
        signaling.receive(message.zdwa_voice);
        if (message.zdwa_voice.event === "state") safely(controller.receive(message.zdwa_voice));
      }
      return true;
    },
    disconnected({ revoke = false } = {}) {
      bound = online = false; signaling?.reset();
      if (revoke) retireVoice(true); else controller?.disconnected();
      render();
    },
    canCarry: () => Boolean(controller && board?._finished && !board?._aborted
      && voiceAccountSeat(board, playerId, auth?.user?.id, spectator)),
    handoff(value) {
      const next = continuationGameId(value, { sourceId: gameId, groupId: board?._voice_group_id || gameId });
      if (!next || !controller) return false;
      lifecycle.handoff(next); return true;
    },
    leave() { lifecycle?.leave(); if (auth?.user?.id) queueVoiceTableLeft({ userId: auth.user.id, gameType: "zdwa" }); destroy(); },
    destroy,
  };
}
