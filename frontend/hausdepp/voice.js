import { createHausdeppVoiceUsage } from "./voice-usage.js";

// One controller belongs to the table session, including its rematches and
// tournament intermissions. Its owner supplies authenticated game signalling.
export function createHausdeppVoice({
  send, t = key => key, userId, onState = () => {},
  RTCPeerConnection: PeerConnection = globalThis.RTCPeerConnection,
  MediaStream: Stream = globalThis.MediaStream,
  mediaDevices = globalThis.navigator?.mediaDevices,
  createAudio = () => globalThis.document.createElement("audio"),
  createAudioContext = () => {
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    return Context ? new Context() : null;
  },
  lifecycle = globalThis.window,
  setInterval: repeat = globalThis.setInterval,
  clearInterval: cancelRepeat = globalThis.clearInterval,
  setTimeout: delay = globalThis.setTimeout,
  clearTimeout: cancelDelay = globalThis.clearTimeout,
  iceGatheringTimeoutMs = 5000, connectionTimeoutMs = 15000, disconnectGraceMs = 15000,
} = {}) {
  const account = String(userId ?? ""), listeners = new Set();
  const supported = typeof PeerConnection === "function" && typeof Stream === "function";
  let destroyed = false, online = true, available = false, audio = false, microphone = false;
  let status = "idle", errorKey = "", roomId = null, members = [], publications = [];
  let memberToken = null, sessionId = null, pc = null, context = null, localStream = null;
  let sender = null, published = false, speaking = false, epoch = 0, micRevision = 0;
  let queue = Promise.resolve(), disconnectedTimer = null, pollPending = false;
  let subscriptionSignature = "";
  let connectionWaiter = null;
  let usageTracker = null;
  const muted = new Set(), media = new Map(), receiving = new Map();

  const snapshot = () => ({
    supported, available: available && /^[1-9]\d*$/.test(account),
    audio, microphone, speaking, status, errorKey, error: errorKey ? t(errorKey) : "",
    roomId, connected: online, members: members.map(member => ({ ...member,
      muted: muted.has(String(member.user_id)),
    })), mutedUsers: [...muted],
  });
  const emit = () => {
    if (destroyed) return;
    const state = snapshot();
    onState(state);
    for (const listener of listeners) listener(state);
  };
  const current = attempt => !destroyed && audio && attempt === epoch;
  const unwrap = response => {
    const result = response?.hausdepp_voice || response || {};
    if (result.ok === false || result.errorCode) {
      const error = new Error(result.error || result.errorDescription || "voiceConnectionError");
      error.code = result.code || result.errorCode;
      throw error;
    }
    return result;
  };
  const request = async (operation, payload = {}, token = memberToken) => {
    if (!online) throw new Error("voiceConnectionError");
    return unwrap(await send(operation, { ...payload, ...(token ? { member_token: token } : {}) }));
  };
  const quietly = promise => Promise.resolve(promise).catch(() => {});
  const leave = retired => {
    const token = typeof retired === "object" ? retired?.token : retired;
    if (!token || !online) return;
    quietly(request("leave", retired?.usage ? { usage: retired.usage } : {}, token));
  };
  const problem = (error, fallback = "voiceConnectionError") => {
    if (destroyed) return;
    errorKey = error?.name === "NotAllowedError" ? "voiceMicrophoneDenied"
      : error?.name === "NotFoundError" || error?.name === "NotReadableError" ? "voiceMicrophoneUnavailable"
        : fallback;
    status = online ? "error" : "reconnecting";
    emit();
  };
  const enqueue = work => {
    const generation = epoch;
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result.catch(error => { if (generation === epoch) problem(error); return false; });
  };
  const stopMicrophone = () => {
    microphone = false;
    speaking = false;
    micRevision++;
    connectionWaiter?.();
    for (const track of localStream?.getTracks() || []) { track.enabled = false; track.stop(); }
    localStream = null;
  };
  const clearMedia = () => {
    for (const element of media.values()) {
      element.muted = true;
      element.pause();
      element.srcObject = null;
      element.remove?.();
    }
    media.clear(); receiving.clear(); subscriptionSignature = "";
  };
  const closeConnection = () => {
    stopMicrophone();
    // Use the last completed observation: waiting for final getStats here can
    // let a quick new join overtake leave and reuse the retiring membership.
    const usage = usageTracker?.snapshot();
    usageTracker = null;
    clearMedia();
    const old = pc; pc = null;
    if (old) old.close();
    sender = null; published = false; sessionId = null;
    return usage;
  };
  const closeSession = () => {
    const token = memberToken;
    epoch++;
    memberToken = null;
    return { token, usage: closeConnection() };
  };
  const applyMute = () => {
    for (const [mid, element] of media) element.muted = !audio || muted.has(receiving.get(mid)?.userId);
  };
  const playElement = async (element, attempt) => {
    if (!current(attempt)) return;
    try { await element.play(); }
    catch {
      if (current(attempt) && !element.muted) {
        if (microphone || localStream) void setMicrophone(false);
        status = "blocked"; errorKey = "voicePlaybackBlocked"; emit();
      }
    }
  };
  // Invoke from the actual click handler, before waiting for any signalling.
  // A later rejection remains visible and the same button can retry playback.
  const unlock = () => {
    try { context ||= createAudioContext(); quietly(context?.resume?.()); } catch { /* Playback below reports its real result. */ }
    const attempt = epoch;
    for (const element of media.values()) void playElement(element, attempt);
  };
  const setLocalDescription = async (connection, description) => {
    await connection.setLocalDescription(description);
    if (connection.iceGatheringState !== "complete") {
      await new Promise((resolve, reject) => {
        let timer;
        const hasUsableCandidate = () => {
          const relayOnly = connection.getConfiguration?.().iceTransportPolicy === "relay";
          const candidates = connection.localDescription?.sdp || "";
          return relayOnly ? /^a=candidate:[^\r\n]*\styp\s+relay(?:\s|$)/m.test(candidates)
            : /^a=candidate:[^\r\n]*\styp\s+(?:srflx|relay)(?:\s|$)/m.test(candidates);
        };
        const finish = error => {
          cancelDelay(timer);
          connection.removeEventListener("icegatheringstatechange", changed);
          connection.removeEventListener("connectionstatechange", changed);
          if (error) reject(error); else resolve();
        };
        const changed = () => {
          if (connection.connectionState === "closed") finish(new Error("voiceConnectionError"));
          else if (connection.iceGatheringState === "complete") finish();
        };
        connection.addEventListener("icegatheringstatechange", changed);
        connection.addEventListener("connectionstatechange", changed);
        // Some optional STUN/TURN routes can keep gathering after a usable
        // public/relay candidate is ready. Bound the wait without discarding
        // that SDP; a relay-only connection must already have a relay.
        timer = delay(() => finish(connection.connectionState !== "closed" && hasUsableCandidate()
          ? null : new Error("voiceConnectionError")), iceGatheringTimeoutMs);
        changed();
      });
    }
    return { type: connection.localDescription.type, sdp: connection.localDescription.sdp };
  };
  const makeConnection = iceServers => {
    const connection = new PeerConnection({ iceServers: Array.isArray(iceServers) ? iceServers : [] });
    usageTracker = createHausdeppVoiceUsage(connection, { setTimeout: delay, clearTimeout: cancelDelay });
    const attempt = epoch;
    connection.addEventListener("track", event => {
      if (!current(attempt) || pc !== connection || event.track.kind !== "audio") return;
      const mid = String(event.transceiver?.mid ?? ""), publication = receiving.get(mid);
      if (!publication || !publications.some(item => String(item.user_id) === publication.userId
        && `${item.session_id}:${item.track_name}` === publication.key)) return;
      const element = createAudio();
      element.autoplay = true;
      element.playsInline = true;
      element.srcObject = new Stream([event.track]);
      const previous = media.get(mid);
      if (previous) { previous.pause(); previous.srcObject = null; previous.remove?.(); }
      media.set(mid, element);
      applyMute();
      void playElement(element, attempt);
    });
    connection.addEventListener("connectionstatechange", () => {
      if (!current(attempt) || pc !== connection) return;
      if (connection.connectionState === "failed" || connection.connectionState === "closed") {
        // A failed SDP/ICE transport cannot safely reuse its SFU allocation.
        const token = closeSession(); audio = false;
        leave(token); problem(null); return;
      }
      if (connection.connectionState === "disconnected") status = "reconnecting";
      else if (connection.connectionState === "connected" && status !== "blocked") { status = "connected"; errorKey = ""; }
      emit();
    });
    return connection;
  };
  const acceptTracks = response => {
    for (const track of response.tracks || []) {
      if (track.errorCode) throw new Error(track.errorDescription || "voiceConnectionError");
    }
  };
  const acceptSession = response => {
    if (response.session_id == null) return;
    if (sessionId != null && response.session_id !== sessionId) throw new Error("voiceConnectionError");
    sessionId = response.session_id;
  };
  const waitForConnection = (connection, attempt, revision) => new Promise((resolve, reject) => {
    let timer, settled = false;
    const finish = (error, connected = false) => {
      if (settled) return;
      settled = true;
      cancelDelay(timer);
      connection.removeEventListener("connectionstatechange", changed);
      if (connectionWaiter === changed) connectionWaiter = null;
      if (error) reject(error); else resolve(connected);
    };
    const changed = () => {
      if (!current(attempt) || pc !== connection || revision !== micRevision || !online) finish(null);
      else if (connection.connectionState === "connected") finish(null, true);
      else if (["failed", "closed"].includes(connection.connectionState)) finish(new Error("voiceConnectionError"));
    };
    connectionWaiter = changed;
    connection.addEventListener("connectionstatechange", changed);
    timer = delay(() => finish(new Error("voiceConnectionError")), connectionTimeoutMs);
    changed();
  });
  const finishExchange = async (response, connection, attempt, token) => {
    if (!current(attempt) || connection !== pc) return false;
    acceptTracks(response);
    acceptSession(response);
    if (response.sessionDescription) {
      await connection.setRemoteDescription(response.sessionDescription);
      if (!current(attempt) || connection !== pc) return false;
      if (response.sessionDescription.type === "offer") {
        const description = await setLocalDescription(connection, await connection.createAnswer());
        if (!current(attempt) || connection !== pc) return false;
        const answered = await request("answer", { sessionDescription: description }, token);
        if (!current(attempt) || connection !== pc) return false;
        acceptSession(answered);
      }
    } else if (response.requiresImmediateRenegotiation) throw new Error("voiceConnectionError");
    return current(attempt) && connection === pc;
  };
  const updateState = state => {
    if (!state || state.event !== "state") return;
    const rotated = Boolean(roomId && state.room_id && roomId !== state.room_id && audio && state.available === true);
    if (roomId && state.room_id && roomId !== state.room_id && audio) {
      audio = false;
      leave(closeSession());
      status = "idle"; errorKey = "";
    }
    available = state.available === true;
    roomId = state.room_id ?? roomId;
    members = Array.isArray(state.members) ? state.members.map(member => ({ ...member })) : [];
    publications = Array.isArray(state.publications) ? state.publications.map(item => ({ ...item })) : [];
    if (!available && audio) { audio = false; leave(closeSession()); status = "idle"; errorKey = ""; }
    if (audio && memberToken && !members.some(member => String(member.user_id) === account && member.audio === true)) {
      // The room snapshot is authoritative: an expired/revoked membership must
      // release capture even if the old media transport is still running.
      audio = false; leave(closeSession()); status = "error"; errorKey = "voiceConnectionError";
    }
    const wanted = new Set(publications.filter(item => String(item.user_id) !== account)
      .map(item => `${item.session_id}:${item.track_name}`));
    for (const [mid, publication] of receiving) {
      if (wanted.has(publication.key)) continue;
      const element = media.get(mid);
      if (element) { element.muted = true; element.pause(); element.srcObject = null; element.remove?.(); }
      media.delete(mid); receiving.delete(mid);
    }
    // An authorized waiting-room roster change rotates the SFU room. Preserve
    // listening, but retire capture and join the replacement receive-only.
    if (rotated) void setAudio(true);
    else emit();
  };
  const reconcile = async () => {
    const attempt = epoch, connection = pc, token = memberToken;
    if (!current(attempt) || !connection || !token || !online) return;
    const wanted = publications.filter(item => String(item.user_id) !== account);
    const signature = wanted.map(item => `${item.user_id}:${item.session_id}:${item.track_name}`).sort().join("|");
    if (signature === subscriptionSignature) return;
    const userIds = [...new Set(wanted.map(item => item.user_id))];
    try {
      const response = await request("subscribe", { user_ids: userIds }, token);
      if (!current(attempt) || connection !== pc) return;
      acceptTracks(response);
      for (const track of response.tracks || []) {
        const publication = wanted.find(item => String(item.user_id) === String(track.user_id));
        if (!publication || track.mid == null) continue;
        receiving.set(String(track.mid), { userId: String(track.user_id), key: `${publication.session_id}:${publication.track_name}` });
      }
      if (!await finishExchange(response, connection, attempt, token)) return;
      subscriptionSignature = signature;
    } catch (error) {
      // A lost SDP response leaves the allocation/negotiation outcome unknown.
      // Retire it instead of blindly repeating tracks/new on the same session.
      if (current(attempt)) { audio = false; leave(closeSession()); problem(error); }
    }
  };
  const join = async attempt => {
    const response = await request("join", {}, null);
    if (!current(attempt)) { leave(response.member_token); return false; }
    if (!response.member_token) throw new Error("voiceConnectionError");
    memberToken = response.member_token; sessionId = response.session_id ?? null;
    if (response.state) updateState(response.state);
    if (!current(attempt)) return false;
    pc = makeConnection(response.ice_servers);
    roomId = response.room_id || roomId;
    status = "connected"; errorKey = ""; emit();
    await reconcile();
    return current(attempt);
  };
  const disable = () => {
    audio = false;
    const token = closeSession();
    status = "idle"; errorKey = "";
    leave(token); emit();
  };
  const setAudio = enabled => {
    if (!enabled) { disable(); return Promise.resolve(true); }
    if (destroyed) return Promise.resolve(false);
    if (!supported || !/^[1-9]\d*$/.test(account) || !available) {
      problem(null, supported ? "voiceUnavailable" : "voiceUnsupported"); return Promise.resolve(false);
    }
    if (audio && status === "error" && errorKey === "voiceConnectionError") {
      // Retrying an unknown connection outcome needs a new allocation. Reusing
      // the old peer would keep its possibly incomplete SDP exchange alive.
      const token = closeSession(); audio = false; leave(token);
    }
    unlock();
    if (audio) {
      if (status === "blocked") { status = "connected"; errorKey = ""; emit(); }
      return Promise.resolve(true);
    }
    audio = true; microphone = false; status = "connecting"; errorKey = "";
    const attempt = ++epoch;
    emit();
    return enqueue(async () => {
      if (!current(attempt)) return false;
      try { return await join(attempt); }
      catch (error) {
        if (current(attempt)) { audio = false; leave(closeSession()); problem(error); }
        return false;
      }
    });
  };
  const setMicrophone = enabled => {
    if (!enabled) {
      stopMicrophone(); emit();
      const attempt = epoch, connection = pc, token = memberToken;
      return enqueue(async () => {
        if (!current(attempt) || pc !== connection || !token) return true;
        await sender?.replaceTrack(null);
        if (online) await request("microphone", { enabled: false, speaking: false }, token);
        return true;
      });
    }
    if (destroyed) return Promise.resolve(false);
    if (!audio) { problem(null, "voiceEnableAudioFirst"); return Promise.resolve(false); }
    if (status === "blocked") { emit(); return Promise.resolve(false); }
    if (!mediaDevices?.getUserMedia) { problem(null, "voiceMicrophoneUnavailable"); return Promise.resolve(false); }
    if (microphone) return Promise.resolve(true);
    const revision = ++micRevision, attempt = epoch;
    return enqueue(async () => {
      if (!current(attempt) || revision !== micRevision || !pc || !online) return false;
      let stream, negotiating = false;
      try {
        stream = await mediaDevices.getUserMedia({ audio: {
          echoCancellation: true, noiseSuppression: true, autoGainControl: true,
        }, video: false });
        if (!current(attempt) || revision !== micRevision || !online) {
          for (const track of stream.getTracks()) track.stop();
          return false;
        }
        const connection = pc, token = memberToken, track = stream.getAudioTracks()[0];
        if (!track) throw new Error("voiceMicrophoneUnavailable");
        localStream = stream;
        track.addEventListener?.("ended", () => {
          if (localStream === stream) { void setMicrophone(false); problem(null, "voiceMicrophoneUnavailable"); }
        });
        track.addEventListener?.("mute", () => {
          if (localStream === stream) { void setMicrophone(false); problem(null, "voiceMicrophoneUnavailable"); }
        });
        if (published) await sender.replaceTrack(track);
        else {
          negotiating = true;
          const transceiver = connection.addTransceiver(track, { direction: "sendonly" });
          sender = transceiver.sender;
          const description = await setLocalDescription(connection, await connection.createOffer());
          if (!current(attempt) || revision !== micRevision) return false;
          const response = await request("publish", { sessionDescription: description, mid: transceiver.mid }, token);
          if (response.sessionDescription?.type !== "answer") throw new Error("voiceConnectionError");
          if (!await finishExchange(response, connection, attempt, token)) return false;
          published = true;
        }
        if (!current(attempt) || revision !== micRevision) return false;
        // The provider can accept a publication before its peer has connected.
        // Announce readiness only once the native transport can send audio.
        negotiating = true;
        if (!await waitForConnection(connection, attempt, revision)) {
          if (localStream === stream) { stopMicrophone(); emit(); }
          return false;
        }
        negotiating = false;
        await request("microphone", { enabled: true, speaking: false }, token);
        if (!current(attempt) || revision !== micRevision) return false;
        microphone = true; status = "connected"; errorKey = ""; emit();
        return true;
      } catch (error) {
        for (const track of stream?.getTracks() || []) track.stop();
        if (current(attempt) && revision === micRevision) {
          stopMicrophone();
          if (negotiating) { audio = false; leave(closeSession()); problem(error); }
          else throw error;
        }
        return false;
      }
    });
  };
  const receive = message => {
    const state = message?.hausdepp_voice || message?.state || message;
    updateState(state?.state || state);
    if (!destroyed && audio && online) return enqueue(reconcile);
    return Promise.resolve(true);
  };
  const connected = () => {
    if (destroyed) return Promise.resolve(false);
    online = true;
    cancelDelay(disconnectedTimer); disconnectedTimer = null;
    return enqueue(async () => {
      if (audio && memberToken && pc) {
        const attempt = epoch, token = memberToken;
        try {
          const response = await request("resume");
          if (!current(attempt)) return false;
          acceptSession(response);
          if (response.state) updateState(response.state);
          if (!current(attempt)) return false;
          status = "connected"; errorKey = ""; emit();
          await reconcile();
        } catch (error) {
          if (current(attempt)) { audio = false; leave(closeSession()); problem(error); }
        }
      } else {
        const response = await request("state", {}, null);
        if (!destroyed) updateState(response.state || response);
      }
      emit(); return true;
    });
  };
  const disconnected = () => {
    if (destroyed) return;
    online = false;
    connectionWaiter?.();
    if (audio) {
      status = "reconnecting";
      cancelDelay(disconnectedTimer);
      disconnectedTimer = delay(() => { if (!online && !destroyed) { disable(); status = "error"; errorKey = "voiceConnectionError"; emit(); } }, disconnectGraceMs);
    }
    emit();
  };
  const poll = () => {
    if (destroyed || !online || !audio || !memberToken || pollPending) return;
    pollPending = true;
    void enqueue(async () => {
      const attempt = epoch, token = memberToken;
      if (!current(attempt) || !token) return;
      try {
        const usage = await usageTracker?.collect();
        if (!current(attempt)) return;
        const response = await request("heartbeat", usage ? { usage } : {}, token);
        if (!current(attempt)) return;
        if (response.state) updateState(response.state);
        await reconcile();
      } catch (error) {
        if (current(attempt)) { audio = false; leave(closeSession()); problem(error); }
      }
    }).finally(() => { pollPending = false; });
  };
  let statsPending = false;
  const measureSpeaking = () => {
    if (statsPending || !microphone || !online || !pc?.getStats) return;
    statsPending = true;
    const attempt = epoch, revision = micRevision, connection = pc;
    quietly(Promise.resolve(connection.getStats()).then(report => {
      if (!current(attempt) || revision !== micRevision || !microphone) return;
      let level = 0;
      report.forEach(item => {
        if (item.type === "media-source" && item.kind === "audio" && typeof item.audioLevel === "number") level = Math.max(level, item.audioLevel);
      });
      const next = level > 0.025;
      if (speaking === next) return;
      speaking = next; emit();
      return enqueue(async () => {
        if (current(attempt) && revision === micRevision && microphone && online) {
          await request("microphone", { enabled: true, speaking: next });
        }
      });
    }).finally(() => { statsPending = false; }));
  };
  const pollTimer = repeat(poll, 10000), statsTimer = repeat(measureSpeaking, 500);
  const pageClose = () => disable();
  lifecycle?.addEventListener?.("pagehide", pageClose);

  return {
    snapshot, setAudio, setMicrophone, receive, connected, disconnected,
    muteUser(id, enabled) {
      const key = String(id);
      if (enabled) muted.add(key); else muted.delete(key);
      applyMute(); emit();
      if (!enabled && audio) unlock();
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    destroy() {
      if (destroyed) return;
      disable(); destroyed = true;
      cancelRepeat(pollTimer); cancelRepeat(statsTimer); cancelDelay(disconnectedTimer);
      lifecycle?.removeEventListener?.("pagehide", pageClose);
      quietly(context?.close?.()); context = null;
      listeners.clear();
    },
  };
}
