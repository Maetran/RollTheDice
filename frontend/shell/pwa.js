/* PWA lifecycle: install prompt, controlled updates and honest offline feedback. */
(function () {
  "use strict";

  const PRESENCE_KEY = "zdwa_presence_id";
  const INSTALL_DISMISS_KEY = "zdwa_install_prompt_dismissed";
  const INSTALL_DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  const APP_VERSION = (() => {
    try {
      return new URL(document.currentScript?.src || "", location.href).searchParams.get("v") || "unversioned";
    } catch {
      return "unversioned";
    }
  })();
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

  // Presence belongs to both games and is connected above. Zilch deliberately
  // has no ZDWA manifest or service-worker lifecycle of its own, especially on
  // the isolated production subdomain. Remove a stale pre-launch registration
  // there defensively; never unregister the legitimate Apex PWA on /zilch.
  if (document.documentElement.dataset.game === "zilch") {
    if (location.hostname === "zilch.zockdiewandan.online" && "serviceWorker" in navigator) {
      window.addEventListener("load", async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map(registration => registration.unregister()));
          if ("caches" in window) {
            const keys = await caches.keys();
            await Promise.all(keys
              .filter(key => key.startsWith("precache-assets-") || key.startsWith("runtime-assets-"))
              .map(key => caches.delete(key)));
          }
        } catch (error) {
          console.warn("Stale Zilch service-worker cleanup failed:", error);
        }
      }, { once: true });
    }
    return;
  }
  if (!("serviceWorker" in navigator)) return;
  let installPrompt = null;
  let refreshRequested = false;
  let updateToast = null;
  let offlineToast = null;

  const toast = (message, options) => window.ZDWA_UI?.toast?.(message, options);

  function installPromptSuppressed() {
    try {
      const dismissed = JSON.parse(localStorage.getItem(INSTALL_DISMISS_KEY) || "null");
      return dismissed?.version === APP_VERSION
        && Date.now() - Number(dismissed.dismissedAt || 0) < INSTALL_DISMISS_MS;
    } catch {
      return false;
    }
  }

  function dismissInstallPrompt() {
    try {
      localStorage.setItem(INSTALL_DISMISS_KEY, JSON.stringify({
        version: APP_VERSION,
        dismissedAt: Date.now(),
      }));
    } catch {
      // Storage can be unavailable in private/restricted browsing contexts.
    }
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
    installPrompt = event;
    if (matchMedia("(display-mode: standalone)").matches) return;
    if (installPromptSuppressed()) return;
    toast("Die App kann installiert werden.", {
      kind: "info",
      duration: 0,
      actionLabel: "Installieren",
      onDismiss: dismissInstallPrompt,
      onAction: async () => {
        const prompt = installPrompt;
        installPrompt = null;
        if (prompt) await prompt.prompt();
      },
    });
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    try { localStorage.removeItem(INSTALL_DISMISS_KEY); } catch {}
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
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      observeRegistration(registration);
      setTimeout(() => registration.update().catch(() => {}), 1500);
    } catch (error) {
      console.warn("SW registration failed:", error);
    }
  });

  window.ZDWA_PWA = {
    showUpdate,
    appVersion: APP_VERSION,
    installPromptSuppressed,
    dismissInstallPrompt,
  };
})();
