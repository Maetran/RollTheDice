/** Correlate voice replies on the existing authenticated table socket. */
export function createVoiceSignaling({ send, timeoutMs = 25000 }) {
  const pending = new Map();
  let sequence = 0;
  return {
    request(operation, payload = {}) {
      return new Promise((resolve, reject) => {
        const requestId = `voice-${++sequence}`;
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error("voiceConnectionError"));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        if (!send({ ...payload, action: "hausdepp_voice", operation, request_id: requestId })) {
          clearTimeout(timer); pending.delete(requestId);
          reject(new Error("voiceConnectionError"));
        }
      });
    },
    receive(reply) {
      const request = pending.get(reply?.request_id);
      if (!request) return false;
      pending.delete(reply.request_id); clearTimeout(request.timer);
      if (reply.ok === false) {
        const error = new Error(reply.error_code || "voiceConnectionError");
        error.code = reply.error_code;
        request.reject(error);
      } else request.resolve(reply);
      return true;
    },
    reset() {
      for (const request of pending.values()) {
        clearTimeout(request.timer); request.reject(new Error("voiceConnectionError"));
      }
      pending.clear();
    },
  };
}
