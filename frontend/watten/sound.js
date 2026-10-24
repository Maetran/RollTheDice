import { createTavernSound } from "../shared/tavern-sound.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";
import { lang } from "./cards.js";

/** This live control can move between the waiting room and table without reset. */
export function mountWattenSoundUI({ controller, container, t, dom = document }) {
  const toolbar = dom.createElement("div"), button = dom.createElement("button");
  const description = dom.createElement("span"), announcement = dom.createElement("span");
  toolbar.className = "wt-sound";
  button.type = "button";
  button.id = "wattenSound";
  button.setAttribute("aria-describedby", "wattenSoundDescription");
  description.id = "wattenSoundDescription";
  description.className = announcement.className = "wt-visually-hidden";
  announcement.setAttribute("role", "status");
  toolbar.append(button, description, announcement);
  container?.append(toolbar);
  const click = () => {
    const state = controller.snapshot();
    if (!state.supported) return;
    controller.unlock();
    void Promise.resolve(controller.setEnabled(!state.enabled)).catch(() => {});
  };
  button.addEventListener("click", click);
  const render = (state = controller.snapshot()) => {
    const action = t(state.enabled ? "soundOff" : "soundOn");
    toolbar.dataset.status = state.status;
    button.innerHTML = `<span aria-hidden="true">${state.enabled ? "♪" : "♩"}</span><span>${t("soundAmbienceLabel")}</span>`;
    button.setAttribute("aria-pressed", String(state.enabled));
    button.setAttribute("aria-label", action);
    button.setAttribute("aria-busy", String(state.status === "loading"));
    button.title = `${action}. ${t("soundDescription")}`;
    button.disabled = !state.supported;
    description.textContent = t(state.supported ? "soundDescription" : "soundUnsupported");
    announcement.textContent = !state.supported ? t("soundUnsupported") : state.errorKey ? t("soundUnavailable")
      : t(state.status === "loading" ? "soundLoading" : state.enabled ? "soundEnabled" : "soundDisabled");
    // Loading failures also remain visible beside the control after the click.
    button.dataset.error = state.errorKey ? "true" : "false";
    if (state.errorKey) button.title = t("soundUnavailable");
  };
  const unsubscribe = controller.subscribe(render);
  return { render, destroy() { unsubscribe(); button.removeEventListener("click", click); toolbar.remove(); } };
}

export function createWattenSound({ container }) {
  const controller = createTavernSound();
  const ui = mountWattenSoundUI({ controller, container, t: key => HAUSDEPP_MESSAGES[lang()][key] ?? key });
  return { destroy() { ui.destroy(); controller.destroy(); } };
}
