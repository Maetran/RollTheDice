// Cosmetic paper wear uses only a face that this viewer already knows. Hidden
// cards use visible back slots instead; never seed a back with a private card.
const VARIABLES = ["left-y", "right-y", "top-x", "bottom-x", "left-size", "right-size", "top-size", "bottom-size", "fleck-x", "fleck-y", "edge", "tone"];
const DEFAULTS = ["38%", "67%", "70%", "31%", "12%", "10%", "14%", "17%", "78%", "73%", "3%", "28"];

export function cardScorchStyle(publicCard) {
  let hash = 2166136261;
  for (const character of String(publicCard)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const pick = (minimum, range) => {
    hash ^= hash << 13; hash ^= hash >>> 17; hash ^= hash << 5;
    return minimum + (hash >>> 0) % range;
  };
  const values = [pick(18, 61), pick(18, 61), pick(16, 68), pick(16, 68), pick(8, 9), pick(8, 9),
    pick(9, 12), pick(9, 12), pick(15, 71), pick(22, 57), pick(2, 4), pick(20, 17)];
  return VARIABLES.map((name, index) => `--hd-scorch-${name}:${values[index]}${name === "tone" ? "" : "%"}`).join(";") + ";";
}

/** Detached flight pictures must carry their original paper, not their former
 * table's ancestry. The caller supplies a public face or an existing DOM back. */
export function captureCardScorch(source) {
  const style = source?.ownerDocument?.defaultView?.getComputedStyle(source);
  return { scorched: Boolean(source?.closest?.(".hd-cards-scorched, .hd-card-scorched")),
    properties: VARIABLES.map((name, index) => [`--hd-scorch-${name}`,
      style?.getPropertyValue(`--hd-scorch-${name}`) || DEFAULTS[index]]) };
}

export function copyCardScorch(target, { source, card, table, appearance } = {}) {
  const active = appearance?.scorched ?? Boolean((table || source)?.closest?.(".hd-cards-scorched, .hd-card-scorched"));
  target.classList?.toggle("hd-card-scorched", active);
  target.classList?.toggle("hd-cards-scorched", active);
  if (card) target.style.cssText += cardScorchStyle(card);
  else if (source) {
    for (const [property, value] of (appearance || captureCardScorch(source)).properties) target.style.setProperty(property, value);
  }
}
