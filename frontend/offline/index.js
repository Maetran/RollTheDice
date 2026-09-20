import "../i18n/index.js";
import "../shell/theme.js";
import "../shell/ui.js";
import * as zdwa from "./zdwa-engine.js";
import * as zilch from "./zilch-engine.js";
import { prepareOfflinePackage } from "./cache.js";

// This entry intentionally imports no account, engagement, socket or result
// client. A local result has no transport to the online game servers.
const product = document.documentElement.dataset.game === "zilch" ? "zilch" : "zdwa";
const engine = product === "zilch" ? zilch : zdwa;
const storageKey = `rollthedice:offline:v1:${product}`;
const main = document.querySelector("#practiceMain");
const statusLine = document.querySelector("#practiceStatus");
const t = value => window.ZDWA_I18N.t(value);
const message = (key, params) => window.ZDWA_I18N.message(key, params);
const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const label = value => esc(t(value));
const pips = ["·", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const fields = { "1":"1", "2":"2", "3":"3", "4":"4", "5":"5", "6":"6", max:"Max", min:"Min", kenter:"Kenter", full:"Full", poker:"Poker", "60":"60" };
let active = false;
let session = null;
let records = [];
let cpuTimer = null;
let cached = false;
let actionPending = false;

function load() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (value.schema !== 1 || value.product !== product) throw new Error("schema");
    records = Array.isArray(value.records) ? value.records.filter(record => (
      record && typeof record.id === "string" && ["solo", "cpu"].includes(record.mode)
      && Number.isFinite(record.points) && Number.isInteger(record.turns)
      && typeof record.date === "string" && Number.isFinite(Date.parse(record.date))
    )).slice(0, 30) : [];
    if (value.session && typeof value.session.id === "string" && engine.validateSavedGame(value.session.data)) session = value.session;
  } catch (_) {
    statusLine.textContent = t("Der lokale Spielstand ist nicht mehr lesbar. Du kannst ein neues Offline-Spiel starten.");
  }
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ schema:1, product, session, records }));
  } catch (_) {
    statusLine.textContent = t("Der Browser kann nicht speichern. Dieses Spiel bleibt nur bis zum Schließen geöffnet.");
  }
}

function privateRecords() {
  const groups = (product === "zilch" ? ["solo", "cpu"] : ["solo"]).map(mode => {
    const sorted = records.filter(record => record.mode === mode).sort((a, b) => product === "zdwa" ? b.points - a.points
      : mode === "cpu" ? Number(b.won) - Number(a.won) || b.points - a.points || a.turns - b.turns
        : a.turns - b.turns || b.points - a.points);
    if (!sorted.length) return "";
    return `<h3>${label(mode === "cpu" ? "Gegen den Würfelwirt" : "Solo")}</h3><ol>${sorted.slice(0, 5).map(record => `<li>${esc(record.points)} ${label("Punkte")} · ${esc(record.turns)} ${label("Züge")}${mode === "cpu" && record.won ? ` · ${label("Du hast gewonnen")}` : ""} · ${esc(new Date(record.date).toLocaleDateString(document.documentElement.lang))}</li>`).join("")}</ol>`;
  }).join("");
  return `<section class="practice-records"><h2>${label("Deine Offline-Bestwerte")}</h2><p>${label("Nur in diesem Browser. Kein Upload, keine Erfolge und keine Online-Statistik. Gelöschte Browserdaten entfernen auch diese Spiele.")}</p>${groups || `<p>${label("Noch keine abgeschlossenen Offline-Spiele.")}</p>`}${records.length ? `<button type="button" class="ghost" data-action="clear">${label("Offline-Bestwerte löschen")}</button>` : ""}</section>`;
}

