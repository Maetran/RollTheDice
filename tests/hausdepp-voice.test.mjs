import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const usageSource = await readFile(new URL("../frontend/hausdepp/voice-usage.js", import.meta.url), "utf8");
const usageURL = `data:text/javascript;base64,${Buffer.from(usageSource).toString("base64")}`;
const source = (await readFile(new URL("../frontend/hausdepp/voice.js", import.meta.url), "utf8"))
  .replace('"./voice-usage.js"', JSON.stringify(usageURL));
const { createHausdeppVoice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const lifecycleSource = await readFile(new URL("../frontend/shared/voice-table-lifecycle.js", import.meta.url), "utf8");
const { createVoiceTableLifecycle } = await import(`data:text/javascript;base64,${Buffer.from(lifecycleSource).toString("base64")}`);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const turn = () => new Promise(resolve => setImmediate(resolve));
class Track extends EventTarget {
  kind = "audio";
  enabled = true;
  stopped = false;
  stop() { this.stopped = true; }
}
class Stream {
  constructor(tracks = [new Track()]) { this.tracks = tracks; }
  getTracks() { return this.tracks; }
  getAudioTracks() { return this.tracks; }
}
const state = (publications = [], extra = {}) => ({ event: "state", available: true, room_id: "room-a",
  members: [{ user_id: 1, player_id: "seat-a", audio: true, microphone: false },
    { user_id: 2, player_id: "seat-b", audio: true, microphone: true }], publications, ...extra });
const publication = (userId = 2, session = "publisher-b") => ({ user_id: userId, session_id: session, track_name: "microphone" });
const byteStats = (received, sent) => new Map([["transport", { type: "transport", id: "transport", bytesReceived: received, bytesSent: sent }]]);

function setup({ send: customSend, getUserMedia, audioFails = false, iceComplete = true,
  candidateType = null, icePolicy = "all", autoConnect = true } = {}) {
  const calls = [], peers = [], elements = [], captures = [], intervals = new Map(), timeouts = new Map();
  const lifecycle = new EventTarget();
  let nextTimer = 0, nextMid = 1, currentState = state(), currentToken = "token-a";
  class Peer extends EventTarget {
    iceGatheringState = iceComplete ? "complete" : "gathering";
    connectionState = "new";
    signalingState = "stable";
    transceivers = [];
    audioLevel = 0;
    constructor(configuration) { super(); this.configuration = configuration; peers.push(this); }
    addTransceiver(track, options) {
      const transceiver = { mid: "0", direction: options.direction,
        sender: { track, async replaceTrack(next) { this.track = next; } } };
      this.transceivers.push(transceiver); return transceiver;
    }
    getConfiguration() { return { ...this.configuration, iceTransportPolicy: icePolicy }; }
    async createOffer() { return { type: "offer", sdp: `local-offer${candidateType
      ? `\r\na=candidate:1 1 udp 100 192.0.2.1 3478 typ ${candidateType}\r\n` : ""}` }; }
    async createAnswer() { return { type: "answer", sdp: "local-answer" }; }
    async setLocalDescription(description) {
      this.localDescription = description;
      this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    }
    async setRemoteDescription(description) {
      this.remoteDescription = description;
      this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
      for (const mid of description.testMids || []) {
        const event = new Event("track");
        event.track = new Track(); event.transceiver = { mid };
        this.dispatchEvent(event);
      }
      if (autoConnect && description.type === "answer") {
        this.connectionState = "connected";
        this.dispatchEvent(new Event("connectionstatechange"));
      }
    }
    async getStats() {
      return new Map([["source", { type: "media-source", kind: "audio", audioLevel: this.audioLevel }]]);
    }
    close() { this.connectionState = "closed"; this.dispatchEvent(new Event("connectionstatechange")); }
  }
  const defaultSend = async (operation, payload) => {
    if (operation === "state" || operation === "heartbeat") return { ok: true, state: currentState };
    if (operation === "join" || operation === "resume") return { ok: true, room_id: "room-a",
      member_token: currentToken, session_id: "session-a", ice_servers: [{ urls: "stun:test.invalid" }], state: currentState };
    if (operation === "publish") return { ok: true, tracks: [{ mid: "0" }], sessionDescription: { type: "answer", sdp: "publish-answer" } };
    if (operation === "subscribe") {
      const tracks = payload.user_ids.map(userId => ({ user_id: userId, mid: String(nextMid++) }));
      return { ok: true, tracks, ...(tracks.length ? { requiresImmediateRenegotiation: true,
        sessionDescription: { type: "offer", sdp: "subscribe-offer", testMids: tracks.map(track => track.mid) } } : {}) };
    }
    return { ok: true };
  };
  const send = async (operation, payload) => {
    calls.push({ operation, payload });
    return customSend ? customSend(operation, payload, defaultSend) : defaultSend(operation, payload);
  };
  const controller = createHausdeppVoice({ send, userId: 1, t: key => `translated:${key}`,
    RTCPeerConnection: Peer, MediaStream: Stream,
    mediaDevices: { async getUserMedia(constraints) {
      captures.push(constraints);
      return getUserMedia ? getUserMedia() : new Stream();
    } },
    createAudio: () => {
      const element = { muted: false, paused: false, srcObject: null, fail: audioFails,
        async play() { if (this.fail) throw new Error("blocked"); this.paused = false; },
        pause() { this.paused = true; }, remove() { this.removed = true; } };
      elements.push(element); return element;
    },
    createAudioContext: () => null, lifecycle,
    setInterval(callback, ms) { const id = ++nextTimer; intervals.set(id, { callback, ms }); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback, ms) { const id = ++nextTimer; timeouts.set(id, { callback, ms }); return id; },
    clearTimeout(id) { timeouts.delete(id); },
  });
  return { controller, calls, peers, elements, captures, intervals, timeouts, lifecycle,
    setState(value) { currentState = value; }, setToken(value) { currentToken = value; },
    tickInterval(ms) { for (const timer of intervals.values()) if (timer.ms === ms) timer.callback(); },
    tickTimeout(ms) { for (const [id, timer] of [...timeouts]) if (timer.ms === ms) { timeouts.delete(id); timer.callback(); } },
  };
}

test("receive-only joins without microphone permission and maps each remote output before answering", async () => {
  const app = setup();
  app.setState(state([publication(2), publication(3, "publisher-c")]));
  await app.controller.connected();
  await app.controller.setAudio(true);
  assert.equal(app.captures.length, 0);
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.deepEqual(app.calls.map(call => call.operation), ["state", "join", "subscribe", "answer"]);
  assert.deepEqual(app.calls[2].payload.user_ids, [2, 3]);
  assert.equal(app.calls[3].payload.member_token, "token-a");
  assert.deepEqual(app.calls[3].payload.sessionDescription, { type: "answer", sdp: "local-answer" });
  assert.equal(app.elements.length, 2);
  assert.ok(app.elements.every(element => element.srcObject.getAudioTracks().length === 1));
  app.controller.destroy();
});

test("an empty listening room can join and resume before an SFU session is allocated", async () => {
  const app = setup({ send: async (operation, payload, fallback) => {
    const response = await fallback(operation, payload);
    return operation === "join" || operation === "resume" ? { ...response, session_id: null } : response;
  } });
  await app.controller.connected(); await app.controller.setAudio(true);
  const peer = app.peers[0];
  app.controller.disconnected(); await app.controller.connected();
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.peers[0], peer);
  assert.equal(app.peers.length, 1);
  assert.equal(app.captures.length, 0);
  assert.equal(app.calls.filter(call => ["publish", "subscribe", "answer"].includes(call.operation)).length, 0);
  app.controller.destroy();
});

