// ZDWA design choice: the 2026 design ("new") or the previous one ("old").
//
// Accounts store the choice on the server (`user.design.zdwa`, see
// app/zdwa_design.py); guests keep it in this browser. The server also says
// whether the 2026 design may be offered at all (`zdwa_2026_available`), which
// is the rollback switch. This module mirrors the result onto
// <html data-design="2026">, which scopes every rule in zdwa-design-2026.css.
// The remembered values let the inline head script paint the right design
// before account state arrives.
//
// `?design=classic` keeps the old design on this browser regardless of the
// account, `?design=2026` removes that override again.

const CHOICE_KEY = "zdwa_design";
const OFF_KEY = "zdwa_design_off";
const OVERRIDE_KEY = "zdwa_design_override";
const LEGACY_KEYS = ["zdwa_design_preview", "zdwa_design_preview_opt_out"];
const DESIGN = "2026";
const root = document.documentElement;

const state = {
  available: true,
  account: null,
  // The saved choice (account or browser) and an unsaved live preview.
  choice: "new",
  preview: null,
};

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Private windows keep the design for this page only. */ }
}

function normalize(value) {
  return value === "old" ? "old" : "new";
}

function shown() {
  return state.preview || state.choice;
}

function apply() {
  const enabled = state.available && readStorage(OVERRIDE_KEY) !== "old" && shown() === "new";
  const current = root.dataset.design === DESIGN;
  if (enabled) root.dataset.design = DESIGN;
  else delete root.dataset.design;
  if (current !== enabled) {
    window.dispatchEvent(new CustomEvent("zdwa:design-change", { detail: { design: enabled ? DESIGN : null } }));
  }
}

function remember() {
  writeStorage(CHOICE_KEY, state.choice);
  writeStorage(OFF_KEY, state.available ? null : "1");
}

function applyUrlChoice() {
  const choice = new URLSearchParams(location.search).get("design");
  if (choice === "classic") writeStorage(OVERRIDE_KEY, "old");
  if (choice === DESIGN) writeStorage(OVERRIDE_KEY, null);
}

function onAuthState(event) {
  const detail = event.detail || {};
  // The lobby publishes `/api/auth/me`; the room forwards its WebSocket user.
  const user = detail.user !== undefined ? detail.user : detail.id ? detail : null;
  const design = user?.design || detail.design;
  if (typeof design?.zdwa_2026_available === "boolean") state.available = design.zdwa_2026_available;
  state.account = user?.id ? user : null;
  if (state.account) state.choice = normalize(user.design?.zdwa);
  else if (detail.authenticated === false) state.choice = normalize(readStorage(CHOICE_KEY));
  remember();
  // A refreshed identity (tab focus, login) must not undo an open live preview.
  apply();
}

/**
 * The saved choice, the design on screen and whether the 2026 design may be
 * shown at all on this server and in this browser.
 */
export function zdwaDesignState() {
  return {
    available: state.available,
    choice: state.choice,
    shown: shown(),
    previewing: state.preview !== null,
    account: Boolean(state.account),
    overridden: readStorage(OVERRIDE_KEY) === "old",
  };
}

/** Show a choice at once without saving it; `null` returns to the saved one. */
export function previewZdwaDesign(choice) {
  state.preview = choice === null || choice === undefined ? null : normalize(choice);
  apply();
}

/**
 * Save a choice: on the account when signed in, otherwise in this browser.
 * Resolves to the stored choice; a failed save keeps the previous one.
 */
export async function saveZdwaDesign(choice, { apiFetch } = {}) {
  const next = normalize(choice);
  const previous = state.choice;
  state.choice = next;
  state.preview = null;
  apply();
  if (state.account && apiFetch) {
    let response = null;
    try {
      response = await apiFetch("/api/auth/preferences/design", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zdwa_design: next }),
      });
    } catch { /* Handled below like a rejected save. */ }
    if (!response?.ok) {
      state.choice = previous;
      apply();
      throw new Error("design_save_failed");
    }
    state.account.design = { ...(state.account.design || {}), zdwa: next, prompt_pending: false };
  }
  remember();
  return next;
}

export function initializeZdwaDesign() {
  if (root.dataset.game !== "zdwa") return;
  if (!document.querySelector('link[href*="zdwa-design-2026.css"]')) return;
  for (const key of LEGACY_KEYS) writeStorage(key, null);
  applyUrlChoice();
  state.available = readStorage(OFF_KEY) !== "1";
  state.choice = normalize(readStorage(CHOICE_KEY));
  apply();
  window.addEventListener("zdwa:auth-state", onAuthState);
  window.addEventListener("zdwa:room-auth", onAuthState);
  window.ZDWA_DESIGN = {
    state: zdwaDesignState,
    preview: previewZdwaDesign,
    save: saveZdwaDesign,
  };
}
