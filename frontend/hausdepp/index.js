import { loadAuth, apiFetch, escapeHtml as esc } from "../shared/auth.js";
import { initializeAppMode } from "../multigame/app-mode.js";
import { mountLobbyChat } from "../shared/lobby-chat.js";
import { initChat, addChatMessage } from "../room/chat.js";
import { HAUSDEPP_MESSAGES } from "../i18n/catalog.js";
import { CARD_BOXES } from "./cards.js";

const root = document.getElementById("hausdeppApp");
const page = root?.dataset.page || "lobby";
const gameId = decodeURIComponent(location.pathname.match(/\/hausdepp\/spiel\/([^/]+)/)?.[1] || "");
const ranks = ["6", "7", "8", "9", "U", "O", "K", "A", "10"];
let auth, socket, snapshot, reconnectTimer, lobbyTimer, pendingTimer;
let playerId = null, pending = false, stopped = false, peekSeen = false, lastBurnVersion = 0;
let selection = new Set();
const seenChat = new Set();
const $ = id => document.getElementById(id);
const lang = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";
const t = (key, params = {}) => String(HAUSDEPP_MESSAGES[lang()][key] || key)
  .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
const counted = (key, count, params = {}) => t(count === 1 && HAUSDEPP_MESSAGES[lang()][`${key}One`] ? `${key}One` : key, { ...params, count });
const icon = (name, cls = "") => `<svg class="hd-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${{
  house: "M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7",
  switch: "M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4",
  chat: "M4 4h16v12H9l-5 4V4",
  cards: "M7 4h12v17H7zM4 17 2 3l11-1",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
}[name] || "M12 5v14M5 12h14"}"/></svg>`;

function cardName(card) {
  const [suit, rank] = card.split("-");
  return `${t(suit)} ${t(`rank${rank}`)}`;
}

function cardMarkup(card, { selectable = false, playable = false, selected = false } = {}) {
  const box = CARD_BOXES[card];
  const art = box ? `<svg class="hd-card-art" viewBox="${box.join(" ")}" aria-hidden="true" focusable="false"><image href="/static/hausdepp/cards-source.jpg" width="3996" height="2526"/></svg>` : "";
  const attrs = `class="hausdepp-card ${playable ? "is-playable" : ""} ${selected ? "is-selected" : ""}" data-card-id="${esc(card)}" aria-label="${esc(cardName(card))}"`;
  return selectable
    ? `<button type="button" ${attrs} aria-pressed="${selected}" ${!playable || pending ? "disabled" : ""}>${art}<span class="hd-card-index">${esc(card.split("-")[1])}</span></button>`
    : `<span ${attrs} role="img">${art}</span>`;
}

function header() {
  $("hausdeppHeader").innerHTML = `<a class="hd-brand" href="/hausdepp">${icon("cards")}<span>Hausdepp</span></a>
    <nav class="hd-nav" aria-label="${esc(t("navigation"))}"><a href="/hausdepp" ${page === "lobby" ? 'aria-current="page"' : ""}>${t("lobby")}</a><a href="/hausdepp/regeln" ${page === "rules" ? 'aria-current="page"' : ""}>${t("rules")}</a><a href="/hausdepp/konto">${t("account")}</a></nav>
    <div class="hd-header-tools"><label class="hd-language"><span class="hd-sr">${t("language")}</span><select data-language-switcher aria-label="${t("language")}"><option value="de">DE</option><option value="en">EN</option></select></label><button type="button" data-game-switch class="hd-switch" aria-label="${t("switch")}">${icon("switch")}<span>${t("games")}</span></button></div>`;
  const language = $("hausdeppHeader").querySelector("select");
  language.value = lang();
  language.addEventListener("change", () => window.ZDWA_I18N.setLanguage(language.value));
  initializeAppMode({ mode: "hausdepp" });
}

function footer() {
  return `<footer class="hd-footer"><span>Hausdepp · ZDWA · Zilch</span><a href="/hausdepp/regeln#karten">${t("cardCredits")}</a></footer>`;
}

async function json(url, options) {
  const response = await apiFetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(t(response.status === 403 ? "accessDenied" : "requestFailed"));
  return result;
}