test("the first publish or subscription learns a lazy session and rejects a changed resume allocation", async () => {
  for (const operation of ["publish", "subscribe"]) {
    let resumedSession = "lazy-session";
    const app = setup({ send: async (requested, payload, fallback) => {
      const response = await fallback(requested, payload);
      if (requested === "join") return { ...response, session_id: null };
      if (requested === operation) return { ...response, session_id: "lazy-session" };
      if (requested === "resume") return { ...response, session_id: resumedSession };
      return response;
    } });
    await app.controller.connected(); await app.controller.setAudio(true);
    if (operation === "publish") await app.controller.setMicrophone(true);
    else await app.controller.receive(state([publication()]));
    app.controller.disconnected(); await app.controller.connected();
    assert.equal(app.controller.snapshot().audio, true);
    assert.equal(app.peers.length, 1);
    const captured = app.peers[0].transceivers[0]?.sender.track;
    resumedSession = "unexpected-session";
    app.controller.disconnected(); await app.controller.connected();
    assert.equal(app.controller.snapshot().audio, false);
    assert.equal(app.controller.snapshot().errorKey, "voiceConnectionError");
    assert.equal(app.peers[0].connectionState, "closed");
    if (captured) assert.equal(captured.stopped, true);
    app.controller.destroy();
  }
});

