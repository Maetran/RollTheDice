/** Inspect only the already-public packet. This module never sends a command. */
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
  let discard = [], signature = "", opener, pointer, timer, suppressClick = false;

  // While a finger rests on the pile, its tooltip explains the long press.
  const group = pile.parentElement;
  let hintTimer;
  const stopHold = () => { clearTimeout(timer); clearTimeout(hintTimer); timer = null; pointer = null; group?.classList.remove("is-holding"); };
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
    render();
    if (!dialog.open) dialog.showModal();
    closeButton.focus({ preventScroll: true });
  };
  const onPointerDown = event => {
    if (!event.isPrimary || event.button !== 0 || !discard.length) return;
    suppressClick = false;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    hintTimer = setTimeout(() => { if (pointer) group?.classList.add("is-holding"); }, 160);
    timer = setTimeout(() => {
      if (!pointer) return;
      suppressClick = true;
      open(pile);
      stopHold();
    }, 500);
  };
  const onPointerMove = event => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 10) {
      suppressClick = true;
      stopHold();
    }
  };
  const onClick = event => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const onContextMenu = event => {
    if (!discard.length) return;
    event.preventDefault();
    suppressClick = true;
    stopHold();
    open(pile);
  };
  const onKeyDown = event => {
    if ((event.key === "Enter" && event.shiftKey) || event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      stopHold();
      open(pile);
    } else if (event.key === "Enter" || event.key === " ") suppressClick = false;
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
  window.addEventListener("pointerup", stopHold);
  window.addEventListener("pointercancel", stopHold);
  pile.addEventListener("pointerleave", stopHold);
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
    },
    close() { stopHold(); if (dialog.open) close(); },
    destroy() {
      stopHold();
      window.removeEventListener("pointerup", stopHold);
      window.removeEventListener("pointercancel", stopHold);
      pile.removeEventListener("pointerdown", onPointerDown);
      pile.removeEventListener("pointermove", onPointerMove);
      pile.removeEventListener("pointerleave", stopHold);
      pile.removeEventListener("click", onClick, true);
      pile.removeEventListener("contextmenu", onContextMenu);
      pile.removeEventListener("keydown", onKeyDown);
      inspectButton.removeEventListener("click", onInspect);
      dialog.remove();
    },
  };
}