function renderLobby() {
  document.title = t("lobbyTitle");
  root.innerHTML = `<div class="hd-lobby-layout"><section class="hd-welcome"><h1>Hausdepp</h1><p class="hd-motto">${t("motto")}</p><p class="hd-intro">${t("intro")}</p><div class="hd-lobby-cards" aria-hidden="true">${["hearts-U", "acorns-A", "hearts-10"].map(card => cardMarkup(card)).join("")}</div><a class="hd-rules-link" href="/hausdepp/regeln">${t("learnRules")} ${icon("arrow")}</a></section>
    <section class="hd-create" aria-labelledby="hausdeppStartTitle"><h2 id="hausdeppStartTitle">${t("startTable")}</h2><p>${t("startHint")}</p><form id="hausdeppCreateForm"><label>${t("tableName")}<input name="name" value="${esc(t("defaultTable"))}" maxlength="64" required></label><div class="hd-form-row"><label>${t("totalPlayers")}<select name="players">${[2,3,4,5,6].map(n => `<option value="${n}">${n}</option>`).join("")}</select></label><label>${t("computers")}<select name="cpu_count">${[0,1,2,3,4,5].map(n => `<option value="${n}" ${n === 1 ? "selected" : ""}>${n}</option>`).join("")}</select></label></div><p id="hausdeppSeatHint" class="hd-fine">${t("cpuHint")}</p><button id="hausdeppCreate" class="hd-primary" type="submit">${t("takeSeat")} ${icon("arrow")}</button><p id="hausdeppCreateError" class="hd-error" role="alert"></p></form></section></div>
    <section class="hd-rounds"><div class="hd-section-heading"><h2>${t("yourTables")}</h2><button id="hausdeppRefresh" class="hd-text-button" type="button">${t("refresh")}</button></div><div id="hausdeppRounds" aria-live="polite"><p>${t("loadingTables")}</p></div></section><div id="hausdeppLobbyChat" class="hd-lobby-chat"></div>${footer()}`;
  const form = $("hausdeppCreateForm");
  const updateSeats = () => {
    const total = Number(form.elements.players.value);
    const cpu = Number(form.elements.cpu_count.value);
    for (const option of form.elements.cpu_count.options) option.disabled = Number(option.value) >= total;
    if (cpu >= total) form.elements.cpu_count.value = String(total - 1);
    const humans = total - Number(form.elements.cpu_count.value);
    $("hausdeppSeatHint").textContent = humans === 1 ? t("cpuHint") : t("humanHint", { count: humans });
  };
  form.elements.players.addEventListener("change", () => { form.elements.cpu_count.value = String(Number(form.elements.players.value) - 1); updateSeats(); });
  form.elements.cpu_count.addEventListener("change", updateSeats);
  updateSeats();
  form.addEventListener("submit", async event => {
    event.preventDefault();
    $("hausdeppCreate").disabled = true;
    $("hausdeppCreateError").textContent = "";
    try {
      const cpu = Number(form.elements.cpu_count.value);
      const result = await json("/api/games", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.elements.name.value.trim(), mode: form.elements.players.value, game_type: "hausdepp", play_mode: cpu ? "cpu" : "multiplayer", cpu_count: cpu }) });
      const id = result.id || result.game_id;
      if (!id) throw new Error(t("requestFailed"));
      location.assign(`/hausdepp/spiel/${encodeURIComponent(id)}`);
    } catch (error) { $("hausdeppCreateError").textContent = error.message; $("hausdeppCreate").disabled = false; }
  });
  $("hausdeppRefresh").addEventListener("click", refreshTables);
  mountLobbyChat($("hausdeppLobbyChat"), { context: "zdwa", initialAuth: auth });
  refreshTables();
  lobbyTimer = setInterval(refreshTables, 15000);
}