function renderWelcome() {
  clearTimeout(cpuTimer);
  active = false;
  main.innerHTML = `<section class="practice-welcome"><h1>${label("Einfach für dich würfeln")}</h1><p>${label("Spiele ohne Verbindung. Deine Ergebnisse bleiben auf diesem Gerät und zählen nicht für Erfolge oder Ranglisten.")}</p>${product === "zilch" ? `<label>${label("Spielart")}<select id="practiceMode"><option value="solo">${label("Solo")}</option><option value="cpu">${label("Gegen den Würfelwirt")}</option></select></label>` : `<p>${label("ZDWA · Solo · Normal")}</p>`}<div class="practice-start-actions">${session && !session.data.finished ? `<button type="button" class="primary" data-action="resume">${label("Offline-Spiel fortsetzen")}</button>` : ""}<button type="button" class="${session && !session.data.finished ? "secondary" : "primary"}" data-action="start">${label("Offline-Spiel starten")}</button></div><p id="practiceCacheState">${label(cached ? "Für den nächsten Start ohne Internet bereit." : "Offline-Dateien werden vorbereitet. Lass diese Seite einmal mit Internet geöffnet.")}</p>${privateRecords()}</section>`;
}

async function enter(resume) {
  if (actionPending) return;
  actionPending = true;
  const mode = document.querySelector("#practiceMode")?.value === "cpu" ? "cpu" : "solo";
  try {
    const overwrite = !resume && session && !session.data.finished;
    const confirmed = await window.ZDWA_UI.confirm({
      title:"Offline-Modus aktivieren?",
      message:t("Dieses Spiel bleibt nur auf diesem Gerät. Es gibt keine Erfolge, keine Ranglistenwertung und keine Übertragung an dein Online-Konto.") + (overwrite ? ` ${t("Dein bisheriges Offline-Spiel wird ersetzt.")}` : ""),
      confirmLabel:"Offline spielen", cancelLabel:"Abbrechen",
    });
    if (!confirmed) return;
    if (!resume || !session) {
      session = { id:crypto.randomUUID(), startedAt:new Date().toISOString(), data:product === "zilch" ? zilch.createGame({ mode }) : zdwa.createGame() };
      if (product === "zdwa") zdwa.roll(session.data);
    }
    active = true;
    save();
    renderGame();
  } finally { actionPending = false; }
}

function finishIfNeeded() {
  const game = session.data;
  if (!game.finished || session.recorded) return;
  if (records.some(record => record.id === session.id)) { session.recorded = true; return; }
  const player = product === "zilch" ? game.players.find(item => item.id === "you") : null;
  records.push({ id:session.id, mode:game.mode || "solo", date:new Date().toISOString(),
    points:product === "zilch" ? player.totalPoints : zdwa.totals(game).overall,
    turns:product === "zilch" ? player.rounds.length : 48,
    won:product === "zilch" ? game.winnerIds.length === 1 && game.winnerIds[0] === "you" : true });
  records = records.slice(-30);
  session.recorded = true;
}

function diceMarkup(dice, holds = [], interactive = false) {
  return `<div class="practice-dice">${dice.map((die, index) => `<button type="button" class="practice-die" data-action="hold" data-index="${index}" aria-pressed="${Boolean(holds[index])}" aria-label="${label(interactive ? `Würfel ${index + 1} halten oder lösen` : `Würfel ${index + 1}`)}: ${die}" ${interactive ? "" : "disabled"}>${pips[die] || "·"}</button>`).join("")}</div>`;
}

