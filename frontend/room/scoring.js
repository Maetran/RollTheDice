/* Client-side scoring shared by the room's write confirmation and announce UI. */

export const WRITABLE_MAP = {
  0: "1", 1: "2", 2: "3", 3: "4", 4: "5", 5: "6",
  9: "max", 10: "min", 12: "kenter", 13: "full", 14: "poker", 15: "60",
};

export const ANNOUNCE_FIELDS = [
  [
    { row: 0, field: "1", label: "1" }, { row: 1, field: "2", label: "2" },
    { row: 2, field: "3", label: "3" }, { row: 3, field: "4", label: "4" },
    { row: 4, field: "5", label: "5" }, { row: 5, field: "6", label: "6" },
  ],
  [
    { row: 9, field: "max", label: "+" }, { row: 10, field: "min", label: "−" },
    { row: 12, field: "kenter", label: "K" }, { row: 13, field: "full", label: "F" },
    { row: 14, field: "poker", label: "P" }, { row: 15, field: "60", label: "60" },
  ],
];

/** Calculate a local preview; the server remains the scoring authority. */
export function calculatePoints(fieldKey, dice) {
  const counts = {};
  let total = 0;
  for (const die of dice || []) {
    if (die > 0) {
      counts[die] = (counts[die] || 0) + 1;
      total += die;
    }
  }
  if (["1", "2", "3", "4", "5", "6"].includes(fieldKey)) {
    const face = Number(fieldKey);
    return (counts[face] || 0) * face;
  }
  if (fieldKey === "max" || fieldKey === "min") return total;
  if (fieldKey === "kenter") return Object.keys(counts).length === 5 ? 35 : 0;
  const faces = Object.entries(counts);
  if (fieldKey === "full") {
    const values = faces.map(([, count]) => count).sort((left, right) => left - right);
    const triple = Number(faces.find(([, count]) => count === 3)?.[0]);
    const five = Number(faces.find(([, count]) => count === 5)?.[0]);
    return values.join(",") === "2,3" ? 40 + 3 * triple : values.join(",") === "5" ? 40 + 3 * five : 0;
  }
  if (fieldKey === "poker") {
    const match = faces.find(([, count]) => count >= 4);
    return match ? 50 + 4 * Number(match[0]) : 0;
  }
  if (fieldKey === "60") {
    const match = faces.find(([, count]) => count === 5);
    return match ? 60 + 5 * Number(match[0]) : 0;
  }
  return 0;
}
