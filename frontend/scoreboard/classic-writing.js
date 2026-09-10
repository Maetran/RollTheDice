/* Ballpoint centre-lines, not a wipe over printed font outlines. The finished
   strokes stay on the sheet, so the last frame never swaps back to a font. */
const CLASSIC_PEN_DIGITS = {
  "0": [{ d: "M13.7 4.6 C8.5 1.8 4.8 7.3 4.1 14.7 C3.3 22 5.3 27.1 10.4 25.6 C15.5 24.1 17.2 16.1 16.2 9.5 C15.8 6.2 14.6 4.4 12.8 4.1", weight: 68 }],
  "1": [{ d: "M5.7 10.1 Q10.2 7.3 12.1 3.8 Q11.2 14.5 9.7 25.4", weight: 29 }],
  "2": [{ d: "M4.6 8.5 C7.4 1.8 17.3 2.4 16.2 9.1 C15.4 14.6 7.7 19.8 3.9 25 Q10.9 23.3 16.1 25.1", weight: 52 }],
  "3": [{ d: "M5.6 5.9 C10.5 2.5 17.5 3.2 15.3 8.8 Q13.8 12.7 9.1 14 C16.7 12.4 18.1 18.8 13.8 23.3 C10.6 26.8 5.5 26.4 3.8 23.4", weight: 63 }],
  "4": [
    { d: "M12 4 Q8.2 11.2 3.5 17.5 Q10.5 17.2 17.7 16.4", weight: 29 },
    { d: "M15.6 7.9 Q13.8 17 13.2 25.5", weight: 18 },
  ],
  "5": [
    { d: "M16.5 4.5 Q11.7 3.7 6.6 4.8 L5.6 14.1 C11.3 10.3 18.1 13.4 15.8 20.1 C13.5 27.1 6.3 27.6 3.8 23.2", weight: 58 },
  ],
  "6": [{ d: "M15.7 4.5 C8.8 5.4 4.6 12 4.5 18.4 C4.3 25.6 10.9 28.1 14.4 22.9 C18.7 16.6 13.3 10.8 7.9 15.2 Q5.6 17.2 4.7 19.2", weight: 62 }],
  "7": [
    { d: "M4.4 5.4 Q10.1 3.8 17 4.6 Q11.2 14.7 7.8 25.6", weight: 38 },
    { d: "M6.3 14.4 Q11 13.9 14.9 14.1", weight: 9 },
  ],
  "8": [{ d: "M11.1 13.8 C3.4 10.5 4.7 3.2 11.5 3.6 C18.8 4 17.4 10.8 11.1 13.8 C3.9 17 1.7 24.5 8.7 25.8 C16.7 27.3 20 19 11.1 13.8", weight: 78 }],
  "9": [{ d: "M15.5 10.7 C16 3.6 9.9 2.1 6.3 6.1 C1.1 12 5.1 18.4 10.5 15.8 Q14.3 14 15.9 7.2 Q14.5 18.7 9.2 25.6", weight: 61 }],
};

const classicWritingMounts = new WeakMap();
const classicWritingMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
let classicWritingEpoch = 0;

function stopClassicWriting() {
  classicWritingEpoch += 1;
  document.querySelectorAll(".classic-written-score.is-writing").forEach(node => node.classList.remove("is-writing"));
}

window.addEventListener("zdwa:theme-changed", stopClassicWriting);
classicWritingMotion?.addEventListener?.("change", stopClassicWriting);

function classicWritingKey(boardId, row, column) {
  return JSON.stringify([String(boardId), row, column]);
}

function classicWritingDuration(value) {
  return Math.min(700, 440 + (value.length - 1) * 95);
}

/** Only live, authoritative updates can start strokes. A fresh connection
    explicitly resets the baseline, including scores written while offline. */