test("media responses cannot replace a known SFU allocation", async () => {
  for (const operation of ["publish", "subscribe", "answer"]) {
    const app = setup({ send: async (requested, payload, fallback) => {
      const response = await fallback(requested, payload);
      return requested === operation ? { ...response, session_id: "unexpected-session" } : response;
    } });
    await app.controller.connected(); await app.controller.setAudio(true);
    if (operation === "publish") await app.controller.setMicrophone(true);
    else await app.controller.receive(state([publication()]));
    assert.equal(app.controller.snapshot().audio, false);
    assert.equal(app.controller.snapshot().errorKey, "voiceConnectionError");
    assert.equal(app.peers[0].connectionState, "closed");
    app.controller.destroy();
  }
});

test("microphone readiness is announced only after the native publisher connection is connected", async () => {
  const app = setup({ autoConnect: false }); await app.controller.connected(); await app.controller.setAudio(true);
  const enabling = app.controller.setMicrophone(true); await turn();
  assert.equal(app.calls.filter(call => call.operation === "publish").length, 1);
  assert.equal(app.calls.filter(call => call.operation === "microphone" && call.payload.enabled).length, 0);
  assert.equal(app.controller.snapshot().microphone, false);
  app.peers[0].connectionState = "connected";
  app.peers[0].dispatchEvent(new Event("connectionstatechange"));
  assert.equal(await enabling, true);
  assert.equal(app.calls.filter(call => call.operation === "microphone" && call.payload.enabled).length, 1);
  assert.equal(app.controller.snapshot().microphone, true);
  assert.equal(app.timeouts.size, 0);
  app.controller.destroy();
});

test("a publisher connection deadline releases capture and retires the unready allocation", async () => {
  const app = setup({ autoConnect: false }); await app.controller.connected(); await app.controller.setAudio(true);
  const enabling = app.controller.setMicrophone(true); await turn();
  const track = app.peers[0].transceivers[0].sender.track;
  app.tickTimeout(15000); assert.equal(await enabling, false);
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.controller.snapshot().errorKey, "voiceConnectionError");
  assert.equal(app.peers[0].connectionState, "closed");
  assert.equal(app.calls.filter(call => call.operation === "microphone" && call.payload.enabled).length, 0);
  app.controller.destroy();
});

test("off, stale signalling and failed publishers cannot announce readiness after a late connection", async () => {
  for (const action of ["microphone-off", "output-off", "disconnected", "failed"]) {
    const app = setup({ autoConnect: false }); await app.controller.connected(); await app.controller.setAudio(true);
    const enabling = app.controller.setMicrophone(true); await turn();
    const peer = app.peers[0], track = peer.transceivers[0].sender.track;
    let stopping;
    if (action === "microphone-off") stopping = app.controller.setMicrophone(false);
    else if (action === "output-off") stopping = app.controller.setAudio(false);
    else if (action === "disconnected") app.controller.disconnected();
    else { peer.connectionState = "failed"; peer.dispatchEvent(new Event("connectionstatechange")); }
    await Promise.all([enabling, stopping]);
    assert.equal(track.stopped, true);
    peer.connectionState = "connected"; peer.dispatchEvent(new Event("connectionstatechange"));
    await turn();
    assert.equal(app.controller.snapshot().microphone, false);
    assert.equal(app.calls.filter(call => call.operation === "microphone" && call.payload.enabled).length, 0);
    app.controller.destroy();
    await turn();
    assert.equal(app.timeouts.size, 0);
  }
});

