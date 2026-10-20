// W3C RTCTransportStats payload counters exclude headers, padding and ICE.
// Keep stats identifiers local; the server receives only cumulative byte totals.
export function createHausdeppVoiceUsage(connection, {
  setTimeout: delay = globalThis.setTimeout,
  clearTimeout: cancelDelay = globalThis.clearTimeout,
  timeoutMs = 1000,
} = {}) {
  const directions = ["bytesReceived", "bytesSent"];
  const counters = new Map(["transport", "candidate-pair"].map(type => [type,
    new Map(directions.map(field => [field, new Map()])),
  ]));
  let requested = 0, applied = 0, sequence = 0, received = 0, sent = 0;
  const snapshot = () => sequence ? { received_bytes: received, sent_bytes: sent, sequence } : null;
  const sum = entries => [...entries.values()].reduce((total, entry) =>
    Math.min(Number.MAX_SAFE_INTEGER, total + entry.total), 0);
  const observe = report => {
    const entries = [];
    try { report.forEach(item => { if (counters.has(item?.type) && typeof item.id === "string") entries.push(item); }); }
    catch { return null; }
    const observed = new Map([...counters.keys()].map(type => [type, new Set()]));
    for (const item of entries) for (const field of directions) {
      const value = item[field];
      if (!Number.isSafeInteger(value) || value < 0) continue;
      const records = counters.get(item.type).get(field), previous = records.get(item.id);
      if (previous && Number.isFinite(item.timestamp) && Number.isFinite(previous.timestamp)
        && (item.timestamp < previous.timestamp || item.timestamp === previous.timestamp && value < previous.value)) continue;
      // A replaced/reset counter starts a new segment; disappearing old paths
      // remain in the accumulated total rather than subtracting their traffic.
      const delta = !previous || value < previous.value ? value : value - previous.value;
      records.set(item.id, { value, timestamp: item.timestamp,
        total: Math.min(Number.MAX_SAFE_INTEGER, (previous?.total || 0) + delta) });
      observed.get(item.type).add(field);
    }
    if (!directions.every(field => [...observed.values()].some(fields => fields.has(field)))) return null;
    const totals = directions.map(field => sum(counters.get(observed.get("transport").has(field)
      ? "transport" : "candidate-pair").get(field)));
    // Both families describe the same bytes. Switching availability must never
    // add transport and candidate-pair totals together or decrease a report.
    received = Math.max(received, totals[0]);
    sent = Math.max(sent, totals[1]);
    sequence++;
    return snapshot();
  };
  return { snapshot, collect() {
    if (typeof connection?.getStats !== "function") return Promise.resolve(null);
    const revision = ++requested;
    let pending;
    try { pending = connection.getStats(); } catch { return Promise.resolve(null); }
    return new Promise(resolve => {
      let timer, settled = false;
      const finish = report => {
        if (settled) return;
        settled = true; cancelDelay(timer);
        if (!report || revision < applied) { resolve(null); return; }
        applied = revision;
        resolve(observe(report));
      };
      timer = delay(() => finish(null), timeoutMs);
      Promise.resolve(pending).then(finish, () => finish(null));
    });
  } };
}
