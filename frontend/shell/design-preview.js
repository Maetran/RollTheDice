// Owner-only design preview for the ZDWA lobby and game room.
//
// The server decides who may see the preview (`user.design_preview.zdwa_2026`,
// see app/design_preview.py). This module only mirrors that capability onto
// <html data-design="2026">, which scopes every rule in zdwa-design-2026.css.
// Without the attribute the page renders exactly as before. The remembered
// value lets the inline head script paint the preview before account state
// arrives; any page load without the capability clears it again.
//
// `?design=classic` keeps the current design on this browser, `?design=2026`
// turns the preview back on. Both only matter for accounts with the capability.

const STORAGE_KEY = "zdwa_design_preview";
const OPT_OUT_KEY = "zdwa_design_preview_opt_out";
const DESIGN = "2026";
const root = document.documentElement;

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* Private windows simply keep the current design. */ }
}

function applyDesign(enabled) {
  const current = root.dataset.design === DESIGN;
  if (enabled) root.dataset.design = DESIGN;
  else delete root.dataset.design;
  writeStorage(STORAGE_KEY, enabled ? DESIGN : null);
  if (current !== enabled) {
    window.dispatchEvent(new CustomEvent("zdwa:design-change", { detail: { design: enabled ? DESIGN : null } }));
  }
}

function applyUrlChoice() {
  const choice = new URLSearchParams(location.search).get("design");
  if (choice === "classic") writeStorage(OPT_OUT_KEY, "1");
  if (choice === DESIGN) writeStorage(OPT_OUT_KEY, null);
}

export function initializeDesignPreview() {
  if (root.dataset.game !== "zdwa") return;
  if (!document.querySelector('link[href*="zdwa-design-2026.css"]')) return;
  applyUrlChoice();
  if (readStorage(OPT_OUT_KEY) === "1") applyDesign(false);
  const onAccount = (event) => {
    const allowed = Boolean(event.detail?.user?.design_preview?.zdwa_2026);
    applyDesign(allowed && readStorage(OPT_OUT_KEY) !== "1");
  };
  // The lobby publishes `loadAuth` results; the room forwards its WebSocket identity.
  window.addEventListener("zdwa:auth-state", onAccount);
  window.addEventListener("zdwa:room-auth", onAccount);
}