test("audio off stops capture immediately and audio on never restores the microphone", async () => {
  const app = setup();
  await app.controller.connected(); await app.controller.setAudio(true);
  await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  assert.equal(app.controller.snapshot().microphone, true);
  assert.deepEqual(app.captures[0], { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  const off = app.controller.setAudio(false);
  assert.equal(track.stopped, true);
  assert.equal(app.peers[0].connectionState, "closed");
  await off; await app.controller.setAudio(true);
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.captures.length, 1);
  app.controller.destroy();
});

test("muting the microphone releases its device and re-enabling reuses the published sender", async () => {
  const app = setup(); await app.controller.connected(); await app.controller.setAudio(true);
  await app.controller.setMicrophone(true);
  const sender = app.peers[0].transceivers[0].sender, track = sender.track;
  await app.controller.setMicrophone(false);
  assert.equal(track.stopped, true); assert.equal(sender.track, null);
  await app.controller.setMicrophone(true);
  assert.equal(app.captures.length, 2);
  assert.equal(app.calls.filter(call => call.operation === "publish").length, 1);
  assert.equal(app.controller.snapshot().microphone, true);
  app.controller.destroy();
});

test("a late microphone grant cannot resurrect audio after output is disabled", async () => {
  const capture = deferred(), app = setup({ getUserMedia: () => capture.promise });
  await app.controller.connected(); await app.controller.setAudio(true);
  const enabling = app.controller.setMicrophone(true); await turn();
  await app.controller.setAudio(false);
  const stream = new Stream(); capture.resolve(stream); await enabling;
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.controller.snapshot().status, "idle");
  assert.equal(app.calls.filter(call => call.operation === "publish").length, 0);
  app.controller.destroy();
});

test("a late join is withdrawn without replacing a newer requested session", async () => {
  const waiting = deferred(); let joins = 0;
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "join" && ++joins === 1) return waiting.promise;
    return fallback(operation, payload);
  } });
  await app.controller.connected();
  const first = app.controller.setAudio(true); await turn();
  await app.controller.setAudio(false);
  app.setToken("new-token"); const second = app.controller.setAudio(true);
  waiting.resolve({ ok: true, member_token: "old-token", session_id: "old-session" });
  await first; await second;
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.peers.length, 1);
  assert.ok(app.calls.some(call => call.operation === "leave" && call.payload.member_token === "old-token"));
  assert.equal(app.calls.filter(call => call.operation === "join").length, 2);
  app.controller.destroy();
});

test("SFU mutations remain serialized until its answer is accepted and repeated state deduplicates", async () => {
  const answering = deferred(); let answers = 0;
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "answer" && ++answers === 1) return answering.promise;
    return fallback(operation, payload);
  } });
  app.setState(state([publication(2)])); await app.controller.connected();
  const joining = app.controller.setAudio(true); await turn();
  const update = state([publication(2), publication(3, "publisher-c")]);
  const updating = app.controller.receive(update);
  await turn(); assert.equal(app.calls.filter(call => call.operation === "subscribe").length, 1);
  answering.resolve({ ok: true }); await joining; await updating;
  assert.equal(app.calls.filter(call => call.operation === "subscribe").length, 2);
  assert.deepEqual(app.calls.filter(call => call.operation === "subscribe")[1].payload.user_ids, [2, 3]);
  await app.controller.receive(update);
  assert.equal(app.calls.filter(call => call.operation === "subscribe").length, 2);
  app.controller.destroy();
});

test("personal mutes survive state updates, rematches and publication replacement", async () => {
  const app = setup(); app.setState(state([publication()]));
  await app.controller.connected(); await app.controller.setAudio(true);
  app.controller.muteUser(2, true);
  assert.equal(app.elements[0].muted, true);
  await app.controller.receive(state([publication(2, "replacement")]));
  assert.equal(app.elements[0].removed, true);
  assert.equal(app.elements[1].muted, true);
  assert.deepEqual(app.controller.snapshot().mutedUsers, ["2"]);
  app.controller.muteUser(2, false);
  assert.equal(app.elements[1].muted, false);
  await app.controller.receive(state([]));
  assert.equal(app.elements[1].srcObject, null);
  assert.deepEqual(app.calls.filter(call => call.operation === "subscribe").at(-1).payload.user_ids, []);
  app.controller.destroy();
});

