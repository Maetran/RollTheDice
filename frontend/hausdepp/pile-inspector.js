/** Inspect only the already-public packet. This module never sends a command.
 *  Holding the pile fans every card out until release; the list dialog stays
 *  available by button, right-click and keyboard. */
import { createPileHoldFan } from "./pile-hold-fan.js";

export function mountPileInspector({ pile, inspectButton, table, t, cardMarkup }) {
  const dialog = document.createElement("dialog");
  dialog.id = "hausdeppPileInspector";
  dialog.className = "hd-pile-inspector";
  dialog.setAttribute("aria-labelledby", "hausdeppPileInspectorTitle");
  dialog.innerHTML = `<header><h2 id="hausdeppPileInspectorTitle"></h2><button type="button" data-pile-inspector-close></button></header><p data-pile-inspector-hint></p><p data-pile-inspector-status role="status" aria-live="polite"></p><ol data-pile-inspector-cards></ol>`;
  table.append(dialog);
  const closeButton = dialog.querySelector("[data-pile-inspector-close]");
  const cards = dialog.querySelector("[data-pile-inspector-cards]");
  const status = dialog.querySelector("[data-pile-inspector-status]");
  let discard = [], signature = "", opener, pointer, timer, suppressClick = false, suppressTimer;

  const fan = createPileHoldFan({ table, pile, cardMarkup, t });
  // While a finger rests on the pile, its tooltip explains the long press.
  const group = pile.parentElement;
  let hintTimer;
  const clearTimers = () => { clearTimeout(timer); clearTimeout(hintTimer); timer = null; group?.classList.remove("is-holding"); };
  const stopHold = () => {
    clearTimers();
    pointer = null;
    fan.hide();
    // After a hold, every trailing click (captured release, touch compatibility
    // click) is swallowed until the next press or briefly after letting go.
    if (suppressClick) { clearTimeout(suppressTimer); suppressTimer = setTimeout(() => { suppressClick = false; }, 600); }
  };
  const render = () => {
    dialog.querySelector("h2").textContent = t("inspectPile");
    closeButton.textContent = t("close");
    dialog.querySelector("[data-pile-inspector-hint]").textContent = t("inspectPileHint");
    status.textContent = discard.length ? t("pileCount", { count: discard.length }) : t("tableClear");
    const next = JSON.stringify(discard);
    if (signature !== next) {
      signature = next;
      cards.innerHTML = discard.map(card => `<li>${cardMarkup(card)}</li>`).join("");
    }
  };
  const open = source => {
    if (!discard.length || !dialog.isConnected) return;
    opener = source;
    fan.hide();
    render();
    if (!dialog.open) dialog.showModal();
    closeButton.focus({ preventScroll: true });
  };
  const onPointerDown = event => {
    if (!event.isPrimary || event.button !== 0 || !discard.length) return;
    stopHold();
    clearTimeout(suppressTimer);
    suppressClick = false;
    pointer = { id: event.pointerId, type: event.pointerType, x: event.clientX, y: event.clientY };
    // Keep a held finger's release on the pile, even after it slides away.
    try { pile.setPointerCapture?.(event.pointerId); } catch { /* Synthetic or already released pointers. */ }
    hintTimer = setTimeout(() => { if (pointer) group?.classList.add("is-holding"); }, 160);
    timer = setTimeout(() => {
      if (!pointer) return;
      suppressClick = true;
      clearTimers();
      if (!fan.show(discard)) stopHold();
    }, 500);
  };
  const onPointerMove = event => {
    // Once open, the fan follows the hold, not the finger's position.
    if (fan.open) return;
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) {
      suppressClick = true;
      stopHold();
    }
  };
  const onClick = event => {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onPointerEnd = event => {
    if (pointer && event.pointerId !== pointer.id) return;
    stopHold();
  };
  const onPointerLeave = event => { if (!fan.open) onPointerEnd(event); };
  // Losing the pointer (capture lost, app switch, window blur) also lets go.
  const onLostCapture = event => { if (pointer?.id === event.pointerId) stopHold(); };
  const onHidden = () => { if (document.hidden) stopHold(); };
  const onContextMenu = event => {
    if (!discard.length) return;
    event.preventDefault();
    suppressClick = true;
    // A touch long press also raises the system menu; the held fan answers it.
    if (pointer && ["touch", "pen"].includes(event.pointerType || pointer.type)) {
      clearTimers();
      if (!fan.open) fan.show(discard);
      return;
    }
    stopHold();
    open(pile);
  };
  const onKeyDown = event => {
    if ((event.key === "Enter" && event.shiftKey) || event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      stopHold();
      open(pile);
    } else if (event.key === "Enter" || event.key === " ") { clearTimeout(suppressTimer); suppressClick = false; }
  };
  const onInspect = () => open(inspectButton);
  const close = () => dialog.close();
  const onClose = () => {
    const destination = opener?.isConnected && !opener.disabled ? opener : document.querySelector("#hausdeppTools > summary");
    destination?.focus({ preventScroll: true });
  };
  pile.setAttribute("aria-keyshortcuts", "Shift+Enter");
  inspectButton.setAttribute("aria-haspopup", "dialog");
  pile.addEventListener("pointerdown", onPointerDown);
  pile.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerEnd);
  window.addEventListener("pointercancel", onPointerEnd);
  pile.addEventListener("pointerleave", onPointerLeave);
  pile.addEventListener("lostpointercapture", onLostCapture);
  window.addEventListener("blur", stopHold);
  document.addEventListener("visibilitychange", onHidden);
  pile.addEventListener("click", onClick, true);
  pile.addEventListener("contextmenu", onContextMenu);
  pile.addEventListener("keydown", onKeyDown);
  inspectButton.addEventListener("click", onInspect);
  closeButton.addEventListener("click", close);
  dialog.addEventListener("close", onClose);
  return {
    update(publicDiscard) {
      discard = [...(publicDiscard || [])];
      inspectButton.disabled = !discard.length;
      if (dialog.open) render();
      if (!discard.length) stopHold();
      else fan.update(discard);
    },
    close() { stopHold(); if (dialog.open) close(); },
    destroy() {
      stopHold();
      clearTimeout(suppressTimer);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
      pile.removeEventListener("pointerdown", onPointerDown);
      pile.removeEventListener("pointermove", onPointerMove);
      pile.removeEventListener("pointerleave", onPointerLeave);
      pile.removeEventListener("lostpointercapture", onLostCapture);
      window.removeEventListener("blur", stopHold);
      document.removeEventListener("visibilitychange", onHidden);
      pile.removeEventListener("click", onClick, true);
      pile.removeEventListener("contextmenu", onContextMenu);
      pile.removeEventListener("keydown", onKeyDown);
      inspectButton.removeEventListener("click", onInspect);
      dialog.remove();
      fan.destroy();
    },
  };
}
