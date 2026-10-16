import { escapeHtml as esc } from "../shared/auth.js";
import { requestGameInvitePush, webPushErrorMessage } from "../shared/web-push.js";

export function invitationMarkup({ id, name, canCall = false, retrySeconds = 0, waiting = false }, t) {
  const url = `${location.origin}/hausdepp/spiel/${encodeURIComponent(id)}`;
  const until = Date.now() + Math.max(0, Number(retrySeconds) || 0) * 1000;
  return `<div class="hd-invitation" data-invite-game="${esc(id)}" data-invite-name="${esc(name)}" data-invite-until="${until}" data-invite-can-call="${canCall ? "1" : "0"}"><div class="hd-invitation-actions"><button type="button" data-invite-action="share">${t("shareTable")}</button><button ${waiting ? 'id="hausdeppCopyTable"' : ""} type="button" data-invite-action="copy">${t("copyTable")}</button><button type="button" data-invite-action="call" ${canCall ? "" : "hidden"} ${retrySeconds > 0 ? "disabled" : ""}>${t("callPlayers")}</button></div><p data-invite-status role="status"></p><p class="hd-invite-cooldown" data-invite-cooldown></p><label data-invite-fallback hidden>${t("copyTable")}<input type="text" readonly value="${esc(url)}"></label></div>`;
}

export function mountInvitations(root, t) {
  const cooldowns = new Map();
  const pending = new Set();
  let stopped = false;
  const status = (container, message, error = false) => {
    const output = container.querySelector("[data-invite-status]");
    if (output) { output.textContent = message; output.classList.toggle("is-error", error); }
  };
  const tick = () => {
    for (const container of root.querySelectorAll("[data-invite-game]")) {
      const button = container.querySelector('[data-invite-action="call"]');
      const id = container.dataset.inviteGame;
      const allowed = container.dataset.inviteCanCall === "1";
      const until = Math.max(Number(container.dataset.inviteUntil) || 0, cooldowns.get(id) || 0);
      const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      button.hidden = !allowed;
      button.disabled = pending.has(id) || seconds > 0;
      container.querySelector("[data-invite-cooldown]").textContent = allowed && seconds
        ? t("inviteRetry", { seconds }) : "";
    }
  };

  async function copy(container, url) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard_unavailable");
      await navigator.clipboard.writeText(url);
      container.querySelector("[data-invite-fallback]").hidden = true;
      status(container, t("tableCopied"));
    } catch {
      container.querySelector("[data-invite-fallback]").hidden = false;
      const input = container.querySelector("[data-invite-fallback] input");
      input.focus(); input.select();
      status(container, t("tableCopyFailed"), true);
    }
  }

  const click = async event => {
    const button = event.target.closest("[data-invite-action]");
    const container = button?.closest("[data-invite-game]");
    if (!container || !root.contains(container) || button.disabled) return;
    const id = container.dataset.inviteGame;
    const action = button.dataset.inviteAction;
    const url = `${location.origin}/hausdepp/spiel/${encodeURIComponent(id)}`;
    if (action === "call") {
      if (container.dataset.inviteCanCall !== "1" || pending.has(id)) return;
      if (Math.max(Number(container.dataset.inviteUntil) || 0, cooldowns.get(id) || 0) > Date.now()) { tick(); return; }
      pending.add(id); button.setAttribute("aria-busy", "true"); tick();
      try {
        const result = await requestGameInvitePush(id);
        const retry = Math.max(0, Number(result.retry_after_seconds) || 0);
        cooldowns.set(id, Date.now() + retry * 1000);
        status(container, t(result.notified ? "inviteNotified" : "inviteNobody"));
      } catch (error) {
        if (error.retryAfterSeconds > 0) cooldowns.set(id, Date.now() + error.retryAfterSeconds * 1000);
        status(container, webPushErrorMessage(error), true);
      } finally {
        pending.delete(id); button.removeAttribute("aria-busy");
        if (!stopped) tick();
      }
      return;
    }
    button.disabled = true;
    try {
      if (action === "share" && navigator.share) {
        try {
          await navigator.share({ title: "Hausdepp", text: t("shareInvitation", { name: container.dataset.inviteName }), url });
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
          // An unavailable native share sheet still has a useful copy path.
        }
      }
      await copy(container, url);
    } finally { button.disabled = false; }
  };
  root.addEventListener("click", click);
  const interval = setInterval(tick, 1000);
  tick();
  return { sync: tick, destroy: () => { stopped = true; root.removeEventListener("click", click); clearInterval(interval); } };
}
