import { apiFetch } from "./auth.js";
import { avatarSource, DEFAULT_AVATAR, refreshAccountAvatars } from "./avatar.js";

const t = value => window.ZDWA_I18N?.t?.(value) || value;
const endpoint = "/api/account/avatar";
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const inputLimit = 8 * 1024 * 1024;

function detectedMediaType(bytes) {
  const view = new Uint8Array(bytes);
  if (view.length >= 3 && view[0] === 0xff && view[1] === 0xd8 && view[2] === 0xff) return "image/jpeg";
  if (view.length >= 8 && view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47
    && view[4] === 0x0d && view[5] === 0x0a && view[6] === 0x1a && view[7] === 0x0a) return "image/png";
  if (view.length >= 12 && view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46
    && view[8] === 0x57 && view[9] === 0x45 && view[10] === 0x42 && view[11] === 0x50) return "image/webp";
  return "";
}

function mediaTypeFor(file, bytes) {
  // A content signature is more reliable than the MIME type reported by an
  // installed PWA or a mobile file picker (which may derive it from a suffix).
  const detected = detectedMediaType(bytes);
  if (detected) return detected;
  if (allowedTypes.has(file?.type)) return file.type;
  // Some mobile file pickers omit File.type for otherwise ordinary pictures.
  const extension = String(file?.name || "").trim().split(".").pop()?.toLowerCase();
  return ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" })[extension]
    || "application/octet-stream";
}

async function snapshotFile(file) {
  if (typeof file?.arrayBuffer === "function") return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error("avatar_invalid"));
    }, { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("avatar_invalid")), { once: true });
    reader.readAsArrayBuffer(file);
  });
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal?.timeout === "function") return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

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
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return t(errors.avatar_upload_timeout);
  return t(errors[error?.message] || "Das Profilbild konnte nicht gespeichert werden. Bitte versuche es erneut.");
}

async function request(options = {}) {
  const response = await apiFetch(endpoint, { ...options, signal: timeoutSignal(15000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fallback = response.status === 413 ? "avatar_too_large"
      : response.status === 415 ? "avatar_format_unsupported"
        : response.status === 408 ? "avatar_upload_timeout"
          : response.status === 400 ? "avatar_invalid"
            : "avatar_unavailable";
    throw new Error(data.detail || fallback);
  }
  return data;
}

export function mountAvatarUpload(mount) {
  if (!mount || mount.dataset.avatarBound) return;
  mount.dataset.avatarBound = "true";
  mount.classList.add("avatar-upload");
  let account = null;
  let selected = null;
  let selectedType = "";
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

  function clearFile({ resetInput = true } = {}) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    selected = null;
    selectedType = "";
    if (resetInput) input.value = "";
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
    // Keep the newly chosen File in the native input until the upload has
    // finished. WebKit can invalidate its byte stream when value is reset in
    // this same change event, leaving an otherwise valid image empty.
    clearFile({ resetInput: false });
    ownPreview();
    const expectedEpoch = ++epoch;
    controls();
    if (!file) return;
    if (file.size > inputLimit) {
      clearFile();
      message.textContent = errorText(new Error("avatar_too_large"));
      return;
    }
    try {
      // Snapshot the bytes while the native picker still owns its temporary
      // file handle. This avoids WebKit/PWA implementations later uploading an
      // empty or no-longer-readable File object after the picker closes.
      const bytes = await snapshotFile(file);
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      if (!bytes.byteLength) throw new Error("avatar_invalid");
      if (bytes.byteLength > inputLimit) throw new Error("avatar_too_large");
      const mediaType = mediaTypeFor(file, bytes);
      selected = new Blob([bytes], { type: mediaType });
      selectedType = mediaType;
      // The upload now uses the stable Blob, so the native input can be reset
      // safely. It also lets a player select the same photo again immediately.
      input.value = "";
      objectUrl = URL.createObjectURL(selected);
      preview.src = objectUrl;
      message.textContent = t("Vorschau bereit. Mit Speichern übernimmst du das Bild für beide Spiele.");
      controls();
    } catch (error) {
      if (expectedEpoch !== epoch) return;
      clearFile();
      message.textContent = errorText(error);
    }
  });
  async function mutate(method) {
    if (busy || !account || (method === "PUT" && !selected)) return;
    const viewer = account.viewer_id;
    const replacedAvatar = method === "PUT" && Boolean(account.has_avatar);
    const expectedEpoch = ++epoch;
    busy = true;
    controls();
    message.textContent = t("Profilbild wird gespeichert …");
    try {
      const data = await request({ method, headers: {
        "X-Avatar-Viewer-Id": String(viewer),
        ...(method === "PUT" ? { "Content-Type": selectedType } : {}),
      }, ...(method === "PUT" ? { body: selected } : {}) });
      if (expectedEpoch !== epoch || !mount.isConnected) return;
      if (data.viewer_id !== viewer) throw new Error("avatar_viewer_changed");
      account = data;
      clearFile();
      ownPreview();
      refreshAccountAvatars(viewer);
      window.dispatchEvent(new CustomEvent("zdwa:avatar-updated", {
        detail: { userId: viewer, replaced: replacedAvatar },
      }));
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
