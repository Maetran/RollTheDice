const soundIcon = enabled => `<svg class="hd-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>${enabled ? "" : '<path d="m2 2 20 20"/>'}</svg>`;

/** Local table ambience is independent of voice participation and CPU seats. */
export function mountHausdeppSoundUI({ controller, t }) {
  const toolbar = document.createElement("div");
  toolbar.className = "hd-sound-controls";
  toolbar.setAttribute("role", "group");
  const label = document.createElement("span");
  label.className = "hd-sound-label";
  const button = document.createElement("button");
  button.id = "hausdeppSound";
  button.type = "button";
  button.setAttribute("aria-describedby", "hausdeppSoundDescription");
  const description = document.createElement("span");
  description.id = "hausdeppSoundDescription";
  description.className = "hd-sr";
  const announcement = document.createElement("span");
  announcement.className = "hd-sr";
  announcement.setAttribute("role", "status");
  toolbar.append(label, button, description, announcement);
  const notice = document.createElement("div");
  notice.className = "hd-sound-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  document.body.append(notice);

  button.addEventListener("click", () => {
    const state = controller.snapshot();
    if (!state.supported) return;
    // Both calls happen inside the gesture, before any loading or resume await.
    controller.unlock();
    void Promise.resolve(controller.setEnabled(!state.enabled)).catch(() => {});
  });

  function render(state = controller.snapshot()) {
    document.body.classList.add("hd-sound-available");
    toolbar.setAttribute("aria-label", t("soundTitle"));
    toolbar.dataset.status = state.status;
    label.textContent = t("soundLabel");
    const action = t(state.enabled ? "soundOff" : "soundOn");
    button.innerHTML = soundIcon(state.enabled);
    button.setAttribute("aria-pressed", String(state.enabled));
    button.setAttribute("aria-label", action);
    button.setAttribute("aria-busy", String(state.status === "loading"));
    button.title = `${action}. ${t("soundDescription")}`;
    button.disabled = !state.supported;
    description.textContent = t(state.supported ? "soundDescription" : "soundUnsupported");
    const message = !state.supported ? t("soundUnsupported") : state.errorKey ? t("soundUnavailable")
      : t(state.status === "loading" ? "soundLoading" : state.enabled ? "soundEnabled" : "soundDisabled");
    if (announcement.textContent !== message) announcement.textContent = message;
    notice.hidden = !state.errorKey;
    notice.textContent = state.errorKey ? t("soundUnavailable") : "";
  }

  function attach() {
    const tools = document.querySelector(".hd-header-tools");
    if (tools && toolbar.parentElement !== tools) {
      const voice = tools.querySelector(".hd-voice-controls");
      if (voice) voice.after(toolbar); else tools.prepend(toolbar);
    }
    render();
  }
  const unsubscribe = controller.subscribe(render);
  attach();
  return { attach, render, destroy() {
    unsubscribe(); toolbar.remove(); notice.remove();
    document.body.classList.remove("hd-sound-available");
  } };
}