test("blocked playback remains visible and an explicit audio click retries it", async () => {
  const app = setup({ audioFails: true }); app.setState(state([publication()]));
  await app.controller.connected(); await app.controller.setAudio(true); await turn();
  assert.equal(app.controller.snapshot().status, "blocked");
  assert.equal(app.controller.snapshot().error, "translated:voicePlaybackBlocked");
  assert.equal(await app.controller.setMicrophone(true), false);
  assert.equal(app.controller.snapshot().status, "blocked");
  app.elements[0].fail = false; await app.controller.setAudio(true); await turn();
  assert.equal(app.controller.snapshot().status, "connected");
  assert.equal(app.captures.length, 0);
  app.controller.destroy();
});

test("playback failure during a call releases its microphone until playback is explicitly retried", async () => {
  const app = setup({ audioFails: true }); await app.controller.connected(); await app.controller.setAudio(true);
  await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  await app.controller.receive(state([publication()])); await turn();
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.controller.snapshot().status, "blocked");
  app.elements[0].fail = false; await app.controller.setAudio(true); await turn();
  assert.equal(app.controller.snapshot().microphone, false);
  app.controller.destroy();
});

test("a withdrawn publication cannot start playing from a late subscribe response", async () => {
  const subscription = deferred();
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "subscribe" && payload.user_ids.length) return subscription.promise;
    return fallback(operation, payload);
  } });
  app.setState(state([publication()])); await app.controller.connected();
  const joining = app.controller.setAudio(true); await turn();
  const withdrawing = app.controller.receive(state([]));
  subscription.resolve({ ok: true, tracks: [{ user_id: 2, mid: "1" }], requiresImmediateRenegotiation: true,
    sessionDescription: { type: "offer", sdp: "old-offer", testMids: ["1"] } });
  await joining; await withdrawing;
  assert.equal(app.elements.length, 0);
  assert.deepEqual(app.calls.filter(call => call.operation === "subscribe").at(-1).payload.user_ids, []);
  app.controller.destroy();
});

test("microphone denial preserves receive-only participation", async () => {
  const error = new Error("denied"); error.name = "NotAllowedError";
  const app = setup({ getUserMedia: () => Promise.reject(error) });
  await app.controller.connected(); await app.controller.setAudio(true);
  assert.equal(await app.controller.setMicrophone(true), false);
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.controller.snapshot().errorKey, "voiceMicrophoneDenied");
  app.controller.destroy();
});

test("short signalling reconnect resumes the same media session; long outage closes devices", async () => {
  const app = setup(); await app.controller.connected(); await app.controller.setAudio(true);
  await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  app.controller.disconnected();
  assert.equal(track.stopped, false);
  assert.equal(app.controller.snapshot().status, "reconnecting");
  await app.controller.connected();
  assert.equal(app.peers.length, 1);
  assert.ok(app.calls.some(call => call.operation === "resume" && call.payload.member_token === "token-a"));
  assert.equal(app.controller.snapshot().microphone, true);
  app.controller.disconnected(); app.tickTimeout(15000);
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().audio, false);
  app.controller.destroy();
});

test("an explicitly retried failed peer allocates a new session with the microphone stopped", async () => {
  let joins = 0;
  const app = setup({ send: async (operation, payload, fallback) => {
    const response = await fallback(operation, payload);
    return operation === "join" ? { ...response, session_id: `session-${++joins}` } : response;
  } });
  await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const failed = app.peers[0], track = failed.transceivers[0].sender.track;
  failed.connectionState = "failed"; failed.dispatchEvent(new Event("connectionstatechange"));
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().status, "error");
  await app.controller.setAudio(true);
  assert.equal(joins, 2); assert.equal(app.peers.length, 2);
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.captures.length, 1);
  app.controller.destroy();
});

