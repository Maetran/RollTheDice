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

export function canCarryVoice(snapshot, playerId, userId, voiceState, spectator = false) {
  return Boolean(voiceState?.available && snapshot?._finished && !snapshot?._aborted
    && voiceAccountSeat(snapshot, playerId, userId, spectator));
}

/** Retry only a positively identified, retired source as one independent table. */
export async function createAudioGame({ body, sourceId, expectedAccountId, carry = false, loadAuth,
  handoff, isCurrent = () => true, fetcher = globalThis.fetch }) {
  const verify = async () => {
    const auth = await loadAuth({ refresh: true });
    if (!auth?.authenticated || auth.user?.id !== expectedAccountId || !isCurrent()) throw new Error("account_changed");
    return auth;
  };
  const request = (withSource, auth) => fetcher("/api/games", {
    method: "POST", headers: { "Content-Type": "application/json",
      ...(auth ? { "X-CSRF-Token": auth.user.csrf_token } : {}) },
    body: JSON.stringify({ ...body, source_game_id: withSource ? sourceId : undefined }),
  });
  let response = await request(carry, carry ? await verify() : null);
  if (carry && !response.ok) {
    const error = await response.json().catch(() => null);
    const retired = response.status === 404 && error?.detail === "zdwa_voice_source_not_found"
      || response.status === 409 && error?.detail === "zdwa_voice_source_unavailable";
    if (retired) {
      response = await request(false, await verify());
      carry = false;
    }
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const created = await response.json();
  if (!gameId(created?.game_id)) throw new Error("missing_game_id");
  if (!isCurrent()) throw new Error("account_changed");
  if (carry && !handoff(created)) throw new Error("invalid_voice_continuation");
  return created;
}
