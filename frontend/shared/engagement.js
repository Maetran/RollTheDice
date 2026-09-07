import { apiFetch, loadAuth } from "./auth.js";

const ACCOUNT_TAB_ENDPOINTS = Object.freeze({
  statistics: "/api/account/engagement/account-tab/statistics",
  achievements: "/api/account/engagement/account-tab/achievements",
  settings: "/api/account/engagement/account-tab/settings",
});

const sentAccountTabs = new Set();

function postInteraction(path) {
  void loadAuth().then((auth) => {
    if (!auth?.authenticated) return null;
    return apiFetch(path, { method: "POST" });
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

document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target.closest("#pushSettingsCard, #zilchPushSettingsCard") : null;
  if (target) postInteraction("/api/account/engagement/push-settings");
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", recordInitialAccountTab, { once: true });
} else {
  queueMicrotask(recordInitialAccountTab);
}
