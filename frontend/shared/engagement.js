import { apiFetch, loadAuth } from "./auth.js";

const ACCOUNT_TAB_ENDPOINTS = Object.freeze({
  statistics: "/api/account/engagement/account-tab/statistics",
  achievements: "/api/account/engagement/account-tab/achievements",
  settings: "/api/account/engagement/account-tab/settings",
});

const sentAccountTabs = new Set();

function postInteraction(path) {
  void loadAuth().then(async (auth) => {
    if (!auth?.authenticated) return null;
    const response = await apiFetch(path, { method: "POST", keepalive: true });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.recorded) {
      window.dispatchEvent(new CustomEvent("zdwa:engagement-recorded", { detail: { event: result.event } }));
    }
  }).catch(() => {});
}

function recordAccountTab(tab) {
  const normalized = String(tab || "").trim();
  const path = ACCOUNT_TAB_ENDPOINTS[normalized];
  if (!path || sentAccountTabs.has(normalized)) return;
  sentAccountTabs.add(normalized);
  postInteraction(path);
}

function recordInitialAccountTab() {
  if (document.documentElement.dataset.accountTabReady !== "true") return;
  const zilchTab = document.querySelector("[data-zilch-account-tab][aria-selected='true']")?.dataset.zilchAccountTab;
  if (zilchTab) {
    recordAccountTab(zilchTab);
    return;
  }
  const zdwaTab = document.querySelector(".account-tab[aria-selected='true']")?.id;
  recordAccountTab({
    statisticsTab: "statistics",
    achievementsTab: "achievements",
    settingsTab: "settings",
  }[zdwaTab]);
}

window.addEventListener("zdwa:account-tab", (event) => {
  recordAccountTab(event.detail?.tab);
});

window.addEventListener("zdwa:theme-changed", () => {
  postInteraction("/api/account/engagement/theme");
});

function recordGithubLink(event) {
  if (event.type === "auxclick" && event.button !== 1) return;
  const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!link) return;
  const url = new URL(link.href, window.location.href);
  const destination = url.origin === window.location.origin && /^\/go\/github\/(issues|changelog)$/.exec(url.pathname)?.[1];
  // An installed app may open links in a browser with a separate cookie jar.
  // Record the real click in the authenticated app before that handoff.
  if (destination) postInteraction(`/api/account/engagement/github/${destination}`);
}

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#pushSettingsCard, #zilchPushSettingsCard") : null;
  if (target) postInteraction("/api/account/engagement/push-settings");
  recordGithubLink(event);
});
document.addEventListener("auxclick", recordGithubLink);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", recordInitialAccountTab, { once: true });
} else {
  queueMicrotask(recordInitialAccountTab);
}
