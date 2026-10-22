const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

// Optional artifacts for a local renderer preview, using only the accepted
// projection already delivered to this signed-in test player.
async function exportTableReview(item, name, { spectator = false } = {}) {
  const directory = process.env.WATTEN_REVIEW_EXPORT_DIR;
  if (!directory) return;
  const snapshot = item.traffic.snapshot;
  const viewerSeat = spectator ? null : snapshot.engine.viewer.seat;
  const vm = { snapshot, engine: snapshot.engine, room: snapshot.room,
    count: snapshot.engine.seats.length, viewerSeat, anchorSeat: viewerSeat ?? 0,
    playerId: spectator ? null : snapshot.viewer.participant_id, spectator,
    actions: snapshot.engine.actions || [], busy: false, paused: false, awaited: [],
    canResume: false, isHost: !spectator, canLeave: !spectator, bubbles: [],
    freshTrickEnd: false, liveMessage: '', feedbackDismissed: true };
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${name}.json`), JSON.stringify({ vm }, null, 2));
}

module.exports = { exportTableReview };