async function refreshTables() {
  if (stopped || !$("hausdeppRounds")) return;
  try {
    const data = await json("/api/games?game_type=hausdepp");
    const games = Array.isArray(data) ? data : data.games || [];
    $("hausdeppRounds").innerHTML = games.length ? games.map(game => `<a class="hd-round-row" href="/hausdepp/spiel/${encodeURIComponent(game.id || game.game_id)}"><span>${icon("cards")}<strong>${esc(game.name || t("defaultTable"))}</strong></span><span>${game.started ? t("continue") : t("join")} ${icon("arrow")}</span></a>`).join("") : `<div class="hd-empty"><p>${t("noTables")}</p><span>${t("noTablesHint")}</span></div>`;
  } catch (error) { $("hausdeppRounds").innerHTML = `<p class="hd-error">${esc(error.message)} <button type="button" class="hd-text-button" id="hausdeppRetry">${t("retry")}</button></p>`; $("hausdeppRetry")?.addEventListener("click", refreshTables); }
}

function renderTableShell() {
  document.body.classList.add("hd-playing");
  root.innerHTML = `<div class="hd-room-layout"><section id="hausdeppTable" class="hd-table" aria-label="${t("table")}"><div class="hd-room-heading"><h1 id="hausdeppRoomName">${t("defaultTable")}</h1><span id="hausdeppConnection" role="status">${t("connecting")}</span></div><div id="hausdeppPlayers" class="hd-seats"></div><div class="hd-centre"><div class="hd-stock-group"><button id="hausdeppStock" class="hd-card-back" type="button" disabled aria-label="${t("stock")}"></button><span id="hausdeppStockAction" class="hd-stack-action"></span><span id="hausdeppStockCount"></span></div><div class="hd-pile-group"><button id="hausdeppPile" class="hd-pile" type="button" disabled aria-label="${t("pickup")}"></button><span id="hausdeppPileCount"></span></div><div class="hd-burned"><span id="hausdeppBurnedCount">0</span><span>${t("outOfPlay")}</span></div></div><p id="hausdeppStatus" class="hd-turn-status" role="status" aria-live="polite">${t("connecting")}</p><p id="hausdeppEvent" class="hd-event" aria-live="polite"></p><section class="hd-hand-region" aria-labelledby="hausdeppHandTitle"><div class="hd-hand-heading"><h2 id="hausdeppHandTitle">${t("yourHand")}</h2><span id="hausdeppSelection"></span></div><div id="hausdeppHand" class="hd-hand"></div></section><div class="hd-actions"><button id="hausdeppPlay" class="hd-primary" disabled>${t("play")}</button><p class="hd-action-guide">${t("stackActions")}</p></div><p id="hausdeppActionError" class="hd-action-error" role="alert"></p><details id="hausdeppPeek" class="hd-peek" hidden><summary>${t("peekTitle")}</summary><p id="hausdeppPeekText"></p><div id="hausdeppPeekCards" class="hd-peek-cards"></div></details><section id="hausdeppResult" class="hd-result" aria-live="polite" hidden></section></section>
    <aside class="hd-social"><div class="hd-social-tools"><button id="chatToggle" type="button" aria-controls="chatPanel" aria-expanded="false">${icon("chat")} ${t("tableChat")} <span id="chatToggleCount" hidden></span></button><div class="hd-reactions" aria-label="${t("reactions")}">${["👍", "😂", "😮", "🎉"].map(emoji => `<button type="button" data-hausdepp-reaction="${emoji}" aria-label="${esc(t("reaction", { emoji }))}">${emoji}</button>`).join("")}</div></div><section id="chatPanel" class="hd-chat-panel" aria-label="${t("tableChat")}"><div class="chat-content" hidden><div class="hd-chat-heading"><h2>${t("tableChat")}</h2><button id="chatClose" type="button">${t("close")}</button></div><div id="chatBox" class="hd-chat-messages" role="log" aria-live="polite"></div><div class="hd-chat-compose"><label class="hd-sr" for="chatInput">${t("message")}</label><input id="chatInput" type="text" maxlength="400" placeholder="${t("message")}" autocomplete="off"><button id="chatSend" type="button">${t("send")}</button></div></div></section><a class="hd-social-rules" href="/hausdepp/regeln">${t("rules")} ${icon("arrow")}</a></aside></div><button id="chatBackdrop" class="hd-chat-backdrop" type="button" aria-label="${t("close")}" hidden></button>`;
  $("hausdeppPlay").addEventListener("click", () => command(snapshot?._hausdepp?.available_actions.includes("afterthrow") ? "afterthrow" : "play", [...selection]));
  $("hausdeppStock").addEventListener("click", () => command(snapshot?._hausdepp?.available_actions.includes("draw") ? "draw" : "gamble"));
  $("hausdeppPile").addEventListener("click", () => command("pickup"));
  $("hausdeppHand").addEventListener("click", event => {
    const card = event.target.closest("[data-card-id]")?.dataset.cardId;
    if (!card || pending) return;
    if ([...selection].some(item => item.split("-")[1] !== card.split("-")[1])) selection.clear();
    if (selection.has(card)) selection.delete(card); else selection.add(card);
    renderState();
  });
  for (const button of document.querySelectorAll("[data-hausdepp-reaction]")) button.addEventListener("click", () => send({ action: "send_emoji", emoji: button.dataset.hausdeppReaction }));
  connect();
}

