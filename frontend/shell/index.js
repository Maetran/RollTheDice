import "../i18n/index.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { applyZdwaBridgeLinks, isZilchHostedZdwaLocation, zdwaPath } from "../multigame/routes.js";
import "./ui.js";
import "./pwa.js";
import "./theme.js";

function initializeZdwaPwaBridgeNavigation() {
  if (!isZilchHostedZdwaLocation()) return;

  const applyLinks = (scope) => {
    if (scope instanceof Element || scope instanceof Document) applyZdwaBridgeLinks(scope);
  };
  applyLinks(document);
  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) applyLinks(node);
    }
  }).observe(document.body, { childList: true, subtree: true });

  // Small compatibility bridge for the few static account documents whose
  // inline redirect runs outside the bundled route modules.
  window.ZDWA_ROUTE = { path: (route = "/") => zdwaPath(route) };
}

initializeZdwaPwaBridgeNavigation();

// Zilch owns the same controller inside its protected application bundle.
// Every ZDWA document, including the otherwise script-light public pages and
// the game room, is initialized here so the capability-gated switch behaves
// consistently across the product. Pages that already load account state
// publish it via `zdwa:auth-state`, avoiding a second identity request.
if (document.documentElement.dataset.game !== "zilch" && document.querySelector("[data-game-switch]")) {
  const pageOwnsAuthRequest = Boolean(document.querySelector("#loginForm, #accountName, .admin-shell"));
  initializeAppMode({ mode: "zdwa", refreshOnInitialize: !pageOwnsAuthRequest });
}
