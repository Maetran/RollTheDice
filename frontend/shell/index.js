import "../i18n/index.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import "./ui.js";
import "./pwa.js";
import "./theme.js";

// Zilch owns the same controller inside its protected application bundle.
// Every ZDWA document, including the otherwise script-light public pages and
// the game room, is initialized here so the capability-gated switch behaves
// consistently across the product. Pages that already load account state
// publish it via `zdwa:auth-state`, avoiding a second identity request.
if (document.documentElement.dataset.game !== "zilch" && document.querySelector("[data-game-switch]")) {
  const pageOwnsAuthRequest = Boolean(document.querySelector("#loginForm, #accountName, .admin-shell"));
  initializeAppMode({ mode: "zdwa", refreshOnInitialize: !pageOwnsAuthRequest });
}
