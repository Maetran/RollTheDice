// Cosmetic broadcasts can finish after a newer gesture. Preserve the latest
// facts only within this exact table round; a new round always starts afresh.
export function preserveNewerTableProps(previous, incoming, gameId) {
  const before = previous?._hausdepp_table_props, after = incoming?._hausdepp_table_props;
  const round = incoming?._hausdepp_tournament?.round_number || 1;
  if (before?.schema_version === 1 && after?.schema_version === 1
    && before.game_id === gameId && after.game_id === gameId
    && before.round_number === round && after.round_number === round
    && before.revision > after.revision) return { ...incoming, _hausdepp_table_props: before };
  return incoming;
}