test("retry after microphone-status failure retires the still-selected session", async () => {
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "microphone" && payload.enabled) throw new Error("reply lost");
    return fallback(operation, payload);
  } });
  await app.controller.connected(); await app.controller.setAudio(true);
  const enabling = app.controller.setMicrophone(true); await turn();
  const previous = app.peers[0], track = previous.transceivers[0].sender.track;
  await enabling;
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().status, "error");
  await app.controller.setAudio(true);
  assert.equal(previous.connectionState, "closed"); assert.equal(track.stopped, true);
  assert.equal(app.peers.length, 2);
  assert.equal(app.calls.filter(call => call.operation === "join").length, 2);
  assert.equal(app.controller.snapshot().status, "connected");
  assert.equal(app.controller.snapshot().microphone, false);
  app.controller.destroy();
});

test("authoritative membership withdrawal releases capture and requires a fresh explicit join", async () => {
  for (const missing of [false, true]) {
    const app = setup(); await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
    const previous = app.peers[0], track = previous.transceivers[0].sender.track;
    const withdrawn = state();
    withdrawn.members = missing ? withdrawn.members.filter(member => member.user_id !== 1)
      : withdrawn.members.map(member => ({ ...member, ...(member.user_id === 1 ? { audio: false, microphone: false } : {}) }));
    await app.controller.receive(withdrawn);
    assert.equal(track.stopped, true); assert.equal(previous.connectionState, "closed");
    assert.equal(app.controller.snapshot().audio, false);
    assert.equal(app.controller.snapshot().status, "error");
    assert.equal(app.controller.snapshot().available, true);
    await app.controller.setAudio(true);
    assert.equal(app.peers.length, 2);
    assert.equal(app.controller.snapshot().audio, true);
    assert.equal(app.controller.snapshot().microphone, false);
    app.controller.destroy();
  }
});

test("heartbeat membership rejection fails closed instead of keeping the microphone device", async () => {
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "heartbeat") return { ok: false, code: "membership_required" };
    return fallback(operation, payload);
  } });
  await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  app.tickInterval(10000); await turn();
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.controller.snapshot().errorKey, "voiceConnectionError");
  app.controller.destroy();
});

test("heartbeat refreshes room state and speaking statistics never request capture", async () => {
  const app = setup(); await app.controller.connected(); await app.controller.setAudio(true);
  app.tickInterval(10000); await turn();
  assert.ok(app.calls.some(call => call.operation === "heartbeat"));
  app.tickInterval(500); await turn(); assert.equal(app.captures.length, 0);
  await app.controller.setMicrophone(true);
  app.peers[0].audioLevel = 0.5; app.tickInterval(500); await turn();
  assert.equal(app.controller.snapshot().speaking, true);
  assert.ok(app.calls.some(call => call.operation === "microphone" && call.payload.speaking === true));
  app.controller.destroy();
});

test("heartbeats count transported audio while locally muted and preserve usage across signalling resume", async () => {
  const app = setup(); app.setState(state([publication()]));
  await app.controller.connected(); await app.controller.setAudio(true);
  app.controller.muteUser(2, true);
  app.peers[0].getStats = () => byteStats(1000, 50);
  app.tickInterval(10000); await turn();
  assert.deepEqual(app.calls.filter(call => call.operation === "heartbeat").at(-1).payload.usage,
    { received_bytes: 1000, sent_bytes: 50, sequence: 1 });
  assert.equal(app.elements[0].muted, true);
  assert.equal(app.captures.length, 0);
  app.controller.disconnected(); await app.controller.connected();
  app.peers[0].getStats = () => byteStats(1700, 80);
  app.tickInterval(10000); await turn();
  assert.deepEqual(app.calls.filter(call => call.operation === "heartbeat").at(-1).payload.usage,
    { received_bytes: 1700, sent_bytes: 80, sequence: 2 });
  await app.controller.setAudio(false);
  assert.deepEqual(app.calls.filter(call => call.operation === "leave").at(-1).payload.usage,
    { received_bytes: 1700, sent_bytes: 80, sequence: 2 });
  app.controller.destroy();
});

