import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/voice.js", import.meta.url), "utf8");
const { createHausdeppVoice } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
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

function setup({ send: customSend, getUserMedia, audioFails = false, iceComplete = true } = {}) {
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
    async createOffer() { return { type: "offer", sdp: "local-offer" }; }
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

test("room changes and page close immediately release all media; teardown is idempotent", async () => {
  const app = setup(); app.setState(state([publication()]));
  await app.controller.connected(); await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const track = app.peers[0].transceivers[0].sender.track;
  await app.controller.receive(state([], { room_id: "other-room" }));
  assert.equal(track.stopped, true); assert.equal(app.controller.snapshot().audio, false);
  app.setState(state([], { room_id: "other-room" }));
  await app.controller.setAudio(true); await app.controller.setMicrophone(true);
  const nextTrack = app.peers[1].transceivers[0].sender.track;
  app.lifecycle.dispatchEvent(new Event("pagehide"));
  assert.equal(nextTrack.stopped, true);
  app.controller.destroy(); app.controller.destroy();
  assert.equal(app.intervals.size, 0); assert.equal(app.timeouts.size, 0);
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
