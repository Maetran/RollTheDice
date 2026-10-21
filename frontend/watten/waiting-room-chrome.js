const backIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6M8 12h12"/></svg>';

/** Move the live language/voice controls; never recreate their subscriptions. */
export function createWaitingRoomChrome({ root, header, dom = document }) {
  const html = dom.documentElement, wasHidden = header?.hidden || false;
  const tools = dom.createElement("div");
  tools.className = "wt-waiting-tools";
  tools.dataset.wattenWaitingControls = "";
  const leave = dom.createElement("button"), lobby = dom.createElement("a"), rules = dom.createElement("a");
  leave.type = "button";
  leave.dataset.wattenCommand = "waiting-back";
  for (const node of [leave, lobby]) {
    node.className = "wt-button wt-button--ghost wt-waiting-back";
    node.innerHTML = backIcon;
  }
  rules.className = "wt-button wt-button--ghost wt-waiting-rules";
  tools.append(leave, lobby, rules);
  const language = header?.querySelector("[data-language-switcher]")?.closest("label");
  const voice = root.querySelector("[data-watten-voice]");
  const homes = [language, voice].filter(Boolean).map(node => {
    const marker = dom.createComment("waiting-room control home");
    node.before(marker);
    return { node, marker };
  });
  let parkedFocus = null, destroyed = false;
  const focusVisible = node => {
    if (node?.isConnected && !node.closest("[hidden]")) node.focus({ preventScroll: true });
  };
  function park() {
    if (tools.contains(dom.activeElement)) parkedFocus = dom.activeElement;
    tools.remove();
  }
  function restore() {
    const focused = tools.contains(dom.activeElement) ? dom.activeElement : parkedFocus;
    for (const { node, marker } of homes) if (marker.parentNode && marker.nextSibling !== node) marker.after(node);
    tools.remove();
    if (header) header.hidden = wasHidden;
    delete html.dataset.wattenWaiting;
    focusVisible(focused);
    parkedFocus = null;
  }
  return {
    park,
    show(slot, { member, busy, canLeave, lobbyUrl, rulesUrl, leaveLabel, lobbyLabel, rulesLabel }) {
      if (destroyed || !slot) return;
      const focused = parkedFocus || (header?.contains(dom.activeElement) ? dom.activeElement : null);
      leave.hidden = !member || !canLeave;
      leave.disabled = Boolean(busy);
      leave.setAttribute("aria-label", leaveLabel);
      leave.title = leaveLabel;
      lobby.hidden = member && canLeave;
      lobby.href = lobbyUrl;
      lobby.setAttribute("aria-label", lobbyLabel);
      lobby.title = lobbyLabel;
      rules.href = rulesUrl;
      rules.textContent = rulesLabel;
      for (const { node } of homes) if (node.parentNode !== tools) tools.append(node);
      slot.append(tools);
      if (header) header.hidden = true;
      html.dataset.wattenWaiting = "true";
      if (focused?.isConnected && !focused.closest("[hidden]")) focusVisible(focused);
      else if (focused) focusVisible(slot.closest(".wt-waiting")?.querySelector("h2"));
      parkedFocus = null;
    },
    restore,
    destroy() {
      if (destroyed) return;
      restore();
      for (const { marker } of homes) marker.remove();
      destroyed = true;
    },
  };
}
