import { createHausdeppVoice } from "../hausdepp/voice.js";
import { createVoiceSignaling } from "../hausdepp/voice-signaling.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";
import { escapeHtml as esc } from "../shared/auth.js";
import { lang } from "./cards.js";

const messages = {
  de: {
    everyone: "Alle am Tisch", privacy: "Ein gemeinsamer Sprachchat für den ganzen Tisch. Alle hören dieselben Stimmen; keine Teamkanäle. Zuschauer und CPUs nehmen nicht teil. Keine Aufzeichnung.",
    microphoneHint: "Zuhören und Mikrofon schaltest du freiwillig und getrennt ein.",
  },
  en: {
    everyone: "Everyone at the table", privacy: "One shared voice chat for the whole table. Everyone hears the same voices; no team channels. Spectators and CPUs cannot join. No recording.",
    microphoneHint: "Listening and microphone are separate, voluntary choices.",
  },
};

function text(key, params = {}) {
  const value = messages[lang()][key] ?? HAUSDEPP_MESSAGES[lang()][key] ?? key;
  return String(value).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

const shapes = {
  speaker: '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  microphone: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
const icon = (name, enabled) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}${enabled ? "" : '<path d="m2 2 20 20"/>'}</svg>`;
const unavailable = { event: "state", available: false, room_id: null, members: [], publications: [] };

/** One global channel, using the same opt-in audio transport as Hausdepp.
 * The owner forwards only its authenticated socket, and destroys this service
 * on account changes, deliberate departure, fatal disconnect or page teardown.
 */
export function createWattenVoice({ send, userId, isCurrent = () => true }) {
  let stopped = false, snapshot = null, host = null, bound = false, online = false;
  let noticeSignature = "", rosterSignature = "";
  const signaling = createVoiceSignaling({ action: "watten_voice", send: data => {
    if (stopped || !bound || !online || !isCurrent()) return false;
    return send(data);
  } });
  const controller = createHausdeppVoice({ userId, t: text,
    send: (operation, payload) => signaling.request(operation, payload) });
  const toolbar = document.createElement("div");
  toolbar.className = "wt-voice";
  toolbar.hidden = true;
  toolbar.innerHTML = `<details class="wt-voice-details"><summary><span aria-hidden="true">♬</span><span class="wt-visually-hidden" data-voice-title></span></summary><div class="wt-voice-panel"><h3 data-voice-everyone></h3>
    <div class="wt-voice-buttons" role="group"><button type="button" data-voice-audio></button><button type="button" data-voice-microphone></button></div>
    <p data-voice-privacy></p><ul data-voice-roster></ul><p data-voice-hint></p></div></details>
    <div class="wt-voice-notice" role="status" hidden></div><span class="wt-visually-hidden" data-voice-announcement role="status"></span>`;
  const output = toolbar.querySelector("[data-voice-audio]");
  const microphone = toolbar.querySelector("[data-voice-microphone]");
  const roster = toolbar.querySelector("[data-voice-roster]");
  const notice = toolbar.querySelector(".wt-voice-notice");
  const safely = operation => { void Promise.resolve(operation).catch(() => {}); };

  output.addEventListener("click", () => safely(controller.setAudio(!controller.snapshot().audio)));
  microphone.addEventListener("click", () => safely(controller.setMicrophone(!controller.snapshot().microphone)));
  roster.addEventListener("click", event => {
    const button = event.target.closest("[data-voice-mute]");
    if (button) controller.muteUser(Number(button.dataset.voiceMute), button.getAttribute("aria-pressed") !== "true");
  });

  const toggle = (button, shape, enabled, label) => {
    const markup = icon(shape, enabled);
    if (button.innerHTML !== markup) button.innerHTML = markup;
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(enabled));
    button.title = label;
  };
  function render(state = controller.snapshot()) {
    if (stopped) return;
    toolbar.hidden = !bound || !state.available || snapshot?.room?.recipe?.voice_enabled === false;
    toolbar.querySelector("[role=group]").setAttribute("aria-label", text("voiceTitle"));
    toolbar.querySelector("[data-voice-title]").textContent = text("voiceTitle");
    toolbar.querySelector("summary").title = text("voiceTitle");
    toolbar.querySelector("[data-voice-everyone]").textContent = text("everyone");
    toolbar.querySelector("[data-voice-privacy]").textContent = text("privacy");
    toolbar.querySelector("[data-voice-hint]").textContent = `${text("microphoneHint")} ${text("voiceDeviceHint")}`;
    toggle(output, "speaker", state.audio, text(state.audio ? "voiceAudioOff" : "voiceAudioOn"));
    toggle(microphone, "microphone", state.microphone, text(state.microphone ? "voiceMicOff" : "voiceMicOn"));
    output.disabled = !state.supported || !online;
    microphone.disabled = !state.audio || !state.supported || !online || state.status === "blocked";
    const statusKey = state.errorKey || ({ connecting: "voiceConnecting", reconnecting: "voiceReconnecting",
      blocked: "voicePlaybackBlocked", error: "voiceConnectionError" }[state.status]);
    const status = text(statusKey || (state.microphone ? "voiceTalking" : state.audio ? "voiceListening" : "voiceOff"));
    const announcement = toolbar.querySelector("[data-voice-announcement]");
    if (announcement.textContent !== status) announcement.textContent = status;
    const retry = state.status === "blocked" || state.errorKey === "voiceConnectionError";
    const warning = Boolean(state.available && statusKey);
    const signature = JSON.stringify([warning, status, retry, lang()]);
    if (signature !== noticeSignature) {
      noticeSignature = signature;
      notice.hidden = !warning;
      notice.replaceChildren();
      if (warning) {
        const label = document.createElement("span"); label.textContent = status; notice.append(label);
        if (retry) {
          const button = document.createElement("button"); button.type = "button"; button.textContent = text("voiceRetry");
          button.addEventListener("click", () => safely(controller.setAudio(true))); notice.append(button);
        }
      }
    }
    const rows = (state.members || []).map(member => ({ ...member,
      name: snapshot?.room?.members?.find(player => player.participant_id === member.player_id)?.name || "",
      muted: state.mutedUsers.includes(String(member.user_id)),
    })).filter(member => member.name);
    const nextRoster = JSON.stringify([rows, lang()]);
    if (nextRoster !== rosterSignature) {
      rosterSignature = nextRoster;
      const focused = roster.contains(document.activeElement) ? document.activeElement.dataset.voiceMute : null;
      roster.innerHTML = rows.map(member => {
        const key = member.microphone ? "voiceTalking" : member.audio ? "voiceListening" : "voiceOff";
        return `<li class="${member.speaking ? "is-speaking" : ""}"><span><strong translate="no">${esc(member.name)}</strong><small>${esc(text(key))}</small></span>
          ${member.user_id === userId ? icon("microphone", member.microphone) : `<button type="button" data-voice-mute="${member.user_id}" aria-pressed="${member.muted}" aria-label="${esc(text(member.muted ? "voiceUnmutePerson" : "voiceMutePerson", { name: member.name }))}">${icon("speaker", member.audio && !member.muted)}</button>`}</li>`;
      }).join("");
      if (focused) roster.querySelector(`[data-voice-mute="${focused}"]`)?.focus();
    }
  }
  const unsubscribe = controller.subscribe(render);

  return {
    attach(container) {
      if (stopped) return;
      host = container;
      if (host && toolbar.parentElement !== host) host.append(toolbar);
      render();
    },
    update(value) {
      snapshot = value;
      const own = snapshot?.viewer?.participant_id;
      const active = own && (!snapshot.engine || Number.isInteger(snapshot.viewer.seat))
        && snapshot.room?.status !== "closed" && !(snapshot.awaited_participant_ids || []).includes(own)
        && snapshot.room?.recipe?.voice_enabled !== false && !snapshot.aborted;
      if (!active) safely(controller.receive(unavailable));
      render();
    },
    connected() {
      if (stopped || !isCurrent()) return;
      bound = true; online = true;
      safely(controller.connected()); render();
    },
    receive(data) {
      if (!data?.watten_voice) return false;
      if (stopped || !bound || !isCurrent()) return true;
      signaling.receive(data.watten_voice);
      if (data.watten_voice.event === "state") safely(controller.receive(data.watten_voice));
      return true;
    },
    disconnected({ revoke = false } = {}) {
      if (stopped) return;
      online = false; bound = false; signaling.reset(); controller.disconnected();
      if (revoke) safely(controller.receive(unavailable));
      render();
    },
    destroy() {
      if (stopped) return;
      // Send leave while the authenticated transport is still available.
      controller.destroy(); stopped = true; signaling.reset(); unsubscribe();
      toolbar.remove(); host = null;
    },
  };
}
