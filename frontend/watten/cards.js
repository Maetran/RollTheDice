// Watten reuses the Hausdepp artwork (docs/HAUSDEPP_ASSETS.md) for its own
// 33-card deck: 7 to ace in four suits plus the Weli, the printed bells six.
import { cardArt, prepareCardAssets } from "../hausdepp/cards.js";
import { cardScorchStyle } from "../hausdepp/card-scorch.js";
import { WATTEN_MESSAGES } from "../i18n/catalog.js";
import { escapeHtml as esc } from "../shared/auth.js";

export const SUITS = Object.freeze(["hearts", "bells", "leaves", "acorns"]);
export const RANKS = Object.freeze(["7", "8", "9", "10", "U", "O", "K", "A"]);
export const STRIKES = Object.freeze([...RANKS, "weli"]);
export const WELI = "bells-6";
const DECK = new Set([...SUITS.flatMap(suit => RANKS.map(rank => `${suit}-${rank}`)), WELI]);

export const lang = () => window.ZDWA_I18N?.getLanguage?.() === "en" ? "en" : "de";

/** Keyed copy with named parameters; never concatenates translated fragments. */
export function t(key, params = {}) {
  const catalog = WATTEN_MESSAGES[lang()];
  const template = catalog[key] ?? WATTEN_MESSAGES.de[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ""));
}

export const isCard = card => typeof card === "string" && DECK.has(card);

export function suitName(suit) {
  return SUITS.includes(suit) ? t(`suit.${suit}`) : "";
}

export function strikeName(rank) {
  return STRIKES.includes(rank) ? t(`rank.${rank}`) : "";
}

export function cardName(card) {
  if (!isCard(card)) return t("card.unknown");
  if (card === WELI) return t("card.weli");
  const [suit, rank] = card.split("-");
  return t("card.name", { suit: suitName(suit), rank: strikeName(rank) });
}

// A fixed printed order: suit rows, then 6 (Weli) to ace. It never depends on
// trump, strike or card strength, so sorting reveals nothing about the call.
const ORDER = new Map([...SUITS.flatMap(suit => (suit === "bells" ? ["6", ...RANKS] : RANKS)
  .map(rank => `${suit}-${rank}`))].map((card, index) => [card, index]));

export function sortHand(hand) {
  const faces = hand.filter(item => isCard(item?.card));
  if (faces.length !== hand.length) return hand.slice();
  return faces.slice().sort((a, b) => ORDER.get(a.card) - ORDER.get(b.card));
}

export function cardFace(card, { className = "" } = {}) {
  if (!isCard(card)) return cardBack({ className });
  return `<span class="wt-card ${className}" style="${cardScorchStyle(card)}" data-card="${esc(card)}" role="img" aria-label="${esc(cardName(card))}">${cardArt(card)}</span>`;
}

export function cardBack({ className = "", label = t("card.back") } = {}) {
  return `<span class="wt-card wt-card--back ${className}" role="img" aria-label="${esc(label)}"></span>`;
}

export function prepareWattenCards() {
  return prepareCardAssets();
}
