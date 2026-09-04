/**
 * Baut aus einem Leaderboard-Eintrag einen Client-Snapshot zur Anzeige.
 * @param {Object} lv
 * @returns {Object|null}
 */
function buildClientSnapshotFromLeaderboard(lv){
  if (!lv || typeof lv !== "object") return null;

  const mode = (lv.mode || "").toString().toLowerCase();
  const isTeam = mode === "2v2";

  const rowIndexForKey = (key) => {
    for (let i = 0; i < ROW_FIELD_KEYS.length; i++){
      if (ROW_FIELD_KEYS[i] === key) return i;
    }
    return null;
  };

  const fromReihen = (reihenArr) => {
    const sc = {};
    const idxToCol = {1:"down", 2:"free", 3:"up", 4:"ang"};
    (reihenArr || []).forEach(r => {
      const col = idxToCol[r.index] || null;
      if (!col) return;
      const rows = r.rows || {};
      Object.keys(rows).forEach(fk => {
        const ri = rowIndexForKey(fk);
        if (ri === null || ri === undefined) return;
        const v = rows[fk];
        if (typeof v === "number" && Number.isFinite(v)){
          sc[`${ri},${col}`] = v;
        }
      });
    });
    return sc;
  };

  if (isTeam){
    const teams = [{"id":"A","name":"Team A","members":[]},{"id":"B","name":"Team B","members":[]}];
    (lv.players || []).forEach(p => {
      const t = (p && p.team) ? String(p.team) : null;
      if (t === "A" || t === "B"){
        const tgt = teams.find(tt => tt.id === t);
        if (tgt && p.id) tgt.members.push(String(p.id));
      }
    });

    const sbByTeam = {};
    Object.keys(lv.scoreboards || {}).forEach(entId => {
      const entry = lv.scoreboards[entId] || {};
      sbByTeam[String(entId)] = fromReihen(entry.reihen || []);
    });

    return {
      _name: lv.gamename || "",
      _mode: "2v2",
      _hardcore: !!lv.hardcore,
      _players: (lv.players || []).map(p => ({
        id:String(p.id),
        name:String(p.name||"Player"),
        user_id:p.user_id ?? null,
        achievement_rank:p.achievement_rank || null,
      })),
      _teams: teams,
      _scoreboards_by_team: sbByTeam,
      _scoreboards: {},
      _admin_edits: lv.admin_edits || {},
      _turn: null,
      _dice: [0,0,0,0,0],
      _holds: [false,false,false,false,false],
      _rolls_used: 0,
      _rolls_max: 0,
      _announced_row4: null,
      _correction: {active:false},
      suggestions: []
    };
  } else {
    const sb = {};
    Object.keys(lv.scoreboards || {}).forEach(pid => {
      const entry = lv.scoreboards[pid] || {};
      sb[String(pid)] = fromReihen(entry.reihen || []);
    });
    return {
      _name: lv.gamename || "",
      _mode: lv.mode,
      _hardcore: !!lv.hardcore,
      _players: (lv.players || []).map(p => ({
        id:String(p.id),
        name:String(p.name||"Player"),
        user_id:p.user_id ?? null,
        achievement_rank:p.achievement_rank || null,
      })),
      _teams: [],
      _scoreboards_by_team: {},
      _scoreboards: sb,
      _admin_edits: lv.admin_edits || {},
      _turn: null,
      _dice: [0,0,0,0,0],
      _holds: [false,false,false,false,false],
      _rolls_used: 0,
      _rolls_max: 0,
      _announced_row4: null,
      _correction: {active:false},
      suggestions: []
    };
  }
}