test("a pending stats read cannot delay leave behind a quick rejoin or contaminate the new peer", async () => {
  let activeMember = null, nextMember = 0;
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "leave" && payload.member_token === activeMember) activeMember = null;
    const response = await fallback(operation, payload);
    if (operation === "join") {
      activeMember ||= `token-${++nextMember}`;
      return { ...response, member_token: activeMember, session_id: `session-${activeMember}` };
    }
    return response;
  } });
  await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const peer = app.peers[0], captured = peer.transceivers[0].sender.track;
  peer.getStats = () => byteStats(1000, 500);
  app.tickInterval(10000); await turn();
  const waiting = deferred(); peer.getStats = () => waiting.promise;
  app.tickInterval(10000); await turn();
  await app.controller.setAudio(false);
  assert.equal(captured.stopped, true);
  assert.equal(peer.connectionState, "closed");
  assert.equal(activeMember, null);
  const leaving = app.calls.filter(call => call.operation === "leave").at(-1);
  assert.equal(leaving.payload.member_token, "token-1");
  assert.deepEqual(leaving.payload.usage, { received_bytes: 1000, sent_bytes: 500, sequence: 1 });
  const rejoining = app.controller.setAudio(true);
  waiting.resolve(byteStats(999999, 999999)); await rejoining;
  assert.equal(activeMember, "token-2");
  assert.ok(app.calls.indexOf(leaving) < app.calls.findLastIndex(call => call.operation === "join"));
  app.peers[1].getStats = () => byteStats(20, 5);
  app.tickInterval(10000); await turn();
  const heartbeat = app.calls.filter(call => call.operation === "heartbeat").at(-1);
  assert.equal(heartbeat.payload.member_token, "token-2");
  assert.deepEqual(heartbeat.payload.usage, { received_bytes: 20, sent_bytes: 5, sequence: 1 });
  assert.equal(app.controller.snapshot().audio, true);
  app.controller.destroy();
});

test("missing, failed or slow getStats never changes voice participation or fabricates usage", async () => {
  const app = setup(); await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  for (const getStats of [undefined, () => { throw new Error("closing"); }, () => Promise.reject(new Error("unavailable"))]) {
    app.peers[0].getStats = getStats;
    app.tickInterval(10000); await turn();
    assert.equal(app.calls.filter(call => call.operation === "heartbeat").at(-1).payload.usage, undefined);
    assert.equal(app.controller.snapshot().audio, true);
    assert.equal(app.controller.snapshot().microphone, true);
  }
  app.peers[0].getStats = () => new Promise(() => {});
  app.tickInterval(10000); await turn(); app.tickTimeout(1000); await turn();
  assert.equal(app.calls.filter(call => call.operation === "heartbeat").at(-1).payload.usage, undefined);
  assert.equal(app.controller.snapshot().microphone, true);
  app.controller.destroy();
});

test("authorized room rotation keeps listening, retires capture and requires fresh microphone activation", async () => {
  const app = setup(); app.setState(state([publication()]));
  await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  app.setState(state([], { room_id: "other-room" }));
  await app.controller.receive(state([], { room_id: "other-room" }));
  assert.equal(track.stopped, true); assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.peers[0].connectionState, "closed");
  assert.equal(app.calls.filter(call => call.operation === "join").length, 2);
  assert.equal(app.captures.length, 1);
  await app.controller.setMicrophone(true);
  const nextTrack = app.peers[1].transceivers[0].sender.track;
  app.lifecycle.dispatchEvent(new Event("pagehide"));
  assert.equal(nextTrack.stopped, true);
  app.controller.destroy(); app.controller.destroy();
  await turn();
  assert.equal(app.intervals.size, 0); assert.equal(app.timeouts.size, 0);
});

test("new-game handoff cancels a pending device permission without disabling listening", async () => {
  const capture = deferred(), app = setup({ getUserMedia: () => capture.promise });
  const life = createVoiceTableLifecycle({ controller: app.controller, userId: 1, gameType: "hausdepp", storage: null });
  life.enter({ gameId: "first" }); await app.controller.connected(); await life.controller.setAudio(true);
  const enabling = life.controller.setMicrophone(true); await turn();
  life.handoff("second"); life.enter({ gameId: "second" });
  const stream = new Stream(); capture.resolve(stream); await enabling; await turn();
  assert.equal(stream.getTracks()[0].stopped, true);
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.calls.some(call => call.operation === "publish"), false);
  life.controller.destroy();
});

