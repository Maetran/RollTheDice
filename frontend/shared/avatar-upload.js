import { apiFetch } from "./auth.js";
import { avatarSource, DEFAULT_AVATAR, refreshAccountAvatars } from "./avatar.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const endpoint = "/api/account/avatar";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const inputLimit = 8 * 1024 * 1024;
const maxSide = 4096;

function node(tag, text = "", className = "") {
  const result = document.createElement(tag);
  result.textContent = text;
  if (className) result.className = className;
  return result;
}

function errorText(error) {
  const errors = {
    avatar_too_large: "Das Bild darf höchstens 8 MB groß sein.",
    avatar_dimensions: "Das Bild darf höchstens 4.096 × 4.096 Pixel groß sein.",
    avatar_dimensions_invalid: "Das Bild darf höchstens 4.096 × 4.096 Pixel groß sein.",
    avatar_format_unsupported: "Bitte wähle ein gültiges JPG-, PNG- oder WebP-Bild ohne Animation.",
    avatar_animation_unsupported: "Bitte wähle ein Bild ohne Animation.",
    avatar_invalid: "Das Bild konnte nicht gelesen werden. Bitte wähle ein anderes Bild.",
    avatar_invalid_image: "Das Bild konnte nicht gelesen werden. Bitte wähle ein anderes Bild.",
    avatar_output_too_large: "Das Bild konnte nicht klein genug gespeichert werden. Bitte wähle ein einfacheres Bild.",
    avatar_upload_timeout: "Der Upload hat zu lange gedauert. Bitte versuche es erneut.",
    avatar_rate_limited: "Bitte warte eine Minute, bevor du ein weiteres Bild hochlädst.",
    avatar_viewer_changed: "Deine Anmeldung hat sich geändert. Bitte lade die Seite neu.",
    authentication_required: "Bitte melde dich an, um dein Profilbild zu ändern.",
  };
  return t(errors[error?.message] || "Das Profilbild konnte nicht gespeichert werden. Bitte versuche es erneut.");
}

async function request(options = {}) {
  const response = await apiFetch(endpoint, { ...options, signal: AbortSignal.timeout(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || "avatar_unavailable");
  return data;
}

export function mountAvatarUpload(mount) {
  if (!mount || mount.dataset.avatarBound) return;
  mount.dataset.avatarBound = "true";
  mount.classList.add("avatar-upload");
  let account = null;
  let selected = null;
  let objectUrl = null;
  let epoch = 0;
  let busy = false;
  const preview = node("img", "", "player-avatar player-avatar--large");
  preview.alt = t("Vorschau deines Profilbilds");
  preview.width = preview.height = 80;
  preview.src = DEFAULT_AVATAR;
  const previewRow = node("div", "", "avatar-upload-preview");
  previewRow.append(preview);
  const label = node("label", t("Neues Profilbild wählen"));
  const input = node("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp";
  label.append(input);
  const hint = node("p", t("JPG, PNG oder WebP, höchstens 8 MB und 4.096 × 4.096 Pixel. Das Bild wird mittig quadratisch auf 256 × 256 Pixel zugeschnitten und ist öffentlich sichtbar. Keine Animationen. Metadaten werden entfernt."), "avatar-upload-hint");
  const save = node("button", t("Profilbild speichern"), "primary");
  const remove = node("button", t("Profilbild entfernen"), "small ghost");
  const retry = node("button", t("Erneut versuchen"), "small ghost");
  for (const button of [save, remove, retry]) button.type = "button";
  const actions = node("div", "", "avatar-upload-actions");
  actions.append(save, remove, retry);
  const message = node("p", "", "avatar-upload-message");
  message.setAttribute("role", "status");
  mount.replaceChildren(previewRow, label, hint, actions, message);

  function clearFile() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    selected = null;
    input.value = "";
  }
  function controls() {
    input.disabled = busy || !account;
    save.disabled = busy || !account || !selected;
    remove.disabled = busy || !account?.has_avatar;
    retry.hidden = Boolean(account);
    retry.disabled = busy;
  }
  function ownPreview() {
    preview.src = account?.has_avatar ? `${avatarSource(account.viewer_id)}?v=${Date.now()}` : DEFAULT_AVATAR;
  }
  async function refresh() {
    const expectedEpoch = ++epoch;
    busy = true;
    clearFile();
    account = null;
    preview.src = DEFAULT_AVATAR;
    controls();
    message.textContent = t("Profilbild wird geladen …");
    try {
      const data = await request();
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      account = data;
      ownPreview();
      message.textContent = "";
    } catch (error) {
      if (expectedEpoch === epoch) message.textContent = errorText(error);
    } finally {
      if (expectedEpoch === epoch) { busy = false; controls(); }
    }
  }
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    clearFile();
    ownPreview();
    const expectedEpoch = ++epoch;
    controls();
    if (!file) return;
    if (file.size > inputLimit) { message.textContent = errorText(new Error("avatar_too_large")); return; }
    if (!allowedTypes.has(file.type)) { message.textContent = errorText(new Error("avatar_invalid_format")); return; }
    objectUrl = URL.createObjectURL(file);
    const candidateUrl = objectUrl;
    const candidate = new Image();
    candidate.src = candidateUrl;
    try {
      await candidate.decode();
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      if (!candidate.naturalWidth || !candidate.naturalHeight || candidate.naturalWidth > maxSide || candidate.naturalHeight > maxSide) {
        throw new Error("avatar_dimensions_invalid");
      }
      selected = file;
      preview.src = candidateUrl;
      message.textContent = t("Vorschau bereit. Mit Speichern übernimmst du das Bild für beide Spiele.");
    } catch (error) {
      if (expectedEpoch !== epoch) return;
      clearFile();
      message.textContent = errorText(error.message === "avatar_dimensions_invalid" ? error : new Error("avatar_invalid_image"));
    }
    controls();
  });
  async function mutate(method) {
    if (busy || !account || (method === "PUT" && !selected)) return;
    const viewer = account.viewer_id;
    const expectedEpoch = ++epoch;
    busy = true;
    controls();
    message.textContent = t("Profilbild wird gespeichert …");
    try {
      const data = await request({ method, headers: {
        "X-Avatar-Viewer-Id": String(viewer),
        ...(method === "PUT" ? { "Content-Type": selected.type } : {}),
      }, ...(method === "PUT" ? { body: selected } : {}) });
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      if (data.viewer_id !== viewer) throw new Error("avatar_viewer_changed");
      account = data;
      clearFile();
      ownPreview();
      refreshAccountAvatars(viewer);
      window.dispatchEvent(new CustomEvent("zdwa:avatar-updated", { detail: { userId: viewer } }));
      message.textContent = t(method === "PUT" ? "Profilbild gespeichert." : "Profilbild entfernt. Das Standardbild wird verwendet.");
    } catch (error) {
      if (expectedEpoch === epoch) message.textContent = errorText(error);
    } finally {
      if (expectedEpoch === epoch) { busy = false; controls(); }
    }
  }
  save.addEventListener("click", () => { void mutate("PUT"); });
  remove.addEventListener("click", () => { void mutate("DELETE"); });
  retry.addEventListener("click", refresh);
  window.addEventListener("zdwa:auth-state", event => {
    const viewer = event.detail?.authenticated ? event.detail.user?.id : null;
    if (viewer !== account?.viewer_id && mount.isConnected) void refresh();
  });
  window.addEventListener("pagehide", clearFile, { once: true });
  void refresh();
}
