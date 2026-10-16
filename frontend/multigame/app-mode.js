import { loadAuth } from "../shared/auth.js";
import { zdwaAppEntryUrl, zilchAppEntryUrl } from "./routes.js";

export const APP_MODE_STORAGE_KEY = "zdwa_app_mode";
export const ZILCH_HOTKEY = "Alt+Shift+Z";

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest(
    "input, textarea, select, [contenteditable], [contenteditable='true'], dialog[open], [role='dialog'], [aria-modal='true']",
  ));
}

function canUseZilch(auth) {
  const access = auth?.game_access || auth?.user?.game_access;
  // Public Zilch is deliberately available before sign-in. The legacy
  // capability remains authoritative for preview/authenticated rollouts.
  return Boolean(access?.zilch_public === true || (auth?.authenticated && access?.zilch_preview === true));
}

function updateSwitch(allowed) {
  for (const switchButton of document.querySelectorAll("[data-game-switch]")) {
    switchButton.hidden = !allowed;
    switchButton.disabled = !allowed;
    switchButton.setAttribute("aria-hidden", String(!allowed));
  }
}

function hasGameSwitch() {
  return Boolean(document.querySelector("[data-game-switch]"));
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
  const destination = mode === "hausdepp" ? hausdeppEntryUrl() : mode === "zilch" ? zilchAppEntryUrl("/") : zdwaAppEntryUrl();
  const url = new URL(destination, window.location.href);
  url.searchParams.set(
    "game_switch_from",
    document.documentElement.dataset.game || "zdwa",
  );
  window.location.assign(url.toString());
}

function hausdeppEntryUrl() {
  // Keep installed Zilch PWAs on their current origin; Hausdepp is a protected
  // prefixed route on both suite hosts, never a new external destination.
  return "/hausdepp";
}

function showSuiteMenu(button, currentMode, zilchAllowed) {
  const previous = document.getElementById("suiteGameMenu");
  if (previous) { previous.remove(); button.setAttribute("aria-expanded", "false"); return; }
  const menu = document.createElement("nav");
  menu.id = "suiteGameMenu";
  menu.className = "suite-game-menu";
  menu.setAttribute("aria-label", window.ZDWA_I18N?.t?.("Spiele") || "Spiele");
  for (const game of ["zdwa", ...(zilchAllowed ? ["zilch"] : []), "hausdepp"]) {
    const link = document.createElement("a");
    link.textContent = { zdwa: "ZDWA", zilch: "Zilch", hausdepp: "Hausdepp" }[game];
    link.href = game === "hausdepp" ? hausdeppEntryUrl() : game === "zilch" ? zilchAppEntryUrl("/") : zdwaAppEntryUrl();
    if (game === currentMode) link.setAttribute("aria-current", "page");
    link.addEventListener("click", () => rememberMode(game));
    menu.append(link);
  }
  button.setAttribute("aria-controls", menu.id);
  button.setAttribute("aria-expanded", "true");
  document.body.append(menu);
  menu.querySelector("a")?.focus();
  const dismiss = event => {
    if (event.type === "keydown" && event.key !== "Escape") return;
    if (event.type === "click" && (menu.contains(event.target) || button.contains(event.target))) return;
    menu.remove();
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("click", dismiss);
    document.removeEventListener("keydown", dismiss);
    if (event.type === "keydown") button.focus();
  };
  document.addEventListener("click", dismiss);
  document.addEventListener("keydown", dismiss);
}

/**
 * Mount the one active app mode. Page routing keeps ZDWA and Zilch roots from
 * coexisting in a document. Access comes from the server-confirmed auth
 * response, or from its explicitly public lobby document while auth loads.
 */
