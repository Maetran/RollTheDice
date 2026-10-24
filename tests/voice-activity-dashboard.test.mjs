import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../frontend/dashboard/voice.js", import.meta.url), "utf8");
const { renderVoiceActivity } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const ids = ["voiceActivityPanel", "voiceActivitySummary", "voiceActivityGames", "voiceActivityUsers", "voiceActivityUpdated", "voiceActivityRetained"];
function fixture() {
  const nodes = Object.fromEntries(ids.map(id => [id, {
    hidden: true, innerHTML: "", textContent: "",
    replaceChildren() { this.innerHTML = ""; this.textContent = ""; },
  }]));
  const context = {
    byId: id => nodes[id], t: key => `T:${key}`, number: value => String(value ?? "—"),
    timestamp: value => value || "—", locale: () => "en-GB",
    e: value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]),
  };
  return { nodes, context };
}
const activity = {
  first_observed_at: "2026-10-25T00:00:00Z", last_observed_at: "2026-10-25T00:01:00Z",
  dropped_observations_since_restart: 2,
  period: { activations: 3, games: 2, users: 1, connected_minutes: 0.5 },
  by_game: [{ game_type: "watten", activations: 3, games: 2, users: 1, connected_minutes: 0.5 }],
  top_users: [{ username: '<img src=x onerror="bad()">', connected_minutes: 0.5 }],
  retained: { activations: 8, games: 5, users: 2, connected_minutes: 10.5 },
};

test("private activity renders translated labels, fractional minutes and escaped current names", () => {
  const { nodes, context } = fixture();
  renderVoiceActivity({ voice_activity: activity }, context);
  assert.equal(nodes.voiceActivityPanel.hidden, false);
  assert.match(nodes.voiceActivitySummary.innerHTML, /T:Minuten mit aktivem Zuhören/);
  assert.match(nodes.voiceActivitySummary.innerHTML, /<strong>0\.5<\/strong>/);
  assert.match(nodes.voiceActivityGames.innerHTML, /Watten/);
  assert.match(nodes.voiceActivityUsers.innerHTML, /&lt;img/);
  assert.doesNotMatch(nodes.voiceActivityUsers.innerHTML, /<img/);
  assert.match(nodes.voiceActivityRetained.textContent, /höchstens 400 Tage/);
  assert.match(nodes.voiceActivityUpdated.textContent, /Serverstart.*2/);
});

test("the existing dashboard account reset immediately removes all private rows and metadata", () => {
  const { nodes, context } = fixture();
  renderVoiceActivity({ voice_activity: activity }, context);
  renderVoiceActivity({}, context);
  assert.equal(nodes.voiceActivityPanel.hidden, true);
  for (const id of ids.slice(1)) {
    assert.equal(nodes[id].innerHTML, "", id);
    assert.equal(nodes[id].textContent, "", id);
  }
});

test("an empty observation history states its boundary and still reports dropped observations", () => {
  const { nodes, context } = fixture();
  renderVoiceActivity({ voice_activity: { first_observed_at: null, dropped_observations_since_restart: 4 } }, context);
  assert.match(nodes.voiceActivitySummary.innerHTML, /Frühere Nutzung wird nicht nachgetragen/);
  assert.match(nodes.voiceActivityUpdated.textContent, /Serverstart.*4/);
  assert.equal(nodes.voiceActivityUsers.innerHTML, "");
  assert.equal(nodes.voiceActivityRetained.textContent, "");
});