function send(payload) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(payload));
  return true;
}

function receiveChat(item) {
  const key = JSON.stringify([item.from_id, item.sender, item.ts, item.text, item.kind]);
  if (seenChat.has(key)) return;
  seenChat.add(key);
  addChatMessage(item.sender, item.text, item);
}

function command(action, cards) {
  if (pending || !snapshot?._hausdepp) return;
  pending = true;
  $("hausdeppActionError").textContent = "";
  if (!send({ action: `hausdepp_${action}`, version: snapshot._hausdepp.version, ...(cards ? { cards } : {}) })) {
    pending = false;
    $("hausdeppActionError").textContent = t("connectionLost");
  }
  renderState();
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => { pending = false; if ($("hausdeppActionError")) $("hausdeppActionError").textContent = t("waitingConnection"); renderState(); }, 8000);
}

function connect() {
  if (stopped) return;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${protocol}//${location.host}/ws/${encodeURIComponent(gameId)}`);
  socket.addEventListener("open", () => {
    $("hausdeppConnection").textContent = t("connected");
    send({ action: "join_game", name: auth.user.username });
    initChat(socket, { meName: auth.user.username });
    if (matchMedia("(min-width: 1100px)").matches && $("chatToggle").getAttribute("aria-expanded") !== "true") $("chatToggle").click();
  });
  socket.addEventListener("message", event => {
    let payload;
    try { payload = JSON.parse(event.data); } catch { return; }
    if (payload.player_id) playerId = payload.player_id;
    if (payload.scoreboard) {
      snapshot = payload.scoreboard;
      if (!playerId && snapshot._hausdepp?.viewer_id) playerId = snapshot._hausdepp.viewer_id;
      pending = false;
      clearTimeout(pendingTimer);
      for (const item of snapshot._chat_history || []) receiveChat(item);
      renderState();
    }
    if (payload.chat) receiveChat(payload.chat);
    if (Array.isArray(payload.chat_history)) for (const item of payload.chat_history) receiveChat(item);
    if (payload.emoji) addChatMessage(payload.emoji.from, payload.emoji.emoji, { ...payload.emoji, kind: "reaction" });
    if (payload.error) {
      pending = false;
      clearTimeout(pendingTimer);
      const code = payload.hausdepp_error?.code || payload.error;
      $("hausdeppActionError").textContent = t(code.includes("stale") ? "staleAction" : "actionRejected");
      renderState();
      if (payload.fatal) { stopped = true; socket.close(); }
    }
  });
  socket.addEventListener("close", event => {
    pending = false;
    if ($("hausdeppConnection")) $("hausdeppConnection").textContent = t("connectionLost");
    renderState();
    if (!stopped && event.code !== 1008 && event.code !== 4001) reconnectTimer = setTimeout(connect, 1500);
    else if ($("hausdeppActionError")) $("hausdeppActionError").textContent = t("reconnectHint");
  });
}

