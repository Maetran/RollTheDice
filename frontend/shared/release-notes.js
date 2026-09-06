import { apiFetch } from "./auth.js";

const GUEST_KEY = "rollthedice:release-notes:guest";
const ACCOUNT_SIGNAL_KEY = "rollthedice:release-notes:acknowledged";
const HISTORY_SELECTOR = "[data-release-history]";
const t = value => window.ZDWA_I18N?.t?.(value) || value;
const language = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function guestAcknowledgements() {
  try {
    const value = JSON.parse(localStorage.getItem(GUEST_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.filter(item => typeof item === "string").slice(-50) : []);
  } catch { return new Set(); }
}

function releaseDate(release) {
  const time = node("time", "", "release-notes-date");
  const date = new Date(release.published_at);
  if (Number.isFinite(date.getTime())) {
    time.dateTime = date.toISOString();
    time.textContent = new Intl.DateTimeFormat(language(), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(date);
  }
  return time;
}

function changeList(release) {
  const list = node("ul", "", "release-notes-changes");
  for (const change of release.changes || []) list.appendChild(node("li", change));
  return list;
}

export function initializeReleaseNotes({ context }) {
  // Entry points deliberately mount this only in lobbies and account pages.
  if (window.ZDWA_RELEASE_NOTES) return window.ZDWA_RELEASE_NOTES;
  let data = null;
  let currentDialog = null;
  let inFlight = false;
  let epoch = 0;
  let saveInFlight = false;
  const later = new Set();
  const guestRead = guestAcknowledgements();
  const snapshots = new WeakMap();

  function closeDialog() {
    const dialog = currentDialog;
    currentDialog = null;
    if (dialog) { dialog.close(); dialog.remove(); }
  }

  function isRead(release) {
    return release.acknowledged || (data.viewer_id === null && guestRead.has(release.revision));
  }

  function renderHistory() {
    const mount = document.querySelector(HISTORY_SELECTOR);
    if (!mount || !data) return;
    const snapshot = JSON.stringify([language(), data.viewer_id, data.releases]);
    if (snapshots.get(mount) === snapshot) return;
    snapshots.set(mount, snapshot);
    const opened = new Set(Array.from(mount.querySelectorAll("details[open]"), item => item.dataset.revision));
    mount.replaceChildren();
    if (!data.releases.length) {
      mount.appendChild(node("p", t("Noch keine Versionshinweise veröffentlicht."), "release-notes-muted"));
      return;
    }
    for (const release of data.releases.slice(0, 10)) {
      const details = node("details", "", "release-notes-entry");
      details.dataset.revision = release.revision;
      details.open = opened.has(release.revision);
      const summary = node("summary");
      summary.append(node("span", release.title), releaseDate(release));
      details.append(summary, changeList(release));
      mount.appendChild(details);
    }
  }

  function maybeAnnounce() {
    const latest = data?.releases?.[0];
    if (currentDialog && (!latest || !data.can_prompt || !latest.can_announce || isRead(latest) || currentDialog.dataset.revision !== latest.revision)) closeDialog();
    if (!latest || !data.can_prompt || !latest.can_announce || document.hidden) return;
    if (currentDialog || isRead(latest) || later.has(`${data.viewer_id}:${latest.revision}`)) return;
    // Do not stack over password prompts, achievements or another app dialog.
    if (Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')).some(element => element.getClientRects().length)) return;
    const expectedViewer = data.viewer_id;
    const dialog = node("dialog", "", "release-notes-dialog");
    dialog.dataset.revision = latest.revision;
    dialog.setAttribute("aria-labelledby", "releaseNotesTitle");
    const heading = node("h2", latest.title);
    heading.id = "releaseNotesTitle";
    const body = node("div", "", "release-notes-body");
    body.append(node("p", t("Was ist neu?"), "release-notes-eyebrow"), heading, releaseDate(latest), changeList(latest));
    body.appendChild(node("p", t("Die letzten zehn Releases kannst du jederzeit im Konto nachlesen."), "release-notes-muted"));
    const error = node("p", "", "release-notes-error");
    error.setAttribute("role", "status");
    const actions = node("div", "", "release-notes-actions");
    const postpone = node("button", t("Später"), "ghost");
    const acknowledge = node("button", t("Verstanden"), "primary");
    acknowledge.autofocus = true;
    const dismissForNow = () => {
      later.add(`${expectedViewer}:${latest.revision}`);
      closeDialog();
    };
    postpone.addEventListener("click", dismissForNow);
    dialog.addEventListener("cancel", event => { event.preventDefault(); dismissForNow(); });
    acknowledge.addEventListener("click", async () => {
      if (saveInFlight) return;
      saveInFlight = true;
      acknowledge.disabled = true;
      error.textContent = "";
      try {
        if (expectedViewer === null) {
          guestRead.add(latest.revision);
          try { localStorage.setItem(GUEST_KEY, JSON.stringify([...guestRead].slice(-50))); } catch { /* Session-only fallback. */ }
        } else {
          const response = await apiFetch(`/api/releases/${encodeURIComponent(latest.revision)}/acknowledge?game_type=${context}`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ viewer_id: expectedViewer }), signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) throw new Error("acknowledgement_failed");
          if (data?.viewer_id !== expectedViewer) return;
          epoch += 1;
          for (const item of data.releases) {
            if (item.revision === latest.revision) item.acknowledged = true;
          }
          try { localStorage.setItem(ACCOUNT_SIGNAL_KEY, JSON.stringify({ viewer_id: expectedViewer, revision: latest.revision, at: Date.now() })); } catch { /* Server remains authoritative. */ }
        }
        // A newer release may arrive while this acknowledgement is saving.
        // Completing the old request must not close the newer announcement.
        if (currentDialog === dialog) closeDialog();
        renderHistory();
      } catch {
        error.textContent = t("Bestätigung konnte nicht gespeichert werden. Bitte versuche es erneut oder wähle Später.");
      } finally {
        saveInFlight = false;
        acknowledge.disabled = false;
      }
    });
    actions.append(postpone, acknowledge);
    dialog.append(body, error, actions);
    document.body.appendChild(dialog);
    currentDialog = dialog;
    dialog.showModal();
  }

  async function refresh() {
    if (inFlight || document.hidden) return;
    inFlight = true;
    const requestEpoch = epoch;
    try {
      const response = await fetch(`/api/releases?game_type=${context}&language=${language()}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error("releases_unavailable");
      const result = await response.json();
      if (requestEpoch !== epoch) return;
      if (data && data.viewer_id !== result.viewer_id) closeDialog();
      data = result;
      renderHistory();
      maybeAnnounce();
    } catch {
      const mount = document.querySelector(HISTORY_SELECTOR);
      if (mount && !data) {
        const retry = node("button", t("Neuigkeiten erneut laden"), "small ghost");
        retry.addEventListener("click", refresh);
        mount.replaceChildren(node("p", t("Neuigkeiten sind gerade nicht erreichbar."), "release-notes-muted"), retry);
      }
    } finally {
      inFlight = false;
      if (requestEpoch !== epoch) void refresh();
    }
  }

  window.addEventListener("zdwa:auth-state", event => {
    const viewer = event.detail?.authenticated ? event.detail.user?.id : null;
    if (data && viewer === data.viewer_id) return;
    epoch += 1;
    data = null;
    closeDialog();
    void refresh();
  });
  window.addEventListener("storage", event => {
    if (event.key === GUEST_KEY && data?.viewer_id === null) {
      for (const revision of guestAcknowledgements()) guestRead.add(revision);
      maybeAnnounce();
    }
    if (event.key === ACCOUNT_SIGNAL_KEY) void refresh();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  new MutationObserver(maybeAnnounce).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden", "open"] });
  window.setInterval(refresh, 60000);
  window.ZDWA_RELEASE_NOTES = { refresh };
  void refresh();
  return window.ZDWA_RELEASE_NOTES;
}
