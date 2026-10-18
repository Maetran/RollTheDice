/** Bind the native HTTP projection to the account mounted before its request. */
export async function loadWattenDetail({ gameId, accountId, fetcher, loadAuth, isCurrent, onAccountChanged }) {
  if (!/^[0-9a-f]{16}$/.test(gameId) || !Number.isSafeInteger(accountId) || accountId <= 0) {
    throw new Error("invalid Watten detail binding");
  }
  if (!isCurrent()) return null;
  const response = await fetcher(`/api/games/${gameId}`, { cache: "no-store", credentials: "same-origin",
    headers: { "X-Watten-Expected-Account-Id": String(accountId) } });
  if (!isCurrent()) return null;
  const data = await response.json().catch(() => null);
  if (!isCurrent()) return null;
  if (response.status === 401 || response.status === 409 && data?.detail === "watten_account_changed") {
    onAccountChanged(); return null;
  }
  // A focus-triggered /me can still be in flight. Wait it out, then make a
  // decisive fresh read before exposing any own reservation or host controls.
  for (let index = 0; index < 2; index += 1) {
    const auth = await loadAuth({ refresh: true });
    if (!isCurrent()) return null;
    if (!auth?.authenticated || auth.user?.id !== accountId) { onAccountChanged(); return null; }
  }
  return { ok: response.ok, data };
}
