import { apiFetch, loadAuth } from "./auth.js";

// The design state lives in the shell bundle; page bundles reach it here.
const design = () => window.ZDWA_DESIGN;

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const PROMPT_DELAY_MS = 1_200;
const RELEASE_NOTES_RETRY_MS = 500;
const DIALOG_RETRY_MS = 2_000;

function visibleModalIsOpen() {
  return Array.from(document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]'))
    .some(element => element.getClientRects().length > 0);
}

function untilNoOtherDialog() {
  return new Promise(resolve => {
    const check = () => (visibleModalIsOpen() ? window.setTimeout(check, 500) : resolve());
    check();
  });
}

function designSwitch(checked) {
  const label = document.createElement("label");
  label.className = "design-choice-switch";
  const text = document.createElement("span");
  text.textContent = t("Neues Design verwenden");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("role", "switch");
  input.checked = checked;
  input.dataset.designSwitch = "";
  label.append(text, input);
  return { label, input };
}

/**
 * Ask once after the 2026 design release whether a player wants the old one back.
 *
 * Only accounts that existed before the 2026 design are asked, once across all
 * devices (claimed on the server). Guests get a switch at the end of the lobby.
 * The dialog switch previews the choice live. Because the question is spent
 * once it opens, every way out keeps what the switch shows: "Speichern", ×,
 * Escape, a tap outside and leaving the page all save a changed choice.
 */
