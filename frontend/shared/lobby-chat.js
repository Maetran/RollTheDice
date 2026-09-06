import { loadAuth } from "./auth.js";
import { avatarSource } from "./avatar.js";
import { playerProfileHref } from "./player-allowlist.js";

const CONTEXTS = new Set(["all", "zdwa", "zilch"]);

function translate(value) {
  return window.ZDWA_I18N?.t?.(value) || value;
}

function chatErrorMessage(code) {
  const messages = {
    authentication_required: "Melde dich an, um den Lobby-Chat zu sehen und mitzuschreiben.",
    lobby_chat_disabled: "Der Lobby-Chat ist in deinen Einstellungen deaktiviert.",
    lobby_chat_muted: "Du bist im Lobby-Chat stummgeschaltet.",
    lobby_chat_excluded: "Du bist vom Lobby-Chat ausgeschlossen.",
    lobby_chat_action_unknown: "Diese Chat-Aktion ist nicht verfügbar.",
    lobby_chat_message_invalid: "Bitte gib eine Nachricht mit höchstens 400 Zeichen ein.",
    lobby_chat_rate_limited: "Bitte warte kurz, bevor du erneut schreibst.",
  };
  return translate(messages[String(code || "")] || "Der Lobby-Chat ist gerade nicht verfügbar.");
}

function gameLabel(gameType) {
  return gameType === "zilch" ? "zilch" : "zdwa";
}

function eventText(message, { withSender = true } = {}) {
  if (message.kind === "presence") {
    return `${withSender ? `${message.sender} ` : ""}${translate("ist jetzt verbunden.")}`;
  }
  return withSender ? `${message.sender} · ${gameLabel(message.game_type)}: ${message.text}` : message.text;
}

function socketUrl(context) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(`${protocol}//${window.location.host}/ws/lobby-chat`);
  url.searchParams.set("context", context === "zilch" ? "zilch" : "zdwa");
  return url.toString();
}

function toastRegion() {
  let region = document.getElementById("lobbyChatToastRegion");
  if (region) return region;
  region = document.createElement("div");
  region.id = "lobbyChatToastRegion";
  region.className = "lobby-chat-toasts";
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "false");
  document.body.append(region);
  return region;
}

function showToast(message) {
  const region = toastRegion();
  const toast = document.createElement("div");
  toast.className = "lobby-chat-toast";
  toast.setAttribute("role", "status");
  toast.textContent = eventText(message);
  region.append(toast);
  while (region.childElementCount > 3) region.firstElementChild?.remove();
  window.setTimeout(() => toast.remove(), 5_000);
}

