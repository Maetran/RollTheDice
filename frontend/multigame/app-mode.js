import { loadAuth } from "../shared/auth.js";
import { hausdeppAppEntryUrl, suiteManagementUrl, wattenAppEntryUrl, zdwaAppEntryUrl, zilchAppEntryUrl } from "./routes.js";
import { createGamePicker } from "./game-picker.js";

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

function canDiscoverHausdepp(auth) {
  const access = auth?.game_access || auth?.user?.game_access;
  return Boolean(access?.hausdepp_public === true || (auth?.authenticated && access?.hausdepp_preview === true));
}

function canDiscoverWatten(auth) {
  const access = auth?.game_access || auth?.user?.game_access;
  return access?.watten_public === true || (auth?.authenticated === true && Number.isSafeInteger(auth.user?.id) && auth.user.id > 0
    && access?.watten_preview === true);
}

/**
 * Management entries come only from a server-confirmed account. Admin Center
 * and Dashboard are independent capabilities; neither implies the other.
 */
function suiteUtilityProof(auth) {
  const user = auth?.authenticated === true ? auth.user : null;
  if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
  const proof = { id: user.id, admin: user.is_admin === true, dashboard: user.can_view_analytics === true };
  return proof.admin || proof.dashboard ? proof : null;
}

function suiteUtilityKey(auth) {
  const proof = suiteUtilityProof(auth);
  return proof ? `${proof.id}:${proof.admin}:${proof.dashboard}` : "";
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

function clearRememberedWattenMode() {
  try {
    if (localStorage.getItem(APP_MODE_STORAGE_KEY) === "watten") localStorage.removeItem(APP_MODE_STORAGE_KEY);
  } catch (_) {}
}

function navigateToMode(mode, publicBeta = false) {
  rememberMode(mode);
  const destination = mode === "watten" ? wattenAppEntryUrl(window.location, globalThis, { publicBeta })
    : mode === "hausdepp" ? hausdeppAppEntryUrl() : mode === "zilch" ? zilchAppEntryUrl("/") : zdwaAppEntryUrl();
  const url = new URL(destination, window.location.href);
  url.searchParams.set(
    "game_switch_from",
    document.documentElement.dataset.game || "zdwa",
  );
  window.location.assign(url.toString());
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
  discoveryOnly = false,
} = {}) {
  const currentMode = ["zilch", "hausdepp", "watten"].includes(mode) ? mode : "zdwa";
  const existingController = window.ZDWA_APP_MODE;
  if (existingController?.initialized === true) return existingController;

  document.documentElement.dataset.game = currentMode;

  // Only the server's public lobby document may paint ahead of /auth/me.
  // This hint grants no account identity or permission to any API action.
  const publicZilchDocument = currentMode === "zilch"
    && document.querySelector('[data-zilch-root][data-zilch-public-lobby="true"]') !== null;
  const publicHausdeppDocument = currentMode === "hausdepp"
    && document.querySelector('[data-hausdepp-public="true"]') !== null;
  const publicWattenDocument = currentMode === "watten" && document.documentElement.dataset.wattenPublicBeta === "true";
  let publicLobby = publicZilchDocument || publicHausdeppDocument || publicWattenDocument;
  let allowed = publicLobby || discoveryOnly;
  let stopped = false;
  let hausdeppAllowed = publicHausdeppDocument;
  let zilchAllowed = publicZilchDocument;
  let wattenAllowed = publicWattenDocument;
  let wattenPublic = publicWattenDocument;
  let latestAuth = null;
  let refreshPromise = null;
  let refreshRevision = 0;
  let suspended = false;
  let navigatingAway = false;
  let utilityNavigationPending = false;
  let gamePresentation = {};
  try { gamePresentation = JSON.parse(document.documentElement.dataset.gamePresentation || "{}"); } catch (_) {}
  const presentation = game => typeof gamePresentation?.[game]?.beta === "boolean" ? { beta: gamePresentation[game].beta } : {};
  const pickers = new Map();
  const availableGames = () => [
    { id: "zdwa", name: "ZDWA", href: zdwaAppEntryUrl(), ...presentation("zdwa") },
    ...(zilchAllowed ? [{ id: "zilch", name: "Zilch", href: zilchAppEntryUrl("/"), ...presentation("zilch") }] : []),
    ...(hausdeppAllowed ? [{ id: "hausdepp", name: "Hausdepp", href: hausdeppAppEntryUrl(), ...presentation("hausdepp") }] : []),
    ...(wattenAllowed ? [{ id: "watten", name: "Watten", publicBeta: wattenPublic,
      href: wattenAppEntryUrl(window.location, globalThis, { publicBeta: wattenPublic }), ...presentation("watten") }] : []),
  ];
  // Proof of the current server-confirmed management capabilities. It is
  // independent of game audiences and is dropped on every revalidation boundary.
  let utilityProof = null;
  const availableUtilities = () => [
    ...(utilityProof?.admin ? [{ id: "admin", href: suiteManagementUrl("/admin") }] : []),
    ...(utilityProof?.dashboard ? [{ id: "dashboard", href: suiteManagementUrl("/admin/dashboard") }] : []),
  ];
  const selectUtility = (_id, _utility, event) => {
    // Only a plain same-tab click leaves this document. Hand it to the
    // navigation owner so a late auth failure cannot replace the destination.
    const target = event?.currentTarget?.target;
    if (!event || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey || (target && target !== "_self")) return;
    prepareNavigation({ nativeUtility: true });
  };
  const syncPickers = () => {
    updateSwitch(allowed);
    for (const button of document.querySelectorAll("[data-game-switch]")) {
      let picker = pickers.get(button);
      if (!allowed) { picker?.close(); continue; }
      if (picker) picker.update({ currentMode, games: availableGames(), utilities: availableUtilities() });
      else {
        picker = createGamePicker({
          button, currentMode, games: availableGames(), utilities: availableUtilities(),
          onSelect: rememberMode, onUtilitySelect: selectUtility,
        });
        pickers.set(button, picker);
      }
    }
  };
  const dropUtilities = () => {
    if (!utilityProof) return;
    utilityProof = null;
    // Management links alone may have kept the chooser available.
    if (currentMode !== "watten" && !discoveryOnly && !zilchAllowed && !hausdeppAllowed && !wattenAllowed) allowed = false;
    syncPickers();
  };
  // A private page can paint its header before this controller's auth refresh
  // completes. Do not present an active button whose first click is ignored.
  // Public lobby documents already confirm their discovery capability above.
  for (const button of document.querySelectorAll("[data-game-switch]")) button.disabled = !allowed;
  if (publicLobby || discoveryOnly) syncPickers();

  const revokeZilch = () => {
    // Management links keep the chooser on a non-Zilch page, never a game.
    allowed = currentMode !== "zilch" && utilityProof !== null;
    syncPickers();
    clearRememberedZilchMode();
    if (currentMode !== "zilch" || stopped) return;
    stopped = true;
    const root = document.querySelector("[data-zilch-root]");
    if (root) root.replaceChildren();
    window.location.replace(zdwaAppEntryUrl());
  };

  const applyAuth = (auth, { confirmedPrivate = false } = {}) => {
    latestAuth = auth;
    utilityProof = suiteUtilityProof(auth);
    if (auth?.game_presentation) gamePresentation = auth.game_presentation;
    wattenPublic = (auth?.game_access || auth?.user?.game_access)?.watten_public === true;
    wattenAllowed = wattenPublic || (confirmedPrivate && canDiscoverWatten(auth));
    if (!canDiscoverWatten(auth)) clearRememberedWattenMode();
    const nextAllowed = canUseZilch(auth);
    // A server-confirmed help assignment can open this one spectator page
    // without granting the wider Zilch audience capability or game switch.
    const scopedAllowed = currentMode === "zilch" && auth?.authenticated && auth.user?.is_admin === true
      && scopedZilchSpectator?.userId === auth.user.id
      && scopedZilchSpectator.pathname === window.location.pathname
      && /\/spiel\/[^/]+\/zuschauen\/?$/.test(window.location.pathname);
    const access = auth?.game_access || auth?.user?.game_access;
    hausdeppAllowed = canDiscoverHausdepp(auth);
    zilchAllowed = nextAllowed;
    // Sign-in pages own their login/continuation flow. Discovery may offer
    // confirmed games without treating the surrounding document as a lobby
    // that must be left when a game is unavailable to the current account.
    if (discoveryOnly) {
      allowed = true;
      syncPickers();
      return true;
    }
    if (currentMode === "watten" && !canDiscoverWatten(auth)) {
      for (const picker of pickers.values()) picker.close();
      document.getElementById("wattenApp")?.replaceChildren();
      window.location.replace(zdwaAppEntryUrl());
      return false;
    }
    if (currentMode === "hausdepp" && !hausdeppAllowed) {
      for (const picker of pickers.values()) picker.close();
      try { if (localStorage.getItem(APP_MODE_STORAGE_KEY) === "hausdepp") localStorage.removeItem(APP_MODE_STORAGE_KEY); } catch (_) {}
      document.getElementById("hausdeppApp")?.replaceChildren();
      window.location.replace(zdwaAppEntryUrl());
      return false;
    }
    publicLobby = (publicZilchDocument && access?.zilch_public === true)
      || (publicHausdeppDocument && access?.hausdepp_public === true)
      || (publicWattenDocument && access?.watten_public === true);
    if (!nextAllowed && !scopedAllowed && (currentMode === "zilch" || !hausdeppAllowed && !wattenAllowed)) {
      revokeZilch();
      return false;
    }
    allowed = currentMode === "watten" ? wattenAllowed
      : nextAllowed || hausdeppAllowed || wattenAllowed || utilityProof !== null;
    syncPickers();
    return true;
  };

  const dropPrivate = () => {
    if (!wattenAllowed || wattenPublic) return;
    wattenAllowed = false;
    allowed = discoveryOnly || (currentMode === "watten" ? false : zilchAllowed || hausdeppAllowed || utilityProof !== null);
    syncPickers();
  };

  const refresh = ({ preserveKnownPrivate = false, preserveUtilities = preserveKnownPrivate } = {}) => {
    if (!preserveKnownPrivate) dropPrivate();
    // Management proof ends at every revalidation boundary, even when the
    // account's public Watten access made the private-game drop a no-op.
    if (!preserveUtilities) dropUtilities();
    if (suspended || document.visibilityState === "hidden") return Promise.resolve(false);
    if (refreshPromise) return refreshPromise;
    const revision = ++refreshRevision;
    const operation = Promise.resolve().then(async () => {
      try {
        if (revision !== refreshRevision || suspended || document.visibilityState === "hidden") return false;
        let auth = await loadAuth({ refresh: true });
        if (revision !== refreshRevision || suspended || document.visibilityState === "hidden") return false;
        // Shared /me reads coalesce. Finish an older in-flight identity first,
        // then obtain one request begun after it before showing a private game.
        if (canDiscoverWatten(auth) && (auth?.game_access || auth?.user?.game_access)?.watten_public !== true) auth = await loadAuth({ refresh: true });
        if (revision !== refreshRevision || suspended || document.visibilityState === "hidden") return false;
        if (latestAuth && (latestAuth.authenticated !== auth.authenticated
          || latestAuth.user?.id !== auth.user?.id
          || canDiscoverWatten(latestAuth) !== canDiscoverWatten(auth)
          || suiteUtilityKey(latestAuth) !== suiteUtilityKey(auth))) return false;
        return applyAuth(auth, { confirmedPrivate: true });
      } catch (_) {
        if (revision !== refreshRevision || suspended) return false;
        dropPrivate();
        dropUtilities();
        clearRememberedWattenMode();
        if (discoveryOnly) {
          zilchAllowed = false;
          hausdeppAllowed = false;
          allowed = true;
          syncPickers();
          return false;
        }
        if (currentMode === "watten" && !publicWattenDocument) {
          document.getElementById("wattenApp")?.replaceChildren();
          window.location.replace(zdwaAppEntryUrl());
          return false;
        }
        // A public document keeps only its public games on network failure.
        if (publicLobby && !stopped) return true;
        revokeZilch();
        return false;
      } finally {
        if (refreshPromise === operation) refreshPromise = null;
      }
    });
    refreshPromise = operation;
    return operation;
  };

  const receiveAuth = (auth) => {
    // The outgoing document has already handed navigation to its owner.
    // A late identity event must not replace that chosen destination.
    if (navigatingAway || suspended || document.visibilityState === "hidden") return false;
    // A changed management capability retires older in-flight reads as well,
    // so a delayed same-account grant cannot restore withdrawn links.
    if (latestAuth && ((latestAuth.authenticated ? latestAuth.user?.id : null)
      !== (auth?.authenticated ? auth.user?.id : null)
      || suiteUtilityKey(latestAuth) !== suiteUtilityKey(auth))) {
      refreshRevision += 1;
      refreshPromise = null;
    }
    // Routine same-account refreshes preserve a focused menu. A new account
    // can never inherit this proof, and focus/pageshow explicitly discard it.
    const confirmedPrivate = wattenAllowed && canDiscoverWatten(auth) && latestAuth?.user?.id === auth.user?.id;
    const result = applyAuth(auth, { confirmedPrivate });
    // This event is itself the fresh proof; its follow-up Watten check keeps it.
    if (canDiscoverWatten(auth) && !refreshPromise && !suspended) {
      void refresh({ preserveKnownPrivate: confirmedPrivate, preserveUtilities: true });
    }
    return result;
  };

  for (const switchButton of document.querySelectorAll("[data-game-switch]")) {
    switchButton.addEventListener("click", () => {
      if (allowed) pickers.get(switchButton)?.toggle();
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
    pickers.get(document.querySelector("[data-game-switch]"))?.toggle();
  });

  const suspend = () => {
    suspended = true;
    refreshRevision += 1;
    refreshPromise = null;
    dropPrivate();
    dropUtilities();
    for (const picker of pickers.values()) picker.close();
  };
  const prepareNavigation = ({ nativeUtility = false } = {}) => {
    utilityNavigationPending = nativeUtility;
    navigatingAway = true;
    suspend();
    const revision = refreshRevision;
    // A failed server action can keep its document. Only that attempt may
    // restore refreshes; pagehide/beforeunload retire its revision permanently.
    return () => {
      if (!navigatingAway || refreshRevision !== revision) return false;
      navigatingAway = false;
      suspended = document.visibilityState === "hidden";
      if (!suspended) void refresh();
      return true;
    };
  };
  // WebKit can cancel the old document's identity read before pagehide.
  // Retire that refresh before its rejection can replace the chosen page.
  window.addEventListener("beforeunload", suspend);
  window.addEventListener("pagehide", suspend);
  window.addEventListener("zdwa:auth-state", (event) => receiveAuth(event.detail));
  window.addEventListener("focus", () => { if (!navigatingAway) { suspended = false; void refresh(); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { if (!navigatingAway) { suspended = false; void refresh(); } }
    else if (!navigatingAway) suspend();
  });

  const controller = {
    initialized: true,
    current: currentMode,
    hotkey: ZILCH_HOTKEY,
    set: (nextMode) => {
      if (!allowed || !availableGames().some(game => game.id === nextMode)) return false;
      navigateToMode(nextMode, wattenPublic);
      return true;
    },
    refresh,
    prepareNavigation,
    applyAuth: receiveAuth,
    canUseZilch: () => zilchAllowed,
  };
  window.ZDWA_APP_MODE = controller;
  // Keep the controller usable when a browser restores this document from bfcache.
  window.addEventListener("pageshow", event => {
    if (!event.persisted || (navigatingAway && !utilityNavigationPending)) return;
    // Back restores the old document, not the old permission proof. Native
    // utility navigation retires its reads until this real lifecycle boundary.
    utilityNavigationPending = false;
    navigatingAway = false;
    suspended = false;
    void refresh();
  });

  // The Zilch page has no standard auth controller. Refreshing still updates
  // account controls after an expiry, while a public Zilch table remains
  // playable as a guest.
  if (currentMode === "zilch") window.setInterval(() => { void refresh({ preserveKnownPrivate: true }); }, 12_000);
  // The ZDWA lobby already resolves the identity for its account controls.
  // It can feed that result through the shared auth-state event and avoid a
  // duplicate request from the shell bundle.
  if (refreshOnInitialize) void refresh();

  return controller;
}
