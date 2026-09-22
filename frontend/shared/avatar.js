const sizes = new Set(["tiny", "small", "medium", "large"]);
export const DEFAULT_AVATAR = "/static/default-avatar.svg";

export function avatarUserId(player) {
  const value = Number(typeof player === "object" && player !== null ? player.user_id ?? player.id : player);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function avatarSource(player) {
  const userId = avatarUserId(player);
  return userId ? `/api/avatars/${userId}` : DEFAULT_AVATAR;
}

export function avatarMarkup(player, { size = "tiny", avatarKey = "" } = {}) {
  const safeSize = sizes.has(size) ? size : "tiny";
  const userId = avatarUserId(player);
  const safeKey = String(avatarKey).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
  // Image attributes use fixed enums/numeric IDs. The escaped key identifies
  // the occurrence; filenames and uploaded bytes are never HTML sources.
  return `<img class="player-avatar player-avatar--${safeSize}" src="${avatarSource(player)}"${userId ? ` data-user-avatar="${userId}"` : ""}${safeKey ? ` data-avatar-key="${safeKey}"` : ""} alt="" width="${safeSize === "large" ? 80 : safeSize === "medium" ? 48 : safeSize === "small" ? 28 : 20}" height="${safeSize === "large" ? 80 : safeSize === "medium" ? 48 : safeSize === "small" ? 28 : 20}" loading="lazy" decoding="async">`;
}

function preservedAvatarIdentity(image) {
  const userId = image.dataset.userAvatar;
  if (userId) return `user:${userId}`;
  const source = image.getAttribute("src") || "";
  try {
    return `src:${new URL(source, document.baseURI).pathname}`;
  } catch {
    return `src:${source.split("?")[0]}`;
  }
}

function preservedAvatarKey(image) {
  const slot = image.dataset.avatarKey;
  return slot ? `${slot}|${preservedAvatarIdentity(image)}` : "";
}

function syncPreservedAvatarAttributes(current, replacement) {
  const replacementAttributes = new Set(Array.from(replacement.attributes, attribute => attribute.name));
  for (const attribute of Array.from(current.attributes)) {
    if (attribute.name !== "src" && !replacementAttributes.has(attribute.name)) {
      current.removeAttribute(attribute.name);
    }
  }
  for (const attribute of Array.from(replacement.attributes)) {
    if (attribute.name !== "src") current.setAttribute(attribute.name, attribute.value);
  }
}

/**
 * Replaces generated markup or a DOM fragment while keeping decoded, keyed
 * avatar images alive. This prevents Safari from briefly painting an empty
 * image whenever a live game snapshot refreshes otherwise unchanged content.
 */
export function replaceChildrenPreservingAvatars(container, html) {
  if (!(container instanceof Element)) return;
  const preserved = new Map();
  for (const image of container.querySelectorAll("img.player-avatar[data-avatar-key]")) {
    const key = preservedAvatarKey(image);
    if (key) preserved.set(key, image);
  }

  const template = document.createElement("template");
  if (html instanceof DocumentFragment) template.content.append(html);
  else template.innerHTML = String(html ?? "");
  const replacements = [];
  for (const replacement of template.content.querySelectorAll("img.player-avatar[data-avatar-key]")) {
    const key = preservedAvatarKey(replacement);
    const current = preserved.get(key);
    if (!current) continue;
    preserved.delete(key);
    syncPreservedAvatarAttributes(current, replacement);
    // Do not let the temporary placeholder start its own request when the new
    // fragment becomes live. It is synchronously replaced by the decoded node.
    replacement.removeAttribute("src");
    replacements.push({ current, replacement });
  }

  const parent = container.parentNode;
  if (!parent || !container.isConnected || replacements.length === 0) {
    for (const { current, replacement } of replacements) replacement.replaceWith(current);
    container.replaceChildren(template.content);
    return;
  }

  // Keep the decoded images connected to the document throughout the swap.
  // Detaching and reinserting even the same <img> can emit another load event
  // and briefly clear it in Safari.
  const parking = document.createElement("span");
  parking.hidden = true;
  parking.setAttribute("aria-hidden", "true");
  parent.insertBefore(parking, container);
  for (const { current } of replacements) parking.appendChild(current);
  container.replaceChildren(template.content);
  for (const { current, replacement } of replacements) replacement.replaceWith(current);
  parking.remove();
}

export function refreshAccountAvatars(userId) {
  const id = avatarUserId(userId);
  if (!id) return;
  for (const image of document.querySelectorAll(`img[data-user-avatar="${id}"]`)) {
    image.src = `${avatarSource(id)}?v=${Date.now()}`;
  }
}

export function initializeAvatarFallbacks() {
  if (window.__playerAvatarFallbacks) return;
  window.__playerAvatarFallbacks = true;
  document.addEventListener("error", event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && image.classList.contains("player-avatar")
      && new URL(image.src, location.href).pathname !== DEFAULT_AVATAR) image.src = DEFAULT_AVATAR;
  }, true);
}
