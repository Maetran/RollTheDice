/* PWA lifecycle: install prompt, controlled updates and honest offline feedback. */
(function () {
  "use strict";

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