function messageTimestamp(message) {
  const timestamp = Date.parse(String(message.sent_at || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Mount the shared lobby chat into one game's lobby.
 *
 * The socket and the three-day history are account-only. The server records
 * the eligible account audience for every event, so reconnecting accounts see
 * only events that were addressed to them while their chat was enabled.
 */
export function mountLobbyChat(mount, { context = "zdwa", initialAuth = null } = {}) {
  if (!mount) return { destroy() {} };

  const state = {
    auth: initialAuth,
    destroyed: false,
    expanded: false,
    filter: "all",
    messages: [],
    reconnectAttempt: 0,
    reconnectTimer: null,
    seenMessageIds: new Set(),
    socket: null,
    status: "",
  };

  mount.innerHTML = `
    <section class="lobby-chat" aria-labelledby="lobbyChatTitle">
      <div class="lobby-chat__heading">
        <div><p class="eyebrow">${translate("Gemeinsame Lobby")}</p><h2 id="lobbyChatTitle">${translate("Lobby-Chat")}</h2></div>
        <div class="lobby-chat__filters" role="group" aria-label="${translate("Lobby-Chat filtern")}">
          <button type="button" class="small ghost is-active" data-lobby-chat-filter="all" aria-pressed="true">${translate("Alle")}</button>
          <button type="button" class="small ghost" data-lobby-chat-filter="zilch" aria-pressed="false">${translate("Nur Zilch")}</button>
          <button type="button" class="small ghost" data-lobby-chat-filter="zdwa" aria-pressed="false">${translate("Nur ZDWA")}</button>
        </div>
      </div>
      <p class="lobby-chat__hint">${translate("Dein persönlicher Verlauf bleibt drei Tage sichtbar, wenn dein Lobby-Chat aktiv war.")}</p>
      <div class="lobby-chat__feed" data-lobby-chat-feed>
        <ol class="lobby-chat__messages" data-lobby-chat-messages aria-live="polite"></ol>
      </div>
      <button type="button" class="small ghost lobby-chat__expand" data-lobby-chat-expand aria-expanded="false">${translate("Chat ausklappen")}</button>
      <form class="lobby-chat__composer" data-lobby-chat-form>
        <label class="visually-hidden" for="lobbyChatInput">${translate("Nachricht im Lobby-Chat")}</label>
        <input id="lobbyChatInput" data-lobby-chat-input type="text" maxlength="400" autocomplete="off" placeholder="${translate("Nachricht schreiben …")}">
        <button class="small primary" data-lobby-chat-send type="submit">${translate("Senden")}</button>
      </form>
      <p class="lobby-chat__status" data-lobby-chat-status role="status"></p>
    </section>`;

  const section = mount.querySelector(".lobby-chat");
  const feed = mount.querySelector("[data-lobby-chat-feed]");
  const filters = mount.querySelector(".lobby-chat__filters");
  const list = mount.querySelector("[data-lobby-chat-messages]");
  const form = mount.querySelector("[data-lobby-chat-form]");
  const input = mount.querySelector("[data-lobby-chat-input]");
  const send = mount.querySelector("[data-lobby-chat-send]");
  const status = mount.querySelector("[data-lobby-chat-status]");
  const expand = mount.querySelector("[data-lobby-chat-expand]");

  function authenticated() {
    return Boolean(state.auth?.authenticated && state.auth?.user);
  }

  function chatEnabled() {
    return authenticated()
      && state.auth?.user?.preferences?.lobby_chat_enabled !== false
      && state.auth?.user?.preferences?.lobby_chat_excluded !== true;
  }

  function canWriteChat() {
    return chatEnabled() && state.auth?.user?.preferences?.lobby_chat_muted !== true;
  }

  function resetMessages() {
    state.messages = [];
    state.seenMessageIds.clear();
  }

  function closeSocket() {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
    const socket = state.socket;
    state.socket = null;
    socket?.close();
  }

  function updateComposer() {
    const canUseChat = chatEnabled();
    const canWrite = canWriteChat();
    const isAuthenticated = authenticated();
    section.classList.toggle("is-disabled", !canUseChat);
    section.classList.toggle("is-muted", canUseChat && !canWrite);
    filters.hidden = !canUseChat;
    expand.hidden = !canUseChat;
    form.hidden = !canUseChat;
    input.disabled = !canWrite;
    send.disabled = !canWrite;
    if (!isAuthenticated) {
      input.placeholder = translate("Zum Chat anmelden");
      state.status = translate("Melde dich an, um den Lobby-Chat zu sehen und mitzuschreiben.");
    } else if (state.auth?.user?.preferences?.lobby_chat_excluded === true) {
      input.placeholder = translate("Vom Lobby-Chat ausgeschlossen");
      state.status = translate("Du bist vom Lobby-Chat ausgeschlossen.");
    } else if (!canUseChat) {
      input.placeholder = translate("Lobby-Chat deaktiviert");
      state.status = translate("Der Lobby-Chat ist in deinen Einstellungen deaktiviert.");
    } else if (!canWrite) {
      input.placeholder = translate("Im Lobby-Chat stummgeschaltet");
      state.status = translate("Du bist im Lobby-Chat stummgeschaltet.");
    } else {
      input.placeholder = translate("Nachricht schreiben …");
    }
    status.textContent = state.status;
  }

  function visibleMessages() {
    return state.messages.filter(message => state.filter === "all" || message.game_type === state.filter);
  }

  function emptyStateText() {
    if (!authenticated()) return translate("Melde dich an, um den Lobby-Chat zu sehen und mitzuschreiben.");
    if (state.auth?.user?.preferences?.lobby_chat_excluded === true) {
      return translate("Du bist vom Lobby-Chat ausgeschlossen.");
    }
    if (!chatEnabled()) return translate("Der Lobby-Chat ist in deinen Einstellungen deaktiviert.");
    return translate(
      state.filter === "all"
        ? "Noch keine Nachrichten in deinem Verlauf."
        : "Für diesen Filter sind noch keine Nachrichten in deinem Verlauf da.",
    );
  }

  function renderMessages() {
    const wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
    const messages = chatEnabled() ? visibleMessages() : [];
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("li");
      empty.className = "lobby-chat__empty";
      empty.textContent = emptyStateText();
      list.append(empty);
    } else {
      for (const message of messages) {
        const row = document.createElement("li");
        row.className = `lobby-chat__message${message.kind === "presence" ? " lobby-chat__message--presence" : ""}`;
        row.dataset.gameType = message.game_type;
        const meta = document.createElement("span");
        meta.className = "lobby-chat__sender";
        const hasAccount = Number.isInteger(Number(message.user_id)) && Number(message.user_id) > 0;
        const sender = document.createElement(hasAccount ? "a" : "strong");
        sender.textContent = message.sender;
        if (hasAccount) sender.href = playerProfileHref(message.sender, context);
        if (hasAccount) {
          const avatar = document.createElement("img");
          avatar.className = "player-avatar";
          avatar.src = avatarSource(message.user_id);
          avatar.alt = "";
          avatar.width = avatar.height = 18;
          avatar.loading = "lazy";
          meta.append(avatar);
        }
        const badge = document.createElement("span");
        badge.className = "lobby-chat__game-badge";
        badge.textContent = gameLabel(message.game_type);
        meta.append(sender, badge);
        const text = document.createElement("span");
        text.className = "lobby-chat__text";
        text.textContent = eventText(message, { withSender: false });
        row.append(meta, text);
        list.append(row);
      }
    }
    if (wasAtBottom) feed.scrollTop = feed.scrollHeight;
  }

  function updateFilterButtons() {
    mount.querySelectorAll("[data-lobby-chat-filter]").forEach(button => {
      const active = button.dataset.lobbyChatFilter === state.filter;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function updateExpansion() {
    feed.classList.toggle("is-expanded", state.expanded);
    expand.setAttribute("aria-expanded", String(state.expanded));
    expand.textContent = translate(state.expanded ? "Chat einklappen" : "Chat ausklappen");
  }

  function handleMessage(payload) {
    const message = payload?.lobby_chat;
    if (!message || typeof message !== "object") return false;
    const kind = message.kind;
    if (
      !["message", "presence"].includes(kind)
      || typeof message.id !== "number"
      || typeof message.sender !== "string"
      || !["zdwa", "zilch"].includes(message.game_type)
      || (kind === "message" && typeof message.text !== "string")
    ) return false;
    if (state.seenMessageIds.has(message.id)) return true;
    state.seenMessageIds.add(message.id);
    state.messages.push(message);
    state.messages.sort((left, right) => (
      messageTimestamp(left) - messageTimestamp(right) || Number(left.id) - Number(right.id)
    ));
    renderMessages();
    const ownMessage = Number(message.user_id) === Number(state.auth?.user?.id);
    if (
      payload.lobby_chat_history !== true
      && chatEnabled()
      && state.auth?.user?.preferences?.lobby_chat_popups !== false
      && !ownMessage
    ) showToast(message);
    return true;
  }

  function scheduleReconnect() {
    if (state.destroyed || !chatEnabled() || state.reconnectTimer) return;
    const delay = Math.min(10_000, 750 * 2 ** state.reconnectAttempt);
    state.reconnectAttempt += 1;
    state.reconnectTimer = window.setTimeout(() => {
      state.reconnectTimer = null;
      connect();
    }, delay);
  }

  function connect() {
    if (
      state.destroyed
      || !chatEnabled()
      || state.socket?.readyState === WebSocket.OPEN
      || state.socket?.readyState === WebSocket.CONNECTING
    ) return;
    let socket;
    try {
      socket = new WebSocket(socketUrl(context));
    } catch (_) {
      state.status = translate("Verbindung zum Lobby-Chat wird wiederhergestellt.");
      updateComposer();
      scheduleReconnect();
      return;
    }
    state.socket = socket;
    socket.addEventListener("open", () => {
      if (state.socket !== socket) return;
      state.reconnectAttempt = 0;
      state.status = "";
      updateComposer();
    });
    socket.addEventListener("message", event => {
      let payload;
      try { payload = JSON.parse(event.data); } catch (_) { return; }
      if (handleMessage(payload)) return;
      if (payload?.error) {
        if (payload.error === "lobby_chat_disabled" && state.auth?.user) {
          state.auth.user.preferences = {
            ...(state.auth.user.preferences || {}),
            lobby_chat_enabled: false,
          };
          resetMessages();
          closeSocket();
        }
        if (payload.error === "lobby_chat_excluded" && state.auth?.user) {
          state.auth.user.preferences = {
            ...(state.auth.user.preferences || {}),
            lobby_chat_excluded: true,
          };
          resetMessages();
          closeSocket();
        }
        if (payload.error === "lobby_chat_muted" && state.auth?.user) {
          state.auth.user.preferences = {
            ...(state.auth.user.preferences || {}),
            lobby_chat_muted: true,
          };
        }
        state.status = chatErrorMessage(payload.error);
        updateComposer();
        renderMessages();
      }
    });
    socket.addEventListener("close", () => {
      if (state.socket !== socket || state.destroyed) return;
      state.socket = null;
      state.status = translate("Verbindung zum Lobby-Chat wird wiederhergestellt.");
      updateComposer();
      scheduleReconnect();
    });
  }

  const onAuthState = event => {
    const wasEnabled = chatEnabled();
    const previousUserId = state.auth?.user?.id;
    state.auth = event.detail || { authenticated: false, user: null };
    const nowEnabled = chatEnabled();
    const userChanged = Number(previousUserId) !== Number(state.auth?.user?.id);
    if (!nowEnabled) {
      closeSocket();
      resetMessages();
    } else if (!wasEnabled || userChanged) {
      resetMessages();
      closeSocket();
      state.status = "";
      connect();
    }
    updateComposer();
    renderMessages();
  };
  const onOnline = () => {
    if (!state.socket || state.socket.readyState === WebSocket.CLOSED) connect();
  };

  mount.querySelectorAll("[data-lobby-chat-filter]").forEach(button => {
    button.addEventListener("click", () => {
      const selected = button.dataset.lobbyChatFilter;
      if (!CONTEXTS.has(selected)) return;
      state.filter = selected;
      updateFilterButtons();
      renderMessages();
    });
  });
  expand.addEventListener("click", () => {
    state.expanded = !state.expanded;
    updateExpansion();
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!chatEnabled()) {
      state.status = authenticated()
        ? translate(
          state.auth?.user?.preferences?.lobby_chat_excluded === true
            ? "Du bist vom Lobby-Chat ausgeschlossen."
            : "Der Lobby-Chat ist in deinen Einstellungen deaktiviert.",
        )
        : translate("Melde dich an, um den Lobby-Chat zu sehen und mitzuschreiben.");
      updateComposer();
      return;
    }
    if (!canWriteChat()) {
      state.status = translate("Du bist im Lobby-Chat stummgeschaltet.");
      updateComposer();
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    if (state.socket?.readyState !== WebSocket.OPEN) {
      state.status = translate("Verbindung zum Lobby-Chat wird wiederhergestellt.");
      updateComposer();
      return;
    }
    state.socket.send(JSON.stringify({ action: "lobby_chat_message", text }));
    input.value = "";
    state.status = "";
    updateComposer();
  });

  window.addEventListener("zdwa:auth-state", onAuthState);
  window.addEventListener("online", onOnline);
  updateComposer();
  updateFilterButtons();
  updateExpansion();
  renderMessages();
  void loadAuth().then(auth => {
    if (!state.destroyed) onAuthState({ detail: auth });
  }).catch(() => {});
  connect();

  return {
    destroy() {
      state.destroyed = true;
      closeSocket();
      window.removeEventListener("zdwa:auth-state", onAuthState);
      window.removeEventListener("online", onOnline);
      mount.replaceChildren();
    },
  };
}