function zdwaSheet(game) {
  const allowed = new Map(zdwa.allowedCells(game).map(cell => [`${cell.row},${cell.col}`, cell]));
  const totals = zdwa.totals(game);
  const sums = { 6:["S","sum_top"], 7:["B","bonus_top"], 8:["ZTO","total_top"], 11:["D","sum_maxmin"], 16:["ZTU","sum_bottom"], 17:["T","total_column"] };
  const rows = Array.from({ length:18 }, (_, row) => {
    if (sums[row]) return `<tr class="practice-compute"><th scope="row">${sums[row][0]}</th>${zdwa.COLS.map(col => `<td>${totals.columns[col][sums[row][1]]}</td>`).join("")}</tr>`;
    const field = zdwa.FIELD_BY_ROW[row];
    return `<tr><th scope="row">${label(fields[field])}</th>${zdwa.COLS.map(col => {
      const key = `${row},${col}`, open = !Object.hasOwn(game.board, key), cell = allowed.get(key);
      return `<td><button type="button" data-action="write" data-row="${row}" data-col="${col}" data-open="${open}" aria-label="${label(fields[field])} · ${label({ down:"Abwärts", free:"Freireihe", up:"Aufwärts", ang:"Angesagt" }[col])}${cell ? ` · ${cell.points} ${label("Punkte")}` : ""}" ${cell ? "" : "disabled"}>${open ? cell ? cell.points : "·" : game.board[key]}</button></td>`;
    }).join("")}</tr>`;
  }).join("");
  return `<table class="practice-sheet"><thead><tr><th scope="col">${label("Feld")}</th><th scope="col">↓</th><th scope="col">／</th><th scope="col">↑</th><th scope="col">❗</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderZdwa(game) {
  const totals = zdwa.totals(game);
  const announceEnabled = game.rollsUsed === 1 && !game.finished && totals.remaining > 1;
  const announcement = game.announced ? `${t("Ansage")}: ${fields[game.announced]}` : t(zdwa.announcementRequired(game) ? "Bitte zuerst ein ❗-Feld ansagen, bevor weiter gewürfelt wird" : "Keine Ansage aktiv");
  return `<div class="practice-workspace"><section class="practice-board"><h1>${label("Dein Spielzettel")} · ${totals.overall} ${label("Punkte")} · ${totals.filled}/48</h1>${zdwaSheet(game)}</section><aside class="practice-info"><h2>${label("Deine vier Spalten")}</h2><p>↓ ${label("Von 1 bis 60")}</p><p>／ ${label("Freie Reihenfolge")}</p><p>↑ ${label("Von 60 bis 1")}</p><p>❗ ${label("Nach dem ersten Wurf wählen")}</p><p>${label("Die hellen Felder zeigen, wo du jetzt schreiben kannst. Null Punkte bestätigst du vor dem Eintragen.")}</p><p>${label("Offline · Nur auf diesem Gerät")}</p></aside><section class="practice-controls">${diceMarkup(game.dice, game.holds, game.rollsUsed > 0 && game.rollsUsed < game.rollsMax)}<div class="practice-action-row"><button type="button" class="secondary" data-action="announce" ${announceEnabled ? "" : "disabled"}>${label("Ansagen")}</button><span>${label("Würfe:")} ${game.rollsUsed}/${game.rollsMax}</span><button type="button" class="primary" data-action="roll" ${zdwa.canRoll(game) ? "" : "disabled"}>${label("Würfeln")}</button></div><div class="practice-action-row"><span>${esc(announcement)}</span><button type="button" class="ghost" data-action="pause">${label("Pause")}</button></div></section></div>`;
}

function zilchEvent(game) {
  const event = game.lastEvent;
  if (event?.penalty) return t("Dritter Zilch in Folge: 500 Punkte Abzug, höchstens bis auf null.");
  if (!event) return t("Sammle Punkte und sichere sie ab 400. Ziel: 10’000 Punkte.");
  if (event.type === "zilch" || event.type === "zilch_recorded") return t("Zilch! Die Punkte dieses Zugs sind verloren.");
  if (game.turn.phase === "confirmation_roll_required") return t("Bestätigungswurf nötig: mindestens 50 Punkte mit den übrigen Würfeln.");
  return t("Sammle Punkte und sichere sie ab 400. Ziel: 10’000 Punkte.");
}

function zilchPreview(game) {
  if (!session.selection) return game;
  const preview = structuredClone(game);
  try { zilch.selectHold(preview, session.selection); return preview; }
  catch (_) { session.selection = null; return game; }
}

function renderZilch(game) {
  const preview = zilchPreview(game);
  const state = zilch.status(preview), turn = game.turn;
  const displayedDice = turn.rolls_used === 0 && Array.isArray(game.lastEvent?.dice)
    && game.lastEvent.dice.length === 6 ? game.lastEvent.dice : turn.dice;
  const ownTurn = state.activePlayer?.id === "you" || state.activePlayer === "you";
  const seenChoices = new Set();
  const choices = zilch.options(game).filter(option => {
    const key = option.dice_values.slice().sort().join('') + ':' + option.points + ':' + option.combination_type + ':' + option.confirmation_reasons.join(',');
    if (seenChoices.has(key)) return false;
    seenChoices.add(key); return true;
  });
  const history = game.players.flatMap(player => player.rounds.slice(-5).map(round => ({ player, round }))).sort((a, b) => a.round.turn_id - b.round.turn_id).slice(-8);
  return `<div class="practice-workspace"><section class="practice-board"><h1>${label(ownTurn ? "Du bist am Zug" : "Der Würfelwirt ist am Zug")}</h1>${game.players.map(player => `<div class="practice-score-row" data-active="${player.id === turn.player_id}"><span>${label(player.id === "you" ? "Du" : "Würfelwirt")}</span><strong>${player.totalPoints}</strong></div>`).join("")}<p class="practice-event">${esc(zilchEvent(game))}</p><h2>${label("Punkte in diesem Zug")}: ${preview.turn.round_points}</h2><p class="practice-choice-hint">${label("Wähle eine Wertung. Erst Würfeln oder Sichern übernimmt deine Auswahl.")}</p><div class="practice-holds">${ownTurn ? choices.map(option => `<button type="button" class="secondary" aria-pressed="${session.selection === option.id}" data-action="select" data-option="${esc(option.id)}"><strong>${option.points} ${label("Punkte")}</strong><small>${option.dice_indices.map(index => pips[turn.dice[index]]).join(" ")}</small><small>${esc(message(option.label_key, { ...option.label_params, points:option.points }))}</small>${option.requires_confirmation ? `<small>${label("Bestätigungswurf nötig")}</small>` : ""}</button>`).join("") : `<p>${label("Der Würfelwirt überlegt …")}</p>`}</div>${game.finalRound ? `<p>${label("Letzte Runde")}</p>` : ""}</section><aside class="practice-info"><h2>${label("Nur zum Spaß")}</h2><p>${label("Sammle Punkte und sichere sie ab 400. Ziel: 10’000 Punkte.")}</p><p>${label("Drei Zilchs in Folge kosten 500 Punkte. Nach drei Einsen oder Hot Dice ist ein Bestätigungswurf nötig.")}</p><h2>${label("Letzte Züge")}</h2><ol class="practice-score-history">${history.map(({ player, round }) => `<li>${label(player.id === "you" ? "Du" : "Würfelwirt")}: ${esc(round.points ?? round.banked_points ?? round.delta ?? 0)}</li>`).join("")}</ol></aside><section class="practice-controls">${diceMarkup(displayedDice, turn.dice.map((_, index) => turn.held_indices.includes(index) || (session.selection && choices.find(option => option.id === session.selection)?.dice_indices.includes(index))))}<div class="practice-action-row"><button type="button" class="secondary" data-action="bank" ${ownTurn && state.canBank ? "" : "disabled"}>${label("Punkte sichern")}</button><span>${label("Würfe:")} ${turn.rolls_used}</span><button type="button" class="primary" data-action="roll" ${ownTurn && state.canRoll ? "" : "disabled"}>${label("Würfeln")}</button></div><div class="practice-action-row"><span>${label("Offline · Nur auf diesem Gerät")}</span><button type="button" class="ghost" data-action="pause">${label("Pause")}</button></div></section></div>`;
}

function renderGame() {
  if (!active || !session) return;
  clearTimeout(cpuTimer);
  finishIfNeeded();
  save();
  const game = session.data;
  if (game.finished) {
    const points = product === "zdwa" ? zdwa.totals(game).overall : game.players.find(player => player.id === "you").totalPoints;
    main.innerHTML = `<section class="practice-welcome practice-end"><h1>${label("Offline-Spiel beendet")}</h1><p><strong>${points} ${label("Punkte")}</strong></p>${product === "zilch" && game.mode === "cpu" ? `<p>${label(game.winnerIds.includes("you") ? game.winnerIds.length > 1 ? "Unentschieden" : "Du hast gewonnen" : "Der Würfelwirt hat gewonnen")}</p>` : ""}<p>${label("Dein Ergebnis bleibt auf diesem Gerät. Es zählt nicht für Erfolge oder Ranglisten.")}</p><button type="button" class="primary" data-action="pause">${label("Weiter")}</button>${privateRecords()}</section>`;
    return;
  }
  const scroll = main.querySelector(".practice-board")?.scrollTop || 0;
  main.innerHTML = product === "zdwa" ? renderZdwa(game) : renderZilch(game);
  main.querySelector(".practice-board").scrollTop = scroll;
  if (product === "zilch" && game.turn.player_id === "cpu") {
    cpuTimer = setTimeout(() => {
      if (!active || document.hidden) return;
      try { zilch.cpuStep(game); renderGame(); } catch (error) { showError(error); }
    }, 850);
  }
}

function showError(error) {
  const localized = product === "zilch" && error.code ? message(`zilch.error.${error.code}`) : "";
  statusLine.textContent = localized && !localized.startsWith("zilch.error.") ? localized : t(product === "zilch" ? "Aktion nicht möglich" : error.message || "Aktion nicht möglich");
}

async function chooseAnnouncement() {
  const game = session.data;
  const actions = zdwa.ROWS.filter(row => !Object.hasOwn(game.board, `${row},ang`)).map(row => ({ id:`field-${row}`, label:fields[zdwa.FIELD_BY_ROW[row]], value:zdwa.FIELD_BY_ROW[row], className:"secondary" }));
  if (game.announced) actions.unshift({ id:"clear", label:"Ansage aufheben", value:"clear", className:"ghost" });
  actions.push({ id:"cancel", label:"Abbrechen", value:null, className:"ghost" });
  const field = await window.ZDWA_UI.dialog({ title:"Feld ansagen", message:"Nach dem ersten Wurf wählen", actions });
  if (field !== null) zdwa.announce(game, field === "clear" ? null : field);
}

async function handleAction(button) {
  const action = button.dataset.action;
  if (action === "start" || action === "resume") return enter(action === "resume");
  if (actionPending) return;
  actionPending = true;
  try {
    if (action === "pause") { save(); renderWelcome(); return; }
    if (action === "clear") {
      if (await window.ZDWA_UI.confirm({ title:"Offline-Bestwerte löschen?", message:"Dies entfernt nur deine lokalen Bestwerte auf diesem Gerät.", confirmLabel:"Löschen" })) { records = []; save(); active ? renderGame() : renderWelcome(); }
      return;
    }
    if (!active || !session || session.data.finished) return;
    const game = session.data;
    statusLine.textContent = "";
    if (product === "zilch" && ["roll", "bank"].includes(action) && session.selection) {
      zilch.selectHold(game, session.selection);
      session.selection = null;
    }
    if (action === "roll") engine.roll(game);
    if (action === "hold" && product === "zdwa") zdwa.toggleHold(game, Number(button.dataset.index));
    if (action === "announce" && product === "zdwa") await chooseAnnouncement();
    if (action === "write" && product === "zdwa") {
      const row = Number(button.dataset.row), col = button.dataset.col;
      const cell = zdwa.allowedCells(game).find(item => item.row === row && item.col === col);
      if (!cell) return;
      if (cell.points === 0 && !await window.ZDWA_UI.confirm({ title:"Null Punkte eintragen?", message:"Dieses Feld wird mit 0 Punkten abgeschlossen.", confirmLabel:"0 Punkte eintragen" })) return;
      zdwa.write(game, row, col);
      if (!game.finished) zdwa.roll(game);
    }
    if (action === "select" && product === "zilch") session.selection = session.selection === button.dataset.option ? null : button.dataset.option;
    if (action === "bank" && product === "zilch") zilch.bank(game);
    renderGame();
  } catch (error) { showError(error); } finally { actionPending = false; }
}

async function returnOnline() {
  if (actionPending) return;
  actionPending = true;
  clearTimeout(cpuTimer);
  try {
    if (!await window.ZDWA_UI.confirm({ title:"Zurück in den Online-Modus?", message:"Online sind Erfolge und Bestenlisten wieder verfügbar. Dein Offline-Spiel bleibt auf diesem Gerät und wird nicht übertragen.", confirmLabel:"Online spielen", cancelLabel:"Offline bleiben" })) return;
    if (!navigator.onLine) throw new Error("Noch keine Verbindung. Du bleibst im Offline-Modus und kannst weiterspielen.");
    const response = await fetch("/api/health", { cache:"no-store", signal:AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("connection");
    save();
    location.replace(document.body.dataset.onlineHome);
  } catch (_) {
    statusLine.textContent = t("Noch keine Verbindung. Du bleibst im Offline-Modus und kannst weiterspielen.");
  } finally { actionPending = false; if (active) renderGame(); }
}

async function prepareOfflineFiles() {
  await prepareOfflinePackage(result => {
    cached = result.ready;
    const element = document.querySelector("#practiceCacheState");
    if (element) element.textContent = t(!result.supported
      ? "Dieser Browser kann die App nicht für einen späteren Start ohne Internet speichern. Das geöffnete Spiel funktioniert trotzdem offline."
      : cached ? "Für den nächsten Start ohne Internet bereit."
        : "Offline-Dateien werden vorbereitet. Lass diese Seite einmal mit Internet geöffnet.");
  });
}

document.querySelector("#practiceProduct").textContent = product === "zilch" ? "Zilch" : "ZDWA";
document.title = `${product === "zilch" ? "Zilch" : "ZDWA"} · ${t("Offline spielen")}`;
main.addEventListener("click", event => {
  const button = event.target.closest("button[data-action]");
  if (button && !button.disabled) handleAction(button);
});
document.querySelector("#practiceOnline").addEventListener("click", returnOnline);
const language = document.querySelector("#practiceLanguage");
language.value = window.ZDWA_I18N.getLanguage();
language.addEventListener("change", () => window.ZDWA_I18N.setLanguage(language.value, { persist:false }));
// Browser/PWA back is a mode switch too. Keep it behind the same explicit
// confirmation instead of silently returning a practice run to online play.
const home = document.body.dataset.onlineHome;
const offlinePath = `${home === "/" ? "" : home}/offline-spielen`;
if (!history.state?.offlineGate || location.pathname !== offlinePath) {
  history.replaceState({ offlineEntry:true }, "", offlinePath);
  history.pushState({ offlineGate:true }, "");
}
window.addEventListener("popstate", () => {
  history.pushState({ offlineGate:true }, "");
  returnOnline();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { clearTimeout(cpuTimer); if (session) save(); }
  else if (active) renderGame();
});
window.addEventListener("pageshow", event => { if (event.persisted) renderWelcome(); });
window.addEventListener("storage", event => {
  if (event.key !== storageKey) return;
  // Two tabs must never silently keep overwriting the same local run.
  renderWelcome();
  session = null; records = [];
  load(); renderWelcome();
  statusLine.textContent = t("Dein Offline-Spiel wurde in einem anderen Fenster geändert. Bestätige erneut, um fortzufahren.");
});
load();
renderWelcome();
prepareOfflineFiles();
