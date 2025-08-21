// static/lobby.js
const $ = s => document.querySelector(s);

function modeLabel(m) {
  if (m === "2") return "2 Spieler";
  if (m === "3") return "3 Spieler";
  if (m === "2v2") return "2 + 2 (Teams)";
  return m;
}

function gameCard(g) {
  const full = g.players >= g.expected;
  const started = g.started;
  const canJoin = !started && !full;
  return `
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0;">${g.name || "Spiel"}</h4>
        <span class="badge">${modeLabel(g.mode)}</span>
      </div>
      <div class="muted" style="margin:.35rem 0;">
        Spieler: <b>${g.players}/${g.expected}</b> • Status: <b>${started ? "läuft" : (full ? "voll" : "wartet")}</b><br>
        ID: <code>${g.game_id}</code>
      </div>
      <div class="row">
        <button data-join="${g.game_id}" ${canJoin ? "" : "disabled"}>Beitreten</button>
      </div>
    </div>
  `;
}

async function listGames() {
  const res = await fetch("/games");
  if (!res.ok) return;
  const data = await res.json();
  const grid = $("#gamesGrid");
  grid.innerHTML = "";
  (data.games || []).forEach(g => grid.insertAdjacentHTML("beforeend", gameCard(g)));

  // join handler
  grid.querySelectorAll("button[data-join]").forEach(btn => {
    btn.addEventListener("click", () => {
      const gid = btn.getAttribute("data-join");
      const name = ($("#playerName").value || "").trim() || "Gast";
      // Wechsel in den Spielraum – WS macht den eigentlichen Join
      location.href = `/static/room.html?game_id=${encodeURIComponent(gid)}&name=${encodeURIComponent(name)}`;
    });
  });
}

$("#refreshBtn").addEventListener("click", listGames);

$("#createBtn").addEventListener("click", async () => {
  const msg = $("#msgCreate");
  const name = ($("#playerName").value || "").trim() || "Gast";
  const gname = ($("#gameName").value || "").trim();
  const mode = $("#gameMode").value || "2";
  msg.textContent = "Spiel wird erstellt…";
  try {
    const res = await fetch(`/create_game?mode=${encodeURIComponent(mode)}&name=${encodeURIComponent(gname)}`, { method: "POST" });
    if (!res.ok) {
      msg.textContent = "Fehler: " + (await res.text());
      return;
    }
    const data = await res.json();
    const gid = data.game_id;
    msg.textContent = "Weiterleitung…";
    location.href = `/static/room.html?game_id=${encodeURIComponent(gid)}&name=${encodeURIComponent(name)}`;
  } catch (e) {
    msg.textContent = "Netzwerkfehler: " + e.message;
  }
});

// initial
listGames();
// sanftes Polling
setInterval(listGames, 3000);