import { escapeHtml as esc } from "../shared/auth.js";

const shapes = {
  speaker: '<path d="m11 5-6 4H2v6h3l6 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  microphone: '<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
};
const symbol = (name, enabled) => `<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]}${enabled ? "" : '<path d="m2 2 20 20"/>'}</svg>`;

/** The two primary controls stay in the header, including tournament results. */
export function mountHausdeppVoiceUI({ controller, t, userId, getPlayers }) {
  const toolbar = document.createElement("div");
  toolbar.className = "hd-voice-controls";
  toolbar.setAttribute("role", "group");
  const output = document.createElement("button");
  output.id = "hausdeppVoiceAudio";
  output.type = "button";
  const microphone = document.createElement("button");
  microphone.id = "hausdeppVoiceMicrophone";
  microphone.type = "button";
  const announcement = document.createElement("span");
  announcement.className = "hd-sr";
  announcement.setAttribute("role", "status");
  toolbar.append(output, microphone, announcement);

  const panel = document.createElement("section");
  panel.className = "hd-voice-participants";
  panel.id = "hausdeppVoiceParticipants";
  const notice = document.createElement("div");
  notice.className = "hd-voice-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  document.body.append(notice);
  let panelSignature = "";
  let noticeSignature = "";

  const toggle = (button, enabled, label, shape) => {
    button.innerHTML = symbol(shape, enabled);
    button.setAttribute("aria-pressed", String(enabled));
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  const run = operation => { void Promise.resolve(operation).catch(() => {}); };
  output.addEventListener("click", () => {
    const state = controller.snapshot();
    run(controller.setAudio(!state.audio));
  });
  microphone.addEventListener("click", () => run(controller.setMicrophone(!controller.snapshot().microphone)));
  panel.addEventListener("click", event => {
    const button = event.target.closest("[data-voice-mute]");
    if (button) controller.muteUser(Number(button.dataset.voiceMute), button.getAttribute("aria-pressed") !== "true");
  });

  function render(state = controller.snapshot()) {
    toolbar.hidden = !state.available;
    panel.hidden = !state.available;
    document.body.classList.toggle("hd-voice-available", Boolean(state.available));
    toolbar.setAttribute("aria-label", t("voiceTitle"));
    toolbar.dataset.status = state.status;
    toggle(output, state.audio, t(state.audio ? "voiceAudioOff" : "voiceAudioOn"), "speaker");
    toggle(microphone, state.microphone, t(state.microphone ? "voiceMicOff" : "voiceMicOn"), "microphone");
    output.disabled = !state.supported;
    microphone.disabled = !state.audio || !state.supported || !state.connected || state.status === "blocked";
    microphone.title = !state.audio ? t("voiceEnableAudioFirst") : microphone.getAttribute("aria-label");
    const statusKey = state.errorKey || ({ connecting: "voiceConnecting", reconnecting: "voiceReconnecting",
      blocked: "voicePlaybackBlocked", error: "voiceConnectionError" }[state.status]);
    const announcementText = statusKey ? t(statusKey) : t(state.microphone ? "voiceTalking" : state.audio ? "voiceListening" : "voiceOff");
    if (announcement.textContent !== announcementText) announcement.textContent = announcementText;
    const warning = Boolean(state.available && statusKey && state.status !== "connecting");
    notice.hidden = !warning;
    const canRetry = state.status === "blocked" || state.errorKey === "voiceConnectionError";
    const nextNotice = JSON.stringify([warning, statusKey && t(statusKey), canRetry, t("voiceRetry")]);
    if (nextNotice !== noticeSignature) {
      noticeSignature = nextNotice;
      notice.replaceChildren();
      if (warning) {
        const text = document.createElement("span");
        text.textContent = t(statusKey);
        notice.append(text);
        if (canRetry) {
          const retry = document.createElement("button");
          retry.type = "button";
          retry.textContent = t("voiceRetry");
          retry.addEventListener("click", () => run(controller.setAudio(true)));
          notice.append(retry);
        }
      }
    }

    const players = getPlayers().filter(player => !player.is_cpu && player.user_id);
    const muted = new Set((state.mutedUsers || []).map(String));
    const rows = players.map(player => ({ ...player,
      voice: state.members?.find(member => member.user_id === player.user_id),
      muted: muted.has(String(player.user_id)),
    }));
    const signature = JSON.stringify([rows, t("voiceTitle"), state.audio]);
    if (signature !== panelSignature) {
      panelSignature = signature;
      const focused = panel.contains(document.activeElement) ? document.activeElement.dataset.voiceMute : null;
      panel.innerHTML = `<h3>${esc(t("voiceTitle"))}</h3><p>${esc(t("voicePrivacy"))}</p><ul>${rows.map(player => {
        const audio = Boolean(player.voice?.audio);
        const mic = audio && Boolean(player.voice?.microphone);
        const status = t(mic ? "voiceTalking" : audio ? "voiceListening" : "voiceOff");
        return `<li data-voice-user="${player.user_id}" class="${player.voice?.speaking ? "is-speaking" : ""}"><span class="hd-voice-person"><strong>${esc(player.name)}</strong><small>${esc(status)}</small></span><span class="hd-voice-person-icons" aria-label="${esc(status)}">${symbol("speaker", audio)}${symbol("microphone", mic)}</span>${player.user_id !== userId ? `<button type="button" data-voice-mute="${player.user_id}" aria-pressed="${player.muted}" aria-label="${esc(t(player.muted ? "voiceUnmutePerson" : "voiceMutePerson", { name: player.name }))}" title="${esc(t(player.muted ? "voiceUnmutePerson" : "voiceMutePerson", { name: player.name }))}">${symbol("speaker", !player.muted)}<span class="hd-sr">${esc(t(player.muted ? "voiceLocallyMuted" : "voiceMute"))}</span></button>` : ""}</li>`;
      }).join("")}</ul><p>${esc(t("voiceDeviceHint"))}</p>`;
      if (focused) panel.querySelector(`[data-voice-mute="${focused}"]`)?.focus();
    }
    for (const seat of document.querySelectorAll("[data-player-id]")) {
      const player = rows.find(item => String(item.id) === seat.dataset.playerId);
      seat.classList.toggle("hd-voice-speaking", Boolean(player?.voice?.speaking));
      let badge = seat.querySelector(".hd-voice-seat-status");
      if (!player || !state.available) { badge?.remove(); continue; }
      if (!badge) { badge = document.createElement("span"); badge.className = "hd-voice-seat-status"; seat.append(badge); }
      const audio = Boolean(player.voice?.audio), mic = audio && Boolean(player.voice?.microphone);
      badge.title = `${player.name}: ${t(mic ? "voiceTalking" : audio ? "voiceListening" : "voiceOff")}${player.muted ? ` · ${t("voiceLocallyMuted")}` : ""}`;
      badge.setAttribute("aria-label", badge.title);
      badge.innerHTML = symbol("speaker", audio && !player.muted) + symbol("microphone", mic);
    }
  }

  function attach() {
    const tools = document.querySelector(".hd-header-tools");
    if (tools && toolbar.parentElement !== tools) tools.prepend(toolbar);
    const help = document.querySelector(".hd-game-help");
    if (help && panel.parentElement !== help) help.insertBefore(panel, help.querySelector(".hd-tools-close"));
    render();
  }
  const unsubscribe = controller.subscribe(render);
  attach();
  return { attach, render, destroy() {
    unsubscribe(); toolbar.remove(); panel.remove(); notice.remove();
    document.body.classList.remove("hd-voice-available");
    document.querySelectorAll(".hd-voice-seat-status").forEach(badge => badge.remove());
  } };
}
