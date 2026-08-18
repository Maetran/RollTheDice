let ws = null;
let chatBox, chatInput, chatSend;
let chatPanel, chatToggle, chatClose, chatBackdrop, chatToggleCount;
let unreadCount = 0;

let meName = "Ich";

export function initChat(websocket, opts = {}) {
  ws = websocket;
  if (opts.meName) meName = String(opts.meName);

  chatBox   = document.getElementById("chatBox");
  chatInput = document.getElementById("chatInput");
  chatSend  = document.getElementById("chatSend");
  chatPanel = document.getElementById("chatPanel");
  chatToggle = document.getElementById("chatToggle");
  chatClose = document.getElementById("chatClose");
  chatBackdrop = document.getElementById("chatBackdrop");
  chatToggleCount = document.getElementById("chatToggleCount");

  if (chatSend && !chatSend._bound) {
    chatSend._bound = true;
    chatSend.addEventListener("click", sendMessage);
  }
  if (chatInput && !chatInput._bound) {
    chatInput._bound = true;
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });
	  }
	  bindChatSheet();
	  setChatOpen(shouldDefaultOpenChat(), { focus: false });
	}

function shouldDefaultOpenChat() {
  return false;
	}

function sendMessage() {
  if (!chatInput) chatInput = document.getElementById("chatInput");
  const txt = (chatInput?.value || "").trim();
  if (!txt) return;

  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "chat_message", text: txt }));
    }
  } catch {}

  if (chatInput) chatInput.value = "";
}

export function addChatMessage(sender, text, opts = {}) {
  if (!chatBox) chatBox = document.getElementById("chatBox");
  if (!chatBox) return;

  const ts = opts.ts ? new Date(opts.ts) : new Date();
  const safeTs = Number.isNaN(ts.getTime()) ? new Date() : ts;
  const hh = String(safeTs.getHours()).padStart(2, "0");
  const mm = String(safeTs.getMinutes()).padStart(2, "0");
  const ss = String(safeTs.getSeconds()).padStart(2, "0");
  const stamp = `${hh}:${mm}:${ss}`;

  const line = document.createElement("div");
  line.className = `chat-line${opts.kind === "reaction" ? " reaction" : ""}${opts.kind === "system" ? " system" : ""}`;
  const body = opts.kind === "reaction"
    ? `<b>${escapeHtml(sender)}</b> ${escapeHtml(text)}`
    : `<b>${escapeHtml(sender)}:</b> ${escapeHtml(text)}`;
  line.innerHTML = `<span class="ts">[${stamp}]</span>${body}`;

  chatBox.prepend(line);
  chatBox.scrollTop = 0;
  if (!isChatOpen()) {
    unreadCount += 1;
    renderUnreadCount();
  }
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function bindChatSheet() {
  if (chatToggle && !chatToggle._bound) {
    chatToggle._bound = true;
    chatToggle.addEventListener("click", () => setChatOpen(!isChatOpen(), { focus: true }));
  }
  if (chatClose && !chatClose._bound) {
    chatClose._bound = true;
    chatClose.addEventListener("click", () => setChatOpen(false, { focus: false }));
  }
  if (chatBackdrop && !chatBackdrop._bound) {
    chatBackdrop._bound = true;
    chatBackdrop.addEventListener("click", () => setChatOpen(false, { focus: false }));
  }
  if (!window.__rt_chatEscapeBound) {
    window.__rt_chatEscapeBound = true;
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isChatOpen()) setChatOpen(false, { focus: false });
    });
  }
}

function isChatOpen() {
  if (!chatPanel) chatPanel = document.getElementById("chatPanel");
  return !!(chatPanel && chatPanel.classList.contains("open"));
}

function setChatOpen(open, opts = {}) {
  if (!chatPanel) chatPanel = document.getElementById("chatPanel");
  if (!chatToggle) chatToggle = document.getElementById("chatToggle");
  if (!chatBackdrop) chatBackdrop = document.getElementById("chatBackdrop");
  if (!chatPanel) return;

  chatPanel.classList.toggle("open", !!open);
  document.documentElement.classList.toggle("chat-open", !!open);
  document.body.classList.toggle("chat-open", !!open);
  if (chatToggle) chatToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (chatBackdrop) chatBackdrop.hidden = !open;
  if (open) {
    unreadCount = 0;
    renderUnreadCount();
    if (opts.focus && chatInput) {
      setTimeout(() => chatInput.focus({ preventScroll: true }), 220);
    }
  }
}

function renderUnreadCount() {
  if (!chatToggleCount) chatToggleCount = document.getElementById("chatToggleCount");
  if (!chatToggleCount) return;
  chatToggleCount.textContent = String(Math.min(unreadCount, 99));
  chatToggleCount.hidden = unreadCount <= 0;
}
