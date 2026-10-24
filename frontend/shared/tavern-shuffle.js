const STORAGE_KEY = "rollthedice:tavern:shuffle:v1";

/** Persist the bags on this origin; sound itself always starts disabled. */
export function createTavernShuffle({ families, random = Math.random, storage } = {}) {
  let state = {};
  try {
    storage ??= globalThis.localStorage;
    state = JSON.parse(storage?.getItem(STORAGE_KEY) || "{}");
    if (!state || typeof state !== "object" || Array.isArray(state)) state = {};
  } catch { state = {}; }
  const bag = (saved, ids) => Array.isArray(saved)
    ? [...new Set(saved.filter(id => ids.includes(id)))] : [];
  const familyIds = families.map(family => family.id);
  let remaining = bag(state.remaining, familyIds);
  const variantBags = {}, lastVariants = {};
  for (const family of families) {
    const ids = family.variants.map(variant => variant.id);
    variantBags[family.id] = bag(state.variants?.[family.id], ids);
    lastVariants[family.id] = ids.includes(state.lastVariants?.[family.id]) ? state.lastVariants[family.id] : null;
  }
  let lastFamily = familyIds.includes(state.lastFamily) ? state.lastFamily : null;
  const draw = (remainingIds, ids, previous) => {
    if (!remainingIds.length) remainingIds.push(...ids);
    // At a bag boundary the last source must not immediately play again.
    const choices = remainingIds.length > 1 ? remainingIds.filter(id => id !== previous) : remainingIds;
    const roll = Math.max(0, Math.min(0.9999999999999999, Number(random()) || 0));
    const id = choices[Math.floor(roll * choices.length)];
    remainingIds.splice(remainingIds.indexOf(id), 1);
    return id;
  };
  return { next() {
    const familyId = draw(remaining, familyIds, lastFamily);
    const family = families.find(item => item.id === familyId);
    const id = draw(variantBags[familyId], family.variants.map(variant => variant.id), lastVariants[familyId]);
    lastFamily = familyId;
    lastVariants[familyId] = id;
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ remaining, variants: variantBags, lastFamily, lastVariants }));
    } catch { /* Private mode and quota errors keep the in-memory bags. */ }
    return { ...family.variants.find(variant => variant.id === id), familyId, details: family.details === true };
  } };
}
