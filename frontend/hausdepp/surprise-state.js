// Persistent appearance is server-projected; it never changes a card or action.
export function renderTableAppearance(table, effects) {
  if (!table) return;
  const scorched = effects?.scorched_cards === true;
  table.classList.toggle("hd-cards-scorched", scorched);
  table.dataset.scorchedCards = String(scorched);
}
