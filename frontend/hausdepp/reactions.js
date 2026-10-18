export const REACTION_CATALOG = [
  { emoji: "👍", key: "reactionThumbsUp" }, { emoji: "😂", key: "reactionLaughing" },
  { emoji: "😮", key: "reactionAmazed" }, { emoji: "💩", key: "reactionCrap" },
  { emoji: "🎉", key: "reactionCelebrate" }, { emoji: "🤞", key: "reactionFingersCrossed" },
  { emoji: "🙏", key: "reactionPlease" }, { emoji: "😜", key: "reactionCheeky" },
  { emoji: "🙄", key: "reactionEyeRoll" }, { emoji: "🤦", key: "reactionFacepalm" },
  { emoji: "😭", key: "reactionCrying" }, { emoji: "🔥", key: "reactionOnFire" },
];
export const REACTION_STORAGE_PREFIX = "hausdepp:reactions:v1:";
const EMOJIS = new Set(REACTION_CATALOG.map(item => item.emoji));
const MAX_SEEN = 128, PENDING_LIFETIME = 20000;
let nextPickerId = 0;

/** A local convenience only. Failed sends and somebody else's echo never count. */
export function createReactionFrequency({ userId, storage, now = Date.now }) {
  const account = String(userId ?? "").trim();
  const storageKey = /^[1-9]\d*$/.test(account) ? `${REACTION_STORAGE_PREFIX}${account}` : null;
  const read = () => {
    try {
      if (!storageKey || !storage) return null;
      const raw = JSON.parse(storage.getItem(storageKey));
      if (!raw || raw.version !== 1 || !raw.counts || typeof raw.counts !== "object" || Array.isArray(raw.counts)) return null;
      const counts = {};
      for (const emoji of EMOJIS) {
        const count = raw.counts[emoji];
        if (Number.isInteger(count) && count > 0 && count <= 1000000) counts[emoji] = count;
      }
      const seen = Array.isArray(raw.seen) ? raw.seen.filter(key => typeof key === "string" && key.length <= 256).slice(-MAX_SEEN) : [];
      return { counts, seen };
    } catch { return null; }
  };
  const initial = read();
  const counts = { ...(initial?.counts || {}) }, seen = new Set(initial?.seen || []);
  // This order is frozen for this room, including while new echoes arrive.
  const quick = REACTION_CATALOG.map((item, index) => ({ ...item, index }))
    .sort((a, b) => (counts[b.emoji] || 0) - (counts[a.emoji] || 0) || a.index - b.index)
    .slice(0, 4).map(item => item.emoji);
  let pending = [], nextPendingId = 0;
  const prune = () => { const current = now(); pending = pending.filter(item => current - item.at <= PENDING_LIFETIME); };
  const persist = () => {
    try { if (storageKey && storage) storage.setItem(storageKey, JSON.stringify({ version: 1, counts, seen: [...seen].slice(-MAX_SEEN) })); } catch { /* Private browsing keeps the in-memory room usable. */ }
  };
  return {
    quick: [...quick],
    prepare(emoji) {
      if (!EMOJIS.has(emoji)) return null;
      prune();
      const token = ++nextPendingId;
      pending.push({ token, emoji, at: now() });
      pending = pending.slice(-32);
      return token;
    },
    cancel(token) { pending = pending.filter(item => item.token !== token); },
    clearPending() { pending = []; },
    confirm(reaction, own = false) {
      if (!own || !storageKey || !reaction || !EMOJIS.has(reaction.emoji)
          || typeof reaction.from_id !== "string" || !reaction.from_id
          || typeof reaction.ts !== "string" || !reaction.ts || reaction.ts.length > 100) return false;
      prune();
      const pendingIndex = pending.findIndex(item => item.emoji === reaction.emoji);
      if (pendingIndex < 0) return false;
      const fresh = read();
      for (const emoji of EMOJIS) counts[emoji] = Math.max(counts[emoji] || 0, fresh?.counts[emoji] || 0);
      for (const key of fresh?.seen || []) seen.add(key);
      const key = `${reaction.from_id}:${reaction.ts}:${reaction.emoji}`;
      if (seen.has(key)) return false;
      pending.splice(pendingIndex, 1);
      seen.add(key);
      while (seen.size > MAX_SEEN) seen.delete(seen.values().next().value);
      counts[reaction.emoji] = Math.min(1000000, (counts[reaction.emoji] || 0) + 1);
      persist();
      return true;
    },
  };
}

