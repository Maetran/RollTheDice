import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/hausdepp/voice-usage.js", import.meta.url), "utf8");
const { createHausdeppVoiceUsage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const deferred = () => {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
};
const entry = (type, id, received, sent, timestamp = 1) => ({ type, id, bytesReceived: received, bytesSent: sent, timestamp });
const report = (...entries) => new Map(entries.map(item => [item.id, item]));

test("transport totals take priority and are never added to candidate-pair or RTP counters", async () => {
  let stats = report(entry("transport", "transport", 1000, 500), entry("candidate-pair", "path", 3000, 1500),
    entry("inbound-rtp", "audio", 7000, 0));
  const usage = createHausdeppVoiceUsage({ getStats: () => stats });
  assert.deepEqual(await usage.collect(), { received_bytes: 1000, sent_bytes: 500, sequence: 1 });
  stats = report(entry("transport", "transport", 1800, 900, 2), entry("candidate-pair", "new-path", 800, 400, 2));
  assert.deepEqual(await usage.collect(), { received_bytes: 1800, sent_bytes: 900, sequence: 2 });
});

test("candidate fallback retains old path traffic after a path disappears and does not duplicate repeated IDs", async () => {
  let stats = report(entry("candidate-pair", "old", 100, 40), entry("candidate-pair", "new", 20, 10));
  const usage = createHausdeppVoiceUsage({ getStats: () => stats });
  assert.deepEqual(await usage.collect(), { received_bytes: 120, sent_bytes: 50, sequence: 1 });
  stats = [entry("candidate-pair", "new", 50, 20, 2), entry("candidate-pair", "new", 50, 20, 2)];
  assert.deepEqual(await usage.collect(), { received_bytes: 150, sent_bytes: 60, sequence: 2 });
});

test("changing stats-family availability keeps one cumulative total", async () => {
  let stats = report(entry("candidate-pair", "path", 100, 50));
  const usage = createHausdeppVoiceUsage({ getStats: () => stats });
  await usage.collect();
  stats = report(entry("transport", "transport", 150, 70, 2), entry("candidate-pair", "path", 150, 70, 2));
  assert.deepEqual(await usage.collect(), { received_bytes: 150, sent_bytes: 70, sequence: 2 });
  stats = report(entry("candidate-pair", "path", 180, 90, 3));
  assert.deepEqual(await usage.collect(), { received_bytes: 180, sent_bytes: 90, sequence: 3 });
  stats = report(entry("transport", "transport", 190, 100, 4));
  assert.deepEqual(await usage.collect(), { received_bytes: 190, sent_bytes: 100, sequence: 4 });
});

test("counter resets add a segment, old timestamps are ignored and a new peer starts independently", async () => {
  let stats = report(entry("transport", "transport", 100, 50));
  const connection = { getStats: () => stats }, usage = createHausdeppVoiceUsage(connection);
  await usage.collect();
  stats = report(entry("transport", "transport", 20, 10, 2));
  assert.deepEqual(await usage.collect(), { received_bytes: 120, sent_bytes: 60, sequence: 2 });
  stats = report(entry("transport", "transport", 999, 999, 1));
  assert.equal(await usage.collect(), null);
  assert.deepEqual(usage.snapshot(), { received_bytes: 120, sent_bytes: 60, sequence: 2 });
  stats = report(entry("transport", "transport", 25, 15, 3));
  assert.deepEqual(await usage.collect(), { received_bytes: 125, sent_bytes: 65, sequence: 3 });
  assert.deepEqual(await createHausdeppVoiceUsage(connection).collect(), { received_bytes: 25, sent_bytes: 15, sequence: 1 });
});

test("missing, invalid or partial stats do not fabricate a zero-byte observation", async () => {
  assert.equal(await createHausdeppVoiceUsage({}).collect(), null);
  let stats = report(entry("media-source", "source", 10, 5));
  const usage = createHausdeppVoiceUsage({ getStats: () => stats });
  assert.equal(await usage.collect(), null);
  stats = report(entry("transport", "transport", NaN, -1));
  assert.equal(await usage.collect(), null);
  stats = report(entry("transport", "transport", 10, undefined));
  assert.equal(await usage.collect(), null);
  assert.equal(usage.snapshot(), null);
  stats = report(entry("transport", "transport", 12, 5, 2));
  assert.deepEqual(await usage.collect(), { received_bytes: 12, sent_bytes: 5, sequence: 1 });
  assert.deepEqual(await createHausdeppVoiceUsage({ getStats: () => report(entry("transport", "zero", 0, 0)) }).collect(),
    { received_bytes: 0, sent_bytes: 0, sequence: 1 });
});

test("failed or timed-out reads preserve the last snapshot and ignore results arriving after the deadline", async () => {
  let stats = report(entry("transport", "transport", 100, 50)), timeout;
  const usage = createHausdeppVoiceUsage({ getStats: () => stats }, {
    setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {},
  });
  await usage.collect();
  const pending = deferred(); stats = pending.promise;
  const reading = usage.collect(); timeout();
  assert.equal(await reading, null);
  pending.resolve(report(entry("transport", "transport", 999, 999, 2)));
  await Promise.resolve();
  assert.deepEqual(usage.snapshot(), { received_bytes: 100, sent_bytes: 50, sequence: 1 });
  stats = Promise.reject(new Error("peer is closing"));
  assert.equal(await usage.collect(), null);
  assert.deepEqual(usage.snapshot(), { received_bytes: 100, sent_bytes: 50, sequence: 1 });
});

test("out-of-order reads cannot replace a newer observation and snapshots are safe idempotent retries", async () => {
  const old = deferred(), newer = deferred(); let reads = 0;
  const usage = createHausdeppVoiceUsage({ getStats: () => ++reads === 1 ? old.promise : newer.promise });
  const first = usage.collect(), second = usage.collect();
  newer.resolve(report(entry("transport", "transport", 200, 100, 2)));
  assert.deepEqual(await second, { received_bytes: 200, sent_bytes: 100, sequence: 1 });
  old.resolve(report(entry("transport", "transport", 100, 50, 1)));
  assert.equal(await first, null);
  const retry = usage.snapshot(); retry.received_bytes = 999;
  assert.deepEqual(usage.snapshot(), { received_bytes: 200, sent_bytes: 100, sequence: 1 });
});

test("only integer byte totals and sequence leave the collector", async () => {
  const usage = createHausdeppVoiceUsage({ getStats: () => report({
    ...entry("transport", "private-transport", 123, 45), address: "192.0.2.1", remoteCertificateId: "private-cert",
    selectedCandidatePairId: "private-pair", sdp: "never send this", deviceId: "private-device",
  }) });
  assert.deepEqual(await usage.collect(), { received_bytes: 123, sent_bytes: 45, sequence: 1 });
});
