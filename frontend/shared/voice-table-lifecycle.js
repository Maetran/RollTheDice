const storageFor = () => {
  try { return globalThis.sessionStorage; } catch { return null; }
};
const read = (storage, key) => {
  try { return JSON.parse(storage?.getItem(key) || "null"); } catch { return null; }
};
const write = (storage, key, value) => {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, JSON.stringify(value));
  } catch { /* A table remains usable without optional tab storage. */ }
};
const valid = value => typeof value === "string" && value.length > 0 && value.length <= 160;
const quietly = operation => { void Promise.resolve(operation).catch(() => {}); };

/** Only listening intent is retained in this tab. Capture is never persisted. */
export function createVoiceTableLifecycle({ controller, userId, gameType, defaultListening = false,
  storage = storageFor(), notify = () => {} }) {
  const key = `rollthedice.voice.table.${gameType}.${userId}`;
  let record = read(storage, key);
  if (!record || !valid(record.groupId) || typeof record.listening !== "boolean"
      || !Array.isArray(record.games) || !record.games.every(valid)) record = null;
  let gameId = null, ready = false, attempted = false, stopped = false, suppress = false, previousAudio = false;
  const persist = () => write(storage, key, record);
  const unsubscribe = controller.subscribe(state => {
    const ended = previousAudio && !state.audio;
    previousAudio = state.audio;
    if (ended && !suppress && !stopped) notify("voiceEnded");
    if (stopped || !ready || attempted || !state.available) return;
    // One attempt per authorized table entry. A revocation or failed join must
    // never become an automatic retry loop against the authoritative server.
    attempted = true;
    if (record.listening && !state.audio) quietly(controller.setAudio(true));
  });
  function enter({ gameId: next, groupId = next }) {
    if (stopped || !valid(next) || !valid(groupId)) return;
    if (next === gameId) {
      const changed = record.groupId !== groupId || record.lobbyNoticeShown === true;
      record.groupId = groupId;
      delete record.lobbyNoticeShown;
      if (changed) persist();
      return;
    }
    const sameGroup = record && (record.groupId === groupId || record.games.includes(next));
    suppress = true; ready = false; attempted = true;
    if (gameId !== null) quietly(controller.setMicrophone(false));
    if (!sameGroup) {
      quietly(controller.setAudio(false));
      // An old table's discovery cannot authorize an unrelated table. Keep
      // profile opt-in pending until the new authenticated binding discovers it.
      if (gameId !== null) quietly(controller.receive({ event: "state", available: false,
        room_id: null, members: [], publications: [] }));
      record = { groupId, games: [next], listening: defaultListening === true };
    } else {
      record.groupId = groupId;
      record.games = [...new Set([...record.games, next])].slice(-64);
    }
    delete record.lobbyNoticeShown;
    gameId = next; ready = true; attempted = controller.snapshot().audio;
    persist(); suppress = false;
    // Discovery may have completed before the game snapshot supplied its group.
    if (!attempted && controller.snapshot().available) {
      attempted = true;
      if (record.listening) quietly(controller.setAudio(true));
    }
  }
  function clear() {
    ready = false; attempted = true; record = null; gameId = null;
    write(storage, key, null);
  }
  return {
    controller: { ...controller,
      setAudio(enabled) {
        if (record && ready) { record.listening = enabled === true; persist(); }
        attempted = true;
        return controller.setAudio(enabled);
      },
      destroy() { if (stopped) return; stopped = true; unsubscribe(); controller.destroy(); },
    },
    enter,
    handoff(next) {
      if (stopped || !ready || !record || !valid(next)) return;
      // Called only after the owner's authenticated rematch response is valid.
      record.games = [...new Set([...record.games, next])].slice(-64); persist();
      quietly(controller.setMicrophone(false));
    },
    leave() { suppress = true; clear(); quietly(controller.setAudio(false)); },
    revoke() { suppress = true; clear(); quietly(controller.setAudio(false)); },
  };
}

export function queueVoiceTableLeft({ userId, gameType, storage = storageFor() }) {
  write(storage, `rollthedice.voice.left.${gameType}`, userId);
}

/** Watten has no shell dialog bundle; its small status popup stays independent. */
export function showVoiceStatus(message, { host = globalThis.window, document = globalThis.document } = {}) {
  if (typeof host?.ZDWA_UI?.toast === "function") return host.ZDWA_UI.toast(message, { duration: 6000 });
  if (!document?.body) return;
  document.getElementById("voiceExitNotice")?.remove();
  const notice = document.createElement("p");
  notice.id = "voiceExitNotice";
  notice.className = "wt-voice-exit-notice";
  notice.setAttribute("role", "status");
  notice.textContent = message;
  document.body.append(notice);
  host.setTimeout(() => notice.remove(), 6000);
  return notice;
}

export function showVoiceTableLeft({ userId, gameType, t, storage = storageFor(),
  toast = message => showVoiceStatus(message) }) {
  const key = `rollthedice.voice.left.${gameType}`;
  const previous = read(storage, key);
  const tableKey = `rollthedice.voice.table.${gameType}.${userId}`;
  const table = read(storage, tableKey);
  write(storage, key, null);
  // Header/back navigation stops this page's transport, but does not release
  // the server-side seat. Retain its listening choice for a return to the table.
  if (previous === userId) {
    write(storage, tableKey, null);
    toast(t("voiceTableLeft"), { duration: 6000 });
  } else if (table?.listening === true && table.lobbyNoticeShown !== true) {
    table.lobbyNoticeShown = true;
    write(storage, tableKey, table);
    toast(t("voiceEnded"), { duration: 6000 });
  }
}
