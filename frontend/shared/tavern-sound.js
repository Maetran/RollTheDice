import { TAVERN_FAMILIES } from "./tavern-catalog.js";
import { createTavernShuffle } from "./tavern-shuffle.js";

const details = {
  glasses: { id: "glasses", url: "/static/audio/hausdepp/glasses.mp3?v=ASSET_VERSION", gain: 0.035 },
  dishwasher: { id: "dishwasher", url: "/static/audio/hausdepp/dishwasher.mp3?v=ASSET_VERSION", gain: 0.025 },
  laughter: { id: "laughter", url: "/static/audio/hausdepp/laughter.mp3?v=ASSET_VERSION", gain: 0.035 },
};
const notes = {
  "sound-on": [660, 880], "sound-off": [660, 440],
  "voice-on": [620, 740], "voice-off": [620, 370],
  "mic-on": [960, 1200], "mic-off": [800, 540],
};
const FADE_SECONDS = 20;

// decodeAudioData cannot be aborted. Even a retired context's decode must finish
// before the next begins, so a rapid off/on cannot create a third room buffer.
let decodeQueue = Promise.resolve();
function decodeSerial(audio, data, active, accept) {
  const work = decodeQueue.then(async () => {
    if (!active()) return;
    const buffer = await audio.decodeAudioData(data);
    if (active()) accept(buffer);
  });
  decodeQueue = work.catch(() => {});
  return work;
}