export function initializeDesignPrompt() {
  if (window.ZDWA_DESIGN_PROMPT) return window.ZDWA_DESIGN_PROMPT;
  const state = { timer: null, inFlight: false, shown: false, open: false, auth: null };

  const schedule = (delay = PROMPT_DELAY_MS) => {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => { void maybePrompt(); }, delay);
  };

  async function showPrompt() {
    const saved = design().state().choice;
    let control = null;
    let hint = null;
    // × and Escape stay available while saving, so a save can end after closing.
    let closed = false;
    const selected = () => (control?.input.checked === false ? "old" : "new");
    const save = () => design().save(selected(), { apiFetch }).catch(error => {
      if (closed) {
        // Closed meanwhile: keep the saved design and say what happened.
        design().preview(null);
        window.ZDWA_UI?.toast?.("Das Design konnte nicht gespeichert werden. Du kannst es im Konto unter Einstellungen → Sprache & Spiel → Aussehen ändern.", { kind: "error", duration: 8000 });
      } else {
        // Keep the dialog open with the design the switch shows.
        design().preview(selected());
        hint.textContent = t("Das Design konnte nicht gespeichert werden. Bitte versuche es noch einmal.");
        hint.classList.add("is-error");
      }
      throw error;
    });
    // A reload or navigation with the dialog open must not lose a changed switch.
    const saveOnLeave = () => {
      if (closed || design().state().choice === selected()) return;
      const leaving = (url, options) => apiFetch(url, { ...options, keepalive: true });
      void design().save(selected(), { apiFetch: leaving }).catch(() => {});
    };
    window.addEventListener("pagehide", saveOnLeave);
    state.open = true;
    let result = null;
    try {
      result = await window.ZDWA_UI.dialog({
        id: "zdwa-design-choice",
        title: t("Neues Design für ZDWA"),
        message: t("ZDWA sieht jetzt frischer aus: eine klarere Lobby, ein Spielzettel wie aus Papier und nach dem ersten Wurf die möglichen Punkte in jedem Feld. Lieber das gewohnte Aussehen? Schalte das neue Design hier aus."),
        onOpen: ({ message }) => {
          control = designSwitch(saved === "new");
          control.input.addEventListener("change", () => design().preview(selected()));
          hint = document.createElement("p");
          hint.className = "design-choice-hint";
          hint.setAttribute("aria-live", "polite");
          hint.textContent = t("Du kannst das jederzeit im Konto unter Einstellungen → Sprache & Spiel → Aussehen ändern.");
          message.after(control.label, hint);
        },
        actions: [{
          id: "apply",
          label: t("Speichern"),
          className: "primary",
          onAction: () => save(),
        }],
      });
    } finally {
      closed = true;
      state.open = false;
      window.removeEventListener("pagehide", saveOnLeave);
    }
    control?.label.remove();
    hint?.remove();
    if (result === "apply") return;
    // ×, Escape or a tap outside keep the design the switch shows. A save that
    // is still running already holds that choice.
    if (design().state().choice !== selected()) save().catch(() => {});
    else design().preview(null);
  }

  async function maybePrompt() {
    if (state.inFlight || state.shown || document.hidden || !window.ZDWA_UI?.dialog || !design()) return;
    const current = design().state();
    if (!current.available || current.overridden) return;
    const account = state.auth?.authenticated ? state.auth.user : null;
    // Only accounts from before the 2026 design are asked; guests use the lobby switch.
    if (!account?.design?.prompt_pending) return;
    // A pending release announcement goes first; never stack on another dialog.
    if (window.ZDWA_RELEASE_NOTES?.busy?.()) {
      schedule(RELEASE_NOTES_RETRY_MS);
      return;
    }
    if (visibleModalIsOpen()) {
      schedule(DIALOG_RETRY_MS);
      return;
    }
    state.inFlight = true;
    try {
      const response = await apiFetch("/api/auth/design-prompt", { method: "POST" });
      if (!response.ok) return;
      const payload = await response.json().catch(() => ({}));
      account.design = { ...(account.design || {}), prompt_pending: false };
      if (payload.show !== true) return;
      state.shown = true;
      // The claim is spent: wait for a dialog that opened meanwhile instead of skipping.
      await untilNoOtherDialog();
      await showPrompt();
    } catch (_) {
      // The design question must never disrupt the lobby.
    } finally {
      state.inFlight = false;
    }
  }

  // Guests have no account settings, so the lobby offers the switch itself.
  const guestLine = document.querySelector("[data-design-guest]");
  const guestLabel = guestLine?.querySelector("[data-design-guest-label]");
  const guestToggle = guestLine?.querySelector("[data-design-guest-toggle]");
  function renderGuestLine() {
    if (!guestLine || !design()) return;
    const current = design().state();
    guestLine.hidden = !state.auth || Boolean(state.auth.authenticated) || !current.available || current.overridden;
    const isNew = current.choice === "new";
    guestLabel.textContent = t(isNew ? "Du siehst das neue Design." : "Du siehst das bisherige Design.");
    guestToggle.textContent = t(isNew ? "Zum bisherigen Design wechseln" : "Neues Design ansehen");
  }
  guestToggle?.addEventListener("click", async () => {
    if (!design()) return;
    const next = design().state().choice === "new" ? "old" : "new";
    try { await design().save(next, { apiFetch }); } catch (_) { /* Guests save in this browser only. */ }
    renderGuestLine();
  });
  window.addEventListener("zdwa:design-change", renderGuestLine);

  const onAuth = auth => {
    state.auth = auth || null;
    renderGuestLine();
    schedule();
  };
  window.addEventListener("zdwa:auth-state", event => onAuth(event.detail));
  // The shell may have loaded the identity before this bundle listened.
  loadAuth().then(auth => { if (!state.auth) onAuth(auth); }).catch(() => {});
  document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(); });
  window.addEventListener("pagehide", () => window.clearTimeout(state.timer), { once: true });

  // The push invitation waits while this question is pending or open, so it
  // never spends its own one-time claim on a dialog that cannot show.
  const busy = () => {
    if (state.inFlight || state.open) return true;
    const current = design()?.state();
    const account = state.auth?.authenticated ? state.auth.user : null;
    return Boolean(current?.available && !current.overridden && !state.shown && account?.design?.prompt_pending);
  };
  window.ZDWA_DESIGN_PROMPT = { refresh: () => schedule(0), busy };
  return window.ZDWA_DESIGN_PROMPT;
}
