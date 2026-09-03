import { loadAuth } from "../shared/auth.js";

export const APP_MODE_STORAGE_KEY = "zdwa_app_mode";
export const ZILCH_HOTKEY = "Alt+Shift+Z";

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "input, textarea, select, [contenteditable], [contenteditable='true'], dialog[open], [role='dialog'], [aria-modal='true']",
  ));
}

function canUseZilch(auth) {
  return Boolean(auth?.authenticated && auth?.user?.game_access?.zilch_preview === true);
}

function updateSwitch(allowed) {
  for (const switchButton of document.querySelectorAll("[data-game-switch]")) {
    switchButton.hidden = !allowed;
    switchButton.disabled = !allowed;
    switchButton.setAttribute("aria-hidden", String(!allowed));
  }
}

function rememberMode(mode) {
  try { localStorage.setItem(APP_MODE_STORAGE_KEY, mode); } catch (_) {}
}

function clearRememberedZilchMode() {
  try {
    if (localStorage.getItem(APP_MODE_STORAGE_KEY) === "zilch") localStorage.removeItem(APP_MODE_STORAGE_KEY);
  } catch (_) {}
}

function navigateToMode(mode) {
  rememberMode(mode);
  window.location.assign(mode === "zilch" ? "/zilch" : "/");
}

/**
 * Mount the one active app mode. Page routing keeps ZDWA and Zilch roots from
 * coexisting in a document; this controller only reveals a capability after
 * the server-confirmed auth response has arrived.
 */
export function initializeAppMode({ mode = document.documentElement.dataset.game || "zdwa" } = {}) {
  const currentMode = mode === "zilch" ? "zilch" : "zdwa";
  document.documentElement.dataset.game = currentMode;
  window.ZDWA_APP_MODE = {
    current: currentMode,
    hotkey: ZILCH_HOTKEY,
    set: navigateToMode,
  };

  let allowed = false;
  let stopped = false;

  const revokeZilch = () => {
    allowed = false;
    updateSwitch(false);
    clearRememberedZilchMode();
    if (currentMode !== "zilch" || stopped) return;
    stopped = true;
    const root = document.querySelector("[data-zilch-root]");
    if (root) root.replaceChildren();
    window.location.replace("/");
  };

  const applyAuth = (auth) => {
    const nextAllowed = canUseZilch(auth);
    if (!nextAllowed) {
      revokeZilch();
      return false;
    }
    allowed = true;
    updateSwitch(true);
    return true;
  };

  const refresh = async () => {
    try {
      return applyAuth(await loadAuth({ refresh: true }));
    } catch (_) {
      revokeZilch();
      return false;
    }
  };

  for (const switchButton of document.querySelectorAll("[data-game-switch]")) {
    switchButton.addEventListener("click", () => {
      if (allowed) navigateToMode(currentMode === "zilch" ? "zdwa" : "zilch");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.repeat || isEditableTarget(event.target)) return;
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== "z") return;
    if (!allowed) return;
    event.preventDefault();
    navigateToMode(currentMode === "zilch" ? "zdwa" : "zilch");
  });

  window.addEventListener("zdwa:auth-state", (event) => applyAuth(event.detail));
  window.addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });

  // The Zilch page has no standard auth controller; polling there keeps an
  // expired/revoked session from leaving an active preview root mounted.
  if (currentMode === "zilch") window.setInterval(() => { void refresh(); }, 12_000);
  void refresh();

  return { refresh, applyAuth, canUseZilch: () => allowed };
}