function renderState() {
  const s = snapshot?._hausdepp;
  if (!s) { if (snapshot && $("hausdeppStatus")) $("hausdeppStatus").textContent = t("waitingPlayers"); return; }
  $("hausdeppRoomName").textContent = snapshot._name || t("defaultTable");
  document.title = `${snapshot._name || "Hausdepp"} · Hausdepp`;
  const connected = socket?.readyState === WebSocket.OPEN;
  const actions = connected && !pending && !snapshot._paused ? s.available_actions || [] : [];
  const playable = new Set(s.playable_cards || []);
  const oldFocus = document.activeElement?.dataset.cardId;
  selection = new Set([...selection].filter(card => s.hand.includes(card) && playable.has(card)));
  const hand = [...s.hand].sort((a,b) => ranks.indexOf(a.split("-")[1]) - ranks.indexOf(b.split("-")[1]) || a.localeCompare(b));
  $("hausdeppHand").innerHTML = hand.map(card => cardMarkup(card, { selectable: true, playable: actions.length && playable.has(card), selected: selection.has(card) })).join("");
  if (oldFocus) $("hausdeppHand").querySelector(`[data-card-id="${CSS.escape(oldFocus)}"]`)?.focus({ preventScroll: true });
  $("hausdeppSelection").textContent = selection.size ? t("selected", { count: selection.size }) : counted("cardsInHand", hand.length);
  const mine = s.players.find(p => p.id === playerId);
  const opponents = s.players.filter(p => p.id !== playerId);
  $("hausdeppPlayers").dataset.count = String(opponents.length);
  $("hausdeppPlayers").innerHTML = opponents.map((p, i) => `<div class="hd-seat ${p.id === s.current_player_id ? "is-active" : ""} ${p.finished ? "is-finished" : ""}" style="--seat:${i}" aria-label="${esc(`${p.name}: ${p.finished ? t("finished") : counted("cardsInHand", p.hand_count)}`)}"><span class="hd-seat-avatar">${esc(p.name.slice(0,1).toUpperCase())}</span><strong>${esc(p.name)}</strong><span>${p.finished ? `${icon("check")} ${t("finished")}` : counted("cardsInHand", p.hand_count)}</span>${p.is_cpu ? `<small>${t("computer")}</small>` : ""}</div>`).join("");
  $("hausdeppStockCount").textContent = t("stockCount", { count: s.deck_count });
  $("hausdeppStock").classList.toggle("is-empty", !s.deck_count);
  $("hausdeppStock").setAttribute("aria-label", t("stockCount", { count: s.deck_count }));
  $("hausdeppPile").innerHTML = s.discard.length ? s.discard.slice(-3).map(card => cardMarkup(card)).join("") : `<span class="hd-empty-pile">${t("tableClear")}</span>`;
  $("hausdeppPileCount").textContent = t("pileCount", { count: s.discard.length });
  $("hausdeppPile").setAttribute("aria-label", s.discard.length ? t("pileLabel", { card: cardName(s.discard.at(-1)), count: s.discard.length }) : t("tableClear"));
  $("hausdeppBurnedCount").textContent = String(s.burned_count);
  const current = s.players.find(p => p.id === s.current_player_id);
  const afterthrow = actions.includes("afterthrow");
  $("hausdeppStatus").textContent = snapshot._paused ? t("paused") : s.phase === "finished" ? t("roundFinished") : mine?.finished ? t("youFinished") : actions.includes("draw") ? t("drawHint") : afterthrow ? t("afterthrowHint") : current?.id === playerId ? t("yourTurn") : t("playerTurn", { name: current?.name || "…" });
  $("hausdeppStatus").classList.toggle("is-yours", actions.length > 0);
  $("hausdeppPlay").textContent = afterthrow ? t("afterthrow") : t("play");
  $("hausdeppPlay").disabled = !selection.size || !(actions.includes("play") || afterthrow);
  $("hausdeppStock").disabled = !(actions.includes("gamble") || actions.includes("draw"));
  $("hausdeppStock").setAttribute("aria-label", `${t(actions.includes("draw") ? "draw" : "gamble")}, ${t("stockCount", { count: s.deck_count })}`);
  $("hausdeppStockAction").textContent = actions.includes("draw") ? t("draw") : actions.includes("gamble") ? t("gamble") : "";
  $("hausdeppPile").disabled = !actions.includes("pickup");
  const e = s.last_event || {};
  const actor = s.players.find(p => p.id === e.player_id);
  const eventKey = e.type === "draw" ? "eventDraw" : e.burn_reason ? actor?.finished ? "eventBurnFinished" : "eventBurn" : e.type === "pickup" || (e.type === "gamble" && !e.success) ? "eventPickup" : ["play", "afterthrow", "gamble"].includes(e.type) ? "eventPlay" : "eventStart";
  $("hausdeppEvent").textContent = counted(eventKey, e.drawn_count || e.picked_up_count || e.cards?.length || 0, { name: actor?.name || "" });
  if (e.burn_reason && s.version !== lastBurnVersion) { lastBurnVersion = s.version; $("hausdeppPile").animate?.([{ transform: "translateY(0)", opacity: 1 }, { transform: "translateY(-12px)", opacity: .35 }, { transform: "translateY(0)", opacity: 1 }], { duration: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 320, easing: "cubic-bezier(.16,1,.3,1)" }); }
  const known = s.peek?.success ? s.peek.cards : s.private_peek;
  if (known?.length && !peekSeen) {
    peekSeen = true;
    $("hausdeppPeek").hidden = false;
    $("hausdeppPeekText").textContent = t(s.peek.success ? "peekSuccess" : "peekPrivate");
    $("hausdeppPeekCards").innerHTML = known.map(card => cardMarkup(card)).join("");
    $("hausdeppPeek").open = s.peek.success;
    if (s.peek.success) setTimeout(() => { if ($("hausdeppPeek")) $("hausdeppPeek").open = false; }, 6000);
  }
  if (s.phase === "finished") {
    const loser = s.players.find(p => p.id === s.loser_id);
    $("hausdeppResult").hidden = false;
    $("hausdeppResult").innerHTML = `<h2>${esc(t("loser", { name: loser?.name || "…" }))}</h2><p>${t("resultHint")}</p><a class="hd-primary" href="/hausdepp">${t("nextRound")} ${icon("arrow")}</a>`;
  }
}

