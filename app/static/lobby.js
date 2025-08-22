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
  const res = await fetch("/api/games");   // FIX
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
      const qs = new URLSearchParams({ game_id: gid, name }).toString();
      location.href = `room.html?${qs}`;   // FIX: mit Querystring
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
    const res = await fetch(`/api/games`, {   // FIX
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: gname, mode, owner: name })
    });
    if (!res.ok) {
      msg.textContent = "Fehler: " + (await res.text());
      return;
    }
    const data = await res.json();
    const gid = data.game_id || data.id;
    msg.textContent = "Weiterleitung…";
    const qs = new URLSearchParams({ game_id: gid, name }).toString();
    location.href = `room.html?${qs}`;   // FIX: mit Querystring
  } catch (e) {
    msg.textContent = "Netzwerkfehler: " + e.message;
  }
});

// initial
listGames();
// sanftes Polling
setInterval(listGames, 3000);