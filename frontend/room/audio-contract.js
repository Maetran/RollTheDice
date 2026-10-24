const gameId = value => typeof value === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(value);

export function voiceAccountSeat(snapshot, playerId, userId, spectator = false) {
  if (spectator || !Number.isSafeInteger(userId) || userId <= 0 || !playerId) return null;
  const players = snapshot?._participants || snapshot?._players || [];
  return players.find(player => !player.is_cpu && String(player.id) === String(playerId)
    && Number(player.user_id) === userId) || null;
}

/** A fresh arbitrary table must never inherit a previous group's listening. */
export function continuationGameId(value, { sourceId, groupId = sourceId }) {
  return gameId(sourceId) && gameId(groupId) && value?.source_game_id === sourceId && value.voice_group_id === groupId
    && gameId(value.game_id) && value.game_id !== sourceId ? value.game_id : null;
}
