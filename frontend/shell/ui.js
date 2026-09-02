/* Shared, accessible feedback primitives for dialogs, toasts and app notices. */
(function () {
  "use strict";

  const t = value => window.ZDWA_I18N?.t?.(value) || String(value ?? "");
  const queue = [];
  let active = null;

  function ensureToastRegion() {
    let region = document.getElementById("appToastRegion");
    if (region) return region;
    region = document.createElement("div");
    region.id = "appToastRegion";
    region.className = "app-toast-region";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "false");
    document.body.appendChild(region);
    return region;
  }

  function toast(message, { kind = "info", duration = 3200, actionLabel = "", onAction = null, onDismiss = null } = {}) {
    const region = ensureToastRegion();
    const item = document.createElement("div");
    item.className = `app-toast app-toast-${kind}`;
    item.setAttribute("role", kind === "error" ? "alert" : "status");

    const text = document.createElement("span");
    text.className = "app-toast-text";
    text.textContent = t(message);
    item.appendChild(text);

    if (actionLabel) {
      const action = document.createElement("button");
      action.type = "button";
      action.className = "small app-toast-action";
      action.textContent = t(actionLabel);
      action.addEventListener("click", () => {
        try { onAction?.(); } finally { item.remove(); }
      });
      item.appendChild(action);
    }

    const close = document.createElement("button");
    close.type = "button";
    close.className = "app-toast-close";
    close.setAttribute("aria-label", t("Hinweis schließen"));
    close.textContent = "×";
    close.addEventListener("click", () => {
      try { onDismiss?.(); } finally { item.remove(); }
    });
    item.appendChild(close);
    region.appendChild(item);

    if (duration > 0) {
      setTimeout(() => {
        item.classList.add("leaving");
        setTimeout(() => item.remove(), 220);
      }, duration);
    }
    return item;
  }

  function ensureDialog() {
    let backdrop = document.getElementById("appDialogBackdrop");
    if (backdrop) return backdrop;
    backdrop = document.createElement("div");
    backdrop.id = "appDialogBackdrop";
    backdrop.className = "app-dialog-backdrop";
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section id="appDialog" class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle" aria-describedby="appDialogMessage" tabindex="-1">
        <div class="app-dialog-head">
          <h2 id="appDialogTitle"></h2>
          <button id="appDialogClose" class="app-dialog-close" type="button" aria-label="Dialog schließen">×</button>
        </div>
        <div id="appDialogMessage" class="app-dialog-message"></div>
        <label id="appDialogInputLabel" class="app-dialog-input-label" hidden>
          <span></span>
          <input id="appDialogInput" autocomplete="off">
        </label>
        <div id="appDialogActions" class="app-dialog-actions"></div>
      </section>`;
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function finish(value) {
    if (!active) return;
    const { resolve, previousFocus } = active;
    active = null;
    const backdrop = ensureDialog();
    backdrop.hidden = true;
    document.documentElement.classList.remove("app-dialog-open");
    document.body.classList.remove("app-dialog-open");
    try { previousFocus?.focus?.({ preventScroll: true }); } catch (_) {}
    resolve(value);
    setTimeout(pumpDialogQueue, 0);
  }

  function pumpDialogQueue() {
    if (active || !queue.length) return;
    active = queue.shift();
    const options = active.options;
    const backdrop = ensureDialog();
    const dialog = backdrop.querySelector("#appDialog");
    const title = backdrop.querySelector("#appDialogTitle");
    const message = backdrop.querySelector("#appDialogMessage");
    const close = backdrop.querySelector("#appDialogClose");
    const actions = backdrop.querySelector("#appDialogActions");
    const inputLabel = backdrop.querySelector("#appDialogInputLabel");
    const input = backdrop.querySelector("#appDialogInput");

    dialog.dataset.kind = options.kind || "info";
    title.textContent = t(options.title || "Hinweis");
    message.textContent = t(options.message || "");
    message.hidden = !options.message;
    close.hidden = options.dismissible === false;
    close.onclick = () => finish(options.cancelValue ?? null);
    backdrop.onclick = event => {
      if (event.target === backdrop && options.dismissible !== false) finish(options.cancelValue ?? null);
    };

    const inputOptions = options.input;
    inputLabel.hidden = !inputOptions;
    if (inputOptions) {
      inputLabel.querySelector("span").textContent = t(inputOptions.label || "Eingabe");
      input.type = inputOptions.type || "text";
      input.value = inputOptions.value || "";
      input.placeholder = t(inputOptions.placeholder || "");
      input.autocomplete = inputOptions.autocomplete || "off";
      input.select();
    } else {
      input.value = "";
    }

    actions.replaceChildren();
    const definitions = options.actions?.length
      ? options.actions
      : [{ id: "ok", label: "OK", className: "primary" }];
    for (const definition of definitions) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.dialogAction = definition.id;
      button.className = definition.className || "";
      button.textContent = t(definition.label);
      button.disabled = Boolean(definition.disabled);
      button.addEventListener("click", () => {
        const value = definition.useInput ? input.value : definition.value ?? definition.id;
        finish(value);
      });
      actions.appendChild(button);
    }

    backdrop.hidden = false;
    document.documentElement.classList.add("app-dialog-open");
    document.body.classList.add("app-dialog-open");
    setTimeout(() => {
      const target = inputOptions ? input : actions.querySelector(".primary:not(:disabled), button:not(:disabled)");
      try { (target || dialog).focus({ preventScroll: true }); } catch (_) { (target || dialog).focus(); }
    }, 0);
  }

  function dialog(options = {}) {
    return new Promise(resolve => {
      queue.push({ options, resolve, previousFocus: document.activeElement });
      pumpDialogQueue();
    });
  }

  // Some state transitions intentionally show an actionless progress dialog
  // before replacing it with the next mandatory step.  Keep this narrowly
  // addressed by dialog id so unrelated dialogs can never be dismissed.
  function dismiss(id, value = null) {
    if (active?.options?.id === id) {
      finish(value);
      return true;
    }
    const queuedIndex = queue.findIndex(entry => entry.options?.id === id);
    if (queuedIndex < 0) return false;
    const [queued] = queue.splice(queuedIndex, 1);
    queued.resolve(value);
    setTimeout(pumpDialogQueue, 0);
    return true;
  }

  async function notice(options = {}) {
    await dialog({ ...options, actions: options.actions || [{ id: "ok", label: options.buttonLabel || "OK", className: "primary" }] });
  }

  async function confirmDialog(options = {}) {
    const value = await dialog({
      ...options,
      cancelValue: false,
      actions: options.actions || [
        { id: "cancel", label: options.cancelLabel || "Abbrechen", value: false, className: "ghost" },
        { id: "confirm", label: options.confirmLabel || "Bestätigen", value: true, className: options.danger ? "danger" : "primary" },
      ],
    });
    return value === true;
  }

  async function promptDialog(options = {}) {
    return dialog({
      ...options,
      cancelValue: null,
      input: options.input || { label: options.label || "Eingabe", value: options.value || "" },
      actions: options.actions || [
        { id: "cancel", label: options.cancelLabel || "Abbrechen", value: null, className: "ghost" },
        { id: "confirm", label: options.confirmLabel || "Bestätigen", useInput: true, className: "primary" },
      ],
    });
  }

  document.addEventListener("keydown", event => {
    if (!active) return;
    const backdrop = ensureDialog();
    if (event.key === "Escape" && active.options.dismissible !== false) {
      event.preventDefault();
      finish(active.options.cancelValue ?? null);
      return;
    }
    if (event.key === "Enter" && event.target === backdrop.querySelector("#appDialogInput")) {
      event.preventDefault();
      backdrop.querySelector("#appDialogActions .primary")?.click();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(backdrop.querySelectorAll("button:not([hidden]):not(:disabled), input:not([hidden]):not(:disabled)"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  function rankLegendContext(badge) {
    const parsedPoints = Number(badge?.dataset?.rankPoints);
    const parsedMaximum = Number(badge?.dataset?.rankPointsPossible);
    return {
      key: String(badge?.dataset?.rankKey || ""),
      points: Number.isFinite(parsedPoints) ? Math.max(0, Math.trunc(parsedPoints)) : null,
      pointsPossible: Number.isFinite(parsedMaximum) ? Math.max(0, Math.trunc(parsedMaximum)) : null,
      owner: String(badge?.dataset?.rankOwner || "").trim(),
    };
  }

  function openRankLegend(badge) {
    const context = rankLegendContext(badge);
    if (typeof window.ZDWA_OPEN_RANK_LEGEND === "function") {
      try {
        const result = window.ZDWA_OPEN_RANK_LEGEND(context);
        if (result && typeof result.catch === "function") result.catch(() => {});
        return;
      } catch (_) {
        // A room overlay is a convenience. The full legend remains available.
      }
    }
    const url = new URL("/rangabzeichen", window.location.origin);
    if (context.points !== null) url.searchParams.set("punkte", String(context.points));
    if (context.owner) url.searchParams.set("spieler", context.owner);
    window.location.assign(url);
  }

  function rankLegendBadgeFromEvent(event) {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    return target?.closest?.("[data-rank-legend]") || null;
  }

  // Rank badges also appear inside linked player names. Delegation makes every
  // badge independently keyboard-accessible without ever nesting anchors.
  document.addEventListener("click", event => {
    const badge = rankLegendBadgeFromEvent(event);
    if (!badge) return;
    event.preventDefault();
    event.stopPropagation();
    openRankLegend(badge);
  }, true);

  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const badge = rankLegendBadgeFromEvent(event);
    if (!badge) return;
    event.preventDefault();
    event.stopPropagation();
    openRankLegend(badge);
  }, true);

  window.ZDWA_UI = { dialog, dismiss, notice, confirm: confirmDialog, prompt: promptDialog, toast };
})();