export function initializeAppMode({
  mode = document.documentElement.dataset.game || "zdwa",
  refreshOnInitialize = true,
  scopedZilchSpectator = null,
} = {}) {
  const currentMode = ["zilch", "hausdepp"].includes(mode) ? mode : "zdwa";
  const existingController = window.ZDWA_APP_MODE;
  if (existingController?.initialized === true) return existingController;

  document.documentElement.dataset.game = currentMode;

  // Only the server's public lobby document may paint ahead of /auth/me.
  // This hint grants no account identity or permission to any API action.
  let publicLobby = currentMode === "zilch"
    && document.querySelector('[data-zilch-root][data-zilch-public-lobby="true"]') !== null;
  let allowed = publicLobby;
  let stopped = false;
  let hausdeppAllowed = false;
  let zilchAllowed = publicLobby;
  if (publicLobby) updateSwitch(true);

  const revokeZilch = () => {
    allowed = false;
    updateSwitch(false);
    clearRememberedZilchMode();
    if (currentMode !== "zilch" || stopped) return;
    stopped = true;
    const root = document.querySelector("[data-zilch-root]");
    if (root) root.replaceChildren();
    window.location.replace(zdwaAppEntryUrl());
  };

  const applyAuth = (auth) => {
    const nextAllowed = canUseZilch(auth);
    // A server-confirmed help assignment can open this one spectator page
    // without granting the wider Zilch audience capability or game switch.
    const scopedAllowed = currentMode === "zilch" && auth?.authenticated && auth.user?.is_admin === true
      && scopedZilchSpectator?.userId === auth.user.id
      && scopedZilchSpectator.pathname === window.location.pathname
      && /\/spiel\/[^/]+\/zuschauen\/?$/.test(window.location.pathname);
    const access = auth?.game_access || auth?.user?.game_access;
    hausdeppAllowed = Boolean(auth?.authenticated && access?.hausdepp_preview === true);
    zilchAllowed = nextAllowed;
    if (currentMode === "hausdepp" && !hausdeppAllowed) {
      document.getElementById("suiteGameMenu")?.remove();
      document.getElementById("hausdeppApp")?.replaceChildren();
      window.location.replace(zdwaAppEntryUrl());
      return false;
    }
    publicLobby = publicLobby && access?.zilch_public === true;
    if (!nextAllowed && !scopedAllowed && (currentMode === "zilch" || !hausdeppAllowed)) {
      revokeZilch();
      return false;
    }
    allowed = nextAllowed || hausdeppAllowed;
    updateSwitch(allowed);
    if (!hausdeppAllowed) document.getElementById("suiteGameMenu")?.remove();
    if (hausdeppAllowed) for (const button of document.querySelectorAll("[data-game-switch]")) {
      button.setAttribute("aria-label", window.ZDWA_I18N?.t?.("Spiel wechseln") || "Spiel wechseln");
      button.setAttribute("title", window.ZDWA_I18N?.t?.("Spiel wechseln") || "Spiel wechseln");
    }
    return true;
  };

  const refresh = async () => {
    try {
      return applyAuth(await loadAuth({ refresh: true }));
    } catch (_) {
      // A network failure cannot turn an already public document into a
      // private one. Keep its read-only shell; a successful denial above
      // still revokes access immediately, including after a rollout change.
      if (publicLobby && !stopped) return true;
      revokeZilch();
      return false;
    }
  };

  for (const switchButton of document.querySelectorAll("[data-game-switch]")) {
    switchButton.addEventListener("click", () => {
      if (allowed && hausdeppAllowed) showSuiteMenu(switchButton, currentMode, zilchAllowed);
      else if (allowed) navigateToMode(currentMode === "zilch" ? "zdwa" : "zilch");
    });
  }

  document.addEventListener("keydown", (event) => {
    // `KeyboardEvent.target` can briefly fall back to `document` while a
    // disclosure widget is opening. The focused control is the reliable
    // second guard: the global game shortcut must never fire while somebody
    // is typing a room code or using another form control.
    if (
      event.defaultPrevented
      || event.repeat
      || isEditableTarget(event.target)
      || isEditableTarget(document.activeElement)
    ) return;
    if (!hasGameSwitch()) return;
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== "z") return;
    if (!allowed) return;
    event.preventDefault();
    if (hausdeppAllowed) showSuiteMenu(document.querySelector("[data-game-switch]"), currentMode, zilchAllowed);
    else navigateToMode(currentMode === "zilch" ? "zdwa" : "zilch");
  });

  window.addEventListener("zdwa:auth-state", (event) => applyAuth(event.detail));
  window.addEventListener("focus", () => { void refresh(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });

  const controller = {
    initialized: true,
    current: currentMode,
    hotkey: ZILCH_HOTKEY,
    set: navigateToMode,
    refresh,
    applyAuth,
    canUseZilch: () => allowed,
  };
  window.ZDWA_APP_MODE = controller;

  // The Zilch page has no standard auth controller. Refreshing still updates
  // account controls after an expiry, while a public Zilch table remains
  // playable as a guest.
  if (currentMode === "zilch") window.setInterval(() => { void refresh(); }, 12_000);
  // The ZDWA lobby already resolves the identity for its account controls.
  // It can feed that result through the shared auth-state event and avoid a
  // duplicate request from the shell bundle.
  if (refreshOnInitialize) void refresh();

  return controller;
}
