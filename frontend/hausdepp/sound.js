// These public assets use the browser's HTTP cache. No part of this graph is
// connected to the microphone, MediaStream or the voice transport.
const clips = {
  room: { url: "/static/audio/hausdepp/tavern-room.mp3?v=ASSET_VERSION", gain: 0.065 },
  glasses: { url: "/static/audio/hausdepp/glasses.mp3?v=ASSET_VERSION", gain: 0.035 },
  dishwasher: { url: "/static/audio/hausdepp/dishwasher.mp3?v=ASSET_VERSION", gain: 0.025 },
  laughter: { url: "/static/audio/hausdepp/laughter.mp3?v=ASSET_VERSION", gain: 0.035 },
};
const notes = {
  "sound-on": [660, 880], "sound-off": [660, 440],
  "voice-on": [620, 740], "voice-off": [620, 370],
  "mic-on": [960, 1200], "mic-off": [800, 540],
};

export function createHausdeppSound({
  onState = () => {},
  AudioContext: Context = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetch: fetchAsset = globalThis.fetch,
  lifecycle = globalThis.window,
  random = Math.random,
  setTimeout: delay = globalThis.setTimeout,
  clearTimeout: cancelDelay = globalThis.clearTimeout,
} = {}) {
  const supported = typeof Context === "function" && typeof fetchAsset === "function";
  const listeners = new Set(), buffers = new Map(), nodes = new Set();
  let context = null, enabled = false, destroyed = false, revision = 0;
  let status = "idle", errorKey = "", loading = null, abort = null, suspension = null;
  let room = null, detailTimer = null, suspendTimer = null;
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
    try { entry.source.disconnect(); entry.gain.disconnect(); } catch { /* Already retired. */ }
  };
  const stopNodes = () => {
    if (detailTimer !== null) cancelDelay(detailTimer);
    detailTimer = null;
    room = null;
    for (const entry of [...nodes]) {
      entry.source.onended = null;
      try { entry.source.stop(); } catch { /* Source may already have ended. */ }
      forget(entry);
    }
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
    } catch { /* No source remains, even if the browser refuses suspension. */ }
  };
  const resume = () => {
    const audio = ensureContext();
    const retiring = suspension;
    // Always invoke resume inside the gesture, even while a previous suspend
    // is pending and the browser still reports "running".
    const activation = Promise.resolve(audio.resume());
    return Promise.all([activation, retiring]).then(async () => {
      if (destroyed) return;
      if (!enabled) { suspend(); return; }
      if (audio.state !== "running") await audio.resume();
      if (!enabled && !destroyed) suspend();
    });
  };
  // The caller invokes this synchronously from a gesture. Disabled sound must
  // never create an audio context just because someone toggles their microphone.
  const unlock = () => {
    if (!enabled || destroyed || !supported) return;
    try { quietly(resume()); } catch { /* setEnabled reports activation errors. */ }
  };
  const tone = kind => {
    if (!context || context.state !== "running" || !notes[kind]) return;
    // Rapid clicks must not stack tones into a louder acknowledgement.
    for (const entry of [...nodes]) {
      if (!entry.cue) continue;
      entry.source.onended = null;
      try { entry.source.stop(); } catch { /* Already ended. */ }
      forget(entry);
    }
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
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => forget(entry);
    source.start(start);
    source.stop(start + 0.125);
  };
  const cue = kind => {
    if (enabled && !destroyed && notes[kind] && kind !== "sound-off" && kind !== "sound-on") tone(kind);
  };
  const load = () => {
    if (loading) return loading;
    const audio = context;
    abort = new AbortController();
    const signal = abort.signal;
    loading = Promise.all(Object.entries(clips).map(async ([name, clip]) => {
      if (buffers.has(name)) return;
      const response = await fetchAsset(clip.url, { mode: "same-origin", credentials: "omit", cache: "force-cache", signal });
      if (!response.ok) throw new Error("soundUnavailable");
      const data = await response.arrayBuffer();
      if (destroyed) return;
      const buffer = await audio.decodeAudioData(data);
      if (!destroyed) buffers.set(name, buffer);
    })).catch(error => { loading = null; throw error; });
    return loading;
  };
  const playClip = (name, loop = false) => {
    const buffer = buffers.get(name);
    if (!enabled || destroyed || !buffer || context.state !== "running") return null;
    const source = context.createBufferSource(), gain = context.createGain();
    const entry = { source, gain };
    nodes.add(entry);
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.setValueAtTime(0, context.currentTime);
    gain.gain.linearRampToValueAtTime(clips[name].gain, context.currentTime + (loop ? 1.5 : 0.04));
    source.connect(gain);
    gain.connect(context.destination);
    source.onended = () => forget(entry);
    source.start();
    return entry;
  };
  const scheduleDetail = (attempt, first = false) => {
    if (!current(attempt)) return;
    detailTimer = delay(() => {
      detailTimer = null;
      if (!current(attempt)) return;
      const roll = random(), name = roll < 0.6 ? "glasses" : roll < 0.8 ? "dishwasher" : "laughter";
      const entry = playClip(name);
      if (!entry) { scheduleDetail(attempt); return; }
      entry.source.onended = () => { forget(entry); scheduleDetail(attempt); };
    }, first ? 8000 + random() * 10000 : 25000 + random() * 25000);
  };
  const suspendLater = () => {
    const attempt = revision;
    suspendTimer = delay(() => {
      suspendTimer = null;
      if (destroyed || enabled || attempt !== revision) return;
      stopNodes();
      suspend();
    }, 160);
  };
  async function setEnabled(value) {
    if (destroyed || !supported) return false;
    const wanted = Boolean(value);
    if (wanted === enabled) return enabled;
    const attempt = ++revision;
    cancelSuspension();
    stopNodes();
    enabled = wanted;
    errorKey = "";
    if (!wanted) {
      status = "idle";
      // A final acknowledgement belongs to the click that turns sound off.
      // All ambience stops first; subsequent microphone/voice clicks stay silent.
      tone("sound-off");
      suspendLater();
      emit();
      return true;
    }
    status = "loading";
    emit();
    try {
      // Create/resume before the first await to retain the browser gesture.
      await resume();
      if (!current(attempt)) return false;
      if (context.state !== "running") throw new Error("soundUnavailable");
      tone("sound-on");
      await load();
      if (!current(attempt)) return false;
      room = playClip("room", true);
      if (!room) throw new Error("soundUnavailable");
      status = "playing";
      scheduleDetail(attempt, true);
      emit();
      return true;
    } catch {
      if (!current(attempt)) return false;
      enabled = false;
      stopNodes();
      status = "error";
      errorKey = "soundUnavailable";
      suspend();
      emit();
      return false;
    }
  }
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    enabled = false;
    revision++;
    cancelSuspension();
    stopNodes();
    abort?.abort();
    buffers.clear();
    listeners.clear();
    try { quietly(context?.close()); } catch { /* Page teardown is best effort. */ }
    lifecycle?.removeEventListener("pagehide", destroy);
  }
  lifecycle?.addEventListener("pagehide", destroy);
  return { snapshot, unlock, cue, setEnabled, destroy, subscribe(listener) {
    listeners.add(listener);
    listener(snapshot());
    return () => listeners.delete(listener);
  } };
}