window.renderReadOnlyFromLeaderboard = function(mount, leaderboardView){
  const sb = buildClientSnapshotFromLeaderboard(leaderboardView);
  if (!sb){
    if (mount) mount.innerHTML = "<div class='muted'>Kein Inhalt</div>";
    return;
  }
  window.renderScoreboard(mount, sb, {
    myPlayerId: null,
    iAmTurn: false,
    rollsUsed: 0,
    rollsMax: 0,
    announcedRow4: null,
    canRequestCorrection: false,
    readOnly: true
  });
  renderReadOnlyAchievements(mount, leaderboardView.players || []);
  renderReadOnlyChatHistory(mount, leaderboardView.chat_history || []);
};

function replayAchievementIcon(iconKey){
  const icons = {
    points: "◆", games: "▦", score: "★", upper: "↑", row: "≡",
    strike: "×", sixty: "6", full: "●", poker: "♠", diff: "Δ",
    kenter: "◇", bonus: "+", office: "◫", night: "☾", weekend: "☀",
    early: "↗", statistics: "⌁", account: "✓"
  };
  return icons[String(iconKey || "")] || "✦";
}

function renderReadOnlyAchievements(mount, players){
  if (!mount || !Array.isArray(players)) return;
  const groups = players.map(player => {
    const seen = new Set();
    const achievements = (Array.isArray(player?.earned_achievements) ? player.earned_achievements : [])
      .filter(achievement => {
        if (!achievement || typeof achievement !== "object") return false;
        const key = String(achievement.key || "").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return { player, achievements };
  }).filter(group => group.achievements.length > 0);
  if (groups.length === 0) return;

  const markup = groups.map(({ player, achievements }) => {
    const cards = achievements.map(achievement => {
      const points = Math.max(0, Math.trunc(Number(achievement.points) || 0));
      return `<li class="readonly-achievement-card">
        <span class="readonly-achievement-icon" aria-hidden="true">${esc(replayAchievementIcon(achievement.icon_key))}</span>
        <span class="readonly-achievement-copy"><strong>${esc(achievement.name || "Erfolg")}</strong>${achievement.description ? `<small>${esc(achievement.description)}</small>` : ""}</span>
        <span class="readonly-achievement-points">+${esc(points)} ${esc(points === 1 ? "Ehrenberg-Marke" : "Ehrenberg-Marken")}</span>
      </li>`;
    }).join("");
    return `<section class="readonly-achievement-player" aria-label="${esc(player?.name || "Spieler")}">
      <h3>${esc(player?.name || "Spieler")}</h3>
      <ul class="readonly-achievement-list">${cards}</ul>
    </section>`;
  }).join("");

  mount.insertAdjacentHTML("beforeend", `
    <section class="readonly-achievements" aria-labelledby="readonlyAchievementsTitle">
      <p class="eyebrow">Partie-Erfolge</p>
      <h2 id="readonlyAchievementsTitle">In dieser Partie erreicht</h2>
      <div class="readonly-achievement-players">${markup}</div>
    </section>
  `);
}

function renderReadOnlyChatHistory(mount, history){
  if (!mount || !Array.isArray(history) || history.length === 0) return;
  const rows = history.slice().reverse().map(m => {
    const ts = m && m.ts ? new Date(m.ts) : null;
    const stamp = ts && !Number.isNaN(ts.getTime())
      ? ts.toLocaleTimeString(window.ZDWA_I18N?.locale?.() || [], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : "";
    const sender = (m && m.sender) ? m.sender : "System";
    const text = (m && m.text) ? m.text : "";
    const kind = (m && m.kind) ? String(m.kind) : "chat";
    return `<div class="readonly-chat-line ${esc(kind)}">
      <span class="ts">${esc(stamp)}</span><b>${playerNameMarkup(m && m.achievement_rank ? { name: sender, achievement_rank: m.achievement_rank } : { name: sender }, { compactRank: true })}:</b> ${esc(text)}
    </div>`;
  }).join("");
  mount.insertAdjacentHTML("beforeend", `
    <section class="readonly-chat">
      <h2>Chatverlauf</h2>
      <div class="readonly-chat-box">${rows}</div>
    </section>
  `);
}
