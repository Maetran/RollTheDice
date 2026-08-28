/* PWA lifecycle: install prompt, controlled updates and honest offline feedback. */
(function () {
  "use strict";

  const PRESENCE_KEY = "zdwa_presence_id";
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

  if (!("serviceWorker" in navigator)) return;
  let installPrompt = null;
  let refreshRequested = false;
  let updateToast = null;
  let offlineToast = null;

  const toast = (message, options) => window.ZDWA_UI?.toast?.(message, options);

  function showUpdate(registration) {
    if (!registration?.waiting || updateToast) return;
    updateToast = toast("Eine neue Version von ZDWA ist verfügbar.", {
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
    toast("ZDWA kann als App installiert werden.", {
      kind: "info",
      duration: 0,
      actionLabel: "Installieren",
      onAction: async () => {
        const prompt = installPrompt;
        installPrompt = null;
        if (prompt) await prompt.prompt();
      },
    });
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    toast("ZDWA wurde installiert.", { kind: "success" });
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

  window.ZDWA_PWA = { showUpdate };
})();