function renderRules() {
  document.title = t("rulesTitle");
  const sections = ["goal", "deck", "peek", "deal", "moves", "burn", "after", "end", "tips"];
  root.innerHTML = `<article class="hd-rulebook"><div class="hd-rulebook-heading"><h1>${t("rulesTitle")}</h1><p>${t("rulesIntro")}</p></div><div class="hd-rank-line" aria-label="${t("rankOrder")}">${ranks.map(rank => `<span>${esc(t(`rank${rank}`))}</span>`).join("<b aria-hidden='true'>‹</b>")}</div>${sections.map(key => `<section><h2>${t(`${key}Heading`)}</h2><p>${t(`${key}Body`)}</p></section>`).join("")}<section id="karten"><h2>${t("cardCredits")}</h2><p>${t("creditsBody")} <a href="https://commons.wikimedia.org/wiki/File:Doppeldeutsche_Preference.JPG" target="_blank" rel="noopener noreferrer">FUZxxl / Karl432</a> · <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener noreferrer">CC BY 3.0</a></p></section><a class="hd-primary" href="/hausdepp">${t("takeSeat")} ${icon("arrow")}</a></article>${footer()}`;
}

async function start() {
  try {
    auth = await loadAuth();
    if (!auth.authenticated || !(auth.game_access || auth.user?.game_access)?.hausdepp_preview) throw new Error(t("accessDenied"));
    header();
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("metaDescription"));
    if (page === "rules") renderRules(); else if (page === "table") renderTableShell(); else renderLobby();
    document.body.classList.remove("hd-loading");
  } catch (error) { root.innerHTML = `<section class="hd-unavailable"><h1>Hausdepp</h1><p role="alert">${esc(error.message || t("requestFailed"))}</p><a href="/">${t("backSuite")}</a></section>`; document.body.classList.remove("hd-loading"); }
}

window.addEventListener("pagehide", () => { stopped = true; clearInterval(lobbyTimer); clearTimeout(reconnectTimer); clearTimeout(pendingTimer); socket?.close(); });
window.addEventListener("pageshow", event => { if (event.persisted) location.reload(); });
void start();
