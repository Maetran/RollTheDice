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

export function avatarMarkup(player, { size = "tiny" } = {}) {
  const safeSize = sizes.has(size) ? size : "tiny";
  const userId = avatarUserId(player);
  // Every attribute is generated locally from fixed enums/numeric IDs. User
  // filenames, MIME declarations and uploaded bytes are never HTML sources.
  return `<img class="player-avatar player-avatar--${safeSize}" src="${avatarSource(player)}"${userId ? ` data-user-avatar="${userId}"` : ""} alt="" width="${safeSize === "large" ? 80 : safeSize === "medium" ? 48 : safeSize === "small" ? 28 : 20}" height="${safeSize === "large" ? 80 : safeSize === "medium" ? 48 : safeSize === "small" ? 28 : 20}" loading="lazy" decoding="async">`;
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