/** Mount into the existing .hd-reactions; the caller owns socket identity/lifetime. */
export function mountReactions(container, { userId, t, send, isOwnReaction, connected }) {
  let storage;
  try { storage = window.localStorage; } catch { /* Storage is optional. */ }
  const frequency = createReactionFrequency({ userId, storage });
  const lifetime = new AbortController(), { signal } = lifetime;
  const pickerId = `hausdeppReactionPicker-${++nextPickerId}`;
  let destroyed = false;
  const online = () => !destroyed && Boolean(typeof connected === "function" ? connected() : connected);
  container.replaceChildren();
  container.classList.add("hd-reactions-ready");
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", t("reactions"));

  const status = document.createElement("span");
  status.className = "hd-sr";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const dialog = document.createElement("dialog");
  dialog.id = pickerId;
  dialog.className = "hd-reaction-picker";
  dialog.setAttribute("aria-labelledby", `${pickerId}-title`);
  dialog.innerHTML = `<header><h2 id="${pickerId}-title"></h2><button type="button" data-reaction-close></button></header><div class="hd-reaction-grid"></div>`;
  dialog.querySelector("h2").textContent = t("reactionPickerTitle");
  const closeButton = dialog.querySelector("[data-reaction-close]");
  closeButton.textContent = t("close");
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "hd-reaction-toggle";
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-controls", pickerId);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-label", t("reactionPickerOpen"));
  toggle.title = t("reactionPickerOpen");
  toggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';

  const close = ({ restoreFocus = true } = {}) => {
    if (!dialog.open) return;
    dialog.close();
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", t("reactionPickerOpen"));
    toggle.title = t("reactionPickerOpen");
    if (restoreFocus && !toggle.disabled && toggle.isConnected) toggle.focus({ preventScroll: true });
  };
  const choose = emoji => {
    if (!online()) { updateConnection(); return; }
    const token = frequency.prepare(emoji);
    let accepted = false;
    try { accepted = send({ action: "send_emoji", emoji }) !== false; } catch { /* A lost socket is not a confirmed reaction. */ }
    if (!accepted) frequency.cancel(token);
    close();
    if (!accepted) status.textContent = t("connectionLost");
  };
  const makeButton = (emoji, quick = false) => {
    const item = REACTION_CATALOG.find(entry => entry.emoji === emoji);
    const button = document.createElement("button");
    button.type = "button";
    if (quick) { button.dataset.hausdeppReaction = emoji; button.dataset.reactionQuick = "true"; }
    else button.dataset.reactionChoice = emoji;
    button.setAttribute("aria-label", t(item.key));
    button.title = t(item.key);
    button.textContent = emoji;
    button.addEventListener("click", event => { event.stopPropagation(); choose(emoji); }, { signal });
    return button;
  };
  for (const emoji of frequency.quick) container.append(makeButton(emoji, true));
  container.append(toggle, status);
  for (const item of REACTION_CATALOG) dialog.querySelector(".hd-reaction-grid").append(makeButton(item.emoji));
  document.body.append(dialog);

  const placePicker = () => {
    if (!dialog.open) return;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0, topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    dialog.style.maxHeight = `${Math.max(80, height - 16)}px`;
    const panel = dialog.getBoundingClientRect(), anchor = container.getBoundingClientRect();
    const hand = document.querySelector(".hd-hand-region")?.getBoundingClientRect();
    let left = Math.max(leftEdge + 8, Math.min(anchor.right - panel.width, leftEdge + width - panel.width - 8));
    let top = Math.min(anchor.top - panel.height - 8, hand ? hand.top - panel.height - 8 : Infinity);
    // A low landscape phone keeps the hand on the left: the picker uses the
    // other half rather than covering the cards or making their targets smaller.
    if (hand && width > height && width <= 1099 && hand.right + panel.width + 16 <= leftEdge + width) {
      left = Math.max(left, hand.right + 8);
      top = topEdge + 8;
    }
    top = Math.max(topEdge + 8, Math.min(top, topEdge + height - panel.height - 8));
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  };
  const open = () => {
    if (!online() || dialog.open) return;
    dialog.showModal();
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", t("reactionPickerClose"));
    toggle.title = t("reactionPickerClose");
    placePicker();
    dialog.querySelector("[data-reaction-choice]")?.focus({ preventScroll: true });
  };
  toggle.addEventListener("click", () => { if (dialog.open) close(); else open(); }, { signal });
  closeButton.addEventListener("click", () => close(), { signal });
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); }, { signal });
  dialog.addEventListener("click", event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) return;
    // Keep the modal in place through pointer-up. This click belongs to its
    // backdrop and must never fall through to a hand card after dismissal.
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, { signal });
  window.addEventListener("resize", placePicker, { signal });
  window.visualViewport?.addEventListener("resize", placePicker, { signal });
  window.visualViewport?.addEventListener("scroll", placePicker, { signal });

  function updateConnection() {
    const available = online();
    for (const button of [...container.querySelectorAll("button"), ...dialog.querySelectorAll("[data-reaction-choice]")]) button.disabled = !available;
    status.textContent = available ? "" : t("connectionLost");
    if (!available) { frequency.clearPending(); close({ restoreFocus: false }); }
  }
  updateConnection();
  return {
    confirm(reaction) {
      if (destroyed) return false;
      let own = false;
      try { own = Boolean(isOwnReaction?.(reaction)); } catch { /* Identity must be proven by the caller. */ }
      return frequency.confirm(reaction, own);
    },
    updateConnection,
    close,
    destroy() {
      if (destroyed) return;
      close({ restoreFocus: false });
      destroyed = true;
      frequency.clearPending();
      lifetime.abort();
      dialog.remove();
      container.replaceChildren();
      container.classList.remove("hd-reactions-ready");
    },
  };
}
