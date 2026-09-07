import { apiFetch, loadAuth } from "./auth.js";

const ROUTE_EVENTS = new Map([
  ["/regeln", "rules_viewed"], ["/statistiken", "statistics_viewed"],
  ["/historie", "history_viewed"], ["/spieler", "leaderboard_viewed"],
  ["/bestenlisten", "leaderboard_viewed"], ["/erfolge", "achievements_viewed"],
  ["/konto", "settings_viewed"],
]);

export function recordEngagement(event) {
  void loadAuth().then((auth) => {
    if (!auth?.authenticated) return;
    return apiFetch("/api/account/engagement", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
    });
  }).catch(() => {});
}

const path = window.location.pathname.replace(/\/$/, "") || "/";
const routeEvent = [...ROUTE_EVENTS].find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1];
if (routeEvent) recordEngagement(routeEvent);

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("a,button") : null;
  if (!target) return;
  if (target.matches("[data-theme-toggle]")) recordEngagement("theme_changed");
  if (target.matches("[data-game-switch]")) recordEngagement("game_switcher_used");
  if (target.matches("[data-avatar-upload] button") || target.closest("[data-avatar-upload]")) return;
  if (target.closest("[data-push-settings], #zilchPushSettingsCard")) recordEngagement("push_settings_viewed");
  if (target.closest("[data-zilch-account-tab='settings'], #accountSettings, [data-account-settings]")) recordEngagement("settings_viewed");
  if (target instanceof HTMLAnchorElement && /github\.com/i.test(target.href)) recordEngagement("github_clicked");
});

document.addEventListener("change", (event) => {
  if (event.target instanceof HTMLSelectElement && event.target.matches("[data-language-switcher]")) {
    recordEngagement("language_changed");
  }
});

document.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id.includes("Preferences") || form.id.includes("preferences")) recordEngagement("settings_saved");
  if (form.id.includes("LobbyChat")) recordEngagement("chat_settings_saved");
});

window.addEventListener("zdwa:avatar-updated", (event) => {
  recordEngagement(event.detail?.replaced ? "avatar_changed" : "avatar_set");
});