function prepareClassicWriting(mount, snapshot, { animateWrites = false, resetWrites = false, readOnly = false } = {}) {
  if (!mount || readOnly) return null;
  let state = classicWritingMounts.get(mount);
  if (!state) {
    state = { values: new Map(), motions: new Map(), epoch: classicWritingEpoch };
    classicWritingMounts.set(mount, state);
    mount.addEventListener("animationend", event => {
      if (event.animationName !== "classic-ink-write" || event.target.dataset.finalStroke !== "true") return;
      const written = event.target.closest(".classic-written-score");
      if (!written) return;
      written.classList.remove("is-writing");
      state.motions.delete(written.dataset.writingKey);
    });
  }
  const now = performance.now();
  const classic = document.documentElement.dataset.game === "zdwa"
    && document.documentElement.dataset.theme === "classic";
  const enabled = classic && !classicWritingMotion?.matches && !document.hidden;
  if (resetWrites || !enabled || state.epoch !== classicWritingEpoch) state.motions.clear();
  state.epoch = classicWritingEpoch;
  const values = new Map();
  const boards = isTeamModeSnapshot(snapshot) ? snapshot._scoreboards_by_team : snapshot._scoreboards;
  for (const [boardId, board] of Object.entries(boards || {})) {
    for (let row = 0; row < ROW_FIELD_KEYS.length; row += 1) {
      if (!ROW_FIELD_KEYS[row]) continue;
      for (const column of ["down", "free", "up", "ang"]) {
        const key = classicWritingKey(boardId, row, column);
        const raw = getCell(board, row, column);
        const value = raw === undefined || raw === null ? "" : String(raw);
        values.set(key, value);
        if (state.values.get(key) !== value) {
          state.motions.delete(key);
          if (animateWrites && !resetWrites && enabled && state.values.has(key) && /^\d{1,3}$/.test(value)) {
            state.motions.set(key, { value, startedAt: now, duration: classicWritingDuration(value) });
          }
        }
      }
    }
  }
  for (const [key, motion] of state.motions) {
    if (values.get(key) !== motion.value || now - motion.startedAt >= motion.duration) state.motions.delete(key);
  }
  state.values = values;
  return { state, now };
}

function classicWrittenScore(value, boardId, row, column, writing) {
  const text = String(value);
  if (!writing || !/^\d{1,3}$/.test(text)) return esc(text);
  const key = classicWritingKey(boardId, row, column);
  const motion = writing.state.motions.get(key);
  const elapsed = motion ? Math.max(0, writing.now - motion.startedAt) : 0;
  const strokes = [...text].flatMap((digit, index) => CLASSIC_PEN_DIGITS[digit].map(stroke => ({ ...stroke, index })));
  const gaps = strokes.slice(1).map((stroke, index) => stroke.index === strokes[index].index ? 20 : 32);
  const penTime = (motion?.duration || classicWritingDuration(text)) - gaps.reduce((total, gap) => total + gap, 0);
  const weight = strokes.reduce((total, stroke) => total + stroke.weight, 0);
  let cursor = 0;
  const paths = strokes.map((stroke, index) => {
    const duration = penTime * stroke.weight / weight;
    const delay = cursor - elapsed;
    cursor += duration + (gaps[index] || 0);
    return `<path class="classic-written-score__stroke" d="${stroke.d}" transform="translate(${stroke.index * 20} 0)" pathLength="1"${index === strokes.length - 1 ? ' data-final-stroke="true"' : ""}${motion ? ` style="--pen-duration:${duration.toFixed(2)}ms;--pen-delay:${delay.toFixed(2)}ms"` : ""}/>`;
  }).join("");
  return `<span class="classic-written-score${motion ? " is-writing" : ""}" data-value="${text}" data-writing-key="${esc(key)}"><span class="classic-written-score__text">${text}</span><svg class="classic-written-score__ink" viewBox="0 0 ${text.length * 20} 30" width="${text.length * 20}" height="30" style="--pen-width:${(text.length * .66).toFixed(2)}em" aria-hidden="true" focusable="false">${paths}</svg></span>`;
}
