let ws = null;
let chatBox, chatInput, chatSend;

let meName = "Ich";

export function initChat(websocket, opts = {}) {
  ws = websocket;
  if (opts.meName) meName = String(opts.meName);

  chatBox   = document.getElementById("chatBox");
  chatInput = document.getElementById("chatInput");
  chatSend  = document.getElementById("chatSend");

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
  line.className = `chat-line${opts.kind === "reaction" ? " reaction" : ""}`;
  const body = opts.kind === "reaction"
    ? `<b>${escapeHtml(sender)}</b> ${escapeHtml(text)}`
    : `<b>${escapeHtml(sender)}:</b> ${escapeHtml(text)}`;
  line.innerHTML = `<span class="ts">[${stamp}]</span>${body}`;

  chatBox.prepend(line);
  chatBox.scrollTop = 0;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}
