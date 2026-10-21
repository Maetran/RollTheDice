import { DEPLOYMENT_NOTICE_MESSAGES } from "../i18n/catalog.js";

const SINGLETON = "__rollthediceDeploymentNotice";
const ACK_PREFIX = "rollthedice.deployment-notice.ack.";
const POLL_MS = 3000;
const REQUEST_TIMEOUT_MS = 5000;

export function normalizeDeploymentNotice(value, now = Date.now()) {
  if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(value.id)) return null;
  const restartAt = Date.parse(value.restart_at), expiresAt = Date.parse(value.expires_at);
  if (!Number.isFinite(restartAt) || !Number.isFinite(expiresAt) || expiresAt <= restartAt || expiresAt <= now) return null;
  return { id: value.id, restartAt, expiresAt };
}

/** One non-modal announcement per origin, without changing any game state. */
export function initializeDeploymentNotice({ window: host = window, document: doc = document, now = Date.now } = {}) {
  if (host[SINGLETON]) return host[SINGLETON];
  let current = null, banner = null, expiryTimer = null, pollTimer = null;
  let requestJob = null, retryMs = POLL_MS, paused = false, destroyed = false;
  const acknowledged = new Set();
  const listeners = [];
  const on = (target, type, callback) => {
    target.addEventListener(type, callback);
    listeners.push(() => target.removeEventListener(type, callback));
  };
  const clearPoll = () => { host.clearTimeout(pollTimer); pollTimer = null; };
  const visible = () => !paused && !destroyed && doc.visibilityState !== "hidden" && host.navigator.onLine !== false;
  const ackKey = id => `${ACK_PREFIX}${id}`;
  const hasAcknowledged = notice => {
    if (acknowledged.has(notice.id)) return true;
    for (const name of ["localStorage", "sessionStorage"]) {
      try { if (Number(host[name].getItem(ackKey(notice.id))) > now()) return true; } catch (_) { /* Storage is optional. */ }
    }
    return false;
  };
  const removeBanner = () => { banner?.remove(); banner = null; };
  const clearNotice = () => {
    host.clearTimeout(expiryTimer); expiryTimer = null;
    current = null;
    removeBanner();
  };

  function placeBanner(raise = false) {
    if (!banner) return;
    // A body-level popover would be inert behind a modal. Keeping it inside
    // the current modal also leaves its OK operable without moving focus.
    const modals = [...(doc.querySelectorAll?.("dialog:modal") || [])];
    const parent = doc.activeElement?.closest?.("dialog:modal") || modals.at(-1) || doc.body;
    const moved = banner.parentElement !== parent;
    if ((moved || raise) && banner.matches?.(":popover-open")) banner.hidePopover();
    if (moved) parent.append(banner);
    if (typeof banner.showPopover === "function") {
      banner.setAttribute("popover", "manual");
      try { banner.showPopover(); } catch (_) { banner.removeAttribute("popover"); }
    }
  }

  function acknowledge() {
    if (!current) return;
    acknowledged.add(current.id);
    for (const name of ["localStorage", "sessionStorage"]) {
      try { host[name].setItem(ackKey(current.id), String(current.expiresAt)); } catch (_) { /* Keep the in-memory acknowledgement. */ }
    }
    removeBanner();
  }

  function render(notice) {
    if (!notice) { clearNotice(); return; }
    if (current?.id !== notice.id || current.expiresAt !== notice.expiresAt) {
      clearNotice();
      current = notice;
      expiryTimer = host.setTimeout(clearNotice, Math.max(0, notice.expiresAt - now()));
    }
    if (hasAcknowledged(notice)) return;
    if (banner) { placeBanner(); return; }
    const messages = DEPLOYMENT_NOTICE_MESSAGES[host.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de"];
    banner = doc.createElement("section");
    banner.className = "deployment-notice";
    banner.setAttribute("data-deployment-notice", notice.id);
    // The text is a live region; the button remains an ordinary control. No
    // focus trap or automatic focus interrupts a card gesture or chat input.
    const content = doc.createElement("div");
    content.className = "deployment-notice__content";
    content.setAttribute("role", "status");
    content.setAttribute("aria-live", "polite");
    content.setAttribute("aria-atomic", "true");
    const title = doc.createElement("strong");
    title.className = "deployment-notice__title";
    title.textContent = messages.title;
    const text = doc.createElement("p");
    text.className = "deployment-notice__text";
    text.textContent = messages.message;
    content.append(title, text);
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "deployment-notice__ack";
    button.textContent = messages.acknowledge;
    button.addEventListener("click", acknowledge);
    banner.append(content, button);
    placeBanner();
  }

  function schedule(delay = retryMs) {
    clearPoll();
    if (visible()) pollTimer = host.setTimeout(poll, delay);
  }

  async function poll() {
    clearPoll();
    if (!visible() || requestJob) return;
    const controller = new host.AbortController();
    const job = { controller, timeout: host.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) };
    requestJob = job;
    try {
      const response = await host.fetch("/api/deployment-notice", {
        cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal,
      });
      if (!response.ok) throw new Error("deployment_notice_unavailable");
      const payload = await response.json();
      if (requestJob !== job || destroyed) return;
      if (!payload || !("notice" in payload)) throw new Error("deployment_notice_invalid");
      // An explicit null is the server's clear signal. Malformed data must not
      // dismiss an already visible warning during a transient proxy failure.
      const notice = payload.notice === null ? null : normalizeDeploymentNotice(payload.notice, -Infinity);
      if (payload.notice !== null && !notice) throw new Error("deployment_notice_invalid");
      render(notice && notice.expiresAt > now() ? notice : null);
      retryMs = POLL_MS;
    } catch (_) {
      if (requestJob === job) retryMs = Math.min(6000, retryMs * 2);
    } finally {
      host.clearTimeout(job.timeout);
      if (requestJob === job) {
        requestJob = null;
        schedule();
      }
    }
  }

  function pause() {
    clearPoll();
    const job = requestJob;
    requestJob = null;
    if (job) { host.clearTimeout(job.timeout); job.controller.abort(); }
  }

  function resume() {
    pause();
    retryMs = POLL_MS;
    if (current && current.expiresAt <= now()) clearNotice();
    if (visible()) void poll();
  }

  on(doc, "visibilitychange", resume);
  on(host, "online", resume);
  on(host, "offline", pause);
  on(host, "pageshow", () => { paused = false; resume(); });
  on(host, "pagehide", () => { paused = true; pause(); });
  on(host, "storage", event => {
    if (current && event.key === ackKey(current.id) && Number(event.newValue) > now()) {
      acknowledged.add(current.id);
      removeBanner();
    }
  });
  const dialogObserver = typeof host.MutationObserver === "function" ? new host.MutationObserver(records => {
    if (records.some(record => record.target.tagName === "DIALOG")) placeBanner(true);
  }) : null;
  dialogObserver?.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
  const controller = {
    destroy() {
      destroyed = true;
      pause();
      clearNotice();
      dialogObserver?.disconnect();
      for (const remove of listeners) remove();
      if (host[SINGLETON] === controller) delete host[SINGLETON];
    },
  };
  host[SINGLETON] = controller;
  void poll();
  return controller;
}
