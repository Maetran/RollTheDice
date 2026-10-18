import { escapeHtml as esc } from "../shared/auth.js";

const key = (userId, gameId) => `hausdepp:table-access:${userId}:${gameId}`;

export function rememberTablePassword(userId, gameId, password) {
  try {
    if (password) sessionStorage.setItem(key(userId, gameId), password);
    else sessionStorage.removeItem(key(userId, gameId));
  } catch { /* A blocked session store still permits an explicit join. */ }
}

export function storedTablePassword(userId, gameId) {
  try { return sessionStorage.getItem(key(userId, gameId)) || ""; } catch { return ""; }
}

/** The password travels only in the authenticated WebSocket join, never a URL. */
export function requestTablePassword(t, { incorrect = false, signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) { resolve(null); return; }
    const dialog = document.createElement("dialog");
    dialog.className = "hd-create-dialog";
    dialog.setAttribute("aria-labelledby", "hausdeppAccessTitle");
    dialog.innerHTML = `<div class="hd-creator-heading"><h2 id="hausdeppAccessTitle">${t("creatorPasswordTitle")}</h2></div><form><label class="hd-creator-password">${t("creatorPasswordLabel")}<input type="password" name="passphrase" autocomplete="current-password" maxlength="100" required></label>${incorrect ? `<p class="hd-error" role="alert">${esc(t("tablePasswordIncorrect"))}</p>` : ""}<div class="hd-creator-footer"><button type="button" data-access-cancel>${t("creatorBack")}</button><button type="submit" class="hd-primary">${t("join")}</button></div></form>`;
    let finished = false;
    const finish = value => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      dialog.querySelector("input").value = "";
      dialog.close(); dialog.remove(); resolve(value);
    };
    const abort = () => finish(null);
    signal?.addEventListener("abort", abort, { once: true });
    dialog.querySelector("[data-access-cancel]").addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", event => { event.preventDefault(); finish(null); });
    dialog.querySelector("form").addEventListener("submit", event => {
      event.preventDefault();
      const input = dialog.querySelector("input"), value = input.value.trim();
      if (!value) { input.setCustomValidity(t("creatorPasswordRequired")); input.reportValidity(); input.addEventListener("input", () => input.setCustomValidity(""), { once: true }); return; }
      finish(value);
    });
    document.body.append(dialog); dialog.showModal();
  });
}
