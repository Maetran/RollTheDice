// chat.js
// Einfaches Chat-Modul für room.html

let ws = null; // wird von room.js gesetzt
let chatBox, chatInput, chatSend;

export function initChat(websocket) {
  ws = websocket;
  chatBox = document.getElementById("chatBox");
  chatInput = document.getElementById("chatInput");
  chatSend = document.getElementById("chatSend");

  chatSend.addEventListener("click", sendMessage);
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      sendMessage();
    }
  });
}

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({ action: "chat_message", text }));
  chatInput.value = "";
}

// Nachricht im Chat anzeigen
export function addChatMessage(sender, text) {
  const msg = document.createElement("div");
  msg.className = "chat-line";
  msg.textContent = `${sender}: ${text}`;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
}