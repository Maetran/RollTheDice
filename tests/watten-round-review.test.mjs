import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = await readFile(new URL("../frontend/watten/round-review.js", import.meta.url), "utf8");
const { createRoundReview } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const table = await readFile(new URL("../frontend/watten/table.js", import.meta.url), "utf8");
const panelSource = table.slice(table.indexOf("function panelMarkup(vm)"), table.indexOf("function privateMarkup(vm)"));
const panelMarkup = runInNewContext(`${panelSource};panelMarkup`, { roundSummaryMarkup: () => "PUBLIC CALL SUMMARY" });
const snapshot = (phase = "deal_complete", collect = 3600, review = 6600) => ({ engine: { phase, deal_id: "one" },
  round_review: { deal_id: "one", started_at: "fixed", collect_remaining_ms: collect, review_remaining_ms: review, auto_advance: phase === "deal_complete" } });

function fixture() {
  let time = 0, changes = 0, active = false, end = 0, serial = 0;
  const tasks = new Map();
  const controller = createRoundReview({ now: () => time, onChange: () => changes++,
    schedule: (fn, delay) => { const id = ++serial; tasks.set(id, { fn, at: time + delay }); return id; },
    unschedule: id => tasks.delete(id),
    motion: { collectionActive: () => active, collectionRemaining: () => Math.max(0, end - time) } });
  return { controller, get changes() { return changes; }, get tasks() { return tasks.size; },
    motion(value, until = time) { active = value; end = until; },
    advance(ms) { time += ms; for (const [id, task] of [...tasks]) if (task.at <= time) { tasks.delete(id); task.fn(); } } };
}

test("terminal deal holds its trick, then shows the call for three seconds before readiness", () => {
  const f = fixture(), state = snapshot();
  assert.equal(f.controller.update(state).stage, "collect");
  f.advance(3600); assert.equal(f.controller.update(state).stage, "review");
  f.advance(2999); assert.equal(f.controller.update(state).stage, "review");
  f.advance(1); assert.equal(f.controller.update(state).stage, "ready"); assert.equal(f.tasks, 0);
});

test("repeated status projections never restart a review; a reload consumes only server remaining time", () => {
  const f = fixture(), state = snapshot(); f.controller.update(state);
  f.advance(4000); f.controller.update(snapshot("deal_complete", 0, 2600), true);
  f.advance(2000); assert.equal(f.controller.update(state).stage, "review");
  f.advance(600); assert.equal(f.controller.update(state).stage, "ready");
  const reloaded = fixture();
  assert.equal(reloaded.controller.update(snapshot("match_complete", 0, 800)).stage, "review");
  reloaded.advance(800); assert.equal(reloaded.controller.update(snapshot("match_complete", 0, 800)).stage, "ready");
});

test("real collection completion gates final result even for late live frames; reduced motion retains server hold", () => {
  const f = fixture(), late = snapshot("match_complete", 0, 0);
  f.controller.update(late); f.motion(true, 3600); f.controller.afterMotion();
  assert.equal(f.controller.update(late).stage, "collect"); assert.equal(f.changes, 1);
  f.advance(3600); assert.equal(f.controller.update(late).stage, "collect", "a pending WAAPI completion must still hide results");
  f.motion(false); f.advance(20); assert.equal(f.controller.update(late).stage, "review");
  f.advance(3000); assert.equal(f.controller.update(late).stage, "ready");
  const reduced = fixture(); assert.equal(reduced.controller.update(snapshot("match_complete")).stage, "collect");
  reduced.advance(3600); assert.equal(reduced.controller.update(snapshot("match_complete")).stage, "review");
});

test("changing deals or tearing down discards the old timer without issuing a game command", () => {
  const f = fixture(); f.controller.update(snapshot());
  assert.equal(f.controller.update({ engine: { deal_id: "next", phase: "strike" } }).stage, "ready");
  assert.equal(f.tasks, 0); f.advance(10000); assert.equal(f.changes, 0);
  f.controller.update(snapshot()); f.controller.discard(); assert.equal(f.tasks, 0);
});

test("owning panel never mounts a result or next-deal action over terminal trick collection", () => {
  for (const phase of ["deal_complete", "match_complete"]) {
    const vm = { engine: { phase }, actions: [], roundPresentation: { stage: "collect" } };
    assert.equal(panelMarkup(vm), "");
    if (phase === "match_complete") {
      vm.roundPresentation.stage = "review"; assert.equal(panelMarkup(vm), "PUBLIC CALL SUMMARY");
    }
  }
});

test("visibility cancellation keeps the readable server window and teardown retires pending presentation callbacks", () => {
  const f = fixture(), state = snapshot("match_complete");
  f.controller.update(state); f.motion(true, 3600); f.controller.afterMotion();
  f.advance(1000); f.motion(false); // createMotion cancels collection on visibilitychange.
  f.advance(2600); assert.equal(f.controller.update(state).stage, "review");
  f.controller.discard(); const changes = f.changes;
  f.advance(10000); assert.equal(f.tasks, 0); assert.equal(f.changes, changes);
});
