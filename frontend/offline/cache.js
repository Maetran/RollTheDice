/* Local-play preparation only. This module never reloads a tab or imports
   account/presence clients, including when replacing an older PWA worker. */

function within(promise, milliseconds = 15000) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("offline_prepare_timeout")), milliseconds); }),
  ]).finally(() => clearTimeout(timeout));
}

function workerState(worker, accepted) {
  if (accepted.includes(worker.state)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const changed = () => {
      if (accepted.includes(worker.state) || worker.state === "redundant") {
        worker.removeEventListener("statechange", changed);
        if (worker.state === "redundant") reject(new Error("offline_install_failed"));
        else resolve();
      }
    };
    worker.addEventListener("statechange", changed);
    changed();
  });
}

function packageStatus(worker) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error("offline_status_timeout"));
    }, 2500);
    channel.port1.onmessage = event => {
      clearTimeout(timeout);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage({ type:"OFFLINE_STATUS" }, [channel.port2]);
  });
}

export async function prepareOfflinePackage(onStatus = () => {}) {
  const supported = "serviceWorker" in navigator && "caches" in globalThis;
  const report = status => {
    const result = { supported, ready:false, version:null, ...status };
    onStatus(result);
    return result;
  };
  if (!supported) return report({});
  const manifest = document.querySelector('link[rel="manifest"]');
  const manifestPath = manifest ? new URL(manifest.href, location.href).pathname : "";
  const workerPath = manifestPath.startsWith("/zilch-manifest") ? "/zilch-sw.js" : "/sw.js";
  const script = document.querySelector('script[src*="/static/offline-play.js"]');
  const expectedVersion = script ? new URL(script.src, location.href).searchParams.get("v") : null;
  const isCurrent = status => status?.ready === true && (!expectedVersion || status.version === `assets-${expectedVersion}`);
  let registration;
  try {
    registration = await within(navigator.serviceWorker.register(workerPath, { scope:"/", updateViaCache:"none" }));
    // register/update can return while a replacement is still installing.
    // Wait for that package before asking the active worker about readiness.
    try { await within(registration.update(), 4000); } catch (_) { /* An already installed package also works offline. */ }
    const replacement = registration.installing || registration.waiting;
    if (replacement) {
      await within(workerState(replacement, ["installed", "activating", "activated"]));
      if (replacement.state === "installed") replacement.postMessage({ type:"SKIP_WAITING" });
      await within(workerState(replacement, ["activated"]));
    }
    const worker = registration.active;
    if (!worker) return report({});
    const status = await packageStatus(worker);
    return report({ ready:isCurrent(status), version:status?.version || null });
  } catch (_) {
    // A transient failed update must not hide a complete, matching package.
    try {
      registration ||= await navigator.serviceWorker.getRegistration("/");
      if (registration?.active) {
        const status = await packageStatus(registration.active);
        return report({ ready:isCurrent(status), version:status?.version || null });
      }
    } catch (_) { /* Keep the preparation hint; the open game still works. */ }
    return report({});
  }
}