test("unrelated table opt-in waits for its new authenticated discovery instead of the preceding socket", async () => {
  const app = setup();
  const life = createVoiceTableLifecycle({ controller: app.controller, userId: 1, gameType: "hausdepp",
    defaultListening: true, storage: null });
  life.enter({ gameId: "first" }); await app.controller.connected(); await turn();
  assert.equal(app.calls.filter(call => call.operation === "join").length, 1);
  life.enter({ gameId: "unrelated" }); app.controller.disconnected(); await turn();
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.controller.snapshot().available, false);
  assert.equal(app.calls.filter(call => call.operation === "join").length, 1);
  app.setState(state([], { room_id: "other-table" }));
  await app.controller.connected(); await turn();
  assert.equal(app.controller.snapshot().audio, true);
  assert.equal(app.controller.snapshot().microphone, false);
  assert.equal(app.calls.filter(call => call.operation === "join").length, 2);
  life.controller.destroy();
});

test("unknown subscription result retires the connection rather than repeating an uncertain allocation", async () => {
  const app = setup({ send: async (operation, payload, fallback) => {
    if (operation === "subscribe") throw new Error("response lost");
    return fallback(operation, payload);
  } });
  app.setState(state([publication()])); await app.controller.connected(); await app.controller.setAudio(true);
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.controller.snapshot().status, "error");
  assert.equal(app.peers[0].connectionState, "closed");
  await app.controller.receive(state([publication()]));
  assert.equal(app.calls.filter(call => call.operation === "subscribe").length, 1);
  app.controller.destroy();
});

test("ICE gathering is bounded and cannot leave a microphone running after timeout", async () => {
  const app = setup({ iceComplete: false }); await app.controller.connected(); await app.controller.setAudio(true);
  const enabling = app.controller.setMicrophone(true); await turn();
  const track = app.peers[0].transceivers[0].sender.track;
  app.tickTimeout(5000); await enabling;
  assert.equal(track.stopped, true);
  assert.equal(app.controller.snapshot().audio, false);
  assert.equal(app.calls.filter(call => call.operation === "publish").length, 0);
  app.controller.destroy();
});

test("the ICE deadline forwards usable partial SDP while optional routes are still gathering", async () => {
  for (const candidateType of ["srflx", "relay"]) {
    const app = setup({ iceComplete: false, candidateType }); await app.controller.connected(); await app.controller.setAudio(true);
    const enabling = app.controller.setMicrophone(true); await turn();
    assert.equal(app.calls.filter(call => call.operation === "publish").length, 0);
    app.tickTimeout(5000); await enabling;
    assert.equal(app.peers[0].iceGatheringState, "gathering");
    assert.equal(app.controller.snapshot().microphone, true);
    const publication = app.calls.find(call => call.operation === "publish");
    assert.ok(publication.payload.sessionDescription.sdp.includes(`typ ${candidateType}`));
    app.controller.destroy();
  }
});

test("relay-only ICE cannot use a server-reflexive candidate at the deadline", async () => {
  for (const candidateType of ["srflx", "relay"]) {
    const app = setup({ iceComplete: false, candidateType, icePolicy: "relay" });
    await app.controller.connected(); await app.controller.setAudio(true);
    const enabling = app.controller.setMicrophone(true); await turn();
    const track = app.peers[0].transceivers[0].sender.track;
    app.tickTimeout(5000); await enabling;
    assert.equal(app.controller.snapshot().microphone, candidateType === "relay");
    assert.equal(track.stopped, candidateType !== "relay");
    assert.equal(app.calls.filter(call => call.operation === "publish").length, candidateType === "relay" ? 1 : 0);
    app.controller.destroy();
  }
});

test("host-only partial ICE and a closed peer fail without publishing or resurrecting capture", async () => {
  for (const closed of [false, true]) {
    const app = setup({ iceComplete: false, candidateType: closed ? "relay" : "host" });
    await app.controller.connected(); await app.controller.setAudio(true);
    const enabling = app.controller.setMicrophone(true); await turn();
    const track = app.peers[0].transceivers[0].sender.track;
    if (closed) await app.controller.setAudio(false);
    else app.tickTimeout(5000);
    await enabling;
    assert.equal(track.stopped, true);
    assert.equal(app.controller.snapshot().microphone, false);
    assert.equal(app.calls.filter(call => call.operation === "publish").length, 0);
    app.controller.destroy();
  }
});
