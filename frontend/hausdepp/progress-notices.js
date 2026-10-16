import { apiFetch } from "../shared/auth.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";

/** Acknowledgements are server-side presentation receipts, never XP grants. */
export function mountProgressNotices({ userId, canPresent = () => true, onPending = () => {}, onComplete = () => {} } = {}) {
  if (!userId) return { refresh() {}, pause() {}, destroy() {} };
  const language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
  const t = (key, params = {}) => String(HAUSDEPP_MESSAGES[language()][key] || key)
    .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
  const localized = value => typeof value === "object" && value ? value[language()] || value.de || "" : String(value ?? "");
  let destroyed = false, running = false, deferred = false, later = false, interrupted = false, activeId = null, timer;
  const blocked = () => document.hidden || !canPresent() || Boolean(document.querySelector(
    '.game-tour-entry, [data-game-tour], dialog[open], #appDialogBackdrop:not([hidden])',
  ));
  const request = async (url, options = {}) => {
    const response = await apiFetch(url, { cache: "no-store", ...options });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  function pause() {
    interrupted = true;
    if (activeId) window.ZDWA_UI?.dismiss?.(activeId);
  }
  async function present(notice, index, total) {
    activeId = `hausdepp-progress-${notice.key}`;
    let errorElement;
    const choice = await window.ZDWA_UI.dialog({
      id: activeId, kind: `hausdepp-${notice.kind}`, dismissible: true,
      title: t(notice.kind === "rank" ? "progressPopupRank" : "progressPopupAchievement"),
      message: localized(notice.name),
      onOpen: ({ message }) => {
        message.replaceChildren();
        const paragraph = (text, className = "") => {
          const element = document.createElement("p"); element.textContent = text;
          element.className = className; message.append(element); return element;
        };
        const name = document.createElement("h3"); name.textContent = localized(notice.name); message.append(name);
        if (notice.kind === "achievement") paragraph(`+${t("experiencePoints", { points: notice.points })}`, "hd-notice-reward");
        else paragraph(localized(notice.quote), "hd-notice-quote");
        paragraph(t("progressPopupCondition"), "hd-account-kicker"); paragraph(localized(notice.condition));
        paragraph(t("progressPopupReason"), "hd-account-kicker"); paragraph(localized(notice.reason));
        if (notice.source?.finished_at) {
          const date = new Intl.DateTimeFormat(language() === "en" ? "en-GB" : "de-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(notice.source.finished_at));
          paragraph(t("progressPopupSource", { date, count: notice.source.players }), "hd-fine");
        }
        if (total > 1) paragraph(t("progressPopupCounter", { current: index + 1, total }), "hd-fine");
        errorElement = paragraph(""); errorElement.hidden = true; errorElement.setAttribute("role", "alert");
      },
      actions: [
        { id: "later", label: t("progressPopupLater"), className: "ghost" },
        { id: "acknowledge", label: t("progressPopupContinue"), className: "primary", onAction: async () => {
          try {
            await request(`/api/hausdepp/progress-notices/${encodeURIComponent(notice.key)}/acknowledge`, { method: "POST" });
          } catch (error) {
            if (errorElement) { errorElement.textContent = t("progressPopupRetry"); errorElement.hidden = false; }
            throw error;
          }
        } },
      ],
    });
    activeId = null;
    if (choice !== "acknowledge" && !interrupted) later = true;
    return choice === "acknowledge";
  }
  async function showQueue() {
    // Re-read under the browser lock. A second tab sees acknowledgements made
    // by the first tab, rather than replaying its older in-memory response.
    const data = await request("/api/hausdepp/progress-notices");
    if (destroyed || later || blocked()) { deferred = true; return; }
    const notices = Array.isArray(data.notices) ? data.notices : [];
    if (!notices.length) return;
    onPending(data);
    for (let index = 0; index < notices.length; index++) {
      if (destroyed || later || blocked()) { deferred = true; return; }
      interrupted = false;
      if (!await present(notices[index], index, notices.length)) return;
    }
    // The old inline summary uses an independent bounded revision. Reconcile
    // it only after every displayed item was explicitly confirmed.
    try {
      await request("/api/hausdepp/account/acknowledge", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: data.revision }),
      });
      onComplete(data);
    } catch { /* Individual confirmed items remain durable even if this fails. */ }
  }
  async function refresh() {
    if (destroyed || running || later) return;
    if (blocked() || !window.ZDWA_UI?.dialog) { deferred = true; return; }
    running = true; deferred = false;
    try {
      if (navigator.locks?.request) await navigator.locks.request(`hausdepp-progress-${userId}`, { ifAvailable: true }, async lock => { if (lock) await showQueue(); else deferred = true; });
      else await showQueue();
    } catch { /* Keep server deliveries pending for the next safe entry. */ }
    finally { running = false; }
  }
  const schedule = () => {
    if (destroyed || !deferred || running || later) return;
    clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 200);
  };
  const observer = new MutationObserver(() => {
    if (activeId && (!canPresent() || document.querySelector('.game-tour-entry, [data-game-tour], dialog[open]'))) { deferred = true; pause(); }
    schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
  window.addEventListener("focus", schedule);
  document.addEventListener("visibilitychange", schedule);
  document.addEventListener("close", schedule, true);
  return { refresh, pause, destroy() {
    destroyed = true; pause(); clearTimeout(timer); observer.disconnect();
    window.removeEventListener("focus", schedule); document.removeEventListener("visibilitychange", schedule);
    document.removeEventListener("close", schedule, true);
  } };
}
