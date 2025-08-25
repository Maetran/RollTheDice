// static/chat.js
let ws = null;
let chatBox, chatInput, chatSend;

// optional: eigener Name (nur für spätere Features, NICHT zum Echo)
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

  // Nur zum Server schicken – KEIN lokales Echo
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: "chat_message", text: txt }));
    }
  } catch {}

  // Eingabefeld leeren
  if (chatInput) chatInput.value = "";
}

export function addChatMessage(sender, text) {
  if (!chatBox) chatBox = document.getElementById("chatBox");
  if (!chatBox) return;

  const ts = new Date();
  const hh = String(ts.getHours()).padStart(2, "0");
  const mm = String(ts.getMinutes()).padStart(2, "0");
  const ss = String(ts.getSeconds()).padStart(2, "0");
  const stamp = `${hh}:${mm}:${ss}`;

  const line = document.createElement("div");
  line.className = "chat-line";
  line.innerHTML =
    `<span style="color:#666; font-size:0.8em; margin-right:4px;">[${stamp}]</span>` +
    `<b>${escapeHtml(sender)}:</b> ${escapeHtml(text)}`;

  // Neueste zuerst
  chatBox.prepend(line);
  chatBox.scrollTop = 0;
}

// einfache Escapes
function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"
  }[c]));
}