/** Local speaker-only ambience. It never connects to a microphone or transport. */
export function createTavernSound({
  onState = () => {},
  AudioContext: Context = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetch: fetchAsset = globalThis.fetch,
  lifecycle = globalThis.window,
  families = TAVERN_FAMILIES,
  storage,
  random = Math.random,
  setTimeout: delay = globalThis.setTimeout,
  clearTimeout: cancelDelay = globalThis.clearTimeout,
} = {}) {
  const supported = typeof Context === "function" && typeof fetchAsset === "function" && families.length > 0;
  const listeners = new Set(), buffers = new Map(), loading = new Map(), nodes = new Set();
  const shuffle = createTavernShuffle({ families, random, storage });
  const roomIds = new Set(families.flatMap(family => family.variants.map(variant => variant.id)));
  let context = null, enabled = false, destroyed = false, revision = 0;
  let status = "idle", errorKey = "", suspension = null;
  let room = null, detailTimer = null, rotationTimer = null, suspendTimer = null;
  const snapshot = () => ({ enabled, supported, status, errorKey });
  const emit = () => {
    if (destroyed) return;
    const state = snapshot();
    onState(state);
    for (const listener of listeners) listener(state);
  };
  const current = attempt => enabled && !destroyed && attempt === revision;
  const quietly = promise => { void Promise.resolve(promise).catch(() => {}); };
  const forget = entry => {
    nodes.delete(entry);
    entry.source.onended = null;
    try { entry.source.disconnect(); entry.gain.disconnect(); } catch { /* Already retired. */ }
    if (!entry.cue) entry.source.buffer = null;
  };
  const stop = entry => {
    entry.source.onended = null;
    try {
      entry.gain.gain.cancelScheduledValues(context.currentTime);
      entry.source.stop();
    } catch { /* Source may already have ended. */ }
    forget(entry);
  };
  const stopDetails = () => {
    if (detailTimer !== null) cancelDelay(detailTimer);
    detailTimer = null;
    for (const entry of [...nodes]) if (!entry.cue && !entry.room) stop(entry);
  };
  const stopNodes = () => {
    stopDetails();
    if (rotationTimer !== null) cancelDelay(rotationTimer);
    rotationTimer = null;
    room = null;
    for (const entry of [...nodes]) stop(entry);
    for (const id of roomIds) buffers.delete(id);
  };
  const cancelSuspension = () => {
    if (suspendTimer !== null) cancelDelay(suspendTimer);
    suspendTimer = null;
  };
  const ensureContext = () => {
    if (!context) context = new Context();
    return context;
  };
  const suspend = () => {
    if (!context || destroyed) return;
    try {
      const pending = Promise.resolve(context.suspend()).catch(() => {});
      suspension = pending;
      void pending.then(() => { if (suspension === pending) suspension = null; });
    } catch { /* No source remains if suspension is refused. */ }
  };
  const resume = () => {
    const audio = ensureContext(), retiring = suspension;
    const activation = Promise.resolve(audio.resume());
    return Promise.all([activation, retiring]).then(async () => {
      if (destroyed) return;
      if (!enabled) { suspend(); return; }
      if (audio.state !== "running") await audio.resume();
      if (!enabled && !destroyed) suspend();
    });
  };
  const unlock = () => {
    if (!enabled || destroyed || !supported) return;
    try { quietly(resume()); } catch { /* setEnabled reports activation errors. */ }
  };
  const gestureOptions = { capture: true, passive: true };
  const resumeAfterGesture = () => {
    // Calls, Siri and audio-session changes may interrupt an enabled context.
    // A later table gesture can resume it without toggling sound off and on.
    if (enabled && context?.state !== "running") unlock();
  };
  const tone = kind => {
    if (!context || context.state !== "running" || !notes[kind]) return;
    for (const entry of [...nodes]) if (entry.cue) stop(entry);
    const source = context.createOscillator(), gain = context.createGain();
    const entry = { source, gain, cue: true }, start = context.currentTime;
    nodes.add(entry);
    source.type = "sine";
    source.frequency.setValueAtTime(notes[kind][0], start);
    source.frequency.exponentialRampToValueAtTime(notes[kind][1], start + 0.075);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.03, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
    gain.gain.setValueAtTime(0, start + 0.12);
    source.connect(gain); gain.connect(context.destination);
    source.onended = () => forget(entry);
    source.start(start); source.stop(start + 0.125);
  };
  const cue = kind => {
    if (enabled && !destroyed && notes[kind] && kind !== "sound-off" && kind !== "sound-on") tone(kind);
  };
  const cancelLoads = () => {
    for (const pending of loading.values()) pending.abort.abort();
    loading.clear();
  };
  const loadClip = clip => {
    if (buffers.has(clip.id)) return Promise.resolve();
    if (loading.has(clip.id)) return loading.get(clip.id).promise;
    const audio = context, attempt = revision;
    const pending = { abort: new AbortController(), promise: null };
    const active = () => current(attempt) && loading.get(clip.id) === pending;
    pending.promise = (async () => {
      const response = await fetchAsset(clip.url, { mode: "same-origin", credentials: "omit", cache: "force-cache", signal: pending.abort.signal });
      if (!active()) return;
      if (!response.ok) throw new Error("soundUnavailable");
      const data = await response.arrayBuffer();
      if (!active()) return;
      await decodeSerial(audio, data, active, buffer => buffers.set(clip.id, buffer));
    })().finally(() => {
      if (loading.get(clip.id) === pending) loading.delete(clip.id);
    });
    loading.set(clip.id, pending);
    return pending.promise;
  };
  const loadRoom = clip => Promise.all([loadClip(clip),
    ...(clip.details ? Object.values(details).map(loadClip) : [])]);
  const playClip = (clip, isRoom = false, fadeIn = true) => {
    const buffer = buffers.get(clip.id);
    if (!enabled || destroyed || !buffer || context.state !== "running") return null;
    const source = context.createBufferSource(), gain = context.createGain();
    const entry = { source, gain, clip, room: isRoom };
    nodes.add(entry);
    source.buffer = buffer; source.loop = isRoom;
    if (fadeIn) {
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(clip.gain, context.currentTime + (isRoom ? 1.5 : 0.04));
    }
    source.connect(gain); gain.connect(context.destination);
    source.onended = () => forget(entry);
    // Crossfades configure the gain curves before starting the incoming source.
    if (fadeIn) source.start(context.currentTime, isRoom ? roomOffset(buffer) : 0);
    return entry;
  };
  const roomOffset = buffer => Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0)) * (buffer.duration || 0);
  const detailPlaying = () => [...nodes].some(entry => !entry.cue && !entry.room);
  const scheduleDetail = (attempt, first = false) => {
    if (!current(attempt) || !room?.clip.details || detailTimer !== null || detailPlaying()) return;
    const owner = room;
    detailTimer = delay(() => {
      detailTimer = null;
      if (!current(attempt) || room !== owner || detailPlaying()) return;
      const roll = random(), clip = roll < 0.6 ? details.glasses : roll < 0.8 ? details.dishwasher : details.laughter;
      const entry = playClip(clip);
      if (!entry) { scheduleDetail(attempt); return; }
      entry.source.onended = () => { forget(entry); if (room === owner) scheduleDetail(attempt); };
    }, first ? 8000 + random() * 10000 : 25000 + random() * 25000);
  };
  const curve = (level, incoming) => Float32Array.from({ length: 65 }, (_, index) =>
    level * (incoming ? Math.sin(index / 64 * Math.PI / 2) : Math.cos(index / 64 * Math.PI / 2)));
  const scheduleRotation = (attempt, seconds = 180 + random() * 120) => {
    if (!current(attempt) || !room) return;
    const deadline = context.currentTime + seconds;
    const check = () => {
      rotationTimer = null;
      if (!current(attempt) || !room) return;
      const remaining = deadline - context.currentTime;
      if (remaining > 0 || context.state !== "running") {
        rotationTimer = delay(check, Math.max(1000, remaining * 1000));
        return;
      }
      quietly(rotate(attempt));
    };
    rotationTimer = delay(check, seconds * 1000);
  };
  async function rotate(attempt) {
    const outgoing = room;
    let clip = shuffle.next();
    // A failed load consumes a bag entry but did not change the audible room.
    // Skip that room if the next bag would otherwise select it again.
    if (families.length > 1 ? clip.familyId === outgoing.clip.familyId
      : families[0].variants.length > 1 && clip.id === outgoing.clip.id) clip = shuffle.next();
    let incoming = null;
    try {
      await loadRoom(clip);
      if (!current(attempt) || room !== outgoing) return;
      incoming = playClip(clip, true, false);
      if (!incoming) throw new Error("soundUnavailable");
      const start = context.currentTime;
      outgoing.gain.gain.cancelScheduledValues(start);
      outgoing.gain.gain.setValueCurveAtTime(curve(outgoing.clip.gain, false), start, FADE_SECONDS);
      incoming.gain.gain.setValueCurveAtTime(curve(clip.gain, true), start, FADE_SECONDS);
      incoming.source.start(start, roomOffset(incoming.source.buffer));
      stopDetails();
      // No new load until the outgoing source and its buffer have been retired.
      outgoing.source.onended = () => {
        forget(outgoing);
        if (outgoing.clip.id !== clip.id) buffers.delete(outgoing.clip.id);
        if (!current(attempt) || room !== incoming) return;
        scheduleDetail(attempt, true);
        scheduleRotation(attempt);
      };
      outgoing.source.stop(start + FADE_SECONDS);
      room = incoming;
    } catch {
      if (incoming) stop(incoming);
      if (!current(attempt) || room !== outgoing) return;
      // Setup is atomic: even a Web Audio scheduling/start error must retain
      // the old loop, restore its gain, and leave no unowned incoming source.
      outgoing.source.onended = () => forget(outgoing);
      outgoing.gain.gain.cancelScheduledValues(context.currentTime);
      outgoing.gain.gain.setValueAtTime(outgoing.clip.gain, context.currentTime);
      if (clip.id !== outgoing.clip.id) buffers.delete(clip.id);
      if (detailTimer === null && !detailPlaying()) scheduleDetail(attempt);
      scheduleRotation(attempt, 30);
    }
  }
  const suspendLater = () => {
    const attempt = revision;
    suspendTimer = delay(() => {
      suspendTimer = null;
      if (destroyed || enabled || attempt !== revision) return;
      stopNodes(); suspend();
    }, 160);
  };
  async function setEnabled(value) {
    if (destroyed || !supported) return false;
    const wanted = Boolean(value);
    if (wanted === enabled) return enabled;
    const attempt = ++revision;
    cancelSuspension(); cancelLoads(); stopNodes();
    enabled = wanted; errorKey = "";
    if (!wanted) {
      status = "idle";
      tone("sound-off"); suspendLater(); emit();
      return true;
    }
    const clip = shuffle.next();
    status = "loading"; emit();
    try {
      await resume();
      if (!current(attempt)) return false;
      if (context.state !== "running") throw new Error("soundUnavailable");
      tone("sound-on");
      await loadRoom(clip);
      if (!current(attempt)) return false;
      room = playClip(clip, true);
      if (!room) throw new Error("soundUnavailable");
      status = "playing";
      scheduleDetail(attempt, true); scheduleRotation(attempt); emit();
      return true;
    } catch {
      if (!current(attempt)) return false;
      enabled = false; cancelLoads(); stopNodes();
      status = "error"; errorKey = "soundUnavailable";
      suspend(); emit();
      return false;
    }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true; enabled = false; revision++;
    cancelSuspension(); cancelLoads(); stopNodes(); buffers.clear(); listeners.clear();
    try { quietly(context?.close()); } catch { /* Page teardown is best effort. */ }
    lifecycle?.removeEventListener("pagehide", destroy);
    lifecycle?.removeEventListener("pointerdown", resumeAfterGesture, gestureOptions);
    lifecycle?.removeEventListener("keydown", resumeAfterGesture, gestureOptions);
  }
  lifecycle?.addEventListener("pagehide", destroy);
  lifecycle?.addEventListener("pointerdown", resumeAfterGesture, gestureOptions);
  lifecycle?.addEventListener("keydown", resumeAfterGesture, gestureOptions);
  return { snapshot, unlock, cue, setEnabled, destroy, subscribe(listener) {
    listeners.add(listener); listener(snapshot());
    return () => listeners.delete(listener);
  } };
}
