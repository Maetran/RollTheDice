/* PWA lifecycle: install prompt, controlled updates and honest offline feedback. */
(function () {
  "use strict";

  const PRESENCE_KEY = "zdwa_presence_id";
  const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  const ZILCH_HOSTNAME = "zilch.zockdiewandan.online";
  const HAUSDEPP_HOSTNAME = "hausdepp.zockdiewandan.online";
  const localWattenHost = () => location.hostname === "localhost" || location.hostname.endsWith(".localhost")
    || location.hostname === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(location.hostname);
  const INSTALLED_ENTRY_KEY = "rollthedice:pwa-entry:v1";
  const WINDOW_ENTRY_PREFIX = `${INSTALLED_ENTRY_KEY}:`;
  const ASSET_VERSION = (() => {
    try {
      return new URL(document.currentScript?.src || "", location.href).searchParams.get("v") || "unversioned";
    } catch {
      return "unversioned";
    }
  })();
  const APP_VERSION = typeof __ROLLTHEDICE_PRODUCT_VERSION__ === "string"
    ? __ROLLTHEDICE_PRODUCT_VERSION__ : ASSET_VERSION;
  let presenceSocket = null;
  let presenceHeartbeat = null;
  let presenceRetry = null;

  function randomPresenceId() {
    return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function presenceId() {
    try {
      let value = localStorage.getItem(PRESENCE_KEY);
      if (!value) {
        value = randomPresenceId();
        localStorage.setItem(PRESENCE_KEY, value);
      }
      return value;
    } catch {
      return randomPresenceId();
    }
  }

  function connectPresence() {
    if (!("WebSocket" in window) || !navigator.onLine) return;
    if (presenceSocket && presenceSocket.readyState <= WebSocket.OPEN) return;
    clearTimeout(presenceRetry);
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    presenceSocket = new WebSocket(
      `${protocol}//${location.host}/ws/presence?client_id=${encodeURIComponent(presenceId())}`,
    );
    presenceSocket.addEventListener("open", () => {
      window.dispatchEvent(new CustomEvent("zdwa:presence-connected"));
      clearInterval(presenceHeartbeat);
      presenceHeartbeat = setInterval(() => {
        if (presenceSocket?.readyState === WebSocket.OPEN) presenceSocket.send("ping");
      }, 20000);
    });
    presenceSocket.addEventListener("close", () => {
      clearInterval(presenceHeartbeat);
      presenceHeartbeat = null;
      presenceSocket = null;
      clearTimeout(presenceRetry);
      presenceRetry = setTimeout(connectPresence, 2500);
    });
  }

  connectPresence();
  window.addEventListener("online", connectPresence);
  window.addEventListener("pageshow", connectPresence);
  window.addEventListener("pagehide", () => presenceSocket?.close());

  const toast = (message, options) => window.ZDWA_UI?.toast?.(message, options);

  function setupPwaLifecycle({ installDismissKey, workerUrl, globalName, scope = null, beforeRegister = null }) {
    if (!("serviceWorker" in navigator)) return;
    let installPrompt = null;
    let refreshRequested = false;
    let updateToast = null;
    let offlineToast = null;
    let installToast = null;
    let installOffered = false;
    let installTimer = null;
    const installedKey = `${installDismissKey}:installed`;
    let installed = isStandalone();

    function knownInstalled() {
      if (installed || isStandalone()) return true;
      try { return localStorage.getItem(installedKey) === APP_VERSION; } catch { return false; }
    }

    function rememberInstalled() {
      installed = true;
      try { localStorage.setItem(installedKey, APP_VERSION); } catch {}
      clearTimeout(installTimer);
      installToast?.remove();
      installToast = null;
    }
    if (installed) rememberInstalled();

    function installLobby() {
      return globalName !== "WATTEN_PWA"
        && ["/", "/zdwa", "/zilch", "/hausdepp"].includes(location.pathname.replace(/\/$/, "") || "/");
    }

    function iosBrowser() {
      return /iPad|iPhone|iPod/.test(navigator.userAgent || "")
        || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    }

    function modalOpen() {
      return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')]
        .some(element => element.getClientRects().length > 0);
    }

    function installPromptSuppressed() {
      try {
        const dismissed = JSON.parse(localStorage.getItem(installDismissKey) || "null");
        return dismissed?.version === APP_VERSION
          && Date.now() - Number(dismissed.dismissedAt || 0) < INSTALL_DISMISS_MS;
      } catch {
        return false;
      }
    }

    function dismissInstallPrompt() {
      try {
        localStorage.setItem(installDismissKey, JSON.stringify({
          version: APP_VERSION,
          dismissedAt: Date.now(),
        }));
      } catch {
        // Storage can be unavailable in private/restricted browsing contexts.
      }
    }

    function showInstallHint() {
      clearTimeout(installTimer);
      if (installOffered || !installLobby() || knownInstalled() || installPromptSuppressed()) return;
      const manual = !installPrompt && iosBrowser();
      if (!installPrompt && !manual) return;
      if (document.hidden) return;
      if (modalOpen()) {
        installTimer = setTimeout(showInstallHint, 2000);
        return;
      }
      installToast = toast(manual
        ? "Spiel direkt vom Home-Bildschirm öffnen? Tippe auf „Teilen“ und dann auf „Zum Home-Bildschirm“."
        : "Die App kann installiert werden.", {
        kind: "info", duration: 0, onDismiss: dismissInstallPrompt,
        ...(manual ? {} : {
          actionLabel: "Installieren",
          onAction: async () => {
            const prompt = installPrompt;
            installPrompt = null;
            installToast = null;
            if (!prompt) return;
            window.ZDWA_PWA_INSTALL_BUSY = true;
            try {
              const result = await prompt.prompt();
              const choice = prompt.userChoice ? await prompt.userChoice : result;
              if (choice?.outcome === "dismissed") dismissInstallPrompt();
              if (choice?.outcome === "accepted") rememberInstalled();
            } catch { /* The native install sheet can become unavailable. */ }
            finally { window.ZDWA_PWA_INSTALL_BUSY = false; }
          },
        }),
      });
      if (installToast?.dataset) installToast.dataset.pwaInstallHint = "true";
      installOffered = Boolean(installToast);
    }

    function showUpdate(registration) {
      if (!registration?.waiting || updateToast) return;
      updateToast = toast("Eine neue Version ist verfügbar.", {
        kind: "info",
        duration: 0,
        actionLabel: "Jetzt aktualisieren",
        onAction: () => {
          refreshRequested = true;
          registration.waiting?.postMessage({ type: "SKIP_WAITING" });
        },
      });
    }

    function observeRegistration(registration) {
      if (registration.waiting && navigator.serviceWorker.controller) showUpdate(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showUpdate(registration);
        });
      });
    }

    window.addEventListener("beforeinstallprompt", event => {
      event.preventDefault();
      if (isStandalone() || installed) return;
      // A fresh native offer is authoritative even after a remembered install
      // was removed. A browser never needs a permanent installation marker.
      try { localStorage.removeItem(installedKey); } catch {}
      installPrompt ||= event;
      showInstallHint();
    });

    window.addEventListener("appinstalled", () => {
      installPrompt = null;
      rememberInstalled();
      try { localStorage.removeItem(installDismissKey); } catch {}
      toast("Die App wurde installiert.", { kind: "success" });
    });

    window.addEventListener("offline", () => {
      if (offlineToast?.isConnected) return;
      offlineToast = toast("Du bist offline. Für laufende Spiele wird eine Verbindung benötigt.", { kind: "warning", duration: 0 });
    });
    window.addEventListener("online", () => {
      if (offlineToast?.isConnected) offlineToast.remove();
      offlineToast = null;
      toast("Internetverbindung wiederhergestellt.", { kind: "success", duration: 2200 });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshRequested) return;
      refreshRequested = false;
      location.reload();
    });

    window.addEventListener("load", async () => {
      installTimer = setTimeout(showInstallHint, 1200);
      try {
        await beforeRegister?.();
        const registration = await navigator.serviceWorker.register(workerUrl, {
          updateViaCache: "none", ...(scope ? { scope } : {}),
        });
        observeRegistration(registration);
        setTimeout(() => registration.update().catch(() => {}), 1500);
      } catch (error) {
        console.warn("SW registration failed:", error);
      }
    });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) showInstallHint(); });
    window.addEventListener("pagehide", () => clearTimeout(installTimer));

    window[globalName] = {
      showUpdate,
      appVersion: APP_VERSION,
      installPromptSuppressed,
      dismissInstallPrompt,
    };
  }

  function isZilchOrigin() {
    return location.hostname.toLowerCase() === ZILCH_HOSTNAME;
  }

  function isStandalone() {
    return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  }

  function installedEntry() {
    if (!isStandalone()) return null;
    // A distinct launch URL identifies the installed Hausdepp app even when
    // an older, broader suite worker controls its first launch.
    const launchedHausdepp = new URL(location.href).searchParams.get("pwa") === "hausdepp";
    const launchedWatten = localWattenHost() && new URL(location.href).searchParams.get("pwa") === "watten";
    const controlledHausdepp = navigator.serviceWorker?.controller?.scriptURL?.includes("/hausdepp-sw.js");
    const controlledWatten = localWattenHost() && navigator.serviceWorker?.controller?.scriptURL?.includes("/watten-sw.js");
    let saved = null;
    try { saved = sessionStorage.getItem(INSTALLED_ENTRY_KEY); } catch {
      // Product identity only: retain it across same-origin navigation even
      // when storage is disabled and a narrow account worker takes control.
      if (window.name.startsWith(WINDOW_ENTRY_PREFIX)) saved = window.name.slice(WINDOW_ENTRY_PREFIX.length);
    }
    const entry = launchedWatten ? "watten" : launchedHausdepp ? "hausdepp"
      : ["zdwa", "zilch", "hausdepp", ...(localWattenHost() ? ["watten"] : [])].includes(saved) ? saved
        : controlledWatten ? "watten"
          : controlledHausdepp || location.hostname.toLowerCase() === HAUSDEPP_HOSTNAME ? "hausdepp" : isZilchOrigin() ? "zilch" : "zdwa";
    try { sessionStorage.setItem(INSTALLED_ENTRY_KEY, entry); } catch {}
    window.name = WINDOW_ENTRY_PREFIX + entry;
    return entry;
  }

  function ensureManifest(product) {
    const language = window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
    const prefix = product === "zdwa" ? "" : `${product}-`;
    const manifestUrl = new URL(`/${prefix}manifest${language === "en" ? "-en" : ""}.webmanifest`, location.origin);
    if (ASSET_VERSION !== "unversioned") manifestUrl.searchParams.set("v", ASSET_VERSION);
    const link = document.querySelector('link[rel="manifest"]') || document.createElement("link");
    link.rel = "manifest";
    link.href = manifestUrl.href;
    link.dataset.pwaProduct = product;
    if (["hausdepp", "watten"].includes(product)) link.crossOrigin = "use-credentials";
    else link.removeAttribute("crossorigin");
    if (!link.isConnected) document.head.append(link);
  }

  function ensureZilchManifest() {
    ensureManifest("zilch");
  }

  function registeredWorkerPath(registration) {
    const worker = [registration.active, registration.waiting, registration.installing]
      .find(candidate => candidate?.scriptURL);
    if (!worker) return "";
    try {
      return new URL(worker.scriptURL, location.href).pathname;
    } catch {
      return "";
    }
  }

  async function removeLegacyZilchPwaState() {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations
        .filter(registration => registeredWorkerPath(registration) === "/sw.js")
        .map(registration => registration.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys
          .filter(key => key.startsWith("precache-assets-") || key.startsWith("runtime-assets-"))
          .map(key => caches.delete(key)));
      }
    } catch (error) {
      console.warn("Legacy Zilch PWA cleanup failed:", error);
    }
  }

  // Presence belongs to both games and is connected above. The isolated Zilch
  // production origin has its own network-only worker and manifest. A ZDWA
  // view inside the same-origin `/zdwa` bridge and the protected Hausdepp
  // preview deliberately keep that worker too: registering the Apex worker
  // there would fail and can surface an external browser sheet on iOS.
  const isZilchDocument = document.documentElement.dataset.game === "zilch";
  const isHausdeppDocument = document.documentElement.dataset.game === "hausdepp"
    || document.documentElement.dataset.hausdeppLogin === "true";
  const entry = installedEntry();
  if (entry === "watten" && localWattenHost()) {
    // Manifest scope keeps suite/recovery navigation inside the installed app;
    // the account worker itself never expands beyond the new Watten paths.
    ensureManifest("watten");
    setupPwaLifecycle({ installDismissKey: "watten_install_prompt_dismissed", workerUrl: "/watten-sw.js",
      globalName: "WATTEN_PWA", scope: "/watten" });
    return;
  }
  if (entry === "hausdepp" || (isHausdeppDocument && !entry)) {
    ensureManifest("hausdepp");
    setupPwaLifecycle({
      installDismissKey: "hausdepp_install_prompt_dismissed",
      workerUrl: "/hausdepp-sw.js",
      globalName: "HAUSDEPP_PWA",
      scope: "/hausdepp",
    });
    return;
  }
  if (isHausdeppDocument && entry === "zdwa") ensureManifest("zdwa");
  if (entry === "zilch" && localWattenHost()) {
    // An opted-in Watten page can live inside this existing local Zilch app.
    // Its saved owner must still win when returning to Zilch's own pages.
    ensureZilchManifest();
    setupPwaLifecycle({ installDismissKey: "zilch_install_prompt_dismissed", workerUrl: "/zilch-sw.js", globalName: "ZILCH_PWA" });
    return;
  }
  // The Apex `/zilch` handoff stays entirely under its already-installed ZDWA
  // worker. Only Zilch's own host (including the narrow ZDWA bridge) owns the
  // isolated Zilch worker.
  if (isZilchDocument && !isZilchOrigin()) return;
  const usesZilchPwaLifecycle = isZilchOrigin() && (
    isZilchDocument || isHausdeppDocument || document.documentElement.dataset.zdwaPwaBridge === "true"
  );
  if (usesZilchPwaLifecycle) {
    ensureZilchManifest();
    setupPwaLifecycle({
      installDismissKey: "zilch_install_prompt_dismissed",
      workerUrl: "/zilch-sw.js",
      globalName: "ZILCH_PWA",
      beforeRegister: removeLegacyZilchPwaState,
    });
    return;
  }

  setupPwaLifecycle({
    installDismissKey: "zdwa_install_prompt_dismissed",
    workerUrl: "/sw.js",
    globalName: "ZDWA_PWA",
  });
})();
